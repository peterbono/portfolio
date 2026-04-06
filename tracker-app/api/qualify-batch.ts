import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { buildSystemPrompt, buildUserMessage, callHaikuQualifier } from '../src/bot/qualifier-core'
import type { QualificationResult, ScoreDimensions, RoleArchetype } from '../src/bot/qualifier-core'

/**
 * API route: POST /api/qualify-batch
 *
 * Haiku-powered job qualification proxy for the Chrome extension.
 * The extension sends job descriptions; this route scores them server-side
 * so the Anthropic API key never leaves Vercel.
 *
 * Design notes:
 *   - PARALLEL: all jobs are qualified concurrently via Promise.allSettled
 *     (NOT the Anthropic Batch API which requires polling and is too slow
 *     for a serverless function with a 10s timeout).
 *   - PARTIAL RESULTS: if some jobs fail, we still return the successes.
 *   - RATE-LIMITED: daily qualification caps per plan tier, tracked in
 *     Supabase `qualification_usage` table.
 *   - AUTH: Supabase JWT in Authorization header (same as usage.ts).
 *   - MAX 10 jobs per request to stay within the 10s Vercel timeout.
 */

// ---------------------------------------------------------------------------
// Supabase helpers (same pattern as usage.ts / create-checkout.ts)
// ---------------------------------------------------------------------------

function getSupabase() {
  return createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

async function verifyAuth(authHeader: string | undefined): Promise<{ userId: string } | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)

  const { data: { user }, error } = await getSupabase().auth.getUser(token)
  if (error || !user) return null

  return { userId: user.id }
}

// ---------------------------------------------------------------------------
// Rate limiting — daily qualification caps per plan tier
// ---------------------------------------------------------------------------

/** Daily qualification limits per plan tier. Generous since Haiku is cheap. */
const DAILY_QUALIFY_LIMITS: Record<string, number> = {
  free: 0,       // must sign up
  trial: 50,     // 14-day trial
  starter: 100,
  pro: 300,
  boost: 1000,
}

/** Get the user's effective plan tier from Supabase profiles table. */
async function getUserPlanTier(userId: string): Promise<string> {
  const sb = getSupabase()

  // Try profiles table first
  const { data: profile } = await sb
    .from('profiles')
    .select('plan_tier, created_at')
    .eq('id', userId)
    .single()

  if (profile?.plan_tier && profile.plan_tier !== 'free') {
    return profile.plan_tier
  }

  // Check if trial is active (14 days from account creation)
  const createdAt = profile?.created_at
  if (createdAt) {
    const trialEnd = new Date(createdAt)
    trialEnd.setDate(trialEnd.getDate() + 14)
    if (new Date() < trialEnd) {
      return 'trial'
    }
  }

  return profile?.plan_tier ?? 'free'
}

/** Get today's qualification count for the user. Uses bot_runs or a simple counter. */
async function getTodayQualifyCount(userId: string): Promise<number> {
  const sb = getSupabase()
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)

  // Try qualification_usage table (purpose-built counter)
  const { data, error } = await sb
    .from('qualification_usage')
    .select('count')
    .eq('user_id', userId)
    .gte('date', todayStart.toISOString().slice(0, 10))
    .single()

  if (!error && data) return data.count ?? 0

  // Table might not exist yet — return 0 (no rate limiting enforced until table is created)
  return 0
}

