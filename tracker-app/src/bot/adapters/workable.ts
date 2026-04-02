import type { Page } from 'playwright'
import type { ATSAdapter, ApplicantProfile, ApplyResult } from '../types'
import {
  humanDelay,
  downloadCV,
  uploadFile,
  uploadFileViaDataTransfer,
  fillInput,
  takeScreenshot,
  answerScreeningQuestion,
  extractCompanyName,
  extractRoleTitle,
  checkForConfirmation,
  scrollToElement,
} from '../helpers'

export const workable: ATSAdapter = {
  name: 'Workable',

  detect(url: string): boolean {
    return /workable\.com/i.test(url) || /apply\.workable\.com/i.test(url)
  },

  async apply(page: Page, jobUrl: string, profile: ApplicantProfile): Promise<ApplyResult> {
    const start = Date.now()
    let company = 'Unknown'
    let role = 'Unknown'

    try {
      // Step 1: Navigate to job page
      console.log(`[workable] Navigating to ${jobUrl}`)
      await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 })
      await humanDelay(1500, 3000)

      company = await extractCompanyName(page, jobUrl)
      role = await extractRoleTitle(page)
      console.log(`[workable] Detected: ${company} — ${role}`)

      // Step 2: Click "Apply for this job" button
      // Workable typically has a prominent Apply button on the job description page
      const applyButton = page.locator([
        'button:has-text("Apply for this job")',
        'a:has-text("Apply for this job")',
        'button:has-text("Apply now")',
        'a:has-text("Apply now")',
        'button:has-text("Apply")',
        'a:has-text("Apply")',
        '[data-ui="apply-button"]',
        '.styles--apply-button',
      ].join(', ')).first()

      try {
        const isVisible = await applyButton.isVisible({ timeout: 5000 })
        if (isVisible) {
          console.log('[workable] Clicking Apply button')
          await applyButton.click()
          await humanDelay(2000, 3500)
        }
      } catch {
        console.log('[workable] No Apply button found — form may already be visible')
      }

      // Step 3: Wait for the application form to appear
      await page.waitForSelector(
        'form, [data-ui="application-form"], .application-form, #application-form',
        { timeout: 15_000 },
      ).catch(() => {
        console.log('[workable] Form selector not found — continuing anyway')
      })
      await humanDelay(1000, 2000)

      // Step 4: Fill basic fields
      await fillFirstName(page, profile)
      await fillLastName(page, profile)
      await fillEmail(page, profile)
      await fillPhone(page, profile)
      await fillLocation(page, profile)

      // Step 5: Upload CV/Resume
      await uploadCV(page, profile)

      // Step 6: Fill LinkedIn URL
      await fillLinkedIn(page, profile)

      // Step 7: Fill portfolio/website
      await fillPortfolio(page, profile)

      // Step 8: Fill cover letter / additional info
      await fillAdditionalInfo(page, profile)

      // Step 9: Handle screening questions
      await handleScreeningQuestions(page, profile)

      // Step 10: Handle consent checkboxes
      await handleConsent(page)

      await humanDelay(1000, 2000)

      // Step 11: Check for CAPTCHA — if detected, bail to needs_manual
      const captchaPresent = await page.locator(
        'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [class*="captcha"], .g-recaptcha, .h-captcha',
      ).first().isVisible({ timeout: 3000 }).catch(() => false)

      if (captchaPresent) {
        console.log('[workable] CAPTCHA detected — marking needs_manual')
        const screenshot = await takeScreenshot(page)
        return {
          success: false,
          status: 'needs_manual',
          company,
          role,
          ats: 'Workable',
          reason: `CAPTCHA detected — apply manually at: ${jobUrl}`,
          screenshotUrl: screenshot,
          duration: Date.now() - start,
        }
      }

      // Step 12: Submit
      const submitted = await submitForm(page)
      if (!submitted) {
        const screenshot = await takeScreenshot(page)
        return {
          success: false,
          status: 'failed',
          company,
          role,
          ats: 'Workable',
          reason: 'Could not find or click submit button',
          screenshotUrl: screenshot,
          duration: Date.now() - start,
        }
      }

      // Step 13: Wait and check for confirmation
      await humanDelay(3000, 5000)
      const confirmed = await checkForConfirmation(page)

      if (confirmed) {
        console.log('[workable] Application confirmed!')
        return {
          success: true,
          status: 'applied',
          company,
          role,
          ats: 'Workable',
          duration: Date.now() - start,
        }
      }

      // Check for validation errors
      const hasErrors = await page.locator(
        '.error, [class*="error"], [class*="invalid"], [aria-invalid="true"], .field-error',
      ).first().isVisible({ timeout: 3000 }).catch(() => false)

      if (hasErrors) {
        const errorText = await page.locator('.error, [class*="error"], .field-error').first()
          .textContent().catch(() => 'Unknown validation error')
        const screenshot = await takeScreenshot(page)
        return {
          success: false,
          status: 'failed',
          company,
          role,
          ats: 'Workable',
          reason: `Validation error: ${errorText}`,
          screenshotUrl: screenshot,
          duration: Date.now() - start,
        }
      }

      // No confirmation — mark needs_manual
      const screenshot = await takeScreenshot(page)
      return {
        success: false,
        status: 'needs_manual',
        company,
        role,
        ats: 'Workable',
        reason: 'Submitted but no confirmation detected — apply manually to verify',
        screenshotUrl: screenshot,
        duration: Date.now() - start,
      }

    } catch (error) {
      const screenshot = await takeScreenshot(page).catch(() => '')
      return {
        success: false,
        status: 'failed',
        company,
        role,
        ats: 'Workable',
        reason: error instanceof Error ? error.message : String(error),
        screenshotUrl: screenshot,
        duration: Date.now() - start,
      }
    }
  },
}

