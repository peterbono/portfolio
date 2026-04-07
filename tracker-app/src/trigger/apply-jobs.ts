import { task, metadata } from "@trigger.dev/sdk/v3"

/**
 * Phase 3 — Apply Jobs Task (LEGACY)
 *
 * This task is the legacy apply-jobs path. The primary apply flow now goes
 * through headless-apply.ts (Browserbase). This file is kept for its type
 * exports and as a fallback task stub.
 *
 * Key constraints:
 * - Max 20 applications per run (handles dashboard batches of 16+)
 * - ATS jobs (Greenhouse/Lever/Generic): 15s gap (no bot detection)
 * - LinkedIn Easy Apply: 60s gap (anti-detection needed)
 * - maxDuration: 1800s (30 min) — enough for 20 jobs with mixed gaps
 * - Screenshot on failure for debugging
 * - LinkedIn Easy Apply: local Chromium + cookie
 * - ATS: local Chromium (Browserbase via headless-apply.ts is the primary path)
 */

export interface ApplyJobPayload {
  url: string
  company: string
  role: string
  coverLetterSnippet: string
  matchScore: number
  ats?: string
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

const MAX_APPLICATIONS_PER_RUN = 20
const ATS_GAP_MS = 15_000 // 15s — Greenhouse/Lever/Generic have no bot detection
const LINKEDIN_GAP_MS = 60_000 // 60s — LinkedIn needs anti-detection delay

// ─── Server-side notification helper ──────────────────────────────────
// Calls the Vercel API endpoint using service role key auth (no user JWT needed).
// Fire-and-forget safe: catches all errors and logs instead of throwing.
async function sendServerNotification(
  userId: string,
  type: 'application_submitted' | 'bot_error',
  data: Record<string, unknown>,
): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tracker-app-lyart.vercel.app'
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    console.warn('[apply-jobs] Cannot send notification: SUPABASE_SERVICE_ROLE_KEY not set')
    return
  }
  try {
    const res = await fetch(`${appUrl}/api/send-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-service-role-key': serviceRoleKey,
      },
      body: JSON.stringify({ userId, type, data }),
      signal: AbortSignal.timeout(10_000), // 10s timeout — notification is best-effort
    })
    const result = await res.json()
    if (res.ok && result.sent) {
      console.log(`[apply-jobs] Notification sent: ${type} (emailId: ${result.emailId})`)
    } else {
      console.warn(`[apply-jobs] Notification not sent: ${type}`, result.reason || result.error || res.status)
    }
  } catch (err) {
    console.warn('[apply-jobs] Notification fetch failed:', err instanceof Error ? err.message : err)
  }
}

export const applyJobsTask = task({
  id: "apply-jobs",
  machine: "medium-1x", // 1 vCPU, 2 GB RAM — local Chromium
  maxDuration: 1800, // 30 minutes — 20 jobs with variable gaps
  run: async (payload: {
    userId: string
    jobs: ApplyJobPayload[]
    userProfile: Record<string, unknown>
    linkedInCookie?: string
    gmailAccessToken?: string
    enrichedProfile?: {
      totalYearsExperience?: number
      skills?: Array<{ name: string; level: number; levelLabel: string; yearsUsed: number }>
      professionalSummary?: string
      previousRoles?: string[]
    }
  }): Promise<ApplyJobsOutput> => {
    const runStart = Date.now()

    // Dynamic imports — these are only available in the Trigger.dev worker
    const { chromium } = await import("playwright")
    const { detectAdapter } = await import("../bot/adapters")
    const { isJobBoardUrl, resolveJobBoardUrlServerSide } = await import("../bot/adapters/job-board-redirect")
    const { APPLICANT } = await import("../bot/types")
    type ApplyResult = import("../bot/types").ApplyResult
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
      ...(payload.userProfile.currentCompany && { currentCompany: String(payload.userProfile.currentCompany) }),
      ...(payload.gmailAccessToken && { gmailAccessToken: payload.gmailAccessToken }),
    }

    // ---------- Auto-exchange Gmail refresh token → access token ----------
    // If no gmailAccessToken was passed in the payload, try to obtain one
    // from env vars (GOOGLE_REFRESH_TOKEN + GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET).
    // This enables Greenhouse security code verification without manual token management.
    if (!profile.gmailAccessToken) {
      const refreshToken = process.env.GOOGLE_REFRESH_TOKEN
      const clientId = process.env.GOOGLE_CLIENT_ID
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET
      if (refreshToken && clientId && clientSecret) {
        try {
          const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: refreshToken,
              client_id: clientId,
              client_secret: clientSecret,
            }),
            signal: AbortSignal.timeout(10_000), // 10s timeout — prevent hang on Google OAuth
          })
          if (tokenRes.ok) {
            const tokenData = await tokenRes.json() as { access_token: string }
            profile.gmailAccessToken = tokenData.access_token
            console.log(`[apply-jobs] Gmail access token obtained from refresh token ✅ (length: ${tokenData.access_token?.length ?? 0})`)
          } else {
            const errBody = await tokenRes.text().catch(() => 'no body')
            console.warn(`[apply-jobs] Gmail token exchange failed: ${tokenRes.status} — ${errBody}`)
          }
        } catch (err) {
          console.warn('[apply-jobs] Gmail token exchange error:', err instanceof Error ? err.message : err)
        }
      }
    }

    // ---------- Merge enrichedProfile data if available ----------
    if (payload.enrichedProfile) {
      if (payload.enrichedProfile.totalYearsExperience) {
        profile.yearsExperience = payload.enrichedProfile.totalYearsExperience
      }
      console.log(`[apply-jobs] Enriched profile loaded: ${payload.enrichedProfile.skills?.length ?? 0} skills, ${payload.enrichedProfile.totalYearsExperience ?? '?'} years experience`)
    }

    // ---------- Cap at MAX_APPLICATIONS_PER_RUN ----------
    const jobsToApply = payload.jobs.slice(0, MAX_APPLICATIONS_PER_RUN)
    console.log(
      `[apply-jobs] Processing ${jobsToApply.length}/${payload.jobs.length} jobs (cap: ${MAX_APPLICATIONS_PER_RUN})`,
    )

    // ---- Set initial metadata for dashboard progress ----
    metadata.set("progress", {
      phase: "initializing",
      totalJobs: jobsToApply.length,
      processed: 0,
      applied: 0,
      failed: 0,
      skipped: 0,
      needsManual: 0,
      currentJob: null,
      startedAt: new Date().toISOString(),
    })

    // ---------- Create bot run in Supabase ----------
    let runId: string | undefined
    try {
      runId = await createBotRun(payload.userId, `apply-jobs-${Date.now()}`)
      console.log(`[apply-jobs] Created bot run: ${runId}`)
    } catch (err) {
      console.warn("[apply-jobs] Could not create bot run in DB:", err)
    }

    const results: ApplyJobResult[] = []
    let applied = 0
    let skipped = 0
    let failed = 0
    let needsManual = 0

    // ---------- Pre-resolve job board URLs to ATS URLs (server-side, no Playwright) ----------
    // Safety net: if scouts didn't resolve a job board URL (Dribbble, Jobicy, RemoteOK, etc.)
    // to a direct ATS URL, attempt lightweight server-side resolution here before adapter detection.
    // CRITICAL: each resolve has a 10s timeout, total phase capped at 60s to prevent task hangs.
    let resolvedCount = 0
    const preResolveStart = Date.now()
    const PRE_RESOLVE_TIMEOUT_PER_JOB = 10_000 // 10s per job
    const PRE_RESOLVE_TIMEOUT_TOTAL = 60_000   // 60s total cap
    for (const job of jobsToApply) {
      if (Date.now() - preResolveStart > PRE_RESOLVE_TIMEOUT_TOTAL) {
        console.warn(`[apply-jobs] Pre-resolve total timeout (60s) — skipping remaining ${jobsToApply.length - resolvedCount} jobs`)
        break
      }
      if (isJobBoardUrl(job.url)) {
        try {
          const resolved = await Promise.race([
            resolveJobBoardUrlServerSide(job.url, {
              company: job.company,
              role: job.role,
            }),
            new Promise<string>((_, reject) =>
              setTimeout(() => reject(new Error('Pre-resolve timeout (10s)')), PRE_RESOLVE_TIMEOUT_PER_JOB)
            ),
          ])
          if (resolved !== job.url) {
            console.log(`[apply-jobs] Pre-resolved: ${job.url} -> ${resolved}`)
            job.url = resolved
            resolvedCount++
          }
        } catch (err) {
          console.warn(`[apply-jobs] Pre-resolve failed for ${job.url}: ${err instanceof Error ? err.message : err}`)
        }
      }
    }
    if (resolvedCount > 0) {
      console.log(`[apply-jobs] Pre-resolved ${resolvedCount}/${jobsToApply.length} in ${((Date.now() - preResolveStart) / 1000).toFixed(1)}s`)
    }

    metadata.set("progress", {
      phase: "pre-resolve-done",
      totalJobs: jobsToApply.length,
      resolvedCount,
      processed: 0,
      applied: 0,
      failed: 0,
      skipped: 0,
      needsManual: 0,
      currentJob: null,
      startedAt: new Date().toISOString(),
    })

    // ---------- Pre-filter Ashby jobs (CSP blocks headless — mark needs_manual) ----------
    // NOTE: runs AFTER pre-resolve so that job board URLs resolved to ashbyhq.com are caught
    // Ashby jobs are valid qualified matches — they just can't be auto-applied via headless.
    // Mark as needs_manual so they appear in the user's kanban for manual apply.
    const ashbyJobs = jobsToApply.filter((j) => /ashbyhq\.com/i.test(j.url))
    const nonAshbyJobs = jobsToApply.filter((j) => !/ashbyhq\.com/i.test(j.url))
    if (ashbyJobs.length > 0) {
      console.log(`[apply-jobs] ${ashbyJobs.length} Ashby jobs → needs_manual (CSP blocks headless, user can apply manually)`)
      for (const aj of ashbyJobs) {
        results.push({
          url: aj.url, company: aj.company, role: aj.role, ats: 'Ashby',
          status: 'needs_manual', reason: `Ashby blocks headless browsers — apply manually at: ${aj.url}`,
          durationMs: 0,
        })
        needsManual++
      }
    }

    // ---------- Separate LinkedIn vs ATS jobs ----------
    const linkedInJobs = nonAshbyJobs.filter((j) => /linkedin\.com\/jobs/i.test(j.url))
    const atsJobs = nonAshbyJobs.filter((j) => !/linkedin\.com\/jobs/i.test(j.url))

    console.log(`[apply-jobs] ${atsJobs.length} ATS jobs, ${linkedInJobs.length} LinkedIn jobs, ${ashbyJobs.length} Ashby (pre-filtered)`)

    // ---------- Wrap entire job processing in try/finally ----------
    // Ensures updateBotRun ALWAYS executes even if browsers crash or unhandled errors occur.
    // Without this, a browser crash leaves the run stuck in "running" status forever.
    let fatalError: Error | undefined
    try {

    // ---------- Process ATS jobs (Greenhouse, Lever, Generic) ----------
    if (atsJobs.length > 0) {
      const LOCAL_ARGS = [
        "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
        "--disable-gpu", "--single-process", "--disable-extensions",
        "--js-flags=--max-old-space-size=256",
      ]

      // Launch local Chromium with timeout to prevent hang on OOM/corrupt binary
      const atsBrowser = await Promise.race([
        chromium.launch({ headless: true, args: LOCAL_ARGS }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Local Chromium launch timeout (20s)')), 20_000)
        ),
      ])
      const atsContext = await atsBrowser.newContext({
        viewport: { width: 1280, height: 900 },
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        ignoreHTTPSErrors: true,
      })
      await blockUnnecessaryResources(atsContext, 'moderate')
      console.log('[apply-jobs] Local Chromium launched for ATS jobs')

      try {
        for (let i = 0; i < atsJobs.length; i++) {
          const job = atsJobs[i]
          const jobStart = Date.now()

          console.log(
            `[apply-jobs] [${i + 1}/${atsJobs.length}] ATS: ${job.company} — ${job.role}`,
          )

          // Update metadata for dashboard live progress
          metadata.set("progress", {
            phase: "applying",
            totalJobs: jobsToApply.length,
            processed: results.length,
            applied,
            failed,
            skipped,
            needsManual,
            currentJob: { company: job.company, role: job.role, index: i + 1, total: atsJobs.length, type: 'ATS' },
            startedAt: new Date().toISOString(),
          })

          const page = await atsContext.newPage()

          try {
            const adapter = detectAdapter(job.url)
            console.log(`[apply-jobs]   Adapter: ${adapter.name}`)

            // Thread the per-job cover letter snippet + metadata into the profile
            profile.coverLetterSnippet = job.coverLetterSnippet || undefined
            profile.jobMeta = { company: job.company, role: job.role }

            // Per-job timeout: Greenhouse needs longer (security code polling)
            const isGreenhouse = /greenhouse/i.test(job.url) || job.ats === 'greenhouse'
            const JOB_TIMEOUT_MS = isGreenhouse ? 300_000 : 180_000
            const applyResult = await Promise.race([
              adapter.apply(page, job.url, profile),
              new Promise<ApplyResult>((_, reject) =>
                setTimeout(() => reject(new Error(`Job timeout: adapter did not complete within ${JOB_TIMEOUT_MS / 1000}s`)), JOB_TIMEOUT_MS)
              ),
            ])

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
              case "applied": applied++; break
              case "skipped": skipped++; break
              case "failed": failed++; break
              case "needs_manual": needsManual++; break
            }

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
            const errMsg = err instanceof Error ? err.message : String(err)

            // Non-retryable error — screenshot with 5s timeout to avoid hanging on crashed pages
            let screenshotBase64: string | undefined
            try {
              screenshotBase64 = await Promise.race([
                takeScreenshot(page),
                new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5_000)),
              ])
            } catch { /* screenshot failed */ }

            const result: ApplyJobResult = {
              url: job.url,
              company: job.company,
              role: job.role,
              ats: "Unknown",
              status: "failed",
              reason: errMsg,
              screenshotBase64,
              durationMs: Date.now() - jobStart,
            }
            results.push(result)
            failed++
            console.error(`[apply-jobs]   Error: ${result.reason}`)
          } finally {
            await page.close().catch(() => {})
          }

          // Rate limiting: 15s gap for ATS jobs — skip for last if no LinkedIn follows
          if (i < atsJobs.length - 1 || linkedInJobs.length > 0) {
            console.log(`[apply-jobs]   Waiting ${ATS_GAP_MS / 1000}s before next application...`)
            await humanDelay(ATS_GAP_MS, ATS_GAP_MS + 5000)
          }
        }
      } finally {
        await atsContext.close().catch((err) => console.warn('[apply-jobs] Context close failed:', err))
        await atsBrowser.close().catch((err) => console.warn('[apply-jobs] Browser close failed:', err))
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
        // LinkedIn Easy Apply: local Chromium with cookie injection.
        // Known limitation: LinkedIn may block cloud IPs. When auth fails → needs_manual.
        console.log('[apply-jobs] Launching local Chromium for LinkedIn Easy Apply')
        const linkedInBrowser = await Promise.race([
          chromium.launch({
            headless: true,
            args: [
              "--no-sandbox", "--disable-setuid-sandbox",
              "--disable-blink-features=AutomationControlled",
              "--disable-dev-shm-usage", "--disable-gpu", "--single-process",
              "--disable-extensions", "--disable-background-networking",
              "--disable-default-apps", "--disable-sync", "--no-first-run",
              "--js-flags=--max-old-space-size=256",
            ],
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('LinkedIn Chromium launch timeout (20s)')), 20_000)
          ),
        ])

        try {
          const linkedInContext = await linkedInBrowser.newContext({
            viewport: { width: 1024, height: 768 },
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            locale: "en-US",
            timezoneId: "Asia/Bangkok",
            ignoreHTTPSErrors: true,
          })

          // Inject LinkedIn cookies via context.addCookies (always local Chromium)
          await linkedInContext.addCookies([
            {
              name: "li_at",
              value: payload.linkedInCookie,
              domain: ".linkedin.com",
              path: "/",
              httpOnly: true,
              secure: true,
              sameSite: "None" as const,
            },
            {
              name: "JSESSIONID",
              value: `"ajax:${Date.now()}"`,
              domain: ".linkedin.com",
              path: "/",
              httpOnly: false,
              secure: true,
              sameSite: "None" as const,
            },
          ])
          console.log('[apply-jobs] LinkedIn cookies injected via context.addCookies')

          // Aggressive: block images, CSS, fonts, media — saves ~300MB RAM
          await blockUnnecessaryResources(linkedInContext, 'aggressive')

          for (let i = 0; i < linkedInJobs.length; i++) {
            const job = linkedInJobs[i]
            const jobStart = Date.now()

            console.log(
              `[apply-jobs] [${i + 1}/${linkedInJobs.length}] LinkedIn: ${job.company} — ${job.role}`,
            )

            // Update metadata for dashboard live progress
            metadata.set("progress", {
              phase: "applying",
              totalJobs: jobsToApply.length,
              processed: results.length,
              applied,
              failed,
              skipped,
              needsManual,
              currentJob: { company: job.company, role: job.role, index: i + 1, total: linkedInJobs.length, type: 'LinkedIn' },
              startedAt: new Date().toISOString(),
            })

            const page = await linkedInContext.newPage()

            try {
              const adapter = detectAdapter(job.url) // will match linkedInEasyApply
              console.log(`[apply-jobs]   Adapter: ${adapter.name}`)

              // Thread the per-job cover letter snippet + metadata into the profile
              profile.coverLetterSnippet = job.coverLetterSnippet || undefined
              profile.jobMeta = { company: job.company, role: job.role }

              // Per-job timeout: LinkedIn Easy Apply should not hang indefinitely (120s max)
              const LINKEDIN_JOB_TIMEOUT_MS = 120_000
              const applyResult = await Promise.race([
                adapter.apply(page, job.url, profile),
                new Promise<import("../bot/types").ApplyResult>((_, reject) =>
                  setTimeout(() => reject(new Error(`LinkedIn job timeout: adapter did not complete within ${LINKEDIN_JOB_TIMEOUT_MS / 1000}s`)), LINKEDIN_JOB_TIMEOUT_MS)
                ),
              ])

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
              // Screenshot with 5s timeout to avoid hanging on crashed pages
              let screenshotBase64: string | undefined
              try {
                screenshotBase64 = await Promise.race([
                  takeScreenshot(page),
                  new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5_000)),
                ])
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
              await page.close().catch((err) => console.warn('[apply-jobs] Cleanup failed:', err))
            }

            // Rate limiting between LinkedIn applications: 60s anti-detection delay (skip for last)
            if (i < linkedInJobs.length - 1) {
              console.log(`[apply-jobs]   Waiting ${LINKEDIN_GAP_MS / 1000}s before next application...`)
              await humanDelay(LINKEDIN_GAP_MS, LINKEDIN_GAP_MS + 5000)
            }
          }

          await linkedInContext.close().catch((err) => console.warn('[apply-jobs] Cleanup failed:', err))
        } finally {
          await linkedInBrowser.close().catch((err) => console.warn('[apply-jobs] Cleanup failed:', err))
        }
      }
    }

    } catch (err) {
      // Capture fatal/unhandled errors (browser crash, OOM, etc.)
      fatalError = err instanceof Error ? err : new Error(String(err))
      console.error(`[apply-jobs] FATAL ERROR during job processing: ${fatalError.message}`)
    } finally {
      // ---------- Update metadata with final state ----------
      metadata.set("progress", {
        phase: fatalError ? "crashed" : "completed",
        totalJobs: jobsToApply.length,
        processed: results.length,
        applied,
        failed,
        skipped,
        needsManual,
        currentJob: null,
        completedAt: new Date().toISOString(),
        ...(fatalError && { error: fatalError.message }),
      })

      // ---------- Update bot run in Supabase (ALWAYS runs) ----------
      const totalDuration = Date.now() - runStart
      const runStatus = fatalError ? 'failed' : 'completed'
      if (runId) {
        await updateBotRun(runId, {
          status: runStatus,
          completed_at: new Date().toISOString(),
          jobs_applied: applied,
          jobs_skipped: skipped,
          jobs_failed: failed,
          jobs_needs_manual: needsManual,
          ...(fatalError && { error_message: fatalError.message }),
        }).catch((err) => console.warn("[apply-jobs] Update run error:", err))
      }

      console.log(
        `[apply-jobs] Done (${runStatus}): ${applied} applied, ${skipped} skipped, ${failed} failed, ${needsManual} manual — ${(totalDuration / 1000).toFixed(1)}s`,
      )

      // ─── Send notifications (fire-and-forget) ──────────────────────────
      // Batch notification for successfully applied jobs
      if (applied > 0) {
        const appliedResults = results.filter(r => r.status === 'applied')
        const firstApplied = appliedResults[0]
        sendServerNotification(payload.userId, 'application_submitted', {
          company: firstApplied?.company ?? 'Unknown',
          role: firstApplied?.role ?? 'Unknown Role',
          count: applied,
        }).catch(() => {}) // swallow — already logged inside
      }

      // Notify on critical failure (all jobs failed, run-level error, or crash)
      if (applied === 0 && (failed > 0 || fatalError)) {
        const failReasons = fatalError
          ? `CRASH: ${fatalError.message}`
          : results
              .filter(r => r.status === 'failed')
              .map(r => `${r.company}: ${r.reason}`)
              .slice(0, 3)
              .join('; ')
        sendServerNotification(payload.userId, 'bot_error', {
          errorMessage: fatalError
            ? `Run crashed: ${fatalError.message}. ${applied} applied, ${failed} failed before crash.`
            : `All ${failed} application(s) failed. ${failReasons}`,
          runId: runId ?? `apply-jobs-${runStart}`,
        }).catch(() => {}) // swallow — already logged inside
      }
    }

    // If there was a fatal error, re-throw so Trigger.dev marks the task as failed
    if (fatalError) {
      throw fatalError
    }

    const totalDuration = Date.now() - runStart
    return {
      totalProcessed: results.length,
      applied,
      skipped,
      failed,
      needsManual,
      results,
      durationMs: totalDuration,
    }
  },
})
