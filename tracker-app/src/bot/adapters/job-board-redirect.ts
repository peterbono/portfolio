import type { Page } from 'playwright'
import type { ATSAdapter, ApplicantProfile, ApplyResult } from '../types'
import { humanDelay, takeScreenshot, extractCompanyName, extractRoleTitle } from '../helpers'

/**
 * Job Board Redirect Adapter
 *
 * Handles URLs from job aggregator boards like RemoteOK, Himalayas, etc.
 * These sites list jobs but don't host application forms directly.
 *
 * RemoteOK-specific challenge:
 *   - All "Apply" buttons link to `/l/{jobId}` (internal redirect)
 *   - `/l/{id}` returns obfuscated JS that decodes to `/l/{id}?rh=HASH`
 *   - That 302-redirects to `/sign-up?redirect_url=ACTUAL_EMPLOYER_URL`
 *   - The actual employer URL is in the `redirect_url` query parameter
 *
 * Strategy:
 *   1. Navigate to listing page, extract company/role metadata
 *   2. Click the Apply button, let Playwright follow JS redirects
 *   3. If we land on a sign-up page, extract `redirect_url` param
 *   4. If we land on an external page directly, use that URL
 *   5. Re-dispatch to the correct ATS adapter (Greenhouse, Lever, etc.)
 */

const JOB_BOARD_PATTERNS = [
  /remoteok\.com/i,
  /himalayas\.app/i,
  /wellfound\.com/i,
  /weworkremotely\.com/i,
  /remotive\.com/i,
]

export const jobBoardRedirect: ATSAdapter = {
  name: 'JobBoardRedirect',

  detect(url: string): boolean {
    return JOB_BOARD_PATTERNS.some(p => p.test(url))
  },

  async apply(page: Page, jobUrl: string, profile: ApplicantProfile): Promise<ApplyResult> {
    const start = Date.now()
    let company = 'Unknown'
    let role = 'Unknown'

    try {
      // Step 1: Navigate to the job board listing page
      console.log(`[job-board-redirect] Navigating to listing: ${jobUrl}`)
      await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await humanDelay(2000, 3500)

      // Extract metadata from the listing page
      company = await extractCompanyName(page, jobUrl)
      role = await extractRoleTitle(page)

      // Step 2: Resolve the actual employer URL
      const employerUrl = await resolveEmployerUrl(page, jobUrl)

      if (!employerUrl) {
        const screenshot = await takeScreenshot(page)
        return {
          success: false,
          status: 'needs_manual',
          company,
          role,
          ats: 'JobBoardRedirect',
          reason: 'Could not resolve external employer URL from job board redirect chain',
          screenshotUrl: screenshot,
          duration: Date.now() - start,
        }
      }

      console.log(`[job-board-redirect] Resolved employer URL: ${employerUrl}`)

      // Step 3: Re-detect the correct adapter for the actual career page
      const { detectAdapter } = await import('./index')
      const realAdapter = detectAdapter(employerUrl)

      console.log(`[job-board-redirect] Delegating to ${realAdapter.name} adapter for: ${employerUrl}`)

      // Step 4: Delegate to the correct adapter
      const result = await realAdapter.apply(page, employerUrl, profile)

      // Enrich with metadata from the listing page (adapter might return 'Unknown')
      if (result.company === 'Unknown' && company !== 'Unknown') result.company = company
      if (result.role === 'Unknown' && role !== 'Unknown') result.role = role

      return result

    } catch (error) {
      const screenshot = await takeScreenshot(page).catch(() => '')
      return {
        success: false,
        status: 'failed',
        company,
        role,
        ats: 'JobBoardRedirect',
        reason: error instanceof Error ? error.message : String(error),
        screenshotUrl: screenshot,
        duration: Date.now() - start,
      }
    }
  },
}

// ─── Internal helpers ────────────────────────────────────────────────

/**
 * Resolve the actual employer URL from a job board listing page.
 *
 * Strategy (ordered by reliability):
 * 1. Click the Apply button, follow redirects via Playwright
 * 2. If we land on sign-up/login page, extract redirect_url from URL params
 * 3. If we land on an external domain, that's the employer URL
 * 4. Fallback: look for any external links that point to known ATS domains
 */
