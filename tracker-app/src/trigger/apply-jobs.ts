import { task } from "@trigger.dev/sdk/v3"

/**
 * Phase 3 — Apply Jobs Task
 *
 * Receives a batch of qualified/approved jobs and submits applications
 * using the appropriate ATS adapter for each (Greenhouse, Lever, LinkedIn
 * Easy Apply, or Generic fallback).
 *
 * Key constraints:
 * - Max 5 applications per run (daily cap enforcement)
 * - 2-minute gap between applications (rate limiting / bot detection)
 * - Screenshot on failure for debugging
 * - LinkedIn Easy Apply: local Chromium + cookie (Bright Data blocks cookies)
 * - ATS (Greenhouse/Lever/Generic): Bright Data Scraping Browser works fine
 */

export interface ApplyJobPayload {
  url: string
  company: string
  role: string
  coverLetterSnippet: string
  matchScore: number
}

export interface ApplyJobResult {
  url: string
  company: string
  role: string
  ats: string
  status: "applied" | "skipped" | "failed" | "needs_manual"
  reason?: string
  screenshotBase64?: string
  durationMs: number
}

export interface ApplyJobsOutput {
  totalProcessed: number
  applied: number
  skipped: number
  failed: number
  needsManual: number
  results: ApplyJobResult[]
  durationMs: number
}

const MAX_APPLICATIONS_PER_RUN = 5
const GAP_BETWEEN_APPLICATIONS_MS = 120_000 // 2 minutes

