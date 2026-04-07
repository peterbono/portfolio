/**
 * Headless Apply Task — Stagehand-powered AI browser automation.
 *
 * Alternative to apply-jobs.ts that uses Stagehand (AI-driven Playwright)
 * instead of raw Playwright with CSS selectors. Benefits:
 *   - Works on ANY ATS without writing per-platform selectors
 *   - Self-healing: AI adapts to DOM changes automatically
 *   - Fewer lines of adapter code (act/observe/extract vs. selector chains)
 *
 * Same payload/output contract as apply-jobs.ts for drop-in compatibility
 * with the existing pipeline dispatcher.
 *
 * Cost model: each act()/observe()/extract() call uses ~100-500 Haiku tokens.
 * Estimated ~$0.002-0.005 per application (vs. $0 for raw Playwright).
 */

import { task, metadata } from '@trigger.dev/sdk/v3'
import type {
  ApplyJobPayload,
  ApplyJobResult,
  ApplyJobsOutput,
} from './apply-jobs'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_APPLICATIONS_PER_RUN = 20
const GAP_BETWEEN_JOBS_MS = 15_000 // 15s gap between applications
const JOB_TIMEOUT_MS = 180_000 // 3 minutes per job (Stagehand AI calls are slower)
const STAGEHAND_INIT_TIMEOUT_MS = 60_000 // 1 minute to initialize browser + AI

// ---------------------------------------------------------------------------
// Server-side notification helper (identical to apply-jobs.ts)
// ---------------------------------------------------------------------------

async function sendServerNotification(
  userId: string,
  type: 'application_submitted' | 'bot_error',
  data: Record<string, unknown>,
): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tracker-app-lyart.vercel.app'
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    console.warn('[headless-apply] Cannot send notification: SUPABASE_SERVICE_ROLE_KEY not set')
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
      signal: AbortSignal.timeout(10_000),
    })
    const result = await res.json()
    if (res.ok && result.sent) {
      console.log(`[headless-apply] Notification sent: ${type} (emailId: ${result.emailId})`)
    } else {
      console.warn(`[headless-apply] Notification not sent: ${type}`, result.reason || result.error || res.status)
    }
  } catch (err) {
    console.warn('[headless-apply] Notification fetch failed:', err instanceof Error ? err.message : err)
  }
}

// ---------------------------------------------------------------------------
// Task definition
// ---------------------------------------------------------------------------

