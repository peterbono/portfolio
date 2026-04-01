import { task, metadata } from "@trigger.dev/sdk/v3"

export const applyJobTask = task({
  id: "apply-job-pipeline",
  maxDuration: 1800, // 30 minutes — multi-source scout + qualify + SBR reconnect overhead
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

    // ---- Set initial metadata for live progress polling ----
    metadata.set("progress", {
      phase: "starting",
      jobsFound: 0,
      jobsProcessed: 0,
      jobsQualified: 0,
      jobsPreFiltered: 0,
      currentJob: null,
      activities: [{
        action: "found",
        reason: `Keywords: ${config.keywords.join(', ')}`,
        timestamp: new Date().toISOString(),
      }, {
        action: "found",
        reason: `Profile: Search from dashboard, max: ${payload.maxApplications ?? 20}, dryRun: ${payload.dryRun ?? false}`,
        timestamp: new Date().toISOString(),
      }],
    })

    // Bright Data blocks ALL LinkedIn cookie injection (Storage + Network).
    // Strategy: use Bright Data for scouting (public LinkedIn job search
    // doesn't require auth). Use local Chromium + cookie for Easy Apply.
    const SBR_AUTH = (process.env.BRIGHTDATA_SBR_AUTH || '').trim() || undefined

    // SBR connectOverCDP can hang indefinitely OR return a zombie browser.
    // Strategy: 30s connect timeout + health check (newContext + close) + local fallback.
    const LOCAL_ARGS = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
    let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>>
    let usingSBR = false

    const launchLocal = async () => {
      console.log('[apply-job] Launching local Chromium')
      return await chromium.launch({ headless: true, args: LOCAL_ARGS })
    }

    if (SBR_AUTH) {
      try {
        const sbrBrowser = await Promise.race([
          chromium.connectOverCDP(`wss://${SBR_AUTH}@brd.superproxy.io:9222`),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('SBR connection timeout (30s)')), 30_000)
          ),
        ])
        // Health check: verify browser is actually responsive (not a zombie CDP session)
        const testCtx = await Promise.race([
          sbrBrowser.newContext(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('SBR health check timeout (10s)')), 10_000)
          ),
        ])
        await testCtx.close()
        browser = sbrBrowser
        usingSBR = true
        console.log('[apply-job] Connected to Bright Data SBR (health check passed)')
      } catch (sbrErr) {
        console.warn(`[apply-job] SBR failed: ${(sbrErr as Error).message} — falling back to local Chromium`)
        browser = await launchLocal() as unknown as typeof browser
      }
    } else {
      browser = await launchLocal() as unknown as typeof browser
    }

    // No cookie injection on Bright Data — scout uses public LinkedIn search
    // The linkedInCookie will be used later for Easy Apply via local Chromium
    let browserContext: Awaited<ReturnType<typeof browser.newContext>> | undefined
    console.log(`[apply-job] Using ${usingSBR ? 'Bright Data' : 'local Chromium'}, cookie: ${payload.linkedInCookie ? 'provided' : 'none'}`)

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
        // ---- Progress callback for live metadata updates ----
        onProgress: (progress) => {
          try {
            metadata.set("progress", progress)
          } catch {
            // metadata API may fail in edge cases — don't crash the pipeline
          }
        },
      })

      return {
        runId: result.runId,
        jobsFound: result.jobsFound,
        jobsPreFiltered: (result.jobsFound ?? 0) - (result.jobsQualified ?? 0),
        jobsQualified: result.jobsQualified,
        jobsApplied: result.jobsApplied,
        jobsSkipped: result.jobsSkipped,
        jobsFailed: result.jobsFailed,
        duration: result.duration,
        discoveredJobs: result.discoveredJobs ?? [],
        qualifiedJobs: result.qualifiedJobs ?? [],
      }
    } finally {
      if (browserContext) {
        await browserContext.close().catch(() => {})
      }
      await browser.close()
    }
  },
})
