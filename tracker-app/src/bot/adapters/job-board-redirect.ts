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

/**
 * Known job board domains that don't host ATS forms directly.
 * When a URL matches one of these, the redirect adapter resolves the
 * real employer ATS URL before dispatching to the correct adapter.
 *
 * Keep this list in sync with scout sources in scout-boards.ts.
 * Easy to extend: just add a new regex.
 */
export const JOB_BOARD_PATTERNS = [
  /remoteok\.com/i,
  /himalayas\.app/i,
  /wellfound\.com/i,
  /weworkremotely\.com/i,
  /remotive\.com/i,
  /dribbble\.com/i,
  /jobicy\.com/i,
]

// Known tracking/redirect domains that don't host ATS forms.
// These domains are used by job boards (e.g. RemoteOK → aiok.co) as
// intermediate click-tracking redirects. DNS often fails on Trigger.dev workers.
const TRACKING_DOMAINS = ['aiok.co', 'bit.ly', 'tinyurl.com', 't.co', 'ow.ly', 'buff.ly']

function isTrackingDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname
    return TRACKING_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`))
  } catch {
    return false
  }
}

/** Quick Ashby check — returns a skip result if the URL is Ashby, null otherwise */
function ashbySkipResult(url: string, company: string, role: string, start: number): ApplyResult | null {
  if (/ashbyhq\.com/i.test(url)) {
    console.log(`[job-board-redirect] Ashby detected in "${url}" — skipping (CSP blocks headless)`)
    return {
      success: false,
      status: 'skipped',
      company,
      role,
      ats: 'Ashby',
      reason: 'Ashby blocks headless browsers — filtered after redirect resolution',
      duration: Date.now() - start,
    }
  }
  return null
}

export const jobBoardRedirect: ATSAdapter = {
  name: 'JobBoardRedirect',

  detect(url: string): boolean {
    return JOB_BOARD_PATTERNS.some(p => p.test(url))
  },

  async apply(page: Page, jobUrl: string, profile: ApplicantProfile): Promise<ApplyResult> {
    const start = Date.now()

    // Use pre-populated metadata from the pipeline payload when available.
    // This is critical for RemoteOK: SBR proxy often returns 502 on remoteok.com,
    // so we can't reliably extract company/role from the page itself.
    let company = profile.jobMeta?.company || 'Unknown'
    let role = profile.jobMeta?.role || 'Unknown'

    try {
      // ─── FAST PATH (DISABLED — P0 safety, April 2026) ───────────────
      // The original fast path called probeCompanyAtsPages to find ATS URLs
      // for RemoteOK listings without loading the page. That probing was
      // unsafe: it could match a wrong role at the same company and lead
      // to applying to Software Engineer positions when the user approved
      // a Product Designer listing. The fast path is disabled on the
      // apply-dispatch path; the adapter now always goes through the
      // standard Playwright resolution path below, which reads the actual
      // listing page and extracts the real employer URL from it.

      // ─── STANDARD PATH: load listing page + resolve redirects ───────
      // Step 1: Navigate to the job board listing page
      console.log(`[job-board-redirect] Navigating to listing: ${jobUrl}`)
      let pageLoaded = false
      try {
        await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await humanDelay(2000, 3500)
        pageLoaded = true

        // Extract metadata from the listing page (enrich if we don't have it yet)
        const pageCompany = await extractCompanyName(page, jobUrl)
        const pageRole = await extractRoleTitle(page)
        if (company === 'Unknown' && pageCompany !== 'Unknown') company = pageCompany
        if (role === 'Unknown' && pageRole !== 'Unknown') role = pageRole
      } catch (navErr) {
        console.log(`[job-board-redirect] Page load failed: ${navErr instanceof Error ? navErr.message : navErr}`)
        // P0 safety (April 2026): ATS probing fallback removed.
        // Probing could match a wrong role at the same company and cause
        // the bot to submit to an unapproved position. If the listing page
        // can't be loaded, we fail closed (needs_manual) rather than guess
        // at the employer URL.
        return {
          success: false,
          status: 'needs_manual',
          company,
          role,
          ats: 'JobBoardRedirect',
          reason: `Page load failed and ATS probing disabled for safety: ${navErr instanceof Error ? navErr.message : navErr}`,
          duration: Date.now() - start,
        }
      }

      // Step 2: Resolve the actual employer URL
      const employerUrl = await resolveEmployerUrl(page, jobUrl)

      if (!employerUrl) {
        // P0 safety (April 2026): ATS probing fallback removed here too.
        // When the redirect chain fails to produce an employer URL we fail
        // closed. Probing with only company+role was matching the wrong
        // position at the same company (e.g. Engineer vs Product Designer).
        const screenshot = await takeScreenshot(page)
        return {
          success: false,
          status: 'needs_manual',
          company,
          role,
          ats: 'JobBoardRedirect',
          reason: 'Could not resolve external employer URL from job board redirect chain (ATS probing disabled for safety)',
          screenshotUrl: screenshot,
          duration: Date.now() - start,
        }
      }

      console.log(`[job-board-redirect] Resolved employer URL (may be tracking redirect): ${employerUrl}`)

      // Step 3: Follow HTTP redirect chain server-side to get the FINAL employer URL.
      let finalUrl = await resolveRedirectChain(employerUrl)

      // Fallback A: if redirect chain failed on a tracking domain (e.g. aiok.co DNS error),
      // try browser-based resolution — SBR proxy may have better DNS than the worker.
      if (!finalUrl && isTrackingDomain(employerUrl)) {
        console.log(`[job-board-redirect] Redirect chain failed on tracking domain, trying Playwright fallback`)
        finalUrl = await resolveViaPlaywright(page, employerUrl)
      }

      // Fallback B: go back to listing page and extract ATS URL from rendered HTML.
      if (!finalUrl) {
        console.log(`[job-board-redirect] All redirect strategies failed, trying ATS extraction from listing page`)
        try {
          await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })
          await humanDelay(1500, 2500)
          finalUrl = await extractAtsUrlFromPage(page)
          if (finalUrl) {
            console.log(`[job-board-redirect] Fallback B: found ATS URL in listing HTML: ${finalUrl}`)
          }
        } catch (e) {
          console.log(`[job-board-redirect] Fallback B failed: ${e instanceof Error ? e.message : e}`)
        }
      }

      // Fallback C REMOVED (P0 safety, April 2026):
      // Previously probed common ATS platforms with the company name slug
      // and used the first match as the submission target. This caused the
      // bot to apply to wrong roles at the right company. If Fallbacks A/B
      // don't find a direct employer URL we fail closed to needs_manual.

      if (!finalUrl) {
        const screenshot = await takeScreenshot(page)
        return {
          success: false,
          status: 'needs_manual',
          company,
          role,
          ats: 'JobBoardRedirect',
          reason: `Redirect chain unresolvable: ${employerUrl} — apply manually via job board listing`,
          screenshotUrl: screenshot,
          duration: Date.now() - start,
        }
      }

      console.log(`[job-board-redirect] Final URL after redirect chain: ${finalUrl}`)

      // Step 3.5: Intercept Ashby URLs BEFORE wasting time on navigation.
      const ashbySkip = ashbySkipResult(finalUrl, company, role, start)
      if (ashbySkip) return ashbySkip

      // Step 4: Re-detect the correct adapter for the actual career page
      const { detectAdapter } = await import('./index')
      const realAdapter = detectAdapter(finalUrl)

      console.log(`[job-board-redirect] Delegating to ${realAdapter.name} adapter for: ${finalUrl}`)

      // Step 5: Delegate to the correct adapter
      const result = await realAdapter.apply(page, finalUrl, profile)

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

  // ─── Strategy 0: Extract ATS URL directly from rendered page HTML ──
  // Job descriptions often contain direct Greenhouse/Lever/etc. links,
  // bypassing broken tracking redirect chains (aiok.co, etc.)
  const directAts = await extractAtsUrlFromPage(page)
  if (directAts) {
    console.log(`[job-board-redirect] Strategy 0: Found ATS URL in page HTML: ${directAts}`)
    return directAts
  }

  // ─── Strategy 1: Click Apply and follow the redirect chain ────────
  const applyResult = await clickApplyAndFollow(page, listingDomain)
  if (applyResult && !isTrackingDomain(applyResult)) return applyResult

  // ─── Strategy 2: Navigate directly to /l/{id} for RemoteOK ────────
  if (/remoteok\.com/i.test(listingUrl)) {
    const directResult = await resolveRemoteOKDirect(page, listingUrl)
    if (directResult && !isTrackingDomain(directResult)) return directResult
  }

  // ─── Strategy 3: Extract external links from page (Himalayas, etc.) ──
  const externalLink = await extractExternalApplyLink(page, listingDomain)
  if (externalLink && !isTrackingDomain(externalLink)) return externalLink

  // If we only got a tracking URL from strategies 1/2, return it anyway —
  // the caller will try resolveRedirectChain + Playwright fallback on it
  return applyResult || null
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
    'a[data-testid="apply-link"]',   // Himalayas variant
    'a.apply-button[href]',          // Dribbble
    'a[class*="apply" i][href]',     // Dribbble / generic job boards
    'a[class*="Apply" i][href]',     // Jobicy / generic
    'a:has-text("Apply Now")',
    'a:has-text("Apply for this position")',
    'a:has-text("Apply for this job")',
    'a:has-text("Apply on company site")',
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
        const skipDomains = ['aiok.co', 'bit.ly', 'asyncok.com', 'nomadlist.com',
          'web3.career', 'photoai.com', 'interiorai.com', 'chatbase.co',
          'producthunt.com', 'ideasandbugs.com', 'wip.co', 'levelsio.com',
          'buffer.com', 'news.ycombinator.com']
        const links = document.querySelectorAll('a[href]')
        for (const link of links) {
          const href = (link as HTMLAnchorElement).href
          try {
            const u = new URL(href)
            if (u.hostname !== domain && !href.includes('remoteok.com') && !href.includes('sign-up')
                && !skipDomains.some(d => u.hostname.includes(d))) {
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

/**
 * Extract ATS URLs directly from the rendered page HTML.
 * Scans all <a href> links and the full page body for known ATS domain patterns.
 * This catches direct Greenhouse/Lever/etc. links embedded in job descriptions,
 * bypassing broken tracking redirects (aiok.co, etc.).
 */
async function extractAtsUrlFromPage(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const knownATS = [
      'greenhouse.io', 'lever.co', 'workable.com', 'breezy.hr',
      'ashbyhq.com', 'recruitee.com', 'smartrecruiters.com',
      'bamboohr.com', 'myworkdayjobs.com', 'icims.com',
      'jobvite.com', 'teamtailor.com',
    ]

    // First pass: check all <a href> links on the page
    const links = document.querySelectorAll('a[href]')
    for (const link of links) {
      const href = (link as HTMLAnchorElement).href
      try {
        const u = new URL(href)
        if (knownATS.some(ats => u.hostname.includes(ats))) return href
      } catch { /* skip invalid URLs */ }
    }

    // Second pass: check all links for any external URL with apply/career/jobs keywords
    // (catches companies using their own career pages, not just known ATS)
    const skipDomains = ['remoteok.com', 'aiok.co', 'bit.ly', 'tinyurl.com']
    for (const link of links) {
      const href = (link as HTMLAnchorElement).href
      try {
        const u = new URL(href)
        const isSkipped = skipDomains.some(d => u.hostname.includes(d))
        if (!isSkipped && (href.includes('/apply') || href.includes('/careers') || href.includes('/jobs/'))) {
          return href
        }
      } catch { /* skip */ }
    }

    // Third pass: regex scan page HTML for ATS URL patterns
    // (catches URLs in data attributes, JS, or non-link HTML)
    const html = document.body?.innerHTML || ''
    const patterns = [
      /https?:\/\/[a-z0-9-]+\.greenhouse\.io\/[^\s"'<]+/i,
      /https?:\/\/boards\.greenhouse\.io\/[^\s"'<]+/i,
      /https?:\/\/[a-z0-9-]+\.lever\.co\/[^\s"'<]+/i,
      /https?:\/\/jobs\.lever\.co\/[^\s"'<]+/i,
      /https?:\/\/[a-z0-9-]+\.workable\.com\/[^\s"'<]+/i,
      /https?:\/\/[a-z0-9-]+\.breezy\.hr\/[^\s"'<]+/i,
      /https?:\/\/[a-z0-9-]+\.ashbyhq\.com\/[^\s"'<]+/i,
      /https?:\/\/[a-z0-9-]+\.recruitee\.com\/[^\s"'<]+/i,
      /https?:\/\/[a-z0-9-]+\.smartrecruiters\.com\/[^\s"'<]+/i,
      /https?:\/\/[a-z0-9-]+\.bamboohr\.com\/[^\s"'<]+/i,
      /https?:\/\/[a-z0-9-]+\.myworkdayjobs\.com\/[^\s"'<]+/i,
      /https?:\/\/[a-z0-9-]+\.jobvite\.com\/[^\s"'<]+/i,
      /https?:\/\/[a-z0-9-]+\.teamtailor\.com\/[^\s"'<]+/i,
    ]
    for (const p of patterns) {
      const match = html.match(p)
      if (match) return match[0].replace(/[&;'"<>)}\]]+$/, '')
    }

    return null
  })
}

/**
 * Fallback: resolve a URL by navigating to it in the browser (Playwright/SBR).
 * SBR (Bright Data Super Browser) uses residential/datacenter DNS that may
 * resolve domains unreachable from the Trigger.dev worker's Node.js fetch().
 * Useful for tracking domains like aiok.co.
 */
async function resolveViaPlaywright(page: Page, url: string): Promise<string | null> {
  console.log(`[job-board-redirect] Attempting Playwright navigation fallback: ${url}`)
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    await humanDelay(2000, 3000)

    const finalUrl = page.url()
    const srcHostname = new URL(url).hostname
    const dstHostname = new URL(finalUrl).hostname

    // If the browser navigated to a different domain, that's our result
    if (dstHostname !== srcHostname && !isTrackingDomain(finalUrl)) {
      console.log(`[job-board-redirect] Playwright resolved: ${url} → ${finalUrl}`)
      return finalUrl
    }

    // Check for meta-refresh or JS-based redirects that haven't fired yet
    const jsRedirect = await page.evaluate(() => {
      // meta http-equiv="refresh"
      const meta = document.querySelector('meta[http-equiv="refresh"]')
      if (meta) {
        const m = meta.getAttribute('content')?.match(/url=(.+)/i)
        if (m) return m[1].trim()
      }
      // window.location assignments in inline scripts
      const scripts = document.querySelectorAll('script:not([src])')
      for (const s of scripts) {
        const text = s.textContent || ''
        const m = text.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/)
        if (m && !m[1].includes(location.hostname)) return m[1]
      }
      return null
    })

    if (jsRedirect && !isTrackingDomain(jsRedirect)) {
      console.log(`[job-board-redirect] Playwright found JS redirect target: ${jsRedirect}`)
      return jsRedirect
    }
  } catch (err) {
    console.log(`[job-board-redirect] Playwright fallback failed: ${err instanceof Error ? err.message : err}`)
  }
  return null
}

/**
 * Probe common ATS platforms to find a company's career page.
 *
 * ⚠️ DANGEROUS — DO NOT CALL ON THE APPLY-DISPATCH PATH.
 *
 * When tracking domain redirects fail (aiok.co dead), we can still find the
 * employer's real career page by trying known ATS URL patterns with the company
 * name slugified. If a specific job title is provided, we try to find the matching
 * job listing on the career page.
 *
 * HISTORICAL INCIDENT (April 2026): this function returned any open job at a
 * company (e.g. JumpCloud "Software Engineer") even when the user-approved
 * role was a Product Designer listing on RemoteOK/Himalayas. The bot then
 * submitted applications to jobs the user never approved. All apply-time
 * callers were removed; the function is kept as dead code for reference while
 * a strict title-matching replacement is designed.
 *
 * Before re-enabling, the caller MUST:
 *   1. Verify the returned URL's path contains the expected role slug tokens
 *      (see urlContainsRoleSlug below).
 *   2. Never be on the apply-dispatch path without passing a real role title.
 *
 * Returns the career page URL if found (or specific job URL), null otherwise.
 */
// NOTE: kept as dead code for safety reference; see comment above.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function probeCompanyAtsPages(companyName: string, roleTitle?: string): Promise<string | null> {
  // Generate slug variants from company name
  // "Circle.so" → ["circleso", "circle-so", "circle"]
  // "OpenRouter" → ["openrouter"]
  // "The Real Deal" → ["therealdeal", "the-real-deal", "realdeal"]
  // "Fueled" → ["fueled", "fueledcareers"] (some use {company}careers on Greenhouse)
  // "Ethena Labs" → ["ethenalabs", "ethena-labs", "ethena"]
  const raw = companyName.toLowerCase().replace(/['']/g, '')
  const slugs = new Set<string>()
  const baseSlug = raw.replace(/[^a-z0-9]+/g, '')          // circleso, openrouter
  const dashSlug = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') // circle-so
  slugs.add(baseSlug)
  slugs.add(dashSlug)
  // {slug}careers variant (common on Greenhouse: e.g. "fueledcareers")
  slugs.add(baseSlug + 'careers')
  slugs.add(baseSlug + '-careers')
  // Remove common suffixes: "Labs", "Inc", "Co", "HQ", "IO"
  const noSuffix = raw.replace(/\s+(labs?|inc|co|hq|io|ai|corp|group|tech|digital)\s*$/i, '')
  if (noSuffix !== raw) {
    slugs.add(noSuffix.replace(/[^a-z0-9]+/g, ''))
    slugs.add(noSuffix.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  }
  // Remove common prefixes: "The", "A", "An"
  const noPrefixRaw = raw.replace(/^(the|a|an)\s+/i, '')
  if (noPrefixRaw !== raw) {
    slugs.add(noPrefixRaw.replace(/[^a-z0-9]+/g, ''))
    slugs.add(noPrefixRaw.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  }
  // CamelCase split: "JumpCloud" → "jump-cloud" (already handled), "SkySlope" → "skyslope"
  // Try removing dots/periods: "Circle.so" → "circleso" (already there)
  // Try just the first word for multi-word names: "Ethena Labs" → "ethena"
  const firstWord = raw.split(/[^a-z0-9]+/)[0]
  if (firstWord && firstWord.length >= 3 && firstWord !== baseSlug) {
    slugs.add(firstWord)
  }

  // ATS URL templates — {slug} is replaced with each slug variant
  const ATS_TEMPLATES = [
    'https://job-boards.greenhouse.io/{slug}',
    'https://boards.greenhouse.io/{slug}',
    'https://jobs.lever.co/{slug}',
    'https://jobs.ashbyhq.com/{slug}',
    'https://apply.workable.com/{slug}/',
    'https://{slug}.breezy.hr',
    'https://{slug}.recruitee.com/o',
    'https://careers.smartrecruiters.com/{slug}',
  ]

  // Track career pages found (fallback if no specific job match)
  let bestCareerPage: string | null = null

  // Total time budget for ATS probing — prevents runaway sequential fetches
  // (up to ~72 slug/template combos + 4 domain variants, each with 5s timeout)
  const PROBE_TOTAL_TIMEOUT_MS = 30_000 // 30s max for all probes combined
  const probeStart = Date.now()

  for (const slug of slugs) {
    if (Date.now() - probeStart > PROBE_TOTAL_TIMEOUT_MS) {
      console.warn(`[job-board-redirect] ATS probe total timeout (${PROBE_TOTAL_TIMEOUT_MS / 1000}s) — stopping`)
      break
    }
    for (const template of ATS_TEMPLATES) {
      if (Date.now() - probeStart > PROBE_TOTAL_TIMEOUT_MS) break
      const url = template.replace('{slug}', slug)
      try {
        const response = await fetch(url, {
          method: 'HEAD',
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(5_000),
        })
        if (response.ok) {
          const careerPageUrl = response.url || url
          console.log(`[job-board-redirect] ATS probe hit: ${careerPageUrl} (HTTP ${response.status})`)

          // Career page found — try to find the SPECIFIC job matching the role title
          if (roleTitle) {
            const specificJob = await findJobOnCareerPage(careerPageUrl, roleTitle)
            if (specificJob) {
              console.log(`[job-board-redirect] Found specific job URL: ${specificJob}`)
              return specificJob
            }
            console.log(`[job-board-redirect] No role match on ${careerPageUrl}, continuing probe...`)
          }
          // Save as fallback — prefer pages with known adapters (Greenhouse, Lever)
          if (!bestCareerPage || careerPageUrl.includes('greenhouse') || careerPageUrl.includes('lever')) {
            bestCareerPage = careerPageUrl
          }
        }
      } catch (err) {
        // Skip — this ATS/slug combo doesn't work (DNS error, timeout, 404)
        console.log(`[job-board-redirect] ATS probe miss: ${url} — ${err instanceof Error ? err.message : 'error'}`)
      }
    }
  }

  console.log(`[job-board-redirect] ATS template probing done in ${((Date.now() - probeStart) / 1000).toFixed(1)}s, trying company domains...`)

  // Also try the company's own domain /careers page
  const domainVariants = [
    `https://${raw.replace(/[^a-z0-9]+/g, '')}.com/careers`,
    `https://${raw.replace(/[^a-z0-9]+/g, '')}.io/careers`,
    `https://${raw.replace(/[^a-z0-9]+/g, '')}.ai/careers`,
    `https://www.${raw.replace(/[^a-z0-9]+/g, '')}.com/careers`,
  ]

  for (const url of domainVariants) {
    if (Date.now() - probeStart > PROBE_TOTAL_TIMEOUT_MS) {
      console.warn(`[job-board-redirect] Domain probe skipped — total probe timeout reached`)
      break
    }
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
        signal: AbortSignal.timeout(5_000),
      })
      if (response.ok) {
        const careerPageUrl = response.url || url
        console.log(`[job-board-redirect] Company domain probe hit: ${careerPageUrl}`)
        if (roleTitle) {
          const specificJob = await findJobOnCareerPage(careerPageUrl, roleTitle)
          if (specificJob) return specificJob
        }
        if (!bestCareerPage) bestCareerPage = careerPageUrl
      }
    } catch {
      // Skip
    }
  }

  // IMPORTANT: Do NOT return career listing pages as fallback.
  // If we found career pages but couldn't match the specific job,
  // returning the listing page would cause the adapter to apply to
  // a RANDOM job (e.g., JumpCloud "Software Engineer" instead of "Product Designer").
  // It's better to return null → needs_manual than to apply to the wrong position.
  if (bestCareerPage) {
    console.log(`[job-board-redirect] ATS probe: found career page ${bestCareerPage} but no specific job match — NOT returning listing page to avoid wrong-job applications`)
  }

  console.log(`[job-board-redirect] ATS probe: no specific job found for "${companyName}" — "${roleTitle}"`)
  return null
}

