/**
 * qualifier.ts — Orchestrator-specific qualifier wrapper
 *
 * This module wraps the shared qualifier-core with orchestrator-specific features:
 *   - Thompson Sampling for cover letter variant A/B testing
 *   - In-memory qualification cache (avoids re-scoring the same JD)
 *   - Batch processing with concurrency control
 *   - Rules-based pre-qualifier (Pass 1)
 *
 * The shared logic (prompt, API call, parsing) lives in qualifier-core.ts.
 */

import type { SearchProfile } from '../types/database'
import type { ApplicantProfile } from './types'
import type { ArmStats, CoverLetterVariant } from '../types/intelligence'
import { COVER_LETTER_VARIANTS } from '../types/intelligence'
import { thompsonSample, initializeArms } from '../utils/thompson-sampling'
import {
  buildSystemPrompt,
  buildUserMessage,
  callHaikuQualifier,
  buildErrorFallback,
  type QualificationResult,
  type QualifierConfig,
} from './qualifier-core'

// Re-export shared types so existing imports from './qualifier' still work
export type { QualificationResult, QualifierConfig } from './qualifier-core'
export { buildSystemPrompt, buildUserMessage, callHaikuQualifier, buildErrorFallback } from './qualifier-core'

// ---------------------------------------------------------------------------
// Types — orchestrator-specific
// ---------------------------------------------------------------------------

/** Input shape for pre-qualification — matches scout DiscoveredJob */
export interface PreQualifyInput {
  title: string
  company: string
  location: string
  url?: string
}

/** Result of the rules-based pre-qualification (Pass 1) */
export interface PreQualifyResult {
  pass: boolean
  reason?: string
  rule?: string // which rule triggered the rejection
}

/** Aggregated stats from a preQualify batch run */
export interface PreQualifyStats {
  total: number
  passed: number
  filtered: number
  breakdown: Record<string, number> // rule name -> count of jobs filtered by it
}

// ---------------------------------------------------------------------------
// Pass 1: Rules-based pre-qualifier (instant, $0 cost)
// ---------------------------------------------------------------------------

/** Design-related keywords that indicate a relevant role */
const DESIGN_KEYWORDS = [
  'designer', 'design', 'ux', 'ui', 'product design', 'visual design',
  'interaction design', 'design system', 'design lead', 'creative director',
  'design ops', 'design manager', 'head of design', 'staff designer',
  'principal designer', 'design strategist', 'service designer',
  'design technologist', 'content designer', 'brand designer',
]

/** Junior/entry-level indicators — skip if user has 5+ years experience */
const JUNIOR_KEYWORDS = [
  'intern', 'internship', 'trainee', 'apprentice', 'entry level',
  'entry-level', 'junior', 'jr.', 'jr ',
]

/** Industries/keywords to always reject */
const BLACKLISTED_INDUSTRY_KEYWORDS = [
  'poker', 'gambling', 'casino', 'betting', 'adult', 'tobacco',
]

/**
 * Title-based blacklist patterns — eliminates obviously irrelevant roles
 * BEFORE sending to Haiku. Each entry is matched case-insensitively against
 * the job title. Easy to extend: just add a new string to the array.
 */
const TITLE_BLACKLIST_PATTERNS = [
  'graphic designer',
  'visual merchandis', // catches "visual merchandiser" and "visual merchandising"
  'shopify',
  'wordpress',
  'web designer',
  'part-time',
  'part time',
  // Non-product design disciplines — hard reject before Haiku
  'generative ai',
  'ai designer',
  'ai artist',
  'motion designer',
  'motion graphic',
  'animation',
  'animator',
  'video designer',
  'video editor',
  'brand designer',
  'creative director',
  'art director',
  'illustrat', // catches illustrator, illustration
  'concept artist',
  '3d designer',
  '3d artist',
  'game designer',
  'fashion designer',
  'interior designer',
  'content creator',
  'social media designer',
  'email designer',
]

/**
 * Pass 1: Deterministic rules-based filter.
 * Runs instantly with zero API cost. Eliminates obviously bad matches
 * before sending survivors to Haiku (Pass 2).
 *
 * Returns { pass: true } if the job should proceed to LLM scoring,
 * or { pass: false, reason, rule } if it should be filtered out.
 */
