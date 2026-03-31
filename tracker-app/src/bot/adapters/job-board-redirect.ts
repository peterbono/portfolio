import type { Page } from 'playwright'
import type { ATSAdapter, ApplicantProfile, ApplyResult } from '../types'
import { humanDelay, takeScreenshot } from '../helpers'

/**
 * Job Board Redirect Adapter
 *
 * Handles URLs from job aggregator boards like RemoteOK, Himalayas, etc.
 * These sites list jobs but don't host application forms directly.
 * Strategy:
 *   1. Navigate to the listing page
 *   2. Extract the external "Apply" link (href, NOT click)
 *   3. Resolve the final URL (follow redirects)
 *   4. Re-dispatch to the correct ATS adapter (Greenhouse, Lever, etc.)
 *
 * If no external apply link is found or the resolved URL is still a job board,
 * returns 'needs_manual'.
 */
export const jobBoardRedirect: ATSAdapter = {
  name: 'JobBoardRedirect',

  detect(url: string): boolean {
    return /remoteok\.com/i.test(url)
      || /himalayas\.app/i.test(url)
      || /wellfound\.com/i.test(url)
      || /weworkremotely\.com/i.test(url)
      || /remotive\.com/i.test(url)
  },

  async apply(page: Page, jobUrl: string, profile: ApplicantProfile): Promise<ApplyResult> {
    const start = Date.now()

    try {
      // Step 1: Navigate to the job board listing page
      console.log(`[job-board-redirect] Navigating to listing: ${jobUrl}`)
      await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await humanDelay(2000, 3500)

      // Step 2: Extract the external Apply link href WITHOUT clicking
      const applyHref = await extractApplyHref(page, jobUrl)

      if (!applyHref) {
        const screenshot = await takeScreenshot(page)
        return {
          success: false,
          status: 'needs_manual',
          company: 'Unknown',
          role: 'Unknown',
          ats: 'JobBoardRedirect',
          reason: 'No external Apply link found on job board listing page',
          screenshotUrl: screenshot,
          duration: Date.now() - start,
        }
      }

      // Step 3: Resolve the URL (handle relative URLs)
      const resolvedUrl = new URL(applyHref, jobUrl).href
      console.log(`[job-board-redirect] Resolved apply URL: ${resolvedUrl}`)

      // Guard: if the resolved URL is still the same job board, bail
      if (/remoteok\.com|himalayas\.app|wellfound\.com|weworkremotely\.com|remotive\.com/i.test(resolvedUrl)) {
        const screenshot = await takeScreenshot(page)
        return {
          success: false,
          status: 'needs_manual',
          company: 'Unknown',
          role: 'Unknown',
          ats: 'JobBoardRedirect',
          reason: `Apply link loops back to job board: ${resolvedUrl}`,
          screenshotUrl: screenshot,
          duration: Date.now() - start,
        }
      }

      // Step 4: Re-detect the correct adapter for the actual career page
      // Dynamic import to avoid circular dependency
      const { detectAdapter } = await import('./index')
      const realAdapter = detectAdapter(resolvedUrl)

      console.log(`[job-board-redirect] Delegating to ${realAdapter.name} adapter for: ${resolvedUrl}`)

      // Step 5: Delegate to the correct adapter (it will navigate to resolvedUrl)
      return realAdapter.apply(page, resolvedUrl, profile)

    } catch (error) {
      const screenshot = await takeScreenshot(page).catch(() => '')
      return {
        success: false,
        status: 'failed',
        company: 'Unknown',
        role: 'Unknown',
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
 * Extract the external Apply link href from a job board listing page.
 * Looks for prominent "Apply" links that point to an external domain.
 */
async function extractApplyHref(page: Page, currentUrl: string): Promise<string | null> {
  const currentDomain = new URL(currentUrl).hostname

  // Selectors ordered by specificity — most reliable first
  const applyLinkSelectors = [
    // RemoteOK-specific
    'a.action-apply[href]',
    'a[itemprop="url"][href*="apply"]',
    // Himalayas-specific
    'a[data-testid="apply-button"][href]',
    'a[href*="/apply"][target="_blank"]',
    // Generic "Apply" links
    'a:has-text("Apply Now")[href]',
    'a:has-text("Apply for this")[href]',
    'a:has-text("Apply")[href]',
    // Broader patterns
    'a[href*="greenhouse.io"]',
    'a[href*="lever.co"]',
    'a[href*="jobs.lever"]',
    'a[href*="boards.greenhouse"]',
    'a[href*="workable.com"]',
    'a[href*="breezy.hr"]',
    'a[href*="ashbyhq.com"]',
    'a[href*="recruitee.com"]',
    'a[href*="smartrecruiters.com"]',
    'a[href*="bamboohr.com"]',
    'a[href*="apply"]',
  ]

  for (const selector of applyLinkSelectors) {
    try {
      const links = page.locator(selector)
      const count = await links.count()

      for (let i = 0; i < Math.min(count, 5); i++) {
        const href = await links.nth(i).getAttribute('href')
        if (!href) continue

        // Skip empty hrefs, javascript: links, anchors
        if (href.startsWith('#') || href.startsWith('javascript:') || href === '') continue

        // Skip links that stay on the same job board domain
        try {
          const linkDomain = new URL(href, currentUrl).hostname
          if (linkDomain === currentDomain) continue
        } catch {
          // Relative URL — likely stays on same domain
          continue
        }

        return href
      }
    } catch {
      continue
    }
  }

  // Fallback: try to find ANY external link near "Apply" text
  try {
    const applyArea = page.locator('text=Apply').first()
    const visible = await applyArea.isVisible({ timeout: 3000 })
    if (visible) {
      // Look for the nearest <a> parent or sibling
      const nearestLink = await applyArea.evaluate((el) => {
        // Walk up to find a link
        let node: HTMLElement | null = el as HTMLElement
        for (let depth = 0; depth < 5; depth++) {
          if (node?.tagName === 'A' && (node as HTMLAnchorElement).href) {
            return (node as HTMLAnchorElement).href
          }
          node = node?.parentElement ?? null
        }
        // Check siblings
        const parent = (el as HTMLElement).parentElement
        const links = parent?.querySelectorAll('a[href]') ?? []
        for (const link of links) {
          const anchor = link as HTMLAnchorElement
          if (anchor.href && !anchor.href.startsWith('javascript:')) {
            return anchor.href
          }
        }
        return null
      })

      if (nearestLink) {
        try {
          const linkDomain = new URL(nearestLink).hostname
          if (linkDomain !== currentDomain) {
            return nearestLink
          }
        } catch {
          // Invalid URL
        }
      }
    }
  } catch {
    // Fallback failed
  }

  return null
}