/**
 * Find a specific job listing on an ATS career page by matching the role title.
 * Fetches the career page HTML and scans all links for one whose text matches
 * the role title. Returns the job-specific URL or null.
 */
async function findJobOnCareerPage(careerPageUrl: string, roleTitle: string): Promise<string | null> {
  try {
    const response = await fetch(careerPageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return null
    const html = await response.text()

    // Tokenize role title into significant words.
    // Keep 2-letter industry terms (UX, UI, AI, QA, PM, VP, HR) — they're critical for matching.
    const INDUSTRY_TERMS = new Set(['ux', 'ui', 'ai', 'qa', 'pm', 'vp', 'hr', 'sr', 'cx', 'dx', 'ml'])
    const roleWords = roleTitle.toLowerCase()
      .split(/[\s/,\-–—·•]+/)
      .filter(w => (w.length >= 3 || INDUSTRY_TERMS.has(w)) && !['the', 'and', 'for', 'with', 'at', 'in', 'of'].includes(w))

    if (roleWords.length === 0) return null

    // Adaptive threshold: require match of at least half the role words (min 1)
    const minScore = Math.max(1, Math.ceil(roleWords.length / 2))

    // Extract all links: href + text
    const linkRegex = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    let bestMatch: { url: string; score: number } | null = null
    let match: RegExpExecArray | null

    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1]
      // Strip HTML tags from link text
      const text = match[2].replace(/<[^>]+>/g, '').trim().toLowerCase()

      if (!text || text.length < 3) continue

      // Score: count how many role words appear in the link text
      const score = roleWords.filter(w => text.includes(w)).length
      if (score >= minScore && (!bestMatch || score > bestMatch.score)) {
        // Resolve relative URLs against career page
        try {
          const absoluteUrl = new URL(href, careerPageUrl).href
          // Only accept URLs on the same domain or known ATS domains
          const urlHost = new URL(absoluteUrl).hostname
          const baseHost = new URL(careerPageUrl).hostname
          if (urlHost === baseHost || urlHost.includes('greenhouse') || urlHost.includes('lever')
              || urlHost.includes('ashby') || urlHost.includes('workable')) {
            bestMatch = { url: absoluteUrl, score }
          }
        } catch { /* skip invalid URLs */ }
      }
    }

    if (bestMatch) {
      console.log(`[job-board-redirect] Career page job match (score ${bestMatch.score}/${roleWords.length}): ${bestMatch.url}`)
      return bestMatch.url
    }

    console.log(`[job-board-redirect] No job matching "${roleTitle}" on career page ${careerPageUrl}`)
  } catch (err) {
    console.log(`[job-board-redirect] Career page fetch failed: ${err instanceof Error ? err.message : err}`)
  }
  return null
}

