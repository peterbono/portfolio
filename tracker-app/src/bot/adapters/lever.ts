import type { Page } from 'playwright'
import type { ATSAdapter, ApplicantProfile, ApplyResult } from '../types'
import {
  humanDelay,
  downloadCV,
  uploadFile,
  uploadFileViaDataTransfer,
  waitAndClick,
  fillInput,
  takeScreenshot,
  answerScreeningQuestion,
  extractCompanyName,
  extractRoleTitle,
  checkForConfirmation,
  scrollToElement,
  solveCaptchaIfPresent,
  solveHCaptchaViaCapsolver,
  injectHCaptchaToken,
} from '../helpers'

export const lever: ATSAdapter = {
  name: 'Lever',

  detect(url: string): boolean {
    return /lever\.co/i.test(url) || /jobs\.lever/i.test(url)
  },

  async apply(page: Page, jobUrl: string, profile: ApplicantProfile): Promise<ApplyResult> {
    const start = Date.now()
    let company = 'Unknown'
    let role = 'Unknown'

    try {
      // Step 1: Navigate to job page
      await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })
      await humanDelay(1500, 3000)

      company = await extractCompanyName(page, jobUrl)
      role = await extractRoleTitle(page)

      // Step 2: Click "Apply for this job" button
      // Lever typically has a separate application page at /apply
      const applyButton = page.locator([
        'a.postings-btn',
        'a:has-text("Apply for this job")',
        'a:has-text("Apply now")',
        'a[href$="/apply"]',
        '.posting-btn-submit',
        'button:has-text("Apply")',
      ].join(', ')).first()

      try {
        const isVisible = await applyButton.isVisible({ timeout: 5000 })
        if (isVisible) {
          await applyButton.click()
          await page.waitForLoadState('domcontentloaded', { timeout: 15_000 })
          await humanDelay(1500, 2500)
        }
      } catch {
        // Might already be on the apply page
        // Check if URL already ends with /apply
        if (!page.url().includes('/apply')) {
          // Try navigating directly to the apply page
          const applyUrl = jobUrl.replace(/\/?$/, '/apply')
          await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })
          await humanDelay(1500, 2500)
        }
      }

      // Wait for the application form
      await page.waitForSelector('.application-form, form[action*="apply"], #application-form', {
        timeout: 15_000,
      }).catch(() => {})

      await humanDelay(1000, 2000)

      // Early CAPTCHA bailout: detect hCaptcha before wasting time filling form
      const hasVisibleCaptcha = await page.locator('iframe[src*="hcaptcha"], .h-captcha, [data-hcaptcha-sitekey]').first().isVisible({ timeout: 3000 }).catch(() => false)
      const hasCaptchaSolver = !!(process.env.TWO_CAPTCHA_API_KEY || process.env.CAPSOLVER_API_KEY)
      if (hasVisibleCaptcha && !hasCaptchaSolver) {
        console.log('[lever] hCaptcha detected on page load, no CAPTCHA solver configured — skipping')
        return {
          success: false,
          status: 'skipped' as const,
          company,
          role,
          ats: 'Lever',
          reason: 'hCaptcha detected before form fill — no solver available (set TWO_CAPTCHA_API_KEY or CAPSOLVER_API_KEY)',
          duration: Date.now() - start,
        }
      }

      // Step 3: Fill name (Lever often has a single "Full name" field)
      await fillName(page, profile)

      // Step 4: Fill email
      await fillEmail(page, profile)

      // Step 5: Fill phone
      await fillPhone(page, profile)

      // Step 6: Fill current company (if field exists)
      await fillCurrentCompany(page, profile)

      // Step 7: Upload CV/Resume
      await uploadCV(page, profile)

      // Step 8: Fill LinkedIn
      await fillLinkedIn(page, profile)

      // Step 9: Fill portfolio/website
      await fillPortfolio(page, profile)

      // Step 10: Fill additional information (free text with portfolio mention)
      await fillAdditionalInfo(page, profile)

      // Step 11: Handle screening questions (custom questions)
      await handleScreeningQuestions(page, profile)

      // Step 12: Handle consent / EEOC
      await handleConsent(page)

      await humanDelay(1000, 2000)

      // Step 13: Submit (triggers invisible reCAPTCHA v3)
      const submitted = await submitForm(page)
      if (!submitted) {
        const screenshot = await takeScreenshot(page)
        return {
          success: false,
          status: 'failed',
          company,
          role,
          ats: 'Lever',
          reason: 'Could not find or click submit button',
          screenshotUrl: screenshot,
          duration: Date.now() - start,
        }
      }

      // Step 13.5: Solve CAPTCHA AFTER submit click
      // Lever uses hCaptcha (sometimes invisible reCAPTCHA v3), triggered by form submit JS.
      // Strategy:
      //   1. Try SBR's built-in Captcha.waitForSolve (works for reCAPTCHA, unreliable for hCaptcha)
      //   2. If SBR fails, try CapSolver API as fallback (requires CAPSOLVER_API_KEY env var)
      //   3. If both fail, fall through to needs_manual
      await humanDelay(2000, 3000) // Give CAPTCHA time to fire

      let captchaSolvedViaSBR = false
      try {
        captchaSolvedViaSBR = await solveCaptchaIfPresent(page, 45_000)
        if (captchaSolvedViaSBR) {
          console.log('[lever] CAPTCHA solved via SBR after submit')
          await humanDelay(2000, 3000)
          // After CAPTCHA is solved, trigger the full form submission
          const hcaptchaBtn = page.locator('#hcaptchaSubmitBtn')
          if (await hcaptchaBtn.count().catch(() => 0) > 0) {
            // Use form.submit() for reliability (same pattern as 2Captcha path)
            const sbrFormResult = await page.evaluate(() => {
              const btn = document.querySelector('#hcaptchaSubmitBtn') as HTMLButtonElement
              if (!btn) return 'button_not_found'
              const form = btn.closest('form')
              if (form) {
                const evt = new Event('submit', { bubbles: true, cancelable: true })
                const prevented = !form.dispatchEvent(evt)
                if (!prevented) form.submit()
                return prevented ? 'submit_event_prevented' : 'form.submit()_called'
              }
              btn.click()
              return 'btn.click()_called'
            }).catch((e) => `error: ${e}`)
            console.log(`[lever] [SBR] #hcaptchaSubmitBtn form submission: ${sbrFormResult}`)
            await hcaptchaBtn.dispatchEvent('click').catch(() => {})
          } else {
            const resubmitted = await submitForm(page)
            if (resubmitted) console.log('[lever] [SBR] Re-submitted form after CAPTCHA solve')
          }
          await humanDelay(3000, 5000)
        } else {
          console.log('[lever] SBR did not solve CAPTCHA — will try 2Captcha/CapSolver fallback')
        }
      } catch (captchaErr) {
        console.warn('[lever] SBR CAPTCHA solving failed:', captchaErr instanceof Error ? captchaErr.message : captchaErr)
      }

      // Step 14: Check confirmation (SBR might have been enough)
      await humanDelay(2000, 4000)
      let confirmed = await checkForConfirmation(page, jobUrl)

      if (confirmed) {
        return {
          success: true,
          status: 'applied',
          company,
          role,
          ats: 'Lever',
          duration: Date.now() - start,
        }
      }

      // Step 14.5: 2Captcha/CapSolver fallback — try if submission didn't confirm
      // Lever uses INVISIBLE hCaptcha that blocks submit silently — no visible iframe.
      // Always attempt solver if: no SBR solve AND no confirmation detected.
      if (!captchaSolvedViaSBR && !confirmed) {
        console.log('[lever] Attempting 2Captcha/CapSolver hCaptcha fallback...')

        // Extract hCaptcha site key from the page, or use the known Lever default
        const LEVER_HCAPTCHA_SITEKEY = 'e33f87f8-88ec-4e1a-9a13-df9bbb1d8120'
        const extractedSiteKey = await page.evaluate(() => {
          const hcaptchaDiv = document.querySelector('[data-sitekey]')
          if (hcaptchaDiv) return hcaptchaDiv.getAttribute('data-sitekey')
          const iframe = document.querySelector('iframe[src*="hcaptcha.com"]')
          if (iframe) {
            const src = iframe.getAttribute('src') || ''
            const match = src.match(/sitekey=([a-f0-9-]+)/)
            return match ? match[1] : null
          }
          return null
        }).catch(() => null)

        const siteKey = extractedSiteKey || LEVER_HCAPTCHA_SITEKEY
        console.log(`[lever] hCaptcha site key: ${siteKey}`)

        const capsolverToken = await solveHCaptchaViaCapsolver(page.url(), siteKey)

        if (capsolverToken) {
          console.log('[lever] 2Captcha/CapSolver returned token — injecting into page...')

          // ── Step A: Inject token into textarea fields ──
          await injectHCaptchaToken(page, capsolverToken)
          console.log('[lever] [post-captcha] Token injected into textarea(s) and callback attempted')
          await humanDelay(500, 1000)

          // ── Step B: Try hcaptcha.execute() to trigger the normal post-solve flow ──
          const executeResult = await page.evaluate((tok) => {
            const results: string[] = []
            const hcaptchaApi = (window as any).hcaptcha

            // Method 1: hcaptcha.execute() — triggers the widget's onPass callback
            if (hcaptchaApi && typeof hcaptchaApi.execute === 'function') {
              try {
                hcaptchaApi.execute()
                results.push('hcaptcha.execute() called')
              } catch (e) {
                results.push(`hcaptcha.execute() failed: ${e}`)
              }
            }

            // Method 2: Directly set the response AND call getResponse to confirm
            if (hcaptchaApi && typeof hcaptchaApi.setResponse === 'function') {
              try {
                hcaptchaApi.setResponse(tok)
                results.push('hcaptcha.setResponse() called')
              } catch (e) {
                results.push(`hcaptcha.setResponse() failed: ${e}`)
              }
            }

            // Method 3: Find and invoke the data-callback function from the hCaptcha div
            const hcaptchaDiv = document.querySelector('.h-captcha, [data-sitekey]')
            if (hcaptchaDiv) {
              const cbName = hcaptchaDiv.getAttribute('data-callback')
              if (cbName && typeof (window as any)[cbName] === 'function') {
                try {
                  (window as any)[cbName](tok)
                  results.push(`data-callback "${cbName}" invoked`)
                } catch (e) {
                  results.push(`data-callback "${cbName}" failed: ${e}`)
                }
              }
            }

            return results
          }, capsolverToken).catch(() => [] as string[])

          for (const r of executeResult) {
            console.log(`[lever] [post-captcha] ${r}`)
          }
          await humanDelay(1000, 2000)

          // ── Step C: Click #hcaptchaSubmitBtn (hidden submit that Lever's JS triggers on success) ──
          const hcaptchaSubmit = page.locator('#hcaptchaSubmitBtn')
          const hasHcaptchaSubmit = await hcaptchaSubmit.count().catch(() => 0)
          if (hasHcaptchaSubmit > 0) {
            // Use JS form.submit() as primary, dispatchEvent as fallback.
            // dispatchEvent('click') on a hidden button may not trigger the native submit.
            const formSubmitted = await page.evaluate(() => {
              const btn = document.querySelector('#hcaptchaSubmitBtn') as HTMLButtonElement
              if (!btn) return 'button_not_found'
              const form = btn.closest('form')
              if (form) {
                // Trigger the submit event (lets JS handlers run) then actually submit
                const evt = new Event('submit', { bubbles: true, cancelable: true })
                const prevented = !form.dispatchEvent(evt)
                if (!prevented) {
                  form.submit()
                }
                return prevented ? 'submit_event_prevented' : 'form.submit()_called'
              }
              // No parent form — click the button directly
              btn.click()
              return 'btn.click()_called'
            }).catch((e) => `error: ${e}`)
            console.log(`[lever] [post-captcha] #hcaptchaSubmitBtn form submission: ${formSubmitted}`)

            // Also dispatch click as a fallback (some Lever forms attach click handlers)
            await hcaptchaSubmit.dispatchEvent('click').catch(() => {})
            console.log('[lever] [post-captcha] #hcaptchaSubmitBtn dispatchEvent click (fallback)')
            await humanDelay(3000, 5000)
          } else {
            console.log('[lever] [post-captcha] #hcaptchaSubmitBtn not found — trying visible submit')
            // Fallback: try the visible submit button
            const resubmitted = await submitForm(page)
            if (resubmitted) {
              console.log('[lever] [post-captcha] Re-submitted form via visible button after token injection')
              await humanDelay(3000, 5000)
            }
          }

          // ── Step D: Wait longer for redirect, then check confirmation ──
          // Lever forms can take a few seconds to redirect after submit
          await humanDelay(2000, 3000)
          confirmed = await checkForConfirmation(page, jobUrl)
          if (confirmed) {
            return {
              success: true,
              status: 'applied',
              company,
              role,
              ats: 'Lever',
              duration: Date.now() - start,
            }
          }

          // ── Step E: Last resort — maybe the submit didn't fire, try #btn-submit again ──
          // This re-clicks the visible button which triggers the hCaptcha flow again,
          // but now with the token already in place it may pass through immediately.
          console.log('[lever] [post-captcha] No confirmation yet — retrying #btn-submit with token in place')
          const retriedSubmit = await submitForm(page)
          if (retriedSubmit) {
            await humanDelay(4000, 6000)
            confirmed = await checkForConfirmation(page, jobUrl)
            if (confirmed) {
              return {
                success: true,
                status: 'applied',
                company,
                role,
                ats: 'Lever',
                duration: Date.now() - start,
              }
            }
          }

          // Check for errors after all attempts
          const postCapsolverErrors = await page.locator('.error, [class*="error"], .invalid-feedback').first()
            .isVisible({ timeout: 3000 }).catch(() => false)
          if (!postCapsolverErrors) {
            console.log('[lever] [post-captcha] No errors visible — possible silent success, marking needs_manual for safety')
          } else {
            console.warn('[lever] [post-captcha] Errors still present — CAPTCHA token may have been rejected')
          }
        } else {
          console.warn('[lever] 2Captcha/CapSolver did not return a token — falling through to needs_manual')
        }
      }

      // Check for errors (including hCaptcha verification failure)
      const hasErrors = await page.locator('.error, [class*="error"], .invalid-feedback').first()
        .isVisible({ timeout: 3000 }).catch(() => false)

      if (hasErrors) {
        const errorText = await page.locator('.error, [class*="error"]').first()
          .textContent().catch(() => 'Unknown validation error')
        const screenshot = await takeScreenshot(page)

        // Detect hCaptcha verification failure specifically
        const isHcaptchaError = errorText?.toLowerCase().includes('verifying') ||
          errorText?.toLowerCase().includes('captcha')
        const reason = isHcaptchaError
          ? `hCaptcha verification failed (SBR + CapSolver both failed) — apply manually at: ${jobUrl}`
          : `Validation error: ${errorText}`

        return {
          success: false,
          status: isHcaptchaError ? 'needs_manual' : 'failed',
          company,
          role,
          ats: 'Lever',
          reason,
          screenshotUrl: screenshot,
          duration: Date.now() - start,
        }
      }

      // No confirmation detected after submit — do NOT claim "applied".
      // Lever always sends a confirmation email on success, so if the page
      // didn't show a confirmation, the submission likely failed silently
      // (CAPTCHA, validation, cloud IP block, etc.)
      const noConfirmScreenshot = await takeScreenshot(page)
      return {
        success: false,
        status: 'needs_manual',
        company,
        role,
        ats: 'Lever',
        reason: 'Submitted but no confirmation detected — apply manually to verify',
        screenshotUrl: noConfirmScreenshot,
        duration: Date.now() - start,
      }

    } catch (error) {
      const screenshot = await takeScreenshot(page).catch(() => '')
      return {
        success: false,
        status: 'failed',
        company,
        role,
        ats: 'Lever',
        reason: error instanceof Error ? error.message : String(error),
        screenshotUrl: screenshot,
        duration: Date.now() - start,
      }
    }
  },
}

