import { task } from "@trigger.dev/sdk/v3"

/**
 * Phase 3 — Apply Jobs Task
 *
 * Receives a batch of qualified/approved jobs and submits applications
 * using the appropriate ATS adapter for each (Greenhouse, Lever, LinkedIn
 * Easy Apply, or Generic fallback).
 *
 * Key constraints:
 * - Max 20 applications per run (handles dashboard batches of 16+)
 * - ATS jobs (Greenhouse/Lever/Generic): 15s gap (no bot detection)
 * - LinkedIn Easy Apply: 60s gap (anti-detection needed)
 * - maxDuration: 1800s (30 min) — enough for 20 jobs with mixed gaps
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
  machine: "medium-1x", // 1 vCPU, 2 GB RAM — local Chromium for LinkedIn needs it
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
    const SBR_AUTH = (process.env.BRIGHTDATA_SBR_AUTH || '').trim() || undefined

    const results: ApplyJobResult[] = []
    let applied = 0
    let skipped = 0
    let failed = 0
    let needsManual = 0

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

      // ── SBR domain limit & proxy error detection ──
      // Bright Data SBR enforces a per-session domain navigation limit (~3-5 cross-domain navs).
      // After that, CDP throws "Page.navigate domain limit reached".
      // We detect this and similar errors to trigger session recycling.
      const isSbrProxyError = (msg: string) =>
        msg.includes('502') || msg.includes('no_peer') ||
        msg.includes('probe_timeout') || msg.includes('proxy_error') ||
        msg.includes('domain limit') || msg.includes('domain_limit') ||
        msg.includes('ERR_CONNECTION_REFUSED') ||
        msg.includes('ERR_NAME_NOT_RESOLVED') || /net::ERR_/.test(msg) ||
        msg.includes('Target closed') || msg.includes('Browser closed')

      const isDomainLimitError = (msg: string) =>
        msg.includes('domain limit') || msg.includes('domain_limit')

      // Proactively recycle SBR session every N jobs to avoid hitting the domain limit
      const SBR_RECYCLE_EVERY = 3

      // ── Helper: connect to SBR or fall back to local Chromium ──
      // Returns a bundle with browser, context, and whether SBR is in use.
      // This is called at startup and again each time we need to recycle.
      type BrowserBundle = {
        browser: Awaited<ReturnType<typeof chromium.connectOverCDP>>
        context: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.connectOverCDP>>['newContext']>>
        usingSBR: boolean
      }

      const connectAtsBrowser = async (): Promise<BrowserBundle> => {
        if (SBR_AUTH) {
          try {
            const sbrBrowser = await Promise.race([
              chromium.connectOverCDP(`wss://${SBR_AUTH}@brd.superproxy.io:9222`),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('SBR connection timeout (30s)')), 30_000)
              ),
            ])
            // Health check: verify CDP is responsive (not a zombie session)
            const testCtx = await Promise.race([
              sbrBrowser.newContext(),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('SBR health check timeout (10s)')), 10_000)
              ),
            ])
            await testCtx.close()

            // SBR via CDP doesn't support newContext() — use default context
            const ctx = sbrBrowser.contexts()[0] || await sbrBrowser.newContext({
              viewport: { width: 1280, height: 900 },
              ignoreHTTPSErrors: true,
            })
            await blockUnnecessaryResources(ctx, 'moderate')
            console.log('[apply-jobs] Connected to Bright Data SBR (health check passed)')
            return { browser: sbrBrowser, context: ctx, usingSBR: true }
          } catch (sbrErr) {
            console.warn(`[apply-jobs] SBR connect failed: ${(sbrErr as Error).message} — falling back to local Chromium`)
          }
        }
        // Local Chromium fallback
        const localBrowser = await chromium.launch({ headless: true, args: LOCAL_ARGS }) as unknown as Awaited<ReturnType<typeof chromium.connectOverCDP>>
        const ctx = await localBrowser.newContext({
          viewport: { width: 1280, height: 900 },
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          ignoreHTTPSErrors: true,
        })
        await blockUnnecessaryResources(ctx, 'moderate')
        return { browser: localBrowser, context: ctx, usingSBR: false }
      }

      const closeAtsBrowser = async (bundle: BrowserBundle): Promise<void> => {
        await bundle.context.close().catch((err) => console.warn('[apply-jobs] Context close failed:', err))
        await bundle.browser.close().catch((err) => console.warn('[apply-jobs] Browser close failed:', err))
      }

      // ── Initial connection ──
      let ats = await connectAtsBrowser()
      let jobsSinceRecycle = 0

      try {
        for (let i = 0; i < atsJobs.length; i++) {
          const job = atsJobs[i]
          const jobStart = Date.now()

          console.log(
            `[apply-jobs] [${i + 1}/${atsJobs.length}] ATS: ${job.company} — ${job.role}`,
          )

          // ── Proactive SBR session recycling every N jobs ──
          // This prevents hitting the domain limit before it occurs.
          if (ats.usingSBR && jobsSinceRecycle >= SBR_RECYCLE_EVERY) {
            console.log(`[apply-jobs]   Proactive SBR recycle after ${jobsSinceRecycle} jobs (limit: ${SBR_RECYCLE_EVERY})`)
            await closeAtsBrowser(ats)
            await new Promise(r => setTimeout(r, 2_000)) // brief cooldown
            ats = await connectAtsBrowser()
            jobsSinceRecycle = 0
          }

          // SBR proxy can intermittently return 502 (no_peer, probe_timeout, domain limit).
          // Retry up to 2 times with SBR, then fall back to local Chromium.
          const MAX_SBR_RETRIES = 2
          let attempt = 0
          let applyResult: ApplyResult | null = null
          let usedLocalFallback = false
          let needsSbrRecycle = false

          while (attempt <= MAX_SBR_RETRIES) {
            attempt++

            // On final retry with SBR, or if SBR already failed twice:
            // try local Chromium as fallback (Greenhouse/Lever don't need residential proxy)
            let pageContext = ats.context
            let localBrowser: Awaited<ReturnType<typeof chromium.launch>> | null = null

            if (attempt > MAX_SBR_RETRIES && ats.usingSBR) {
              console.log(`[apply-jobs]   SBR failed ${MAX_SBR_RETRIES} times, falling back to local Chromium`)
              try {
                localBrowser = await chromium.launch({ headless: true, args: LOCAL_ARGS })
                pageContext = await localBrowser.newContext({
                  viewport: { width: 1280, height: 900 },
                  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                  ignoreHTTPSErrors: true,
                })
                await blockUnnecessaryResources(pageContext, 'moderate')
                usedLocalFallback = true
              } catch (localErr) {
                console.error(`[apply-jobs]   Local Chromium fallback failed: ${(localErr as Error).message}`)
                break
              }
            }

            const page = await pageContext.newPage()

            try {
              const adapter = detectAdapter(job.url)
              if (attempt === 1) console.log(`[apply-jobs]   Adapter: ${adapter.name}`)

              // Thread the per-job cover letter snippet + metadata into the profile
              profile.coverLetterSnippet = job.coverLetterSnippet || undefined
              profile.jobMeta = { company: job.company, role: job.role }

              // Per-job timeout: 3 minutes max to prevent hanging on stuck adapters
              const JOB_TIMEOUT_MS = 180_000
              applyResult = await Promise.race([
                adapter.apply(page, job.url, profile),
                new Promise<ApplyResult>((_, reject) =>
                  setTimeout(() => reject(new Error(`Job timeout: adapter did not complete within ${JOB_TIMEOUT_MS / 1000}s`)), JOB_TIMEOUT_MS)
                ),
              ])

              // Check if the result is a proxy error that should be retried
              const isProxyErr = applyResult.status === 'failed' &&
                applyResult.reason && isSbrProxyError(applyResult.reason)

              // Domain limit errors need full session recycle, not just page retry
              if (applyResult.status === 'failed' && applyResult.reason &&
                  isDomainLimitError(applyResult.reason) && ats.usingSBR) {
                console.log(`[apply-jobs]   SBR domain limit hit (result) — will recycle session and retry this job`)
                await page.close().catch(() => {})
                if (localBrowser) await localBrowser.close().catch(() => {})
                needsSbrRecycle = true
                applyResult = null // will retry with fresh session
                break
              }

              if (isProxyErr && attempt <= MAX_SBR_RETRIES) {
                const delay = attempt * 8_000
                console.log(`[apply-jobs]   SBR proxy error (attempt ${attempt}/${MAX_SBR_RETRIES + 1}), retrying in ${delay / 1000}s...`)
                await page.close().catch(() => {})
                if (localBrowser) await localBrowser.close().catch(() => {})
                await new Promise(r => setTimeout(r, delay))
                continue
              }

              break // Success or non-retryable failure

            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err)

              // Domain limit exception: recycle entire SBR session
              if (isDomainLimitError(errMsg) && ats.usingSBR) {
                console.log(`[apply-jobs]   SBR domain limit exception — will recycle session and retry this job`)
                await page.close().catch(() => {})
                if (localBrowser) await localBrowser.close().catch(() => {})
                needsSbrRecycle = true
                break
              }

              if (isSbrProxyError(errMsg) && attempt <= MAX_SBR_RETRIES) {
                const delay = attempt * 8_000
                console.log(`[apply-jobs]   SBR proxy exception (attempt ${attempt}/${MAX_SBR_RETRIES + 1}), retrying in ${delay / 1000}s...`)
                await page.close().catch(() => {})
                if (localBrowser) await localBrowser.close().catch(() => {})
                await new Promise(r => setTimeout(r, delay))
                continue
              }

              // Non-retryable error — screenshot with 5s timeout to avoid hanging on crashed pages
              let screenshotBase64: string | undefined
              try {
                screenshotBase64 = await Promise.race([
                  takeScreenshot(page),
                  new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5_000)),
                ])
              } catch { /* screenshot failed */ }
              await page.close().catch(() => {})
              if (localBrowser) await localBrowser.close().catch(() => {})

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
              break
            } finally {
              await page.close().catch(() => {})
              if (localBrowser) await localBrowser.close().catch(() => {})
            }
          }

          // ── SBR domain limit recovery: recycle session and retry this job ──
          if (needsSbrRecycle) {
            console.log(`[apply-jobs]   Closing stale SBR session and reconnecting...`)
            await closeAtsBrowser(ats)
            await new Promise(r => setTimeout(r, 3_000)) // cooldown before reconnect
            ats = await connectAtsBrowser()
            jobsSinceRecycle = 0
            // Decrement i so the current job is retried with the fresh session
            i--
            continue
          }

          jobsSinceRecycle++

          // Process the final applyResult (if we got one from the retry loop)
          if (applyResult) {
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
              `[apply-jobs]   Result: ${applyResult.status}${applyResult.reason ? ` — ${applyResult.reason}` : ""} (attempt ${attempt})`,
            )
          }

          // Rate limiting: 15s gap for ATS jobs (no bot detection) — skip for last if no LinkedIn follows
          if (i < atsJobs.length - 1 || linkedInJobs.length > 0) {
            console.log(`[apply-jobs]   Waiting ${ATS_GAP_MS / 1000}s before next application...`)
            await humanDelay(ATS_GAP_MS, ATS_GAP_MS + 5000)
          }
        }
      } finally {
        await closeAtsBrowser(ats)
      }

      // ---------- SBR total failure detection ----------
      // If ALL ATS jobs failed and most errors look like proxy/browser issues,
      // log a clear summary so the root cause is immediately visible.
      const atsResults = results.filter(r => r.ats !== 'LinkedIn Easy Apply')
      const atsFailed = atsResults.filter(r => r.status === 'failed')
      if (atsResults.length > 0 && atsFailed.length === atsResults.length) {
        const sbrErrorPattern = /502|no_peer|probe_timeout|proxy_error|domain limit|domain_limit|ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|net::ERR_|Target closed|Browser closed/
        const sbrFailures = atsFailed.filter(r => r.reason && sbrErrorPattern.test(r.reason))
        if (sbrFailures.length >= Math.ceil(atsResults.length * 0.8)) {
          const uniqueReasons = Array.from(new Set(sbrFailures.map(r => r.reason))).slice(0, 3).join('; ')
          console.error(
            `[apply-jobs] SBR TOTAL FAILURE: All ${atsResults.length} ATS jobs failed due to proxy/browser errors. ` +
            `Reasons: ${uniqueReasons}. ` +
            `Action required: check Bright Data SBR status, quota, or switch to local Chromium.`
          )
        }
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
        // Known limitation: SBR blocks cookie injection, residential proxy
        // tunnel fails from Trigger.dev cloud. Direct connection works but
        // LinkedIn may block cloud IPs. When auth fails → needs_manual.
        console.log('[apply-jobs] Launching local Chromium for LinkedIn Easy Apply')
        const linkedInBrowser = await chromium.launch({
          headless: true,
          args: [
            "--no-sandbox", "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage", "--disable-gpu", "--single-process",
            "--disable-extensions", "--disable-background-networking",
            "--disable-default-apps", "--disable-sync", "--no-first-run",
            "--js-flags=--max-old-space-size=256",
          ],
        })

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

            const page = await linkedInContext.newPage()

            try {
              const adapter = detectAdapter(job.url) // will match linkedInEasyApply
              console.log(`[apply-jobs]   Adapter: ${adapter.name}`)

              // Thread the per-job cover letter snippet + metadata into the profile
              profile.coverLetterSnippet = job.coverLetterSnippet || undefined
              profile.jobMeta = { company: job.company, role: job.role }

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
      // ---------- Update bot run in Supabase (ALWAYS runs) ----------
      const totalDuration = Date.now() - runStart
      const runStatus = fatalError ? 'failed' : 'completed'
      if (runId) {
        await updateBotRun(runId, {
          status: runStatus,
          completed_at: new Date().toISOString(),
          jobs_applied: applied,
          jobs_skipped: skipped,
          jobs_failed: failed + needsManual,
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
