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

      console.log(`[job-board-redirect] Resolved employer URL (may be tracking redirect): ${employerUrl}`)

      // Step 3: Follow HTTP redirect chain server-side to get the FINAL employer URL.
      // Job boards like RemoteOK use intermediate tracking domains (e.g., aiok.co)
      // that 302-redirect to the actual employer ATS. We resolve via fetch() first.
      let finalUrl = await resolveRedirectChain(employerUrl)

      // Fallback A: if redirect chain failed on a tracking domain (e.g. aiok.co DNS error),
      // try browser-based resolution — SBR proxy may have better DNS than the worker.
      if (!finalUrl && isTrackingDomain(employerUrl)) {
        console.log(`[job-board-redirect] Redirect chain failed on tracking domain, trying Playwright fallback`)
        finalUrl = await resolveViaPlaywright(page, employerUrl)
      }

      // Fallback B: go back to listing page and extract ATS URL from rendered HTML.
      // Description may contain direct Greenhouse/Lever/etc. links we missed earlier.
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

      if (!finalUrl) {
        // All strategies exhausted — needs manual application
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

      // Step 4: Re-detect the correct adapter for the actual career page
      const { detectAdapter } = await import('./index')
      const realAdapter = detectAdapter(finalUrl)

      console.log(`[job-board-redirect] Delegating to ${realAdapter.name} adapter for: ${finalUrl}`)

      // Step 5: Delegate to the correct adapter
      const result = await realAdapter.apply(page, finalUrl, profile)

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

  while (hops < maxHops) {
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

  return currentUrl
}
