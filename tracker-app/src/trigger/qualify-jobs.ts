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

  // Format achievements — include company name for anti-hallucination
  const achievementsList = achievements?.length
    ? achievements.map((a, i) => {
        const company = (a as { company?: string }).company ? `[${(a as { company?: string }).company}] ` : ''
        return `  ${i + 1}. ${company}${a.metric}\n     Context: ${a.context}\n     Best for JDs mentioning: ${a.relevantWhen.join(', ')}`
      }).join('\n')
    : `  1. [Rush Street Interactive] At Rush Street Interactive: Built the #1 US online poker product (BetRivers Poker) end-to-end — regulated iGaming, 0-to-1
  2. [Rush Street Interactive] At Rush Street Interactive: 90% improvement in developer-designer feedback loop on the design system — Storybook-driven specs, Zeroheight docs, Figma-to-code validation
  3. [Pernod Ricard] At Pernod Ricard: Governed 143 component templates across 7 B2B SaaS products — multi-product design system governance
  4. [IDEMIA] At IDEMIA: Designed biometric verification flows for 50+ airport checkpoints — security-critical, sub-3s processing UX
  5. [ClickOut Media] At ClickOut Media: Shipped design system 0-to-1 with full Figma-Storybook-Zeroheight pipeline — tokens consumed by 3 frontend teams
  6. [ClickOut Media] At ClickOut Media: Led UX research program with 30+ Maze studies — 40% reduction in post-launch redesign cycles`

  // Format key projects
  const projectsList = keyProjects?.length
    ? keyProjects.map(p => `  - ${p.name} (${p.role}): ${p.outcome}\n    Skills: ${p.skills.join(', ')}`).join('\n')
    : `  - BetRivers Poker at Rush Street Interactive (Senior Product Designer): #1 US poker product, passed regulatory audits first submission
  - Pernod Ricard Multi-Product Design System (UX/UI Designer): 143 component templates across 7 B2B SaaS products, global deployment
  - ClickOut Media Design System & Design Ops (Senior Product Designer): 0-to-1 design system, 90% dev feedback improvement, 30+ Maze studies
  - IDEMIA Airport Biometrics (UX Designer): 50+ airport checkpoints, sub-3s processing UX`

  // Format industry wins
  const industryWinsList = industryWins
    ? Object.entries(industryWins).map(([k, v]) => `  - ${k}: ${v}`).join('\n')
    : `  - igaming: At Rush Street Interactive — Built #1 US poker product (BetRivers Poker), deep regulatory compliance and responsible gaming UX
  - b2b_saas: At Pernod Ricard — 143 templates across 7 B2B SaaS products, multi-product consistency expert
  - biometric_security: At IDEMIA — Airport biometric verification for 50+ checkpoints
  - affiliate_seo: At ClickOut Media — Design system from 0-to-1, design ops, SEO-optimized affiliate platforms
  - fintech: At Rush Street Interactive — Regulated product experience (KYC, AML, compliance) transferable from iGaming`

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

CRITICAL ANTI-HALLUCINATION RULE:
When citing the applicant's achievements, you MUST use the EXACT company name listed in the [brackets] with each achievement above. NEVER attribute an achievement to a different company. NEVER invent product names (e.g. do NOT say "PokerStars" — the product is "BetRivers Poker" at Rush Street Interactive). The 143 templates across 7 B2B SaaS products was at PERNOD RICARD, NOT ClickOut Media. The 90% dev feedback improvement was at RUSH STREET INTERACTIVE, NOT ClickOut Media. If unsure which achievement fits a JD, use a generic statement instead of risking a wrong company attribution.

Write 2-3 sentences that pass the "would a human write this?" test. Rules:

1. REFERENCE A SPECIFIC DETAIL FROM THE JD: name the company, mention their product/tech/team/mission, quote something they said. NOT "your team" or "this role" — use the ACTUAL company name and what they do.

2. CONNECT TO A SPECIFIC ACHIEVEMENT: don't say "7+ years of experience" or "design systems expertise." Instead, pick the MOST RELEVANT achievement from the list above and cite it concretely — ALWAYS using the correct company name from the achievement. Examples:
   - BAD: "I have extensive experience with design systems"
   - GOOD: "At Pernod Ricard, I governed 143 component templates across 7 B2B SaaS products — the kind of multi-product consistency challenge [Company] faces with [their specific product]"
   - BAD: "I bring strong product design skills"
   - GOOD: "Building BetRivers Poker at Rush Street Interactive from 0-to-1 taught me how to ship complex products under compliance constraints, which directly applies to [Company]'s [specific challenge from JD]"

3. ADD A "WHY THIS COMPANY" ANGLE: show you understand what makes them different. Reference their industry, product, mission, or growth stage. If the JD mentions specific projects, teams, or technologies — name them.

4. NEVER use these generic phrases: "passionate about", "I believe", "excited to bring", "align with my experience", "I am confident", "I look forward to". Write like a peer, not a cover letter bot.

5. NEVER invent or substitute product/company names. Use ONLY: "BetRivers Poker" (NOT PokerStars), "Rush Street Interactive" (NOT BetRivers alone for company), "Pernod Ricard" (for 143 templates/7 SaaS products), "ClickOut Media" (for 0-to-1 design system, Maze studies), "IDEMIA" (for biometric/airport).

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
 *
 * The synthetic JD includes title-based scoring hints so Haiku can
 * still produce a meaningful score (40-65 range) instead of 0.
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
            // create a partial qualification with score 42 so the user can
            // still review it. Score is above QUALIFY_THRESHOLD (40) so
            // errored design-role jobs appear in the qualified list for manual review.
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
              salaryInRange: true, // don't penalize unknown salary
              skillsMatch: titleLooksRelevant,
              matchReasons: [`Qualification error (${msg}) — needs manual review`],
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