export function preQualify(
  job: PreQualifyInput,
  applicantProfile: ApplicantProfile,
  searchConfig?: { excludedCompanies?: string[] | null; keywords?: string[] },
): PreQualifyResult {
  const titleLower = job.title.toLowerCase()
  const companyLower = job.company.toLowerCase()

  // Rule 1: Title must contain at least one design keyword
  const hasDesignKeyword = DESIGN_KEYWORDS.some(kw => titleLower.includes(kw))
  if (!hasDesignKeyword) {
    return { pass: false, reason: `Not a design role: "${job.title}"`, rule: 'not_design_role' }
  }

  // Rule 2: Seniority filter — reject if title has junior indicators AND user is senior
  if (applicantProfile.yearsExperience > 5) {
    const hasJunior = JUNIOR_KEYWORDS.some(kw => titleLower.includes(kw))
    if (hasJunior) {
      return { pass: false, reason: `Too junior for ${applicantProfile.yearsExperience}+ years experience`, rule: 'too_junior' }
    }
  }

  // Rule 3: Excluded companies from search config
  const excludedCompanies = searchConfig?.excludedCompanies ?? []
  const isExcluded = excludedCompanies.some(
    c => c && companyLower.includes(c.toLowerCase()),
  )
  if (isExcluded) {
    return { pass: false, reason: `Excluded company: "${job.company}"`, rule: 'excluded_company' }
  }

  // Rule 4: Blacklisted industry keywords in title or company name
  const hasBlacklisted = BLACKLISTED_INDUSTRY_KEYWORDS.some(
    kw => titleLower.includes(kw) || companyLower.includes(kw),
  )
  if (hasBlacklisted) {
    return { pass: false, reason: `Blacklisted industry keyword in "${job.title}" or "${job.company}"`, rule: 'blacklisted_industry' }
  }

  // Rule 5: Title blacklist patterns — irrelevant role types
  // Skip "part-time" filter if user's search keywords explicitly include it
  const userKeywords = searchConfig?.keywords ?? []
  const userKeywordsLower = userKeywords.map((k: string) => k.toLowerCase())
  const matchedBlacklist = TITLE_BLACKLIST_PATTERNS.find(pattern => {
    // Allow "part-time"/"part time" if user keywords mention it
    if ((pattern === 'part-time' || pattern === 'part time') && userKeywordsLower.some(k => k.includes('part-time') || k.includes('part time'))) {
      return false
    }
    return titleLower.includes(pattern)
  })
  if (matchedBlacklist) {
    return { pass: false, reason: `Irrelevant role type "${matchedBlacklist}" in title: "${job.title}"`, rule: 'title_blacklist' }
  }

  // All rules passed — this job proceeds to Haiku scoring
  return { pass: true }
}

/**
 * Run preQualify on a batch of jobs and return survivors + stats.
 */
export function preQualifyBatch(
  jobs: PreQualifyInput[],
  applicantProfile: ApplicantProfile,
  searchConfig?: { excludedCompanies?: string[] | null; keywords?: string[] },
): { survivors: PreQualifyInput[]; filtered: PreQualifyInput[]; stats: PreQualifyStats } {
  const survivors: PreQualifyInput[] = []
  const filtered: PreQualifyInput[] = []
  const breakdown: Record<string, number> = {}

  for (const job of jobs) {
    const result = preQualify(job, applicantProfile, searchConfig)
    if (result.pass) {
      survivors.push(job)
    } else {
      filtered.push(job)
      if (result.rule) {
        breakdown[result.rule] = (breakdown[result.rule] ?? 0) + 1
      }
    }
  }

  return {
    survivors,
    filtered,
    stats: {
      total: jobs.length,
      passed: survivors.length,
      filtered: filtered.length,
      breakdown,
    },
  }
}

/**
 * Format preQualify stats into a human-readable log line.
 */
