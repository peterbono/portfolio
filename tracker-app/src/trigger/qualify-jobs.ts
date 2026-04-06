/**
 * qualify-jobs.ts — Trigger.dev task wrapper for job qualification
 *
 * This task runs in the Trigger.dev worker environment and handles:
 *   - Pass 1: Rules-based pre-filter (via qualifier.ts preQualify)
 *   - Pass 2: LLM scoring via Haiku (via shared qualifier-core.ts)
 *   - Browser-based JD extraction (Playwright)
 *   - Fallback JD construction from scout metadata
 *
 * The shared prompt/API/parsing logic lives in qualifier-core.ts.
 * This file only contains Trigger.dev task orchestration and browser logic.
 */

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

const MAX_JOBS_PER_RUN = 30
const QUALIFY_THRESHOLD = 40 // score >= 40 passes — let more jobs through for user review
const JD_EXTRACT_TIMEOUT = 15_000 // 15s per page
const CONCURRENCY = 5

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function extractJobDescription(
  page: import("playwright").Page,
  url: string,
): Promise<string> {
  // For LinkedIn job URLs, try the guest API endpoint first (simpler HTML)
  const linkedInJobIdMatch = url.match(/linkedin\.com\/jobs\/view\/(\d+)/)
  if (linkedInJobIdMatch) {
    try {
      const guestUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${linkedInJobIdMatch[1]}`
      console.log(`[qualify-jobs] Trying LinkedIn guest API for job ${linkedInJobIdMatch[1]}`)
      await page.goto(guestUrl, { waitUntil: "domcontentloaded", timeout: JD_EXTRACT_TIMEOUT })
      await page.waitForTimeout(1500)

      const guestSelectors = [
        '.show-more-less-html__markup',
        '.description__text',
        '.decorated-job-posting__details',
        'section.description',
      ]
      for (const sel of guestSelectors) {
        try {
          const el = await page.$(sel)
          if (el) {
            const text = await el.innerText()
            if (text && text.length > 100) {
              console.log(`[qualify-jobs] JD via LinkedIn guest API "${sel}" (${text.length} chars)`)
              return text.slice(0, 6000)
            }
          }
        } catch { /* try next */ }
      }
      const bodyText = await page.innerText("body").catch(() => "")
      if (bodyText.length > 100) {
        return bodyText.slice(0, 6000)
      }
    } catch (err) {
      console.warn(`[qualify-jobs] LinkedIn guest API failed: ${(err as Error).message}`)
    }
  }

  // Standard extraction for non-LinkedIn or fallback
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: JD_EXTRACT_TIMEOUT })
    await page.waitForTimeout(2000)

    const selectors = [
      '.show-more-less-html__markup',
      '.description__text',
      '#content',
      '.posting-page',
      '[data-ui="job-description"]',
      '.ashby-job-posting-brief-description',
      '[class*="job-description"]',
      '[class*="jobDescription"]',
      '[class*="posting-description"]',
      '[id*="job-description"]',
      'article',
      'main',
      'body',
    ]

    for (const selector of selectors) {
      try {
        const el = await page.$(selector)
        if (el) {
          const text = await el.innerText()
          if (text && text.length > 100) {
            return text.slice(0, 6000)
          }
        }
      } catch { /* try next */ }
    }

    const bodyText = await page.innerText("body").catch(() => "")
    return bodyText.slice(0, 6000)
  } catch (err) {
    throw new Error(`Failed to extract JD from ${url}: ${(err as Error).message}`)
  }
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
  const titleLower = job.title.toLowerCase()
  const locationLower = (job.location || "").toLowerCase()

  // Detect title quality signals
  const exactTitleMatch = /product designer|ux\/ui designer|ux designer|ui designer/i.test(job.title)
  const seniorMatch = /senior|sr\.?|lead|staff|principal|head of/i.test(job.title)
  const designSystemMatch = /design system|design ops/i.test(titleLower)
  const managerMatch = /design manager|creative director|head of design/i.test(titleLower)

  // Detect location/remote signals
  const apacSignal = /asia|apac|singapore|thailand|bangkok|india|australia|japan|korea|vietnam|indonesia|malaysia|philippines|hong kong|taiwan|remote|worldwide|global/i.test(locationLower)
  const dubaiSignal = /dubai|uae|middle east/i.test(locationLower)

  // Detect bonus keywords in title
  const bonusKeywords: string[] = []
  if (designSystemMatch) bonusKeywords.push("design systems")
  if (/saas|b2b|platform|enterprise/i.test(titleLower)) bonusKeywords.push("B2B/SaaS/Platform")
  if (/gaming|igaming/i.test(titleLower)) bonusKeywords.push("iGaming")
  if (/fintech|finance/i.test(titleLower)) bonusKeywords.push("fintech")

  // Build scoring guidance
  const hints: string[] = []
  if (exactTitleMatch && seniorMatch) {
    hints.push("STRONG TITLE MATCH: Senior-level design role — score at least 55-65.")
  } else if (exactTitleMatch) {
    hints.push("GOOD TITLE MATCH: Design role matching candidate specialization — score at least 50-60.")
  } else if (seniorMatch) {
    hints.push("SENIORITY MATCH: Senior-level role — score at least 45-55 if design-adjacent.")
  } else if (managerMatch) {
    hints.push("LEADERSHIP MATCH: Design leadership role — score at least 50-60.")
  }

  if (apacSignal || dubaiSignal) {
    hints.push("LOCATION COMPATIBLE: Location appears APAC-friendly or remote-compatible.")
  }

  if (bonusKeywords.length > 0) {
    hints.push(`BONUS KEYWORDS in title: ${bonusKeywords.join(", ")} — add +10-15 to score.`)
  }

  return [
    `Job Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.location || "Not specified"}`,
    `LinkedIn Easy Apply: ${job.isEasyApply ? "Yes" : "No"}`,
    ``,
    `NOTE: The full job description could not be extracted from the job page.`,
    `This is a METADATA-ONLY qualification. Score based on the title, company, and location above.`,
    ``,
    `SCORING GUIDANCE FOR PARTIAL DATA:`,
    `- Give STRONG benefit of the doubt for missing information.`,
    `- Missing JD = assume neutral/positive for all unknown dimensions.`,
    `- A "Product Designer" or "UX/UI Designer" title with no red flags should score 50+.`,
    `- A "Senior Product Designer" title should score 55-65 even without JD.`,
    `- Only score below 40 if the title is clearly wrong (graphic designer, intern, etc.)`,
    `- Set salaryInRange=true (unknown = benefit of doubt).`,
    `- Set skillsMatch=true for any design role (likely overlap).`,
    ...hints.map(h => `- ${h}`),
  ].join("\n")
}

// ---------------------------------------------------------------------------
// Trigger.dev task
// ---------------------------------------------------------------------------

export const qualifyJobsTask = task({
  id: "qualify-jobs",
  maxDuration: 600, // 10 min max — parallel batches make this faster but keep margin
  retry: {
    maxAttempts: 1, // Don't retry — costs Haiku tokens
  },
  run: async (payload: QualifyPayload): Promise<QualifyResult> => {
    // Dynamic imports — these resolve at runtime in the Trigger.dev worker
    const { chromium } = await import("playwright")
    const Anthropic = (await import("@anthropic-ai/sdk")).default
    const { blockUnnecessaryResources } = await import("../bot/helpers")
    const { preQualify, formatPreQualifyStats } = await import("../bot/qualifier")
    const { APPLICANT } = await import("../bot/types")

    // Import shared core functions — single source of truth for prompt + API call
    const {
      buildSystemPrompt,
      buildUserMessage,
      callHaikuQualifier,
      callHaikuQualifierBatch,
    } = await import("../bot/qualifier-core")

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
    const searchKeywords = (payload.searchConfig?.keywords) as string[] | undefined

    for (const job of payload.jobs) {
      const result = preQualify(
        { title: job.title, company: job.company, location: job.location, url: job.url },
        applicantForPreFilter,
        { excludedCompanies: excludedCompanies ?? null, keywords: searchKeywords ?? [] },
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
    const SBR_AUTH = (process.env.BRIGHTDATA_SBR_AUTH || '').trim() || undefined
    const browser = SBR_AUTH
      ? await chromium.connectOverCDP(`wss://${SBR_AUTH}@brd.superproxy.io:9222`)
      : await chromium.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        })

    console.log(`[qualify-jobs] Browser: ${SBR_AUTH ? "Bright Data" : "local Chromium"}`)

    // -----------------------------------------------------------------------
    // 2. Init Anthropic client (passed to shared core)
    // -----------------------------------------------------------------------
    const anthropic = new Anthropic() // reads ANTHROPIC_API_KEY from env

    // Build system prompt ONCE using the shared core function (no variant in Trigger path)
    const systemPrompt = buildSystemPrompt(payload.userProfile)

    // Build search context for user messages
    const searchContext = {
      keywords: searchKeywords ?? undefined,
      location: (payload.searchConfig?.location as string) ?? undefined,
      minSalary: ((payload.searchConfig?.min_salary ?? payload.searchConfig?.minSalary) as number) ?? undefined,
      remoteOnly: true as boolean | undefined,
    }

    // -----------------------------------------------------------------------
    // 3. Phase A: Extract JDs with concurrent browser workers
    // -----------------------------------------------------------------------
    const jdMap = new Map<string, string>() // url -> JD text
    const extractionErrors = new Map<string, string>() // url -> error message
    const queue = [...jobsToProcess]

    async function jdExtractWorker() {
      const context = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        ignoreHTTPSErrors: true,
      })

      // Block images, CSS, fonts, media, and trackers — qualify only needs text (~70% bandwidth savings)
      await blockUnnecessaryResources(context, 'aggressive')

      const page = await context.newPage()

      try {
        while (queue.length > 0) {
          const job = queue.shift()
          if (!job) break

          console.log(
            `[qualify-jobs] Extracting JD: ${job.company} — ${job.title} (${job.url})`,
          )

          try {
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

            jdMap.set(job.url, jdText)
          } catch (err) {
            const msg = (err as Error).message
            console.error(`[qualify-jobs] JD extraction error for ${job.url}: ${msg}`)
            extractionErrors.set(job.url, msg)
          }
        }
      } finally {
        await page.close().catch((err) => console.warn('[qualify-jobs] Cleanup failed:', err))
        await context.close().catch((err) => console.warn('[qualify-jobs] Cleanup failed:', err))
      }
    }

    try {
      const workerCount = Math.min(CONCURRENCY, jobsToProcess.length)
      const workers = Array.from({ length: workerCount }, () => jdExtractWorker())
      await Promise.all(workers)
    } finally {
      await browser.close()
    }

    console.log(`[qualify-jobs] JD extraction complete: ${jdMap.size} extracted, ${extractionErrors.size} failed`)

    // -----------------------------------------------------------------------
    // 3. Phase B: Qualify all extracted JDs via Anthropic Batch API (50% discount)
    // -----------------------------------------------------------------------
    const qualified: QualifiedJob[] = []
    const disqualified: QualifiedJob[] = []
    const errors: Array<{ url: string; error: string }> = []

    // Handle extraction errors — benefit of the doubt fallback
    for (const job of jobsToProcess) {
      if (extractionErrors.has(job.url)) {
        const msg = extractionErrors.get(job.url)!
        const titleLooksRelevant = /designer|design|ux|ui/i.test(job.title)
        const fallbackScore = titleLooksRelevant ? 42 : 25
        const fallbackJob: QualifiedJob = {
          url: job.url,
          title: job.title,
          company: job.company,
          location: job.location,
          isEasyApply: job.isEasyApply,
          score: fallbackScore,
          isDesignRole: titleLooksRelevant,
          seniorityMatch: /senior|sr\.?|lead|staff|principal|head/i.test(job.title),
          locationCompatible: false,
          salaryInRange: true,
          skillsMatch: titleLooksRelevant,
          matchReasons: [`JD extraction error (${msg}) — needs manual review`],
          coverLetterSnippet: "",
          qualified: fallbackScore >= QUALIFY_THRESHOLD,
          error: msg,
        }
        if (fallbackJob.qualified) {
          qualified.push(fallbackJob)
        } else {
          disqualified.push(fallbackJob)
        }
      }
    }

    // Build batch requests for all successfully extracted JDs
    const batchRequests = jobsToProcess
      .filter((job) => jdMap.has(job.url))
      .map((job) => ({
        id: job.url,
        systemPrompt,
        userMessage: buildUserMessage(jdMap.get(job.url)!, searchContext),
      }))

    if (batchRequests.length > 0) {
      console.log(`[qualify-jobs] Sending ${batchRequests.length} jobs to Haiku Batch API (50% token discount)`)

      let batchResults: Map<string, Awaited<ReturnType<typeof callHaikuQualifier>>>

      try {
        batchResults = await callHaikuQualifierBatch(
          batchRequests,
          {
            pollIntervalMs: 5_000,
            timeoutMs: 300_000, // 5 min
            maxTokens: 800,
            fallbackToIndividual: true, // auto-fallback if batch API fails
          },
          anthropic,
        )
      } catch (batchErr) {
        // Last-resort: if even the fallback in callHaikuQualifierBatch fails,
        // we still have the option to try individually here
        console.error(`[qualify-jobs] Batch qualification completely failed: ${(batchErr as Error).message}`)
        batchResults = new Map()
      }

      // Process batch results
      for (const job of jobsToProcess) {
        // Skip jobs that already got a fallback from extraction errors
        if (extractionErrors.has(job.url)) continue

        const result = batchResults.get(job.url)

        if (result) {
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
        } else {
          // Batch didn't return a result for this job — benefit of the doubt
          const titleLooksRelevant = /designer|design|ux|ui/i.test(job.title)
          const fallbackScore = titleLooksRelevant ? 42 : 25
          const fallbackJob: QualifiedJob = {
            url: job.url,
            title: job.title,
            company: job.company,
            location: job.location,
            isEasyApply: job.isEasyApply,
            score: fallbackScore,
            isDesignRole: titleLooksRelevant,
            seniorityMatch: /senior|sr\.?|lead|staff|principal|head/i.test(job.title),
            locationCompatible: false,
            salaryInRange: true,
            skillsMatch: titleLooksRelevant,
            matchReasons: ["Batch qualification missing — needs manual review"],
            coverLetterSnippet: "",
            qualified: fallbackScore >= QUALIFY_THRESHOLD,
            error: "No result from batch API",
          }
          if (fallbackJob.qualified) {
            qualified.push(fallbackJob)
          } else {
            disqualified.push(fallbackJob)
          }
        }
      }
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
