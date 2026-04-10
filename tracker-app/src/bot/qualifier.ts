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

import type { SearchProfile } from '../types/database.js'
import type { ApplicantProfile } from './types.js'
import type { ArmStats, CoverLetterVariant } from '../types/intelligence.js'
import { COVER_LETTER_VARIANTS } from '../types/intelligence.js'
import { thompsonSample, initializeArms } from '../utils/thompson-sampling.js'
import {
  buildSystemPrompt,
  buildUserMessage,
  callHaikuQualifier,
  callHaikuQualifierBatch,
  buildErrorFallback,
  type QualificationResult,
  type QualifierConfig,
  type BatchQualifyRequest,
  type BatchQualifierConfig,
} from './qualifier-core.js'

// Re-export shared types so existing imports from './qualifier' still work
export type { QualificationResult, QualifierConfig, BatchQualifyRequest, BatchQualifierConfig } from './qualifier-core.js'
export { buildSystemPrompt, buildUserMessage, callHaikuQualifier, callHaikuQualifierBatch, buildErrorFallback } from './qualifier-core.js'

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

// ---------------------------------------------------------------------------
// Location / Timezone rejection patterns for preQualify (Pass 1)
// ---------------------------------------------------------------------------

/**
 * US state abbreviations (2-letter) used in location strings like "Palo Alto, CA".
 * We match ", XX" pattern to avoid false positives (e.g. "IN" matching India).
 */
const US_STATE_ABBREVS = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC',
]

/**
 * Location keywords that indicate an incompatible timezone (outside UTC+3..UTC+11).
 * Matched case-insensitively against the job location field.
 */
const LOCATION_REJECT_PATTERNS = [
  // US country-level
  'united states', 'united states of america', 'usa',
  // US timezone abbreviations
  'est', 'cst', 'pst', 'mst', 'eastern time', 'pacific time', 'central time', 'mountain time',
  // Major US cities
  'new york', 'san francisco', 'los angeles', 'chicago', 'seattle',
  'austin', 'denver', 'boston', 'atlanta', 'miami', 'dallas',
  'houston', 'portland', 'san diego', 'san jose', 'palo alto',
  'menlo park', 'mountain view', 'cupertino', 'sunnyvale', 'redwood city',
  'santa clara', 'irvine', 'scottsdale', 'salt lake city', 'raleigh',
  'durham', 'charlotte', 'nashville', 'phoenix', 'pittsburgh',
  'philadelphia', 'washington dc', 'minneapolis', 'columbus',
  'indianapolis', 'detroit', 'milwaukee', 'kansas city', 'st louis',
  'tampa', 'orlando', 'sacramento', 'las vegas', 'baltimore',
  'richmond', 'oakland', 'boulder', 'provo', 'lehi',
  // Canada
  'canada', 'toronto', 'vancouver', 'montreal', 'ottawa', 'calgary',
  'edmonton', 'winnipeg', 'quebec', 'québec', 'ontario', 'british columbia',
  // EU countries & cities
  'europe', 'emea', 'united kingdom', 'london', 'berlin', 'paris',
  'amsterdam', 'dublin', 'madrid', 'barcelona', 'lisbon', 'munich',
  'hamburg', 'vienna', 'zurich', 'zürich', 'geneva', 'stockholm',
  'copenhagen', 'oslo', 'helsinki', 'warsaw', 'prague', 'bucharest',
  'brussels', 'milan', 'rome',
  // EU timezone abbreviations
  'cet', 'gmt+0', 'gmt+1', 'gmt+2', 'utc+0', 'utc+1', 'utc+2',
  // LATAM
  'latam', 'latin america', 'south america', 'americas', 'north america',
  'buenos aires', 'sao paulo', 'são paulo', 'mexico city', 'bogota', 'bogotá',
  'santiago', 'lima', 'brazil', 'brasil', 'argentina', 'colombia', 'chile',
  'peru', 'mexico', 'costa rica', 'panama', 'caribbean',
  // Africa
  'lagos', 'nairobi', 'cape town', 'johannesburg', 'accra', 'cairo',
  'africa',
]

