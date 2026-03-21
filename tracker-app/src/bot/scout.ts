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
 * Timezone offsets (UTC) that fall within ±4 h of GMT+7 (UTC+3..UTC+11).
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

  // Keywords
  const keywords = profile.keywords?.join(' ') ?? 'Product Designer'
  params.set('keywords', keywords)

  // Location
  if (profile.location) {
    params.set('location', profile.location)
  }

  // Remote filter (f_WT=2 = remote)
  if (profile.remote_only) {
    params.set('f_WT', '2')
  }

  // Date posted: past week (f_TPR=r604800)
  params.set('f_TPR', 'r604800')

  // Sort by most recent
  params.set('sortBy', 'DD')

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
// Main scout function
// ---------------------------------------------------------------------------

/**
 * Discover jobs from LinkedIn using the provided Playwright page.
 * Scrolls through up to `maxPages` of results, extracts job cards,
 * and filters by timezone compatibility, exclusion list, and duplicates.
 */
export async function scoutJobs(
  page: Page,
  searchProfile: SearchProfile,
  existingApplications: string[], // "company|role" lowercase combos
  maxPages: number = 3,
): Promise<ScoutResult> {
  const allJobs: DiscoveredJob[] = []
  let totalFound = 0
  let filteredOut = 0

  // Merge excluded companies from profile + hardcoded blacklist
  const excludedCompanies = [
    ...DEFAULT_EXCLUDED,
    ...(searchProfile.excluded_companies ?? []).map(c => c.toLowerCase()),
  ]

  const existingSet = new Set(existingApplications)

  const searchUrl = buildLinkedInSearchUrl(searchProfile)
  console.log(`[scout] Navigating to: ${searchUrl}`)
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

    // Extract job cards
    const cards = await page.locator('.job-card-container, .jobs-search-results__list-item, [data-job-id]').all()
    console.log(`[scout] Page ${pageNum + 1}: found ${cards.length} cards`)

    for (const card of cards) {
      try {
        const title = await card.locator('.job-card-list__title, .job-card-container__link, a[data-control-name]')
          .first()
          .innerText()
          .catch(() => '')

        const company = await card.locator('.job-card-container__primary-description, .artdeco-entity-lockup__subtitle')
          .first()
          .innerText()
          .catch(() => '')

        const location = await card.locator('.job-card-container__metadata-wrapper li, .artdeco-entity-lockup__caption')
          .first()
          .innerText()
          .catch(() => '')

        const linkEl = await card.locator('a[href*="/jobs/view/"], a[href*="/jobs/collections/"]')
          .first()
          .getAttribute('href')
          .catch(() => '')

        const isEasyApply = await card.locator('.job-card-container__apply-method, [data-is-easy-apply]')
          .first()
          .isVisible()
          .catch(() => false)

        const postedDate = await card.locator('time')
          .first()
          .getAttribute('datetime')
          .catch(() => new Date().toISOString())

        if (!title || !company) continue

        totalFound++

        // Build full URL
        let url = linkEl ?? ''
        if (url && !url.startsWith('http')) {
          url = `https://www.linkedin.com${url}`
        }

        // --- Filters ---

        // 1. Excluded company
        if (isExcludedCompany(company, excludedCompanies)) {
          filteredOut++
          continue
        }

        // 2. Timezone compatibility
        if (!isTimezoneCompatible(location)) {
          filteredOut++
          continue
        }

        // 3. Already applied
        const dedupKey = `${normalizeForDedup(company)}|${normalizeForDedup(title)}`
        if (existingSet.has(dedupKey)) {
          filteredOut++
          continue
        }

        // 4. Poker / gambling filter (from blacklist rules)
        const titleLower = title.toLowerCase()
        if (titleLower.includes('poker') || titleLower.includes('gambling')) {
          filteredOut++
          continue
        }

        allJobs.push({
          title: title.trim(),
          company: company.trim(),
          location: location.trim(),
          url,
          isEasyApply,
          postedDate: postedDate ?? new Date().toISOString(),
        })
      } catch (err) {
        // Individual card extraction failed — skip silently
        console.warn('[scout] Card extraction failed:', (err as Error).message)
      }
    }

    await randomDelay(1500, 3000)
  }

  // Deduplicate by URL
  const seen = new Set<string>()
  const deduped = allJobs.filter(j => {
    if (!j.url || seen.has(j.url)) return false
    seen.add(j.url)
    return true
  })

  console.log(
    `[scout] Finished: ${totalFound} total, ${filteredOut} filtered, ${deduped.length} candidates`,
  )

  return {
    jobs: deduped,
    totalFound,
    filteredOut,
  }
}
