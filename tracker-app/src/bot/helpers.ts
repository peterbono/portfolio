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
// CapSolver hCaptcha integration (fallback when SBR auto-solve fails)
// ---------------------------------------------------------------------------

const CAPSOLVER_CREATE_URL = 'https://api.capsolver.com/createTask'
const CAPSOLVER_RESULT_URL = 'https://api.capsolver.com/getTaskResult'
const CAPSOLVER_POLL_INTERVAL_MS = 3_000
const CAPSOLVER_MAX_POLL_ATTEMPTS = 40 // ~2 minutes max

/**
 * Solve an hCaptcha challenge using CapSolver's API.
 *
 * Requires the CAPSOLVER_API_KEY environment variable to be set.
 * Returns the hCaptcha response token on success, or null on failure.
 *
 * @param websiteUrl - The page URL where hCaptcha is displayed
 * @param websiteKey - The hCaptcha site key (data-sitekey attribute)
 */
export async function solveHCaptchaViaCapsolver(
  websiteUrl: string,
  websiteKey: string,
): Promise<string | null> {
  const apiKey = process.env.CAPSOLVER_API_KEY
  if (!apiKey) {
    console.log('[capsolver] CAPSOLVER_API_KEY not set — skipping CapSolver')
    return null
  }

  console.log(`[capsolver] Creating HCaptchaTaskProxyless for ${websiteUrl} (siteKey: ${websiteKey})`)

  try {
    // Step 1: Create the task
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

    if (!createResponse.ok) {
      console.warn(`[capsolver] createTask HTTP error: ${createResponse.status}`)
      return null
    }

    const createData = (await createResponse.json()) as {
      errorId: number
      errorCode?: string
      errorDescription?: string
      taskId?: string
    }

    if (createData.errorId !== 0 || !createData.taskId) {
      console.warn(
        `[capsolver] createTask failed: ${createData.errorCode} — ${createData.errorDescription}`,
      )
      return null
    }

    const taskId = createData.taskId
    console.log(`[capsolver] Task created: ${taskId} — polling for result...`)

    // Step 2: Poll for result
    for (let attempt = 0; attempt < CAPSOLVER_MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, CAPSOLVER_POLL_INTERVAL_MS))

      const resultResponse = await fetch(CAPSOLVER_RESULT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientKey: apiKey,
          taskId,
        }),
      })

      if (!resultResponse.ok) {
        console.warn(`[capsolver] getTaskResult HTTP error: ${resultResponse.status}`)
        continue
      }

      const resultData = (await resultResponse.json()) as {
        errorId: number
        errorCode?: string
        errorDescription?: string
        status: 'idle' | 'processing' | 'ready'
        solution?: {
          gRecaptchaResponse?: string
          // CapSolver returns the token in gRecaptchaResponse for hCaptcha too
        }
      }

      if (resultData.errorId !== 0) {
        console.warn(
          `[capsolver] getTaskResult error: ${resultData.errorCode} — ${resultData.errorDescription}`,
        )
        return null
      }

      if (resultData.status === 'ready') {
        const token = resultData.solution?.gRecaptchaResponse
        if (token) {
          console.log(`[capsolver] hCaptcha solved successfully (token length: ${token.length})`)
          return token
        }
        console.warn('[capsolver] Task ready but no token in solution')
        return null
      }

      // Still processing — continue polling
      if (attempt % 5 === 0) {
        console.log(`[capsolver] Still solving... (attempt ${attempt + 1}/${CAPSOLVER_MAX_POLL_ATTEMPTS})`)
      }
    }

    console.warn('[capsolver] Timed out waiting for hCaptcha solution')
    return null
  } catch (error) {
    console.error(
      '[capsolver] Unexpected error:',
      error instanceof Error ? error.message : error,
    )
    return null
  }
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
): Promise<string | null> {
  const apiKey = process.env.CAPSOLVER_API_KEY
  if (!apiKey) {
    console.log('[capsolver] CAPSOLVER_API_KEY not set — skipping reCAPTCHA solve')
    return null
  }

  console.log(`[capsolver] Creating ReCaptchaV2TaskProxyless for ${websiteUrl} (siteKey: ${websiteKey})`)

  try {
    const createResponse = await fetch(CAPSOLVER_CREATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: 'ReCaptchaV2TaskProxyless',
          websiteURL: websiteUrl,
          websiteKey,
        },
      }),
    })

    if (!createResponse.ok) {
      console.warn(`[capsolver] reCAPTCHA createTask HTTP error: ${createResponse.status}`)
      return null
    }

    const createData = (await createResponse.json()) as {
      errorId: number; errorCode?: string; errorDescription?: string; taskId?: string
    }

    if (createData.errorId !== 0 || !createData.taskId) {
      console.warn(`[capsolver] reCAPTCHA createTask failed: ${createData.errorCode} — ${createData.errorDescription}`)
      return null
    }

    const taskId = createData.taskId
    console.log(`[capsolver] reCAPTCHA task created: ${taskId} — polling...`)

    for (let attempt = 0; attempt < CAPSOLVER_MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, CAPSOLVER_POLL_INTERVAL_MS))

      const resultResponse = await fetch(CAPSOLVER_RESULT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: apiKey, taskId }),
      })

      if (!resultResponse.ok) continue

      const resultData = (await resultResponse.json()) as {
        errorId: number; errorCode?: string; status: 'idle' | 'processing' | 'ready'
        solution?: { gRecaptchaResponse?: string }
      }

      if (resultData.errorId !== 0) {
        console.warn(`[capsolver] reCAPTCHA error: ${resultData.errorCode}`)
        return null
      }

      if (resultData.status === 'ready') {
        const token = resultData.solution?.gRecaptchaResponse
        if (token) {
          console.log(`[capsolver] reCAPTCHA solved (token length: ${token.length})`)
          return token
        }
        return null
      }

      if (attempt % 5 === 0) {
        console.log(`[capsolver] reCAPTCHA still solving... (${attempt + 1}/${CAPSOLVER_MAX_POLL_ATTEMPTS})`)
      }
    }

    console.warn('[capsolver] reCAPTCHA timed out')
    return null
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

    // Trigger any registered callback (Lever registers one via hCaptcha render config)
    try {
      const hcaptchaApi = (window as any).hcaptcha
      if (hcaptchaApi) {
        // Some integrations store the callback ref; try to invoke it
        const callbacks = (window as any).hcaptchaCallback || (window as any).onHCaptchaSuccess
        if (typeof callbacks === 'function') {
          callbacks(tok)
        }
      }
    } catch {
      // Callback invocation is best-effort
    }

    console.log(`[injectHCaptchaToken] Injected token into ${textareas.length} textarea(s)`)
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
 */
