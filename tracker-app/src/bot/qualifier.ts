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

const SYSTEM_PROMPT = `You are a job qualification AI. You evaluate job postings for a senior product designer.

APPLICANT PROFILE:
- 7+ years experience in Product Design, Design Systems, Design Ops
- Specialization: Design Systems, Design Ops, Complex Product Architecture
- Industries: iGaming, B2B SaaS, affiliate media, biometric security, public sector, aviation
- Tools: Figma, Storybook, Zeroheight, Jira, Maze, Rive
- Location: Bangkok, Thailand (GMT+7)
- Remote preferred, open to on-site in SE Asia
- EU citizen (French passport)
- Bilingual French/English
- Min salary: 70k EUR/year (on-site APAC) or 80k EUR/year (remote)

SCORING RUBRIC (total 0-100):
- Is it a design role? (Product Designer, UX/UI, Design Lead, Design Systems, Visual Designer, Staff Designer, Principal Designer, Head of Design, Design Manager): +30 if yes, 0 if no
- Seniority match? (Senior, Lead, Staff, Principal, Head, Manager — NOT junior/entry): +20 if matched
- Remote or location compatible with GMT+7 ±4h (APAC, India, Middle East, Australia)?: +20 if compatible
- Salary in range? (≥70k EUR or equivalent): +15 if in range or not stated
- Required skills match? (Figma, design systems, prototyping, user research, B2B SaaS): +15 if ≥3 skills match

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
        model: 'claude-haiku-4-20250414',
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

    // Return a conservative "unknown" result so the pipeline can decide
    return {
      score: 0,
      isDesignRole: false,
      seniorityMatch: false,
      locationCompatible: false,
      salaryInRange: false,
      skillsMatch: false,
      reasoning: `Qualification failed: ${message}`,
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
export async function qualifyJobsBatch(
  jobs: Array<{ jobDescription: string; url: string }>,
  searchProfile: SearchProfile,
  applicantProfile: ApplicantProfile,
  concurrency: number = 5,
): Promise<Map<string, QualificationResult>> {
  const results = new Map<string, QualificationResult>()
  const queue = [...jobs]

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
