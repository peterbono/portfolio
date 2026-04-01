import type { Page } from 'playwright'
import type { ATSAdapter, ApplicantProfile, ApplyResult } from '../types'
import {
  humanDelay,
  downloadCV,
  uploadFile,
  uploadFileViaDataTransfer,
  waitAndClick,
  fillInput,
  typeSlowly,
  takeScreenshot,
  answerScreeningQuestion,
  extractCompanyName,
  extractRoleTitle,
  checkForConfirmation,
  scrollToElement,
} from '../helpers'

const TIMEOUT = 180_000 // 3 minutes

export const greenhouse: ATSAdapter = {
  name: 'Greenhouse',

  detect(url: string): boolean {
    return /greenhouse\.io/i.test(url) || /boards\.greenhouse/i.test(url)
  },

  async apply(page: Page, jobUrl: string, profile: ApplicantProfile): Promise<ApplyResult> {
    const start = Date.now()
    let company = 'Unknown'
    let role = 'Unknown'

    try {
      // Step 1: Navigate to job page
      await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await humanDelay(1500, 3000)

      company = await extractCompanyName(page, jobUrl)
      role = await extractRoleTitle(page)

      // Step 2: Click "Apply for this job" button if present
      // Greenhouse can have the form inline or behind a button
      const applyButton = page.locator([
        'a:has-text("Apply for this job")',
        'a:has-text("Apply now")',
        'button:has-text("Apply for this job")',
        'button:has-text("Apply now")',
        'a[href*="#app"]',
        '#apply_button',
        '.postings-btn',
      ].join(', ')).first()

      try {
        const isVisible = await applyButton.isVisible({ timeout: 5000 })
        if (isVisible) {
          await applyButton.click()
          await humanDelay(1500, 2500)
        }
      } catch {
        // Form might be inline, continue
      }

      // Wait for the application form to appear
      await page.waitForSelector('#application_form, form#application, [id*="application"]', {
        timeout: 15_000,
      }).catch(() => {
        // Some Greenhouse pages use different form structures
      })

      await humanDelay(1000, 2000)

      // Step 3: Fill basic fields
      await fillBasicFields(page, profile)

      // Step 4: Upload CV
      await uploadCV(page, profile)

      // Step 5: Fill LinkedIn URL
      await fillLinkedIn(page, profile)

      // Step 6: Fill website/portfolio
      await fillPortfolio(page, profile)

      // Step 7: Handle location field (autocomplete dropdown)
      await fillLocation(page, profile)

      // Step 8: Answer screening questions
      await handleScreeningQuestions(page, profile)

      // Step 9: Handle consent checkboxes
      await handleConsent(page)

      await humanDelay(1000, 2000)

      // Step 10: Submit
      const submitted = await submitForm(page)
      if (!submitted) {
        const screenshot = await takeScreenshot(page)
        return {
          success: false,
          status: 'failed',
          company,
          role,
          ats: 'Greenhouse',
          reason: 'Could not find or click submit button',
          screenshotUrl: screenshot,
          duration: Date.now() - start,
        }
      }

      // Step 11: Wait for confirmation
      await humanDelay(2000, 4000)
      const confirmed = await checkForConfirmation(page)

      if (confirmed) {
        return {
          success: true,
          status: 'applied',
          company,
          role,
          ats: 'Greenhouse',
          duration: Date.now() - start,
        }
      }

      // Check for validation errors
      const hasErrors = await page.locator('.field--error, .error, [class*="error"]').first().isVisible({ timeout: 3000 }).catch(() => false)
      if (hasErrors) {
        const errorText = await page.locator('.field--error, .error, [class*="error"]').first().textContent().catch(() => 'Unknown validation error')
        const screenshot = await takeScreenshot(page)
        return {
          success: false,
          status: 'failed',
          company,
          role,
          ats: 'Greenhouse',
          reason: `Validation error: ${errorText}`,
          screenshotUrl: screenshot,
          duration: Date.now() - start,
        }
      }

      // No confirmation but no error either — might have succeeded
      return {
        success: true,
        status: 'applied',
        company,
        role,
        ats: 'Greenhouse',
        reason: 'Submitted but no explicit confirmation detected',
        duration: Date.now() - start,
      }

    } catch (error) {
      const screenshot = await takeScreenshot(page).catch(() => '')
      return {
        success: false,
        status: 'failed',
        company,
        role,
        ats: 'Greenhouse',
        reason: error instanceof Error ? error.message : String(error),
        screenshotUrl: screenshot,
        duration: Date.now() - start,
      }
    }
  },
}

