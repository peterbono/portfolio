import type { Page, BrowserContext } from 'playwright'
import type { ApplicantProfile } from './types'
import { supabaseServer } from './supabase-server'

// ---------------------------------------------------------------------------
// Resource blocking — reduces Bright Data bandwidth by ~70%
// ---------------------------------------------------------------------------

/** Tracker/analytics URL patterns to block */
const TRACKER_PATTERN = /google-analytics|googletagmanager|facebook\.net|doubleclick|hotjar|segment\.io|mixpanel/

/**
 * Block unnecessary resources on a browser context to reduce bandwidth.
 *
 * @param context - Playwright BrowserContext to attach route interception to
 * @param mode - 'aggressive' blocks images, CSS, fonts, media, trackers (scout/qualify).
 *               'moderate' keeps CSS but blocks images, fonts, media, trackers (apply phase — ATS forms need CSS).
 */
export async function blockUnnecessaryResources(
  context: BrowserContext,
  mode: 'aggressive' | 'moderate' = 'aggressive',
): Promise<void> {
  const blockedExtensions = mode === 'aggressive'
    ? '**/*.{png,jpg,jpeg,gif,webp,svg,ico,bmp,css,woff,woff2,ttf,otf,eot,mp4,webm,mp3,wav}'
    : '**/*.{png,jpg,jpeg,gif,webp,svg,ico,bmp,woff,woff2,ttf,otf,eot,mp4,webm,mp3,wav}'

  await context.route(blockedExtensions, (route) => route.abort())
  await context.route(TRACKER_PATTERN, (route) => route.abort())

  console.log(`[helpers] Resource blocking enabled (mode: ${mode})`)
}

// ---------------------------------------------------------------------------
// Standard compressed variant filenames (created by compress-pdf task)
// ---------------------------------------------------------------------------
const VARIANT_FILES = [
  { name: 'cv-10mb.pdf', quality: 'high' },
  { name: 'cv-5mb.pdf', quality: 'medium' },
  { name: 'cv-2mb.pdf', quality: 'low' },
] as const

/**
 * Solve CAPTCHA via Bright Data Scraping Browser's CDP command.
 * Returns true if solved, false if no CAPTCHA or not using Scraping Browser.
 */
