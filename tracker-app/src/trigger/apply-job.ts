import { task, metadata, tasks } from "@trigger.dev/sdk/v3"
import { classifyJobUrl } from "../lib/classify-job-url"

export const applyJobTask = task({
  id: "apply-job-pipeline",
  machine: "large-1x", // 4 vCPU, 8 GB RAM — needed for 86+ JD extractions with local Chromium
  maxDuration: 1800, // 30 minutes — multi-source scout + qualify + SBR reconnect overhead
  run: async (payload: {
    userId: string
    maxApplications?: number
    dryRun?: boolean
    plan?: 'free' | 'starter' | 'pro' | 'boost'
    linkedInCookie?: string
    gmailAccessToken?: string
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
    autoApply?: boolean // If true (default), automatically trigger apply-jobs after qualify
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

      // ---------- Auto-Apply Phase ----------
      // After scout+qualify, automatically trigger apply-jobs with qualified jobs
      // unless dryRun is true or autoApply is explicitly false
      const autoApply = payload.autoApply !== false && !payload.dryRun
      const qualifiedJobs = result.qualifiedJobs ?? []

      let applyResult: { applied: number; failed: number; needsManual: number } = {
        applied: 0, failed: 0, needsManual: 0
      }

      if (autoApply && qualifiedJobs.length > 0) {
        console.log(`[apply-job-pipeline] Auto-applying to ${qualifiedJobs.length} qualified jobs...`)

        try {
          metadata.set("progress", {
            phase: "apply",
            jobsFound: result.jobsFound,
            jobsProcessed: 0,
            jobsQualified: qualifiedJobs.length,
            jobsPreFiltered: 0,
            currentJob: null,
            activities: [{
              action: "found",
              reason: `Starting auto-apply for ${qualifiedJobs.length} qualified jobs`,
              timestamp: new Date().toISOString(),
            }],
          })

          // Sort qualified jobs by ATS priority.
          // Post-migration focus (April 2026): Greenhouse + LinkedIn Easy Apply
          // are the only reliably-working auto-apply targets. Every other ATS
          // (Lever, Workable, Teamtailor, Breezy, SmartRecruiters) is broken
          // and deprioritized to 50 so they sort LAST but still surface in case
          // a user wants to review them manually. Ashby stays at 99 (never).
          const ATS_PRIORITY: Record<string, number> = {
            greenhouse: 1,
            linkedin: 2,
            // Deprioritized — auto-apply currently broken, kept low so they surface last
            // in case a user wants to manually review them.
            lever: 50,
            workable: 50,
            teamtailor: 50,
            breezy: 50,
            smartrecruiters: 50,
            ashby: 99,
          }
          qualifiedJobs.sort((a, b) => {
            const pa = ATS_PRIORITY[a.ats ?? ''] ?? 6
            const pb = ATS_PRIORITY[b.ats ?? ''] ?? 6
            if (pa !== pb) return pa - pb
            return (b.score ?? 0) - (a.score ?? 0)
          })

          // Filter out LinkedIn Easy Apply jobs — they MUST run locally via the Chrome
          // extension (LinkedIn blocks cloud IPs). They'll be included in the pipeline
          // result so the dashboard can route them through the extension.
          const atsOnlyJobs = qualifiedJobs.filter(j =>
            !/linkedin\.com\/jobs/i.test(j.url)
          )
          const skippedLinkedIn = qualifiedJobs.length - atsOnlyJobs.length
          if (skippedLinkedIn > 0) {
            console.log(`[apply-job-pipeline] Excluded ${skippedLinkedIn} LinkedIn Easy Apply jobs from cloud apply — they require local Chrome extension`)
          }

          // Classify ATS jobs: auto_apply (cloud-automatable) vs direct_apply (manual only)
          const autoApplyJobs = atsOnlyJobs.filter(j => classifyJobUrl(j.url) === 'auto_apply')
          const directApplyJobs = atsOnlyJobs.filter(j => classifyJobUrl(j.url) === 'direct_apply')

          if (directApplyJobs.length > 0) {
            console.log(`[apply-job-pipeline] ${directApplyJobs.length} jobs routed to direct_apply (manual): ${directApplyJobs.map(j => j.company).join(', ')}`)
          }

          // Trigger apply-jobs as a child task (auto_apply jobs only)
          const applyJobsPayload = {
            userId: payload.userId,
            jobs: autoApplyJobs.slice(0, payload.maxApplications ?? 20).map(j => ({
              url: j.url,
              company: j.company,
              role: j.title,
              coverLetterSnippet: j.coverLetterSnippet || '',
              matchScore: j.score,
              ats: j.ats,
            })),
            userProfile: payload.userProfile || {},
            linkedInCookie: payload.linkedInCookie,
            gmailAccessToken: payload.gmailAccessToken,
          }

          // Mark direct_apply jobs as needs_manual in the qualified results
          // so the dashboard shows them with "Direct Apply" badges
          for (const j of directApplyJobs) {
            (j as any).applyMethod = 'direct_apply'
            ;(j as any).needsManualReason = `Direct Apply \u2014 Apply manually at: ${j.url}`
          }

          // Only trigger cloud apply if there are auto_apply jobs to process
          if (autoApplyJobs.length > 0) {
            const handle = await tasks.trigger("apply-jobs", applyJobsPayload)
            console.log(`[apply-job-pipeline] Triggered apply-jobs: ${handle.id} (${autoApplyJobs.length} auto_apply jobs, ${directApplyJobs.length} direct_apply)`)
            applyResult = { applied: -1, failed: -1, needsManual: directApplyJobs.length } // -1 = in progress
          } else {
            console.log(`[apply-job-pipeline] No auto_apply jobs — ${directApplyJobs.length} direct_apply, ${skippedLinkedIn} LinkedIn`)
            applyResult = { applied: 0, failed: 0, needsManual: directApplyJobs.length }
          }
        } catch (applyErr) {
          console.warn(`[apply-job-pipeline] Auto-apply trigger failed:`, (applyErr as Error).message)
        }
      } else if (!autoApply) {
        console.log(`[apply-job-pipeline] Auto-apply disabled (dryRun: ${payload.dryRun}, autoApply: ${payload.autoApply})`)
      } else {
        console.log(`[apply-job-pipeline] No qualified jobs to apply to`)
      }

      return {
        runId: result.runId,
        jobsFound: result.jobsFound,
        jobsPreFiltered: (result.jobsFound ?? 0) - (result.jobsQualified ?? 0),
        jobsQualified: result.jobsQualified,
        jobsApplied: applyResult.applied,
        jobsSkipped: result.jobsSkipped,
        jobsFailed: applyResult.failed,
        duration: result.duration,
        discoveredJobs: result.discoveredJobs ?? [],
        qualifiedJobs: result.qualifiedJobs ?? [],
        autoApplyTriggered: autoApply && qualifiedJobs.length > 0,
      }
    } finally {
      if (browserContext) {
        await browserContext.close().catch(() => {})
      }
      await browser.close()
    }
  },
})
