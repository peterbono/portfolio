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

      // Step 11: Wait for page to settle after submission (Greenhouse may redirect to code page)
      await humanDelay(4000, 7000)
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

      // Step 11.5: Check for Greenhouse security code verification screen
      // After submission, Greenhouse may show "Enter security code" instead of confirmation.
      // The code is sent to the applicant's email and must be entered to finalize.
      const needsSecurityCode = await detectSecurityCodeScreen(page)
      if (needsSecurityCode) {
        console.log(`[greenhouse] Security code screen detected for ${company}`)

        if (profile.gmailAccessToken) {
          // Poll Gmail for the code (emails take a few seconds to arrive)
          const code = await pollForSecurityCode(company, profile.gmailAccessToken, 45_000)
          if (code) {
            console.log(`[greenhouse] Got security code: ${code.substring(0, 3)}***`)
            await enterSecurityCode(page, code)
            await humanDelay(1000, 2000)
            await submitForm(page)
            await humanDelay(3000, 5000)

            const confirmedAfterCode = await checkForConfirmation(page)
            if (confirmedAfterCode) {
              return {
                success: true,
                status: 'applied',
                company,
                role,
                ats: 'Greenhouse',
                reason: 'Applied after security code verification',
                duration: Date.now() - start,
              }
            }

            // Check if code was wrong or another error
            const postCodeError = await page.locator('.field--error, .error, [class*="error"]').first().isVisible({ timeout: 3000 }).catch(() => false)
            if (postCodeError) {
              const errText = await page.locator('.field--error, .error, [class*="error"]').first().textContent().catch(() => '')
              const screenshot = await takeScreenshot(page)
              return {
                success: false,
                status: 'needs_manual',
                company,
                role,
                ats: 'Greenhouse',
                reason: `Security code entered but error: ${errText}`,
                screenshotUrl: screenshot,
                duration: Date.now() - start,
              }
            }

            // No error, no explicit confirmation — likely succeeded
            return {
              success: true,
              status: 'applied',
              company,
              role,
              ats: 'Greenhouse',
              reason: 'Applied after security code (no explicit confirmation)',
              duration: Date.now() - start,
            }
          } else {
            const screenshot = await takeScreenshot(page)
            return {
              success: false,
              status: 'needs_manual',
              company,
              role,
              ats: 'Greenhouse',
              reason: 'Security code required — code email not found in Gmail within 45s',
              screenshotUrl: screenshot,
              duration: Date.now() - start,
            }
          }
        } else {
          // No Gmail token — can't fetch the code
          const screenshot = await takeScreenshot(page)
          return {
            success: false,
            status: 'needs_manual',
            company,
            role,
            ats: 'Greenhouse',
            reason: 'Security code required — no Gmail access token provided',
            screenshotUrl: screenshot,
            duration: Date.now() - start,
          }
        }
      }

      // Check for validation errors (NOT the security code screen)
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

      // No confirmation, no error — but the security code screen may load late.
      // Wait extra and re-check before assuming success (prevents false "applied").
      await humanDelay(4000, 6000)
      const lateSecurityCode = await detectSecurityCodeScreen(page)
      if (lateSecurityCode) {
        console.log(`[greenhouse] Late security code screen detected for ${company}`)
        if (profile.gmailAccessToken) {
          const code = await pollForSecurityCode(company, profile.gmailAccessToken, 45_000)
          if (code) {
            console.log(`[greenhouse] Got late security code: ${code.substring(0, 3)}***`)
            await enterSecurityCode(page, code)
            await humanDelay(1000, 2000)
            await submitForm(page)
            await humanDelay(3000, 5000)
            const confirmedLate = await checkForConfirmation(page)
            return {
              success: confirmedLate,
              status: confirmedLate ? 'applied' : 'needs_manual',
              company,
              role,
              ats: 'Greenhouse',
              reason: confirmedLate ? 'Applied after late security code' : 'Late security code entered but no confirmation',
              duration: Date.now() - start,
            }
          }
        }
        const screenshot = await takeScreenshot(page)
        return {
          success: false,
          status: 'needs_manual',
          company,
          role,
          ats: 'Greenhouse',
          reason: 'Security code required (late detection) — no Gmail token or code not found',
          screenshotUrl: screenshot,
          duration: Date.now() - start,
        }
      }

      // Also check URL — Greenhouse may redirect to a code page
      const currentUrl = page.url()
      if (currentUrl.includes('security') || currentUrl.includes('verify') || currentUrl.includes('code')) {
        const screenshot = await takeScreenshot(page)
        return {
          success: false,
          status: 'needs_manual',
          company,
          role,
          ats: 'Greenhouse',
          reason: `Redirected to verification page: ${currentUrl}`,
          screenshotUrl: screenshot,
          duration: Date.now() - start,
        }
      }

      // Truly no code, no error, no confirmation — likely succeeded
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

