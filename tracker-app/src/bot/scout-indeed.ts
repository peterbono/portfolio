import type { Page } from 'playwright'
import type { SearchProfile } from '../types/database'
import {
  type DiscoveredJob,
  type ScoutResult,
  type MultiPassConfig,
  DEFAULT_EXCLUDED,
  randomDelay,
  isTimezoneCompatible,
  normalizeForDedup,
  isExcludedCompany,
} from './scout'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Indeed shows ~15 results per page; pagination via `start` param */
const INDEED_RESULTS_PER_PAGE = 15

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

/**
 * Build an Indeed job search URL.
 *
 * @param keyword - Job title / search term
 * @param location - City, country, or "remote"
 * @param pageIndex - 0-based page number (start = pageIndex * INDEED_RESULTS_PER_PAGE)
 */
export function buildIndeedSearchUrl(
  keyword: string,
  location: string,
  pageIndex: number = 0,
): string {
  const base = 'https://www.indeed.com/jobs'
  const params = new URLSearchParams()

  params.set('q', keyword)
  params.set('l', location)
  // Sort by date, last 7 days
  params.set('sort', 'date')
  params.set('fromage', '7')

  if (pageIndex > 0) {
    params.set('start', String(pageIndex * INDEED_RESULTS_PER_PAGE))
  }

  return `${base}?${params.toString()}`
}

// ---------------------------------------------------------------------------
// Raw card type (before filtering)
// ---------------------------------------------------------------------------

interface IndeedRawCard {
  title: string
  company: string
  location: string
  url: string
  postedDate: string
}

// ---------------------------------------------------------------------------
// Page scraper
// ---------------------------------------------------------------------------

/**
 * Scrape a single Indeed search results page.
 * Extracts job cards from the DOM using multiple selector strategies.
 */
async function scrapeIndeedPage(page: Page): Promise<IndeedRawCard[]> {
  return page.evaluate(() => {
    const results: Array<{
      title: string
      company: string
      location: string
      url: string
      postedDate: string
    }> = []

    // Indeed uses several card container patterns
    const cardElements = document.querySelectorAll([
      'div.job_seen_beacon',
      'td.resultContent',
      'div.cardOutline',
      'div[data-jk]',
      '.jobsearch-ResultsList > div',
    ].join(', '))

    for (const card of cardElements) {
      // --- Title ---
      const titleEl =
        card.querySelector('h2.jobTitle a') ??
        card.querySelector('h2.jobTitle span') ??
        card.querySelector('a[data-jk] span') ??
        card.querySelector('.jobTitle a') ??
        card.querySelector('.jobTitle span') ??
        card.querySelector('h2 a') ??
        card.querySelector('h2 span')
      const title = titleEl?.textContent?.trim() ?? ''

      // --- Company ---
      const companyEl =
        card.querySelector('[data-testid="company-name"]') ??
        card.querySelector('span.companyName') ??
        card.querySelector('.company_location [data-testid="company-name"]') ??
        card.querySelector('span.css-92r8pb') ??
        card.querySelector('.companyName')
      const company = companyEl?.textContent?.trim() ?? ''

      // --- Location ---
      const locationEl =
        card.querySelector('[data-testid="text-location"]') ??
        card.querySelector('div.companyLocation') ??
        card.querySelector('.company_location [data-testid="text-location"]') ??
        card.querySelector('.companyLocation')
      const location = locationEl?.textContent?.trim() ?? ''

      // --- URL ---
      const linkEl =
        (card.querySelector('h2.jobTitle a') as HTMLAnchorElement) ??
        (card.querySelector('a[data-jk]') as HTMLAnchorElement) ??
        (card.querySelector('.jobTitle a') as HTMLAnchorElement) ??
        (card.querySelector('a[href*="/rc/clk"]') as HTMLAnchorElement) ??
        (card.querySelector('a[href*="viewjob"]') as HTMLAnchorElement)

      let url = ''
      if (linkEl) {
        const href = linkEl.getAttribute('href') ?? linkEl.href ?? ''
        if (href.startsWith('http')) {
          url = href
        } else if (href.startsWith('/')) {
          url = `https://www.indeed.com${href}`
        }
      }

      // Also try data-jk attribute for job ID
      if (!url) {
        const jk =
          card.getAttribute('data-jk') ??
          card.querySelector('[data-jk]')?.getAttribute('data-jk')
        if (jk) {
          url = `https://www.indeed.com/viewjob?jk=${jk}`
        }
      }

      // --- Posted date ---
      const dateEl =
        card.querySelector('.date') ??
        card.querySelector('span.css-qvloho') ??
        card.querySelector('[data-testid="myJobsStateDate"]') ??
        card.querySelector('.result-footer .date')
      const postedDate = dateEl?.textContent?.trim() ?? ''

      if (title) {
        results.push({ title, company, location, url, postedDate })
      }
    }

    return results
  })
}

