import type { Page, BrowserContext } from 'playwright'
import type { SearchProfile } from '../types/database'
import { blockUnnecessaryResources } from './helpers'
import * as cheerio from 'cheerio'

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
  source?: 'linkedin' | 'indeed' | 'remoteok' | 'wellfound' | 'himalayas' | 'remotive' | 'wwr' | 'dribbble' | 'jobicy'
  description?: string // Pre-fetched JD (e.g. RemoteOK API provides full description)
  ats?: string // ATS type classification (lever, greenhouse, ashby, workable, etc.)
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
export const DEFAULT_EXCLUDED = [
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
  // South/Southeast Asia (UTC+5 to UTC+7)
  'sri lanka', 'colombo', 'myanmar', 'yangon', 'cambodia', 'phnom penh',
  'laos', 'vientiane', 'bangladesh', 'dhaka', 'nepal', 'kathmandu',
  'pakistan', 'karachi', 'lahore', 'islamabad',
  // Remote APAC patterns
  'apac', 'asia', 'asia-pacific', 'asia pacific', 'southeast asia', 'sea region',
]

/** Keywords that signal an incompatible timezone requirement */
const INCOMPATIBLE_TZ_KEYWORDS = [
  // US country-level
  'united states', 'united states of america',
  // US timezones
  'est', 'cst', 'pst', 'mst', 'eastern time', 'pacific time', 'central time', 'mountain time',
  // Major US cities — top tech hubs and metros
  'new york', 'san francisco', 'los angeles', 'chicago', 'seattle',
  'austin', 'denver', 'boston', 'atlanta', 'miami', 'dallas',
  'houston', 'portland', 'san diego', 'san jose', 'palo alto',
  'menlo park', 'mountain view', 'cupertino', 'sunnyvale', 'redwood city',
  'santa clara', 'irvine', 'scottsdale', 'salt lake city', 'raleigh',
  'durham', 'charlotte', 'nashville', 'phoenix', 'pittsburgh',
  'philadelphia', 'washington dc', 'minneapolis', 'columbus',
  'indianapolis', 'detroit', 'milwaukee', 'kansas city', 'st louis',
  'tampa', 'orlando', 'sacramento', 'las vegas', 'baltimore',
  'richmond', 'oakland', 'boulder', 'provo', 'lehi',
  // EU timezones
  'cet', 'gmt+0', 'gmt+1', 'gmt+2', 'utc+0', 'utc+1', 'utc+2',
  // LATAM / Americas (country + city names)
  'latam', 'latin america', 'south america', 'americas', 'north america',
  'buenos aires', 'sao paulo', 'são paulo', 'mexico city', 'bogota', 'bogotá',
  'santiago', 'lima', 'medellin', 'medellín', 'montevideo',
  'brazil', 'brasil', 'argentina', 'colombia', 'chile', 'peru', 'mexico',
  'costa rica', 'panama', 'caribbean', 'canada', 'toronto', 'vancouver', 'montreal',
  'ottawa', 'calgary', 'edmonton', 'winnipeg', 'quebec', 'québec', 'ontario', 'british columbia',
  // EU countries / cities
  'europe', 'emea', 'united kingdom', 'london', 'berlin', 'paris', 'amsterdam',
  'dublin', 'madrid', 'barcelona', 'lisbon', 'munich', 'hamburg', 'vienna',
  'zurich', 'zürich', 'geneva', 'stockholm', 'copenhagen', 'oslo', 'helsinki',
  'warsaw', 'prague', 'bucharest', 'brussels', 'milan', 'rome',
  // Africa (too far)
  'lagos', 'nairobi', 'cape town', 'johannesburg', 'accra', 'cairo', 'africa',
]

// ---------------------------------------------------------------------------
// SBR Resilience Helpers
// ---------------------------------------------------------------------------

