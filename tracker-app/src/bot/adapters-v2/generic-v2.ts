/**
 * Generic ATS adapter (v2) — Universal Stagehand-powered fallback.
 *
 * This adapter works on ANY ATS by using Stagehand's observe() to discover
 * form fields dynamically and act() to fill them. Unlike v1 which relied on
 * CSS selector heuristics, v2 uses AI vision to identify fields regardless
 * of the ATS platform's DOM structure.
 *
 * Anti-hallucination: profile data values are passed verbatim to act().
 * The AI is used for FINDING fields and CLICKING, not for generating data.
 */

import type { Stagehand } from '@browserbasehq/stagehand'
import type { ApplicantProfile } from '../types'
import type { ApplyJobResult } from '../../trigger/apply-jobs'
import type { StagehandAdapter } from './index'
import { getPlaywrightPage } from '../stagehand-client'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADAPTER_NAME = 'Generic-v2'
const CV_GITHUB_URL = 'https://raw.githubusercontent.com/peterbono/portfolio/main/cvflo.pdf'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function downloadCVToTemp(): Promise<string> {
  const fs = await import('fs')
  const path = await import('path')
  const os = await import('os')

  const tmpPath = path.join(os.tmpdir(), `cv-${Date.now()}.pdf`)
  const response = await fetch(CV_GITHUB_URL, {
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    throw new Error(`CV download failed: ${response.status} ${response.statusText}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  fs.writeFileSync(tmpPath, buffer)
  return tmpPath
}

async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    const fs = await import('fs')
    fs.unlinkSync(filePath)
  } catch {
    // Non-fatal
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const genericV2: StagehandAdapter = {
  name: ADAPTER_NAME,

  detect(_url: string): boolean {
    // Always matches as universal fallback
    return true
  },

  async apply(
    stagehand: Stagehand,
    jobUrl: string,
    profile: ApplicantProfile,
    coverLetter: string,
  ): Promise<ApplyJobResult> {
    const start = Date.now()
    const page = getPlaywrightPage(stagehand)
    const company = profile.jobMeta?.company ?? 'Unknown'
    const role = profile.jobMeta?.role ?? 'Unknown'
    let cvTmpPath: string | null = null

    try {
      // ── Step 1: Navigate ──
      console.log(`[${ADAPTER_NAME}] Navigating to ${jobUrl}`)
      await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForTimeout(2500)

      // ── Step 2: Dismiss cookie banners / overlays (Playwright direct, not AI) ──
      // Try multiple rounds: Playwright selectors first, then AI fallback
      const cookieSelectors = [
        'button:has-text("Accept all")', 'button:has-text("Accept All")',
        'button:has-text("ACCEPT")', 'button:has-text("Accept")',
        'button:has-text("Decline all")', 'button:has-text("OK")',
        'button:has-text("Got it")', 'button:has-text("I agree")',
        'button:has-text("Allow all")', 'button:has-text("Agree")',
        '[data-testid="cookie-accept"]', '#onetrust-accept-btn-handler',
        '.cookie-accept', '.cc-accept', '.js-accept-cookies',
        '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
      ]
      let cookieDismissed = false
      for (const sel of cookieSelectors) {
        try {
          const btn = page.locator(sel).first()
          if (await btn.isVisible({ timeout: 800 })) {
            await btn.click()
            await page.waitForTimeout(500)
            console.log(`[${ADAPTER_NAME}] Cookie banner dismissed via: ${sel}`)
            cookieDismissed = true
            break
          }
        } catch { /* not found, try next */ }
      }
      // AI fallback for custom cookie modals
      if (!cookieDismissed) {
        try {
          await stagehand.act('If there is a visible cookie consent popup, banner, or modal, click the accept/close button to dismiss it')
          await page.waitForTimeout(500)
        } catch { /* no banner */ }
      }
      // Nuclear option: force-remove common cookie overlays from DOM
      await page.evaluate(() => {
        const selectors = ['#onetrust-banner-sdk', '#CybotCookiebotDialog', '.cookie-banner',
          '.cookie-consent', '[class*="cookie"]', '[id*="cookie-banner"]',
          '[class*="privacy-notice"]', '.cc-window', '#gdpr-consent']
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach(el => {
            if (el instanceof HTMLElement && el.offsetHeight > 0) el.remove()
          })
        }
      }).catch(() => {})

      // ── Step 3: Find and click the Apply button / Application tab ──
      // Some ATS (Workable) have an "APPLICATION" tab that must be clicked first
      try {
        const appTab = page.locator('a:has-text("APPLICATION"), button:has-text("APPLICATION"), [data-ui="tab"]:has-text("Application")').first()
        if (await appTab.isVisible({ timeout: 2000 })) {
          await appTab.click()
          await page.waitForTimeout(2000)
          console.log(`[${ADAPTER_NAME}] Application tab clicked`)
        }
      } catch { /* no tab */ }

      try {
        await stagehand.act('Find and click the primary "Apply", "Apply now", "Apply for this job", or "Submit application" button on this page. Do NOT click cookie, privacy, or navigation buttons.')
        await page.waitForTimeout(2500)
        console.log(`[${ADAPTER_NAME}] Apply button clicked`)
      } catch {
        console.log(`[${ADAPTER_NAME}] No apply button found — checking for inline form`)
      }

      // ── Step 3: Observe form structure ──
      // Use observe() to understand what fields exist before filling
      let formFields: Awaited<ReturnType<typeof stagehand.observe>> = []
      try {
        formFields = await stagehand.observe('Identify all visible form input fields on this page, including text inputs, textareas, select dropdowns, radio buttons, checkboxes, and file upload areas. For each field, describe what information it expects (e.g. "First name text input", "Resume file upload", "Country dropdown").')
        console.log(`[${ADAPTER_NAME}] Observed ${formFields.length} form element(s)`)
      } catch {
        console.log(`[${ADAPTER_NAME}] observe() found no form fields`)
      }

      if (formFields.length === 0) {
        // No form detected — might be a redirect page or external ATS
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 }).catch(() => null)
        return {
          url: jobUrl,
          company,
          role,
          ats: ADAPTER_NAME,
          status: 'needs_manual',
          reason: 'No application form detected on page',
          screenshotBase64: screenshot?.toString('base64'),
          durationMs: Date.now() - start,
        }
      }

      // ── Step 4: Fill profile fields ──
      // ANTI-HALLUCINATION: exact values from profile, AI only identifies WHERE to type.
      let fieldsFilled = 0

      // 4a: Standard text fields via act()
      const profileFields: Array<{ label: string; value: string; priority: number }> = [
        { label: 'first name', value: profile.firstName, priority: 1 },
        { label: 'last name', value: profile.lastName, priority: 1 },
        { label: 'full name', value: `${profile.firstName} ${profile.lastName}`, priority: 1 },
        { label: 'email', value: profile.email, priority: 1 },
        { label: 'LinkedIn', value: profile.linkedin, priority: 2 },
        { label: 'website or portfolio', value: profile.portfolio, priority: 2 },
        { label: 'headline or current title', value: `Senior Product Designer — ${profile.yearsExperience}+ years`, priority: 3 },
      ]

      for (const field of profileFields) {
        try {
          // Try Playwright fill() first (handles React controlled inputs correctly)
          const selectors = [
            `input[name*="${field.label.split(' ')[0].toLowerCase()}" i]`,
            `input[id*="${field.label.split(' ')[0].toLowerCase()}" i]`,
            `input[placeholder*="${field.label}" i]`,
            `textarea[name*="${field.label.split(' ')[0].toLowerCase()}" i]`,
          ]
          let filled = false
          for (const sel of selectors) {
            try {
              const el = page.locator(sel).first()
              if (await el.isVisible({ timeout: 500 })) {
                await el.click()
                await el.fill(field.value)
                filled = true
                break
              }
            } catch { /* try next */ }
          }
          // Fallback to AI act() if no Playwright selector matched
          if (!filled) {
            await stagehand.act(`Find the input field labeled "${field.label}" (or similar). Click it, select all (Ctrl+A), then type: ${field.value}`)
          }
          fieldsFilled++
          await page.waitForTimeout(400)
        } catch {
          if (field.priority <= 2) console.log(`[${ADAPTER_NAME}] Not found: ${field.label}`)
        }
      }

      // 4b: Phone — try Playwright direct first (more reliable for controlled inputs)
      try {
        const phoneInput = page.locator('input[name*="phone" i], input[type="tel"], input[placeholder*="phone" i], input[id*="phone" i]').first()
        if (await phoneInput.isVisible({ timeout: 2000 })) {
          await phoneInput.click()
          await phoneInput.fill(profile.phone)
          fieldsFilled++
          console.log(`[${ADAPTER_NAME}] Phone filled via Playwright locator`)
        } else {
          await stagehand.act(`Find the phone number input (NOT the country code dropdown). Click it, select all, type: ${profile.phone}`)
          fieldsFilled++
        }
        await page.waitForTimeout(400)
      } catch {
        console.log(`[${ADAPTER_NAME}] Phone field not found`)
      }

      // 4c: Location/Address — type without triggering autocomplete
      try {
        await stagehand.act(`Find the location, city, or address input field. Click it, select all, then type: ${profile.location}`)
        fieldsFilled++
        await page.waitForTimeout(1000)
        // Dismiss any autocomplete dropdown by pressing Escape
        await page.keyboard.press('Escape')
        await page.waitForTimeout(300)
      } catch {
        console.log(`[${ADAPTER_NAME}] Location field not found`)
      }

      console.log(`[${ADAPTER_NAME}] Filled ${fieldsFilled}/${profileFields.length} profile fields`)

      if (fieldsFilled < 2) {
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 }).catch(() => null)
        return {
          url: jobUrl,
          company,
          role,
          ats: ADAPTER_NAME,
          status: 'needs_manual',
          reason: `Only filled ${fieldsFilled} field(s) — form structure not recognized by AI`,
          screenshotBase64: screenshot?.toString('base64'),
          durationMs: Date.now() - start,
        }
      }

      // ── Step 5: Upload CV ──
      try {
        cvTmpPath = await downloadCVToTemp()

        // Find ALL file inputs (visible or hidden)
        const allFileInputs = page.locator('input[type="file"]')
        const fileInputCount = await allFileInputs.count()

        if (fileInputCount > 0) {
          // Use the first file input — even if hidden, setInputFiles works
          await allFileInputs.first().setInputFiles(cvTmpPath)
          console.log(`[${ADAPTER_NAME}] CV uploaded via setInputFiles (${fileInputCount} input(s) found)`)
          await page.waitForTimeout(2000)
        } else {
          // No visible file input — try multiple strategies
          let cvUploaded = false

          // Strategy 1: Lever-style — find hidden file input via page.evaluate
          try {
            const hasHiddenInput = await page.evaluate(() => {
              const input = document.querySelector('input[type="file"]') as HTMLInputElement
              return !!input
            })
            if (hasHiddenInput) {
              // Force the hidden input to be accessible
              await page.evaluate(() => {
                const input = document.querySelector('input[type="file"]') as HTMLInputElement
                if (input) { input.style.display = 'block'; input.style.opacity = '1'; input.style.position = 'fixed'; input.style.top = '0'; input.style.left = '0'; input.style.zIndex = '99999' }
              })
              await page.waitForTimeout(300)
              const visibleInput = page.locator('input[type="file"]').first()
              await visibleInput.setInputFiles(cvTmpPath)
              console.log(`[${ADAPTER_NAME}] CV uploaded via unhidden file input`)
              cvUploaded = true
              await page.waitForTimeout(2000)
            }
          } catch { /* strategy 1 failed */ }

          // Strategy 2: Click upload button/area, then try file input
          if (!cvUploaded) {
            try {
              await stagehand.act('Click the "Attach Resume/CV", "Upload Resume", "Upload CV", or file upload button or area')
              await page.waitForTimeout(1500)
              const revealedInput = page.locator('input[type="file"]').first()
              if ((await revealedInput.count()) > 0) {
                await revealedInput.setInputFiles(cvTmpPath)
                console.log(`[${ADAPTER_NAME}] CV uploaded after clicking upload area`)
                cvUploaded = true
                await page.waitForTimeout(2000)
              }
            } catch { /* strategy 2 failed */ }
          }

          // Strategy 3: Use Playwright fileChooser event (handles Lever, custom upload widgets)
          if (!cvUploaded) {
            try {
              const [fileChooser] = await Promise.all([
                page.waitForEvent('filechooser', { timeout: 5000 }),
                stagehand.act('Click the "Attach Resume/CV", "Upload Resume", "Choose file", or any file upload button'),
              ])
              await fileChooser.setFiles(cvTmpPath)
              console.log(`[${ADAPTER_NAME}] CV uploaded via fileChooser event`)
              cvUploaded = true
              await page.waitForTimeout(2000)
            } catch {
              console.warn(`[${ADAPTER_NAME}] fileChooser strategy failed`)
            }
          }

          if (!cvUploaded) console.warn(`[${ADAPTER_NAME}] CV upload failed — all strategies exhausted`)
        }
      } catch (err) {
        console.warn(`[${ADAPTER_NAME}] CV upload failed: ${err instanceof Error ? err.message : err}`)
      }

      // ── Step 6: Fill cover letter ──
      if (coverLetter) {
        try {
          await stagehand.act(`Find the cover letter textarea or "additional information" text area and type the following: "${coverLetter.slice(0, 2000)}"`)

          console.log(`[${ADAPTER_NAME}] Cover letter filled`)
        } catch {
          // Many forms don't have a cover letter field
        }
      }

      // ── Step 7: Handle education dropdowns (Greenhouse searchable selects) ──
      // Greenhouse uses react-select dropdowns — must click to open, type to search, then click result
      const educationFields = [
        { label: 'School', search: 'Other', fallback: 'Other' },
        { label: 'Degree', search: 'Master', fallback: "Master's Degree" },
        { label: 'Discipline', search: 'Design', fallback: 'Design' },
      ]
      for (const edu of educationFields) {
        try {
          // Check if this dropdown exists
          const dropdown = page.locator(`[class*="select"]:near(:text("${edu.label}"))`).first()
          if (await dropdown.isVisible({ timeout: 1500 })) {
            // Click to open the dropdown
            await dropdown.click()
            await page.waitForTimeout(300)
            // Type to search
            await page.keyboard.type(edu.search, { delay: 50 })
            await page.waitForTimeout(800)
            // Press Enter to select first match, or click the first option
            await page.keyboard.press('Enter')
            await page.waitForTimeout(300)
            console.log(`[${ADAPTER_NAME}] Education "${edu.label}" → "${edu.search}"`)
          }
        } catch {
          // Try AI fallback for this specific dropdown
          try {
            await stagehand.act(`If there is a "${edu.label}" dropdown, click it, type "${edu.search}", and select the first matching option. If no match, select "${edu.fallback}".`)
            await page.waitForTimeout(500)
          } catch { /* field doesn't exist */ }
        }
      }

      // ── Step 8: Handle remaining screening questions ──
      try {
        const answerContext = [
          `Years of experience: ${profile.yearsExperience}`,
          `Work authorization: ${profile.workAuth}`,
          `Remote preference: ${profile.remote ? 'Yes, open to remote' : 'No'}`,
          `Notice period: ${profile.noticePeriod}`,
          `Timezone: ${profile.timezone}`,
          `Education: ${profile.education}`,
        ].join('. ')

        await stagehand.act(`Look for any remaining unfilled required fields, screening questions, or "How did you hear about this job" dropdowns. Answer using: ${answerContext}. For salary: 80000 EUR/year. For sensitive/EEO questions: "Prefer not to say". For "How did you hear": select "Other" or "Job Board".`)
        console.log(`[${ADAPTER_NAME}] Screening questions handled`)
      } catch {
        // No additional questions
      }

      // ── Step 8: Check consent boxes ──
      try {
        await stagehand.act('Check any unchecked consent, privacy, or terms checkboxes')
      } catch {
        // No checkboxes
      }

      // ── Step 9: Submit (AI first, then Playwright fallback) ──
      try {
        await stagehand.act('Scroll down to the submit button and click the "Submit", "Submit Application", "SUBMIT APPLICATION", "Apply", or "Send Application" button')
        console.log(`[${ADAPTER_NAME}] Submit clicked via AI`)
        await page.waitForTimeout(3000)

        // Playwright fallback: if the submit button is still visible, click it directly
        const submitSelectors = [
          'button[type="submit"]',
          'button:has-text("Submit Application")', 'button:has-text("SUBMIT APPLICATION")',
          'button:has-text("Submit")', 'button:has-text("SUBMIT")',
          'button:has-text("Apply")', 'button:has-text("Send Application")',
          'input[type="submit"]', 'input[value="Submit"]', 'input[value="Apply"]',
          '.postings-btn-submit', '.application-submit',
          'a.postings-btn', // Lever uses <a> styled as button
        ]
        for (const sel of submitSelectors) {
          try {
            const btn = page.locator(sel).first()
            if (await btn.isVisible({ timeout: 1000 })) {
              await btn.click()
              console.log(`[${ADAPTER_NAME}] Submit clicked via Playwright fallback: ${sel}`)
              await page.waitForTimeout(5000)
              break
            }
          } catch { /* try next */ }
        }
      } catch (err) {
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 }).catch(() => null)
        return {
          url: jobUrl,
          company,
          role,
          ats: ADAPTER_NAME,
          status: 'needs_manual',
          reason: `Could not find or click submit button: ${err instanceof Error ? err.message : err}`,
          screenshotBase64: screenshot?.toString('base64'),
          durationMs: Date.now() - start,
        }
      }

      // ── Step 10: Wait for CAPTCHA resolution + page change ──
      // Browserbase auto-solves CAPTCHAs (hCaptcha, reCAPTCHA) in 5-30s.
      // Poll for URL change or confirmation text up to 30s after submit.
      let finalUrl = page.url()
      for (let wait = 0; wait < 6; wait++) {
        await page.waitForTimeout(5000)
        const newUrl = page.url()
        if (newUrl !== finalUrl) {
          finalUrl = newUrl
          console.log(`[${ADAPTER_NAME}] Page navigated to: ${newUrl}`)
          break
        }
        // Check for confirmation text early
        const text = await page.evaluate(() => document.body?.innerText?.toLowerCase() || '').catch(() => '')
        if (['thank you', 'application received', 'successfully submitted'].some(p => text.includes(p))) {
          console.log(`[${ADAPTER_NAME}] Confirmation text detected after ${(wait + 1) * 5}s`)
          break
        }
      }

      // ── Step 11: Check for confirmation ──
      const currentUrl = page.url()
      const pageText = await page.evaluate(() => document.body?.innerText || '').catch(() => '')
      const pageLower = pageText.toLowerCase()

      // Success signals: explicit confirmation text OR redirect away from job URL
      const hasConfirmationText = [
        'thank you', 'application received', 'successfully submitted',
        'application has been', 'we have received', 'thanks for applying',
        'application complete', 'submitted your application',
        'thanks!', 'your application has been received',
        'we appreciate your interest', 'application was submitted',
      ].some(phrase => pageLower.includes(phrase))

      const hasRedirected = currentUrl !== jobUrl && !currentUrl.includes('/apply')
      // Check for real validation errors (NOT security code prompts)
      const hasSecurityCode = ['verification code', 'security code', 'confirm you\'re human', 'enter the code'].some(p => pageLower.includes(p))
      const hasErrorText = !hasSecurityCode && [
        'required field', 'please fill out this field', 'is required', 'please correct',
        'invalid email', 'invalid phone',
      ].some(phrase => pageLower.includes(phrase))

      // Security code prompt = form was submitted, waiting for OTP verification
      if (hasSecurityCode) {
        console.log(`[${ADAPTER_NAME}] Security/verification code detected — form submitted, needs OTP`)
        return {
          url: jobUrl,
          company,
          role,
          ats: ADAPTER_NAME,
          status: 'needs_manual',
          reason: 'Application submitted but requires email verification code (OTP)',
          durationMs: Date.now() - start,
        }
      }

      // If we see explicit errors, it's a failure
      if (hasErrorText && !hasConfirmationText) {
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 }).catch(() => null)
        return {
          url: jobUrl,
          company,
          role,
          ats: ADAPTER_NAME,
          status: 'failed',
          reason: 'Form validation errors detected after submit',
          screenshotBase64: screenshot?.toString('base64'),
          durationMs: Date.now() - start,
        }
      }

      // Confirmation text or redirect = success
      if (hasConfirmationText || hasRedirected) {
        console.log(`[${ADAPTER_NAME}] Confirmation detected: text=${hasConfirmationText}, redirect=${hasRedirected}, url=${currentUrl}`)
        return {
          url: jobUrl,
          company,
          role,
          ats: ADAPTER_NAME,
          status: 'applied',
          reason: hasConfirmationText
            ? 'Confirmation message detected'
            : `Redirected to ${currentUrl} after submit`,
          durationMs: Date.now() - start,
        }
      }

      // No clear signal — screenshot and mark needs_manual
      const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 }).catch(() => null)
      return {
        url: jobUrl,
        company,
        role,
        ats: ADAPTER_NAME,
        status: 'needs_manual',
        reason: 'Submit clicked but no confirmation or redirect detected',
        screenshotBase64: screenshot?.toString('base64'),
        durationMs: Date.now() - start,
      }

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[${ADAPTER_NAME}] Fatal error: ${errMsg}`)

      let screenshotBase64: string | undefined
      try {
        const buf = await page.screenshot({ type: 'jpeg', quality: 60 })
        screenshotBase64 = buf.toString('base64')
      } catch {
        // Screenshot failed
      }

      return {
        url: jobUrl,
        company,
        role,
        ats: ADAPTER_NAME,
        status: 'failed',
        reason: errMsg,
        screenshotBase64,
        durationMs: Date.now() - start,
      }
    } finally {
      if (cvTmpPath) await cleanupTempFile(cvTmpPath)
    }
  },
}