// ─── Internal helpers ────────────────────────────────────────────────

async function fillName(page: Page, profile: ApplicantProfile): Promise<void> {
  // Lever may have a single "Full name" field or separate first/last
  const fullNameSelectors = [
    'input[name="name"]',
    'input[name="fullName"]',
    'input[placeholder*="Full name" i]',
    'input[placeholder*="Your name" i]',
    'input[aria-label*="Full name" i]',
  ]

  for (const sel of fullNameSelectors) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) {
        await fillInput(page, sel, `${profile.firstName} ${profile.lastName}`)
        await humanDelay(500, 1000)
        return
      }
    } catch {
      continue
    }
  }

  // Separate first/last name fields
  const firstNameSels = [
    'input[name*="first" i]',
    'input[placeholder*="First name" i]',
  ]
  const lastNameSels = [
    'input[name*="last" i]',
    'input[placeholder*="Last name" i]',
  ]

  for (const sel of firstNameSels) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) {
        await fillInput(page, sel, profile.firstName)
        await humanDelay(500, 800)
        break
      }
    } catch {
      continue
    }
  }

  for (const sel of lastNameSels) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) {
        await fillInput(page, sel, profile.lastName)
        await humanDelay(500, 800)
        break
      }
    } catch {
      continue
    }
  }
}