export function formatPreQualifyStats(stats: PreQualifyStats): string {
  if (stats.filtered === 0) {
    return `Pre-filter: all ${stats.total} jobs passed rules check`
  }

  const parts: string[] = []
  const ruleLabels: Record<string, string> = {
    not_design_role: 'not design',
    too_junior: 'too junior',
    excluded_company: 'excluded company',
    blacklisted_industry: 'blacklisted industry',
    title_blacklist: 'irrelevant role type',
  }

  for (const [rule, count] of Object.entries(stats.breakdown)) {
    parts.push(`${count} ${ruleLabels[rule] ?? rule}`)
  }

  return `Pre-filtered: ${stats.filtered} removed (${parts.join(', ')}). ${stats.passed}/${stats.total} sent to AI scoring.`
}

// ---------------------------------------------------------------------------
// Cover Letter Variant Selection (Thompson Sampling)
// ---------------------------------------------------------------------------

/**
 * In-memory variant arms — re-initialized from stored stats each session.
 * Resets per run in worker environments, which is acceptable since Thompson
 * Sampling converges over multiple runs anyway.
 */
let variantArms: ArmStats[] | null = null

const VARIANT_STATS_KEY = 'tracker_v2_cl_variant_stats'

interface VariantStats {
  variant: CoverLetterVariant
  sent: number
  gotResponse: number
}

// ---------------------------------------------------------------------------
// Variant stats storage — environment-aware (browser vs worker)
// ---------------------------------------------------------------------------

/**
 * In-memory fallback store for environments where localStorage is unavailable
 * (Trigger.dev workers, Node.js scripts). Resets each process, which is fine
 * because Thompson Sampling is designed to work with sparse data and will
 * explore uniformly when there's no history.
 */
const _inMemoryVariantStore = new Map<string, string>()

/**
 * Load variant stats from the best available storage.
 * Priority: localStorage (browser) > in-memory Map (worker/Node).
 *
 * The optional userId parameter is reserved for future Supabase persistence
 * where stats would be stored per-user in the database.
 */
export function loadVariantStats(_userId?: string): VariantStats[] {
  try {
    // Browser environment — use localStorage
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(VARIANT_STATS_KEY)
      if (raw) return JSON.parse(raw)
    } else {
      // Worker environment — use in-memory fallback
      const raw = _inMemoryVariantStore.get(VARIANT_STATS_KEY)
      if (raw) return JSON.parse(raw)
    }
  } catch { /* ignore parse errors */ }

  // No stored data — return fresh stats for all variants
  return COVER_LETTER_VARIANTS.map(v => ({ variant: v, sent: 0, gotResponse: 0 }))
}

/**
 * Save variant stats to the best available storage.
 * Priority: localStorage (browser) > in-memory Map (worker/Node).
 */
export function saveVariantStats(stats: VariantStats[], _userId?: string): void {
  try {
    const serialized = JSON.stringify(stats)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(VARIANT_STATS_KEY, serialized)
    } else {
      _inMemoryVariantStore.set(VARIANT_STATS_KEY, serialized)
    }
  } catch { /* ignore write errors */ }
}

/** Record that a variant was sent. Call after application submission. */
export function recordVariantSent(variant: CoverLetterVariant): void {
  const stats = loadVariantStats()
  const entry = stats.find(s => s.variant === variant)
  if (entry) entry.sent++
  saveVariantStats(stats)
  variantArms = null // force re-init
}

/** Record that a variant got a response. Call from Gmail sync. */
export function recordVariantResponse(variant: CoverLetterVariant): void {
  const stats = loadVariantStats()
  const entry = stats.find(s => s.variant === variant)
  if (entry) entry.gotResponse++
  saveVariantStats(stats)
  variantArms = null
}

/**
 * Select the best cover letter variant using Thompson Sampling.
 * With no data, samples uniformly. As data accumulates, exploits winners.
 */
export function selectCoverLetterVariant(): CoverLetterVariant {
  if (!variantArms) {
    const stats = loadVariantStats()
    variantArms = initializeArms(
      stats.map(s => ({
        ats: s.variant,
        totalApplied: s.sent,
        gotResponse: s.gotResponse,
        responseRate: s.sent > 0 ? s.gotResponse / s.sent : 0,
        avgDaysToResponse: 0,
        ghostRate: 0,
      }))
    )
  }
  const selected = thompsonSample(variantArms)
  return selected.id as CoverLetterVariant
}

