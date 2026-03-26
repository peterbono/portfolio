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

    // Use Bright Data if available (residential IPs, anti-detection)
    const SBR_AUTH = process.env.BRIGHTDATA_SBR_AUTH
    const useBrightData = !!SBR_AUTH // always use if configured

    const browser = useBrightData
      ? await chromium.connectOverCDP(`wss://${SBR_AUTH}@brd.superproxy.io:9222`)
      : await chromium.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        })

    // If a LinkedIn session cookie was provided, create a context and
    // inject the cookie. Try addCookies first; if blocked (Bright Data
    // forbids overriding li_at), fall back to JavaScript injection.
    let browserContext
    if (payload.linkedInCookie) {
      browserContext = await browser.newContext()
      try {
        await browserContext.addCookies([{
          name: 'li_at',
          value: payload.linkedInCookie,
          domain: '.linkedin.com',
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'None' as const,
        }])
      } catch (cookieErr) {
        console.log('[apply-job] addCookies blocked, using JS injection fallback')
        // Navigate to LinkedIn first, then inject cookie via JS
        const tempPage = await browserContext.newPage()
        await tempPage.goto('https://www.linkedin.com', { waitUntil: 'domcontentloaded', timeout: 30000 })
        await tempPage.evaluate((cookieVal) => {
          document.cookie = `li_at=${cookieVal}; domain=.linkedin.com; path=/; secure; SameSite=None; max-age=31536000`
        }, payload.linkedInCookie)
        await tempPage.close()
      }
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