async function fillEmail(page: Page, profile: ApplicantProfile): Promise<void> {
  const selectors = [
    'input[name="email"]',
    'input[type="email"]',
    'input[placeholder*="email" i]',
    'input[aria-label*="Email" i]',
  ]

  for (const sel of selectors) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) {
        await fillInput(page, sel, profile.email)
        await humanDelay(500, 1000)
        return
      }
    } catch {
      continue
    }
  }
}

async function fillPhone(page: Page, profile: ApplicantProfile): Promise<void> {
  const selectors = [
    'input[name="phone"]',
    'input[type="tel"]',
    'input[placeholder*="phone" i]',
    'input[aria-label*="Phone" i]',
  ]

  for (const sel of selectors) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) {
        await fillInput(page, sel, profile.phone)
        await humanDelay(500, 1000)
        return
      }
    } catch {
      continue
    }
  }
}

async function fillCurrentCompany(page: Page, profile: ApplicantProfile): Promise<void> {
  const selectors = [
    'input[name*="company" i]',
    'input[name="org"]',
    'input[placeholder*="company" i]',
    'input[placeholder*="Current company" i]',
    'input[aria-label*="Current company" i]',
  ]

  const companyName = profile.currentCompany || 'ClickOut Media'

  for (const sel of selectors) {
    try {
      const visible = await page.locator(sel).first().isVisible({ timeout: 2000 })
      if (visible) {
        await fillInput(page, sel, companyName)
        await humanDelay(400, 800)
        return
      }
    } catch {
      continue
    }
  }
}