export const applyJobsTask = task({
  id: "apply-jobs",
  maxDuration: 600, // 10 minutes — form filling is slow
  run: async (payload: {
    userId: string
    jobs: ApplyJobPayload[]
    userProfile: Record<string, unknown>
    linkedInCookie?: string
  }): Promise<ApplyJobsOutput> => {
    const runStart = Date.now()

    // Dynamic imports — these are only available in the Trigger.dev worker
    const { chromium } = await import("playwright")
    const { detectAdapter } = await import("../bot/adapters")
    const { APPLICANT } = await import("../bot/types")
    const { takeScreenshot, humanDelay, blockUnnecessaryResources } = await import("../bot/helpers")
    const {
      createBotRun,
      updateBotRun,
      logBotActivity,
      createApplicationFromBot,
    } = await import("../bot/supabase-server")

    // ---------- Build applicant profile from payload + defaults ----------
    const profile = {
      ...APPLICANT,
      ...(payload.userProfile.firstName && { firstName: String(payload.userProfile.firstName) }),
      ...(payload.userProfile.lastName && { lastName: String(payload.userProfile.lastName) }),
      ...(payload.userProfile.email && { email: String(payload.userProfile.email) }),
      ...(payload.userProfile.phone && { phone: String(payload.userProfile.phone) }),
      ...(payload.userProfile.location && { location: String(payload.userProfile.location) }),
      ...(payload.userProfile.linkedin && { linkedin: String(payload.userProfile.linkedin) }),
      ...(payload.userProfile.portfolio && { portfolio: String(payload.userProfile.portfolio) }),
      ...(payload.userProfile.cvUrl && { cvUrl: String(payload.userProfile.cvUrl) }),
    }

    // ---------- Cap at MAX_APPLICATIONS_PER_RUN ----------
    const jobsToApply = payload.jobs.slice(0, MAX_APPLICATIONS_PER_RUN)
    console.log(
      `[apply-jobs] Processing ${jobsToApply.length}/${payload.jobs.length} jobs (cap: ${MAX_APPLICATIONS_PER_RUN})`,
    )

    // ---------- Create bot run in Supabase ----------
    let runId: string | undefined
    try {
      runId = await createBotRun(payload.userId, `apply-jobs-${Date.now()}`)
      console.log(`[apply-jobs] Created bot run: ${runId}`)
    } catch (err) {
      console.warn("[apply-jobs] Could not create bot run in DB:", err)
    }

    // ---------- Separate LinkedIn vs ATS jobs ----------
    const linkedInJobs = jobsToApply.filter((j) => /linkedin\.com\/jobs/i.test(j.url))
    const atsJobs = jobsToApply.filter((j) => !/linkedin\.com\/jobs/i.test(j.url))

    console.log(`[apply-jobs] ${atsJobs.length} ATS jobs, ${linkedInJobs.length} LinkedIn jobs`)

    // ---------- Launch browsers ----------
    // ATS jobs: use Bright Data Scraping Browser (or local fallback)
    // LinkedIn Easy Apply: always local Chromium + cookie injection
    const SBR_AUTH = process.env.BRIGHTDATA_SBR_AUTH

    const results: ApplyJobResult[] = []
    let applied = 0
    let skipped = 0
    let failed = 0
    let needsManual = 0

    // ---------- Process ATS jobs (Greenhouse, Lever, Generic) ----------
    if (atsJobs.length > 0) {
      const atsBrowser = SBR_AUTH
        ? await chromium.connectOverCDP(`wss://${SBR_AUTH}@brd.superproxy.io:9222`)
        : await chromium.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
          })

      try {
        const atsContext = await atsBrowser.newContext({
          viewport: { width: 1280, height: 900 },
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        })

        // Moderate mode: block images, fonts, media, trackers but KEEP CSS (ATS forms need it)
        await blockUnnecessaryResources(atsContext, 'moderate')

        for (let i = 0; i < atsJobs.length; i++) {
          const job = atsJobs[i]
          const jobStart = Date.now()

          console.log(
            `[apply-jobs] [${i + 1}/${atsJobs.length}] ATS: ${job.company} — ${job.role}`,
          )

          const page = await atsContext.newPage()

          try {
            const adapter = detectAdapter(job.url)
            console.log(`[apply-jobs]   Adapter: ${adapter.name}`)

            const applyResult = await adapter.apply(page, job.url, profile)

            const result: ApplyJobResult = {
              url: job.url,
              company: applyResult.company || job.company,
              role: applyResult.role || job.role,
              ats: applyResult.ats,
              status: applyResult.status,
              reason: applyResult.reason,
              screenshotBase64: applyResult.screenshotUrl,
              durationMs: Date.now() - jobStart,
            }

            results.push(result)

            // Update counters
            switch (applyResult.status) {
              case "applied":
                applied++
                break
              case "skipped":
                skipped++
                break
              case "failed":
                failed++
                break
              case "needs_manual":
                needsManual++
                break
            }

            // Log to Supabase
            if (runId) {
              await logBotActivity({
                user_id: payload.userId,
                run_id: runId,
                action:
                  applyResult.status === "applied"
                    ? "applied"
                    : applyResult.status === "skipped"
                      ? "skipped"
                      : "failed",
                company: result.company,
                role: result.role,
                ats: result.ats,
                reason: applyResult.reason,
                screenshot_url: applyResult.screenshotUrl,
              }).catch((err) => console.warn("[apply-jobs] Log activity error:", err))

              await createApplicationFromBot(
                payload.userId,
                {
                  title: result.role,
                  company: result.company,
                  location: profile.location,
                  url: job.url,
                  ats: result.ats,
                },
                applyResult,
              ).catch((err) => console.warn("[apply-jobs] Create application error:", err))
            }

            console.log(
              `[apply-jobs]   Result: ${applyResult.status}${applyResult.reason ? ` — ${applyResult.reason}` : ""}`,
            )
          } catch (err) {
            // Screenshot on unexpected error
            let screenshotBase64: string | undefined
            try {
              screenshotBase64 = await takeScreenshot(page)
            } catch {
              // screenshot failed too
            }

            const result: ApplyJobResult = {
              url: job.url,
              company: job.company,
              role: job.role,
              ats: "Unknown",
              status: "failed",
              reason: err instanceof Error ? err.message : String(err),
              screenshotBase64,
              durationMs: Date.now() - jobStart,
            }
            results.push(result)
            failed++

            console.error(`[apply-jobs]   Error: ${result.reason}`)
          } finally {
            await page.close().catch(() => {})
          }

          // Rate limiting: 2-minute gap between applications (skip for last job)
          if (i < atsJobs.length - 1 || linkedInJobs.length > 0) {
            console.log(`[apply-jobs]   Waiting ${GAP_BETWEEN_APPLICATIONS_MS / 1000}s before next application...`)
            await humanDelay(GAP_BETWEEN_APPLICATIONS_MS, GAP_BETWEEN_APPLICATIONS_MS + 5000)
          }
        }

        await atsContext.close().catch(() => {})
      } finally {
        await atsBrowser.close().catch(() => {})
      }
    }

    // ---------- Process LinkedIn Easy Apply jobs ----------
    if (linkedInJobs.length > 0) {
      if (!payload.linkedInCookie) {
        // No cookie — mark all LinkedIn jobs as skipped
        for (const job of linkedInJobs) {
          const result: ApplyJobResult = {
            url: job.url,
            company: job.company,
            role: job.role,
            ats: "LinkedIn Easy Apply",
            status: "skipped",
            reason: "No LinkedIn session cookie provided — cannot use Easy Apply",
            durationMs: 0,
          }
          results.push(result)
          skipped++

          console.log(
            `[apply-jobs] Skipped LinkedIn: ${job.company} — ${job.role} (no cookie)`,
          )
        }
      } else {
        // Launch local Chromium for LinkedIn (Bright Data blocks cookie injection)
        const linkedInBrowser = await chromium.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        })

        try {
          // Create context with LinkedIn session cookie
          const linkedInContext = await linkedInBrowser.newContext({
            viewport: { width: 1280, height: 900 },
            userAgent:
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          })

          // Inject LinkedIn li_at cookie
          await linkedInContext.addCookies([
            {
              name: "li_at",
              value: payload.linkedInCookie,
              domain: ".linkedin.com",
              path: "/",
              httpOnly: true,
              secure: true,
              sameSite: "None",
            },
          ])

          // Moderate mode: block images, fonts, media, trackers but KEEP CSS (Easy Apply forms need it)
          await blockUnnecessaryResources(linkedInContext, 'moderate')

          for (let i = 0; i < linkedInJobs.length; i++) {
            const job = linkedInJobs[i]
            const jobStart = Date.now()

            console.log(
              `[apply-jobs] [${i + 1}/${linkedInJobs.length}] LinkedIn: ${job.company} — ${job.role}`,
            )

            const page = await linkedInContext.newPage()

            try {
              const adapter = detectAdapter(job.url) // will match linkedInEasyApply
              console.log(`[apply-jobs]   Adapter: ${adapter.name}`)

              const applyResult = await adapter.apply(page, job.url, profile)

              const result: ApplyJobResult = {
                url: job.url,
                company: applyResult.company || job.company,
                role: applyResult.role || job.role,
                ats: applyResult.ats,
                status: applyResult.status,
                reason: applyResult.reason,
                screenshotBase64: applyResult.screenshotUrl,
                durationMs: Date.now() - jobStart,
              }

              results.push(result)

              switch (applyResult.status) {
                case "applied":
                  applied++
                  break
                case "skipped":
                  skipped++
                  break
                case "failed":
                  failed++
                  break
                case "needs_manual":
                  needsManual++
                  break
              }

              // Log to Supabase
              if (runId) {
                await logBotActivity({
                  user_id: payload.userId,
                  run_id: runId,
                  action:
                    applyResult.status === "applied"
                      ? "applied"
                      : applyResult.status === "skipped"
                        ? "skipped"
                        : "failed",
                  company: result.company,
                  role: result.role,
                  ats: result.ats,
                  reason: applyResult.reason,
                  screenshot_url: applyResult.screenshotUrl,
                }).catch((err) => console.warn("[apply-jobs] Log activity error:", err))

                await createApplicationFromBot(
                  payload.userId,
                  {
                    title: result.role,
                    company: result.company,
                    location: profile.location,
                    url: job.url,
                    ats: result.ats,
                  },
                  applyResult,
                ).catch((err) => console.warn("[apply-jobs] Create application error:", err))
              }

              console.log(
                `[apply-jobs]   Result: ${applyResult.status}${applyResult.reason ? ` — ${applyResult.reason}` : ""}`,
              )
            } catch (err) {
              let screenshotBase64: string | undefined
              try {
                screenshotBase64 = await takeScreenshot(page)
              } catch {
                // screenshot failed
              }

              const result: ApplyJobResult = {
                url: job.url,
                company: job.company,
                role: job.role,
                ats: "LinkedIn Easy Apply",
                status: "failed",
                reason: err instanceof Error ? err.message : String(err),
                screenshotBase64,
                durationMs: Date.now() - jobStart,
              }
              results.push(result)
              failed++

              console.error(`[apply-jobs]   Error: ${result.reason}`)
            } finally {
              await page.close().catch(() => {})
            }

            // Rate limiting between LinkedIn applications (skip for last)
            if (i < linkedInJobs.length - 1) {
              console.log(`[apply-jobs]   Waiting ${GAP_BETWEEN_APPLICATIONS_MS / 1000}s before next application...`)
              await humanDelay(GAP_BETWEEN_APPLICATIONS_MS, GAP_BETWEEN_APPLICATIONS_MS + 5000)
            }
          }

          await linkedInContext.close().catch(() => {})
        } finally {
          await linkedInBrowser.close().catch(() => {})
        }
      }
    }

    // ---------- Update bot run in Supabase ----------
    const totalDuration = Date.now() - runStart
    if (runId) {
      await updateBotRun(runId, {
        status: "completed",
        finished_at: new Date().toISOString(),
        jobs_applied: applied,
        jobs_skipped: skipped,
        jobs_failed: failed + needsManual,
        duration_ms: totalDuration,
      }).catch((err) => console.warn("[apply-jobs] Update run error:", err))
    }

    const output: ApplyJobsOutput = {
      totalProcessed: results.length,
      applied,
      skipped,
      failed,
      needsManual,
      results,
      durationMs: totalDuration,
    }

    console.log(
      `[apply-jobs] Done: ${applied} applied, ${skipped} skipped, ${failed} failed, ${needsManual} manual — ${(totalDuration / 1000).toFixed(1)}s`,
    )

    return output
  },
})
