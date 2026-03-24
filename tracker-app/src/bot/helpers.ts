import type { Page } from 'playwright'
import type { ApplicantProfile } from './types'

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
 * Download CV from a URL and return as Buffer.
 * Uses Playwright's API context to fetch the file server-side.
 */
export async function downloadCV(page: Page, cvUrl: string): Promise<Buffer> {
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
  // Cover letter / additional info — include portfolio
  else if (q.includes('cover letter') || q.includes('additional') || q.includes('anything else') || q.includes('lettre')) {
    answer = [
      `Senior Product Designer with ${profile.yearsExperience}+ years of experience specializing in Design Systems, Design Ops, and complex product architecture.`,
      `Portfolio: ${profile.portfolio}`,
      `Available in ${profile.noticePeriod}. ${profile.workAuth}. Based in ${profile.location} (${profile.timezone}).`,
    ].join('\n')
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

  if (tagName === 'select') {
    // Try to find a matching option
    await selectBestOption(page, inputSelector, answer)
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