/** Error messages that indicate the CDP/WebSocket connection is dead */
const DEAD_CONNECTION_PATTERNS = [
  'Target closed',
  'Session closed',
  'Connection closed',
  'WebSocket is not open',
  'Protocol error',
  'Target page, context or browser has been closed',
  'Browser has been closed',
  'page.goto: Target closed',
  'page.goto: Browser closed',
  'Execution context was destroyed',
  'frame was detached',
  'ERR_TUNNEL_CONNECTION_FAILED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_REFUSED',
  'net::ERR_',
  'NS_ERROR_NET',
  'ECONNRESET',
  'EPIPE',
  'socket hang up',
  'Scout search timeout',  // Per-search 90s timeout — SBR froze silently
  'Scout retry timeout',   // Retry also timed out
]

/** Check if an error indicates the browser/CDP connection is dead (not just a page load failure) */
export function isDeadConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return DEAD_CONNECTION_PATTERNS.some(pattern => msg.includes(pattern))
}

/** Probe whether a page's browser context is still alive */
export async function isBrowserAlive(page: Page): Promise<boolean> {
  try {
    // Quick probe: evaluate a trivial expression
    await page.evaluate(() => 1)
    return true
  } catch {
    return false
  }
}

/**
 * Reconnect to Bright Data SBR and return a fresh { page, context }.
 * Returns null if reconnection fails (caller should skip browser-based sources).
 */
