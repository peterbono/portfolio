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

const DEFAULT_MODEL_NAME = 'anthropic/claude-haiku-4-5-20251001'
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

  const modelName = config?.model
    ? (config.model.includes('/') ? config.model : `anthropic/${config.model}`)
    : DEFAULT_MODEL_NAME
  const timeout = config?.timeout ?? DEFAULT_TIMEOUT

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicApiKey) {
    throw new Error(
      '[stagehand] ANTHROPIC_API_KEY is required for Stagehand AI operations (act/observe/extract)',
    )
  }

  // Stagehand v3 uses AI Gateway-style model strings ("provider/model")
  // and reads ANTHROPIC_API_KEY from env automatically via @ai-sdk/anthropic
  const modelConfig = { modelName, apiKey: anthropicApiKey }

  if (useBrowserbase) {
    // ── Browserbase cloud mode ──
    const browserbaseApiKey = process.env.BROWSERBASE_API_KEY!
    const browserbaseProjectId = process.env.BROWSERBASE_PROJECT_ID

    console.log('[stagehand] Initializing in BROWSERBASE mode')

    const stagehand = new Stagehand({
      env: 'BROWSERBASE',
      apiKey: browserbaseApiKey,
      projectId: browserbaseProjectId,
      model: modelConfig,
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
  // Auto-detect Chromium path for Stagehand in Trigger.dev containers
  let executablePath: string | undefined
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    const fs = await import('fs')
    const browsersDir = process.env.PLAYWRIGHT_BROWSERS_PATH
    try {
      const entries = fs.readdirSync(browsersDir).filter((e: string) => e.startsWith('chromium')).sort()
      for (const entry of entries.reverse()) {
        const candidates = [
          `${browsersDir}/${entry}/chrome-linux/chrome`,
          `${browsersDir}/${entry}/chrome`,
          `${browsersDir}/${entry}/chromium`,
        ]
        for (const p of candidates) {
          if (fs.existsSync(p)) {
            executablePath = p
            process.env.CHROME_PATH = p
            console.log(`[stagehand] Found Chromium at: ${p}`)
            break
          }
        }
        if (executablePath) break
      }
      if (!executablePath) {
        // List what's actually in the browsers dir for debugging
        const contents = fs.readdirSync(browsersDir)
        console.log(`[stagehand] PLAYWRIGHT_BROWSERS_PATH=${browsersDir}, contents: ${contents.join(', ')}`)
        for (const c of contents.slice(0, 3)) {
          try {
            const sub = fs.readdirSync(`${browsersDir}/${c}`)
            console.log(`[stagehand]   ${c}/ → ${sub.join(', ')}`)
          } catch { /* not a dir */ }
        }
      }
    } catch (e) {
      console.log(`[stagehand] Chrome path detection error: ${(e as Error).message}`)
    }
  }

  console.log(`[stagehand] Initializing in LOCAL mode (executablePath: ${executablePath || 'default'})`)

  const stagehand = new Stagehand({
    env: 'LOCAL',
    model: modelConfig,
    enableCaching: false,
    verbose: config?.verbose ? 1 : 0,
    localBrowserLaunchOptions: {
      headless: true,
      ...(executablePath && { executablePath }),
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
 * In Stagehand v3, there's no .page property — use context.pages()[0].
 * Useful for operations that require direct Playwright APIs:
 *   - page.setInputFiles() for CV upload
 *   - page.waitForSelector() for explicit waits
 *   - page.screenshot() for debug captures
 */
export function getPlaywrightPage(stagehand: Stagehand) {
  const pages = stagehand.context.pages()
  if (!pages.length) throw new Error('[stagehand] No pages available in context')
  return pages[0]
}
