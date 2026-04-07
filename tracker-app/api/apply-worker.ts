import { QueueClient } from '@vercel/queue'
import type { ApplyJobMessage } from './queue-apply'

/**
 * Vercel Queue consumer: processes ONE job application per invocation.
 *
 * Registered as a push-mode consumer for the "apply-jobs" topic via
 * vercel.json experimentalTriggers. Vercel invokes this route automatically
 * for each message published by api/queue-apply.ts.
 *
 * Per-job isolation benefits:
 *   - Each job gets a fresh Stagehand/Browserbase session (no cookie leaks)
 *   - Independent retry: if one job fails, others are unaffected
 *   - Parallel execution: Vercel scales consumer invocations automatically
 *   - 300s max execution — plenty for a single ~53s apply cycle
 *
 * This replaces the sequential loop in src/trigger/headless-apply.ts.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JOB_TIMEOUT_MS = 180_000 // 3 minutes per application (AI calls are slow)
const STAGEHAND_INIT_TIMEOUT_MS = 60_000 // 1 minute to spin up browser

// ---------------------------------------------------------------------------
// Queue client (Pages Router / @vercel/node style — uses handleNodeCallback)
// ---------------------------------------------------------------------------

const queue = new QueueClient()

// ---------------------------------------------------------------------------
// Consumer handler
// ---------------------------------------------------------------------------

export default queue.handleNodeCallback<ApplyJobMessage>(
  async (message, metadata) => {
    const jobStart = Date.now()
    const { jobUrl, company, role, coverLetterSnippet, matchScore, userId, runId, userProfile } =
      message

    console.log(
      `[apply-worker] Processing: ${company} — ${role} (msgId: ${metadata.messageId}, delivery: ${metadata.deliveryCount})`,
    )

    // ── Dynamic imports (heavy deps loaded only when actually processing) ──
    const { createStagehand, closeStagehand, getPlaywrightPage } = await import(
      '../src/bot/stagehand-client'
    )
    const { detectAdapterV2 } = await import('../src/bot/adapters-v2')
    const { APPLICANT } = await import('../src/bot/types')
    const {
      updateBotRun,
      logBotActivity,
      createApplicationFromBot,
    } = await import('../src/bot/supabase-server')

    // ── Build applicant profile ──
    const up = userProfile ?? {}
    const overrides: Record<string, string> = {}
    if (up.firstName) overrides.firstName = String(up.firstName)
    if (up.lastName) overrides.lastName = String(up.lastName)
    if (up.email) overrides.email = String(up.email)
    if (up.phone) overrides.phone = String(up.phone)
    if (up.location) overrides.location = String(up.location)
    if (up.linkedin) overrides.linkedin = String(up.linkedin)
    if (up.portfolio) overrides.portfolio = String(up.portfolio)
    if (up.cvUrl) overrides.cvUrl = String(up.cvUrl)
    if (up.currentCompany) overrides.currentCompany = String(up.currentCompany)

    const profile = {
      ...APPLICANT,
      ...overrides,
      // Per-job dynamic fields
      coverLetterSnippet: coverLetterSnippet || undefined,
      jobMeta: { company, role },
    }

    // ── Create Stagehand session ──
    let stagehand: Awaited<ReturnType<typeof createStagehand>> | null = null

    try {
      stagehand = await Promise.race([
        createStagehand({ timeout: 30_000 }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Stagehand initialization timeout')),
            STAGEHAND_INIT_TIMEOUT_MS,
          ),
        ),
      ])

      // ── Detect adapter and apply ──
      const adapter = detectAdapterV2(jobUrl)
      console.log(`[apply-worker]   Adapter: ${adapter.name}`)

      const applyResult = await Promise.race([
        adapter.apply(stagehand, jobUrl, profile, coverLetterSnippet || ''),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Job timeout: adapter did not complete within ${JOB_TIMEOUT_MS / 1000}s`,
                ),
              ),
            JOB_TIMEOUT_MS,
          ),
        ),
      ])

      const durationMs = Date.now() - jobStart

      console.log(
        `[apply-worker]   Result: ${applyResult.status}${applyResult.reason ? ` — ${applyResult.reason}` : ''} (${(durationMs / 1000).toFixed(1)}s)`,
      )

      // ── Write results to Supabase ──
      await logBotActivity({
        user_id: userId,
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
      }).catch((err) =>
        console.warn('[apply-worker] Log activity error:', err),
      )

      await createApplicationFromBot(
        userId,
        {
          title: applyResult.role,
          company: applyResult.company,
          location: profile.location,
          url: jobUrl,
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
          duration: durationMs,
        },
      ).catch((err) =>
        console.warn('[apply-worker] Create application error:', err),
      )

      // ── Update bot_run aggregate counts ──
      // We increment the appropriate counter. Since multiple workers run in
      // parallel, each does an atomic increment via a Supabase RPC or
      // a read-then-write. For simplicity we do a partial update — the
      // final "completed" status is set by a separate finalizer or when
      // the dashboard polls.
      const counterField =
        applyResult.status === 'applied'
          ? 'jobs_applied'
          : applyResult.status === 'skipped'
            ? 'jobs_skipped'
            : applyResult.status === 'needs_manual'
              ? 'jobs_needs_manual'
              : 'jobs_failed'

      await updateBotRun(runId, {
        // Increment pattern: Supabase doesn't have native increment,
        // so we use the last-write-wins approach. The queue-apply producer
        // or a finalizer will reconcile totals from bot_activity_log.
        [counterField]: { __increment: 1 },
      }).catch((err) =>
        console.warn('[apply-worker] Update run error:', err),
      )

      // ── Send notification for successful applies ──
      if (applyResult.status === 'applied') {
        sendNotification(userId, 'application_submitted', {
          company: applyResult.company,
          role: applyResult.role,
          count: 1,
        }).catch(() => {})
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[apply-worker]   Error: ${errMsg}`)

      // ── Try to capture error screenshot ──
      let screenshotBase64: string | undefined
      if (stagehand) {
        try {
          const page = getPlaywrightPage(stagehand)
          const buf = await Promise.race([
            page.screenshot({ type: 'jpeg', quality: 60 }),
            new Promise<undefined>((resolve) =>
              setTimeout(() => resolve(undefined), 5_000),
            ),
          ])
          if (buf) screenshotBase64 = buf.toString('base64')
        } catch {
          // Screenshot capture failed — non-fatal
        }
      }

      const durationMs = Date.now() - jobStart

      // ── Log failure to Supabase ──
      await logBotActivity({
        user_id: userId,
        run_id: runId,
        action: 'failed',
        company,
        role,
        ats: 'Unknown',
        reason: errMsg,
        screenshot_url: screenshotBase64,
      }).catch((logErr) =>
        console.warn('[apply-worker] Log failure error:', logErr),
      )

      await createApplicationFromBot(
        userId,
        {
          title: role,
          company,
          location: 'Remote',
          url: jobUrl,
          ats: 'Unknown',
        },
        {
          success: false,
          status: 'failed',
          company,
          role,
          ats: 'Unknown',
          reason: errMsg,
          screenshotUrl: screenshotBase64,
          duration: durationMs,
        },
      ).catch((appErr) =>
        console.warn('[apply-worker] Create failed application error:', appErr),
      )

      await updateBotRun(runId, {
        jobs_failed: { __increment: 1 },
      }).catch(() => {})

      // ── Send error notification ──
      sendNotification(userId, 'bot_error', {
        errorMessage: `Failed to apply at ${company}: ${errMsg}`,
        runId,
      }).catch(() => {})

      // Re-throw so Vercel Queues retries the message (if retries configured)
      throw err
    } finally {
      // Always close Stagehand to release browser resources
      if (stagehand) {
        await closeStagehand(stagehand).catch(() => {})
      }
    }
  },
  {
    // 5-minute visibility timeout — auto-extended by the SDK while handler runs.
    // Matches the max expected apply duration (~3 min + buffer).
    visibilityTimeoutSeconds: 300,

    // Custom retry: exponential backoff, give up after 3 attempts.
    // Most failures are deterministic (wrong page, CSP block) so retrying
    // more than 3 times wastes resources.
    retry: (error, metadata) => {
      if (metadata.deliveryCount >= 3) {
        console.log(
          `[apply-worker] Giving up after ${metadata.deliveryCount} attempts (msgId: ${metadata.messageId})`,
        )
        return { acknowledge: true }
      }
      // Exponential backoff: 10s, 20s, 40s
      const delay = Math.min(60, 10 * 2 ** (metadata.deliveryCount - 1))
      console.log(
        `[apply-worker] Retrying in ${delay}s (attempt ${metadata.deliveryCount}, msgId: ${metadata.messageId})`,
      )
      return { afterSeconds: delay }
    },
  },
)

// ---------------------------------------------------------------------------
// Notification helper (same pattern as headless-apply.ts)
// ---------------------------------------------------------------------------

async function sendNotification(
  userId: string,
  type: 'application_submitted' | 'bot_error',
  data: Record<string, unknown>,
): Promise<void> {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || 'https://tracker-app-lyart.vercel.app'
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    console.warn(
      '[apply-worker] Cannot send notification: SUPABASE_SERVICE_ROLE_KEY not set',
    )
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
      console.log(
        `[apply-worker] Notification sent: ${type} (emailId: ${result.emailId})`,
      )
    }
  } catch (err) {
    console.warn(
      '[apply-worker] Notification failed:',
      err instanceof Error ? err.message : err,
    )
  }
}
