import type { Page } from 'playwright'
import type { SearchProfile } from '../types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveredJob {
  title: string
  company: string
  location: string
  url: string
  isEasyApply: boolean
  postedDate: string
  matchScore?: number
}

export interface ScoutResult {
  jobs: DiscoveredJob[]
  totalFound: number
  filteredOut: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Companies that must never appear in results */
const DEFAULT_EXCLUDED = [
  'betrivers',
  'rush street interactive',
  'clickout media',
]

/**
 * Timezone offsets (UTC) that fall within +/-4 h of GMT+7 (UTC+3..UTC+11).
 * Used to filter locations we can accept.
 */
const COMPATIBLE_TZ_KEYWORDS = [
  // APAC
  'bangkok', 'thailand', 'singapore', 'malaysia', 'kuala lumpur', 'indonesia',
  'jakarta', 'vietnam', 'ho chi minh', 'hanoi', 'philippines', 'manila',
  'cebu', 'japan', 'tokyo', 'korea', 'seoul', 'taiwan', 'taipei',
  'hong kong', 'china', 'shanghai', 'beijing', 'shenzhen',
  'australia', 'sydney', 'melbourne', 'brisbane', 'perth',
  'new zealand', 'auckland',
  // India / Middle East (UTC+3 to UTC+5:30)
  'india', 'bangalore', 'bengaluru', 'mumbai', 'hyderabad', 'pune', 'delhi',
  'chennai', 'dubai', 'abu dhabi', 'uae', 'qatar', 'doha', 'saudi',
  'riyadh', 'bahrain', 'oman', 'muscat', 'kuwait',
  // Acceptable remote keywords
  'remote', 'apac', 'asia', 'asia-pacific', 'anywhere',
]

/** Keywords that signal an incompatible US/EU timezone requirement */
const INCOMPATIBLE_TZ_KEYWORDS = [
  'est', 'cst', 'pst', 'mst', 'eastern', 'pacific', 'central time',
  'cet', 'gmt+0', 'gmt+1', 'gmt+2', 'utc+0', 'utc+1', 'utc+2',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Random delay between min and max ms (human-like) */
function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Build a LinkedIn job search URL from the search profile */
function buildLinkedInSearchUrl(profile: SearchProfile): string {
  const base = 'https://www.linkedin.com/jobs/search/'
  const params = new URLSearchParams()

  // Keywords — use first keyword only (LinkedIn search works best with single terms)
  // Multiple keywords are searched across separate scout passes
  const keywords = profile.keywords?.[0] ?? 'Product Designer'
  params.set('keywords', keywords)

  // Location — use profile.location or default to "Asia Pacific" for APAC searches
  if (profile.location) {
    params.set('location', profile.location)
  } else {
    // Default: worldwide remote jobs
    params.set('location', 'Worldwide')
  }

  // Remote filter (f_WT=2 = remote)
  if (profile.remote_only) {
    params.set('f_WT', '2')
  }
  // Always add remote filter for better results
  params.set('f_WT', '2')

  // Date posted: past week (f_TPR=r604800)
  params.set('f_TPR', 'r604800')

  // Sort by most recent
  params.set('sortBy', 'DD')

  return `${base}?${params.toString()}`
}

/**
 * Build the LinkedIn guest API URL for fetching job listings without authentication.
 * This endpoint returns HTML fragments that are easier to parse than the full page.
 */
function buildGuestApiUrl(profile: SearchProfile, start: number = 0): string {
  const base = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search'
  const params = new URLSearchParams()

  const keywords = profile.keywords?.[0] ?? 'Product Designer'
  params.set('keywords', keywords)

  if (profile.location) {
    params.set('location', profile.location)
  } else {
    params.set('location', 'Worldwide')
  }

  if (profile.remote_only) {
    params.set('f_WT', '2')
  }
  params.set('f_WT', '2')

  // Past week
  params.set('f_TPR', 'r604800')

  // Sort by most recent
  params.set('sortBy', 'DD')

  // Pagination offset (25 per page)
  params.set('start', String(start))

  return `${base}?${params.toString()}`
}

/** Check if a location string is timezone-compatible with GMT+7 */
function isTimezoneCompatible(location: string): boolean {
  const lower = location.toLowerCase()

  // Reject if explicitly mentions incompatible timezone
  if (INCOMPATIBLE_TZ_KEYWORDS.some(kw => lower.includes(kw))) {
    return false
  }

  // Accept if matches any compatible keyword
  if (COMPATIBLE_TZ_KEYWORDS.some(kw => lower.includes(kw))) {
    return true
  }

  // "Remote" with no TZ qualifier — cautious accept
  if (lower.includes('remote') && !lower.includes('us') && !lower.includes('europe')) {
    return true
  }

  // Unknown location — skip to be safe
  return false
}

/** Normalize company name for dedup */
function normalizeForDedup(str: string): string {
  return str.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '')
}

/** Check if a company is in the excluded list */
function isExcludedCompany(company: string, excluded: string[]): boolean {
  const norm = normalizeForDedup(company)
  return excluded.some(ex => norm.includes(normalizeForDedup(ex)))
}

// ---------------------------------------------------------------------------
// Strategy 1: Guest API (no authentication needed, most reliable)
// ---------------------------------------------------------------------------

/**
 * Scrape jobs using LinkedIn's guest API endpoint.
 * Returns HTML fragments that are simpler to parse.
 * Each page returns ~25 results.
 */
async function scrapeViaGuestApi(
  page: Page,
  searchProfile: SearchProfile,
  maxPages: number,
): Promise<RawJobCard[]> {
  const allCards: RawJobCard[] = []

  for (let pageNum = 0; pageNum < maxPages; pageNum++) {
    const start = pageNum * 25
    const apiUrl = buildGuestApiUrl(searchProfile, start)
    console.log(`[scout:guest-api] Fetching page ${pageNum + 1}: ${apiUrl}`)

    try {
      await page.goto(apiUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })
      await randomDelay(1500, 3000)

      // The guest API returns a list of <li> elements with base-card class
      const cards = await page.evaluate(() => {
        const results: Array<{
          title: string
          company: string
          location: string
          url: string
          postedDate: string
          isEasyApply: boolean
        }> = []

        // Guest API returns job cards as <li> or <div> with base-card
        const cardElements = document.querySelectorAll(
          'li, .base-card, .base-search-card, .job-search-card, [data-entity-urn]'
        )

        for (const card of cardElements) {
          // --- Title ---
          const titleEl =
            card.querySelector('h3.base-search-card__title') ??
            card.querySelector('.base-search-card__title') ??
            card.querySelector('h3') ??
            card.querySelector('[class*="card__title"]')
          const title = titleEl?.textContent?.trim() ?? ''

          // --- Company ---
          const companyEl =
            card.querySelector('h4.base-search-card__subtitle') ??
            card.querySelector('.base-search-card__subtitle') ??
            card.querySelector('a.hidden-nested-link') ??
            card.querySelector('h4') ??
            card.querySelector('[class*="card__subtitle"]')
          const company = companyEl?.textContent?.trim() ?? ''

          // --- Location ---
          const locationEl =
            card.querySelector('span.job-search-card__location') ??
            card.querySelector('.job-search-card__location') ??
            card.querySelector('[class*="card__location"]') ??
            card.querySelector('.base-search-card__metadata')
          const location = locationEl?.textContent?.trim() ?? ''

          // --- URL ---
          const linkEl =
            (card.querySelector('a.base-card__full-link') as HTMLAnchorElement) ??
            (card.querySelector('a[href*="/jobs/view/"]') as HTMLAnchorElement) ??
            (card.querySelector('a[data-tracking-control-name*="search-card"]') as HTMLAnchorElement) ??
            (card.querySelector('a[href*="linkedin.com/jobs"]') as HTMLAnchorElement) ??
            (card.querySelector('a') as HTMLAnchorElement)
          let url = linkEl?.href ?? ''
          // Clean tracking params from URL
          if (url.includes('?')) {
            url = url.split('?')[0]
          }

          // --- Posted date ---
          const timeEl = card.querySelector('time')
          const postedDate = timeEl?.getAttribute('datetime') ?? ''

          // --- Easy Apply ---
          const easyApplyEl =
            card.querySelector('[class*="easy-apply"]') ??
            card.querySelector('[class*="easyApply"]')
          const isEasyApply = !!easyApplyEl

          // Only include if we got at least a title
          if (title) {
            results.push({ title, company, location, url, postedDate, isEasyApply })
          }
        }

        return results
      })

      console.log(`[scout:guest-api] Page ${pageNum + 1}: extracted ${cards.length} cards`)

      if (cards.length === 0) {
        console.log('[scout:guest-api] No more cards found, stopping pagination')
        break
      }

      allCards.push(...cards)
      await randomDelay(2000, 4000)
    } catch (err) {
      console.warn(
        `[scout:guest-api] Failed on page ${pageNum + 1}:`,
        (err as Error).message,
      )
      break
    }
  }