// ─── Internal helpers ────────────────────────────────────────────────

async function fillFirstName(page: Page, profile: ApplicantProfile): Promise<void> {
  const selectors = [
    'input[name="firstname"]',
    'input[name="first_name"]',
    'input[name*="firstName" i]',
    'input[placeholder*="First name" i]',
    'input[aria-label*="First name" i]',
    'input[id*="firstname" i]',
    'input[data-ui="firstname"]',
  ]

  for (const sel of selectors) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) {
        await fillInput(page, sel, profile.firstName)
        await humanDelay(400, 800)
        console.log('[workable] Filled first name')
        return
      }
    } catch {
      continue
    }
  }
  console.log('[workable] First name field not found')
}

async function fillLastName(page: Page, profile: ApplicantProfile): Promise<void> {
  const selectors = [
    'input[name="lastname"]',
    'input[name="last_name"]',
    'input[name*="lastName" i]',
    'input[placeholder*="Last name" i]',
    'input[aria-label*="Last name" i]',
    'input[id*="lastname" i]',
    'input[data-ui="lastname"]',
  ]

  for (const sel of selectors) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) {
        await fillInput(page, sel, profile.lastName)
        await humanDelay(400, 800)
        console.log('[workable] Filled last name')
        return
      }
    } catch {
      continue
    }
  }
  console.log('[workable] Last name field not found')
}

async function fillEmail(page: Page, profile: ApplicantProfile): Promise<void> {
  const selectors = [
    'input[name="email"]',
    'input[type="email"]',
    'input[name*="email" i]',
    'input[placeholder*="email" i]',
    'input[aria-label*="Email" i]',
    'input[data-ui="email"]',
  ]

  for (const sel of selectors) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) {
        await fillInput(page, sel, profile.email)
        await humanDelay(400, 800)
        console.log('[workable] Filled email')
        return
      }
    } catch {
      continue
    }
  }
  console.log('[workable] Email field not found')
}

async function fillPhone(page: Page, profile: ApplicantProfile): Promise<void> {
  const selectors = [
    'input[name="phone"]',
    'input[type="tel"]',
    'input[name*="phone" i]',
    'input[placeholder*="phone" i]',
    'input[aria-label*="Phone" i]',
    'input[data-ui="phone"]',
  ]

  for (const sel of selectors) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) {
        await fillInput(page, sel, profile.phone)
        await humanDelay(400, 800)
        console.log('[workable] Filled phone')
        return
      }
    } catch {
      continue
    }
  }
  console.log('[workable] Phone field not found')
}

