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

      // ── Step 2: Find and click the Apply button ──
      try {
        await stagehand.act('Find and click the primary "Apply", "Apply now", "Apply for this job", or "Submit application" button on this job posting page')
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

      // ── Step 4: Fill profile fields using act() ──
      // Map profile data to natural-language fill instructions.
      // ANTI-HALLUCINATION: exact values from profile, AI only identifies WHERE to type.
      const profileFields: Array<{ description: string; value: string; priority: number }> = [
        { description: 'first name', value: profile.firstName, priority: 1 },
        { description: 'last name', value: profile.lastName, priority: 1 },
        { description: 'email address', value: profile.email, priority: 1 },
        { description: 'phone number', value: profile.phone, priority: 2 },
        { description: 'LinkedIn URL or profile', value: profile.linkedin, priority: 2 },
        { description: 'website or portfolio URL', value: profile.portfolio, priority: 2 },
        { description: 'location or city', value: profile.location, priority: 3 },
      ]

      let fieldsFilled = 0

      for (const field of profileFields) {
        try {
          await stagehand.act(`Find the input field for "${field.description}" and type "${field.value}" into it. If no such field exists, do nothing.`)
          fieldsFilled++
        } catch {
          // Field does not exist on this form — expected for many ATS platforms
          if (field.priority <= 2) {
            console.log(`[${ADAPTER_NAME}] Field not found: ${field.description}`)
          }
        }
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

        // Try direct file input first
        const fileInput = page.locator('input[type="file"]').first()
        const hasFileInput = (await fileInput.count()) > 0

        if (hasFileInput) {
          await fileInput.setInputFiles(cvTmpPath)
          console.log(`[${ADAPTER_NAME}] CV uploaded via setInputFiles`)
          await page.waitForTimeout(2000)
        } else {
          // Try clicking an upload button, then finding the file input
          try {
            await stagehand.act('Click the resume, CV, or file upload button or area')
            await page.waitForTimeout(1000)

            const hiddenInput = page.locator('input[type="file"]').first()
            if ((await hiddenInput.count()) > 0) {
              await hiddenInput.setInputFiles(cvTmpPath)
              console.log(`[${ADAPTER_NAME}] CV uploaded after clicking upload area`)
              await page.waitForTimeout(2000)
            }
          } catch {
            console.warn(`[${ADAPTER_NAME}] No file upload found`)
          }
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

      // ── Step 7: Handle remaining questions with profile context ──
      try {
        const answerContext = [
          `Years of experience: ${profile.yearsExperience}`,
          `Work authorization: ${profile.workAuth}`,
          `Remote preference: ${profile.remote ? 'Yes, open to remote' : 'No'}`,
          `Notice period: ${profile.noticePeriod}`,
          `Timezone: ${profile.timezone}`,
          `Education: ${profile.education}`,
        ].join('. ')

        await stagehand.act(`Look for any remaining unfilled required fields or screening questions on this form. Answer them using these facts: ${answerContext}. For salary questions, use 80000 EUR per year. For sensitive questions (gender, race, disability), select "Prefer not to say" or "Decline to answer". For unknown questions, skip them or select "Other" if available.`)
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

      // ── Step 9: Submit ──
      try {
        await stagehand.act('Click the final "Submit", "Submit Application", "Apply", or "Send Application" button to submit the form')
        console.log(`[${ADAPTER_NAME}] Submit clicked`)
        await page.waitForTimeout(5000)
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

      // ── Step 10: Check for confirmation ──
      // Many ATS (especially Greenhouse) redirect to the careers page after
      // successful submission. Detect this as a success signal.
      const currentUrl = page.url()
      const pageText = await page.textContent('body').catch(() => '') || ''
      const pageLower = pageText.toLowerCase()

      // Success signals: explicit confirmation text OR redirect away from job URL
      const hasConfirmationText = [
        'thank you', 'application received', 'successfully submitted',
        'application has been', 'we have received', 'thanks for applying',
        'application complete', 'submitted your application',
      ].some(phrase => pageLower.includes(phrase))

      const hasRedirected = currentUrl !== jobUrl && !currentUrl.includes('/apply')
      const hasErrorText = [
        'required field', 'please fill', 'is required', 'error',
        'invalid', 'please correct',
      ].some(phrase => pageLower.includes(phrase))

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