// ---------------------------------------------------------------------------
// Main Indeed scout function
// ---------------------------------------------------------------------------

/**
 * Discover jobs from Indeed for a single keyword + location combo.
 * Scrapes up to `maxPages` pages of results.
 *
 * @param page - Playwright Page instance
 * @param keyword - Search keyword (e.g., "Product Designer")
 * @param location - Search location (e.g., "Singapore", "Remote")
 * @param searchProfile - Used for excluded companies and filters
 * @param existingApplications - "company|role" lowercase combos for dedup
 * @param maxPages - Max number of Indeed pages to scrape (default 2, ~30 results)
 */
export async function scoutIndeed(
  page: Page,
  keyword: string,
  location: string,
  searchProfile: SearchProfile,
  existingApplications: string[],
  maxPages: number = 2,
): Promise<ScoutResult> {
  let totalFound = 0
  let filteredOut = 0
  let extractionFailures = 0

  const excludedCompanies = [
    ...DEFAULT_EXCLUDED,
    ...(searchProfile.excluded_companies ?? []).map(c => c.toLowerCase()),
  ]

  const existingSet = new Set(existingApplications)
  const allRawCards: IndeedRawCard[] = []

  for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
    const searchUrl = buildIndeedSearchUrl(keyword, location, pageIdx)
    console.log(`[scout:indeed] Page ${pageIdx + 1}: ${searchUrl}`)

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25_000 })

      // Human-like delay before scraping
      await randomDelay(2000, 4000)

      // Scroll down slowly to trigger lazy-loaded cards
      for (let i = 0; i < 3; i++) {
        await page.evaluate(
          (scrollY) => window.scrollBy(0, scrollY),
          400 + Math.floor(Math.random() * 300),
        )
        await randomDelay(600, 1200)
      }

      const cards = await scrapeIndeedPage(page)
      console.log(`[scout:indeed] Page ${pageIdx + 1}: extracted ${cards.length} cards`)

      if (cards.length === 0) {
        // Check if Indeed is blocking us (CAPTCHA / "unusual traffic" page)
        const bodyText = await page.evaluate(() =>
          document.body.textContent?.substring(0, 500) ?? ''
        ).catch(() => '')

        if (bodyText.toLowerCase().includes('unusual traffic') ||
            bodyText.toLowerCase().includes('captcha') ||
            bodyText.toLowerCase().includes('not a robot')) {
          console.warn('[scout:indeed] Anti-bot detection triggered, stopping Indeed scrape')
          break
        }

        console.log('[scout:indeed] No cards found, stopping pagination')
        break
      }

      allRawCards.push(...cards)

      // Delay between pages
      if (pageIdx < maxPages - 1) {
        await randomDelay(3000, 6000)
      }
    } catch (err) {
      console.warn(
        `[scout:indeed] Failed on page ${pageIdx + 1}:`,
        (err as Error).message,
      )
      break
    }
  }

  console.log(`[scout:indeed] Raw cards total: ${allRawCards.length}`)

  // --- Validation & filtering (same logic as LinkedIn scout) ---
  const allJobs: DiscoveredJob[] = []

  for (const card of allRawCards) {
    if (!card.title) {
      extractionFailures++
      continue
    }
    if (!card.company) {
      extractionFailures++
      continue
    }

    totalFound++

    // 1. Excluded company
    if (isExcludedCompany(card.company, excludedCompanies)) {
      filteredOut++
      continue
    }

    // 2. Timezone compatibility
    if (!isTimezoneCompatible(card.location)) {
      filteredOut++
      continue
    }

    // 3. Already applied
    const dedupKey = `${normalizeForDedup(card.company)}|${normalizeForDedup(card.title)}`
    if (existingSet.has(dedupKey)) {
      filteredOut++
      continue
    }

    // 4. Poker / gambling filter
    const titleLower = card.title.toLowerCase()
    if (titleLower.includes('poker') || titleLower.includes('gambling')) {
      filteredOut++
      continue
    }

    allJobs.push({
      title: card.title,
      company: card.company,
      location: card.location,
      url: card.url,
      isEasyApply: false, // Indeed doesn't have Easy Apply like LinkedIn
      postedDate: card.postedDate || new Date().toISOString(),
      source: 'indeed',
    })
  }

  // Deduplicate by URL
  const seen = new Set<string>()
  const deduped = allJobs.filter(j => {
    if (!j.url || seen.has(j.url)) return false
    seen.add(j.url)
    return true
  })

  if (extractionFailures > 0) {
    console.warn(
      `[scout:indeed] WARNING: ${extractionFailures} cards had missing title or company`,
    )
  }

  console.log(
    `[scout:indeed] "${keyword}" in "${location}": ${totalFound} valid, ` +
    `${filteredOut} filtered, ${deduped.length} candidates`,
  )

  return {
    jobs: deduped,
    totalFound,
    filteredOut,
  }
}

