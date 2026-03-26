import { task } from "@trigger.dev/sdk/v3"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiscoveredJob {
  title: string
  company: string
  location: string
  url: string
  isEasyApply: boolean
}

export interface QualifiedJob {
  url: string
  title: string
  company: string
  location: string
  isEasyApply: boolean
  score: number
  isDesignRole: boolean
  seniorityMatch: boolean
  locationCompatible: boolean
  salaryInRange: boolean
  skillsMatch: boolean
  matchReasons: string[]
  coverLetterSnippet: string
  qualified: boolean // score >= 50
  error?: string
}

interface QualifyPayload {
  userId: string
  jobs: DiscoveredJob[]
  userProfile: Record<string, unknown>
  searchConfig: Record<string, unknown>
}

interface QualifyResult {
  qualified: QualifiedJob[]
  disqualified: QualifiedJob[]
  errors: Array<{ url: string; error: string }>
  totalProcessed: number
  totalQualified: number
  costEstimate: number // USD
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_JOBS_PER_RUN = 15
const QUALIFY_THRESHOLD = 50 // score >= 50 passes
const JD_EXTRACT_TIMEOUT = 15_000 // 15s per page
const HAIKU_TIMEOUT = 10_000 // 10s per Haiku call
const CONCURRENCY = 5

// ---------------------------------------------------------------------------
// Haiku qualifier prompt (matches bot/qualifier.ts)
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
- Remote or location compatible with GMT+7 +-4h (APAC, India, Middle East, Australia)?: +20 if compatible
- Salary in range? (>=70k EUR or equivalent): +15 if in range or not stated
- Required skills match? (Figma, design systems, prototyping, user research, B2B SaaS): +15 if >=3 skills match

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
// Helpers
// ---------------------------------------------------------------------------

async function extractJobDescription(
  page: import("playwright").Page,
  url: string,
): Promise<string> {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: JD_EXTRACT_TIMEOUT })

    // Wait a bit for JS-rendered content
    await page.waitForTimeout(2000)

    // Try common JD selectors first (covers most ATS platforms)
    const selectors = [
      // Greenhouse
      '#content',
      // Lever
      '.posting-page',
      // Workable
      '[data-ui="job-description"]',
      // Ashby
      '.ashby-job-posting-brief-description',
      // Generic
      '[class*="job-description"]',
      '[class*="jobDescription"]',
      '[class*="posting-description"]',
      '[id*="job-description"]',
      'article',
      'main',
      // Fallback: body
      'body',
    ]

    for (const selector of selectors) {
      try {
        const el = await page.$(selector)
        if (el) {
          const text = await el.innerText()
          if (text && text.length > 100) {
            return text.slice(0, 6000) // Cap at 6k chars for Haiku
          }
        }
      } catch {
        // Selector not found, try next
      }
    }

    // Ultimate fallback: grab visible text from body
    const bodyText = await page.innerText("body").catch(() => "")
    return bodyText.slice(0, 6000)
  } catch (err) {
    throw new Error(`Failed to extract JD from ${url}: ${(err as Error).message}`)
  }
}

async function callHaikuQualifier(
  client: import("@anthropic-ai/sdk").default,
  jobDescription: string,
  searchConfig: Record<string, unknown>,
): Promise<{
  score: number
  isDesignRole: boolean
  seniorityMatch: boolean
  locationCompatible: boolean
  salaryInRange: boolean
  skillsMatch: boolean
  reasoning: string
  coverLetterSnippet: string
}> {
  const keywords = (searchConfig as Record<string, unknown>).keywords
  const location = (searchConfig as Record<string, unknown>).location
  const minSalary = (searchConfig as Record<string, unknown>).min_salary ?? (searchConfig as Record<string, unknown>).minSalary

  const userMessage = `Evaluate this job posting for the applicant described in the system prompt.

SEARCH PROFILE CONTEXT:
- Keywords: ${Array.isArray(keywords) ? keywords.join(", ") : "Product Designer"}
- Location preference: ${location ?? "Remote APAC"}
- Min salary: ${minSalary ?? 80000} EUR/year
- Remote only: true

JOB DESCRIPTION:
---
${jobDescription.slice(0, 4000)}
---

Return ONLY the JSON object, no markdown fences.`

  const response = await Promise.race([
    client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Haiku timeout (10s)")), HAIKU_TIMEOUT),
    ),
  ])

  const msg = response as import("@anthropic-ai/sdk").Anthropic.Message
  const textBlock = msg.content.find(
    (b): b is import("@anthropic-ai/sdk").Anthropic.TextBlock => b.type === "text",
  )

  if (!textBlock) {
    throw new Error("No text block in Haiku response")
  }

  // Parse JSON — strip markdown fences if present
  let jsonStr = textBlock.text.trim()
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
  }

  const parsed = JSON.parse(jsonStr)
  parsed.score = Math.max(0, Math.min(100, parsed.score))
  return parsed
}

function buildMatchReasons(result: {
  isDesignRole: boolean
  seniorityMatch: boolean
  locationCompatible: boolean
  salaryInRange: boolean
  skillsMatch: boolean
  reasoning: string
}): string[] {
  const reasons: string[] = []
  if (result.isDesignRole) reasons.push("Design role")
  if (result.seniorityMatch) reasons.push("Seniority match")
  if (result.locationCompatible) reasons.push("Location/TZ compatible")
  if (result.salaryInRange) reasons.push("Salary in range")
  if (result.skillsMatch) reasons.push("Skills match")
  if (result.reasoning) reasons.push(result.reasoning)
  return reasons
}

