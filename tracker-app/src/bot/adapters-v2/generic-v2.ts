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
// Gmail OTP Polling Helper
// ---------------------------------------------------------------------------

/**
 * Poll Gmail for a recent verification/security code email from a company.
 * Uses OAuth2 refresh token flow with GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 * GOOGLE_REFRESH_TOKEN from environment.
 *
 * Returns the extracted code string (typically 6-8 chars) or null if not found.
 */
async function pollGmailForOTP(
  company: string,
  maxAttempts: number = 6,
  intervalMs: number = 5000,
): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    console.warn(`[${ADAPTER_NAME}] Gmail OTP: missing OAuth credentials in env`)
    return null
  }

  // Step 1: Get access token via refresh token
  let accessToken: string
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(10_000),
    })
    const tokenData = await tokenRes.json() as { access_token?: string }
    if (!tokenData.access_token) {
      console.warn(`[${ADAPTER_NAME}] Gmail OTP: failed to get access token`)
      return null
    }
    accessToken = tokenData.access_token
  } catch (err) {
    console.warn(`[${ADAPTER_NAME}] Gmail OTP: token refresh error:`, err)
    return null
  }

  // Step 2: Poll for recent verification emails
  const companyLower = company.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim()
  // Search for emails from last 5 minutes with verification-related subjects
  const query = `newer_than:5m (subject:verification OR subject:verify OR subject:code OR subject:confirm OR subject:security) ${companyLower}`

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=3`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(10_000),
        },
      )
      const listData = await listRes.json() as { messages?: Array<{ id: string }> }

      if (listData.messages && listData.messages.length > 0) {
        // Read the most recent message
        const msgId = listData.messages[0].id
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(10_000),
          },
        )
        const msgData = await msgRes.json() as {
          snippet?: string
          payload?: { body?: { data?: string }; parts?: Array<{ body?: { data?: string } }> }
        }

        // Try snippet first, then decode body
        const snippet = msgData.snippet || ''
        let bodyText = snippet

        // Decode base64url body if available
        const rawBody = msgData.payload?.body?.data || msgData.payload?.parts?.[0]?.body?.data
        if (rawBody) {
          try {
            bodyText += ' ' + Buffer.from(rawBody, 'base64url').toString('utf-8')
          } catch { /* keep snippet */ }
        }

        // Extract verification code: look for 4-8 digit/alphanumeric codes
        // Common patterns: "Your code is 12345678", "Code: ABCD1234", "verification code: 123456"
        const codePatterns = [
          /(?:verification|security|confirm(?:ation)?|one[- ]?time)\s*(?:code|pin|number)\s*(?:is|:)\s*([A-Z0-9]{4,8})/i,
          /\b([A-Z0-9]{6,8})\b(?=\s*(?:to verify|to confirm|is your|expires))/i,
          /(?:enter|use|type)\s*(?:the\s*)?(?:code\s*)?:?\s*([A-Z0-9]{4,8})\b/i,
          /\b(\d{6,8})\b/,  // Fallback: any 6-8 digit number
        ]

        for (const pattern of codePatterns) {
          const match = bodyText.match(pattern)
          if (match && match[1]) {
            console.log(`[${ADAPTER_NAME}] Gmail OTP: found code "${match[1]}" from email (attempt ${attempt + 1})`)
            return match[1]
          }
        }

        console.log(`[${ADAPTER_NAME}] Gmail OTP: found email but no code pattern matched (attempt ${attempt + 1})`)
      } else {
        console.log(`[${ADAPTER_NAME}] Gmail OTP: no matching emails (attempt ${attempt + 1}/${maxAttempts})`)
      }
    } catch (err) {
      console.warn(`[${ADAPTER_NAME}] Gmail OTP: poll error (attempt ${attempt + 1}):`, err)
    }

    // Wait before next attempt
    if (attempt < maxAttempts - 1) {
      await new Promise(r => setTimeout(r, intervalMs))
    }
  }

  console.log(`[${ADAPTER_NAME}] Gmail OTP: exhausted ${maxAttempts} attempts, no code found`)
  return null
}

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
      // @ts-ignore Stagehand Page uses timeoutMs but Playwright uses timeout — works at runtime
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
      // Lever-specific: "Privacy Notice" bar with close/dismiss button
      if (!cookieDismissed) {
        const leverPrivacySelectors = [
          '[class*="privacy-notice"] button', '[class*="PrivacyNotice"] button',
          '[class*="privacy-notice"] [class*="close"]', '[class*="PrivacyNotice"] [class*="close"]',
          '[id*="privacy"] button[class*="close"]', '[id*="privacy"] button[aria-label="Close"]',
          'button:has-text("Dismiss")', 'button:has-text("Close")',
        ]
        for (const sel of leverPrivacySelectors) {
          try {
            const btn = page.locator(sel).first()
            if (await btn.isVisible({ timeout: 800 })) {
              await btn.click()
              await page.waitForTimeout(500)
              console.log(`[${ADAPTER_NAME}] Lever privacy notice dismissed via: ${sel}`)
              cookieDismissed = true
              break
            }
          } catch { /* not found, try next */ }
        }
      }
      // AI fallback for custom cookie modals
      if (!cookieDismissed) {
        try {
          // @ts-ignore stagehand v3 positional API
          await stagehand.act('If there is a visible cookie consent popup, banner, or modal, click the accept/close button to dismiss it')
          await page.waitForTimeout(500)
        } catch { /* no banner */ }
      }
      // Nuclear option: force-remove common cookie overlays + Lever privacy bar from DOM
      // @ts-ignore page.evaluate callback type mismatch with Stagehand Page
      await page.evaluate(() => {
        // Standard cookie/privacy selectors
        const selectors = [
          '#onetrust-banner-sdk', '#CybotCookiebotDialog', '.cookie-banner',
          '.cookie-consent', '[class*="cookie"]', '[id*="cookie-banner"]',
          '[class*="privacy-notice"]', '[class*="PrivacyNotice"]',
          '[id*="privacy"]', '[id*="Privacy"]',
          '.cc-window', '#gdpr-consent',
        ]
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach(el => {
            if (el instanceof HTMLElement && el.offsetHeight > 0) el.remove()
          })
        }
        // Remove fixed/sticky bottom bars (Lever "Privacy Notice" and similar)
        // Only remove if height < 200px to avoid nuking the entire page
        document.querySelectorAll('*').forEach(el => {
          if (!(el instanceof HTMLElement)) return
          const style = window.getComputedStyle(el)
          const isFixed = style.position === 'fixed' || style.position === 'sticky'
          const isBottom = style.bottom === '0px' || style.bottom === '0'
          const isSmall = el.offsetHeight > 0 && el.offsetHeight < 200
          if (isFixed && isBottom && isSmall) {
            // Double-check it's a banner-like element (has text content, not a chat widget button)
            const text = el.innerText?.toLowerCase() || ''
            const isBannerLike = text.includes('privacy') || text.includes('cookie') ||
              text.includes('consent') || text.includes('accept') || text.includes('notice') ||
              (el.offsetHeight < 80 && el.querySelectorAll('a, button').length > 0)
            if (isBannerLike) {
              el.remove()
            }
          }
        })
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
        // @ts-ignore stagehand v3 positional API
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
        // @ts-ignore stagehand v3 positional API
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
            // @ts-ignore stagehand v3 positional API
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
          // @ts-ignore stagehand v3 positional API
          await stagehand.act(`Find the phone number input (NOT the country code dropdown). Click it, select all, type: ${profile.phone}`)
          fieldsFilled++
        }
        await page.waitForTimeout(400)
      } catch {
        console.log(`[${ADAPTER_NAME}] Phone field not found`)
      }

      // 4c: Location/Address — type without triggering autocomplete
      try {
        // @ts-ignore stagehand v3 positional API
        await stagehand.act(`Find the location, city, or address input field. Click it, select all, then type: ${profile.location}`)
        fieldsFilled++
        await page.waitForTimeout(1000)
        // Dismiss any autocomplete dropdown by pressing Escape
        // @ts-ignore keyboard exists on Playwright Page but not on Stagehand Page type
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

        // Strategy 0: fileChooser via AI click on the visible upload button (most universal)
        let cvUploaded = false
        try {
          const [fileChooser] = await Promise.all([
            // @ts-ignore waitForEvent exists on Playwright Page but not on Stagehand Page type
            page.waitForEvent('filechooser', { timeout: 8000 }),
            // @ts-ignore stagehand v3 positional API
            stagehand.act('Click the "Attach Resume/CV", "Upload Resume", "Choose file", or resume upload button'),
          ])
          await fileChooser.setFiles(cvTmpPath)
          console.log(`[${ADAPTER_NAME}] CV uploaded via fileChooser + AI click`)
          cvUploaded = true
          await page.waitForTimeout(2000)
        } catch {
          console.log(`[${ADAPTER_NAME}] fileChooser+AI failed, trying direct setInputFiles`)
        }

        // Strategy 1: direct setInputFiles on existing input[type=file]
        if (!cvUploaded && fileInputCount > 0) {
          try {
            await allFileInputs.first().setInputFiles(cvTmpPath)
            console.log(`[${ADAPTER_NAME}] CV uploaded via setInputFiles (${fileInputCount} input(s))`)
            cvUploaded = true
            await page.waitForTimeout(2000)
          } catch {
            console.log(`[${ADAPTER_NAME}] setInputFiles failed`)
          }
        }

        if (cvUploaded) {
          // Skip remaining strategies
        } else {
          // No visible file input — try multiple strategies
          let cvUploaded = false

          // Strategy 1: Lever-style — find hidden file input via page.evaluate
          try {
            // @ts-ignore page.evaluate callback type mismatch with Stagehand Page
            const hasHiddenInput = await page.evaluate(() => {
              const input = document.querySelector('input[type="file"]') as HTMLInputElement
              return !!input
            })
            if (hasHiddenInput) {
              // Force the hidden input to be accessible
              // @ts-ignore page.evaluate callback type mismatch with Stagehand Page
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
              // @ts-ignore stagehand v3 positional API
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
                // @ts-ignore waitForEvent exists on Playwright Page but not on Stagehand Page type
                page.waitForEvent('filechooser', { timeout: 5000 }),
                // @ts-ignore stagehand v3 positional API
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
          // @ts-ignore stagehand v3 positional API
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
            // @ts-ignore keyboard exists on Playwright Page but not on Stagehand Page type
            await page.keyboard.type(edu.search, { delay: 50 })
            await page.waitForTimeout(800)
            // Press Enter to select first match, or click the first option
            // @ts-ignore keyboard exists on Playwright Page but not on Stagehand Page type
            await page.keyboard.press('Enter')
            await page.waitForTimeout(300)
            console.log(`[${ADAPTER_NAME}] Education "${edu.label}" → "${edu.search}"`)
          }
        } catch {
          // Try AI fallback for this specific dropdown
          try {
            // @ts-ignore stagehand v3 positional API
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

        // @ts-ignore stagehand v3 positional API
        await stagehand.act(`Look for any remaining unfilled required fields, screening questions, or "How did you hear about this job" dropdowns. Answer using: ${answerContext}. For salary: 80000 EUR/year. For sensitive/EEO questions: "Prefer not to say". For "How did you hear": select "Other" or "Job Board".`)
        console.log(`[${ADAPTER_NAME}] Screening questions handled`)
      } catch {
        // No additional questions
      }

      // ── Step 8: Check consent boxes ──
      try {
        // @ts-ignore stagehand v3 positional API
        await stagehand.act('Check any unchecked consent, privacy, or terms checkboxes')
      } catch {
        // No checkboxes
      }

      // ── Step 9: Submit (AI first, then Playwright fallback) ──
      try {
        // @ts-ignore stagehand v3 positional API
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
          '.postings-btn--submit', 'a[data-qa="btn-submit"]',
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

        // Nuclear: JS click on any visible submit-like element
        try {
          // @ts-ignore page.evaluate callback type mismatch with Stagehand Page
          await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, a, input[type="submit"]'))
            const submit = btns.find(b => /submit|apply|send/i.test(b.textContent || '') || /submit/i.test((b as HTMLInputElement).value || ''))
            if (submit) (submit as HTMLElement).click()
          })
          console.log(`[${ADAPTER_NAME}] Submit via JS evaluate`)
          await page.waitForTimeout(5000)
        } catch { /* last resort failed */ }
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
        // @ts-ignore page.evaluate callback type mismatch with Stagehand Page
        const text = await page.evaluate(() => document.body?.innerText?.toLowerCase() || '').catch(() => '')
        if (['thank you', 'application received', 'successfully submitted'].some(p => text.includes(p))) {
          console.log(`[${ADAPTER_NAME}] Confirmation text detected after ${(wait + 1) * 5}s`)
          break
        }
      }

      // ── Step 11: Check for confirmation ──
      const currentUrl = page.url()
      // @ts-ignore page.evaluate callback type mismatch with Stagehand Page
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
      // Try to auto-resolve via Gmail polling before falling back to needs_manual
      if (hasSecurityCode) {
        console.log(`[${ADAPTER_NAME}] Security/verification code detected — attempting Gmail OTP polling...`)

        const otpCode = await pollGmailForOTP(company, 6, 5000) // 6 attempts, 5s apart = 30s max

        if (otpCode) {
          console.log(`[${ADAPTER_NAME}] OTP code retrieved: ${otpCode} — entering into form`)

          // Try to find and fill the security code input field
          let codeFilled = false

          // Strategy 1: Playwright selectors for code inputs
          const codeSelectors = [
            'input[name*="code" i]', 'input[name*="verification" i]', 'input[name*="security" i]',
            'input[name*="otp" i]', 'input[name*="token" i]', 'input[name*="pin" i]',
            'input[id*="code" i]', 'input[id*="verification" i]', 'input[id*="security" i]',
            'input[placeholder*="code" i]', 'input[placeholder*="verification" i]',
            'input[autocomplete="one-time-code"]',
            // Greenhouse uses multiple single-char inputs for OTP
            'input[data-testid*="code" i]', 'input[aria-label*="code" i]',
          ]

          for (const sel of codeSelectors) {
            try {
              const input = page.locator(sel).first()
              if (await input.isVisible({ timeout: 1000 })) {
                await input.click()
                await input.fill(otpCode)
                codeFilled = true
                console.log(`[${ADAPTER_NAME}] OTP filled via selector: ${sel}`)
                break
              }
            } catch { /* try next */ }
          }

          // Strategy 2: Check for multi-digit split inputs (e.g., 8 separate <input> fields)
          if (!codeFilled) {
            try {
              const digitInputs = page.locator('input[maxlength="1"]')
              const count = await digitInputs.count()
              if (count >= 4 && count <= 10 && otpCode.length === count) {
                for (let d = 0; d < count; d++) {
                  await digitInputs.nth(d).fill(otpCode[d])
                  await page.waitForTimeout(100)
                }
                codeFilled = true
                console.log(`[${ADAPTER_NAME}] OTP filled via ${count} split digit inputs`)
              }
            } catch { /* split inputs not found */ }
          }

          // Strategy 3: AI fallback
          if (!codeFilled) {
            try {
              // @ts-ignore stagehand v3 positional API
              await stagehand.act(`Find the verification code / security code input field and type: ${otpCode}`)
              codeFilled = true
              console.log(`[${ADAPTER_NAME}] OTP filled via AI act()`)
            } catch {
              console.warn(`[${ADAPTER_NAME}] AI could not fill OTP field`)
            }
          }

          if (codeFilled) {
            // Click verify/submit button
            await page.waitForTimeout(500)
            try {
              // @ts-ignore stagehand v3 positional API
              await stagehand.act('Click the "Verify", "Confirm", "Submit", or "Continue" button to confirm the verification code')
              await page.waitForTimeout(5000)
            } catch {
              // Try Playwright fallback for verify button
              const verifySelectors = [
                'button:has-text("Verify")', 'button:has-text("Confirm")',
                'button:has-text("Submit")', 'button:has-text("Continue")',
                'button[type="submit"]',
              ]
              for (const sel of verifySelectors) {
                try {
                  const btn = page.locator(sel).first()
                  if (await btn.isVisible({ timeout: 1000 })) {
                    await btn.click()
                    await page.waitForTimeout(5000)
                    break
                  }
                } catch { /* try next */ }
              }
            }

            // Check for confirmation after OTP submit
            // @ts-ignore page.evaluate callback type mismatch with Stagehand Page
            const postOtpText = await page.evaluate(() => document.body?.innerText?.toLowerCase() || '').catch(() => '')
            const otpConfirmed = [
              'thank you', 'application received', 'successfully submitted',
              'application has been', 'we have received', 'thanks for applying',
              'application complete', 'submitted your application',
            ].some(phrase => postOtpText.includes(phrase))

            if (otpConfirmed) {
              console.log(`[${ADAPTER_NAME}] OTP verified — application confirmed!`)
              return {
                url: jobUrl,
                company,
                role,
                ats: ADAPTER_NAME,
                status: 'applied',
                reason: 'Application confirmed after email OTP verification',
                durationMs: Date.now() - start,
              }
            }

            // Check if page redirected (also a success signal)
            const postOtpUrl = page.url()
            if (postOtpUrl !== jobUrl && !postOtpUrl.includes('/apply')) {
              console.log(`[${ADAPTER_NAME}] OTP verified — redirected to ${postOtpUrl}`)
              return {
                url: jobUrl,
                company,
                role,
                ats: ADAPTER_NAME,
                status: 'applied',
                reason: `Application confirmed after OTP — redirected to ${postOtpUrl}`,
                durationMs: Date.now() - start,
              }
            }
          }
        }

        // OTP not found or fill failed — return needs_manual with clear instructions
        console.log(`[${ADAPTER_NAME}] OTP auto-fill failed — returning needs_manual`)
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 }).catch(() => null)
        return {
          url: jobUrl,
          company,
          role,
          ats: ADAPTER_NAME,
          status: 'needs_manual',
          reason: `Application submitted but requires email verification code (OTP). Gmail polling ${otpCode ? 'found code but fill failed' : 'found no code in 30s'}. Check email and enter code manually at: ${page.url()}`,
          screenshotBase64: screenshot?.toString('base64'),
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