// ---------------------------------------------------------------------------
// Cache — avoids re-qualifying the same job description
// ---------------------------------------------------------------------------

const qualificationCache = new Map<string, QualificationResult>()

function cacheKey(jobDescription: string): string {
  // Simple hash: first 200 chars should be unique enough per JD
  return jobDescription.slice(0, 200).toLowerCase().replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// Main qualification function
// ---------------------------------------------------------------------------

/**
 * Uses Claude Haiku to score a job description against the applicant profile.
 * Cost: ~$0.003 per qualification.
 * Timeout: 10 seconds.
 * Results are cached by JD content.
 *
 * This is the orchestrator-specific wrapper that adds:
 *   - Thompson Sampling variant selection
 *   - JD-based caching
 *   - Error fallback handling
 */
export async function qualifyJob(
  jobDescription: string,
  searchProfile: SearchProfile,
  applicantProfile: ApplicantProfile,
): Promise<QualificationResult> {
  // Check cache first
  const key = cacheKey(jobDescription)
  const cached = qualificationCache.get(key)
  if (cached) {
    console.log('[qualifier] Cache hit — returning cached result')
    return cached
  }

  // Select cover letter variant via Thompson Sampling
  const variant = selectCoverLetterVariant()
  console.log(`[qualifier] Selected cover letter variant: ${variant}`)

  // Build prompts using shared core functions
  const systemPrompt = buildSystemPrompt(applicantProfile, variant)
  const userMessage = buildUserMessage(jobDescription, {
    keywords: searchProfile.keywords ?? undefined,
    location: searchProfile.location ?? undefined,
    minSalary: searchProfile.min_salary ?? undefined,
    remoteOnly: searchProfile.remote_only ?? undefined,
  })

  try {
    // Call Haiku using the shared core function
    const result = await callHaikuQualifier(systemPrompt, userMessage)

    // Tag with selected variant (orchestrator-specific)
    const fullResult: QualificationResult = {
      ...result,
      coverLetterVariant: variant,
    }

    // Cache it
    qualificationCache.set(key, fullResult)

    console.log(
      `[qualifier] Score: ${fullResult.score} — ${fullResult.reasoning.slice(0, 80)}...`,
    )

    return fullResult
  } catch (err) {
    const message = (err as Error).message
    console.error('[qualifier] Failed:', message)

    // Return a "benefit of the doubt" result using shared fallback
    return buildErrorFallback(message)
  }
}

// ---------------------------------------------------------------------------
// Batch qualifier — processes multiple JDs with concurrency control
// ---------------------------------------------------------------------------

const MAX_QUALIFY_PER_RUN = 50 // Cap to control Haiku API costs (~$0.003/job, ~$0.15/run max)

/**
 * Qualify multiple job descriptions in parallel with a concurrency limit.
 * Default concurrency: 5 (to respect Anthropic rate limits).
 */
export async function qualifyJobsBatch(
  jobs: Array<{ jobDescription: string; url: string }>,
  searchProfile: SearchProfile,
  applicantProfile: ApplicantProfile,
  concurrency: number = 5,
): Promise<Map<string, QualificationResult>> {
  const results = new Map<string, QualificationResult>()
  // Cap the number of jobs to qualify per run
  const capped = jobs.slice(0, MAX_QUALIFY_PER_RUN)
  if (jobs.length > MAX_QUALIFY_PER_RUN) {
    console.log(`[qualifier] Capped at ${MAX_QUALIFY_PER_RUN} jobs (${jobs.length} found)`)
  }
  const queue = [...capped]

  async function worker() {
    while (queue.length > 0) {
      const job = queue.shift()
      if (!job) break

      const result = await qualifyJob(job.jobDescription, searchProfile, applicantProfile)
      results.set(job.url, result)

      // Small breathing room between API calls
      await new Promise(r => setTimeout(r, 200 + Math.random() * 300))
    }
  }

  // Launch concurrency workers
  const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker())
  await Promise.all(workers)

  return results
}

/**
 * Clear the qualification cache (useful between runs).
 */
export function clearQualificationCache(): void {
  qualificationCache.clear()
}
