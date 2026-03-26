import { task } from "@trigger.dev/sdk/v3"

export const applyJobTask = task({
  id: "apply-job-pipeline",
  maxDuration: 1800,
  run: async (payload: {
    userId: string
    maxApplications?: number
    dryRun?: boolean
    plan?: 'free' | 'starter' | 'pro' | 'boost'
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

    // Bright Data for paid users, local Chromium for free
    const SBR_AUTH = process.env.BRIGHTDATA_SBR_AUTH
    const isPaid = payload.plan && payload.plan !== 'free'
    const useBrightData = SBR_AUTH && isPaid

    const browser = useBrightData
      ? await chromium.connectOverCDP(`wss://${SBR_AUTH}@brd.superproxy.io:9222`)
      : await chromium.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        })

    try {
      const result = await runPipelineFromInline({
        userId: payload.userId,
        browser,
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
      await browser.close()
    }
  },
})