async function resolveEmployerUrl(page: Page, listingUrl: string): Promise<string | null> {
  const listingDomain = new URL(listingUrl).hostname

  // ─── Strategy 1: Click Apply and follow the redirect chain ────────
  const applyResult = await clickApplyAndFollow(page, listingDomain)
  if (applyResult) return applyResult

  // ─── Strategy 2: Navigate directly to /l/{id} for RemoteOK ────────
  if (/remoteok\.com/i.test(listingUrl)) {
    const directResult = await resolveRemoteOKDirect(page, listingUrl)
    if (directResult) return directResult
  }

  // ─── Strategy 3: Extract external links from page (Himalayas, etc.) ──
  const externalLink = await extractExternalApplyLink(page, listingDomain)
  if (externalLink) return externalLink

  return null
}

/**
 * Click the Apply button on the listing page and follow the redirect chain.
 * Returns the employer URL if found, null otherwise.
 */
async function clickApplyAndFollow(page: Page, listingDomain: string): Promise<string | null> {
  // Find the Apply button/link
  const applySelectors = [
    'a.action-apply[href]',        // RemoteOK
    'a.button.action-apply[href]', // RemoteOK
    'a[data-job-id][href]',        // RemoteOK
    'a[data-testid="apply-button"]', // Himalayas
    'a:has-text("Apply Now")',
    'a:has-text("Apply for this job")',
    'a:has-text("Apply")',
  ]

  for (const sel of applySelectors) {
    try {
      const link = page.locator(sel).first()
      const visible = await link.isVisible({ timeout: 3000 })
      if (!visible) continue

      console.log(`[job-board-redirect] Clicking Apply button: ${sel}`)

      // Track navigation — click and wait for URL changes
      const navigationPromise = page.waitForURL(
        (url) => url.hostname !== listingDomain,
        { timeout: 15_000 }
      ).catch(() => null)

      // Also listen for redirects that might not change the hostname
      const urlChangePromise = page.waitForURL(
        (url) => url.href !== page.url(),
        { timeout: 15_000 }
      ).catch(() => null)

      await link.click()

      // Wait for either navigation to external domain or URL change
      await Promise.race([navigationPromise, urlChangePromise])
      await humanDelay(1500, 2500)

      // Check where we ended up
      const currentUrl = page.url()
      const currentDomain = new URL(currentUrl).hostname
      console.log(`[job-board-redirect] After click, landed on: ${currentUrl}`)

      // Case A: We landed on an external domain (success!)
      if (currentDomain !== listingDomain) {
        // But check if it's just another job board
        if (JOB_BOARD_PATTERNS.some(p => p.test(currentUrl))) {
          console.log(`[job-board-redirect] Landed on another job board, continuing...`)
          continue
        }
        return currentUrl
      }

      // Case B: We're still on the same domain — check for redirect_url in URL params
      const urlObj = new URL(currentUrl)
      const redirectUrl = urlObj.searchParams.get('redirect_url')
        || urlObj.searchParams.get('redirect')
        || urlObj.searchParams.get('return_url')
        || urlObj.searchParams.get('next')
        || urlObj.searchParams.get('url')

      if (redirectUrl) {
        try {
          const decoded = decodeURIComponent(redirectUrl)
          const parsedRedirect = new URL(decoded)
          if (parsedRedirect.hostname !== listingDomain) {
            console.log(`[job-board-redirect] Found redirect_url in sign-up page: ${decoded}`)
            return decoded
          }
        } catch {
          // Invalid URL in redirect param
        }
      }

      // Case C: Check if the page has a redirect_url embedded in any visible link
      const embeddedRedirect = await page.evaluate((domain: string) => {
        const links = document.querySelectorAll('a[href]')
        for (const link of links) {
          const href = (link as HTMLAnchorElement).href
          try {
            const u = new URL(href)
            if (u.hostname !== domain && !href.includes('remoteok.com') && !href.includes('sign-up')) {
              return href
            }
            // Check redirect_url in the link itself
            const redirect = u.searchParams.get('redirect_url') || u.searchParams.get('redirect')
            if (redirect) {
              const decoded = decodeURIComponent(redirect)
              const parsed = new URL(decoded)
              if (parsed.hostname !== domain) return decoded
            }
          } catch {
            // skip
          }
        }
        return null
      }, listingDomain)

      if (embeddedRedirect) {
        console.log(`[job-board-redirect] Found embedded redirect URL: ${embeddedRedirect}`)
        return embeddedRedirect
      }

      // We clicked but couldn't resolve — try next selector
      // Navigate back to the listing page for next attempt
      await page.goBack({ timeout: 10_000 }).catch(() => {})
      await humanDelay(1000, 2000)

    } catch (err) {
      console.log(`[job-board-redirect] Selector ${sel} failed: ${err instanceof Error ? err.message : err}`)
      continue
    }
  }

  return null
}

