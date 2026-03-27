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
  qualified: boolean // score >= QUALIFY_THRESHOLD (40)
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
const QUALIFY_THRESHOLD = 40 // score >= 40 passes — let more jobs through for user review
const JD_EXTRACT_TIMEOUT = 15_000 // 15s per page
const HAIKU_TIMEOUT = 10_000 // 10s per Haiku call
const CONCURRENCY = 5

// ---------------------------------------------------------------------------
// Haiku qualifier prompt (matches bot/qualifier.ts)
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

/**
 * Build a synthetic job description from scout metadata when the actual
 * JD page couldn't be loaded or parsed. This gives Haiku enough context
 * to make a basic qualification decision instead of auto-failing.
 */
function buildFallbackJD(job: DiscoveredJob): string {
  return [
    `Job Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.location || "Not specified"}`,
    ``,
    `NOTE: The full job description could not be extracted from the job page.`,
    `Please score based on the job title, company, and location above.`,
    `Give benefit of the doubt for missing information.`,
  ].join("\n")
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
    const { blockUnnecessaryResources } = await import("../bot/helpers")

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

      // Block images, CSS, fonts, media, and trackers — qualify only needs text (~70% bandwidth savings)
      await blockUnnecessaryResources(context, 'aggressive')

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
            let jdText: string
            try {
              jdText = await extractJobDescription(page, job.url)
            } catch {
              jdText = ""
            }

            // Fallback: if JD extraction failed or text is too short,
            // build a synthetic JD from scout metadata so Haiku can still score
            if (jdText.length < 50) {
              console.log(
                `[qualify-jobs] JD extraction failed for ${job.url} — using scout metadata fallback`,
              )
              jdText = buildFallbackJD(job)
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

            // Benefit of the doubt: instead of just recording an error,
            // create a partial qualification with score 35 so the user can
            // still review it. Only clearly irrelevant jobs should be auto-killed.
            const fallbackJob: QualifiedJob = {
              url: job.url,
              title: job.title,
              company: job.company,
              location: job.location,
              isEasyApply: job.isEasyApply,
              score: 35,
              isDesignRole: true, // assume yes based on scout filter
              seniorityMatch: false,
              locationCompatible: false,
              salaryInRange: true, // don't penalize unknown salary
              skillsMatch: false,
              matchReasons: [`Qualification error (${msg}) — needs manual review`],
              coverLetterSnippet: "",
              qualified: false, // 35 < 40 threshold — shows in disqualified but not errors
              error: msg,
            }
            disqualified.push(fallbackJob)
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
