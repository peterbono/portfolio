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

/**
 * Generic ATS adapter — fallback for unknown platforms.
 *
 * Uses heuristic detection of common form patterns (name, email, phone, etc.)
 * to attempt filling and submitting application forms.
 * Returns 'needs_manual' if the form structure cannot be reliably identified.
 */
export const generic: ATSAdapter = {
  name: 'Generic',

  detect(_url: string): boolean {
    // Always matches as fallback
    return true
  },

  async apply(page: Page, jobUrl: string, profile: ApplicantProfile): Promise<ApplyResult> {
    const start = Date.now()
    let company = 'Unknown'
    let role = 'Unknown'

    try {
      // Step 1: Navigate
      await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await humanDelay(2000, 4000)

      company = await extractCompanyName(page, jobUrl)
      role = await extractRoleTitle(page)

      // Step 2: Look for an "Apply" button to open the form
      const applyOpened = await clickApplyButton(page)
      if (applyOpened) {
        await humanDelay(1500, 3000)
      }

      // Step 3: Detect if there's an application form on the page
      const formDetected = await detectApplicationForm(page)

      if (!formDetected) {
        const screenshot = await takeScreenshot(page)
        return {
          success: false,
          status: 'needs_manual',
          company,
          role,
          ats: 'Generic',
          reason: 'Could not detect an application form on this page',
          screenshotUrl: screenshot,
          duration: Date.now() - start,
        }
      }

      // Step 4: Fill detected fields
      const fieldsFilled = await fillDetectedFields(page, profile)

      if (fieldsFilled < 2) {
        // If we could fill fewer than 2 fields, the form is too unfamiliar
        const screenshot = await takeScreenshot(page)
        return {
          success: false,
          status: 'needs_manual',
          company,
          role,
          ats: 'Generic',
          reason: `Only filled ${fieldsFilled} field(s) — form structure not recognized`,
          screenshotUrl: screenshot,
          duration: Date.now() - start,
        }
      }

      // Step 5: Upload CV
      await uploadCVGeneric(page, profile)

      // Step 6: Handle textareas (cover letter, additional info)
      await fillTextareas(page, profile)

      // Step 7: Handle consent checkboxes
      await handleConsentCheckboxes(page)

      await humanDelay(1000, 2000)

      // Step 8: Submit
      const submitted = await submitGenericForm(page)

      if (!submitted) {
        const screenshot = await takeScreenshot(page)
        return {
          success: false,
          status: 'needs_manual',
          company,
          role,
          ats: 'Generic',
          reason: 'Could not find a submit button',
          screenshotUrl: screenshot,
          duration: Date.now() - start,
        }
      }

      // Step 9: Check for confirmation
      await humanDelay(2000, 4000)
      const confirmed = await checkForConfirmation(page, jobUrl)

      if (confirmed) {
        return {
          success: true,
          status: 'applied',
          company,
          role,
          ats: 'Generic',
          duration: Date.now() - start,
        }
      }

      // Check for validation errors
      const hasErrors = await page.locator('[class*="error"]:visible, .invalid-feedback:visible, [aria-invalid="true"]').first()
        .isVisible({ timeout: 3000 }).catch(() => false)

      if (hasErrors) {
        const screenshot = await takeScreenshot(page)
        return {
          success: false,
          status: 'failed',
          company,
          role,
          ats: 'Generic',
          reason: 'Form validation errors after submission',
          screenshotUrl: screenshot,
          duration: Date.now() - start,
        }
      }

      // Submitted but unclear result
      return {
        success: false,
        status: 'needs_manual',
        company,
        role,
        ats: 'Generic',
        reason: 'Submitted but could not verify confirmation',
        screenshotUrl: await takeScreenshot(page),
        duration: Date.now() - start,
      }

    } catch (error) {
      const screenshot = await takeScreenshot(page).catch(() => '')
      return {
        success: false,
        status: 'failed',
        company,
        role,
        ats: 'Generic',
        reason: error instanceof Error ? error.message : String(error),
        screenshotUrl: screenshot,
        duration: Date.now() - start,
      }
    }
  },
}