/**
 * Follow HTTP redirect chain server-side using fetch().
 *
 * Job boards use intermediate tracking domains (aiok.co, bit.ly, etc.)
 * that 302-redirect to the actual employer ATS. SBR proxy often can't
 * resolve these domains' DNS, so we follow redirects with Node.js fetch()
 * (which uses the Trigger.dev worker's DNS, not SBR's) before handing
 * the final URL to Playwright.
 *
 * Max 10 hops to prevent infinite loops.
 */
/**
 * Returns null if the URL can't be resolved at all (dead domain, DNS error).
 * Returns the final resolved URL if redirect chain was followed successfully.
 * Returns the original URL if it's directly reachable (no redirects).
 */
async function resolveRedirectChain(url: string, maxHops = 10): Promise<string | null> {
  let currentUrl = url
  let hops = 0
  let reachable = false
  const chainStart = Date.now()
  const CHAIN_TOTAL_TIMEOUT_MS = 30_000 // 30s max for entire redirect chain

  while (hops < maxHops) {
    if (Date.now() - chainStart > CHAIN_TOTAL_TIMEOUT_MS) {
      console.warn(`[job-board-redirect] Redirect chain total timeout (${CHAIN_TOTAL_TIMEOUT_MS / 1000}s) at hop ${hops}`)
      break
    }
    try {
      const response = await fetch(currentUrl, {
        method: 'HEAD',
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(10_000),
      })

      reachable = true

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) break
        currentUrl = new URL(location, currentUrl).href
        hops++
        console.log(`[job-board-redirect] Redirect hop ${hops}: ${response.status} → ${currentUrl}`)
        continue
      }

      break // 2xx or other — final URL

    } catch (err) {
      // HEAD might fail — try GET as fallback
      if (!reachable) {
        try {
          const response = await fetch(currentUrl, {
            method: 'GET',
            redirect: 'follow',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            },
            signal: AbortSignal.timeout(15_000),
          })
          reachable = true
          if (response.url && response.url !== currentUrl) {
            console.log(`[job-board-redirect] GET redirect resolved: ${currentUrl} → ${response.url}`)
            currentUrl = response.url
          }
        } catch (getErr) {
          // Both HEAD and GET failed — domain is unreachable
          console.log(`[job-board-redirect] Domain unreachable: ${currentUrl} — ${getErr instanceof Error ? getErr.message : getErr}`)
          return null
        }
      }
      break
    }
  }

  if (!reachable) {
    console.log(`[job-board-redirect] URL unreachable after ${hops} hops: ${currentUrl}`)
    return null
  }

  if (hops >= maxHops) {
    console.log(`[job-board-redirect] Redirect chain exceeded ${maxHops} hops, stopping at: ${currentUrl}`)
  }

  // Post-processing: if we landed on a sign-up/login wall with a redirect_url
  // param pointing to the real employer URL, extract it instead of returning
  // the sign-up page. This commonly happens with RemoteOK (/sign-up?redirect_url=...).
  try {
    const finalUrlObj = new URL(currentUrl)
    if (finalUrlObj.pathname.includes('sign-up') || finalUrlObj.pathname.includes('login')) {
      const actualUrl = finalUrlObj.searchParams.get('redirect_url')
        || finalUrlObj.searchParams.get('redirect')
        || finalUrlObj.searchParams.get('return_url')
        || finalUrlObj.searchParams.get('next')
        || finalUrlObj.searchParams.get('url')
      if (actualUrl) {
        const decoded = decodeURIComponent(actualUrl)
        const parsed = new URL(decoded)
        if (parsed.hostname !== finalUrlObj.hostname) {
          console.log(`[job-board-redirect] Extracted real URL from sign-up wall: ${decoded}`)
          return decoded
        }
      }
    }
  } catch { /* URL parsing failed — return as-is */ }

  return currentUrl
}