// ─── Internal helpers ────────────────────────────────────────────────

async function fillBasicFields(page: Page, profile: ApplicantProfile): Promise<void> {
  // First name
  const firstNameSelectors = [
    '#first_name',
    'input[name="job_application[first_name]"]',
    'input[name*="first_name"]',
    'input[autocomplete="given-name"]',
    'input[placeholder*="First"]',
  ]
  for (const sel of firstNameSelectors) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) {
        await fillInput(page, sel, profile.firstName)
        break
      }
    } catch {
      continue
    }
  }

  await humanDelay(500, 1000)

  // Last name
  const lastNameSelectors = [
    '#last_name',
    'input[name="job_application[last_name]"]',
    'input[name*="last_name"]',
    'input[autocomplete="family-name"]',
    'input[placeholder*="Last"]',
  ]
  for (const sel of lastNameSelectors) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) {
        await fillInput(page, sel, profile.lastName)
        break
      }
    } catch {
      continue
    }
  }

  await humanDelay(500, 1000)

  // Email
  const emailSelectors = [
    '#email',
    'input[name="job_application[email]"]',
    'input[name*="email"]',
    'input[type="email"]',
    'input[autocomplete="email"]',
    'input[placeholder*="email" i]',
  ]
  for (const sel of emailSelectors) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) {
        await fillInput(page, sel, profile.email)
        break
      }
    } catch {
      continue
    }
  }

  await humanDelay(500, 1000)

  // Phone
  const phoneSelectors = [
    '#phone',
    'input[name="job_application[phone]"]',
    'input[name*="phone"]',
    'input[type="tel"]',
    'input[autocomplete="tel"]',
    'input[placeholder*="phone" i]',
  ]
  for (const sel of phoneSelectors) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) {
        await fillInput(page, sel, profile.phone)
        break
      }
    } catch {
      continue
    }
  }
}

async function uploadCV(page: Page, profile: ApplicantProfile): Promise<void> {
  try {
    const cvBuffer = await downloadCV(page, profile.cvUrl)

    // Greenhouse resume upload selectors
    const fileInputSelectors = [
      'input[type="file"][id*="resume"]',
      'input[type="file"][name*="resume"]',
      'input[type="file"][data-field="resume"]',
      '#resume_file_input',
      // Greenhouse also uses a generic data-source pattern
      'input[type="file"]',
    ]

    for (const sel of fileInputSelectors) {
      try {
        const exists = await page.locator(sel).first().count()
        if (exists > 0) {
          await uploadFile(page, sel, cvBuffer, 'Florian_Gouloubi_CV.pdf')
          await humanDelay(1000, 2000)
          return
        }
      } catch {
        continue
      }
    }

    // Try DataTransfer fallback for hidden inputs
    for (const sel of fileInputSelectors) {
      try {
        const attached = await page.locator(sel).first().isAttached()
        if (attached) {
          await uploadFileViaDataTransfer(page, sel, cvBuffer, 'Florian_Gouloubi_CV.pdf')
          await humanDelay(1000, 2000)
          return
        }
      } catch {
        continue
      }
    }

    // Last resort: click the "Attach" button which might trigger a file dialog
    // In a headless context, this won't work — we'll handle via filechooser event
    const attachButton = page.locator('button:has-text("Attach"), a:has-text("Attach resume")').first()
    const attachVisible = await attachButton.isVisible({ timeout: 3000 }).catch(() => false)
    if (attachVisible) {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }),
        attachButton.click(),
      ])
      await fileChooser.setFiles({
        name: 'Florian_Gouloubi_CV.pdf',
        mimeType: 'application/pdf',
        buffer: cvBuffer,
      })
      await humanDelay(1000, 2000)
    }
  } catch (error) {
    // CV upload failed — continue anyway, it might not be required
    console.warn('CV upload failed:', error)
  }
}

