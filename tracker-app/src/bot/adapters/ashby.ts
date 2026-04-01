import type { Page } from 'playwright'
import type { ATSAdapter, ApplicantProfile, ApplyResult } from '../types'

/**
 * Ashby ATS adapter — immediate skip.
 *
 * Ashby (jobs.ashbyhq.com) uses strict CSP headers that block all external
 * fetch requests and headless browser detection that causes 30s+ timeouts.
 * Instead of wasting time loading the page, we detect the URL pattern and
 * return a "skipped" result immediately so the user can apply manually.
 */
export const ashby: ATSAdapter = {
  name: 'Ashby',

  detect(url: string): boolean {
    return /ashbyhq\.com/i.test(url)
  },

  async apply(_page: Page, jobUrl: string, profile: ApplicantProfile): Promise<ApplyResult> {
    const company = profile.jobMeta?.company || 'Unknown'
    const role = profile.jobMeta?.role || 'Unknown'

    console.log(`[ashby] Skipping Ashby job (CSP blocks headless browsers): ${jobUrl}`)

    return {
      success: false,
      status: 'skipped',
      company,
      role,
      ats: 'Ashby',
      reason: `Ashby blocks headless browsers — apply manually at: ${jobUrl}`,
      screenshotUrl: '',
      duration: 0,
    }
  },
}