// ─── Exported utilities for pre-processing in apply-jobs.ts ─────────

/**
 * Check whether a URL belongs to a known job board (not a direct ATS).
 * Used as a lightweight guard before attempting resolution.
 */
export function isJobBoardUrl(url: string): boolean {
  return JOB_BOARD_PATTERNS.some(p => p.test(url))
}

/**
 * Tokenize a role title into significant slug tokens for URL matching.
 * Example: "Senior Product Designer (Remote)" → ["senior", "product", "designer"]
 * Keeps 2-letter industry terms (ux, ui, ai, etc.) that are load-bearing.
 */
function roleSlugTokens(roleTitle: string): string[] {
  const INDUSTRY_TERMS = new Set(['ux', 'ui', 'ai', 'qa', 'pm', 'vp', 'hr', 'sr', 'cx', 'dx', 'ml'])
  const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'at', 'in', 'of', 'to', 'a', 'an'])
  return roleTitle.toLowerCase()
    .split(/[\s/,\-–—·•()[\]]+/)
    .map(w => w.replace(/[^a-z0-9]/g, ''))
    .filter(w => (w.length >= 3 || INDUSTRY_TERMS.has(w)) && !STOPWORDS.has(w))
}

/**
 * Title-match safeguard: verify a resolved URL is plausibly about the
 * same role as the original listing. Returns true if the URL path/slug
 * contains at least half the significant tokens from the role title
 * (min 1). If no tokens can be extracted, the check fails closed (false).
 *
 * Used to reject ATS URLs that a probe resolved to a completely different
 * role at the same company (e.g. Product Designer → Software Engineer).
 */
