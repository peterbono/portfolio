import Anthropic from '@anthropic-ai/sdk'
import type { SearchProfile } from '../types/database'
import type { ApplicantProfile } from './types'
import type { ArmStats, CoverLetterVariant } from '../types/intelligence'
import { COVER_LETTER_VARIANTS, VARIANT_PROMPTS } from '../types/intelligence'
import { thompsonSample, initializeArms } from '../utils/thompson-sampling'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QualificationResult {
  score: number // 0-100
  isDesignRole: boolean
  seniorityMatch: boolean
  locationCompatible: boolean
  salaryInRange: boolean
  skillsMatch: boolean
  reasoning: string
  coverLetterSnippet: string
  coverLetterVariant?: CoverLetterVariant
}

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
 *
 * Why these patterns:
 * - "graphic designer" / "web designer" / "visual merchandis" — different discipline from Product/UX/UI
 * - "shopify" / "wordpress" — e-commerce template roles, not product design
 * - "part-time" — user targets full-time (unless search keywords include it)
 * - "intern " / "internship" — already in JUNIOR_KEYWORDS but duplicated here for clarity
 * - "junior" — user is Senior level (7+ years)
 */
const TITLE_BLACKLIST_PATTERNS = [
  'graphic designer',
  'visual merchandis', // catches "visual merchandiser" and "visual merchandising"
  'shopify',
  'wordpress',
  'web designer',
  'part-time',
  'part time',
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
 * Useful for logging a summary like:
 * "Pre-filtered: 45 removed (30 not design, 10 too junior, 5 excluded)"
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
 * Example: "Pre-filtered: 45 removed (30 not design, 10 too junior, 5 excluded)"
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
// Client
// ---------------------------------------------------------------------------

let _client: Anthropic | null = null

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic() // reads ANTHROPIC_API_KEY from env
  }
  return _client
}

// ---------------------------------------------------------------------------
// Cover Letter Variant Selection (Thompson Sampling)
// ---------------------------------------------------------------------------

/** In-memory variant arms — re-initialized from localStorage stats each session */
let variantArms: ArmStats[] | null = null

const VARIANT_STATS_KEY = 'tracker_v2_cl_variant_stats'

interface VariantStats {
  variant: CoverLetterVariant
  sent: number
  gotResponse: number
}

