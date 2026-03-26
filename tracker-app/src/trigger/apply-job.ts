import { task } from "@trigger.dev/sdk/v3"

export const applyJobTask = task({
  id: "apply-job-pipeline",
  maxDuration: 1800,
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

    // Use Bright Data for fast LinkedIn access with residential IPs.
    // Cookie injection via CDP Network.setCookie (bypasses Bright Data's
    // Storage.setCookies block).
    const SBR_AUTH = process.env.BRIGHTDATA_SBR_AUTH
    const browser = SBR_AUTH
      ? await chromium.connectOverCDP(`wss://${SBR_AUTH}@brd.superproxy.io:9222`)
      : await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] })

    let browserContext
    if (payload.linkedInCookie) {
      browserContext = await browser.newContext()
      // Use CDP protocol directly to set the cookie (bypasses Playwright's
      // Storage.setCookies which Bright Data blocks)
      const page = await browserContext.newPage()
      const cdpSession = await page.context().newCDPSession(page)
      await cdpSession.send('Network.setCookie', {
        name: 'li_at',
        value: payload.linkedInCookie,
        domain: '.linkedin.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'None',
      })
      await page.close()
      console.log('[apply-job] LinkedIn cookie injected via CDP Network.setCookie')
    }

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