// ---------------------------------------------------------------------------
// Multi-pass Indeed scout (keyword x location cross-product)
// ---------------------------------------------------------------------------

/**
 * Run Indeed scout across all keyword x location combinations, then deduplicate.
 * Mirrors the LinkedIn multi-pass pattern from scout.ts.
 */
export async function scoutIndeedMultiPass(
  page: Page,
  searchProfile: SearchProfile,
  existingApplications: string[],
  multiPass: MultiPassConfig,
): Promise<ScoutResult> {
  const { keywords, locations, pagesPerSearch, onSearchProgress } = multiPass

  const combos: Array<{ keyword: string; location: string }> = []
  for (const kw of keywords) {
    for (const loc of locations) {
      combos.push({ keyword: kw, location: loc })
    }
  }

  console.log(
    `[scout:indeed:multi-pass] Starting ${combos.length} searches ` +
    `(${keywords.length} keywords x ${locations.length} locations x ${pagesPerSearch} pages)`,
  )

  let globalTotalFound = 0
  let globalFilteredOut = 0
  const allJobs: DiscoveredJob[] = []

  // Global dedup across all passes
  const seenUrls = new Set<string>()
  const seenCompanyTitle = new Set<string>()

  for (let i = 0; i < combos.length; i++) {
    const { keyword, location } = combos[i]
    console.log(
      `[scout:indeed:multi-pass] Search ${i + 1}/${combos.length}: "${keyword}" in "${location}"`,
    )

    try {
      const result = await scoutIndeed(
        page,
        keyword,
        location,
        searchProfile,
        existingApplications,
        pagesPerSearch,
      )

      globalTotalFound += result.totalFound
      globalFilteredOut += result.filteredOut

      let newInThisPass = 0
      for (const job of result.jobs) {
        // URL dedup
        if (job.url && seenUrls.has(job.url)) continue

        // Company+title dedup
        const companyTitleKey = `${job.company.toLowerCase().trim()}|${job.title.toLowerCase().trim()}`
        if (seenCompanyTitle.has(companyTitleKey)) continue

        if (job.url) seenUrls.add(job.url)
        seenCompanyTitle.add(companyTitleKey)
        allJobs.push(job)
        newInThisPass++
      }

      console.log(
        `[scout:indeed:multi-pass] "${keyword}" x "${location}": ${result.jobs.length} candidates, ${newInThisPass} new unique`,
      )

      // Fire progress callback if provided
      onSearchProgress?.({
        searchIndex: i,
        totalSearches: combos.length,
        keyword,
        location,
        newJobsThisSearch: newInThisPass,
        totalUniqueJobs: allJobs.length,
      })

      // Delay between searches to avoid rate limiting
      if (i < combos.length - 1) {
        await randomDelay(3000, 6000)
      }
    } catch (err) {
      console.warn(
        `[scout:indeed:multi-pass] Search "${keyword}" x "${location}" failed: ${(err as Error).message}`,
      )
    }
  }

  console.log(
    `[scout:indeed:multi-pass] Complete: ${combos.length} searches, ${globalTotalFound} total found, ` +
    `${globalFilteredOut} filtered, ${allJobs.length} unique candidates`,
  )

  return {
    jobs: allJobs,
    totalFound: globalTotalFound,
    filteredOut: globalFilteredOut,
  }
}