async function fillLocation(page: Page, profile: ApplicantProfile): Promise<void> {
  const selectors = [
    'input[name="location"]',
    'input[name*="city" i]',
    'input[name*="address" i]',
    'input[name*="location" i]',
    'input[placeholder*="City" i]',
    'input[placeholder*="Location" i]',
    'input[placeholder*="Address" i]',
    'input[aria-label*="Location" i]',
    'input[aria-label*="City" i]',
    'input[data-ui="location"]',
  ]

  for (const sel of selectors) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) {
        await fillInput(page, sel, profile.location)
        await humanDelay(400, 800)
        console.log('[workable] Filled location')
        return
      }
    } catch {
      continue
    }
  }
  console.log('[workable] Location field not found')
}

async function uploadCV(page: Page, profile: ApplicantProfile): Promise<void> {
  try {
    const cvBuffer = await downloadCV(page, profile.cvUrl)

    // Workable file input selectors
    const fileInputSelectors = [
      'input[type="file"][name*="resume" i]',
      'input[type="file"][name*="cv" i]',
      'input[type="file"][accept*="pdf" i]',
      'input[type="file"][id*="resume" i]',
      'input[type="file"][id*="cv" i]',
      'input[type="file"]',
    ]

    // Try direct file input first
    for (const sel of fileInputSelectors) {
      try {
        const exists = (await page.locator(sel).first().count()) > 0
        if (exists) {
          await uploadFile(page, sel, cvBuffer, 'Florian_Gouloubi_CV.pdf')
          await humanDelay(1000, 2000)
          console.log('[workable] CV uploaded via file input')
          return
        }
      } catch {
        continue
      }
    }

    // Try clicking an upload button and intercepting filechooser
    const uploadButton = page.locator([
      'button:has-text("Upload resume")',
      'button:has-text("Upload Resume")',
      'button:has-text("Upload CV")',
      'button:has-text("Upload file")',
      'button:has-text("Attach")',
      'a:has-text("Upload resume")',
      'a:has-text("Upload")',
      'label:has-text("Upload")',
      '[data-ui="resume-upload"]',
      '[class*="upload"] button',
      '[class*="dropzone"]',
      'label[for*="resume"]',
      'label[for*="cv"]',
    ].join(', ')).first()

    const uploadVisible = await uploadButton.isVisible({ timeout: 3000 }).catch(() => false)
    if (uploadVisible) {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }),
        uploadButton.click(),
      ])
      await fileChooser.setFiles({
        name: 'Florian_Gouloubi_CV.pdf',
        mimeType: 'application/pdf',
        buffer: cvBuffer,
      })
      await humanDelay(1000, 2000)
      console.log('[workable] CV uploaded via filechooser')
      return
    }

    // DataTransfer fallback
    for (const sel of fileInputSelectors) {
      try {
        const exists = await page.locator(sel).first().count()
        if (exists > 0) {
          await uploadFileViaDataTransfer(page, sel, cvBuffer, 'Florian_Gouloubi_CV.pdf')
          await humanDelay(1000, 2000)
          console.log('[workable] CV uploaded via DataTransfer')
          return
        }
      } catch {
        continue
      }
    }

    console.warn('[workable] CV upload: no file input found')
  } catch (error) {
    console.warn('[workable] CV upload failed:', error)
  }
}

async function fillLinkedIn(page: Page, profile: ApplicantProfile): Promise<void> {
  const selectors = [
    'input[name*="linkedin" i]',
    'input[placeholder*="linkedin" i]',
    'input[id*="linkedin" i]',
    'input[aria-label*="LinkedIn" i]',
    'input[data-ui="linkedin"]',
  ]

  for (const sel of selectors) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) {
        await fillInput(page, sel, profile.linkedin)
        await humanDelay(400, 800)
        console.log('[workable] Filled LinkedIn')
        return
      }
    } catch {
      continue
    }
  }

  // Workable sometimes labels it as a generic "social" or "URL" field with a LinkedIn icon
  // Try fields near a LinkedIn label
  try {
    const linkedinLabel = page.locator('label:has-text("LinkedIn"), span:has-text("LinkedIn")').first()
    const labelVisible = await linkedinLabel.isVisible({ timeout: 2000 }).catch(() => false)
    if (labelVisible) {
      const parentContainer = linkedinLabel.locator('..').first()
      const nearbyInput = parentContainer.locator('input').first()
      const inputVisible = await nearbyInput.isVisible({ timeout: 2000 }).catch(() => false)
      if (inputVisible) {
        await nearbyInput.fill(profile.linkedin)
        await humanDelay(400, 800)
        console.log('[workable] Filled LinkedIn via label proximity')
        return
      }
    }
  } catch {
    // ignore
  }

  console.log('[workable] LinkedIn field not found')
}