  return allCards
}

// ---------------------------------------------------------------------------
// Strategy 2: Full page scraping (authenticated or guest page)
// ---------------------------------------------------------------------------

/**
 * Scrape jobs from the full LinkedIn job search page.
 * Works for both authenticated (with li_at cookie) and guest views.
 */
async function scrapeViaFullPage(
  page: Page,
  searchProfile: SearchProfile,
  maxPages: number,
): Promise<RawJobCard[]> {
  const allCards: RawJobCard[] = []

  const searchUrl = buildLinkedInSearchUrl(searchProfile)
  console.log(`[scout:full-page] Navigating to: ${searchUrl}`)
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await randomDelay(2000, 4000)

  for (let pageNum = 0; pageNum < maxPages; pageNum++) {
    if (pageNum > 0) {
      // Click "next" or scroll to load more
      const nextButton = page.locator('button[aria-label="Page ' + (pageNum + 1) + '"]')
      if (await nextButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await nextButton.click()
        await randomDelay(2000, 4000)
      } else {
        // Try scrolling to bottom to trigger infinite scroll
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await randomDelay(2000, 3000)
      }
    }

    // Human-like scroll through the page
    for (let i = 0; i < 3; i++) {
      await page.evaluate(
        (scrollY) => window.scrollBy(0, scrollY),
        300 + Math.floor(Math.random() * 200),
      )
      await randomDelay(500, 1200)
    }

    // Debug: log page title
    const pageTitle = await page.title().catch(() => 'unknown')
    console.log(`[scout:full-page] Page ${pageNum + 1} title: "${pageTitle}"`)

    // Detect whether we're on authenticated or guest page
    const isAuthenticated = await page
      .locator('.global-nav__me, .feed-identity-module, [data-test-global-nav-me]')
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false)

    console.log(`[scout:full-page] Page mode: ${isAuthenticated ? 'authenticated' : 'guest'}`)

    // Extract cards using page.evaluate for reliability
    const cards = await page.evaluate((isAuth) => {
      const results: Array<{
        title: string
        company: string
        location: string
        url: string
        postedDate: string
        isEasyApply: boolean
      }> = []

      // --- Select job card containers ---
      let cardElements: NodeListOf<Element>

      if (isAuth) {
        // Authenticated LinkedIn: uses scaffold layout with job cards
        cardElements = document.querySelectorAll([
          '.job-card-container',
          '.jobs-search-results__list-item',
          '.scaffold-layout__list-item',
          '.jobs-search-results-list__list-item',
          '[data-occludable-job-id]',
          '[data-job-id]',
        ].join(', '))
      } else {
        // Guest LinkedIn: uses base-card layout
        cardElements = document.querySelectorAll([
          '.base-card',
          '.base-search-card',
          '.job-search-card',
          '.jobs-search__results-list > li',
        ].join(', '))
      }

      for (const card of cardElements) {
        let title = ''
        let company = ''
        let location = ''
        let url = ''
        let postedDate = ''
        let isEasyApply = false

        if (isAuth) {
          // === Authenticated selectors ===

          // Title (cascading priority)
          const titleEl =
            card.querySelector('a.job-card-container__link span') ??
            card.querySelector('a.job-card-list__title span') ??
            card.querySelector('.job-card-list__title') ??
            card.querySelector('.job-card-container__link') ??
            card.querySelector('a[data-control-name="job_card_title"]') ??
            card.querySelector('h3.job-card-container__title') ??
            card.querySelector('[class*="job-card"][class*="title"]') ??
            card.querySelector('a[href*="/jobs/view/"]')
          title = titleEl?.textContent?.trim() ?? ''

          // Company
          const companyEl =
            card.querySelector('.job-card-container__primary-description') ??
            card.querySelector('h4.job-card-container__company-name') ??
            card.querySelector('.job-card-container__company-name') ??
            card.querySelector('.artdeco-entity-lockup__subtitle span') ??
            card.querySelector('.artdeco-entity-lockup__subtitle') ??
            card.querySelector('[class*="company-name"]')
          company = companyEl?.textContent?.trim() ?? ''

          // Location
          const locationEl =
            card.querySelector('.job-card-container__metadata-wrapper li') ??
            card.querySelector('span.job-card-container__location') ??
            card.querySelector('.job-card-container__metadata-item') ??
            card.querySelector('.artdeco-entity-lockup__caption span') ??
            card.querySelector('.artdeco-entity-lockup__caption') ??
            card.querySelector('[class*="location"]')
          location = locationEl?.textContent?.trim() ?? ''

          // URL
          const linkEl =
            (card.querySelector('a[href*="/jobs/view/"]') as HTMLAnchorElement) ??
            (card.querySelector('a.job-card-container__link') as HTMLAnchorElement) ??
            (card.querySelector('a.job-card-list__title') as HTMLAnchorElement) ??
            (card.querySelector('a[href*="/jobs/"]') as HTMLAnchorElement)
          url = linkEl?.href ?? ''

          // Easy Apply
          const easyApplyEl =
            card.querySelector('.job-card-container__apply-method') ??
            card.querySelector('[class*="easy-apply"]') ??
            card.querySelector('[data-is-easy-apply="true"]')
          isEasyApply = !!easyApplyEl

        } else {
          // === Guest selectors ===

          // Title
          const titleEl =
            card.querySelector('h3.base-search-card__title') ??
            card.querySelector('.base-search-card__title') ??
            card.querySelector('h3') ??
            card.querySelector('[class*="card__title"]')
          title = titleEl?.textContent?.trim() ?? ''

          // Company
          const companyEl =
            card.querySelector('h4.base-search-card__subtitle') ??
            card.querySelector('.base-search-card__subtitle') ??
            card.querySelector('a.hidden-nested-link') ??
            card.querySelector('h4') ??
            card.querySelector('[class*="card__subtitle"]')
          company = companyEl?.textContent?.trim() ?? ''

          // Location
          const locationEl =
            card.querySelector('span.job-search-card__location') ??
            card.querySelector('.job-search-card__location') ??
            card.querySelector('[class*="card__location"]') ??
            card.querySelector('.base-search-card__metadata')
          location = locationEl?.textContent?.trim() ?? ''

          // URL
          const linkEl =
            (card.querySelector('a.base-card__full-link') as HTMLAnchorElement) ??
            (card.querySelector('a[href*="/jobs/view/"]') as HTMLAnchorElement) ??
            (card.querySelector('a[data-tracking-control-name*="search-card"]') as HTMLAnchorElement) ??
            (card.querySelector('a') as HTMLAnchorElement)
          url = linkEl?.href ?? ''

          // Easy Apply
          const easyApplyEl =
            card.querySelector('[class*="easy-apply"]') ??
            card.querySelector('[class*="easyApply"]')
          isEasyApply = !!easyApplyEl
        }

        // Posted date (common)
        const timeEl = card.querySelector('time')
        postedDate = timeEl?.getAttribute('datetime') ?? ''

        // Clean tracking params from URL
        if (url.includes('?')) {
          url = url.split('?')[0]
        }

        // Only add if title was extracted
        if (title) {
          results.push({ title, company, location, url, postedDate, isEasyApply })
        }
      }

      return results
    }, isAuthenticated)

    console.log(`[scout:full-page] Page ${pageNum + 1}: extracted ${cards.length} cards`)

    if (cards.length === 0 && pageNum === 0) {
      // Log HTML for debugging on first page with zero results
      const htmlSnippet = await page.evaluate(() => {
        const main = document.querySelector('main') ?? document.body
        return main.innerHTML.substring(0, 1500)
      }).catch(() => 'failed to get HTML')
      console.warn(`[scout:full-page] Zero cards on first page. HTML snippet:\n${htmlSnippet.substring(0, 600)}`)
    }

    allCards.push(...cards)
    await randomDelay(1500, 3000)
  }

  return allCards
}