/**
 * Check if a location string contains a US state abbreviation pattern.
 * Matches patterns like "City, CA" or "City, CA, US" or "Remote, US".
 */
function hasUSStateAbbrev(location: string): boolean {
  // Match ", XX" at end or ", XX," or ", XX " patterns — case-sensitive for state codes
  for (const state of US_STATE_ABBREVS) {
    // Pattern: comma + optional space + 2-letter state code + end/comma/space/parenthesis
    const pattern = new RegExp(`,\\s*${state}(?:\\s*$|\\s*,|\\s+|\\))`, 'i')
    if (pattern.test(location)) {
      // Extra check: the state code should be uppercase in the original to avoid
      // false positives like "Remote, IN" (Indiana vs India).
      // But since we also have "india" in APAC-compatible locations, we do a
      // secondary check: if location also contains an APAC keyword, skip.
      const locationLower = location.toLowerCase()
      const apacSafe = ['india', 'bangalore', 'bengaluru', 'mumbai', 'hyderabad',
        'pune', 'delhi', 'chennai', 'indonesia', 'jakarta', 'bangkok', 'thailand',
        'singapore', 'malaysia', 'philippines', 'manila', 'vietnam', 'japan',
        'tokyo', 'korea', 'seoul', 'taiwan', 'hong kong', 'china', 'australia',
        'dubai', 'uae', 'qatar', 'saudi', 'pakistan', 'karachi', 'lahore',
        'islamabad', 'bangladesh', 'dhaka', 'nepal', 'sri lanka', 'cambodia',
        'myanmar', 'laos'].some(kw => locationLower.includes(kw))
      if (!apacSafe) return true
    }
  }
  return false
}

/**
 * Check if a location is in an incompatible timezone for preQualify.
 * Returns a rejection reason string, or null if location is acceptable.
 *
 * Unlike the scout's isTimezoneCompatible() which uses an allowlist approach,
 * this uses a blocklist approach to catch US/EU/LATAM/Africa locations that
 * slip through. The scout filter runs first; this is a safety net in preQualify.
 */
function getLocationRejectionReason(location: string): string | null {
  if (!location) return null

  const lower = location.toLowerCase().trim()

  // Never reject empty or clearly APAC-compatible locations
  if (!lower || lower === 'remote' || lower === 'anywhere' || lower === 'worldwide') {
    // Bare "Remote" is already handled by the scout layer for LinkedIn.
    // If it reaches preQualify, it means it passed the scout filter (e.g. from RemoteOK).
    return null
  }

  // Check for US state abbreviation patterns (e.g. "Palo Alto, CA")
  if (hasUSStateAbbrev(location)) {
    return `US location detected: "${location}"`
  }

  // Check for short "US" patterns — "Remote, US", "US", ", US", "Remote (US)"
  // Can't use simple .includes('us') because it matches "campus", "focus", etc.
  // Use word-boundary regex instead.
  if (/\bUS\b/.test(location) || /\bU\.S\.?\b/i.test(location)) {
    // Double-check: not a false positive from an APAC location
    const apacCheck = ['india', 'singapore', 'australia', 'japan', 'korea',
      'apac', 'asia', 'thailand', 'philippines', 'indonesia', 'vietnam',
      'malaysia', 'dubai', 'uae', 'hong kong', 'china', 'taiwan'].some(
      kw => lower.includes(kw))
    if (!apacCheck) {
      return `US location detected: "${location}"`
    }
  }

  // Check against explicit reject patterns
  for (const pattern of LOCATION_REJECT_PATTERNS) {
    if (lower.includes(pattern)) {
      // Safety: check if location ALSO contains an APAC keyword (e.g. "Remote - India, Americas")
      // In that case, don't reject — the APAC signal takes priority
      const apacKeywords = [
        'bangkok', 'thailand', 'singapore', 'malaysia', 'indonesia', 'philippines',
        'vietnam', 'japan', 'korea', 'taiwan', 'hong kong', 'china', 'india',
        'australia', 'dubai', 'uae', 'apac', 'asia', 'southeast asia',
      ]
      const hasApacSignal = apacKeywords.some(kw => lower.includes(kw))
      if (!hasApacSignal) {
        return `Incompatible timezone location "${pattern}" in: "${location}"`
      }
    }
  }

  return null
}