async function fillPortfolio(page: Page, profile: ApplicantProfile): Promise<void> {
  const selectors = [
    'input[name*="portfolio" i]',
    'input[name*="website" i]',
    'input[name*="url" i]',
    'input[placeholder*="portfolio" i]',
    'input[placeholder*="website" i]',
    'input[placeholder*="URL" i]',
    'input[aria-label*="Portfolio" i]',
    'input[aria-label*="Website" i]',
    'input[data-ui="portfolio"]',
    'input[data-ui="website"]',
  ]

  for (const sel of selectors) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) {
        // Skip if this is actually the LinkedIn field we already filled
        const currentValue = await page.locator(sel).first().inputValue().catch(() => '')
        if (currentValue.includes('linkedin')) continue

        await fillInput(page, sel, profile.portfolio)
        await humanDelay(400, 800)
        console.log('[workable] Filled portfolio')
        return
      }
    } catch {
      continue
    }
  }

  // Try fields near a "Website" or "Portfolio" label
  try {
    const label = page.locator(
      'label:has-text("Website"), label:has-text("Portfolio"), span:has-text("Website"), span:has-text("Portfolio")',
    ).first()
    const labelVisible = await label.isVisible({ timeout: 2000 }).catch(() => false)
    if (labelVisible) {
      const parentContainer = label.locator('..').first()
      const nearbyInput = parentContainer.locator('input').first()
      const inputVisible = await nearbyInput.isVisible({ timeout: 2000 }).catch(() => false)
      if (inputVisible) {
        const currentValue = await nearbyInput.inputValue().catch(() => '')
        if (!currentValue.includes('linkedin')) {
          await nearbyInput.fill(profile.portfolio)
          await humanDelay(400, 800)
          console.log('[workable] Filled portfolio via label proximity')
          return
        }
      }
    }
  } catch {
    // ignore
  }

  console.log('[workable] Portfolio field not found')
}

async function fillAdditionalInfo(page: Page, profile: ApplicantProfile): Promise<void> {
  const selectors = [
    'textarea[name*="cover" i]',
    'textarea[name*="letter" i]',
    'textarea[name*="summary" i]',
    'textarea[name*="additional" i]',
    'textarea[name*="comment" i]',
    'textarea[placeholder*="cover letter" i]',
    'textarea[placeholder*="additional" i]',
    'textarea[placeholder*="Tell us" i]',
    'textarea[aria-label*="Cover letter" i]',
    'textarea[aria-label*="Additional" i]',
    'textarea[data-ui="cover-letter"]',
  ]

  const text = profile.coverLetterSnippet
    ? `${profile.coverLetterSnippet}\n\nPortfolio: ${profile.portfolio}`
    : [
        `Senior Product Designer with ${profile.yearsExperience}+ years specializing in Design Systems, Design Ops, and complex product architecture.`,
        `Portfolio: ${profile.portfolio}`,
        `Available in ${profile.noticePeriod}. ${profile.workAuth}. Based in ${profile.location} (${profile.timezone}).`,
      ].join('\n')

  for (const sel of selectors) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) {
        await fillInput(page, sel, text)
        await humanDelay(500, 1000)
        console.log('[workable] Filled additional info / cover letter')
        return
      }
    } catch {
      continue
    }
  }
  console.log('[workable] Additional info field not found')
}