// ─── Internal helpers ────────────────────────────────────────────────

async function clickApplyButton(page: Page): Promise<boolean> {
  const applySelectors = [
    'a:has-text("Apply")',
    'button:has-text("Apply")',
    'a:has-text("Apply now")',
    'button:has-text("Apply now")',
    'a:has-text("Apply for this job")',
    'button:has-text("Apply for this job")',
    'a[href*="apply"]',
    '[class*="apply"] a',
    '[class*="apply"] button',
  ]

  for (const sel of applySelectors) {
    try {
      const button = page.locator(sel).first()
      const visible = await button.isVisible({ timeout: 3000 })
      if (visible) {
        await button.click()
        await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {})
        return true
      }
    } catch {
      continue
    }
  }

  return false
}

async function detectApplicationForm(page: Page): Promise<boolean> {
  // A page has an application form if it has at least an email-ish input
  // and some other personal info fields

  const indicators = [
    'input[type="email"]',
    'input[name*="email" i]',
    'input[placeholder*="email" i]',
    'input[name*="name" i]',
    'input[placeholder*="name" i]',
    'input[type="tel"]',
    'input[name*="phone" i]',
    'input[type="file"]',
    'form[action*="apply" i]',
    'form[action*="submit" i]',
    'form[action*="application" i]',
  ]

  let matches = 0
  for (const sel of indicators) {
    try {
      const count = await page.locator(sel).count()
      if (count > 0) matches++
    } catch {
      continue
    }
  }

  // Need at least 2 indicators to consider it an application form
  return matches >= 2
}

/**
 * Detect and fill common form fields using name/placeholder/label heuristics.
 * Returns the number of fields successfully filled.
 */
async function fillDetectedFields(page: Page, profile: ApplicantProfile): Promise<number> {
  let filled = 0

  // Define field detection patterns and their values
  const fieldMappings: Array<{
    namePatterns: RegExp[]
    placeholderPatterns: RegExp[]
    typePatterns: string[]
    value: string
  }> = [
    {
      namePatterns: [/first.?name/i, /fname/i, /given.?name/i, /prenom/i],
      placeholderPatterns: [/first\s*name/i, /given\s*name/i, /pr[eé]nom/i],
      typePatterns: [],
      value: profile.firstName,
    },
    {
      namePatterns: [/last.?name/i, /lname/i, /family.?name/i, /surname/i, /nom$/i],
      placeholderPatterns: [/last\s*name/i, /family\s*name/i, /surname/i],
      typePatterns: [],
      value: profile.lastName,
    },
    {
      namePatterns: [/^name$/i, /full.?name/i],
      placeholderPatterns: [/full\s*name/i, /your\s*name/i, /^name$/i],
      typePatterns: [],
      value: `${profile.firstName} ${profile.lastName}`,
    },
    {
      namePatterns: [/email/i, /e.?mail/i, /courriel/i],
      placeholderPatterns: [/email/i, /e-mail/i],
      typePatterns: ['email'],
      value: profile.email,
    },
    {
      namePatterns: [/phone/i, /mobile/i, /tel/i, /t[eé]l[eé]phone/i],
      placeholderPatterns: [/phone/i, /mobile/i, /tel/i],
      typePatterns: ['tel'],
      value: profile.phone,
    },
    {
      namePatterns: [/linkedin/i],
      placeholderPatterns: [/linkedin/i],
      typePatterns: [],
      value: profile.linkedin,
    },
    {
      namePatterns: [/website/i, /portfolio/i, /url/i, /site/i],
      placeholderPatterns: [/website/i, /portfolio/i, /url/i],
      typePatterns: ['url'],
      value: profile.portfolio,
    },
    {
      namePatterns: [/location/i, /city/i, /address/i, /ville/i],
      placeholderPatterns: [/location/i, /city/i, /where/i],
      typePatterns: [],
      value: profile.location,
    },
  ]

  // Get all visible inputs
  const allInputs = page.locator('input:visible:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"])')
  const inputCount = await allInputs.count()

  for (let i = 0; i < inputCount; i++) {
    const input = allInputs.nth(i)

    try {
      // Skip already-filled inputs
      const currentValue = await input.evaluate((el) => (el as HTMLInputElement).value)
      if (currentValue && currentValue.trim().length > 0) continue

      const name = (await input.getAttribute('name')) || ''
      const placeholder = (await input.getAttribute('placeholder')) || ''
      const type = (await input.getAttribute('type')) || ''
      const ariaLabel = (await input.getAttribute('aria-label')) || ''
      const id = (await input.getAttribute('id')) || ''

      // Also check the associated label
      let labelText = ''
      if (id) {
        labelText = await page.locator(`label[for="${id}"]`).first().textContent().catch(() => '') || ''
      }

      const allText = `${name} ${placeholder} ${ariaLabel} ${labelText} ${id}`.toLowerCase()

      // Match against our field mappings
      for (const mapping of fieldMappings) {
        const nameMatch = mapping.namePatterns.some((p) => p.test(name))
        const placeholderMatch = mapping.placeholderPatterns.some((p) => p.test(placeholder))
        const typeMatch = mapping.typePatterns.includes(type)
        const labelMatch = mapping.namePatterns.some((p) => p.test(allText))

        if (nameMatch || placeholderMatch || typeMatch || labelMatch) {
          const inputId = await input.evaluate((el) => el.id).catch(() => '')
          const selector = inputId ? `#${inputId}` : `input[name="${name}"]`

          try {
            await fillInput(page, selector, mapping.value)
            filled++
            await humanDelay(400, 800)
          } catch {
            // Try clicking the element directly and filling
            try {
              await input.click()
              await humanDelay(200, 400)
              await page.keyboard.press('Meta+a')
              await page.keyboard.press('Backspace')
              await input.fill(mapping.value)
              filled++
              await humanDelay(400, 800)
            } catch {
              // Could not fill this field
            }
          }
          break // Move to next input
        }
      }
    } catch {
      continue
    }
  }

  return filled
}

