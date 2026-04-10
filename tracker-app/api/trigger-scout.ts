import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  createBotRun,
  updateBotRun,
  logBotActivity,
} from '../src/bot/supabase-server.js'

/**
 * API route: POST /api/trigger-scout
 *
 * Scout-only entry point. Runs the full pipeline minus the apply phase:
 *   scout → pre-filter → qualify → persistDiscoveredJobs → return
 *
 * Called by the Autopilot config page when the user clicks "Save & scout".
 * Populates the `job_listings` table so OpenJobsView has rows to render
 * BEFORE the user commits to an apply batch (which goes through
 * /api/queue-apply → /api/apply-worker).
 *
 * Contract:
 *   Body:     { userId, searchConfig, userProfile }
 *   200:      { runId, status: 'running' | 'completed' }
 *   400:      { error }                      — validation failure
 *   500:      { error, runId? }              — scout failed, runId for logs
 *
 * Runtime model:
 *   maxDuration = 300s (see vercel.json)
 *
 *   We AWAIT the full pipeline rather than fire-and-forget because Vercel
 *   serverless functions are frozen after res.send() returns. "Background"
 *   unawaited promises silently die. Fluid Compute + ctx.waitUntil would
 *   unblock that, but we don't have that wired yet.
 *
 *   Practical impact: the HTTP request takes 2–5 min. The frontend shows a
 *   spinner. Client-side fetch timeout must be >=300s (or use polling via
 *   bot_runs.id returned in the response once this is upgraded to
 *   waitUntil).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LocationRule {
  type: string
  value: string
  workArrangement: string
  minSalary?: number
  currency?: string
}

interface SearchConfig {
  keywords: string[]
  locationRules: LocationRule[]
  excludedCompanies?: string[]
  dailyLimit?: number
}

interface TriggerScoutRequest {
  userId: string
  searchConfig: SearchConfig
  userProfile?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ValidationResult =
  | { ok: true; data: TriggerScoutRequest }
  | { ok: false; error: string }

function validateRequest(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Request body required' }
  }
  const b = body as Record<string, unknown>

  if (typeof b.userId !== 'string' || !UUID_RE.test(b.userId)) {
    return { ok: false, error: 'userId (UUID string) required' }
  }

  if (!b.searchConfig || typeof b.searchConfig !== 'object') {
    return { ok: false, error: 'searchConfig (object) required' }
  }
  const sc = b.searchConfig as Record<string, unknown>

  if (!Array.isArray(sc.keywords) || sc.keywords.length === 0) {
    return { ok: false, error: 'searchConfig.keywords (non-empty array) required' }
  }
  if (!sc.keywords.every((k) => typeof k === 'string' && k.length > 0)) {
    return { ok: false, error: 'searchConfig.keywords must be non-empty strings' }
  }

  if (!Array.isArray(sc.locationRules)) {
    return { ok: false, error: 'searchConfig.locationRules (array) required' }
  }

  return {
    ok: true,
    data: {
      userId: b.userId,
      searchConfig: {
        keywords: sc.keywords as string[],
        locationRules: (sc.locationRules as LocationRule[]) ?? [],
        excludedCompanies: Array.isArray(sc.excludedCompanies)
          ? (sc.excludedCompanies as string[])
          : [],
        dailyLimit:
          typeof sc.dailyLimit === 'number' ? sc.dailyLimit : undefined,
      },
      userProfile:
        b.userProfile && typeof b.userProfile === 'object'
          ? (b.userProfile as Record<string, unknown>)
          : {},
    },
  }
}

// ---------------------------------------------------------------------------
// Browser helper — SBR reconnect with local Chromium fallback
// ---------------------------------------------------------------------------

async function launchScoutBrowser() {
  // Lazy import: playwright is ~50MB compiled; don't pay it on cold start
  // unless we're actually running a scout.
  const { chromium } = await import('playwright')

  const sbrAuth = (process.env.BRIGHTDATA_SBR_AUTH || '').trim()
  if (sbrAuth) {
    try {
      console.log('[trigger-scout] Connecting to Bright Data SBR...')
      const browser = await Promise.race([
        chromium.connectOverCDP(`wss://${sbrAuth}@brd.superproxy.io:9222`),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('SBR connect timeout (30s)')),
            30_000,
          ),
        ),
      ])
      console.log('[trigger-scout] SBR connected')
      return { browser, source: 'sbr' as const }
    } catch (err) {
      console.warn(
        `[trigger-scout] SBR connect failed: ${(err as Error).message} — falling back to local Chromium`,
      )
    }
  }

  console.log('[trigger-scout] Launching local headless Chromium...')
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--js-flags=--max-old-space-size=256',
    ],
  })
  return { browser, source: 'local' as const }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  // CORS (matches other /api routes)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'POST only' })

  // ── Validate ──
  const validation = validateRequest(req.body)
  if (!validation.ok) {
    console.warn(`[trigger-scout] Validation failed: ${validation.error}`)
    return res.status(400).json({ error: validation.error })
  }
  const { userId, searchConfig, userProfile } = validation.data

  console.log(
    `[trigger-scout] Incoming scout request: user=${userId} keywords=${searchConfig.keywords.join(
      ',',
    )} locations=${searchConfig.locationRules.length}`,
  )

  // ── Create bot_run up front so the client can poll even if scout crashes ──
  // Using service_role key inside supabase-server bypasses RLS.
  let runId: string
  try {
    runId = await createBotRun(userId, `scout-${Date.now()}`)
    console.log(`[trigger-scout] Created bot_run ${runId}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[trigger-scout] createBotRun failed: ${msg}`)
    return res
      .status(500)
      .json({ error: `Failed to create run record: ${msg}` })
  }

  // Record the start as a discrete activity so the UI can show "Scout started"
  // before the first scout batch completes. Fire-and-forget — don't block the
  // request on this.
  logBotActivity({
    user_id: userId,
    run_id: runId,
    action: 'pipeline_start',
    reason: `Scout-only run (keywords: ${searchConfig.keywords.join(', ')})`,
  }).catch((e) =>
    console.warn('[trigger-scout] logBotActivity start failed:', (e as Error).message),
  )

  // ── Return runId IMMEDIATELY, run pipeline in background ──
  // The frontend needs the runId to start polling. The actual pipeline
  // takes 60-180s; awaiting it here would block the Save button. On Vercel
  // Node runtime, an unawaited promise after res.send() continues running
  // until the function naturally completes (up to maxDuration=300s).
  //
  // Errors during the background pipeline are recorded via updateBotRun
  // (status='failed') so the client polling sees them.
  res.status(200).json({ runId, status: 'running' })

  // Background work — fire-and-forget. Wrapped in IIFE to use async/await
  // and centralize error handling. Note: we MUST NOT touch `res` after this.
  void (async () => {
    let browserInfo: Awaited<ReturnType<typeof launchScoutBrowser>> | null = null
    try {
      browserInfo = await launchScoutBrowser()

      const { runPipelineFromInline } = await import(
        '../src/bot/orchestrator.js'
      )

      console.log(`[trigger-scout] Starting pipeline (runId=${runId}) [background]`)
      const result = await runPipelineFromInline({
        userId,
        browser: browserInfo.browser,
        searchConfig: {
          keywords: searchConfig.keywords,
          locationRules: searchConfig.locationRules,
          excludedCompanies: searchConfig.excludedCompanies ?? [],
          dailyLimit: searchConfig.dailyLimit ?? 20,
        },
        userProfile: userProfile ?? {},
        dryRun: true,
        skipApply: true,
        runId,
      })

      console.log(
        `[trigger-scout] Pipeline done: found=${result.jobsFound} qualified=${result.jobsQualified} duration=${Math.round(result.duration / 1000)}s`,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[trigger-scout] Pipeline error (runId=${runId}): ${msg}`)

      // Mark the run as failed so the client sees an accurate status on poll.
      await updateBotRun(runId, {
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: msg,
      }).catch((e) =>
        console.warn(
          '[trigger-scout] updateBotRun(failed) failed:',
          (e as Error).message,
        ),
      )
    } finally {
      if (browserInfo) {
        try {
          await browserInfo.browser.close()
          console.log(`[trigger-scout] Browser closed (source=${browserInfo.source})`)
        } catch (e) {
          console.warn(
            '[trigger-scout] browser.close failed:',
            (e as Error).message,
          )
        }
      }
    }
  })()
}