async function handleScreeningQuestions(page: Page, profile: ApplicantProfile): Promise<void> {
  // Workable screening questions appear as labeled fields within the form
  // They can be text inputs, textareas, selects, or radio button groups
  const questionContainers = page.locator(
    '[class*="question"], [class*="custom-field"], [data-ui*="question"], .application-question, fieldset',
  )
  const count = await questionContainers.count()
  console.log(`[workable] Found ${count} potential screening question containers`)

  for (let i = 0; i < count; i++) {
    const container = questionContainers.nth(i)

    try {
      const label = container.locator('label, legend, [class*="label"]').first()
      const labelText = await label.textContent({ timeout: 1000 }).catch(() => '')
      if (!labelText || labelText.trim().length < 3) continue

      // Find the input within this container
      const input = container.locator(
        'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea, select',
      ).first()
      const inputCount = await input.count()

      if (inputCount > 0) {
        // Check if already filled
        const currentValue = await input.evaluate((el) => {
          if (el instanceof HTMLSelectElement) return el.value
          return (el as HTMLInputElement).value
        }).catch(() => '')
        if (currentValue && currentValue.trim().length > 0) continue

        const inputId = await input.evaluate((el) => el.id).catch(() => '')
        const inputName = await input.evaluate((el) => (el as HTMLInputElement).name).catch(() => '')
        const inputSelector = inputId
          ? `#${inputId}`
          : inputName
            ? `[name="${inputName}"]`
            : 'input, textarea, select'

        await scrollToElement(page, inputId ? `#${inputId}` : `[name="${inputName}"]`)
        await answerScreeningQuestion(page, labelText, inputSelector, profile)
        await humanDelay(600, 1200)
        continue
      }

      // Handle radio buttons
      const radios = container.locator('input[type="radio"]')
      const radioCount = await radios.count()
      if (radioCount > 0) {
        // For Yes/No questions, prefer "Yes"
        const yesRadio = container.locator('input[type="radio"][value*="yes" i], label:has-text("Yes") input[type="radio"]').first()
        const yesExists = await yesRadio.count()
        if (yesExists > 0) {
          await yesRadio.check()
          await humanDelay(400, 800)
          continue
        }
        // Otherwise check the first radio
        await radios.first().check()
        await humanDelay(400, 800)
      }
    } catch {
      continue
    }
  }
}

async function handleConsent(page: Page): Promise<void> {
  const consentSelectors = [
    'input[type="checkbox"][name*="consent" i]',
    'input[type="checkbox"][name*="privacy" i]',
    'input[type="checkbox"][name*="agree" i]',
    'input[type="checkbox"][name*="gdpr" i]',
    'input[type="checkbox"][name*="terms" i]',
    'input[type="checkbox"][id*="consent" i]',
    'input[type="checkbox"][id*="privacy" i]',
    'input[type="checkbox"][id*="gdpr" i]',
    'input[type="checkbox"][data-ui*="consent"]',
  ]

  for (const sel of consentSelectors) {
    try {
      const checkbox = page.locator(sel).first()
      const visible = await checkbox.isVisible({ timeout: 2000 })
      if (visible) {
        const checked = await checkbox.isChecked()
        if (!checked) {
          await checkbox.check()
          await humanDelay(300, 600)
          console.log(`[workable] Checked consent: ${sel}`)
        }
      }
    } catch {
      continue
    }
  }

  // Also handle EEOC / diversity selects — default to "Decline to self-identify"
  const eeocSelectors = [
    'select[name*="gender" i]',
    'select[name*="race" i]',
    'select[name*="veteran" i]',
    'select[name*="disability" i]',
    'select[name*="ethnicity" i]',
  ]

  for (const sel of eeocSelectors) {
    try {
      const select = page.locator(sel).first()
      const visible = await select.isVisible({ timeout: 2000 })
      if (visible) {
        const options = await select.locator('option').allTextContents()
        const declineOption = options.find((o) =>
          o.toLowerCase().includes('decline') ||
          o.toLowerCase().includes('prefer not') ||
          o.toLowerCase().includes('choose not'),
        )
        if (declineOption) {
          await select.selectOption({ label: declineOption })
          await humanDelay(300, 600)
        }
      }
    } catch {
      continue
    }
  }
}

async function submitForm(page: Page): Promise<boolean> {
  const submitSelectors = [
    'button[type="submit"]',
    'button:has-text("Submit application")',
    'button:has-text("Submit Application")',
    'button:has-text("Submit")',
    'input[type="submit"]',
    'button[data-ui="submit"]',
    'button:has-text("Apply")',
    '#submit-application',
    '[data-ui="application-submit"]',
  ]

  for (const sel of submitSelectors) {
    try {
      const button = page.locator(sel).first()
      const visible = await button.isVisible({ timeout: 3000 })
      if (visible) {
        await scrollToElement(page, sel)
        await humanDelay(500, 1000)
        await button.click()
        console.log(`[workable] Clicked submit: ${sel}`)
        return true
      }
    } catch {
      continue
    }
  }

  console.warn('[workable] Submit button not found')
  return false
}