async function fillLinkedIn(page: Page, profile: ApplicantProfile): Promise<void> {
  const linkedinSelectors = [
    'input[name*="linkedin" i]',
    'input[placeholder*="linkedin" i]',
    'input[id*="linkedin" i]',
    'input[aria-label*="LinkedIn" i]',
    // Greenhouse custom questions with LinkedIn in the label
    'input[name*="urls[LinkedIn]"]',
  ]

  for (const sel of linkedinSelectors) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) {
        await fillInput(page, sel, profile.linkedin)
        await humanDelay(400, 800)
        return
      }
    } catch {
      continue
    }
  }
}

async function fillPortfolio(page: Page, profile: ApplicantProfile): Promise<void> {
  const portfolioSelectors = [
    'input[name*="website" i]',
    'input[name*="portfolio" i]',
    'input[placeholder*="website" i]',
    'input[placeholder*="portfolio" i]',
    'input[id*="website" i]',
    'input[id*="portfolio" i]',
    'input[aria-label*="Website" i]',
    'input[aria-label*="Portfolio" i]',
    'input[name*="urls[Website]"]',
    'input[name*="urls[Portfolio]"]',
  ]

  for (const sel of portfolioSelectors) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) {
        await fillInput(page, sel, profile.portfolio)
        await humanDelay(400, 800)
        return
      }
    } catch {
      continue
    }
  }
}

async function fillLocation(page: Page, profile: ApplicantProfile): Promise<void> {
  const locationSelectors = [
    '#job_application_location',
    'input[name*="location" i]',
    'input[placeholder*="location" i]',
    'input[aria-label*="Location" i]',
    'input[id*="location" i]',
  ]

  for (const sel of locationSelectors) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) {
        // Greenhouse location uses an autocomplete dropdown
        // We need to type and then select from the dropdown
        await typeSlowly(page, sel, 'Bangkok')
        await humanDelay(1500, 2500) // Wait for autocomplete suggestions

        // Click the first dropdown option
        const dropdownSelectors = [
          '.pac-item:first-child', // Google Places autocomplete
          'li[role="option"]:first-child',
          '.autocomplete-results li:first-child',
          '.select2-results li:first-child',
          '[class*="suggestion"]:first-child',
          '[class*="dropdown"] li:first-child',
          '[class*="option"]:first-child',
        ]

        for (const dropSel of dropdownSelectors) {
          try {
            const dropVisible = await page.locator(dropSel).first().isVisible({ timeout: 2000 })
            if (dropVisible) {
              await page.locator(dropSel).first().click()
              await humanDelay(500, 1000)
              return
            }
          } catch {
            continue
          }
        }

        // No dropdown appeared — the typed value might be sufficient
        await page.keyboard.press('Tab')
        return
      }
    } catch {
      continue
    }
  }
}

