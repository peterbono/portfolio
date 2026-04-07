/**
 * Greenhouse ATS adapter (v2) — Stagehand-powered.
 *
 * Uses act()/extract() for intelligent form interaction instead of brittle
 * CSS selectors. Falls back to direct Playwright APIs for file uploads
 * (setInputFiles) which Stagehand cannot handle.
 *
 * Anti-hallucination: all field values come from the ApplicantProfile constant.
 * The AI is only used for NAVIGATION and INTERACTION, never for generating
 * profile data. This mirrors the strict patterns from api/fill-field.ts.
 */

import type { Stagehand } from '@browserbasehq/stagehand'
import { z } from 'zod'
import type { ApplicantProfile } from '../types'
import type { ApplyJobResult } from '../../trigger/apply-jobs'
import type { StagehandAdapter } from './index'
import { getPlaywrightPage } from '../stagehand-client'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADAPTER_NAME = 'Greenhouse-v2'
const CV_GITHUB_URL = 'https://raw.githubusercontent.com/peterbono/portfolio/main/cvflo.pdf'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Download CV from GitHub to a temp file for Playwright setInputFiles */
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
  console.log(`[${ADAPTER_NAME}] CV downloaded to ${tmpPath} (${(buffer.length / 1024).toFixed(0)}KB)`)
  return tmpPath
}

/** Clean up temp CV file (non-blocking) */
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