/**
 * Determine answer for checkbox/radio screening questions in Greenhouse fieldsets.
 * Covers the most common patterns; textual questions go through the generic helper.
 */
function getFieldsetAnswer(questionText: string, profile: ApplicantProfile): string {
  const q = questionText.toLowerCase()
  if (q.includes('employment') || q.includes('work type') || q.includes('contract type') || q.includes('arrangement') || q.includes('engagement')) return 'Contract'
  if (q.includes('availability') || q.includes('hours') || q.includes('commitment')) return 'Full-time'
  if (q.includes('how did you') || q.includes('hear about') || q.includes('source') || q.includes('referr')) return 'LinkedIn'
  if (q.includes('remote') || q.includes('work from home')) return 'Yes'
  if (q.includes('relocat')) return 'Open to relocation'
  if (q.includes('authorized') || q.includes('visa') || q.includes('sponsor') || q.includes('work permit') || q.includes('legally')) return profile.workAuth
  if (q.includes('gender') || q.includes('pronoun')) return 'Prefer not to say'
  if (q.includes('disability') || q.includes('handicap')) return 'Prefer not to say'
  if (q.includes('race') || q.includes('ethnic')) return 'Prefer not to say'
  if (q.includes('veteran')) return 'No'
  if (q.includes('salary') || q.includes('compensation')) return '70000 EUR'
  if (q.includes('notice') || q.includes('start') || q.includes('when can you')) return profile.noticePeriod
  if (q.includes('language') && !q.includes('programming')) return 'English'
  if (q.includes('do you') || q.includes('are you') || q.includes('have you') || q.includes('can you')) return 'Yes'
  return 'Yes'
}

async function handleScreeningQuestions(page: Page, profile: ApplicantProfile): Promise<void> {
  // Greenhouse custom questions are in fieldsets or divs with field-related classes.
  // Important: `.field` matches <div class="field"> but NOT <div class="field-wrapper">,
  // so we need both selectors. Greenhouse uses both patterns depending on the form version.
  const questionContainerSelectors = [
    '.field',
    '.field-wrapper',
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
        // ──── Handle checkbox/radio fieldsets FIRST ────
        // Greenhouse checkboxes: <fieldset><legend>Question</legend><div class="checkbox__wrapper">
        //   <div class="checkbox__input"><input type="checkbox"/></div><label>Option</label></div>
        // Must run BEFORE generic label-reading because:
        //  (a) question text is in <legend>, not <label> (<label> = option text)
        //  (b) input IDs contain [] which break CSS # selectors
        //  (c) nested div structure confuses the generic handleRadioOrCheckbox helper
        const containerTag = await container.evaluate(el => el.tagName.toLowerCase()).catch(() => '')
        const fieldsetLoc = containerTag === 'fieldset' ? container : container.locator('fieldset').first()
        const hasFieldsetWithInputs = await fieldsetLoc.count() > 0

        if (hasFieldsetWithInputs) {
          const cbCount = await fieldsetLoc.locator('input[type="checkbox"]').count()
          const rdCount = await fieldsetLoc.locator('input[type="radio"]').count()

          if (cbCount > 0 || rdCount > 0) {
            const fType = cbCount > 0 ? 'checkbox' : 'radio'
            const anyChecked = await fieldsetLoc.locator(`input[type="${fType}"]:checked`).count() > 0
            if (anyChecked) continue

            const legendText = await fieldsetLoc.locator('legend').first().textContent({ timeout: 1000 }).catch(() => '')
            if (!legendText || legendText.trim().length < 3) continue

            await fieldsetLoc.scrollIntoViewIfNeeded().catch(() => {})
            const answer = getFieldsetAnswer(legendText, profile)
            const desired = answer.toLowerCase()

            const optLabels = fieldsetLoc.locator('label')
            const optCount = await optLabels.count()

            let bestIdx = -1
            let bestScore = 0
            for (let j = 0; j < optCount; j++) {
              const text = (await optLabels.nth(j).textContent())?.toLowerCase().trim() || ''
              if (!text || text.length < 2) continue
              let score = 0
              if (text === desired) score = 100
              else if (text.includes(desired)) score = 80
              else if (desired.includes(text)) score = 60
              else {
                const desiredWords = desired.split(/[\s/,]+/)
                const textWords = text.split(/[\s/,]+/)
                const matching = desiredWords.filter(w => textWords.some(tw => tw.includes(w) || w.includes(tw)))
                if (matching.length > 0) score = 20 + matching.length * 10
              }
              if (score > bestScore) { bestScore = score; bestIdx = j }
            }

            if (bestIdx >= 0 && bestScore >= 20) {
              const chosen = await optLabels.nth(bestIdx).textContent()
              await optLabels.nth(bestIdx).click()
              console.log(`[screening] Fieldset ${fType}: clicked "${chosen?.trim()}" (score ${bestScore}) for "${legendText.trim()}"`)
            } else if (optCount > 0) {
              const fb = await optLabels.nth(0).textContent()
              await optLabels.nth(0).click()
              console.log(`[screening] Fieldset ${fType}: fallback clicked "${fb?.trim()}" for "${legendText.trim()}"`)
            }
            await humanDelay(300, 600)
            continue
          }
        }

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
        // Use [id="..."] instead of #id — IDs may contain [] which break CSS # selectors
        const inputSelector = inputId ? `[id="${inputId}"]` : `${containerSel}:nth-child(${i + 1}) input, ${containerSel}:nth-child(${i + 1}) textarea, ${containerSel}:nth-child(${i + 1}) select`

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

// ─── Security code verification (Greenhouse email OTP) ──────────────

/**
 * Detect if the page shows Greenhouse's security code verification screen.
 * After form submission, Greenhouse may require email verification before
 * finalizing the application.
 */
async function detectSecurityCodeScreen(page: Page): Promise<boolean> {
  const codeIndicators = [
    'text=/security code/i',
    'text=/enter the code/i',
    'text=/check your email/i',
    'text=/verification code/i',
    'text=/code was sent/i',
    'text=/emailed you a code/i',
    'input[name*="security_code"]',
    'input[id*="security_code"]',
    'input[name*="verification_code"]',
  ]

  for (const sel of codeIndicators) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) return true
    } catch {
      continue
    }
  }
  return false
}