async function uploadCVGeneric(page: Page, profile: ApplicantProfile): Promise<void> {
  try {
    // Find any file input
    const fileInput = page.locator('input[type="file"]').first()
    const hasFile = await fileInput.count() > 0

    if (!hasFile) return

    const cvBuffer = await downloadCV(page, profile.cvUrl)

    // Try native setInputFiles first
    try {
      await uploadFile(page, 'input[type="file"]', cvBuffer, 'Florian_Gouloubi_CV.pdf')
      await humanDelay(1000, 2000)
      return
    } catch {
      // Fallback to DataTransfer
    }

    try {
      await uploadFileViaDataTransfer(page, 'input[type="file"]', cvBuffer, 'Florian_Gouloubi_CV.pdf')
      await humanDelay(1000, 2000)
      return
    } catch {
      // CV upload not possible
    }

    // Try via filechooser if there's a visible upload button
    const uploadButtons = page.locator([
      'button:has-text("Upload")',
      'a:has-text("Upload")',
      'label:has-text("Upload")',
      '[class*="upload"] button',
      '[class*="upload"] a',
      'label[for*="file"]',
      'label[for*="resume"]',
      'label[for*="cv"]',
    ].join(', ')).first()

    const uploadVisible = await uploadButtons.isVisible({ timeout: 3000 }).catch(() => false)
    if (uploadVisible) {
      try {
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 5000 }),
          uploadButtons.click(),
        ])
        await fileChooser.setFiles({
          name: 'Florian_Gouloubi_CV.pdf',
          mimeType: 'application/pdf',
          buffer: cvBuffer,
        })
        await humanDelay(1000, 2000)
      } catch {
        // Upload failed
      }
    }
  } catch (error) {
    console.warn('Generic CV upload failed:', error)
  }
}

