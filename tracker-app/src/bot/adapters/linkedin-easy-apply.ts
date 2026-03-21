import type { Page } from 'playwright'
import type { ATSAdapter, ApplicantProfile, ApplyResult } from '../types'
import {
  humanDelay,
  downloadCV,
  uploadFile,
  fillInput,
  takeScreenshot,
  answerScreeningQuestion,
  extractRoleTitle,
  scrollToElement,
} from '../helpers'

/**
 * LinkedIn Easy Apply adapter.
 *
 * IMPORTANT: Requires an active LinkedIn session.
 * The Playwright browser context must have LinkedIn cookies loaded
 * before this adapter is used. Fields like name and email are typically
 * pre-filled from the LinkedIn profile.
 */
export const linkedInEasyApply: ATSAdapter = {
  name: 'LinkedIn Easy Apply',

  detect(url: string): boolean {
    return /linkedin\.com\/jobs/i.test(url)
  },

  async apply(page: Page, jobUrl: string, profile: ApplicantProfile): Promise<ApplyResult> {
    const start = Date.now()
    let company = 'Unknown'
    let role = 'Unknown'

    try {
      // Step 1: Navigate to job posting
      await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await humanDelay(2000, 4000)

      // Check if logged in
      const isLoggedIn = await page.locator('.global-nav__me, [data-control-name="identity_welcome_message"]').first()
        .isVisible({ timeout: 5000 }).catch(() => false)

      if (!isLoggedIn) {
        return {
          success: false,
          status: 'skipped',
          company,
          role,
          ats: 'LinkedIn Easy Apply',
          reason: 'Not logged into LinkedIn — session cookies required',
          duration: Date.now() - start,
        }
      }

      // Extract company and role
      role = await extractRoleTitle(page)
      company = await extractCompanyFromLinkedIn(page)

      // Step 2: Find and click "Easy Apply" button
      const easyApplyButton = page.locator([
        'button.jobs-apply-button',
        'button:has-text("Easy Apply")',
        'button[aria-label*="Easy Apply"]',
        '.jobs-apply-button--top-card button',
        '.jobs-s-apply button',
      ].join(', ')).first()

      const easyApplyVisible = await easyApplyButton.isVisible({ timeout: 8000 }).catch(() => false)
      if (!easyApplyVisible) {
        // Might be a non-Easy-Apply job (redirects to external site)
        const externalApply = await page.locator('button:has-text("Apply"), a:has-text("Apply on company")').first()
          .isVisible({ timeout: 3000 }).catch(() => false)
        if (externalApply) {
          return {
            success: false,
            status: 'skipped',
            company,
            role,
            ats: 'LinkedIn Easy Apply',
            reason: 'Not an Easy Apply job — requires external application',
            duration: Date.now() - start,
          }
        }
        return {
          success: false,
          status: 'failed',
          company,
          role,
          ats: 'LinkedIn Easy Apply',
          reason: 'Easy Apply button not found',
          screenshotUrl: await takeScreenshot(page),
          duration: Date.now() - start,
        }
      }

      await easyApplyButton.click()
      await humanDelay(1500, 3000)

      // Step 3: Wait for the Easy Apply modal
      await page.waitForSelector('.jobs-easy-apply-modal, [class*="easy-apply"]', {
        timeout: 10_000,
      }).catch(() => {})

      await humanDelay(1000, 2000)

      // Step 4: Process multi-step form
      const maxSteps = 10 // Safety limit
      let stepCount = 0

      while (stepCount < maxSteps) {
        stepCount++

        // Check if we're on a review/confirmation step
        const isReviewStep = await page.locator('h3:has-text("Review"), [class*="review"]').first()
          .isVisible({ timeout: 2000 }).catch(() => false)

        if (isReviewStep) {
          // On review step — click Submit
          const submitButton = page.locator([
            'button[aria-label*="Submit application"]',
            'button:has-text("Submit application")',
            'button:has-text("Submit")',
            'footer button.artdeco-button--primary',
          ].join(', ')).first()

          const submitVisible = await submitButton.isVisible({ timeout: 5000 }).catch(() => false)
          if (submitVisible) {
            await humanDelay(500, 1000)
            await submitButton.click()
            await humanDelay(2000, 4000)
            break
          }
        }

        // Fill any visible fields on the current step
        await fillCurrentStep(page, profile)
        await humanDelay(800, 1500)

        // Upload CV if this step has a file input
        await handleResumeStep(page, profile)

        // Try to advance to next step
        const advanced = await advanceStep(page)
        if (!advanced) {
          // Could not advance — might be stuck or done
          break
        }

        await humanDelay(1000, 2500)
      }

      // Check for success — LinkedIn shows a confirmation dialog
      const isSuccess = await checkLinkedInConfirmation(page)

      if (isSuccess) {
        // Dismiss the confirmation modal
        await page.locator('button:has-text("Done"), button[aria-label*="Dismiss"]').first()
          .click().catch(() => {})

        return {
          success: true,
          status: 'applied',
          company,
          role,
          ats: 'LinkedIn Easy Apply',
          duration: Date.now() - start,
        }
      }

      // Check for errors
      const hasError = await page.locator('[class*="error"], .artdeco-inline-feedback--error').first()
        .isVisible({ timeout: 3000 }).catch(() => false)

      if (hasError) {
        const errorText = await page.locator('[class*="error"], .artdeco-inline-feedback--error').first()
          .textContent().catch(() => 'Unknown error')
        const screenshot = await takeScreenshot(page)
        return {
          success: false,
          status: 'failed',
          company,
          role,
          ats: 'LinkedIn Easy Apply',
          reason: `Form error: ${errorText}`,
          screenshotUrl: screenshot,
          duration: Date.now() - start,
        }
      }

      // No clear success or failure
      const screenshot = await takeScreenshot(page)
      return {
        success: false,
        status: 'needs_manual',
        company,
        role,
        ats: 'LinkedIn Easy Apply',
        reason: 'Could not determine if application was submitted successfully',
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
        ats: 'LinkedIn Easy Apply',
        reason: error instanceof Error ? error.message : String(error),
        screenshotUrl: screenshot,
        duration: Date.now() - start,
      }
    }
  },
}