async function handleScreeningQuestions(page: Page, profile: ApplicantProfile): Promise<void> {
  // Greenhouse custom questions are in fieldsets or divs with data-question attributes
  const questionContainerSelectors = [
    '.field',
    '[class*="custom-question"]',
    '[data-question]',
    'fieldset',
  ]

  for (const containerSel of questionContainerSelectors) {
    const containers = page.locator(containerSel)
    const count = await containers.count()

    for (let i = 0; i < count; i++) {
      const container = containers.nth(i)

      try {
        // Get the question text from label
        const label = container.locator('label').first()
        const labelText = await label.textContent({ timeout: 1000 }).catch(() => '')
        if (!labelText || labelText.trim().length < 3) continue

        // Skip if it's one of the basic fields we already filled (but NOT cover letter — we want to fill that)
        const lowerLabel = labelText.toLowerCase()
        if (
          lowerLabel.includes('first name') ||
          lowerLabel.includes('last name') ||
          lowerLabel.includes('email') ||
          lowerLabel.includes('phone') ||
          lowerLabel.includes('resume')
        ) continue

        // Handle cover letter fields explicitly
        if (lowerLabel.includes('cover letter')) {
          const textarea = container.locator('textarea').first()
          const textareaExists = await textarea.count()
          if (textareaExists > 0) {
            const currentVal = await textarea.evaluate((el) => (el as HTMLTextAreaElement).value).catch(() => '')
            if (!currentVal || currentVal.trim().length === 0) {
              const textareaId = await textarea.evaluate((el) => el.id).catch(() => '')
              const textareaSel = textareaId ? `#${textareaId}` : `${containerSel}:nth-child(${i + 1}) textarea`
              const coverText = profile.coverLetterSnippet
                ? `${profile.coverLetterSnippet}\n\nPortfolio: ${profile.portfolio}`
                : [
                    `Senior Product Designer with ${profile.yearsExperience}+ years of experience specializing in Design Systems, Design Ops, and complex product architecture.`,
                    `Portfolio: ${profile.portfolio}`,
                    `Available in ${profile.noticePeriod}. ${profile.workAuth}. Based in ${profile.location} (${profile.timezone}).`,
                  ].join('\n')
              await scrollToElement(page, textareaSel)
              await fillInput(page, textareaSel, coverText)
              await humanDelay(600, 1200)
            }
          }
          // Also check for file upload cover letter input — skip those
          continue
        }

        // Find the input within this container
        const input = container.locator('input:not([type="hidden"]):not([type="file"]), textarea, select').first()
        const inputExists = await input.count()
        if (inputExists === 0) continue

        // Check if already filled — but for radio/checkbox, check 'checked' not 'value'
        // (radio buttons always have a value attribute even when not selected)
        const inputType = await input.evaluate((el) => (el as HTMLInputElement).type?.toLowerCase() || '').catch(() => '')
        const isRadioOrCheckbox = inputType === 'radio' || inputType === 'checkbox'

        if (isRadioOrCheckbox) {
          // For radio groups: check if ANY radio in the container is checked
          const anyChecked = await container.locator('input[type="radio"]:checked, input[type="checkbox"]:checked').count() > 0
          if (anyChecked) continue
        } else {
          const currentValue = await input.evaluate((el) => {
            if (el instanceof HTMLSelectElement) return el.value
            return (el as HTMLInputElement).value
          }).catch(() => '')
          if (currentValue && currentValue.trim().length > 0) continue
        }

        // Build a selector for the input
        const inputId = await input.evaluate((el) => el.id).catch(() => '')
        const inputSelector = inputId ? `#${inputId}` : `${containerSel}:nth-child(${i + 1}) input, ${containerSel}:nth-child(${i + 1}) textarea, ${containerSel}:nth-child(${i + 1}) select`

        await scrollToElement(page, inputSelector)
        await answerScreeningQuestion(page, labelText, inputSelector, profile)
        await humanDelay(600, 1200)
      } catch {
        // Skip this question if we can't handle it
        continue
      }
    }
  }
}

async function handleConsent(page: Page): Promise<void> {
  // Check consent / data processing checkboxes
  const consentSelectors = [
    'input[type="checkbox"][id*="consent"]',
    'input[type="checkbox"][id*="privacy"]',
    'input[type="checkbox"][id*="data"]',
    'input[type="checkbox"][id*="agree"]',
    'input[type="checkbox"][name*="consent"]',
    'input[type="checkbox"][name*="privacy"]',
    'input[type="checkbox"][name*="gdpr"]',
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
        }
      }
    } catch {
      continue
    }
  }
}

async function submitForm(page: Page): Promise<boolean> {
  const submitSelectors = [
    '#submit_app',
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Submit Application")',
    'button:has-text("Submit application")',
    'button:has-text("Submit")',
    'input[value="Submit Application"]',
    'input[value="Submit"]',
    'a:has-text("Submit Application")',
  ]

  for (const sel of submitSelectors) {
    try {
      const button = page.locator(sel).first()
      const visible = await button.isVisible({ timeout: 3000 })
      if (visible) {
        await scrollToElement(page, sel)
        await humanDelay(500, 1000)
        await button.click()
        return true
      }
    } catch {
      continue
    }
  }

  return false
}
