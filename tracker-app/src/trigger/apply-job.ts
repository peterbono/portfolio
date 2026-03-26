import { task } from "@trigger.dev/sdk/v3"

export const applyJobTask = task({
  id: "apply-job-pipeline",
  maxDuration: 180, // 3 minutes max — prevents runaway costs
  run: async (payload: {
    userId: string
    maxApplications?: number
    dryRun?: boolean
    plan?: 'free' | 'starter' | 'pro' | 'boost'
    linkedInCookie?: string
    searchConfig?: {
      keywords: string[]
      locationRules: Array<{
        type: string
        value: string
        workArrangement: string
        minSalary?: number
        currency?: string
      }>
      excludedCompanies: string[]
      dailyLimit: number
    }
    userProfile?: Record<string, unknown>
  }) => {
    const { runPipelineFromInline } = await import("../bot/orchestrator")
    const { chromium } = await import("playwright")

    // Validate search config
    const config = payload.searchConfig
    if (!config || !config.keywords || config.keywords.length === 0) {
      throw new Error("No search config provided. Set up keywords in Autopilot first.")
    }

    // Bright Data blocks ALL LinkedIn cookie injection (Storage + Network).
    // Strategy: use Bright Data for scouting (public LinkedIn job search
    // doesn't require auth). Use local Chromium + cookie for Easy Apply.
    const SBR_AUTH = process.env.BRIGHTDATA_SBR_AUTH
    const browser = SBR_AUTH
      ? await chromium.connectOverCDP(`wss://${SBR_AUTH}@brd.superproxy.io:9222`)
      : await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] })

    // No cookie injection on Bright Data — scout uses public LinkedIn search
    // The linkedInCookie will be used later for Easy Apply via local Chromium
    let browserContext: Awaited<ReturnType<typeof browser.newContext>> | undefined
    console.log(`[apply-job] Using ${SBR_AUTH ? 'Bright Data' : 'local Chromium'}, cookie: ${payload.linkedInCookie ? 'provided' : 'none'}`)

    try {
      const result = await runPipelineFromInline({
        userId: payload.userId,
        browser,
        browserContext, // pre-authenticated LinkedIn context (if cookie provided)
        searchConfig: {
          keywords: config.keywords,
          locationRules: config.locationRules || [],
          excludedCompanies: config.excludedCompanies || [],
          dailyLimit: config.dailyLimit || 15,
        },
        userProfile: payload.userProfile || {},
        maxApplications: payload.maxApplications ?? 20,
        dryRun: payload.dryRun ?? false,
      })

      return {
        runId: result.runId,
        jobsFound: result.jobsFound,
        jobsQualified: result.jobsQualified,
        jobsApplied: result.jobsApplied,
        jobsSkipped: result.jobsSkipped,
        jobsFailed: result.jobsFailed,
        duration: result.duration,
      }
    } finally {
      if (browserContext) {
        await browserContext.close().catch(() => {})
      }
      await browser.close()
    }
  },
})
