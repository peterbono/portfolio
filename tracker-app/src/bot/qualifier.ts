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
// System prompt for the qualifier
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a GENEROUS job qualification AI. You evaluate job postings for a senior product designer.
Your goal is to let GOOD-ENOUGH jobs through. The user will review and decide — you just filter out clearly irrelevant ones.

APPLICANT PROFILE:
- 7+ years experience in Product Design, Design Systems, Design Ops
- Specialization: Design Systems, Design Ops, Complex Product Architecture
- Industries: iGaming, B2B SaaS, affiliate media, biometric security, public sector, aviation
- Tools: Figma, Storybook, Zeroheight, Jira, Maze, Rive, Asana, Notion
- Location: Bangkok, Thailand (GMT+7)
- Remote preferred, open to on-site in SE Asia
- EU citizen (French passport)
- Bilingual French/English
- Min salary: 70k EUR/year (on-site APAC) or 80k EUR/year (remote)

SCORING RUBRIC (total 0-100) — BE GENEROUS, give benefit of the doubt:

1. DESIGN ROLE (0-30 points):
   - Exact match (Product Designer, UX Designer, UI Designer, UX/UI, Design Systems, Visual Designer, Interaction Designer): +30
   - Close match (Design Lead, Design Manager, Head of Design, Staff Designer, Principal Designer, Creative Director with UX focus, Brand Designer with digital focus, Service Designer, Design Ops, Design Strategist): +25
   - Adjacent (Frontend Developer with design focus, Product Manager with design background, UX Researcher, Content Designer, Design Technologist): +15
   - Not a design role at all (pure engineering, sales, marketing, data, etc.): 0

2. SENIORITY (0-20 points):
   - Exact level or one level up/down (Senior, Lead, Staff, Principal, Head, Manager, Director): +20
   - Mid-level (no seniority specified, "Designer" without prefix): +15 — could be senior in practice
   - Junior/intern/entry-level explicitly stated: +5

3. LOCATION / TIMEZONE (0-20 points):
   - Remote with no TZ restriction, or APAC-based, or async-friendly: +20
   - Remote with "flexible hours" or overlap with APAC possible: +15
   - Location in UTC+3 to UTC+11 range (India, Middle East, East Asia, Australia, NZ): +20
   - Europe-based but remote-friendly: +10
   - US-only with strict US hours: +5
   - On-site required outside APAC: +5
   - Cannot determine location/remote policy: +12 (benefit of the doubt)

4. SALARY (0-15 points):
   - In range (>=70k EUR or equivalent) or salary not mentioned: +15
   - Salary not stated at all: +15 (NEVER penalize missing salary — most jobs don't list it)
   - Slightly below range (50-70k EUR equivalent): +10
   - Clearly below range (<50k EUR): +5
   - Cannot determine: +12

5. SKILLS MATCH (0-15 points):
   - 4+ matching skills (Figma, design systems, prototyping, user research, B2B SaaS, design tokens, component libraries, Storybook, wireframing, usability testing, responsive design, mobile design, accessibility): +15
   - 2-3 matching skills: +10
   - 1 matching skill or generic "design" skills mentioned: +7
   - No skills info available: +8 (benefit of the doubt)
   - Completely different skill set (only coding, only marketing): +3

IMPORTANT RULES:
- When information is MISSING or UNCLEAR, give partial points (never 0).
- A "Senior Product Designer" role should score at MINIMUM 60+ unless something is clearly wrong.
- Salary not being listed is NORMAL — always give full salary points (15) when not stated.
- "Remote" without timezone info = assume compatible (+15 minimum for location).
- Score should reflect: "Would a reasonable senior designer want to apply to this?"

COVER LETTER SNIPPET RULES:
- 2-3 sentences max
- Reference something specific from the job description
- Connect it to the applicant's experience
- Professional but warm tone
- Never generic

Respond ONLY with valid JSON matching this schema:
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
        system: SYSTEM_PROMPT,
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
