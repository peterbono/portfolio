import type { VercelRequest, VercelResponse } from '@vercel/node'
import { send } from '@vercel/queue'

/**
 * API route: POST /api/queue-apply
 *
 * Producer endpoint for the Vercel Queues-based apply pipeline.
 * Replaces the Trigger.dev dispatcher (api/trigger-task.ts → headless-apply).
 *
 * Flow:
 *   1. Validate incoming job batch
 *   2. Create a bot_run row in Supabase
 *   3. Enqueue each job as a separate message to the "apply-jobs" topic
 *   4. Return { runId, queued } immediately
 *
 * Each queued message is processed independently by api/apply-worker.ts,
 * which Vercel invokes in push mode. This gives us:
 *   - Parallel execution (one Function invocation per job)
 *   - Automatic retries on failure
 *   - No 30-min timeout constraint (each job gets its own 300s budget)
 *   - Built-in observability via Vercel Queues dashboard
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueueApplyJob {
  url: string
  company: string
  role: string
  coverLetterSnippet?: string
  matchScore?: number
}

interface QueueApplyRequest {
  jobs: QueueApplyJob[]
  userId: string
  /** Optional: Supabase search_profile_id for the bot_run row */
  profileId?: string
  /** Optional: user profile overrides (firstName, email, etc.) */
  userProfile?: Record<string, unknown>
}

/** Shape of the message enqueued to Vercel Queues "apply-jobs" topic */
export interface ApplyJobMessage {
  jobUrl: string
  company: string
  role: string
  coverLetterSnippet: string
  matchScore: number
  userId: string
  runId: string
  userProfile?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUEUE_TOPIC = 'apply-jobs'
const MAX_JOBS_PER_BATCH = 50

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type ValidationResult =
  | { ok: true; data: QueueApplyRequest }
  | { ok: false; error: string }

function validateRequest(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Request body required' }
  }

  const b = body as Record<string, unknown>

  if (typeof b.userId !== 'string' || b.userId.length === 0) {
    return { ok: false, error: 'userId (string) required' }
  }

  if (!Array.isArray(b.jobs)) {
    return { ok: false, error: 'jobs (array) required' }
  }

  if (b.jobs.length === 0) {
    return { ok: false, error: 'jobs array must not be empty' }
  }

  if (b.jobs.length > MAX_JOBS_PER_BATCH) {
    return {
      ok: false,
      error: `Too many jobs (max ${MAX_JOBS_PER_BATCH}, got ${b.jobs.length})`,
    }
  }

  // Validate each job has at minimum a url, company, and role
  for (let i = 0; i < b.jobs.length; i++) {
    const job = b.jobs[i] as Record<string, unknown>
    if (!job || typeof job !== 'object') {
      return { ok: false, error: `jobs[${i}] must be an object` }
    }
    if (typeof job.url !== 'string' || job.url.length === 0) {
      return { ok: false, error: `jobs[${i}].url (string) required` }
    }
    if (typeof job.company !== 'string' || job.company.length === 0) {
      return { ok: false, error: `jobs[${i}].company (string) required` }
    }
    if (typeof job.role !== 'string' || job.role.length === 0) {
      return { ok: false, error: `jobs[${i}].role (string) required` }
    }
  }

  return {
    ok: true,
    data: {
      jobs: b.jobs as QueueApplyJob[],
      userId: b.userId as string,
      profileId: typeof b.profileId === 'string' ? b.profileId : undefined,
      userProfile:
        b.userProfile && typeof b.userProfile === 'object'
          ? (b.userProfile as Record<string, unknown>)
          : undefined,
    },
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS — matches existing API routes (wide open for now)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  // ── Validate request ──
  const validation = validateRequest(req.body)
  if (!validation.ok) {
    return res.status(400).json({ error: validation.error })
  }
  const { data } = validation
  const { jobs, userId, profileId, userProfile } = data

  // ── Create bot_run in Supabase ──
  // Dynamic import to keep cold start fast when validation fails
  const { createBotRun } = await import('../src/bot/supabase-server')

  let runId: string
  try {
    runId = await createBotRun(userId, profileId || `queue-${Date.now()}`)
    console.log(`[queue-apply] Created bot_run: ${runId} for ${jobs.length} jobs`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[queue-apply] Failed to create bot_run: ${msg}`)
    return res.status(500).json({ error: 'Failed to create run record' })
  }

  // ── Enqueue each job as a separate message ──
  let queued = 0
  const errors: string[] = []

  // Filter out Ashby jobs (CSP blocks headless — same logic as headless-apply.ts)
  const ashbyJobs = jobs.filter((j) => /ashbyhq\.com/i.test(j.url))
  const applicableJobs = jobs.filter((j) => !/ashbyhq\.com/i.test(j.url))

  if (ashbyJobs.length > 0) {
    console.log(
      `[queue-apply] ${ashbyJobs.length} Ashby jobs skipped (CSP blocks headless)`,
    )
  }

  // Send messages in parallel for speed
  const sendPromises = applicableJobs.map(async (job, index) => {
    const message: ApplyJobMessage = {
      jobUrl: job.url,
      company: job.company,
      role: job.role,
      coverLetterSnippet: job.coverLetterSnippet || '',
      matchScore: job.matchScore ?? 0,
      userId,
      runId,
      userProfile,
    }

    try {
      const { messageId } = await send(QUEUE_TOPIC, message, {
        // Dedup by URL + runId to prevent double-sends on retry
        idempotencyKey: `${runId}:${job.url}`,
      })
      console.log(
        `[queue-apply] Queued [${index + 1}/${applicableJobs.length}] ${job.company} — ${job.role} (msgId: ${messageId})`,
      )
      queued++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(
        `[queue-apply] Failed to queue ${job.company} — ${job.role}: ${msg}`,
      )
      errors.push(`${job.company}: ${msg}`)
    }
  })

  await Promise.allSettled(sendPromises)

  // ── Log Ashby needs_manual results to Supabase ──
  if (ashbyJobs.length > 0) {
    const { logBotActivity, createApplicationFromBot } = await import(
      '../src/bot/supabase-server'
    )

    for (const aj of ashbyJobs) {
      await logBotActivity({
        user_id: userId,
        run_id: runId,
        action: 'skipped',
        company: aj.company,
        role: aj.role,
        ats: 'Ashby',
        reason: 'Ashby blocks headless browsers — apply manually',
      }).catch((err) =>
        console.warn('[queue-apply] Log Ashby skip error:', err),
      )

      await createApplicationFromBot(
        userId,
        {
          title: aj.role,
          company: aj.company,
          location: 'Remote',
          url: aj.url,
          ats: 'Ashby',
        },
        {
          success: false,
          status: 'needs_manual',
          company: aj.company,
          role: aj.role,
          ats: 'Ashby',
          reason: 'Ashby blocks headless browsers — apply manually',
          duration: 0,
        },
      ).catch((err) =>
        console.warn('[queue-apply] Create Ashby application error:', err),
      )
    }
  }

  console.log(
    `[queue-apply] Done: ${queued} queued, ${ashbyJobs.length} Ashby skipped, ${errors.length} send errors`,
  )

  return res.status(200).json({
    runId,
    queued,
    skippedAshby: ashbyJobs.length,
    total: jobs.length,
    ...(errors.length > 0 && { errors }),
  })
}