// ---------------------------------------------------------------------------
// Trigger.dev task
// ---------------------------------------------------------------------------

export const qualifyJobsTask = task({
  id: "qualify-jobs",
  maxDuration: 300, // 5 min max
  retry: {
    maxAttempts: 1, // Don't retry — costs Haiku tokens
  },
  run: async (payload: QualifyPayload): Promise<QualifyResult> => {
    const { chromium } = await import("playwright")
    const Anthropic = (await import("@anthropic-ai/sdk")).default

    // Cap jobs to process
    const jobsToProcess = payload.jobs.slice(0, MAX_JOBS_PER_RUN)
    if (payload.jobs.length > MAX_JOBS_PER_RUN) {
      console.log(
        `[qualify-jobs] Capped at ${MAX_JOBS_PER_RUN} jobs (${payload.jobs.length} provided)`,
      )
    }

    console.log(`[qualify-jobs] Starting qualification of ${jobsToProcess.length} jobs`)

    // -----------------------------------------------------------------------
    // 1. Launch Bright Data browser (or local fallback)
    // -----------------------------------------------------------------------
    const SBR_AUTH = process.env.BRIGHTDATA_SBR_AUTH
    const browser = SBR_AUTH
      ? await chromium.connectOverCDP(`wss://${SBR_AUTH}@brd.superproxy.io:9222`)
      : await chromium.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        })

    console.log(`[qualify-jobs] Browser: ${SBR_AUTH ? "Bright Data" : "local Chromium"}`)

    // -----------------------------------------------------------------------
    // 2. Init Anthropic client
    // -----------------------------------------------------------------------
    const anthropic = new Anthropic() // reads ANTHROPIC_API_KEY from env

    // -----------------------------------------------------------------------
    // 3. Process jobs with concurrency control
    // -----------------------------------------------------------------------
    const qualified: QualifiedJob[] = []
    const disqualified: QualifiedJob[] = []
    const errors: Array<{ url: string; error: string }> = []
    const queue = [...jobsToProcess]

    async function worker() {
      // Each worker gets its own page
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      })
      const page = await context.newPage()

      try {
        while (queue.length > 0) {
          const job = queue.shift()
          if (!job) break

          console.log(
            `[qualify-jobs] Processing: ${job.company} — ${job.title} (${job.url})`,
          )

          try {
            // Extract JD text from the job page
            const jdText = await extractJobDescription(page, job.url)

            if (jdText.length < 50) {
              errors.push({
                url: job.url,
                error: "Job description too short or could not be extracted",
              })
              continue
            }

            // Call Haiku to qualify
            const result = await callHaikuQualifier(
              anthropic,
              jdText,
              payload.searchConfig,
            )

            const qualifiedJob: QualifiedJob = {
              url: job.url,
              title: job.title,
              company: job.company,
              location: job.location,
              isEasyApply: job.isEasyApply,
              score: result.score,
              isDesignRole: result.isDesignRole,
              seniorityMatch: result.seniorityMatch,
              locationCompatible: result.locationCompatible,
              salaryInRange: result.salaryInRange,
              skillsMatch: result.skillsMatch,
              matchReasons: buildMatchReasons(result),
              coverLetterSnippet: result.coverLetterSnippet,
              qualified: result.score >= QUALIFY_THRESHOLD,
            }

            if (qualifiedJob.qualified) {
              qualified.push(qualifiedJob)
              console.log(
                `[qualify-jobs] QUALIFIED (${result.score}): ${job.company} — ${job.title}`,
              )
            } else {
              disqualified.push(qualifiedJob)
              console.log(
                `[qualify-jobs] DISQUALIFIED (${result.score}): ${job.company} — ${job.title}`,
              )
            }

            // Breathing room between API calls
            await new Promise((r) => setTimeout(r, 200 + Math.random() * 300))
          } catch (err) {
            const msg = (err as Error).message
            console.error(`[qualify-jobs] Error for ${job.url}: ${msg}`)
            errors.push({ url: job.url, error: msg })
          }
        }
      } finally {
        await page.close().catch(() => {})
        await context.close().catch(() => {})
      }
    }

    try {
      // Launch concurrent workers
      const workerCount = Math.min(CONCURRENCY, jobsToProcess.length)
      const workers = Array.from({ length: workerCount }, () => worker())
      await Promise.all(workers)
    } finally {
      await browser.close()
    }

    // -----------------------------------------------------------------------
    // 4. Return results
    // -----------------------------------------------------------------------
    const totalProcessed = qualified.length + disqualified.length + errors.length
    const costEstimate = (qualified.length + disqualified.length) * 0.003

    console.log(
      `[qualify-jobs] Done. ${qualified.length} qualified, ${disqualified.length} disqualified, ${errors.length} errors. Cost: ~$${costEstimate.toFixed(3)}`,
    )

    return {
      qualified,
      disqualified,
      errors,
      totalProcessed,
      totalQualified: qualified.length,
      costEstimate,
    }
  },
})