// ---------------------------------------------------------------------------
// Internal raw card type (before filtering)
// ---------------------------------------------------------------------------

interface RawJobCard {
  title: string
  company: string
  location: string
  url: string
  postedDate: string
  isEasyApply: boolean
}

// ---------------------------------------------------------------------------
// Main scout function
// ---------------------------------------------------------------------------

/**
 * Discover jobs from LinkedIn using the provided Playwright page.
 * Uses a dual strategy:
 *   1. Guest API endpoint (faster, no auth needed, more stable HTML)
 *   2. Full page scraping fallback (works with authentication)
 * Filters by timezone compatibility, exclusion list, and duplicates.
 */
export async function scoutJobs(
  page: Page,
  searchProfile: SearchProfile,
  existingApplications: string[], // "company|role" lowercase combos
  maxPages: number = 3,
): Promise<ScoutResult> {
  let totalFound = 0
  let filteredOut = 0
  let extractionFailures = 0

  // Merge excluded companies from profile + hardcoded blacklist
  const excludedCompanies = [
    ...DEFAULT_EXCLUDED,
    ...(searchProfile.excluded_companies ?? []).map(c => c.toLowerCase()),
  ]

  const existingSet = new Set(existingApplications)

  // --- Strategy 1: Try guest API first (more reliable selectors) ---
  console.log('[scout] Strategy 1: Guest API endpoint')
  let rawCards = await scrapeViaGuestApi(page, searchProfile, maxPages)

  // --- Strategy 2: Fall back to full page if guest API returned nothing ---
  if (rawCards.length === 0) {
    console.log('[scout] Guest API returned 0 cards, falling back to full page scraping')
    rawCards = await scrapeViaFullPage(page, searchProfile, maxPages)
  }

  console.log(`[scout] Raw cards extracted: ${rawCards.length}`)

  // --- Validation & filtering ---
  const allJobs: DiscoveredJob[] = []

  for (const card of rawCards) {
    // Validation: skip cards with empty title or company
    if (!card.title) {
      extractionFailures++
      console.warn(
        `[scout] SKIP: empty title (company="${card.company}", url="${card.url}")`,
      )
      continue
    }
    if (!card.company) {
      extractionFailures++
      console.warn(
        `[scout] SKIP: empty company (title="${card.title}", url="${card.url}")`,
      )
      continue
    }

    totalFound++

    // Build full URL
    let url = card.url
    if (url && !url.startsWith('http')) {
      url = `https://www.linkedin.com${url}`
    }

    // --- Filters ---

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

    // 4. Poker / gambling filter (from blacklist rules)
    const titleLower = card.title.toLowerCase()
    if (titleLower.includes('poker') || titleLower.includes('gambling')) {
      filteredOut++
      continue
    }

    allJobs.push({
      title: card.title,
      company: card.company,
      location: card.location,
      url,
      isEasyApply: card.isEasyApply,
      postedDate: card.postedDate || new Date().toISOString(),
    })
  }

  // Deduplicate by URL
  const seen = new Set<string>()
  const deduped = allJobs.filter(j => {
    if (!j.url || seen.has(j.url)) return false
    seen.add(j.url)
    return true
  })

  // Summary log
  if (extractionFailures > 0) {
    console.warn(
      `[scout] WARNING: ${extractionFailures} cards had missing title or company — LinkedIn selectors may need updating`,
    )
  }

  console.log(
    `[scout] Finished: ${totalFound} valid, ${extractionFailures} extraction failures, ` +
    `${filteredOut} filtered, ${deduped.length} candidates`,
  )

  return {
    jobs: deduped,
    totalFound,
    filteredOut,
  }
}