export const headlessApplyTask = task({
  id: 'headless-apply',
  machine: 'small-2x', // 2 vCPU, 2 GB — Stagehand local needs Chromium
  maxDuration: 1800, // 30 minutes

  run: async (payload: {
    userId: string
    jobs: ApplyJobPayload[]
    userProfile: Record<string, unknown>
    /** Whether to use Browserbase cloud (default: false = local Playwright) */
    useBrowserbase?: boolean
  }): Promise<ApplyJobsOutput> => {
    const runStart = Date.now()

    // ── Dynamic imports (only available in Trigger.dev worker) ──
    const { createStagehand, closeStagehand } = await import('../bot/stagehand-client')
    const { detectAdapterV2 } = await import('../bot/adapters-v2')
    const { APPLICANT } = await import('../bot/types')
    const {
      createBotRun,
      updateBotRun,
      logBotActivity,
      createApplicationFromBot,
    } = await import('../bot/supabase-server')

    // ── Build applicant profile from payload + defaults ──
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
    }

    // ── Cap job count ──
    const jobsToApply = payload.jobs.slice(0, MAX_APPLICATIONS_PER_RUN)
    console.log(
      `[headless-apply] Processing ${jobsToApply.length}/${payload.jobs.length} jobs (cap: ${MAX_APPLICATIONS_PER_RUN})`,
    )

    // ── Filter Ashby jobs (CSP blocks headless — same as apply-jobs.ts) ──
    const ashbyJobs = jobsToApply.filter((j) => /ashbyhq\.com/i.test(j.url))
    const applicableJobs = jobsToApply.filter((j) => !/ashbyhq\.com/i.test(j.url))

    // ── Initialize metadata ──
    metadata.set('progress', {
      phase: 'initializing',
      engine: 'stagehand',
      totalJobs: jobsToApply.length,
      processed: 0,
      applied: 0,
      failed: 0,
      skipped: 0,
      needsManual: 0,
      currentJob: null,
      startedAt: new Date().toISOString(),
    })

    // ── Create bot run in Supabase ──
    let runId: string | undefined
    try {
      runId = await createBotRun(payload.userId, `headless-apply-${Date.now()}`)
      console.log(`[headless-apply] Created bot run: ${runId}`)
    } catch (err) {
      console.warn('[headless-apply] Could not create bot run in DB:', err)
    }

    const results: ApplyJobResult[] = []
    let applied = 0
    let skipped = 0
    let failed = 0
    let needsManual = 0

    // ── Pre-fill Ashby results ──
    if (ashbyJobs.length > 0) {
      console.log(`[headless-apply] ${ashbyJobs.length} Ashby jobs -> needs_manual (CSP blocks headless)`)
      for (const aj of ashbyJobs) {
        results.push({
          url: aj.url,
          company: aj.company,
          role: aj.role,
          ats: 'Ashby',
          status: 'needs_manual',
          reason: `Ashby blocks headless browsers — apply manually at: ${aj.url}`,
          durationMs: 0,
        })
        needsManual++
      }
    }

    // ── Process applicable jobs ──
    let fatalError: Error | undefined

    try {
      for (let i = 0; i < applicableJobs.length; i++) {
        const job = applicableJobs[i]
        const jobStart = Date.now()

        console.log(
          `[headless-apply] [${i + 1}/${applicableJobs.length}] ${job.company} — ${job.role}`,
        )

        // Update live progress metadata
        metadata.set('progress', {
          phase: 'applying',
          engine: 'stagehand',
          totalJobs: jobsToApply.length,
          processed: results.length,
          applied,
          failed,
          skipped,
          needsManual,
          currentJob: {
            company: job.company,
            role: job.role,
            index: i + 1,
            total: applicableJobs.length,
          },
          startedAt: new Date().toISOString(),
        })

        // ── Create a fresh Stagehand instance per job ──
        // This ensures clean browser state (no cookie/session leaks between jobs)
        // and avoids Stagehand page navigation issues.
        let stagehand: Awaited<ReturnType<typeof createStagehand>> | null = null

        try {
          // Initialize Stagehand with timeout
          stagehand = await Promise.race([
            createStagehand({
              useBrowserbase: payload.useBrowserbase ?? false,
              timeout: 30_000,
            }),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error('Stagehand initialization timeout')),
                STAGEHAND_INIT_TIMEOUT_MS,
              ),
            ),
          ])

          // Thread per-job metadata into profile
          profile.coverLetterSnippet = job.coverLetterSnippet || undefined
          profile.jobMeta = { company: job.company, role: job.role }

          // Detect adapter and apply
          const adapter = detectAdapterV2(job.url)
          console.log(`[headless-apply]   Adapter: ${adapter.name}`)

          const applyResult = await Promise.race([
            adapter.apply(
              stagehand,
              job.url,
              profile,
              job.coverLetterSnippet || '',
            ),
            new Promise<ApplyJobResult>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Job timeout: adapter did not complete within ${JOB_TIMEOUT_MS / 1000}s`)),
                JOB_TIMEOUT_MS,
              ),
            ),
          ])

          // Record result
          results.push(applyResult)

          switch (applyResult.status) {
            case 'applied':
              applied++
              break
            case 'skipped':
              skipped++
              break
            case 'failed':
              failed++
              break
            case 'needs_manual':
              needsManual++
              break
          }

          // ── Log to Supabase ──
          if (runId) {
            await logBotActivity({
              user_id: payload.userId,
              run_id: runId,
              action:
                applyResult.status === 'applied'
                  ? 'applied'
                  : applyResult.status === 'skipped'
                    ? 'skipped'
                    : 'failed',
              company: applyResult.company,
              role: applyResult.role,
              ats: applyResult.ats,
              reason: applyResult.reason,
              screenshot_url: applyResult.screenshotBase64,
            }).catch((err) => console.warn('[headless-apply] Log activity error:', err))

            await createApplicationFromBot(
              payload.userId,
              {
                title: applyResult.role,
                company: applyResult.company,
                location: profile.location,
                url: job.url,
                ats: applyResult.ats,
              },
              {
                success: applyResult.status === 'applied',
                status: applyResult.status,
                company: applyResult.company,
                role: applyResult.role,
                ats: applyResult.ats,
                reason: applyResult.reason,
                screenshotUrl: applyResult.screenshotBase64,
                duration: applyResult.durationMs,
              },
            ).catch((err) => console.warn('[headless-apply] Create application error:', err))
          }

          console.log(
            `[headless-apply]   Result: ${applyResult.status}${applyResult.reason ? ` — ${applyResult.reason}` : ''}`,
          )

        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          console.error(`[headless-apply]   Error: ${errMsg}`)

          // Try to capture screenshot from Stagehand's page
          let screenshotBase64: string | undefined
          if (stagehand) {
            try {
              const buf = await Promise.race([
                stagehand.page.screenshot({ type: 'jpeg', quality: 60 }),
                new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5_000)),
              ])
              if (buf) screenshotBase64 = buf.toString('base64')
            } catch {
              // Screenshot failed
            }
          }

          const result: ApplyJobResult = {
            url: job.url,
            company: job.company,
            role: job.role,
            ats: 'Unknown',
            status: 'failed',
            reason: errMsg,
            screenshotBase64,
            durationMs: Date.now() - jobStart,
          }
          results.push(result)
          failed++
        } finally {
          // Always close Stagehand to release browser resources
          if (stagehand) {
            await closeStagehand(stagehand)
          }
        }

        // ── Rate limiting: 15s gap between jobs (skip for last) ──
        if (i < applicableJobs.length - 1) {
          const jitter = Math.floor(Math.random() * 5000)
          const delay = GAP_BETWEEN_JOBS_MS + jitter
          console.log(`[headless-apply]   Waiting ${(delay / 1000).toFixed(1)}s before next application...`)
          await new Promise((r) => setTimeout(r, delay))
        }
      }
    } catch (err) {
      fatalError = err instanceof Error ? err : new Error(String(err))
      console.error(`[headless-apply] FATAL ERROR: ${fatalError.message}`)
    } finally {
      // ── Update metadata with final state ──
      metadata.set('progress', {
        phase: fatalError ? 'crashed' : 'completed',
        engine: 'stagehand',
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

      // ── Update bot run in Supabase ──
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
        }).catch((err) => console.warn('[headless-apply] Update run error:', err))
      }

      console.log(
        `[headless-apply] Done (${runStatus}): ${applied} applied, ${skipped} skipped, ${failed} failed, ${needsManual} manual — ${(totalDuration / 1000).toFixed(1)}s`,
      )

      // ── Send notifications (fire-and-forget) ──
      if (applied > 0) {
        const appliedResults = results.filter((r) => r.status === 'applied')
        const firstApplied = appliedResults[0]
        sendServerNotification(payload.userId, 'application_submitted', {
          company: firstApplied?.company ?? 'Unknown',
          role: firstApplied?.role ?? 'Unknown Role',
          count: applied,
        }).catch(() => {})
      }

      if (applied === 0 && (failed > 0 || fatalError)) {
        const failReasons = fatalError
          ? `CRASH: ${fatalError.message}`
          : results
              .filter((r) => r.status === 'failed')
              .map((r) => `${r.company}: ${r.reason}`)
              .slice(0, 3)
              .join('; ')
        sendServerNotification(payload.userId, 'bot_error', {
          errorMessage: fatalError
            ? `Run crashed: ${fatalError.message}. ${applied} applied, ${failed} failed before crash.`
            : `All ${failed} application(s) failed. ${failReasons}`,
          runId: runId ?? `headless-apply-${runStart}`,
        }).catch(() => {})
      }
    }

    // Re-throw fatal errors so Trigger.dev marks the task as failed
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
