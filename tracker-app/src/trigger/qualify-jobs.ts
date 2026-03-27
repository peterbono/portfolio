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
  preFilterReason?: string // set if eliminated by rules-based pre-filter (Pass 1)
}

interface QualifyPayload {
  userId: string
  jobs: DiscoveredJob[]
  userProfile: Record<string, unknown>
  searchConfig: Record<string, unknown>
}

interface PreFilterStats {
  total: number
  passed: number
  filtered: number
  breakdown: Record<string, number>
}

interface QualifyResult {
  qualified: QualifiedJob[]
  disqualified: QualifiedJob[]
  preFiltered: QualifiedJob[] // jobs eliminated by rules-based Pass 1 (score 0, no API cost)
  preFilterStats: PreFilterStats
  errors: Array<{ url: string; error: string }>
  totalProcessed: number
  totalQualified: number
  totalPreFiltered: number
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
// Haiku qualifier prompt — dynamic, injects user profile for accuracy
// ---------------------------------------------------------------------------

function buildSystemPrompt(userProfile: Record<string, unknown>): string {
  const firstName = userProfile.firstName ?? 'Florian'
  const lastName = userProfile.lastName ?? 'Gouloubi'
  const yearsExp = userProfile.yearsExperience ?? 7
  const location = userProfile.location ?? 'Bangkok, Thailand'
  const timezone = userProfile.timezone ?? 'GMT+7'
  const portfolio = userProfile.portfolio ?? 'https://www.floriangouloubi.com'

  return `You are a job qualification engine for an automated job search tool.

CANDIDATE PROFILE:
- Name: ${firstName} ${lastName}
- Current role: Senior Product Designer
- Specialization: Design Systems, Design Ops, Complex Product Architecture
- Experience: ${yearsExp}+ years
- Industries: iGaming (regulated), B2B SaaS, affiliate/SEO media, biometric security, public sector, aviation
- Key skills: Figma, Storybook, Zeroheight, design systems governance, complex information architecture, user research, Jira, Maze, Rive
- Location: ${location} (${timezone})
- Acceptable timezone range: UTC+3 to UTC+11 (4h max difference)
- Work mode: P1 Remote APAC, P2 On-site Philippines/Thailand, P3 Remote within TZ range
- Minimum compensation: 70k EUR/year (on-site) or 80k EUR/year (remote freelance)
- Languages: French (native), English (bilingual)
- Portfolio: ${portfolio}

BLACKLISTED:
- Companies: BetRivers, Rush Street Interactive, ClickOut Media
- Industries: poker, unregulated gambling
- Seniority: intern, junior, associate (too junior for ${yearsExp}+ years)

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
  userProfile: Record<string, unknown>,
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

  // Build dynamic system prompt with actual user profile
  const systemPrompt = buildSystemPrompt(userProfile)

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
      system: systemPrompt,
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
    const { preQualify, formatPreQualifyStats } = await import("../bot/qualifier")
    const { APPLICANT } = await import("../bot/types")

    console.log(`[qualify-jobs] Starting qualification of ${payload.jobs.length} jobs`)

    // -----------------------------------------------------------------------
    // PASS 1: Rules-based pre-filter (instant, $0 cost)
    // Eliminates obviously bad matches before any API call or browser launch.
    // -----------------------------------------------------------------------
    const preFiltered: QualifiedJob[] = []
    const passSurvivors: DiscoveredJob[] = []
    const preFilterBreakdown: Record<string, number> = {}

    // Build the applicant profile for preQualify — use payload.userProfile or defaults
    const applicantForPreFilter = {
      ...APPLICANT,
      ...(payload.userProfile as Record<string, unknown>),
      yearsExperience: (payload.userProfile?.yearsExperience as number) ?? APPLICANT.yearsExperience,
    }

    // Build search config for preQualify
    const excludedCompanies = (payload.searchConfig?.excludedCompanies ??
      payload.searchConfig?.excluded_companies) as string[] | undefined

    for (const job of payload.jobs) {
      const result = preQualify(
        { title: job.title, company: job.company, location: job.location, url: job.url },
        applicantForPreFilter,
        { excludedCompanies: excludedCompanies ?? null },
      )

      if (result.pass) {
        passSurvivors.push(job)
      } else {
        // Record as pre-filtered with score 0 — no API cost
        preFiltered.push({
          url: job.url,
          title: job.title,
          company: job.company,
          location: job.location,
          isEasyApply: job.isEasyApply,
          score: 0,
          isDesignRole: false,
          seniorityMatch: false,
          locationCompatible: false,
          salaryInRange: false,
          skillsMatch: false,
          matchReasons: [],
          coverLetterSnippet: "",
          qualified: false,
          preFilterReason: result.reason,
        })
        if (result.rule) {
          preFilterBreakdown[result.rule] = (preFilterBreakdown[result.rule] ?? 0) + 1
        }
      }
    }

    const preFilterStats: PreFilterStats = {
      total: payload.jobs.length,
      passed: passSurvivors.length,
      filtered: preFiltered.length,
      breakdown: preFilterBreakdown,
    }

    console.log(
      `[qualify-jobs] ${formatPreQualifyStats({
        total: preFilterStats.total,
        passed: preFilterStats.passed,
        filtered: preFilterStats.filtered,
        breakdown: preFilterStats.breakdown,
      })}`,
    )

    // If everything was pre-filtered, return early — no need to launch browser or Haiku
    if (passSurvivors.length === 0) {
      console.log("[qualify-jobs] All jobs eliminated by pre-filter. No Haiku calls needed.")
      return {
        qualified: [],
        disqualified: [],
        preFiltered,
        preFilterStats,
        errors: [],
        totalProcessed: payload.jobs.length,
        totalQualified: 0,
        totalPreFiltered: preFiltered.length,
        costEstimate: 0,
      }
    }

    // -----------------------------------------------------------------------
    // PASS 2: LLM scoring (only on Pass 1 survivors)
    // -----------------------------------------------------------------------

    // Cap survivors to process (save API cost)
    const jobsToProcess = passSurvivors.slice(0, MAX_JOBS_PER_RUN)
    if (passSurvivors.length > MAX_JOBS_PER_RUN) {
      console.log(
        `[qualify-jobs] Capped at ${MAX_JOBS_PER_RUN} jobs for Haiku (${passSurvivors.length} passed pre-filter)`,
      )
    }

    console.log(`[qualify-jobs] Pass 2: Sending ${jobsToProcess.length} jobs to Haiku for LLM scoring`)

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

            // Call Haiku to qualify (Pass 2: LLM scoring on survivors only)
            const result = await callHaikuQualifier(
              anthropic,
              jdText,
              payload.searchConfig,
              payload.userProfile,
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
    // 4. Return results (Pass 1 pre-filter + Pass 2 LLM scoring)
    // -----------------------------------------------------------------------
    const totalProcessed = preFiltered.length + qualified.length + disqualified.length + errors.length
    const costEstimate = (qualified.length + disqualified.length) * 0.003
    const costSaved = preFiltered.length * 0.003

    console.log(
      `[qualify-jobs] Done. ${qualified.length} qualified, ${disqualified.length} disqualified, ` +
      `${preFiltered.length} pre-filtered, ${errors.length} errors. ` +
      `Cost: ~$${costEstimate.toFixed(3)} (saved ~$${costSaved.toFixed(3)} from pre-filter)`,
    )

    return {
      qualified,
      disqualified,
      preFiltered,
      preFilterStats,
      errors,
      totalProcessed,
      totalQualified: qualified.length,
      totalPreFiltered: preFiltered.length,
      costEstimate,
    }
  },
})