export async function solveCaptchaIfPresent(page: Page, timeout = 30000): Promise<boolean> {
  try {
    const client = await page.context().newCDPSession(page)
    const result = await client.send('Captcha.waitForSolve', { detectTimeout: timeout } as any)
    return (result as any)?.status === 'solved'
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// CAPTCHA solver integration
// ---------------------------------------------------------------------------
// CapSolver: used for reCAPTCHA v2/v3 (hCaptcha support was DROPPED ~Q1 2026)
// 2Captcha:  used for hCaptcha (still fully supported)
// ---------------------------------------------------------------------------

const CAPSOLVER_CREATE_URL = 'https://api.capsolver.com/createTask'
const CAPSOLVER_RESULT_URL = 'https://api.capsolver.com/getTaskResult'

const TWOCAPTCHA_CREATE_URL = 'https://api.2captcha.com/createTask'
const TWOCAPTCHA_RESULT_URL = 'https://api.2captcha.com/getTaskResult'
const CAPTCHA_POLL_INTERVAL_MS = 3_000
const CAPTCHA_MAX_POLL_ATTEMPTS = 40 // ~2 minutes max

/**
 * Solve an hCaptcha challenge using 2Captcha's API (primary) or CapSolver (fallback).
 *
 * CapSolver dropped hCaptcha support in early 2026 (returns ERROR_INVALID_TASK_DATA
 * immediately). 2Captcha still supports it via HCaptchaTaskProxyless.
 *
 * Requires TWO_CAPTCHA_API_KEY (primary) or CAPSOLVER_API_KEY (fallback) env var.
 * Returns the hCaptcha response token on success, or null on failure.
 *
 * @param websiteUrl - The page URL where hCaptcha is displayed
 * @param websiteKey - The hCaptcha site key (data-sitekey attribute)
 */
export async function solveHCaptchaViaCapsolver(
  websiteUrl: string,
  websiteKey: string,
): Promise<string | null> {
  // Try 2Captcha first (primary hCaptcha solver)
  const twoCaptchaKey = process.env.TWO_CAPTCHA_API_KEY
  if (twoCaptchaKey) {
    console.log(`[2captcha] Attempting hCaptcha solve for ${websiteUrl} (siteKey: ${websiteKey})`)
    const token = await solveHCaptchaWith2Captcha(websiteUrl, websiteKey, twoCaptchaKey)
    if (token) return token
    console.warn('[2captcha] hCaptcha solve failed — trying CapSolver fallback')
  } else {
    console.log('[2captcha] TWO_CAPTCHA_API_KEY not set — skipping 2Captcha')
  }

  // Fallback: try CapSolver (may not work — they dropped hCaptcha support)
  const capsolverKey = process.env.CAPSOLVER_API_KEY
  if (!capsolverKey) {
    console.warn('[capsolver] Neither TWO_CAPTCHA_API_KEY nor CAPSOLVER_API_KEY set — cannot solve hCaptcha')
    return null
  }

  console.log(`[capsolver] Attempting hCaptcha solve for ${websiteUrl} (siteKey: ${websiteKey})`)
  console.log(`[capsolver] WARNING: CapSolver dropped hCaptcha support — this will likely fail`)
  return await solveHCaptchaWithCapsolver(websiteUrl, websiteKey, capsolverKey)
}

/**
 * Solve hCaptcha via 2Captcha API (compatible with the standard captcha protocol).
 */
async function solveHCaptchaWith2Captcha(
  websiteUrl: string,
  websiteKey: string,
  apiKey: string,
): Promise<string | null> {
  try {
    const createResponse = await fetch(TWOCAPTCHA_CREATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: 'HCaptchaTaskProxyless',
          websiteURL: websiteUrl,
          websiteKey,
        },
      }),
    })

    console.log(`[2captcha] createTask HTTP status: ${createResponse.status}`)

    if (!createResponse.ok) {
      const errBody = await createResponse.text().catch(() => '<empty>')
      console.warn(`[2captcha] createTask HTTP error ${createResponse.status}: ${errBody}`)
      return null
    }

    const createData = (await createResponse.json()) as {
      errorId: number
      errorCode?: string
      errorDescription?: string
      taskId?: string
    }

    console.log(`[2captcha] createTask response: ${JSON.stringify(createData)}`)

    if (createData.errorId !== 0 || !createData.taskId) {
      console.warn(
        `[2captcha] createTask failed: ${createData.errorCode} — ${createData.errorDescription}`,
      )
      return null
    }

    const taskId = createData.taskId
    console.log(`[2captcha] Task created: ${taskId} — polling for result...`)

    return await pollForCaptchaResult(TWOCAPTCHA_RESULT_URL, apiKey, taskId, '2captcha')
  } catch (error) {
    console.error(
      '[2captcha] Unexpected error:',
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

/**
 * Solve hCaptcha via CapSolver API (legacy fallback — likely to fail since Q1 2026).
 */
async function solveHCaptchaWithCapsolver(
  websiteUrl: string,
  websiteKey: string,
  apiKey: string,
): Promise<string | null> {
  try {
    console.log(`[capsolver] API key present: true, length: ${apiKey.length}`)

    const createResponse = await fetch(CAPSOLVER_CREATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: 'HCaptchaTaskProxyless',
          websiteURL: websiteUrl,
          websiteKey,
        },
      }),
    })

    console.log(`[capsolver] createTask HTTP status: ${createResponse.status}`)

    if (!createResponse.ok) {
      const errBody = await createResponse.text().catch(() => '<empty>')
      console.warn(`[capsolver] createTask HTTP error ${createResponse.status}: ${errBody}`)
      return null
    }

    const createData = (await createResponse.json()) as {
      errorId: number
      errorCode?: string
      errorDescription?: string
      taskId?: string
    }

    console.log(`[capsolver] createTask full response: ${JSON.stringify(createData)}`)

    if (createData.errorId !== 0 || !createData.taskId) {
      // CapSolver dropped hCaptcha — this is the expected error path
      if (createData.errorCode === 'ERROR_INVALID_TASK_DATA') {
        console.warn(
          `[capsolver] hCaptcha NOT SUPPORTED by CapSolver: ${createData.errorDescription}. ` +
          `Set TWO_CAPTCHA_API_KEY env var to use 2Captcha instead.`,
        )
      } else {
        console.warn(
          `[capsolver] createTask failed: ${createData.errorCode} — ${createData.errorDescription}`,
        )
      }
      return null
    }

    const taskId = createData.taskId
    console.log(`[capsolver] Task created: ${taskId} — polling for result...`)

    return await pollForCaptchaResult(CAPSOLVER_RESULT_URL, apiKey, taskId, 'capsolver')
  } catch (error) {
    console.error(
      '[capsolver] Unexpected error:',
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

/**
 * Shared polling logic for both 2Captcha and CapSolver.
 */
async function pollForCaptchaResult(
  resultUrl: string,
  apiKey: string,
  taskId: string,
  label: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < CAPTCHA_MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, CAPTCHA_POLL_INTERVAL_MS))

    const resultResponse = await fetch(resultUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        taskId,
      }),
    })

    if (!resultResponse.ok) {
      console.warn(`[${label}] getTaskResult HTTP error: ${resultResponse.status}`)
      continue
    }

    const resultData = (await resultResponse.json()) as {
      errorId: number
      errorCode?: string
      errorDescription?: string
      status: 'idle' | 'processing' | 'ready'
      solution?: {
        gRecaptchaResponse?: string
        token?: string
      }
    }

    if (resultData.errorId !== 0) {
      console.warn(
        `[${label}] getTaskResult error: ${resultData.errorCode} — ${resultData.errorDescription}`,
      )
      return null
    }

    if (resultData.status === 'ready') {
      const token = resultData.solution?.gRecaptchaResponse || resultData.solution?.token
      if (token) {
        console.log(`[${label}] hCaptcha solved successfully (token length: ${token.length})`)
        return token
      }
      console.warn(`[${label}] Task ready but no token in solution: ${JSON.stringify(resultData.solution)}`)
      return null
    }

    // Still processing — continue polling
    if (attempt % 5 === 0) {
      console.log(`[${label}] Still solving... (attempt ${attempt + 1}/${CAPTCHA_MAX_POLL_ATTEMPTS})`)
    }
  }

  console.warn(`[${label}] Timed out waiting for hCaptcha solution`)
  return null
}

/**
 * Solve a reCAPTCHA v2 challenge using CapSolver's API.
 *
 * Requires the CAPSOLVER_API_KEY environment variable to be set.
 * Returns the reCAPTCHA response token on success, or null on failure.
 */