async function uploadCV(page: Page, profile: ApplicantProfile): Promise<void> {
  try {
    const cvBuffer = await downloadCV(page, profile.cvUrl)

    // Lever file input selectors
    const fileInputSelectors = [
      'input[type="file"][name*="resume" i]',
      'input[type="file"][name*="cv" i]',
      'input[type="file"][id*="resume" i]',
      'input[type="file"]',
    ]

    for (const sel of fileInputSelectors) {
      try {
        const attached = await page.locator(sel).first().isAttached()
        if (attached) {
          await uploadFile(page, sel, cvBuffer, 'Florian_Gouloubi_CV.pdf')
          await humanDelay(1000, 2000)
          return
        }
      } catch {
        continue
      }
    }

    // Try the "Upload Resume" button + filechooser event
    const uploadButton = page.locator([
      'button:has-text("Upload resume")',
      'button:has-text("Upload Resume")',
      'a:has-text("Upload resume")',
      '.resume-upload-btn',
      '[class*="upload"] button',
      'label[for*="resume"]',
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
      return
    }

    // DataTransfer fallback
    for (const sel of fileInputSelectors) {
      try {
        const exists = await page.locator(sel).first().count()
        if (exists > 0) {
          await uploadFileViaDataTransfer(page, sel, cvBuffer, 'Florian_Gouloubi_CV.pdf')
          await humanDelay(1000, 2000)
          return
        }
      } catch {
        continue
      }
    }
  } catch (error) {
    console.warn('Lever CV upload failed:', error)
  }
}

async function fillLinkedIn(page: Page, profile: ApplicantProfile): Promise<void> {
  const selectors = [
    'input[name*="urls[LinkedIn]"]',
    'input[name*="linkedin" i]',
    'input[placeholder*="linkedin" i]',
    'input[id*="linkedin" i]',
    'input[aria-label*="LinkedIn" i]',
  ]

  for (const sel of selectors) {
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
  const selectors = [
    'input[name*="urls[Website]"]',
    'input[name*="urls[Portfolio]"]',
    'input[name*="urls[Other]"]',
    'input[name*="website" i]',
    'input[name*="portfolio" i]',
    'input[placeholder*="website" i]',
    'input[placeholder*="portfolio" i]',
    'input[aria-label*="Website" i]',
    'input[aria-label*="Portfolio" i]',
  ]

  for (const sel of selectors) {
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

  // Lever sometimes has an "Add a link" button for extra URLs
  const addLinkButton = page.locator('a:has-text("Add"), button:has-text("Add a link")').first()
  const addVisible = await addLinkButton.isVisible({ timeout: 2000 }).catch(() => false)
  if (addVisible) {
    await addLinkButton.click()
    await humanDelay(500, 1000)
    // Try again after adding the link field
    const newInput = page.locator('input[name*="urls"]:last-of-type, input[placeholder*="url" i]:last-of-type').first()
    const newVisible = await newInput.isVisible({ timeout: 3000 }).catch(() => false)
    if (newVisible) {
      await fillInput(page, 'input[name*="urls"]:last-of-type', profile.portfolio)
    }
  }
}

async function fillAdditionalInfo(page: Page, profile: ApplicantProfile): Promise<void> {
  const selectors = [
    'textarea[name*="comments"]',
    'textarea[name*="additional" i]',
    'textarea[placeholder*="Add a cover letter" i]',
    'textarea[placeholder*="additional" i]',
    'textarea[aria-label*="Additional" i]',
    '#additional-information textarea',
    '.additional-info textarea',
  ]

  // Use AI-generated cover letter snippet if available, otherwise fall back to generic template
  const additionalText = profile.coverLetterSnippet
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
        await fillInput(page, sel, additionalText)
        await humanDelay(500, 1000)
        return
      }
    } catch {
      continue
    }
  }
}