/**
 * Poll Gmail for a Greenhouse security code email.
 * Greenhouse sends: "Copy and paste this code into the security code field
 * on your application: XXXXXXXX"
 *
 * @param company - Company name to match in the email subject
 * @param accessToken - Google OAuth access token with gmail.readonly scope
 * @param maxWaitMs - Maximum polling duration (default 45s)
 * @returns The security code string, or null if not found
 */
async function pollForSecurityCode(
  company: string,
  accessToken: string,
  maxWaitMs = 45_000,
): Promise<string | null> {
  const startTime = Date.now()
  const pollInterval = 5_000

  while (Date.now() - startTime < maxWaitMs) {
    const code = await fetchCodeFromGmail(company, accessToken)
    if (code) return code

    console.log(`[greenhouse] Waiting for security code email... (${Math.round((Date.now() - startTime) / 1000)}s)`)
    await new Promise(r => setTimeout(r, pollInterval))
  }

  console.warn(`[greenhouse] Security code not found after ${maxWaitMs / 1000}s`)
  return null
}

/**
 * Single attempt to fetch the Greenhouse security code from Gmail.
 */
async function fetchCodeFromGmail(company: string, accessToken: string): Promise<string | null> {
  try {
    // Search for security code emails from Greenhouse for this company (last 10 minutes)
    const query = `from:greenhouse subject:"security code" subject:"${company}" newer_than:10m`
    const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=1`

    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (listRes.status === 401) {
      console.warn('[greenhouse] Gmail token expired (401)')
      return null
    }
    if (!listRes.ok) {
      console.warn(`[greenhouse] Gmail API error: ${listRes.status}`)
      return null
    }

    const listData = await listRes.json() as { messages?: Array<{ id: string }> }
    if (!listData.messages?.length) return null

    // Get the most recent email
    const msgId = listData.messages[0].id
    const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`
    const msgRes = await fetch(msgUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!msgRes.ok) return null

    const msgData = await msgRes.json() as { snippet?: string }
    const snippet = msgData.snippet || ''

    // Extract code: "...security code field on your application: XXXXXXXX After you enter..."
    const codeMatch = snippet.match(/application:\s*(\S+)\s+After/i)
    if (codeMatch) return codeMatch[1]

    // Fallback: 6-10 char alphanumeric code after a colon
    const fallback = snippet.match(/:\s*([A-Za-z0-9]{6,10})\s/)
    if (fallback) return fallback[1]

    console.warn('[greenhouse] Could not extract code from email snippet:', snippet.substring(0, 100))
    return null
  } catch (err) {
    console.warn('[greenhouse] Gmail fetch error:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Enter the security code into the verification form.
 */
async function enterSecurityCode(page: Page, code: string): Promise<void> {
  const codeInputSelectors = [
    'input[name*="security_code"]',
    'input[id*="security_code"]',
    'input[name*="verification_code"]',
    'input[id*="verification_code"]',
    'input[name*="code"]',
    'input[aria-label*="code" i]',
    'input[placeholder*="code" i]',
    // Last resort: any visible text input on the code page
    'input[type="text"]',
  ]

  for (const sel of codeInputSelectors) {
    try {
      const input = page.locator(sel).first()
      const visible = await input.isVisible({ timeout: 2000 })
      if (visible) {
        await input.click()
        await humanDelay(200, 400)
        await input.fill(code)
        console.log(`[greenhouse] Entered security code in ${sel}`)
        return
      }
    } catch {
      continue
    }
  }

  console.warn('[greenhouse] Could not find security code input field')
}