export async function reconnectSBR(): Promise<{ page: Page; context: BrowserContext } | null> {
  const sbrAuth = (process.env.BRIGHTDATA_SBR_AUTH || '').trim() || undefined
  if (!sbrAuth) {
    console.warn('[scout:reconnect] No BRIGHTDATA_SBR_AUTH env var — cannot reconnect')
    return null
  }

  try {
    const { chromium } = await import('playwright')
    console.log('[scout:reconnect] Connecting to SBR...')
    const newBrowser = await chromium.connectOverCDP(`wss://${sbrAuth}@brd.superproxy.io:9222`)
    const context = newBrowser.contexts()[0] || await newBrowser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'Asia/Bangkok',
      ignoreHTTPSErrors: true,
    })
    await blockUnnecessaryResources(context, 'aggressive')
    const page = await context.newPage()
    console.log('[scout:reconnect] SBR reconnected successfully')
    return { page, context }
  } catch (reconnErr) {
    console.error('[scout:reconnect] SBR reconnect failed:', (reconnErr as Error).message)
    return null
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Random delay between min and max ms (human-like) */
export function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Build a LinkedIn job search URL from the search profile (or explicit overrides) */
function buildLinkedInSearchUrl(
  profile: SearchProfile,
  keywordOverride?: string,
  locationOverride?: string,
): string {
  const base = 'https://www.linkedin.com/jobs/search/'
  const params = new URLSearchParams()

  // Keywords — use override if provided, otherwise first keyword
  const keywords = keywordOverride ?? profile.keywords?.[0] ?? 'Product Designer'
  params.set('keywords', keywords)

  // Location — use override if provided, otherwise profile.location
  const location = locationOverride ?? profile.location
  if (location) {
    params.set('location', location)
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
function buildGuestApiUrl(
  profile: SearchProfile,
  start: number = 0,
  keywordOverride?: string,
  locationOverride?: string,
): string {
  const base = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search'
  const params = new URLSearchParams()

  const keywords = keywordOverride ?? profile.keywords?.[0] ?? 'Product Designer'
  params.set('keywords', keywords)

  const location = locationOverride ?? profile.location
  if (location) {
    params.set('location', location)
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

/**
 * US state abbreviations for detecting "City, XX" patterns in locations.
 * Checked separately because 2-letter codes are too short for substring matching.
 */
const US_STATE_ABBREVS = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC',
]

/**
 * Check if a location contains a US state abbreviation pattern like "City, CA".
 * Uses comma+space+2-letter-code pattern to avoid false positives.
 */
function hasUSStateAbbrev(location: string): boolean {
  for (const state of US_STATE_ABBREVS) {
    const pattern = new RegExp(`,\\s*${state}(?:\\s*$|\\s*,|\\s+|\\))`)
    if (pattern.test(location)) {
      // Guard against false positives: if location also contains APAC keywords, skip
      const lower = location.toLowerCase()
      const apacSafe = COMPATIBLE_TZ_KEYWORDS.some(kw => lower.includes(kw))
      if (!apacSafe) return true
    }
  }
  return false
}

/** Check if a location string is timezone-compatible with GMT+7 */
export function isTimezoneCompatible(location: string): boolean {
  const lower = location.toLowerCase()

  // Reject if explicitly mentions incompatible timezone keyword
  if (INCOMPATIBLE_TZ_KEYWORDS.some(kw => lower.includes(kw))) {
    return false
  }

  // Reject if contains US state abbreviation pattern (e.g. "Palo Alto, CA")
  if (hasUSStateAbbrev(location)) {
    return false
  }

  // Reject short "US" patterns — "Remote, US", "US", "Remote (US)"
  // Use word-boundary regex to avoid matching "campus", "focus", etc.
  if (/\bUS\b/.test(location) || /\bU\.S\.?\b/i.test(location)) {
    return false
  }

  // Accept if matches any compatible keyword
  if (COMPATIBLE_TZ_KEYWORDS.some(kw => lower.includes(kw))) {
    return true
  }

  // "Remote" alone without APAC signal — REJECT (too many false positives from LATAM/US)
  // Only accept if combined with APAC-compatible location (e.g. "Remote - Thailand")
  if (lower === 'remote' || lower === 'worldwide' || lower === 'anywhere') {
    return false
  }

  // Unknown location — skip to be safe
  return false
}

/** Normalize company name for dedup */
export function normalizeForDedup(str: string): string {
  return str.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '')
}

/** Check if a company is in the excluded list */
export function isExcludedCompany(company: string, excluded: string[]): boolean {
  const norm = normalizeForDedup(company)
  return excluded.some(ex => norm.includes(normalizeForDedup(ex)))
}

// ---------------------------------------------------------------------------
// Strategy 0: Fetch-based Guest API (no Playwright, enables parallelism)
// ---------------------------------------------------------------------------

/**
 * LinkedIn request headers to mimic a browser visit.
 * Used by fetch-based guest API scraper to avoid blocks.
 */
const LINKEDIN_FETCH_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
}

/**
 * Scrape LinkedIn guest API using fetch() + cheerio.
 * This enables true parallelism: no browser page needed.
 * Each page returns ~25 results as HTML fragments.
 */
async function scrapeViaGuestApiFetch(
  searchProfile: SearchProfile,
  maxPages: number,
  keywordOverride?: string,
  locationOverride?: string,
): Promise<RawJobCard[]> {
  const allCards: RawJobCard[] = []

  for (let pageNum = 0; pageNum < maxPages; pageNum++) {
    const start = pageNum * 25
    const apiUrl = buildGuestApiUrl(searchProfile, start, keywordOverride, locationOverride)

    try {
      const response = await fetch(apiUrl, {
        headers: LINKEDIN_FETCH_HEADERS,
        signal: AbortSignal.timeout(15_000),
      })

      if (!response.ok) {
        console.warn(`[scout:fetch-api] Page ${pageNum + 1} HTTP ${response.status}`)
        break
      }

      const html = await response.text()
      if (!html || html.trim().length < 50) {
        console.log('[scout:fetch-api] Empty response, stopping pagination')
        break
      }

      const $ = cheerio.load(html)
      const cards: RawJobCard[] = []

      // Guest API returns job cards as <li> or <div> with base-card class
      $('li, .base-card, .base-search-card, .job-search-card, [data-entity-urn]').each((_, el) => {
        const card = $(el)

        // Title
        const title = (
          card.find('h3.base-search-card__title').text() ||
          card.find('.base-search-card__title').text() ||
          card.find('h3').first().text() ||
          card.find('[class*="card__title"]').text()
        ).trim()

        // Company
        const company = (
          card.find('h4.base-search-card__subtitle').text() ||
          card.find('.base-search-card__subtitle').text() ||
          card.find('a.hidden-nested-link').text() ||
          card.find('h4').first().text() ||
          card.find('[class*="card__subtitle"]').text()
        ).trim()

        // Location
        const location = (
          card.find('span.job-search-card__location').text() ||
          card.find('.job-search-card__location').text() ||
          card.find('[class*="card__location"]').text() ||
          card.find('.base-search-card__metadata').text()
        ).trim()

        // URL
        let url =
          card.find('a.base-card__full-link').attr('href') ||
          card.find('a[href*="/jobs/view/"]').attr('href') ||
          card.find('a[data-tracking-control-name*="search-card"]').attr('href') ||
          card.find('a[href*="linkedin.com/jobs"]').attr('href') ||
          card.find('a').first().attr('href') ||
          ''
        if (url.includes('?')) url = url.split('?')[0]

        // Posted date
        const postedDate = card.find('time').attr('datetime') || ''

        // Easy Apply
        const isEasyApply = card.find('[class*="easy-apply"], [class*="easyApply"]').length > 0

        if (title) {
          cards.push({ title, company, location, url, postedDate, isEasyApply })
        }
      })

      console.log(`[scout:fetch-api] Page ${pageNum + 1}: extracted ${cards.length} cards`)

      if (cards.length === 0) {
        console.log('[scout:fetch-api] No cards found, stopping pagination')
        break
      }

      allCards.push(...cards)

      // Small delay between pages to avoid rate limiting
      if (pageNum < maxPages - 1) {
        await randomDelay(1000, 2000)
      }
    } catch (err) {
      console.warn(`[scout:fetch-api] Failed on page ${pageNum + 1}:`, (err as Error).message)
      break
    }
  }

  return allCards
}

/**
 * Fetch-based LinkedIn scout: uses fetch() + cheerio instead of Playwright.
 * Applies the same filtering (timezone, excluded companies, dedup) as scoutJobs().
 * Can be run in parallel since it doesn't need a browser page.
 */
export async function scoutJobsFetch(
  searchProfile: SearchProfile,
  existingApplications: string[],
  maxPages: number = 2,
  keywordOverride?: string,
  locationOverride?: string,
): Promise<ScoutResult> {
  let totalFound = 0
  let filteredOut = 0

  const excludedCompanies = [
    ...DEFAULT_EXCLUDED,
    ...(searchProfile.excluded_companies ?? []).map(c => c.toLowerCase()),
  ]
  const existingSet = new Set(existingApplications)

  const kw = keywordOverride ?? searchProfile.keywords?.[0] ?? 'Product Designer'
  const loc = locationOverride ?? searchProfile.location ?? 'Worldwide'
  console.log(`[scout:fetch] Fetching "${kw}" in "${loc}" (${maxPages} pages)`)

  const rawCards = await scrapeViaGuestApiFetch(searchProfile, maxPages, keywordOverride, locationOverride)

  const allJobs: DiscoveredJob[] = []

  for (const card of rawCards) {
    if (!card.title || !card.company) continue
    totalFound++

    let url = card.url
    if (url && url.includes('linkedin.com/')) {
      url = url.replace(/https?:\/\/[a-z]{2}\.linkedin\.com/, 'https://www.linkedin.com')
    }
    if (url && !url.startsWith('http')) {
      url = `https://www.linkedin.com${url}`
    }

    if (isExcludedCompany(card.company, excludedCompanies)) { filteredOut++; continue }
    if (!isTimezoneCompatible(card.location)) { filteredOut++; continue }
    const dedupKey = `${normalizeForDedup(card.company)}|${normalizeForDedup(card.title)}`
    if (existingSet.has(dedupKey)) { filteredOut++; continue }
    const titleLower = card.title.toLowerCase()
    if (titleLower.includes('poker') || titleLower.includes('gambling')) { filteredOut++; continue }

    allJobs.push({
      title: card.title,
      company: card.company,
      location: card.location,
      url,
      isEasyApply: card.isEasyApply,
      postedDate: card.postedDate || new Date().toISOString(),
      source: 'linkedin',
      ats: 'linkedin',
    })
  }

  // Deduplicate by URL
  const seen = new Set<string>()
  const deduped = allJobs.filter(j => {
    if (!j.url || seen.has(j.url)) return false
    seen.add(j.url)
    return true
  })

  console.log(`[scout:fetch] "${kw}" × "${loc}": ${totalFound} found, ${filteredOut} filtered, ${deduped.length} unique`)

  return { jobs: deduped, totalFound, filteredOut }
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
  keywordOverride?: string,
  locationOverride?: string,
): Promise<RawJobCard[]> {
  const allCards: RawJobCard[] = []

  for (let pageNum = 0; pageNum < maxPages; pageNum++) {
    const start = pageNum * 25
    const apiUrl = buildGuestApiUrl(searchProfile, start, keywordOverride, locationOverride)
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
      // If the browser/CDP connection is dead, re-throw so caller can reconnect
      if (isDeadConnectionError(err)) {
        console.error('[scout:guest-api] Dead connection detected — re-throwing for reconnect')
        throw err
      }
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
  keywordOverride?: string,
  locationOverride?: string,
): Promise<RawJobCard[]> {
  const allCards: RawJobCard[] = []

  const searchUrl = buildLinkedInSearchUrl(searchProfile, keywordOverride, locationOverride)
  console.log(`[scout:full-page] Navigating to: ${searchUrl}`)
  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  } catch (err) {
    if (isDeadConnectionError(err)) {
      console.error('[scout:full-page] Dead connection on initial goto — re-throwing for reconnect')
      throw err
    }
    // Non-fatal navigation error (timeout, etc.) — return empty
    console.warn('[scout:full-page] Navigation failed:', (err as Error).message)
    return allCards
  }
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
 *
 * @param keywordOverride - If provided, overrides profile.keywords[0]
 * @param locationOverride - If provided, overrides profile.location
 */
export async function scoutJobs(
  page: Page,
  searchProfile: SearchProfile,
  existingApplications: string[], // "company|role" lowercase combos
  maxPages: number = 3,
  keywordOverride?: string,
  locationOverride?: string,
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
  const kw = keywordOverride ?? searchProfile.keywords?.[0] ?? 'Product Designer'
  const loc = locationOverride ?? searchProfile.location ?? 'Worldwide'
  console.log(`[scout] Strategy 1: Guest API endpoint (keyword="${kw}", location="${loc}")`)
  let rawCards = await scrapeViaGuestApi(page, searchProfile, maxPages, keywordOverride, locationOverride)

  // --- Strategy 2: Fall back to full page if guest API returned nothing ---
  if (rawCards.length === 0) {
    console.log('[scout] Guest API returned 0 cards, falling back to full page scraping')
    rawCards = await scrapeViaFullPage(page, searchProfile, maxPages, keywordOverride, locationOverride)
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

    // Build full URL — normalize regional LinkedIn domains (ph.linkedin.com → www.linkedin.com)
    let url = card.url
    if (url && url.includes('linkedin.com/')) {
      url = url.replace(/https?:\/\/[a-z]{2}\.linkedin\.com/, 'https://www.linkedin.com')
    }
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
      source: 'linkedin',
      ats: 'linkedin',
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

// ---------------------------------------------------------------------------
// Multi-pass scout: keyword × location cross-product with global dedup
// ---------------------------------------------------------------------------

/** Callback fired after each individual keyword x location search completes */
export interface ScoutProgressUpdate {
  searchIndex: number       // 0-based index of current search
  totalSearches: number     // total keyword x location combos
  keyword: string
  location: string
  newJobsThisSearch: number // unique new jobs found in this search
  totalUniqueJobs: number   // cumulative unique jobs so far
}

export interface MultiPassConfig {
  keywords: string[]
  locations: string[]
  pagesPerSearch: number // pages to scrape per keyword×location combo
  /** Optional callback for per-search progress reporting */
  onSearchProgress?: (update: ScoutProgressUpdate) => void
}

/**
 * Run scout across ALL keyword × location combinations using PARALLEL fetch requests.
 *
 * PERFORMANCE: Uses fetch() + cheerio instead of Playwright page.goto().
 * This enables running 5 concurrent searches instead of sequential, cutting
 * LinkedIn scout time from ~10 min to ~2 min.
 *
 * For N keywords and M locations, runs N×M searches (each fetching `pagesPerSearch`
 * pages of 25 results). Deduplicates globally by URL and company+title.
 *
 * Falls back to Playwright-based sequential scout if fetch fails for all searches
 * (e.g., LinkedIn blocks fetch requests from the server IP).
 *
 * Example: 3 keywords × 3 locations × 3 pages = 27 API calls → up to 675 raw cards
 * After filtering & dedup, expect 40-80 unique candidates.
 */
export async function scoutJobsMultiPass(
  page: Page,
  searchProfile: SearchProfile,
  existingApplications: string[],
  multiPass: MultiPassConfig,
): Promise<ScoutResult> {
  const { keywords, locations, pagesPerSearch, onSearchProgress } = multiPass

  // Build the search matrix
  const combos: Array<{ keyword: string; location: string; index: number }> = []
  for (const kw of keywords) {
    for (const loc of locations) {
      combos.push({ keyword: kw, location: loc, index: combos.length })
    }
  }

  console.log(
    `[scout:multi-pass] Starting ${combos.length} PARALLEL fetch-based searches ` +
    `(${keywords.length} keywords × ${locations.length} locations × ${pagesPerSearch} pages)`,
  )

  let globalTotalFound = 0
  let globalFilteredOut = 0
  const allJobs: DiscoveredJob[] = []

  // Track seen URLs and company+title pairs across ALL passes for dedup
  const seenUrls = new Set<string>()
  const seenCompanyTitle = new Set<string>()

  // --- PARALLEL fetch-based scout with concurrency limiter ---
  // Run up to SCOUT_CONCURRENCY searches at once using fetch() + cheerio.
  // No browser page needed — pure HTTP requests.
  const SCOUT_CONCURRENCY = 5
  const queue = [...combos]
  let completedSearches = 0
  let fetchFailures = 0

  async function fetchWorker(): Promise<void> {
    while (queue.length > 0) {
      const combo = queue.shift()
      if (!combo) break

      const { keyword, location, index } = combo

      try {
        const result = await scoutJobsFetch(
          searchProfile,
          existingApplications,
          pagesPerSearch,
          keyword,
          location,
        )

        // Thread-safe dedup (single-threaded JS, but good practice)
        globalTotalFound += result.totalFound
        globalFilteredOut += result.filteredOut

        let newInThisPass = 0
        for (const job of result.jobs) {
          if (job.url && seenUrls.has(job.url)) continue
          const companyTitleKey = `${job.company.toLowerCase().trim()}|${job.title.toLowerCase().trim()}`
          if (seenCompanyTitle.has(companyTitleKey)) continue
          if (job.url) seenUrls.add(job.url)
          seenCompanyTitle.add(companyTitleKey)
          allJobs.push(job)
          newInThisPass++
        }

        completedSearches++
        console.log(
          `[scout:multi-pass] [${completedSearches}/${combos.length}] "${keyword}" × "${location}": ` +
          `${result.jobs.length} candidates, ${newInThisPass} new unique (total: ${allJobs.length})`,
        )

        // Report progress
        try {
          onSearchProgress?.({
            searchIndex: completedSearches - 1,
            totalSearches: combos.length,
            keyword,
            location,
            newJobsThisSearch: newInThisPass,
            totalUniqueJobs: allJobs.length,
          })
        } catch { /* Don't let callback errors crash the scout */ }

        // Small stagger between requests in the same worker to spread load
        await randomDelay(500, 1500)

      } catch (err) {
        completedSearches++
        fetchFailures++
        console.warn(
          `[scout:multi-pass] [${completedSearches}/${combos.length}] "${keyword}" × "${location}" FAILED: ${(err as Error).message}`,
        )

        // Report progress even on failure
        try {
          onSearchProgress?.({
            searchIndex: completedSearches - 1,
            totalSearches: combos.length,
            keyword,
            location,
            newJobsThisSearch: 0,
            totalUniqueJobs: allJobs.length,
          })
        } catch { /* Don't let callback errors crash the scout */ }
      }
    }
  }

  // Launch concurrent workers
  const workerCount = Math.min(SCOUT_CONCURRENCY, combos.length)
  console.log(`[scout:multi-pass] Launching ${workerCount} parallel fetch workers`)
  await Promise.all(Array.from({ length: workerCount }, () => fetchWorker()))

  // --- Fallback: if ALL fetch searches failed, try Playwright-based sequential scout ---
  if (fetchFailures === combos.length && combos.length > 0) {
    console.warn(
      `[scout:multi-pass] All ${combos.length} fetch-based searches failed. ` +
      `Falling back to Playwright-based sequential scout.`,
    )

    let currentPage = page
    let reconnectAttempts = 0
    const MAX_RECONNECT_ATTEMPTS = 2
    let browserDead = false

    for (let i = 0; i < combos.length; i++) {
      const { keyword, location } = combos[i]

      if (browserDead) {
        try {
          onSearchProgress?.({
            searchIndex: i,
            totalSearches: combos.length,
            keyword,
            location,
            newJobsThisSearch: 0,
            totalUniqueJobs: allJobs.length,
          })
        } catch { /* Don't let callback errors crash the scout */ }
        continue
      }

      try {
        const result = await Promise.race([
          scoutJobs(currentPage, searchProfile, existingApplications, pagesPerSearch, keyword, location),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Scout search timeout (90s)')), 90_000)
          ),
        ])

        globalTotalFound += result.totalFound
        globalFilteredOut += result.filteredOut

        let newInThisPass = 0
        for (const job of result.jobs) {
          if (job.url && seenUrls.has(job.url)) continue
          const companyTitleKey = `${job.company.toLowerCase().trim()}|${job.title.toLowerCase().trim()}`
          if (seenCompanyTitle.has(companyTitleKey)) continue
          if (job.url) seenUrls.add(job.url)
          seenCompanyTitle.add(companyTitleKey)
          allJobs.push(job)
          newInThisPass++
        }

        try {
          onSearchProgress?.({
            searchIndex: i, totalSearches: combos.length,
            keyword, location, newJobsThisSearch: newInThisPass, totalUniqueJobs: allJobs.length,
          })
        } catch { /* Don't let callback errors crash the scout */ }

        if (i < combos.length - 1) await randomDelay(2000, 4000)

      } catch (err) {
        if (isDeadConnectionError(err)) {
          if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++
            const reconnected = await reconnectSBR()
            if (reconnected) {
              currentPage = reconnected.page
              i-- // retry same combo
              continue
            }
          }
          browserDead = true
        }
        try {
          onSearchProgress?.({
            searchIndex: i, totalSearches: combos.length,
            keyword, location, newJobsThisSearch: 0, totalUniqueJobs: allJobs.length,
          })
        } catch { /* Don't let callback errors crash the scout */ }
      }
    }
  }

  console.log(
    `[scout:multi-pass] Complete: ${combos.length} searches (${fetchFailures} fetch failures), ` +
    `${globalTotalFound} total found, ${globalFilteredOut} filtered, ${allJobs.length} unique candidates`,
  )

  return {
    jobs: allJobs,
    totalFound: globalTotalFound,
    filteredOut: globalFilteredOut,
  }
}