/**
 * Title-based blacklist patterns — eliminates obviously irrelevant roles
 * BEFORE sending to Haiku. Each entry is matched case-insensitively against
 * the job title. Easy to extend: just add a new string to the array.
 *
 * NOTE: "graphic designer" is handled by TITLE_BLACKLIST_REGEX below
 * (needs allowlist logic so "UX/Graphic Designer" isn't rejected).
 */
const TITLE_BLACKLIST_PATTERNS = [
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
  // Packaging / print design — not product design
  'packaging designer',
  'packaging design',
  'print designer',
  // Social media roles — not product design
  'social media',
  // Non-role / generic listings
  'bootcamp',
  'participant',
  'freelancers', // generic "Freelancers" listing, not a specific role
  // Branding-only roles (unless combined with product/UX — caught by regex below)
  'branding',
]

/**
 * Regex-based title blacklist — for patterns that need allowlist override.
 * Each { pattern, label } is tested against the lowercased title.
 * If matched AND no TITLE_ALLOWLIST_PATTERNS entry is found in the title,
 * the job is rejected.
 *
 * This handles "graphic designer" correctly:
 *   REJECTED: "Graphic Designer", "Shopify Graphic Designer",
 *     "Senior Graphic Designer (Branding Focus)", "Graphic Packaging Designer",
 *     "PERMANENT Work From Home! | Graphic Designer"
 *   ALLOWED: "UX/Graphic Designer", "Product & Graphic Designer"
 */
const TITLE_BLACKLIST_REGEX: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /graphic\s*design/i, label: 'graphic design' },
]

/**
 * Allowlist patterns — if a title contains one of these AND matches a
 * TITLE_BLACKLIST_REGEX entry, the regex rejection is overridden.
 * This prevents false positives on hybrid roles like "UX/Graphic Designer".
 *
 * NOTE: These ONLY override TITLE_BLACKLIST_REGEX, not TITLE_BLACKLIST_PATTERNS.
 */