async function handleScreeningQuestions(page: Page, profile: ApplicantProfile): Promise<void> {
  // Lever custom questions are typically in .custom-questions or similar containers
  const questionContainers = page.locator('.custom-question, [class*="custom-question"], .application-question')
  const count = await questionContainers.count()

  for (let i = 0; i < count; i++) {
    const container = questionContainers.nth(i)

    try {
      const label = container.locator('label, .question-label, [class*="label"]').first()
      const labelText = await label.textContent({ timeout: 1000 }).catch(() => '')
      if (!labelText || labelText.trim().length < 3) continue

      // Find the input within this container
      const input = container.locator('input:not([type="hidden"]):not([type="file"]), textarea, select').first()
      const inputExists = await input.count()
      if (inputExists === 0) continue

      // Check if already filled
      const currentValue = await input.evaluate((el) => {
        if (el instanceof HTMLSelectElement) return el.value
        return (el as HTMLInputElement).value
      }).catch(() => '')
      if (currentValue && currentValue.trim().length > 0) continue

      // Get a usable selector
      const inputId = await input.evaluate((el) => el.id).catch(() => '')
      const inputName = await input.evaluate((el) => (el as HTMLInputElement).name).catch(() => '')
      const inputSelector = inputId
        ? `#${inputId}`
        : inputName
          ? `[name="${inputName}"]`
          : `input, textarea, select`

      await scrollToElement(page, inputId ? `#${inputId}` : `[name="${inputName}"]`)
      await answerScreeningQuestion(page, labelText, inputSelector, profile)
      await humanDelay(600, 1200)
    } catch {
      continue
    }
  }
}

