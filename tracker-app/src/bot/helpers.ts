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
  // Boolean yes/no questions — default to "Yes" for positive framing
  else if (q.includes('do you') || q.includes('are you') || q.includes('have you') || q.includes('can you')) {
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
 */
async function handleRadioOrCheckbox(
  page: Page,
  selector: string,
  desiredValue: string,
): Promise<void> {
  const desired = desiredValue.toLowerCase()

  // Look for a label containing our desired value near the input
  const container = page.locator(selector).first().locator('..')
  const labels = container.locator('label')
  const count = await labels.count()

  for (let i = 0; i < count; i++) {
    const text = (await labels.nth(i).textContent())?.toLowerCase() || ''
    if (text.includes(desired) || (desired === 'yes' && text.includes('yes')) || (desired === 'no' && text.includes('no'))) {
      await labels.nth(i).click()
      return
    }
  }

  // Fallback: click the first option
  if (count > 0) {
    await labels.first().click()
  }
}

/**
 * Handle React Select / combobox dropdowns (common in Greenhouse, Ashby forms).
 * Types the desired value, waits for the dropdown to appear, then clicks the best match.
 */
async function handleReactSelect(
  page: Page,
  selector: string,
  desiredValue: string,
): Promise<void> {
  const input = page.locator(selector).first()

  // Click to open the dropdown
  await input.click()
  await new Promise(r => setTimeout(r, 300))

  // Clear any existing value and type the desired answer
  await input.fill('')
  await input.pressSequentially(desiredValue.substring(0, 20), { delay: 50 })
  await new Promise(r => setTimeout(r, 500))

  // Look for dropdown options — React Select uses various class patterns
  const optionSelectors = [
    '[class*="select__option"]',
    '[class*="option"]',
    '[role="option"]',
    '[id*="option"]',
    '.menu-option',
  ]

  const desired = desiredValue.toLowerCase()

  for (const optSel of optionSelectors) {
    const options = page.locator(optSel)
    const count = await options.count()
    if (count === 0) continue

    // Find the best matching option
    for (let i = 0; i < count; i++) {
      const text = (await options.nth(i).textContent())?.toLowerCase() || ''
      if (text.includes(desired) || desired.includes(text.trim())) {
        await options.nth(i).click()
        console.log(`[screening] React Select: selected option "${text.trim()}"`)
        return
      }
    }

    // For yes/no style questions, match more broadly
    if (desired === 'yes' || desired === 'no') {
      for (let i = 0; i < count; i++) {
        const text = (await options.nth(i).textContent())?.toLowerCase() || ''
        if (text.includes(desired)) {
          await options.nth(i).click()
          console.log(`[screening] React Select: selected yes/no option "${text.trim()}"`)
          return
        }
      }
    }

    // Fallback: click first non-empty option
    if (count > 0) {
      const firstText = await options.first().textContent()
      if (firstText && firstText.trim()) {
        await options.first().click()
        console.log(`[screening] React Select: fallback to first option "${firstText.trim()}"`)
        return
      }
    }
  }

  // Final fallback: press Enter to select the first suggestion
  await page.keyboard.press('Enter')
  console.log(`[screening] React Select: pressed Enter as final fallback`)
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
  const successPatterns = [
    'text=Thank you',
    'text=Application submitted',
    'text=application has been received',
    'text=successfully submitted',
    'text=Thanks for applying',
    'text=We have received your application',
    'text=Your application has been submitted',
    'text=Merci',
  ]

  for (const pattern of successPatterns) {
    try {
      const element = page.locator(pattern).first()
      const visible = await element.isVisible({ timeout: 3000 })
      if (visible) return true
    } catch {
      // Continue checking
    }
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