/** Increment today's qualification count. Best-effort — don't block response on failure. */
async function incrementQualifyCount(userId: string, count: number): Promise<void> {
  const sb = getSupabase()
  const today = new Date().toISOString().slice(0, 10)

  // Upsert: increment if exists, insert if not
  const { error } = await sb.rpc('increment_qualification_usage', {
    p_user_id: userId,
    p_date: today,
    p_count: count,
  })

  if (error) {
    // Fallback: try direct upsert if RPC doesn't exist yet
    const { error: upsertError } = await sb
      .from('qualification_usage')
      .upsert(
        { user_id: userId, date: today, count },
        { onConflict: 'user_id,date' },
      )

    if (upsertError) {
      // Table may not exist yet — log but don't fail the request
      console.warn(`[qualify-batch] Failed to track usage: ${upsertError.message}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

const MAX_JOBS_PER_REQUEST = 10
const MAX_DESCRIPTION_LENGTH = 8000

interface JobInput {
  id: string
  title: string
  company: string
  location: string
  description: string
}

interface ProfileInput {
  firstName?: string
  lastName?: string
  yearsExperience?: number
  location?: string
  timezone?: string
  portfolio?: string
  education?: string
  achievements?: unknown[]
  keyProjects?: unknown[]
  industryWins?: Record<string, string>
  toolMastery?: unknown[]
  [key: string]: unknown
}

interface ValidatedRequest {
  jobs: JobInput[]
  profile: ProfileInput
  searchContext: {
    keywords?: string[]
    location?: string
    minSalary?: number
    remoteOnly?: boolean
  }
}

function validateRequest(body: unknown): { ok: true; data: ValidatedRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Request body required' }
  }

  const b = body as Record<string, unknown>

  // Validate jobs array
  if (!Array.isArray(b.jobs)) {
    return { ok: false, error: 'jobs array required' }
  }
  if (b.jobs.length === 0) {
    return { ok: false, error: 'jobs array must not be empty' }
  }
  if (b.jobs.length > MAX_JOBS_PER_REQUEST) {
    return { ok: false, error: `Too many jobs (max ${MAX_JOBS_PER_REQUEST}, got ${b.jobs.length})` }
  }

  const jobs: JobInput[] = []
  for (let i = 0; i < b.jobs.length; i++) {
    const j = b.jobs[i] as Record<string, unknown>
    if (!j || typeof j !== 'object') {
      return { ok: false, error: `jobs[${i}] must be an object` }
    }
    if (typeof j.id !== 'string' || !j.id) {
      return { ok: false, error: `jobs[${i}].id must be a non-empty string` }
    }
    if (typeof j.title !== 'string') {
      return { ok: false, error: `jobs[${i}].title must be a string` }
    }
    if (typeof j.company !== 'string') {
      return { ok: false, error: `jobs[${i}].company must be a string` }
    }
    if (typeof j.description !== 'string' || !j.description) {
      return { ok: false, error: `jobs[${i}].description must be a non-empty string` }
    }

    jobs.push({
      id: j.id,
      title: String(j.title),
      company: String(j.company),
      location: typeof j.location === 'string' ? j.location : '',
      description: String(j.description).slice(0, MAX_DESCRIPTION_LENGTH),
    })
  }

  // Validate profile (optional — falls back to defaults in buildSystemPrompt)
  const profile = (b.profile && typeof b.profile === 'object' ? b.profile : {}) as ProfileInput

  // Search context (optional overrides)
  const rawContext = (b.searchContext && typeof b.searchContext === 'object' ? b.searchContext : {}) as Record<string, unknown>
  const searchContext = {
    keywords: Array.isArray(rawContext.keywords) ? rawContext.keywords.filter((k): k is string => typeof k === 'string') : undefined,
    location: typeof rawContext.location === 'string' ? rawContext.location : undefined,
    minSalary: typeof rawContext.minSalary === 'number' ? rawContext.minSalary : undefined,
    remoteOnly: typeof rawContext.remoteOnly === 'boolean' ? rawContext.remoteOnly : undefined,
  }

  return { ok: true, data: { jobs, profile, searchContext } }
}

// ---------------------------------------------------------------------------
// Result type for the response
// ---------------------------------------------------------------------------

interface QualifyBatchResultItem {
  id: string
  score: number
  dimensions?: ScoreDimensions
  archetype?: RoleArchetype
  jdKeywords?: string[]
  isDesignRole: boolean
  seniorityMatch: boolean
  locationCompatible: boolean
  salaryInRange: boolean
  skillsMatch: boolean
  reasoning: string
  coverLetterSnippet: string
  error?: string
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS — extension calls from arbitrary origins
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  // ── Validate env vars ──────────────────────────────────────────────
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[qualify-batch] ANTHROPIC_API_KEY not configured')
    return res.status(500).json({ error: 'Server not configured' })
  }
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[qualify-batch] Supabase env vars not set')
    return res.status(500).json({ error: 'Server not configured' })
  }

  const started = Date.now()

  // ── Authenticate ───────────────────────────────────────────────────
  const auth = await verifyAuth(req.headers.authorization)
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized — valid Bearer token required' })
  }

  // ── Validate request body ──────────────────────────────────────────
  const validation = validateRequest(req.body)
  if (!validation.ok) {
    return res.status(400).json({ error: (validation as { ok: false; error: string }).error })
  }
  const { jobs, profile, searchContext } = (validation as { ok: true; data: ValidatedRequest }).data

  // ── Rate limiting ──────────────────────────────────────────────────
  const [planTier, todayCount] = await Promise.all([
    getUserPlanTier(auth.userId),
    getTodayQualifyCount(auth.userId),
  ])

  const dailyLimit = DAILY_QUALIFY_LIMITS[planTier] ?? DAILY_QUALIFY_LIMITS.free
  const remaining = Math.max(0, dailyLimit - todayCount)

  if (remaining === 0) {
    return res.status(429).json({
      error: `Daily qualification limit reached (${dailyLimit}/day for ${planTier} plan)`,
      limit: dailyLimit,
      used: todayCount,
      plan: planTier,
    })
  }

  // Cap jobs to remaining quota
  const jobsToProcess = jobs.slice(0, remaining)
  const jobsCapped = jobsToProcess.length < jobs.length

  // ── Build prompts ──────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt(profile)

  // ── Qualify all jobs in parallel (individual calls, NOT batch API) ──
  // Each Haiku call takes ~1-3s. Running 10 in parallel finishes in ~3s.
  const qualifyPromises = jobsToProcess.map(async (job): Promise<QualifyBatchResultItem> => {
    // Build a combined JD with metadata header for better scoring
    const jdWithContext = [
      `Company: ${job.company}`,
      `Role: ${job.title}`,
      job.location ? `Location: ${job.location}` : '',
      '---',
      job.description,
    ].filter(Boolean).join('\n')

    const userMessage = buildUserMessage(jdWithContext, {
      keywords: searchContext.keywords ?? [job.title],
      location: searchContext.location ?? null,
      minSalary: searchContext.minSalary ?? null,
      remoteOnly: searchContext.remoteOnly ?? null,
    })

    try {
      const result = await callHaikuQualifier(systemPrompt, userMessage, {
        timeoutMs: 8_000, // Leave 2s buffer for the serverless function
        retryOn500: false, // No time for retries in a 10s function
        maxTokens: 800,
      })

      return {
        id: job.id,
        score: result.score,
        dimensions: result.dimensions,
        archetype: result.archetype,
        jdKeywords: result.jdKeywords,
        isDesignRole: result.isDesignRole,
        seniorityMatch: result.seniorityMatch,
        locationCompatible: result.locationCompatible,
        salaryInRange: result.salaryInRange,
        skillsMatch: result.skillsMatch,
        reasoning: result.reasoning,
        coverLetterSnippet: result.coverLetterSnippet,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[qualify-batch] Failed to qualify job ${job.id} (${job.company}): ${msg}`)
      return {
        id: job.id,
        score: 35, // Conservative fallback
        isDesignRole: true,
        seniorityMatch: false,
        locationCompatible: false,
        salaryInRange: true,
        skillsMatch: false,
        reasoning: `Qualification failed: ${msg}`,
        coverLetterSnippet: '',
        error: msg,
      }
    }
  })

  const results = await Promise.all(qualifyPromises)

  // ── Track usage (best-effort, don't block response) ────────────────
  const successCount = results.filter(r => !r.error).length
  if (successCount > 0) {
    incrementQualifyCount(auth.userId, successCount).catch(err => {
      console.warn(`[qualify-batch] Usage tracking failed: ${(err as Error).message}`)
    })
  }

  // ── Log + respond ──────────────────────────────────────────────────
  const latencyMs = Date.now() - started
  const succeeded = results.filter(r => !r.error).length
  const failed = results.length - succeeded
  const avgScore = succeeded > 0
    ? Math.round(results.filter(r => !r.error).reduce((s, r) => s + r.score, 0) / succeeded)
    : 0

  console.log(
    `[qualify-batch] user=${auth.userId.slice(0, 8)} jobs=${jobs.length} processed=${jobsToProcess.length} ` +
    `succeeded=${succeeded} failed=${failed} avgScore=${avgScore} plan=${planTier} ` +
    `used=${todayCount}+${successCount}/${dailyLimit} latency=${latencyMs}ms`,
  )

  return res.status(200).json({
    results,
    meta: {
      processed: jobsToProcess.length,
      total: jobs.length,
      capped: jobsCapped,
      succeeded,
      failed,
      avgScore,
      latencyMs,
      plan: planTier,
      dailyUsed: todayCount + successCount,
      dailyLimit,
      dailyRemaining: Math.max(0, dailyLimit - todayCount - successCount),
    },
  })
}