export async function solveReCaptchaViaCapsolver(
  websiteUrl: string,
  websiteKey: string,
  isEnterprise = false,
): Promise<string | null> {
  const apiKey = process.env.CAPSOLVER_API_KEY
  if (!apiKey) {
    console.log('[capsolver] CAPSOLVER_API_KEY not set — skipping reCAPTCHA solve')
    return null
  }

  const taskType = isEnterprise ? 'ReCaptchaV2EnterpriseTaskProxyless' : 'ReCaptchaV2TaskProxyless'
  console.log(`[capsolver] Creating ${taskType} for ${websiteUrl} (siteKey: ${websiteKey})`)

  try {
    const createResponse = await fetch(CAPSOLVER_CREATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: taskType,
          websiteURL: websiteUrl,
          websiteKey,
        },
      }),
    })

    console.log(`[capsolver] reCAPTCHA createTask HTTP status: ${createResponse.status}`)

    if (!createResponse.ok) {
      const errBody = await createResponse.text().catch(() => '<empty>')
      console.warn(`[capsolver] reCAPTCHA createTask HTTP error ${createResponse.status}: ${errBody}`)
      return null
    }

    const createData = (await createResponse.json()) as {
      errorId: number; errorCode?: string; errorDescription?: string; taskId?: string
    }

    console.log(`[capsolver] reCAPTCHA createTask response: ${JSON.stringify(createData)}`)

    if (createData.errorId !== 0 || !createData.taskId) {
      console.warn(`[capsolver] reCAPTCHA createTask failed: ${createData.errorCode} — ${createData.errorDescription}`)
      return null
    }

    const taskId = createData.taskId
    console.log(`[capsolver] reCAPTCHA task created: ${taskId} — polling...`)

    return await pollForCaptchaResult(CAPSOLVER_RESULT_URL, apiKey, taskId, 'capsolver-recaptcha')
  } catch (error) {
    console.error('[capsolver] reCAPTCHA error:', error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * Inject an hCaptcha token into the page DOM and dispatch the necessary events
 * so the form recognizes the CAPTCHA as solved.
 *
 * This sets:
 * - textarea[name="h-captcha-response"] value
 * - textarea[name="g-recaptcha-response"] value (some forms alias this)
 * - Calls the hcaptcha callback if available on window
 */
export async function injectHCaptchaToken(page: Page, token: string): Promise<void> {
  await page.evaluate((tok) => {
    // Set all hCaptcha / reCAPTCHA response textareas
    const textareas = document.querySelectorAll<HTMLTextAreaElement>(
      'textarea[name="h-captcha-response"], textarea[name="g-recaptcha-response"]',
    )
    textareas.forEach((ta) => {
      ta.value = tok
      ta.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // Also set via the hcaptcha iframe bridge if present
    const hcaptchaIframe = document.querySelector<HTMLIFrameElement>(
      'iframe[src*="hcaptcha.com"], iframe[data-hcaptcha-widget-id]',
    )
    if (hcaptchaIframe) {
      // Set the response in the parent's hidden fields
      const widgetId = hcaptchaIframe.getAttribute('data-hcaptcha-widget-id') || '0'
      try {
        // Try the official hcaptcha JS API if loaded
        const hcaptchaApi = (window as any).hcaptcha
        if (hcaptchaApi && typeof hcaptchaApi.setResponse === 'function') {
          hcaptchaApi.setResponse(tok, { widgetID: widgetId })
        }
      } catch {
        // Silently ignore — the textarea approach should suffice
      }
    }

    // Trigger the registered callback.
    // hCaptcha stores the callback in its internal state when render() is called.
    // Strategy: 1) try hcaptcha.getRespKey to invoke the success callback properly,
    //           2) walk the internal _hcaptcha object for callback functions,
    //           3) fall back to well-known global names.
    let callbackInvoked = false
    try {
      const hcaptchaApi = (window as any).hcaptcha

      // Method 1: Deep-walk hcaptcha internals for registered callbacks
      if (hcaptchaApi) {
        const walkForCallbacks = (obj: any, depth = 0): boolean => {
          if (!obj || depth > 6 || typeof obj !== 'object') return false
          for (const [key, val] of Object.entries(obj)) {
            if (typeof val === 'function' && /callback|success|onPass/i.test(key)) {
              try { (val as Function)(tok); return true } catch { /* continue */ }
            }
            if (typeof val === 'object' && walkForCallbacks(val, depth + 1)) return true
          }
          return false
        }
        // Walk internal state (varies by hCaptcha version)
        callbackInvoked = walkForCallbacks(hcaptchaApi._hcaptcha) || walkForCallbacks(hcaptchaApi)
      }

      // Method 2: Well-known global callback names
      if (!callbackInvoked) {
        for (const name of ['hcaptchaCallback', 'onHCaptchaSuccess', 'hcaptchaSuccessCallback', 'onCaptchaSuccess']) {
          const fn = (window as any)[name]
          if (typeof fn === 'function') {
            fn(tok)
            callbackInvoked = true
            break
          }
        }
      }

      // Method 3: Dispatch a custom event that some Lever forms listen for
      if (!callbackInvoked) {
        document.dispatchEvent(new CustomEvent('hcaptchaSuccess', { detail: { token: tok } }))
      }
    } catch {
      // Callback invocation is best-effort
    }

    console.log(`[injectHCaptchaToken] Injected token into ${textareas.length} textarea(s), callback invoked: ${callbackInvoked}`)
  }, token)
}

/**
 * Human-like delay between actions to avoid bot detection.
 * Randomized between min and max milliseconds.
 */
export async function humanDelay(min = 800, max = 2500): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Get the best compressed CV variant for a given ATS size limit.
 *
 * Checks Supabase Storage for pre-compressed variants and returns a
 * signed download URL for the largest variant under the size limit.
 *
 * Falls back to the original cvUrl (e.g. GitHub) if no variants exist.
 *
 * @param userId - The user whose variants to look up
 * @param maxSizeMB - Maximum file size the ATS accepts (default: 5)
 * @returns Signed URL or fallback URL
 */
export async function getBestCvUrl(
  userId: string,
  maxSizeMB = 5,
): Promise<string | null> {
  const maxSizeBytes = maxSizeMB * 1024 * 1024

  try {
    // List files in the user's documents folder
    const { data: files } = await supabaseServer.storage
      .from('documents')
      .list(`documents/${userId}`, { limit: 20 })

    if (!files || files.length === 0) return null

    // Find variant files and their sizes
    const variants: { name: string; size: number; quality: string }[] = []
    for (const vf of VARIANT_FILES) {
      const match = files.find((f) => f.name === vf.name)
      if (match) {
        variants.push({
          name: vf.name,
          size: match.metadata?.size ?? 0,
          quality: vf.quality,
        })
      }
    }

    if (variants.length === 0) return null

    // Sort by size descending — pick the largest that fits
    variants.sort((a, b) => b.size - a.size)
    const best = variants.find((v) => v.size <= maxSizeBytes) ?? variants[variants.length - 1]

    // Generate signed URL (1 hour expiry)
    const { data: signedData, error } = await supabaseServer.storage
      .from('documents')
      .createSignedUrl(`documents/${userId}/${best.name}`, 3600)

    if (error || !signedData?.signedUrl) {
      console.warn(`[helpers] Failed to sign URL for ${best.name}:`, error?.message)
      return null
    }

    console.log(`[helpers] Using ${best.quality} variant (${best.name}, ${(best.size / 1024 / 1024).toFixed(1)}MB) for ${maxSizeMB}MB limit`)
    return signedData.signedUrl
  } catch (err) {
    console.warn('[helpers] getBestCvUrl failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Download CV from a URL and return as Buffer.
 *
 * If a userId is provided, tries to fetch a pre-compressed variant from
 * Supabase Storage first (picked for the given ATS size limit).
 * Falls back to the provided cvUrl (e.g. GitHub raw URL).
 */
export async function downloadCV(
  page: Page,
  cvUrl: string,
  options?: { userId?: string; atsMaxSizeMB?: number },
): Promise<Buffer> {
  // Try compressed variant first if we have a userId
  if (options?.userId) {
    const variantUrl = await getBestCvUrl(options.userId, options.atsMaxSizeMB ?? 5)
    if (variantUrl) {
      try {
        const response = await page.context().request.get(variantUrl)
        if (response.ok()) {
          return await response.body()
        }
      } catch (err) {
        console.warn('[helpers] Variant download failed, falling back to original:', err)
      }
    }
  }

  // Fallback: download from the original URL (e.g. GitHub)
  const response = await page.context().request.get(cvUrl)
  if (!response.ok()) {
    throw new Error(`Failed to download CV: ${response.status()} ${response.statusText()}`)
  }
  const body = await response.body()
  return body
}

/**
 * Upload a file to an <input type="file"> element using Playwright's setInputFiles.
 * Falls back to DataTransfer trick if the input is hidden.
 */
export async function uploadFile(
  page: Page,
  selector: string,
  buffer: Buffer,
  filename: string,
): Promise<void> {
  const input = page.locator(selector).first()

  // Make sure the input is attached to the DOM
  await input.waitFor({ state: 'attached', timeout: 10_000 })

  // Playwright natively supports setInputFiles with a buffer
  await input.setInputFiles({
    name: filename,
    mimeType: 'application/pdf',
    buffer,
  })
}

/**
 * Upload a file by evaluating DataTransfer in the browser context.
 * Useful when the file input is deeply hidden or wrapped in a custom component.
 */
export async function uploadFileViaDataTransfer(
  page: Page,
  selector: string,
  buffer: Buffer,
  filename: string,
): Promise<void> {
  const base64 = buffer.toString('base64')

  await page.evaluate(
    ({ sel, data, name }) => {
      const input = document.querySelector(sel) as HTMLInputElement
      if (!input) throw new Error(`File input not found: ${sel}`)

      // Decode base64 to Uint8Array
      const binaryString = atob(data)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      const file = new File([bytes], name, { type: 'application/pdf' })
      const dt = new DataTransfer()
      dt.items.add(file)
      input.files = dt.files

      // Dispatch events so React/Vue/Angular pick up the change
      input.dispatchEvent(new Event('change', { bubbles: true }))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    { sel: selector, data: base64, name: filename },
  )
}

/**
 * Wait for an element to be visible and click it.
 * Retries with increasing timeout if the element is not immediately available.
 */
export async function waitAndClick(
  page: Page,
  selector: string,
  timeout = 10_000,
): Promise<void> {
  const locator = page.locator(selector).first()
  await locator.waitFor({ state: 'visible', timeout })
  await humanDelay(300, 800)
  await locator.click()
}

/**
 * Fill an input field safely: click, select all existing text, then type new value.
 * Includes human-like delay between keystrokes.
 */
export async function fillInput(
  page: Page,
  selector: string,
  value: string,
): Promise<void> {
  const locator = page.locator(selector).first()
  await locator.waitFor({ state: 'visible', timeout: 10_000 })
  await locator.click()
  await humanDelay(200, 500)

  // Clear existing value
  await page.keyboard.press('Meta+a')
  await page.keyboard.press('Backspace')
  await humanDelay(100, 300)

  // Type with slight delays to appear human
  await locator.fill(value)
}

/**
 * Type into a field character by character (for fields that don't respond to fill).
 */
export async function typeSlowly(
  page: Page,
  selector: string,
  value: string,
): Promise<void> {
  const locator = page.locator(selector).first()
  await locator.waitFor({ state: 'visible', timeout: 10_000 })
  await locator.click()
  await humanDelay(200, 500)

  // Clear existing value
  await page.keyboard.press('Meta+a')
  await page.keyboard.press('Backspace')
  await humanDelay(100, 200)

  // Type character by character
  for (const char of value) {
    await page.keyboard.type(char, { delay: 50 + Math.random() * 100 })
  }
}

/**
 * Take a screenshot and return as base64 string.
 */
export async function takeScreenshot(page: Page): Promise<string> {
  const buffer = await page.screenshot({ fullPage: true })
  return buffer.toString('base64')
}

/**
 * Answer a screening question based on heuristic matching against the profile.
 * Detects question intent from the label text and fills the appropriate answer.
 */
export async function answerScreeningQuestion(
  page: Page,
  questionText: string,
  inputSelector: string,
  profile: ApplicantProfile,
): Promise<void> {
  const q = questionText.toLowerCase()
  let answer = ''

  // Years of experience
  if (q.includes('year') && (q.includes('experience') || q.includes('expérience'))) {
    answer = String(profile.yearsExperience)
  }
  // Remote work
  else if (q.includes('remote') || q.includes('work from home') || q.includes('télétravail')) {
    answer = 'Yes'
  }
  // Relocation
  else if (q.includes('relocat') || q.includes('déménag')) {
    answer = 'Open to relocation'
  }
  // Salary / compensation
  else if (q.includes('salary') || q.includes('compensation') || q.includes('salaire') || q.includes('pay')) {
    answer = '70000 EUR'
  }
  // Notice period / start date
  else if (q.includes('notice') || q.includes('start') || q.includes('disponib') || q.includes('when can you')) {
    answer = profile.noticePeriod
  }
  // Work authorization / visa / sponsorship
  else if (q.includes('authorized') || q.includes('authoris') || q.includes('visa') || q.includes('sponsor') || q.includes('work permit') || q.includes('legally')) {
    answer = profile.workAuth
  }
  // Location / timezone
  else if (q.includes('location') || q.includes('where') || q.includes('city') || q.includes('country') || q.includes('based')) {
    answer = profile.location
  }
  // Timezone
  else if (q.includes('timezone') || q.includes('time zone') || q.includes('fuseau')) {
    answer = profile.timezone
  }
  // LinkedIn
  else if (q.includes('linkedin')) {
    answer = profile.linkedin
  }
  // Website / portfolio
  else if (q.includes('website') || q.includes('portfolio') || q.includes('url') || q.includes('site web')) {
    answer = profile.portfolio
  }
  // Phone
  else if (q.includes('phone') || q.includes('mobile') || q.includes('téléphone')) {
    answer = profile.phone
  }
  // Gender / pronouns — neutral
  else if (q.includes('gender') || q.includes('pronoun')) {
    answer = 'Prefer not to say'
  }
  // Disability
  else if (q.includes('disability') || q.includes('handicap')) {
    answer = 'Prefer not to say'
  }
  // Race / ethnicity
  else if (q.includes('race') || q.includes('ethnic')) {
    answer = 'Prefer not to say'
  }
  // Veteran status
  else if (q.includes('veteran')) {
    answer = 'No'
  }
  // How did you hear / referral
  else if (q.includes('how did you') || q.includes('hear about') || q.includes('referr') || q.includes('source')) {
    answer = 'LinkedIn'
  }
  // Cover letter / why interested / additional info — prefer AI-generated snippet
  else if (q.includes('cover letter') || q.includes('why interested') || q.includes('why are you interested') || q.includes('why do you want') || q.includes('additional') || q.includes('anything else') || q.includes('lettre') || q.includes('motivation')) {
    if (profile.coverLetterSnippet) {
      answer = `${profile.coverLetterSnippet}\n\nPortfolio: ${profile.portfolio}`
    } else {
      answer = [
        `Senior Product Designer with ${profile.yearsExperience}+ years of experience specializing in Design Systems, Design Ops, and complex product architecture.`,
        `Portfolio: ${profile.portfolio}`,
        `Available in ${profile.noticePeriod}. ${profile.workAuth}. Based in ${profile.location} (${profile.timezone}).`,
      ].join('\n')
    }
  }
  // Employment type / preference / arrangement
  else if (q.includes('employment') || q.includes('work type') || q.includes('contract type') || q.includes('arrangement') || q.includes('engagement')) {
    answer = 'Contract'
  }
  // Availability / hours / commitment
  else if (q.includes('availability') || q.includes('hours') || q.includes('full-time') || q.includes('part-time')) {
    answer = 'Full-time'
  }
  // Language / proficiency
  else if (q.includes('language') && !q.includes('programming')) {
    answer = 'English (Fluent), French (Native)'
  }
  // Boolean yes/no questions — default to "Yes" for positive framing
  else if (q.includes('do you') || q.includes('are you') || q.includes('have you') || q.includes('can you') || q.includes('what is your')) {
    answer = 'Yes'
  }
  // Fallback: leave a generic answer with portfolio link
  else {
    answer = `Please see my portfolio: ${profile.portfolio}`
  }

  // Determine input type and fill accordingly
  const inputElement = page.locator(inputSelector).first()
  const tagName = await inputElement.evaluate((el) => el.tagName.toLowerCase())
  const inputType = await inputElement.evaluate((el) => (el as HTMLInputElement).type?.toLowerCase() || '')
  const inputRole = await inputElement.evaluate((el) => el.getAttribute('role') || '').catch(() => '')

  if (tagName === 'select') {
    // Standard HTML select
    await selectBestOption(page, inputSelector, answer)
  } else if (inputRole === 'combobox' || await inputElement.evaluate(el => {
    // Detect React Select: parent has class containing "select" or has react-select id prefix
    const parent = el.closest('[class*="select__"]') || el.closest('[class*="Select"]')
    const hasReactSelectId = el.id?.startsWith('react-select-')
    return !!(parent || hasReactSelectId)
  }).catch(() => false)) {
    // React Select / combobox — type, wait for dropdown, click matching option
    console.log(`[screening] Handling React Select combobox for answer: "${answer}"`)
    await handleReactSelect(page, inputSelector, answer)
  } else if (inputType === 'radio' || inputType === 'checkbox') {
    // For radio/checkbox, try to click the one matching our answer
    await handleRadioOrCheckbox(page, inputSelector, answer)
  } else {
    // Text input or textarea
    await fillInput(page, inputSelector, answer)
  }
}

/**
 * For select elements, pick the best matching option.
 */
async function selectBestOption(
  page: Page,
  selector: string,
  desiredValue: string,
): Promise<void> {
  const select = page.locator(selector).first()
  const options = await select.locator('option').allTextContents()

  const desired = desiredValue.toLowerCase()

  // Try exact match first, then contains, then first non-empty option
  let bestOption = options.find((o) => o.toLowerCase() === desired)
  if (!bestOption) {
    bestOption = options.find((o) => desired.includes(o.toLowerCase()) || o.toLowerCase().includes(desired))
  }
  // For yes/no selects
  if (!bestOption && (desired === 'yes' || desired === 'no')) {
    bestOption = options.find((o) => o.toLowerCase().startsWith(desired))
  }
  if (!bestOption) {
    // Pick the first non-empty, non-placeholder option
    bestOption = options.find((o) => o.trim() !== '' && !o.toLowerCase().includes('select'))
  }

  if (bestOption) {
    await select.selectOption({ label: bestOption })
  }
}

/**
 * Handle radio button or checkbox groups.
 *
 * Greenhouse uses nested structure:
 *   <fieldset class="checkbox">
 *     <div class="checkbox__wrapper">
 *       <div class="checkbox__input"><input type="checkbox"/></div>
 *       <label>Option text</label>
 *     </div>
 *   </fieldset>
 *
 * So we search for labels across multiple parent levels and also
 * use the fieldset/form as the search boundary.
 */
async function handleRadioOrCheckbox(
  page: Page,
  selector: string,
  desiredValue: string,
): Promise<void> {
  const desired = desiredValue.toLowerCase()
  const input = page.locator(selector).first()

  // Strategy 1: Find the closest fieldset, form, or .field-wrapper ancestor and search its labels
  const searchContainers = [
    input.locator('xpath=ancestor::fieldset[1]'),
    input.locator('xpath=ancestor::*[contains(@class, "field-wrapper")][1]'),
    input.locator('xpath=ancestor::*[contains(@class, "field")][1]'),
    input.locator('..').locator('..'), // grandparent
    input.locator('..').locator('..').locator('..'), // great-grandparent
  ]

  for (const container of searchContainers) {
    try {
      if (await container.count() === 0) continue

      const labels = container.locator('label')
      const count = await labels.count()
      if (count <= 1) continue // Need at least 2 labels (one is the question, rest are options)

      // Find best matching label
      let bestLabel = -1
      let bestScore = 0
      for (let i = 0; i < count; i++) {
        const text = (await labels.nth(i).textContent())?.toLowerCase().trim() || ''
        if (!text || text.length < 2) continue

        let score = 0
        if (text === desired) score = 100
        else if (text.includes(desired)) score = 80
        else if (desired.includes(text)) score = 60
        // Word-level matching
        else {
          const desiredWords = desired.split(/\s+/)
          const matching = desiredWords.filter(w => text.includes(w))
          if (matching.length > 0) score = 20 + matching.length * 10
        }
        // Special: yes/no matching
        if (score === 0 && (desired === 'yes' || desired === 'no') && text.includes(desired)) {
          score = 50
        }

        if (score > bestScore) {
          bestScore = score
          bestLabel = i
        }
      }

      if (bestLabel >= 0 && bestScore >= 20) {
        const labelText = await labels.nth(bestLabel).textContent()
        await labels.nth(bestLabel).click()
        console.log(`[screening] Radio/checkbox: clicked "${labelText?.trim()}" (score ${bestScore})`)
        return
      }

      // Fallback: click first option label (skip first which might be the question text)
      const startIdx = count > 2 ? 1 : 0
      if (count > startIdx) {
        const labelText = await labels.nth(startIdx).textContent()
        await labels.nth(startIdx).click()
        console.log(`[screening] Radio/checkbox: fallback clicked "${labelText?.trim()}"`)
        return
      }
    } catch {
      continue
    }
  }

  // Last resort: click the input itself (checks it)
  try {
    await input.click()
    console.log(`[screening] Radio/checkbox: clicked input directly as last resort`)
  } catch {
    // Give up
  }
}

/**
 * Handle React Select / combobox dropdowns (common in Greenhouse, Ashby forms).
 *
 * Strategy:
 * 1. First try: open dropdown via ArrowDown, scan all options, click best match
 * 2. If no match: type the desired value to filter, then try again
 * 3. Fallback: click first available option (better than leaving empty for required fields)
 */
async function handleReactSelect(
  page: Page,
  selector: string,
  desiredValue: string,
): Promise<void> {
  const input = page.locator(selector).first()
  const desired = desiredValue.toLowerCase()

  // Option selectors — React Select uses these class patterns
  const optionSelectors = [
    '[class*="select__option"]',
    '[role="option"]',
    '[id*="option"]',
  ]

  // Helper: find and click the best matching option from visible dropdown options
  const trySelectOption = async (): Promise<boolean> => {
    for (const optSel of optionSelectors) {
      const options = page.locator(optSel)
      const count = await options.count()
      if (count === 0) continue

      // Score each option and pick the best match
      let bestIdx = -1
      let bestScore = 0
      for (let i = 0; i < count; i++) {
        const text = (await options.nth(i).textContent())?.toLowerCase().trim() || ''
        if (!text) continue

        let score = 0
        if (text === desired) score = 100 // Exact match
        else if (text.includes(desired)) score = 80 // Contains desired
        else if (desired.includes(text)) score = 60 // Desired contains option
        else {
          // Partial word matching
          const desiredWords = desired.split(/\s+/)
          const textWords = text.split(/\s+/)
          const matching = desiredWords.filter(w => textWords.some(tw => tw.includes(w) || w.includes(tw)))
          if (matching.length > 0) score = 20 + matching.length * 10
        }

        if (score > bestScore) {
          bestScore = score
          bestIdx = i
        }
      }

      if (bestIdx >= 0 && bestScore >= 20) {
        const selectedText = await options.nth(bestIdx).textContent()
        await options.nth(bestIdx).click()
        console.log(`[screening] React Select: selected "${selectedText?.trim()}" (score ${bestScore})`)
        return true
      }

      // For yes/no, try broader matching
      if (desired === 'yes' || desired === 'no') {
        for (let i = 0; i < count; i++) {
          const text = (await options.nth(i).textContent())?.toLowerCase() || ''
          if (text.includes(desired)) {
            await options.nth(i).click()
            console.log(`[screening] React Select: selected yes/no "${text.trim()}"`)
            return true
          }
        }
      }

      // Last resort: click first non-empty option for required fields
      for (let i = 0; i < count; i++) {
        const text = (await options.nth(i).textContent())?.trim() || ''
        if (text && !text.toLowerCase().includes('select')) {
          await options.nth(i).click()
          console.log(`[screening] React Select: fallback first option "${text}"`)
          return true
        }
      }
    }
    return false
  }

  // Strategy 1: Click input to focus, then press ArrowDown to open full dropdown
  try {
    await input.click()
    await new Promise(r => setTimeout(r, 200))
    await page.keyboard.press('ArrowDown')
    await new Promise(r => setTimeout(r, 400))

    if (await trySelectOption()) return
  } catch {
    // Strategy 1 failed
  }

  // Strategy 2: Type the desired value to filter options
  try {
    await input.click()
    await new Promise(r => setTimeout(r, 200))
    // Use keyboard to type (more reliable than fill for React controlled inputs)
    for (const char of desiredValue.substring(0, 15)) {
      await page.keyboard.type(char, { delay: 30 })
    }
    await new Promise(r => setTimeout(r, 600))

    if (await trySelectOption()) return
  } catch {
    // Strategy 2 failed
  }

  // Strategy 3: Try clicking the select control/indicator to open dropdown
  try {
    const selectControl = page.locator(selector).first()
      .locator('xpath=ancestor::*[contains(@class, "select__control")]').first()
    if (await selectControl.count() > 0) {
      await selectControl.click()
      await new Promise(r => setTimeout(r, 400))
      if (await trySelectOption()) return
    }
  } catch {
    // Strategy 3 failed
  }

  // Final fallback: press Enter (selects highlighted option if any)
  await page.keyboard.press('Enter')
  console.log(`[screening] React Select: exhausted all strategies, pressed Enter`)
}

/**
 * Extract company name from URL or page title.
 */
export async function extractCompanyName(page: Page, url: string): Promise<string> {
  // Try page title first
  const title = await page.title()
  if (title) {
    // Common patterns: "Role at Company", "Company - Role", "Company | Role"
    const atMatch = title.match(/at\s+(.+?)(?:\s*[-|]|$)/i)
    if (atMatch) return atMatch[1].trim()

    const pipeMatch = title.match(/^(.+?)\s*[|]\s*/i)
    if (pipeMatch) return pipeMatch[1].trim()

    const dashMatch = title.match(/^(.+?)\s*[-]\s*/i)
    if (dashMatch) return dashMatch[1].trim()
  }

  // Fall back to URL-based extraction
  try {
    const hostname = new URL(url).hostname
    // e.g., jobs.lever.co/companyname, boards.greenhouse.io/companyname
    const pathParts = new URL(url).pathname.split('/').filter(Boolean)
    if (pathParts.length > 0) {
      return pathParts[0].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    }
    return hostname
  } catch {
    return 'Unknown Company'
  }
}

/**
 * Extract role/job title from page content.
 */
export async function extractRoleTitle(page: Page): Promise<string> {
  // Try common selectors for job title
  const selectors = [
    'h1.app-title',
    'h1.posting-headline',
    'h1[class*="title"]',
    'h1[class*="job"]',
    '.job-title h1',
    '.posting-headline h2',
    'h1',
  ]

  for (const sel of selectors) {
    try {
      const text = await page.locator(sel).first().textContent({ timeout: 2000 })
      if (text && text.trim().length > 2 && text.trim().length < 200) {
        return text.trim()
      }
    } catch {
      // Continue to next selector
    }
  }

  return 'Unknown Role'
}

/**
 * Check if a confirmation/success message appeared after submission.
 *
 * Uses a multi-signal approach to prevent false positives:
 *  - Negative signals (visible form, submit button, errors) → instant false
 *  - Requires at least 2 of 3 positive signals: text match, URL change, no form visible
 *  - Single text match alone is NOT enough (prevents Greenhouse/Lever false positives)
 *
 * @param page - Playwright page
 * @param originalUrl - The job URL before submission (used to detect URL change)
 */
export async function checkForConfirmation(page: Page, originalUrl?: string): Promise<boolean> {
  // Wait a moment for any post-submit redirect/render
  await new Promise(r => setTimeout(r, 2000))

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 1: NEGATIVE SIGNALS — if any are present, return false immediately
  // ══════════════════════════════════════════════════════════════════════════

  // 1a. Submit button still visible → form was NOT submitted
  // NOTE: Lever's #btn-submit is type="button" (not submit) — it's a JS trigger for hCaptcha.
  // It may remain visible during post-captcha processing, so we exclude it from negative signals.
  // We only flag actual submit-type buttons as negative signals.
  const isLever = page.url().includes('lever.co') || page.url().includes('jobs.lever')
  const submitButtonSelectors = [
    'button:has-text("Submit Application")',
    'button:has-text("Submit application")',
    'button:has-text("Submit your application")',
    'input[type="submit"][value*="Submit"]',
    'button[type="submit"]:has-text("Submit")',
    'button:has-text("Apply for this job")',
    'button:has-text("Send Application")',
    'button:has-text("Send application")',
  ]
  for (const sel of submitButtonSelectors) {
    try {
      const button = page.locator(sel).first()
      const visible = await button.isVisible({ timeout: 1000 })
      if (visible) {
        // On Lever: skip #btn-submit (type="button") — it's a JS hCaptcha trigger, not a real submit
        if (isLever) {
          const btnId = await button.evaluate((el) => el.id).catch(() => '')
          const btnType = await button.evaluate((el) => (el as HTMLButtonElement).type).catch(() => '')
          if (btnId === 'btn-submit' || btnType === 'button') {
            console.log(`[checkForConfirmation] ⏭️ Skipping Lever JS trigger button "${sel}" (id=${btnId}, type=${btnType})`)
            continue
          }
        }
        console.log(`[checkForConfirmation] ❌ Negative signal: submit button still visible → "${sel}"`)
        return false
      }
    } catch {
      // Not found — good
    }
  }

  // 1b. Validation errors visible → form has errors, not submitted
  const errorSelectors = [
    '.field--error',
    '.field-error',
    '[class*="validation-error"]',
    '[class*="form-error"]',
    '[aria-invalid="true"]',
    '.error-message',
  ]
  for (const sel of errorSelectors) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 1000 })
      if (visible) {
        console.log(`[checkForConfirmation] ❌ Negative signal: validation error visible → "${sel}"`)
        return false
      }
    } catch {
      // Not found — good
    }
  }

  // 1c. Security code input visible → still on verification screen
  try {
    const securityCodeVisible = await page.locator(
      'input[name*="security_code"], input[name*="securityCode"], input[placeholder*="security code" i], input[placeholder*="enter code" i]'
    ).first().isVisible({ timeout: 1000 })
    if (securityCodeVisible) {
      console.log('[checkForConfirmation] ❌ Negative signal: security code input still visible')
      return false
    }
  } catch {
    // Not found — good
  }

  // 1d. Required fields still unfilled → form not submitted
  try {
    const emptyRequiredCount = await page.evaluate(() => {
      const required = document.querySelectorAll('input[required], select[required], textarea[required]')
      let emptyCount = 0
      required.forEach((el) => {
        const input = el as HTMLInputElement
        if (input.offsetParent !== null && !input.value) emptyCount++
      })
      return emptyCount
    })
    if (emptyRequiredCount >= 2) {
      console.log(`[checkForConfirmation] ❌ Negative signal: ${emptyRequiredCount} unfilled required fields`)
      return false
    }
  } catch {
    // Can't evaluate — continue
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 2: POSITIVE SIGNALS — collect signals, require at least 2 of 3
  // ══════════════════════════════════════════════════════════════════════════

  let textSignal = false
  let urlSignal = false
  let noFormSignal = false

  let matchedPattern = ''

  // ── Signal 1: Text-based confirmation patterns ──
  // Only high-confidence patterns that explicitly reference a COMPLETED application.
  // Removed overly broad patterns like "has been received", "We appreciate your interest"
  const successPatterns = [
    // ---------- Explicit submission confirmation ----------
    'text=Application submitted',
    'text=application has been received',
    'text=successfully submitted',
    'text=Thanks for applying',
    'text=thanks for applying',
    'text=Thank you for applying',
    'text=Thank you for your application',
    'text=We have received your application',
    'text=Your application has been submitted',
    'text=Your application was submitted successfully',
    'text=You have successfully applied',
    'text=Application successfully submitted',
    'text=We got your application',
    'text=received your submission',
    // Lever-specific (confirmed real confirmation pages)
    'text=Thanks for your interest',
    'text=Application has been submitted',
    'text=we are delighted that you would consider',
    // Greenhouse-specific (confirmed real confirmation pages)
    'text=Your application has been received',
    'text=we will review it right away',
    // Generic ATS
    'text=You\'re all set',
    'text=Application complete',
    'text=Application sent',
    // ---------- Structural selectors (high confidence) ----------
    '.application-confirmation',
    '.confirmation-message',
    '.flash-success',
    '#application_confirmation',
    '.msg-success',
    '.application-complete',
    '[data-test="confirmation"]',
  ]

  for (const pattern of successPatterns) {
    try {
      const element = page.locator(pattern).first()
      const visible = await element.isVisible({ timeout: 2000 })
      if (visible) {
        textSignal = true
        matchedPattern = pattern
        console.log(`[checkForConfirmation] 📝 Text signal: "${pattern}"`)
        break
      }
    } catch {
      // Continue checking
    }
  }

  // "Thank you" text check — ONLY in the main content area, with application context
  if (!textSignal) {
    try {
      const bodyText = await page.locator('main, #content, .content, [role="main"], body').first()
        .textContent({ timeout: 2000 }).catch(() => '')
      if (bodyText) {
        const lower = bodyText.toLowerCase()
        const hasThankYou = lower.includes('thank you') || lower.includes('merci')
        const hasApplicationContext = lower.includes('application') || lower.includes('apply') ||
          lower.includes('candidature') || lower.includes('submitted') || lower.includes('received')
        if (hasThankYou && hasApplicationContext) {
          textSignal = true
          matchedPattern = 'body text: "thank you" + application context'
          console.log('[checkForConfirmation] 📝 Text signal: "Thank you" + application context in body')
        }
      }
    } catch {
      // Continue
    }
  }

  // ── Signal 2: URL changed from original job URL ──
  // A real submission typically redirects to a /thank-you, /confirmation, or different page
  const currentUrl = page.url().toLowerCase()
  const normalizedOriginal = originalUrl?.toLowerCase()?.split('?')[0]?.split('#')[0] ?? ''
  const normalizedCurrent = currentUrl.split('?')[0].split('#')[0]

  if (normalizedOriginal && normalizedCurrent !== normalizedOriginal) {
    urlSignal = true
    console.log(`[checkForConfirmation] 📝 URL signal: changed from "${normalizedOriginal}" to "${normalizedCurrent}"`)
  }

  // Bonus: URL contains confirmation-specific path segments (strong signal)
  const confirmationUrlPaths = [
    '/thank',
    '/confirmation',
    '/application-submitted',
    '/applied',
  ]
  // NOTE: /success and /complete removed — too broad (match generic SPA routes)
  const hasConfirmationPath = confirmationUrlPaths.some(p => currentUrl.includes(p))
  if (hasConfirmationPath) {
    urlSignal = true
    console.log(`[checkForConfirmation] 📝 URL signal: confirmation path detected in "${currentUrl}"`)
  }

  // ── Signal 3: No application form visible ──
  // If the form is gone, it was likely submitted successfully
  try {
    const formVisible = await page.evaluate(() => {
      // Check for visible form elements that would indicate the form is still present
      const forms = document.querySelectorAll('form')
      for (const form of forms) {
        if (form.offsetParent === null) continue // hidden form
        const inputs = form.querySelectorAll('input:not([type="hidden"]), select, textarea')
        // Only count forms with multiple inputs (actual application forms, not search bars)
        if (inputs.length >= 3) return true
      }
      return false
    })
    if (!formVisible) {
      noFormSignal = true
      console.log('[checkForConfirmation] 📝 No-form signal: application form no longer visible')
    }
  } catch {
    // Can't evaluate — don't count this signal
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 3: DECISION — require at least 2 of 3 signals
  // ══════════════════════════════════════════════════════════════════════════

  const signalCount = [textSignal, urlSignal, noFormSignal].filter(Boolean).length
  const signals = [
    textSignal ? `text("${matchedPattern}")` : null,
    urlSignal ? 'url_changed' : null,
    noFormSignal ? 'no_form' : null,
  ].filter(Boolean).join(' + ')

  console.log(`[checkForConfirmation] Signals: ${signalCount}/3 — ${signals || 'none'}`)

  if (signalCount >= 2) {
    console.log(`[checkForConfirmation] ✅ Confirmed (${signalCount} signals: ${signals})`)
    return true
  }

  // Special case: if text match is from a VERY high-confidence pattern AND url also has
  // a confirmation path, that's already 2 signals counted above. But if we only have 1
  // signal, log it for debugging and return false.
  if (signalCount === 1) {
    console.log(`[checkForConfirmation] ⚠️ Only 1 signal (${signals}) — NOT confirming (need 2+)`)
  }

  return false
}

/**
 * Scroll to an element smoothly, like a human would.
 */
export async function scrollToElement(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().scrollIntoViewIfNeeded()
  await humanDelay(300, 600)
}