const TITLE_ALLOWLIST_PATTERNS = [
  'product',
  'ux',
  'ui',
  'interaction',
  'design system',
  'design ops',
  'service design',
  'content design',
  'design technolog',
  'design lead',
  'head of design',
  'design manager',
  'staff designer',
  'principal designer',
  'design strategist',
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

  // Rule 5b: Regex-based title blacklist with allowlist override
  // Handles patterns like "graphic designer" that need to allow hybrid roles
  // (e.g. "UX/Graphic Designer" is OK, but "Graphic Designer" alone is not)
  const hasAllowlistKeyword = TITLE_ALLOWLIST_PATTERNS.some(kw => titleLower.includes(kw))
  if (!hasAllowlistKeyword) {
    const matchedRegex = TITLE_BLACKLIST_REGEX.find(({ pattern }) => pattern.test(titleLower))
    if (matchedRegex) {
      return { pass: false, reason: `Irrelevant role type "${matchedRegex.label}" in title: "${job.title}"`, rule: 'title_blacklist' }
    }
  }

  // Rule 6: Location/timezone rejection — catch US/EU/LATAM/Africa locations
  // This is the safety net for jobs that slipped through the scout's TZ filter.
  // The scout uses an allowlist (only pass known APAC locations), but some jobs
  // reach preQualify from sources that bypass the scout (e.g. Trigger.dev direct).
  if (job.location) {
    const locationRejectReason = getLocationRejectionReason(job.location)
    if (locationRejectReason) {
      return { pass: false, reason: locationRejectReason, rule: 'incompatible_timezone' }
    }
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
    incompatible_timezone: 'wrong timezone',
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
 * Qualify multiple job descriptions using the Anthropic Batch API (50% discount).
 * Falls back to concurrent individual calls if the batch API fails.
 *
 * Default concurrency for fallback: 10 (Haiku handles high throughput well).
 */
export async function qualifyJobsBatch(
  jobs: Array<{ jobDescription: string; url: string }>,
  searchProfile: SearchProfile,
  applicantProfile: ApplicantProfile,
  concurrency: number = 10,
): Promise<Map<string, QualificationResult>> {
  const results = new Map<string, QualificationResult>()
  // Cap the number of jobs to qualify per run
  const capped = jobs.slice(0, MAX_QUALIFY_PER_RUN)
  if (jobs.length > MAX_QUALIFY_PER_RUN) {
    console.log(`[qualifier] Capped at ${MAX_QUALIFY_PER_RUN} jobs (${jobs.length} found)`)
  }

  // Check cache first — separate cached from uncached jobs
  const uncachedJobs: Array<{ jobDescription: string; url: string }> = []
  for (const job of capped) {
    const key = cacheKey(job.jobDescription)
    const cached = qualificationCache.get(key)
    if (cached) {
      console.log(`[qualifier] Cache hit for ${job.url}`)
      results.set(job.url, cached)
    } else {
      uncachedJobs.push(job)
    }
  }

  if (uncachedJobs.length === 0) {
    console.log('[qualifier] All jobs served from cache')
    return results
  }

  // Select cover letter variant via Thompson Sampling (same variant for the batch)
  const variant = selectCoverLetterVariant()
  console.log(`[qualifier] Batch using cover letter variant: ${variant}`)

  // Build batch requests using shared core functions
  const batchRequests: BatchQualifyRequest[] = uncachedJobs.map((job) => ({
    id: job.url,
    systemPrompt: buildSystemPrompt(applicantProfile, variant),
    userMessage: buildUserMessage(job.jobDescription, {
      keywords: searchProfile.keywords ?? undefined,
      location: searchProfile.location ?? undefined,
      minSalary: searchProfile.min_salary ?? undefined,
      remoteOnly: searchProfile.remote_only ?? undefined,
    }),
  }))

  console.log(`[qualifier] Sending ${batchRequests.length} jobs to Haiku Batch API (50% discount)`)

  try {
    const batchResults = await callHaikuQualifierBatch(batchRequests, {
      fallbackToIndividual: true,
    })

    // Process results — add variant tag, cache, and categorize
    for (const job of uncachedJobs) {
      const result = batchResults.get(job.url)
      if (result) {
        const fullResult: QualificationResult = {
          ...result,
          coverLetterVariant: variant,
        }
        // Cache it
        qualificationCache.set(cacheKey(job.jobDescription), fullResult)
        results.set(job.url, fullResult)
        console.log(`[qualifier] Score: ${fullResult.score} — ${fullResult.reasoning.slice(0, 80)}...`)
      } else {
        // No result from batch — use error fallback
        const fallback = buildErrorFallback('No result from batch API')
        results.set(job.url, fallback)
      }
    }
  } catch (err) {
    // Complete batch failure with fallback disabled — fall back to sequential
    console.error(`[qualifier] Batch failed, falling back to sequential: ${(err as Error).message}`)
    const queue = [...uncachedJobs]

    async function worker() {
      while (queue.length > 0) {
        const job = queue.shift()
        if (!job) break
        const result = await qualifyJob(job.jobDescription, searchProfile, applicantProfile)
        results.set(job.url, result)
        await new Promise(r => setTimeout(r, 50 + Math.random() * 100))
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, uncachedJobs.length) }, () => worker())
    await Promise.all(workers)
  }

  return results
}

/**
 * Clear the qualification cache (useful between runs).
 */
export function clearQualificationCache(): void {
  qualificationCache.clear()
}