/**
 * RemoteOK-specific: navigate directly to /l/{jobId} and follow the redirect chain.
 * This is a fallback if clicking didn't work.
 */
async function resolveRemoteOKDirect(page: Page, listingUrl: string): Promise<string | null> {
  // Extract job ID from URL (last segment after last dash, or numeric suffix)
  const match = listingUrl.match(/(\d+)(?:\?|$)/) || listingUrl.match(/-(\d+)$/)
  if (!match) return null

  const jobId = match[1]
  const redirectUrl = `https://remoteok.com/l/${jobId}`

  console.log(`[job-board-redirect] RemoteOK direct: navigating to ${redirectUrl}`)

  try {
    // Navigate and let Playwright execute the obfuscated JS
    const response = await page.goto(redirectUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    })

    // Wait for the JS redirect to execute
    await humanDelay(2000, 4000)

    // Wait a bit more for potential JS redirects
    await page.waitForURL(
      (url) => url.href !== redirectUrl && url.href !== `${redirectUrl}/`,
      { timeout: 10_000 }
    ).catch(() => {})

    const finalUrl = page.url()
    const finalDomain = new URL(finalUrl).hostname
    console.log(`[job-board-redirect] RemoteOK direct: final URL = ${finalUrl}`)

    // Check if we escaped remoteok.com
    if (finalDomain !== 'remoteok.com' && finalDomain !== 'www.remoteok.com') {
      return finalUrl
    }

    // Still on RemoteOK — check for redirect_url param (sign-up wall)
    const urlObj = new URL(finalUrl)
    const redirectParam = urlObj.searchParams.get('redirect_url')
      || urlObj.searchParams.get('redirect')
      || urlObj.searchParams.get('return_url')

    if (redirectParam) {
      try {
        const decoded = decodeURIComponent(redirectParam)
        const parsed = new URL(decoded)
        if (parsed.hostname !== 'remoteok.com') {
          console.log(`[job-board-redirect] RemoteOK sign-up wall, extracted: ${decoded}`)
          return decoded
        }
      } catch {
        // Invalid redirect URL
      }
    }

    // Try to extract from the page's JS-generated redirect
    // Some RemoteOK pages embed the URL in a data attribute or hidden element
    const hiddenUrl = await page.evaluate(() => {
      // Check for meta refresh
      const metaRefresh = document.querySelector('meta[http-equiv="refresh"]')
      if (metaRefresh) {
        const content = metaRefresh.getAttribute('content') || ''
        const urlMatch = content.match(/url=(.+)/i)
        if (urlMatch) return urlMatch[1]
      }

      // Check for window.location assignments in script tags
      const scripts = document.querySelectorAll('script:not([src])')
      for (const script of scripts) {
        const text = script.textContent || ''
        // Look for URL patterns in the script
        const urlMatch = text.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/)
        if (urlMatch && !urlMatch[1].includes('remoteok.com')) {
          return urlMatch[1]
        }
      }

      return null
    })

    if (hiddenUrl) {
      console.log(`[job-board-redirect] RemoteOK extracted hidden redirect: ${hiddenUrl}`)
      return hiddenUrl
    }

  } catch (err) {
    console.log(`[job-board-redirect] RemoteOK direct failed: ${err instanceof Error ? err.message : err}`)
  }

  return null
}

/**
 * Fallback: scan page for any external links pointing to known ATS domains.
 * Works for Himalayas and other boards that expose the employer URL directly.
 */
async function extractExternalApplyLink(page: Page, listingDomain: string): Promise<string | null> {
  return page.evaluate((domain: string) => {
    const knownATS = [
      'greenhouse.io', 'boards.greenhouse', 'lever.co', 'jobs.lever',
      'workable.com', 'breezy.hr', 'ashbyhq.com', 'recruitee.com',
      'smartrecruiters.com', 'bamboohr.com', 'myworkdayjobs.com',
      'icims.com', 'ultipro.com', 'jobvite.com', 'jazz.co',
    ]

    const links = document.querySelectorAll('a[href]')
    for (const link of links) {
      const href = (link as HTMLAnchorElement).href
      try {
        const u = new URL(href)
        // Direct ATS link
        if (knownATS.some(ats => u.hostname.includes(ats))) {
          return href
        }
        // Any external link with "apply" in it
        if (u.hostname !== domain && (href.includes('apply') || href.includes('career'))) {
          return href
        }
      } catch {
        // skip
      }
    }
    return null
  }, listingDomain)
}