function loadVariantStats(): VariantStats[] {
  try {
    const raw = typeof localStorage !== 'undefined'
      ? localStorage.getItem(VARIANT_STATS_KEY)
      : null
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return COVER_LETTER_VARIANTS.map(v => ({ variant: v, sent: 0, gotResponse: 0 }))
}

function saveVariantStats(stats: VariantStats[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(VARIANT_STATS_KEY, JSON.stringify(stats))
    }
  } catch { /* ignore */ }
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
// System prompt builder — injects user profile data for accurate scoring
// ---------------------------------------------------------------------------

/**
 * Build the Haiku system prompt with the actual user profile injected.
 * Includes detailed achievements, project examples, and industry wins
 * so the cover letter snippet can reference SPECIFIC experience.
 */
function buildSystemPrompt(applicantProfile: ApplicantProfile, variant?: CoverLetterVariant): string {
  const variantStyle = variant ? VARIANT_PROMPTS[variant] : 'Write naturally — professional but warm tone.'

  // Format achievements as numbered list for easy LLM reference
  const achievementsList = (applicantProfile.achievements ?? [])
    .map((a, i) => `  ${i + 1}. ${a.metric}\n     Context: ${a.context}\n     Best for JDs mentioning: ${a.relevantWhen.join(', ')}`)
    .join('\n')

  // Format key projects
  const projectsList = (applicantProfile.keyProjects ?? [])
    .map(p => `  - ${p.name} (${p.role}): ${p.outcome}\n    Skills used: ${p.skills.join(', ')}`)
    .join('\n')

  // Format industry wins as matchable entries
  const industryWinsList = Object.entries(applicantProfile.industryWins ?? {})
    .map(([industry, win]) => `  - ${industry}: ${win}`)
    .join('\n')

  // Format tool mastery
  const toolsList = (applicantProfile.toolMastery ?? [])
    .map(t => `  - ${t.name} [${t.proficiency}]: ${t.context}`)
    .join('\n')

  return `You are a job qualification engine for an automated job search tool.
Your TWO jobs: (1) score the job fit accurately, (2) write a cover letter snippet that sounds like a real human who READ this specific JD and knows their own resume deeply.

═══════════════════════════════════════════════
CANDIDATE PROFILE — ${applicantProfile.firstName} ${applicantProfile.lastName}
═══════════════════════════════════════════════

BASICS:
- Current role: Senior Product Designer (${applicantProfile.yearsExperience}+ years)
- Specialization: Design Systems, Design Ops, Complex Product Architecture
- Location: ${applicantProfile.location} (${applicantProfile.timezone})
- Acceptable TZ: UTC+3 to UTC+11 (4h max difference from Bangkok)
- Work mode: P1 Remote APAC, P2 On-site Philippines/Thailand, P3 Remote within TZ range
- Min compensation: 70k EUR/yr (on-site) or 80k EUR/yr (remote freelance)
- Languages: French (native), English (bilingual)
- Education: ${applicantProfile.education ?? 'Master UX Design'}
- Portfolio: ${applicantProfile.portfolio}

KEY ACHIEVEMENTS (use these in cover letter — pick the most relevant to the JD):
${achievementsList || '  (no detailed achievements available)'}

KEY PROJECTS (reference by name when relevant):
${projectsList || '  (no detailed projects available)'}

INDUSTRY-SPECIFIC WINS (match to the JD's industry):
${industryWinsList || '  (no industry wins available)'}

TOOL MASTERY (match to JD's required tools):
${toolsList || '  (no tool details available)'}

BLACKLISTED:
- Companies: BetRivers, Rush Street Interactive, ClickOut Media
- Industries: poker, unregulated gambling
- Seniority: intern, junior, associate (too junior for ${applicantProfile.yearsExperience}+ years)

═══════════════════════════════════════════════
SCORING (0-100) — BE GENEROUS
═══════════════════════════════════════════════

HARD DISQUALIFIERS (score 0 ONLY if one of these is TRUE):
- Company is BetRivers, Rush Street Interactive, or ClickOut Media
- Industry is poker or unregulated gambling
- Title is clearly intern/junior/associate level
- Title has ZERO design relevance (e.g. "Sales Manager", "Backend Engineer")

If none of the above, score on 0-100 starting from base 40:

- Role fit (0-25): Title + JD alignment with "Senior Product Designer" / design systems / design ops / complex product architecture. Exact "Product Designer"=22, "UX/UI Designer"=20, "Design Lead/Staff/Principal"=23, adjacent design role=15, weak=8.
- Industry match (0-15): B2B SaaS=15, regulated industries=14, iGaming=15, consumer app=10, crypto/unregulated gambling=0. Unknown=8.
- Skill overlap (0-20): How many key skills appear in JD? 5+=20, 3-4=15, 1-2=10, none mentioned=8. BONUS: if JD mentions "design systems" or "B2B SaaS" or "iGaming" → add +5 on top.
- Remote/location fit (0-15): Remote APAC=15, remote global async=12, hybrid SEA=10, on-site SEA=8, remote EU=5 (soft filter, not hard block), US TZ only=2 (some are flexible), unknown=10.
- Compensation signal (0-10): In range (>=70k EUR)=10, no info=6, low signal=2.
- Growth opportunity (0-15): Design system work=15, leadership=14, complex products=13, regulated=13. Generic=7, unknown=8.

CRITICAL SCORING RULES:
- Missing info = partial points (benefit of the doubt), NEVER 0.
- "Product Designer" with no red flags = 55+ MINIMUM.
- "Senior Product Designer" with no red flags = 65+ MINIMUM.
- "Design Lead" / "Staff Designer" / "Principal Designer" = 60+ MINIMUM.
- "UX/UI Designer" in APAC = 50+ MINIMUM.
- No salary listed = 6/10 (assume decent).
- "Remote" without TZ info = 10/15 (assume flexible).
- Timezone is a SOFT filter — some remote APAC roles have flexible hours. Only score 0 for location if the JD explicitly says "must be US-based" or similar hard requirement.
- BONUS +15 total cap: if JD mentions "design systems" (+5), "B2B SaaS" (+5), or "iGaming" (+5).

═══════════════════════════════════════════════
COVER LETTER SNIPPET — THIS IS CRITICAL
═══════════════════════════════════════════════

Write 2-3 sentences that pass the "would a human write this?" test. Rules:

1. REFERENCE A SPECIFIC DETAIL FROM THE JD: name the company, mention their product/tech/team/mission, quote something they said. NOT "your team" or "this role" — use the ACTUAL company name and what they do.

2. CONNECT TO A SPECIFIC ACHIEVEMENT: don't say "7+ years of experience" or "design systems expertise." Instead, pick the MOST RELEVANT achievement from the list above and cite it concretely. Examples:
   - BAD: "I have extensive experience with design systems"
   - GOOD: "At ClickOut Media, I governed 143 component templates across 7 SaaS products — the kind of multi-product consistency challenge [Company] faces with [their specific product]"
   - BAD: "I bring strong product design skills"
   - GOOD: "Building PokerStars' regulated platform from 0-to-1 taught me how to ship complex products under compliance constraints, which directly applies to [Company]'s [specific challenge from JD]"

3. ADD A "WHY THIS COMPANY" ANGLE: show you understand what makes them different. Reference their industry, product, mission, or growth stage. If the JD mentions specific projects, teams, or technologies — name them.

4. NEVER use these generic phrases: "passionate about", "I believe", "excited to bring", "align with my experience", "I am confident", "I look forward to". Write like a peer, not a cover letter bot.

STYLE DIRECTIVE: ${variantStyle}

═══════════════════════════════════════════════

Respond ONLY with valid JSON:
{
  "score": number,
  "isDesignRole": boolean,
  "seniorityMatch": boolean,
  "locationCompatible": boolean,
  "salaryInRange": boolean,
  "skillsMatch": boolean,
  "reasoning": "1-2 sentence explanation",
  "coverLetterSnippet": "2-3 sentences following the rules above"
}`
}

// ---------------------------------------------------------------------------
// Main qualification function
// ---------------------------------------------------------------------------

/**
 * Uses Claude Haiku to score a job description against the applicant profile.
 * Cost: ~$0.003 per qualification.
 * Timeout: 10 seconds.
 * Results are cached by JD content.
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

  const client = getClient()

  // Select cover letter variant via Thompson Sampling
  const variant = selectCoverLetterVariant()
  console.log(`[qualifier] Selected cover letter variant: ${variant}`)

  // Build dynamic system prompt with user profile injected
  const systemPrompt = buildSystemPrompt(applicantProfile, variant)

  // Build user message with context
  const userMessage = `Evaluate this job posting for the applicant described in the system prompt.

SEARCH PROFILE CONTEXT:
- Keywords: ${searchProfile.keywords?.join(', ') ?? 'Product Designer'}
- Location preference: ${searchProfile.location ?? 'Remote APAC'}
- Min salary: ${searchProfile.min_salary ?? 80000} EUR/year
- Remote only: ${searchProfile.remote_only ?? true}

JOB DESCRIPTION:
---
${jobDescription.slice(0, 4000)}
---

Return ONLY the JSON object, no markdown fences.`

  const callHaiku = () => Promise.race([
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Qualification timeout (10s)')), 10_000),
    ),
  ])

  try {
    let response: Anthropic.Message
    try {
      response = await callHaiku() as Anthropic.Message
    } catch (firstErr: unknown) {
      const msg = firstErr instanceof Error ? firstErr.message : String(firstErr)
      if (msg.includes('500') || msg.includes('Internal server') || msg.includes('overloaded')) {
        console.warn(`[qualifier] Haiku 500, retrying in 2s...`)
        await new Promise(r => setTimeout(r, 2000))
        response = await callHaiku() as Anthropic.Message
      } else {
        throw firstErr
      }
    }

    // Extract text content
    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    )

    if (!textBlock) {
      throw new Error('No text block in response')
    }

    // Parse JSON — strip any markdown fences if present
    let jsonStr = textBlock.text.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const result: QualificationResult = JSON.parse(jsonStr)

    // Clamp score to 0-100
    result.score = Math.max(0, Math.min(100, result.score))

    // Tag with selected variant
    result.coverLetterVariant = variant

    // Cache it
    qualificationCache.set(key, result)

    console.log(
      `[qualifier] Score: ${result.score} — ${result.reasoning.slice(0, 80)}...`,
    )

    return result
  } catch (err) {
    const message = (err as Error).message
    console.error('[qualifier] Failed:', message)

    // Return a "benefit of the doubt" result — don't auto-kill jobs on errors
    // The user can review and decide. Score 35 keeps it in the "maybe" zone.
    return {
      score: 35,
      isDesignRole: true,
      seniorityMatch: false,
      locationCompatible: false,
      salaryInRange: true,
      skillsMatch: false,
      reasoning: `Qualification incomplete (${message}) — scored conservatively for manual review`,
      coverLetterSnippet: '',
    }
  }
}

// ---------------------------------------------------------------------------
// Batch qualifier — processes multiple JDs with concurrency control
// ---------------------------------------------------------------------------

/**
 * Qualify multiple job descriptions in parallel with a concurrency limit.
 * Default concurrency: 5 (to respect Anthropic rate limits).
 */
const MAX_QUALIFY_PER_RUN = 15 // Cap to control Haiku API costs (~$0.003/job, ~$0.045/run)

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