// ─── Internal helpers ────────────────────────────────────────────────

async function extractCompanyFromLinkedIn(page: Page): Promise<string> {
  const companySelectors = [
    '.jobs-unified-top-card__company-name a',
    '.jobs-unified-top-card__company-name',
    '.job-details-jobs-unified-top-card__company-name a',
    '.job-details-jobs-unified-top-card__company-name',
    'a[data-control-name="company_link"]',
    '.jobs-details-top-card__company-url',
  ]

  for (const sel of companySelectors) {
    try {
      const text = await page.locator(sel).first().textContent({ timeout: 3000 })
      if (text && text.trim().length > 1) {
        return text.trim()
      }
    } catch {
      continue
    }
  }

  return 'Unknown Company'
}

async function fillCurrentStep(page: Page, profile: ApplicantProfile): Promise<void> {
  // Find all form groups within the Easy Apply modal
  const modal = page.locator('.jobs-easy-apply-modal, [class*="easy-apply"]').first()
  const formGroups = modal.locator('.fb-dash-form-element, [class*="form-component"], .jobs-easy-apply-form-section__grouping')
  const groupCount = await formGroups.count()

  for (let i = 0; i < groupCount; i++) {
    const group = formGroups.nth(i)

    try {
      // Get the label text
      const label = group.locator('label, .fb-dash-form-element__label, span[class*="label"]').first()
      const labelText = await label.textContent({ timeout: 1000 }).catch(() => '')
      if (!labelText || labelText.trim().length < 2) continue

      // Find the input in this group
      const input = group.locator('input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea, select').first()
      const inputExists = await input.count()

      if (inputExists > 0) {
        // Check if the field is already filled
        const currentValue = await input.evaluate((el) => {
          if (el instanceof HTMLSelectElement) return el.value
          return (el as HTMLInputElement).value
        }).catch(() => '')

        if (currentValue && currentValue.trim().length > 0) continue

        // Get a reliable selector
        const inputId = await input.evaluate((el) => el.id).catch(() => '')
        const selector = inputId ? `#${inputId}` : 'input, textarea, select'

        await answerScreeningQuestion(page, labelText, selector, profile)
        await humanDelay(400, 900)
        continue
      }

      // Handle radio button groups
      const radios = group.locator('input[type="radio"]')
      const radioCount = await radios.count()
      if (radioCount > 0) {
        await handleRadioQuestion(group, labelText, profile)
        await humanDelay(400, 800)
        continue
      }

      // Handle checkbox groups
      const checkboxes = group.locator('input[type="checkbox"]')
      const checkboxCount = await checkboxes.count()
      if (checkboxCount > 0) {
        // For required checkboxes (like follow-up consent), check them
        const firstCheckbox = checkboxes.first()
        const isRequired = await firstCheckbox.evaluate((el) =>
          el.hasAttribute('required') || el.closest('[class*="required"]') !== null,
        ).catch(() => false)
        if (isRequired) {
          await firstCheckbox.check().catch(() => {})
        }
        continue
      }
    } catch {
      continue
    }
  }
}