function urlContainsRoleSlug(resolvedUrl: string, roleTitle: string): boolean {
  if (!roleTitle || !resolvedUrl) return false
  const tokens = roleSlugTokens(roleTitle)
  if (tokens.length === 0) return false
  let pathAndQuery = ''
  try {
    const u = new URL(resolvedUrl)
    pathAndQuery = (u.pathname + ' ' + u.search).toLowerCase()
  } catch {
    pathAndQuery = resolvedUrl.toLowerCase()
  }
  const matches = tokens.filter(t => pathAndQuery.includes(t)).length
  const minScore = Math.max(1, Math.ceil(tokens.length / 2))
  return matches >= minScore
}

/**
 * Lightweight server-side URL resolver for job board listing pages.
 *
 * Attempts to resolve a job board URL to the real ATS URL WITHOUT launching
 * Playwright. Uses only HTTP fetch + redirect chain following + ATS probing.
 *
 * This is a FALLBACK safety net called in apply-jobs.ts before adapter detection.
 * If scouts already resolved the URL to an ATS domain, this is a no-op.
 *
 * Returns the resolved ATS URL, or the original URL if resolution fails
 * (the jobBoardRedirect adapter will still handle it as a full fallback).
 */
export async function resolveJobBoardUrlServerSide(
  url: string,
  meta?: { company?: string; role?: string },
): Promise<string> {
  // Skip if URL is already a known ATS domain (no resolution needed)
  const knownATS = [
    'greenhouse.io', 'lever.co', 'workable.com', 'breezy.hr',
    'ashbyhq.com', 'recruitee.com', 'smartrecruiters.com',
    'bamboohr.com', 'myworkdayjobs.com', 'icims.com',
    'jobvite.com', 'teamtailor.com', 'linkedin.com',
  ]
  try {
    const hostname = new URL(url).hostname
    if (knownATS.some(ats => hostname.includes(ats))) return url
  } catch {
    return url
  }

  // Only attempt resolution for known job board URLs
  if (!isJobBoardUrl(url)) return url

  console.log(`[url-resolver] Attempting server-side resolution for job board URL: ${url}`)

  // Strategy 1: For Jobicy, fetch the listing page HTML and scan for ATS URLs.
  // Jobicy embeds employer links directly in the listing HTML.
  if (/jobicy\.com/i.test(url)) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(10_000),
      })
      if (response.ok) {
        const html = await response.text()
        const atsUrl = extractAtsUrlFromHtml(html)
        if (atsUrl) {
          console.log(`[url-resolver] Jobicy: resolved ATS URL from HTML: ${atsUrl}`)
          return atsUrl
        }
      }
    } catch (err) {
      console.log(`[url-resolver] Jobicy HTML fetch failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  // Strategy 2: For Dribbble, fetch the job page HTML and look for ATS links.
  if (/dribbble\.com/i.test(url)) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(10_000),
      })
      if (response.ok) {
        const html = await response.text()
        const atsUrl = extractAtsUrlFromHtml(html)
        if (atsUrl) {
          console.log(`[url-resolver] Dribbble: resolved ATS URL from HTML: ${atsUrl}`)
          return atsUrl
        }
      }
    } catch (err) {
      console.log(`[url-resolver] Dribbble HTML fetch failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  // Strategy 3: For any job board, follow HTTP redirect chain from the listing URL.
  // Some boards (Remotive, WWR) use simple 302 redirects to ATS pages.
  try {
    const resolved = await resolveRedirectChain(url)
    if (resolved && resolved !== url && !isJobBoardUrl(resolved)) {
      // SAFETY: title-match guard (P0 fix, April 2026).
      // Reject resolutions that don't plausibly point to the same role.
      // Prevents cases where a redirect lands on a generic careers page
      // or a wrong job at the same company.
      if (meta?.role && !urlContainsRoleSlug(resolved, meta.role)) {
        console.warn(`[url-resolver] Title-match guard REJECTED: ${resolved} does not contain role slug for "${meta.role}" — returning original URL`)
        return url
      }
      console.log(`[url-resolver] Redirect chain resolved: ${url} -> ${resolved}`)
      return resolved
    }
  } catch (err) {
    console.log(`[url-resolver] Redirect chain failed: ${err instanceof Error ? err.message : err}`)
  }

  // Strategy 4: ATS probing with company name — DISABLED on apply-dispatch path.
  //
  // HISTORICAL INCIDENT (April 2026): probeCompanyAtsPages would find ANY open
  // job at a company (e.g. JumpCloud/Ethena Labs) and return that URL even when
  // the role title was a complete mismatch. The bot then auto-submitted
  // applications to jobs the user NEVER approved (Product Designer → Software
  // Engineer). findJobOnCareerPage's loose scoring (ceil(words/2)) and the Lever
  // public API fallback both let wrong roles through.
  //
  // resolveJobBoardUrlServerSide is called from src/trigger/apply-jobs.ts,
  // which is the APPLY DISPATCH path. Silent wrong-URL resolution here turns
  // into wrong submissions. Probing is disabled on this code path until a
  // strict title-matching strategy is implemented.
  //
  // Scout-time URL enrichment lives in src/bot/scout-boards.ts and does not
  // call this function, so scout coverage is unaffected.
  if (meta?.company && meta.company !== 'Unknown') {
    console.warn(`[url-resolver] ATS probing disabled on apply-dispatch path (P0 safety). Company="${meta.company}" role="${meta.role ?? ''}" — deferring to adapter.`)
  }

  // Resolution failed — return original URL.
  // The jobBoardRedirect adapter will handle it with full Playwright resolution.
  console.log(`[url-resolver] Server-side resolution failed for ${url}, deferring to adapter`)
  return url
}

/**
 * Extract ATS URLs from raw HTML string (no Playwright needed).
 * Scans for known ATS domain patterns in href attributes and raw text.
 */
function extractAtsUrlFromHtml(html: string): string | null {
  // Pattern: <a href="https://boards.greenhouse.io/..."> etc.
  const hrefRegex = /href=["'](https?:\/\/[^"']+)["']/gi
  const knownATS = [
    'greenhouse.io', 'lever.co', 'workable.com', 'breezy.hr',
    'ashbyhq.com', 'recruitee.com', 'smartrecruiters.com',
    'bamboohr.com', 'myworkdayjobs.com', 'icims.com',
    'jobvite.com', 'teamtailor.com',
  ]

  let match: RegExpExecArray | null
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1]
    try {
      const hostname = new URL(href).hostname
      if (knownATS.some(ats => hostname.includes(ats))) {
        return href.replace(/[&;'"<>)}\]]+$/, '') // trim trailing junk
      }
    } catch { /* skip invalid URLs */ }
  }

  // Fallback: regex scan raw HTML for ATS URL patterns
  const patterns = [
    /https?:\/\/[a-z0-9-]+\.greenhouse\.io\/[^\s"'<]+/i,
    /https?:\/\/boards\.greenhouse\.io\/[^\s"'<]+/i,
    /https?:\/\/[a-z0-9-]+\.lever\.co\/[^\s"'<]+/i,
    /https?:\/\/jobs\.lever\.co\/[^\s"'<]+/i,
    /https?:\/\/[a-z0-9-]+\.workable\.com\/[^\s"'<]+/i,
    /https?:\/\/[a-z0-9-]+\.breezy\.hr\/[^\s"'<]+/i,
    /https?:\/\/[a-z0-9-]+\.ashbyhq\.com\/[^\s"'<]+/i,
    /https?:\/\/[a-z0-9-]+\.recruitee\.com\/[^\s"'<]+/i,
    /https?:\/\/[a-z0-9-]+\.smartrecruiters\.com\/[^\s"'<]+/i,
    /https?:\/\/[a-z0-9-]+\.myworkdayjobs\.com\/[^\s"'<]+/i,
    /https?:\/\/[a-z0-9-]+\.jobvite\.com\/[^\s"'<]+/i,
    /https?:\/\/[a-z0-9-]+\.teamtailor\.com\/[^\s"'<]+/i,
  ]
  for (const p of patterns) {
    const m = html.match(p)
    if (m) return m[0].replace(/[&;'"<>)}\]]+$/, '')
  }

  return null
}