async function handleConsent(page: Page): Promise<void> {
  // ── Part 1: Named consent checkboxes (specific attribute matches) ──
  const consentSelectors = [
    'input[type="checkbox"][name*="consent" i]',
    'input[type="checkbox"][name*="privacy" i]',
    'input[type="checkbox"][name*="agree" i]',
    'input[type="checkbox"][name*="acknowledge" i]',
    'input[type="checkbox"][name*="compliance" i]',
    'input[type="checkbox"][name*="terms" i]',
    'input[type="checkbox"][name*="data" i]',
    'input[type="checkbox"][id*="consent" i]',
    'input[type="checkbox"][id*="gdpr" i]',
    'input[type="checkbox"][id*="privacy" i]',
    'input[type="checkbox"][id*="acknowledge" i]',
    'input[type="checkbox"][id*="compliance" i]',
    // Lever data-attribute patterns
    'input[type="checkbox"][data-compliance]',
  ]

  let checkedCount = 0
  for (const sel of consentSelectors) {
    try {
      const checkboxes = page.locator(sel)
      const count = await checkboxes.count()
      for (let i = 0; i < count; i++) {
        const checkbox = checkboxes.nth(i)
        const visible = await checkbox.isVisible({ timeout: 1500 }).catch(() => false)
        if (visible) {
          const checked = await checkbox.isChecked().catch(() => true)
          if (!checked) {
            await checkbox.check()
            checkedCount++
            await humanDelay(200, 400)
          }
        }
      }
    } catch {
      continue
    }
  }

  // ── Part 2: Container-based consent checkboxes (Lever wraps them in sections) ──
  // Some Lever forms put consent checkboxes inside .compliance-section, .consent-section,
  // or near labels containing "consent", "acknowledge", "I agree", etc.
  const containerSelectors = [
    '.compliance-section',
    '.consent-section',
    '[class*="consent"]',
    '[class*="compliance"]',
    '[class*="diversity"]',
    '[class*="eeo"]',
    '[class*="eeoc"]',
  ]

  for (const containerSel of containerSelectors) {
    try {
      const containers = page.locator(containerSel)
      const count = await containers.count()
      for (let ci = 0; ci < count; ci++) {
        const unchecked = containers.nth(ci).locator('input[type="checkbox"]:not(:checked)')
        const uncheckedCount = await unchecked.count()
        for (let i = 0; i < uncheckedCount; i++) {
          const checkbox = unchecked.nth(i)
          const visible = await checkbox.isVisible({ timeout: 1000 }).catch(() => false)
          if (visible) {
            await checkbox.check()
            checkedCount++
            await humanDelay(200, 400)
          }
        }
      }
    } catch {
      continue
    }
  }

  // ── Part 3: Label-based consent checkboxes ──
  // Catch checkboxes whose associated label contains consent-related text
  try {
    const labelBasedChecked = await page.evaluate(() => {
      let count = 0
      const consentTerms = [
        'consent', 'i agree', 'i acknowledge', 'privacy policy',
        'terms and conditions', 'data processing', 'voluntary',
        'i certify', 'i authorize', 'i understand',
      ]
      const labels = Array.from(document.querySelectorAll('label'))
      for (const label of labels) {
        const text = (label.textContent || '').toLowerCase()
        if (!consentTerms.some(t => text.includes(t))) continue
        // Find checkbox: either inside label, or via for= attribute
        let checkbox = label.querySelector('input[type="checkbox"]') as HTMLInputElement | null
        if (!checkbox && label.htmlFor) {
          checkbox = document.getElementById(label.htmlFor) as HTMLInputElement | null
        }
        if (checkbox && !checkbox.checked && checkbox.offsetParent !== null) {
          checkbox.click()
          count++
        }
      }
      return count
    })
    if (labelBasedChecked > 0) {
      checkedCount += labelBasedChecked
      await humanDelay(200, 400)
    }
  } catch {
    // Best-effort
  }

  console.log(`[lever] handleConsent: checked ${checkedCount} consent checkbox(es)`)

  // ── Part 4: EEOC dropdowns — "Decline to self-identify" ──
  const eeocSelectors = [
    'select[name*="gender" i]',
    'select[name*="race" i]',
    'select[name*="veteran" i]',
    'select[name*="disability" i]',
    'select[name*="ethnicity" i]',
    'select[name*="eeo" i]',
  ]

  for (const sel of eeocSelectors) {
    try {
      const select = page.locator(sel).first()
      const visible = await select.isVisible({ timeout: 2000 })
      if (visible) {
        const currentValue = await select.evaluate((el) => (el as HTMLSelectElement).value).catch(() => '')
        if (currentValue && currentValue !== '') continue // Already selected
        const options = await select.locator('option').allTextContents()
        const declineOption = options.find((o) =>
          o.toLowerCase().includes('decline') ||
          o.toLowerCase().includes('prefer not') ||
          o.toLowerCase().includes('choose not'),
        )
        if (declineOption) {
          await select.selectOption({ label: declineOption })
        }
        await humanDelay(300, 600)
      }
    } catch {
      continue
    }
  }

  // ── Part 5: EEOC radio buttons (some Lever forms use radios, not selects) ──
  const eeocRadioContainers = [
    '[class*="eeo"] fieldset',
    '[class*="diversity"] fieldset',
    '[class*="demographic"] fieldset',
  ]

  for (const containerSel of eeocRadioContainers) {
    try {
      const containers = page.locator(containerSel)
      const count = await containers.count()
      for (let ci = 0; ci < count; ci++) {
        const container = containers.nth(ci)
        // Look for a "Decline" radio
        const declineRadio = container.locator(
          'input[type="radio"][value*="decline" i], input[type="radio"][value*="prefer not" i]',
        ).first()
        const radioVisible = await declineRadio.isVisible({ timeout: 1500 }).catch(() => false)
        if (radioVisible) {
          await declineRadio.check()
          await humanDelay(200, 400)
        } else {
          // Fall back to label-text matching for "Decline to self-identify"
          const labels = container.locator('label')
          const labelCount = await labels.count()
          for (let li = 0; li < labelCount; li++) {
            const labelText = await labels.nth(li).textContent().catch(() => '')
            if (labelText && /decline|prefer not|choose not/i.test(labelText)) {
              const radio = labels.nth(li).locator('input[type="radio"]').first()
              if (await radio.count() > 0) {
                await radio.check()
                await humanDelay(200, 400)
              }
              break
            }
          }
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
    'a:has-text("Submit application")',
    '.postings-btn[type="submit"]',
    '#btn-submit',
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
