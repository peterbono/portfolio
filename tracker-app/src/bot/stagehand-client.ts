/**
 * Stagehand client factory for AI-powered browser automation.
 *
 * Stagehand wraps Playwright with AI capabilities (act, observe, extract)
 * that allow natural-language browser interaction. Two modes:
 *   - LOCAL: uses local Playwright Chromium (default, no external deps)
 *   - BROWSERBASE: uses Browserbase cloud browsers (requires API key)
 *
 * Model: claude-haiku-4-5-20251001 for all AI operations (cost-efficient).
 */

import { Stagehand } from '@browserbasehq/stagehand'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StagehandConfig {
  /** Use Browserbase cloud instead of local Playwright (default: false) */
  useBrowserbase?: boolean
  /** Enable proxy (Browserbase-only, ignored for local) */
  proxy?: boolean
  /** Navigation timeout in ms (default: 30000) */
  timeout?: number
  /** Anthropic model to use for act/observe/extract (default: claude-haiku-4-5-20251001) */
  model?: string
  /** Enable verbose Stagehand logging (default: false) */
  verbose?: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'
const DEFAULT_TIMEOUT = 30_000

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create and initialize a Stagehand instance.
 *
 * Decision logic:
 *   1. If config.useBrowserbase=true AND BROWSERBASE_API_KEY is set: Browserbase cloud
 *   2. Otherwise: local Playwright Chromium
 *
 * The caller MUST call closeStagehand() when done to release resources.
 */
export async function createStagehand(config?: StagehandConfig): Promise<Stagehand> {
  const useBrowserbase =
    config?.useBrowserbase === true &&
    !!process.env.BROWSERBASE_API_KEY

  const model = config?.model ?? DEFAULT_MODEL
  const timeout = config?.timeout ?? DEFAULT_TIMEOUT

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicApiKey) {
    throw new Error(
      '[stagehand] ANTHROPIC_API_KEY is required for Stagehand AI operations (act/observe/extract)',
    )
  }

  if (useBrowserbase) {
    // ── Browserbase cloud mode ──
    const browserbaseApiKey = process.env.BROWSERBASE_API_KEY!
    const browserbaseProjectId = process.env.BROWSERBASE_PROJECT_ID

    console.log('[stagehand] Initializing in BROWSERBASE mode')

    const stagehand = new Stagehand({
      env: 'BROWSERBASE',
      apiKey: browserbaseApiKey,
      projectId: browserbaseProjectId,
      modelName: model,
      modelClientOptions: {
        apiKey: anthropicApiKey,
      },
      enableCaching: false,
      verbose: config?.verbose ? 1 : 0,
      browserbaseSessionCreateParams: {
        projectId: browserbaseProjectId!,
        ...(config?.proxy && {
          proxies: true,
        }),
      },
    })

    await stagehand.init()
    console.log('[stagehand] Browserbase session initialized')
    return stagehand
  }

  // ── Local Playwright mode ──
  console.log('[stagehand] Initializing in LOCAL mode (Playwright Chromium)')

  const stagehand = new Stagehand({
    env: 'LOCAL',
    modelName: model,
    modelClientOptions: {
      apiKey: anthropicApiKey,
    },
    enableCaching: false,
    verbose: config?.verbose ? 1 : 0,
    localBrowserLaunchOptions: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--js-flags=--max-old-space-size=256',
      ],
    },
  })

  await stagehand.init()

  // Set default navigation timeout on the underlying Playwright page
  stagehand.page.setDefaultNavigationTimeout(timeout)
  stagehand.page.setDefaultTimeout(timeout)

  console.log('[stagehand] Local Chromium session initialized')
  return stagehand
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Gracefully close a Stagehand instance, releasing the browser and any
 * Browserbase session.
 */
export async function closeStagehand(stagehand: Stagehand): Promise<void> {
  try {
    await stagehand.close()
    console.log('[stagehand] Session closed')
  } catch (err) {
    // Non-fatal — log and continue. The browser process may already be dead
    // (timeout, OOM) and close() would throw.
    console.warn(
      '[stagehand] Close failed (non-fatal):',
      err instanceof Error ? err.message : err,
    )
  }
}

// ---------------------------------------------------------------------------
// Utility: get the underlying Playwright page for low-level operations
// (file uploads, setInputFiles, etc. that Stagehand act() cannot do)
// ---------------------------------------------------------------------------

/**
 * Extract the raw Playwright Page from a Stagehand instance.
 * Useful for operations that require direct Playwright APIs:
 *   - page.setInputFiles() for CV upload
 *   - page.waitForSelector() for explicit waits
 *   - page.screenshot() for debug captures
 */
export function getPlaywrightPage(stagehand: Stagehand) {
  return stagehand.page
}
