import Anthropic from '@anthropic-ai/sdk'
import type { SearchProfile } from '../types/database'
import type { ApplicantProfile } from './types'

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
  searchConfig?: { excludedCompanies?: string[] | null },
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
  searchConfig?: { excludedCompanies?: string[] | null },
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
 * This makes scoring much more accurate than a hardcoded generic rubric.
 */
function buildSystemPrompt(applicantProfile: ApplicantProfile): string {
  return `You are a job qualification engine for an automated job search tool.

CANDIDATE PROFILE:
- Name: ${applicantProfile.firstName} ${applicantProfile.lastName}
- Current role: Senior Product Designer
- Specialization: Design Systems, Design Ops, Complex Product Architecture
- Experience: ${applicantProfile.yearsExperience}+ years
- Industries: iGaming (regulated), B2B SaaS, affiliate/SEO media, biometric security, public sector, aviation
- Key skills: Figma, Storybook, Zeroheight, design systems governance, complex information architecture, user research, Jira, Maze, Rive
- Location: ${applicantProfile.location} (${applicantProfile.timezone})
- Acceptable timezone range: UTC+3 to UTC+11 (4h max difference)
- Work mode: P1 Remote APAC, P2 On-site Philippines/Thailand, P3 Remote within TZ range
- Minimum compensation: 70k EUR/year (on-site) or 80k EUR/year (remote freelance)
- Languages: French (native), English (bilingual)
- Portfolio: ${applicantProfile.portfolio}

BLACKLISTED:
- Companies: BetRivers, Rush Street Interactive, ClickOut Media
- Industries: poker, unregulated gambling
- Seniority: intern, junior, associate (too junior for ${applicantProfile.yearsExperience}+ years)

SCORING INSTRUCTIONS:
First check HARD REQUIREMENTS. If ANY fail, return score 0 with hard_fail reason.
If all pass, score on 0-100 scale starting from base 40:

- Role fit (0-25): Title + JD alignment with "Senior Product Designer" / design systems / design ops / complex product architecture. Exact match=25, close match=20, adjacent=12, weak=5.
- Industry match (0-15): B2B SaaS=high, regulated industries=high, consumer app=medium, crypto/unregulated gambling=low. Unknown=8 (benefit of doubt).
- Skill overlap (0-20): How many of the candidate's key skills (Figma, Storybook, Zeroheight, design systems, component libraries, design tokens, prototyping, user research, accessibility) are mentioned or implied? 5+=20, 3-4=15, 1-2=10, none mentioned=8 (benefit of doubt).
- Remote/location fit (0-15): Remote APAC=15, remote global async=12, hybrid SEA=10, on-site SEA=8, remote EU (5-7h diff)=3, US timezone only=0, unknown=10 (benefit of doubt).
- Compensation signal (0-10): Mentions salary in range (>=70k EUR)=10, no salary info=5 (neutral, never penalize), low salary signal=0.
- Growth opportunity (0-15): Design system work=high, leadership opportunity=high, complex products=high, regulated environments=high. Generic role=5, unknown=7.

IMPORTANT:
- When information is MISSING, give partial points (benefit of the doubt), never 0.
- A "Senior Product Designer" role with no red flags should score 65+ minimum.
- Salary not listed is NORMAL — give 5/10, never 0.
- "Remote" without timezone info = assume compatible (10/15).

COVER LETTER SNIPPET:
- 2-3 sentences max referencing something specific from the JD
- Connect it to the candidate's design systems / complex architecture experience
- Professional but warm tone, never generic

Respond ONLY with valid JSON:
{
  "score": number,
  "isDesignRole": boolean,
  "seniorityMatch": boolean,
  "locationCompatible": boolean,
  "salaryInRange": boolean,
  "skillsMatch": boolean,
  "reasoning": "1-2 sentence explanation",
  "coverLetterSnippet": "2-3 personalized sentences"
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

  // Build dynamic system prompt with user profile injected
  const systemPrompt = buildSystemPrompt(applicantProfile)

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

  try {
    const response = await Promise.race([
      client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Qualification timeout (10s)')), 10_000),
      ),
    ])

    // Extract text content
    const textBlock = (response as Anthropic.Message).content.find(
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