async function fillTextareas(page: Page, profile: ApplicantProfile): Promise<void> {
  const textareas = page.locator('textarea:visible')
  const count = await textareas.count()

  for (let i = 0; i < count; i++) {
    const textarea = textareas.nth(i)

    try {
      const currentValue = await textarea.evaluate((el) => (el as HTMLTextAreaElement).value)
      if (currentValue && currentValue.trim().length > 0) continue

      const name = (await textarea.getAttribute('name')) || ''
      const placeholder = (await textarea.getAttribute('placeholder')) || ''
      const id = (await textarea.getAttribute('id')) || ''

      let labelText = ''
      if (id) {
        labelText = await page.locator(`label[for="${id}"]`).first().textContent().catch(() => '') || ''
      }

      const allText = `${name} ${placeholder} ${labelText}`.toLowerCase()

      // Determine what kind of text this textarea expects
      let content = ''

      if (allText.includes('cover') || allText.includes('letter') || allText.includes('lettre') || allText.includes('motivation') || allText.includes('why interested') || allText.includes('why are you')) {
        if (profile.coverLetterSnippet) {
          content = `${profile.coverLetterSnippet}\n\nPortfolio: ${profile.portfolio}`
        } else {
          content = [
            `Senior Product Designer with ${profile.yearsExperience}+ years of experience specializing in Design Systems, Design Ops, and complex product architecture.`,
            `Portfolio: ${profile.portfolio}`,
            `Available in ${profile.noticePeriod}. ${profile.workAuth}. Based in ${profile.location} (${profile.timezone}).`,
          ].join('\n\n')
        }
      } else if (allText.includes('additional') || allText.includes('comment') || allText.includes('note') || allText.includes('message')) {
        if (profile.coverLetterSnippet) {
          content = `${profile.coverLetterSnippet}\n\nPortfolio: ${profile.portfolio}`
        } else {
          content = `Portfolio: ${profile.portfolio}\nAvailable in ${profile.noticePeriod}. ${profile.workAuth}.`
        }
      } else {
        // Unknown textarea — add portfolio link as fallback
        content = `Portfolio: ${profile.portfolio}`
      }

      const selector = id ? `#${id}` : (name ? `textarea[name="${name}"]` : `textarea:nth-of-type(${i + 1})`)
      await fillInput(page, selector, content)
      await humanDelay(500, 1000)
    } catch {
      continue
    }
  }
}

async function handleConsentCheckboxes(page: Page): Promise<void> {
  // Check all consent-like checkboxes
  const consentPatterns = [
    'input[type="checkbox"][name*="consent" i]',
    'input[type="checkbox"][name*="privacy" i]',
    'input[type="checkbox"][name*="agree" i]',
    'input[type="checkbox"][name*="terms" i]',
    'input[type="checkbox"][name*="gdpr" i]',
    'input[type="checkbox"][name*="data" i]',
    'input[type="checkbox"][id*="consent" i]',
    'input[type="checkbox"][id*="privacy" i]',
    'input[type="checkbox"][id*="agree" i]',
  ]

  for (const sel of consentPatterns) {
    try {
      const checkbox = page.locator(sel).first()
      const visible = await checkbox.isVisible({ timeout: 1500 })
      if (visible) {
        const checked = await checkbox.isChecked()
        if (!checked) {
          await checkbox.check()
          await humanDelay(200, 400)
        }
      }
    } catch {
      continue
    }
  }
}

async function submitGenericForm(page: Page): Promise<boolean> {
  const submitSelectors = [
    'button[type="submit"]:visible',
    'input[type="submit"]:visible',
    'button:has-text("Submit"):visible',
    'button:has-text("Submit Application"):visible',
    'button:has-text("Apply"):visible',
    'button:has-text("Send"):visible',
    'button:has-text("Send application"):visible',
    'button:has-text("Envoyer"):visible',
    'button:has-text("Soumettre"):visible',
    'a:has-text("Submit"):visible',
    // Generic form submit patterns
    'form button:last-of-type:visible',
  ]

  for (const sel of submitSelectors) {
    try {
      const button = page.locator(sel).first()
      const visible = await button.isVisible({ timeout: 3000 })
      if (visible) {
        // Verify it's likely a submit button (not a cancel/back button)
        const text = (await button.textContent())?.toLowerCase() || ''
        if (text.includes('cancel') || text.includes('back') || text.includes('annuler') || text.includes('retour')) {
          continue
        }
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