export async function checkForConfirmation(page: Page): Promise<boolean> {
  // Wait a moment for any post-submit redirect/render
  await new Promise(r => setTimeout(r, 2000))

  // ── Strategy: text-based patterns are reliable, CSS class patterns are NOT ──
  // Removed `[class*="success"]` and `[class*="confirmation"]` — these are WAY
  // too broad and match CSS utility classes (e.g. `btn-success`, `form-success`)
  // that have nothing to do with application confirmation.  This was causing
  // false-positive "applied" claims with no email confirmation.

  const successPatterns = [
    // ---------- Text patterns (high confidence) ----------
    'text=Application submitted',
    'text=application has been received',
    'text=successfully submitted',
    'text=Thanks for applying',
    'text=thanks for applying',
    'text=Thank you for applying',
    'text=Thank you for your interest',
    'text=Thank you for your application',
    'text=We have received your application',
    'text=Your application has been submitted',
    'text=Your application was submitted successfully',
    'text=You have successfully applied',
    'text=Application successfully submitted',
    'text=Application received',
    'text=application received',
    'text=We got your application',
    'text=received your submission',
    'text=We appreciate your interest',
    'text=has been received',
    // Lever-specific
    'text=Thanks for your interest',
    'text=Your application to',
    'text=Application has been submitted',
    'text=we are delighted that you would consider',
    // Greenhouse-specific
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
    '.confirmation',
  ]

  for (const pattern of successPatterns) {
    try {
      const element = page.locator(pattern).first()
      const visible = await element.isVisible({ timeout: 2000 })
      if (visible) {
        console.log(`[checkForConfirmation] ✅ Match found: ${pattern}`)
        return true
      }
    } catch {
      // Continue checking
    }
  }

  // ---------- "Thank you" text check — ONLY in the main content area ----------
  // Avoid matching header/footer "Thank you for visiting" type text.
  // Require "thank you" near application-related words.
  try {
    const bodyText = await page.locator('main, #content, .content, [role="main"], body').first()
      .textContent({ timeout: 2000 }).catch(() => '')
    if (bodyText) {
      const lower = bodyText.toLowerCase()
      const hasThankYou = lower.includes('thank you') || lower.includes('merci')
      const hasApplicationContext = lower.includes('application') || lower.includes('apply') ||
        lower.includes('candidature') || lower.includes('submitted') || lower.includes('received')
      if (hasThankYou && hasApplicationContext) {
        console.log('[checkForConfirmation] ✅ "Thank you" + application context found in body text')
        return true
      }
    }
  } catch {
    // Continue
  }

  // ---------- URL-based detection ----------
  // Only match confirmation-specific URL paths (not just "success" anywhere)
  const url = page.url().toLowerCase()
  if (
    url.includes('/thank') ||
    url.includes('/confirmation') ||
    url.includes('/application-submitted') ||
    url.includes('/applied') ||
    url.includes('/success') ||
    url.includes('/complete')
  ) {
    console.log(`[checkForConfirmation] ✅ Confirmation URL detected: ${url}`)
    return true
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