async function handleRadioQuestion(
  group: ReturnType<Page['locator']>,
  labelText: string,
  profile: ApplicantProfile,
): Promise<void> {
  const q = labelText.toLowerCase()
  let desiredAnswer = 'yes'

  // Determine the best answer based on the question
  if (q.includes('sponsor') || q.includes('visa require')) {
    desiredAnswer = 'no' // EU citizen, doesn't need sponsorship for EU roles
  } else if (q.includes('authorized') || q.includes('legally') || q.includes('eligible')) {
    desiredAnswer = 'yes'
  } else if (q.includes('remote') || q.includes('work from')) {
    desiredAnswer = 'yes'
  } else if (q.includes('relocate')) {
    desiredAnswer = 'yes'
  } else if (q.includes('commute') || q.includes('office')) {
    desiredAnswer = 'yes'
  }

  // Try to find and click the matching radio label
  const radioLabels = group.locator('label')
  const labelCount = await radioLabels.count()

  for (let i = 0; i < labelCount; i++) {
    const text = (await radioLabels.nth(i).textContent())?.toLowerCase() || ''
    if (text.includes(desiredAnswer)) {
      await radioLabels.nth(i).click()
      return
    }
  }

  // Fallback: click the first option
  if (labelCount > 0) {
    await radioLabels.first().click()
  }
}

async function handleResumeStep(page: Page, profile: ApplicantProfile): Promise<void> {
  const modal = page.locator('.jobs-easy-apply-modal, [class*="easy-apply"]').first()

  // Check if there's a file upload on this step
  const fileInput = modal.locator('input[type="file"]').first()
  const hasFileInput = await fileInput.count() > 0

  if (!hasFileInput) return

  // Check if a resume is already uploaded (LinkedIn saves previous uploads)
  const existingResume = modal.locator('[class*="resume"], [class*="document"]').first()
  const hasExisting = await existingResume.isVisible({ timeout: 2000 }).catch(() => false)

  if (hasExisting) {
    // Resume already uploaded, no need to re-upload
    return
  }

  try {
    const cvBuffer = await downloadCV(page, profile.cvUrl)
    await uploadFile(page, 'input[type="file"]', cvBuffer, 'Florian_Gouloubi_CV.pdf')
    await humanDelay(1500, 3000)
  } catch (error) {
    console.warn('LinkedIn CV upload failed:', error)
  }
}

async function advanceStep(page: Page): Promise<boolean> {
  // LinkedIn Easy Apply uses Next / Review / Submit buttons in a footer
  const nextSelectors = [
    'button[aria-label*="Continue to next step"]',
    'button[aria-label*="Review your application"]',
    'button:has-text("Next")',
    'button:has-text("Review")',
    'button:has-text("Continue")',
    'footer button.artdeco-button--primary',
  ]

  for (const sel of nextSelectors) {
    try {
      const button = page.locator(sel).first()
      const visible = await button.isVisible({ timeout: 3000 })
      if (visible) {
        const isDisabled = await button.evaluate((el) => (el as HTMLButtonElement).disabled)
        if (!isDisabled) {
          await button.click()
          await humanDelay(1000, 2000)

          // Wait for the next step to load
          await page.waitForTimeout(1000)
          return true
        }
      }
    } catch {
      continue
    }
  }

  // Check if the Submit button is available (final step)
  const submitSelectors = [
    'button[aria-label*="Submit application"]',
    'button:has-text("Submit application")',
    'button:has-text("Submit")',
  ]

  for (const sel of submitSelectors) {
    try {
      const button = page.locator(sel).first()
      const visible = await button.isVisible({ timeout: 3000 })
      if (visible) {
        await humanDelay(500, 1000)
        await button.click()
        await humanDelay(2000, 4000)
        return false // We submitted, stop advancing
      }
    } catch {
      continue
    }
  }

  return false
}

async function checkLinkedInConfirmation(page: Page): Promise<boolean> {
  const confirmationSelectors = [
    'h2:has-text("Your application was sent")',
    'h3:has-text("Your application was sent")',
    'text=Your application was sent',
    'text=Application submitted',
    'text=application was submitted',
    '[class*="post-apply"]',
    '.artdeco-modal:has-text("application was sent")',
  ]

  for (const sel of confirmationSelectors) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 5000 })
      if (visible) return true
    } catch {
      continue
    }
  }

  return false
}