export const greenhouseV2: StagehandAdapter = {
  name: ADAPTER_NAME,

  detect(url: string): boolean {
    return /greenhouse\.io/i.test(url) || /boards\.greenhouse/i.test(url)
  },

  async apply(
    stagehand: Stagehand,
    jobUrl: string,
    profile: ApplicantProfile,
    coverLetter: string,
  ): Promise<ApplyJobResult> {
    const start = Date.now()
    const page = getPlaywrightPage(stagehand)
    let company = profile.jobMeta?.company ?? 'Unknown'
    let role = profile.jobMeta?.role ?? 'Unknown'
    let cvTmpPath: string | null = null

    try {
      // ── Step 1: Navigate to job page ──
      console.log(`[${ADAPTER_NAME}] Navigating to ${jobUrl}`)
      await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForTimeout(2000)

      // ── Step 2: Click Apply button (if form is behind a CTA) ──
      try {
        await stagehand.act('Click the "Apply for this job" or "Apply now" button if visible')
        await page.waitForTimeout(2000)
      } catch {
        // Form might be inline — continue
        console.log(`[${ADAPTER_NAME}] No apply button found (form likely inline)`)
      }

      // ── Step 3: Fill personal information fields ──
      // ANTI-HALLUCINATION: we pass exact values from profile, never let the AI generate them.
      const fieldsToFill: Array<{ instruction: string; value: string }> = [
        { instruction: 'Fill the "First name" or "First Name" input field', value: profile.firstName },
        { instruction: 'Fill the "Last name" or "Last Name" input field', value: profile.lastName },
        { instruction: 'Fill the "Email" or "Email address" input field', value: profile.email },
        { instruction: 'Fill the "Phone" or "Phone number" input field', value: profile.phone },
        { instruction: 'Fill the "LinkedIn" or "LinkedIn URL" or "LinkedIn Profile" input field', value: profile.linkedin },
        { instruction: 'Fill the "Website" or "Portfolio" or "Personal website" input field', value: profile.portfolio },
        { instruction: 'Fill the "Location" or "Current location" or "City" input field', value: profile.location },
      ]

      for (const field of fieldsToFill) {
        try {
          await stagehand.act(`${field.instruction} with the value "${field.value}"`)
          console.log(`[${ADAPTER_NAME}] Filled: ${field.instruction.slice(0, 50)}...`)
        } catch {
          // Field might not exist on this particular Greenhouse form — continue
          console.log(`[${ADAPTER_NAME}] Field not found (skipping): ${field.instruction.slice(0, 50)}...`)
        }
      }

      // ── Step 4: Upload CV via Playwright (not Stagehand — file inputs need native API) ──
      try {
        cvTmpPath = await downloadCVToTemp()

        // Greenhouse uses <input type="file"> with various selectors
        const fileInput = page.locator([
          'input[type="file"][name*="resume"]',
          'input[type="file"][name*="cv"]',
          'input[type="file"][id*="resume"]',
          'input[type="file"][data-field="resume"]',
          'input[type="file"]',
        ].join(', ')).first()

        const fileInputVisible = await fileInput.count()
        if (fileInputVisible > 0) {
          await fileInput.setInputFiles(cvTmpPath)
          console.log(`[${ADAPTER_NAME}] CV uploaded via setInputFiles`)
          await page.waitForTimeout(2000)
        } else {
          // Some Greenhouse forms use a dropzone — try clicking upload area
          try {
            await stagehand.act('Click the "Attach" or "Upload" or "Choose file" button for resume/CV upload')
            // After click, the file dialog should have triggered the file input
            const hiddenInput = page.locator('input[type="file"]').first()
            await hiddenInput.setInputFiles(cvTmpPath)
            console.log(`[${ADAPTER_NAME}] CV uploaded via dropzone click + setInputFiles`)
            await page.waitForTimeout(2000)
          } catch {
            console.warn(`[${ADAPTER_NAME}] Could not find file upload element`)
          }
        }
      } catch (err) {
        console.warn(`[${ADAPTER_NAME}] CV upload failed: ${err instanceof Error ? err.message : err}`)
      }

      // ── Step 5: Fill cover letter ──
      if (coverLetter) {
        try {
          await stagehand.act(`Fill the "Cover letter" or "Cover Letter" textarea with the following text: "${coverLetter.slice(0, 2000)}"`)
          console.log(`[${ADAPTER_NAME}] Cover letter filled`)
        } catch {
          console.log(`[${ADAPTER_NAME}] No cover letter field found (skipping)`)
        }
      }

      // ── Step 6: Handle screening questions ──
      // Use observe() to find any additional questions, then act() to answer them
      try {
        const questions = await stagehand.observe('Find all screening or custom questions on this application form (dropdowns, radio buttons, text fields) that have not been filled yet. Do not include name, email, phone, or resume fields.')

        if (questions && questions.length > 0) {
          console.log(`[${ADAPTER_NAME}] Found ${questions.length} screening question(s)`)

          for (const q of questions) {
            try {
              // Build a context-aware answer instruction using profile data
              const answerContext = [
                `Years of experience: ${profile.yearsExperience}`,
                `Location: ${profile.location}`,
                `Work authorization: ${profile.workAuth}`,
                `Remote: ${profile.remote ? 'Yes' : 'No'}`,
                `Notice period: ${profile.noticePeriod}`,
                `Timezone: ${profile.timezone}`,
              ].join('. ')

              await stagehand.act(`Answer the question or field described as "${q.description}" using these facts about the applicant: ${answerContext}. For Yes/No questions about legal right to work in EU, answer Yes. For salary expectations, answer 80000 EUR per year. For questions you cannot answer from these facts, select "Prefer not to say" or leave blank if possible.`)
            } catch {
              console.log(`[${ADAPTER_NAME}] Could not answer screening question: ${q.description?.slice(0, 60)}`)
            }
          }
        }
      } catch {
        console.log(`[${ADAPTER_NAME}] No screening questions detected`)
      }

      // ── Step 7: Check consent / agreement boxes ──
      try {
        await stagehand.act('Check any consent, privacy policy, or terms checkboxes if they are unchecked. Do not uncheck anything that is already checked.')
        console.log(`[${ADAPTER_NAME}] Consent checkboxes handled`)
      } catch {
        console.log(`[${ADAPTER_NAME}] No consent checkboxes found`)
      }

      // ── Step 8: Submit the application ──
      try {
        await stagehand.act('Click the "Submit Application" or "Submit" or "Apply" button to submit the job application form')
        console.log(`[${ADAPTER_NAME}] Submit button clicked`)
        await page.waitForTimeout(5000)
      } catch (err) {
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 }).catch(() => null)
        return {
          url: jobUrl,
          company,
          role,
          ats: ADAPTER_NAME,
          status: 'needs_manual',
          reason: `Submit button click failed: ${err instanceof Error ? err.message : err}`,
          screenshotBase64: screenshot?.toString('base64'),
          durationMs: Date.now() - start,
        }
      }

      // ── Step 9: Extract confirmation ──
      let confirmationText = ''
      try {
        const result = await stagehand.extract(
          'Extract any confirmation message visible on the page after form submission. Look for text like "Thank you", "Application submitted", "received your application", or similar success messages.',
          {
            schema: z.object({
              confirmationMessage: z.string().optional().describe('The confirmation or thank-you message displayed after submission'),
              isSuccess: z.boolean().describe('Whether the page shows a successful submission confirmation'),
            }),
          },
        )

        confirmationText = (result as any)?.confirmationMessage ?? ''
        const isSuccess = (result as any)?.isSuccess ?? false

        if (isSuccess) {
          console.log(`[${ADAPTER_NAME}] Application confirmed: ${confirmationText.slice(0, 100)}`)
          return {
            url: jobUrl,
            company,
            role,
            ats: ADAPTER_NAME,
            status: 'applied',
            reason: confirmationText || 'Application submitted successfully',
            durationMs: Date.now() - start,
          }
        }
      } catch {
        console.log(`[${ADAPTER_NAME}] Could not extract confirmation`)
      }

      // If we got here, submit was clicked but no clear confirmation
      const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 }).catch(() => null)
      return {
        url: jobUrl,
        company,
        role,
        ats: ADAPTER_NAME,
        status: 'needs_manual',
        reason: confirmationText || 'Submit clicked but no confirmation detected — verify manually',
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
