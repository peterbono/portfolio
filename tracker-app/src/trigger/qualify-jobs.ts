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
  const education = userProfile.education ?? 'Master UX Design, ESD (Ecole Superieure du Digital), RNCP niveau 7'

  // Extract enriched profile data if available (from APPLICANT in types.ts)
  const achievements = userProfile.achievements as Array<{ metric: string; context: string; relevantWhen: string[] }> | undefined
  const keyProjects = userProfile.keyProjects as Array<{ name: string; role: string; outcome: string; skills: string[] }> | undefined
  const industryWins = userProfile.industryWins as Record<string, string> | undefined
  const toolMastery = userProfile.toolMastery as Array<{ name: string; proficiency: string; context: string }> | undefined

  // Format achievements
  const achievementsList = achievements?.length
    ? achievements.map((a, i) => `  ${i + 1}. ${a.metric}\n     Context: ${a.context}\n     Best for JDs mentioning: ${a.relevantWhen.join(', ')}`).join('\n')
    : `  1. Built the #1 US online poker product (PokerStars MI/NJ) end-to-end — regulated iGaming, 0-to-1
  2. 90% improvement in developer-designer feedback loop — Storybook-driven specs, Zeroheight docs, Figma-to-code validation
  3. Managed 143 production component templates across 7 SaaS products — multi-product design system governance
  4. Designed biometric verification flows for 50+ airport checkpoints (IDEMIA) — security-critical, sub-3s processing UX
  5. Shipped design system 0-to-1 with full Figma-Storybook-Zeroheight pipeline — tokens consumed by 3 frontend teams
  6. Led UX research program with 30+ Maze studies — 40% reduction in post-launch redesign cycles`

  // Format key projects
  const projectsList = keyProjects?.length
    ? keyProjects.map(p => `  - ${p.name} (${p.role}): ${p.outcome}\n    Skills: ${p.skills.join(', ')}`).join('\n')
    : `  - PokerStars MI/NJ (Lead Product Designer): #1 US poker product, passed regulatory audits first submission
  - ClickOut Media Design System (Senior DS Lead): 143 components, 7 products, 90% dev feedback improvement
  - IDEMIA Airport Biometrics (UX/UI Designer): 50+ airport checkpoints, sub-3s processing UX
  - Continuous Discovery Program (UX Research Lead): 30+ Maze studies, 40% less post-launch redesign`

  // Format industry wins
  const industryWinsList = industryWins
    ? Object.entries(industryWins).map(([k, v]) => `  - ${k}: ${v}`).join('\n')
    : `  - igaming: Built #1 US poker product, deep regulatory compliance and responsible gaming UX
  - b2b_saas: 143 templates across 7 products, multi-product consistency expert
  - biometric_security: Airport biometric verification for 50+ checkpoints at IDEMIA
  - fintech: Regulated product experience (KYC, AML, compliance) transferable from iGaming`

  // Format tool mastery
  const toolsList = toolMastery?.length
    ? toolMastery.map(t => `  - ${t.name} [${t.proficiency}]: ${t.context}`).join('\n')
    : `  - Figma [expert]: 5+ years daily, auto-layout, variants, component properties, Dev Mode, design tokens
  - Storybook [expert]: 3 production design systems, interactive docs, CI/CD integration
  - Zeroheight [advanced]: Published design guidelines for multi-team consumption
  - Maze [advanced]: 30+ unmoderated studies, mission-based testing, quantitative analysis
  - Jira [advanced]: Design backlogs, sprint planning, cross-functional workflows`

  return `You are a job qualification engine for an automated job search tool.
Your TWO jobs: (1) score the job fit accurately, (2) write a cover letter snippet that sounds like a real human who READ this specific JD and knows their own resume deeply.

═══════════════════════════════════════════════
CANDIDATE PROFILE — ${firstName} ${lastName}
═══════════════════════════════════════════════

BASICS:
- Current role: Senior Product Designer (${yearsExp}+ years)
- Specialization: Design Systems, Design Ops, Complex Product Architecture
- Location: ${location} (${timezone})
- Acceptable TZ: UTC+3 to UTC+11 (4h max difference from Bangkok)
- Work mode: P1 Remote APAC, P2 On-site Philippines/Thailand, P3 Remote within TZ range
- Min compensation: 70k EUR/yr (on-site) or 80k EUR/yr (remote freelance)
- Languages: French (native), English (bilingual)
- Education: ${education}
- Portfolio: ${portfolio}

KEY ACHIEVEMENTS (use these in cover letter — pick the most relevant to the JD):
${achievementsList}

KEY PROJECTS (reference by name when relevant):
${projectsList}

INDUSTRY-SPECIFIC WINS (match to the JD's industry):
${industryWinsList}

TOOL MASTERY (match to JD's required tools):
${toolsList}

BLACKLISTED:
- Companies: BetRivers, Rush Street Interactive, ClickOut Media
- Industries: poker, unregulated gambling
- Seniority: intern, junior, associate (too junior for ${yearsExp}+ years)

═══════════════════════════════════════════════
SCORING (0-100)
═══════════════════════════════════════════════

First check HARD REQUIREMENTS. If ANY fail, return score 0.
If all pass, score on 0-100 starting from base 40:

- Role fit (0-25): Title + JD alignment with "Senior Product Designer" / design systems / design ops / complex product architecture. Exact match=25, close match=20, adjacent=12, weak=5.
- Industry match (0-15): B2B SaaS=high, regulated industries=high, consumer app=medium, crypto/unregulated gambling=low. Unknown=8.
- Skill overlap (0-20): How many key skills appear in JD? 5+=20, 3-4=15, 1-2=10, none mentioned=8.
- Remote/location fit (0-15): Remote APAC=15, remote global async=12, hybrid SEA=10, on-site SEA=8, remote EU=3, US TZ only=0, unknown=10.
- Compensation signal (0-10): In range (>=70k EUR)=10, no info=5, low signal=0.
- Growth opportunity (0-15): Design system work=high, leadership=high, complex products=high, regulated=high. Generic=5, unknown=7.

IMPORTANT: Missing info = partial points (benefit of the doubt), never 0. "Senior Product Designer" with no red flags = 65+ minimum. No salary listed = 5/10. "Remote" without TZ info = 10/15.

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
      max_tokens: 800,
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
