import { task } from "@trigger.dev/sdk/v3"

/**
 * Trigger.dev task that runs the bot application pipeline.
 *
 * This is a SERVER-SIDE task — it runs in the Trigger.dev runtime,
 * not in the browser/Vite bundle. It dynamically imports the
 * orchestrator which depends on Playwright (server-only).
 */
export const applyJobTask = task({
  id: "apply-job-pipeline",
  // Browser automation can take a long time — allow up to 30 minutes
  maxDuration: 1800,
  run: async (payload: {
    userId: string
    searchProfileId?: string
    maxApplications?: number
    dryRun?: boolean
    plan?: 'free' | 'starter' | 'pro' | 'boost'
  }) => {
    // Dynamic import — orchestrator depends on Playwright which is server-only
    const { runPipelineForUser } = await import("../bot/orchestrator")
    const { chromium } = await import("playwright")

    // Bright Data Scraping Browser: only for PAID users (residential IPs, anti-detection, CAPTCHA)
    // Free users get local Chromium (no anti-detection — works for direct ATS, not LinkedIn)
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
      const result = await runPipelineForUser(payload.userId, browser, {
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
