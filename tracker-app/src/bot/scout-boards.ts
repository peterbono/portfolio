import type { Page } from 'playwright'
import type { DiscoveredJob } from './scout'

// ---------------------------------------------------------------------------
// Constants (shared with scout.ts logic)
// ---------------------------------------------------------------------------

/** Companies that must never appear in results */
const DEFAULT_EXCLUDED = [
  'betrivers',
  'rush street interactive',
  'clickout media',
]

/**
 * Timezone-compatible location keywords for GMT+7 (+/-4h = UTC+3..UTC+11).
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
  'remote', 'apac', 'asia', 'asia-pacific', 'anywhere', 'worldwide',
]

/** Keywords that signal an incompatible US/EU timezone requirement */
const INCOMPATIBLE_TZ_KEYWORDS = [
  'est', 'cst', 'pst', 'mst', 'eastern', 'pacific', 'central time',
  'cet', 'gmt+0', 'gmt+1', 'gmt+2', 'utc+0', 'utc+1', 'utc+2',
]

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function isTimezoneCompatible(location: string): boolean {
  const lower = location.toLowerCase()

  if (INCOMPATIBLE_TZ_KEYWORDS.some(kw => lower.includes(kw))) {
    return false
  }

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

function normalizeForDedup(str: string): string {
  return str.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '')
}

function isExcludedCompany(company: string, excluded: string[]): boolean {
  const norm = normalizeForDedup(company)
  return excluded.some(ex => norm.includes(normalizeForDedup(ex)))
}

/** Design-related keywords to filter job results */
const DESIGN_KEYWORDS = [
  'design', 'designer', 'ux', 'ui', 'product design', 'visual',
  'interaction', 'user experience', 'user interface', 'figma',
  'design system', 'creative', 'brand', 'graphic',
]

function isDesignRole(title: string): boolean {
  const lower = title.toLowerCase()
  return DESIGN_KEYWORDS.some(kw => lower.includes(kw))
}

/** Random delay between min and max ms */
function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// RemoteOK scraper (JSON API — no Playwright needed)
// ---------------------------------------------------------------------------

/**
 * Raw shape returned by the RemoteOK JSON API.
 * The first element in the array is a metadata/legal object; actual jobs start
 * at index 1.
 */
interface RemoteOKJob {
  slug?: string
  id?: string
  epoch?: number
  date?: string
  company?: string
  company_logo?: string
  position?: string
  tags?: string[]
  logo?: string
  description?: string
  location?: string
  salary_min?: number
  salary_max?: number
  url?: string
  apply_url?: string
  original?: boolean
}

/**
 * Scout jobs from RemoteOK using their public JSON API.
 * No Playwright page needed — uses plain fetch().
 *
 * @param keywords - Search tags, e.g. ['design', 'ux', 'product-designer']
 * @param excludedCompanies - Additional company names to exclude
 * @returns DiscoveredJob[] with source = 'remoteok'
 */
export async function scoutRemoteOK(
  keywords: string[],
  excludedCompanies: string[] = [],
): Promise<DiscoveredJob[]> {
  const allJobs: DiscoveredJob[] = []
  const seenUrls = new Set<string>()
  const seenCompanyTitle = new Set<string>()

  const excluded = [...DEFAULT_EXCLUDED, ...excludedCompanies.map(c => c.toLowerCase())]

  // RemoteOK supports one tag at a time, so we iterate keywords
  const tags = keywords.length > 0 ? keywords : ['design']

  for (const tag of tags) {
    const apiUrl = `https://remoteok.com/api?tag=${encodeURIComponent(tag)}&location=remote`
    console.log(`[scout:remoteok] Fetching: ${apiUrl}`)

    try {
      const response = await fetch(apiUrl, {
        headers: {
          // RemoteOK requires a User-Agent or it may return 403
          'User-Agent': 'Mozilla/5.0 (compatible; JobScout/1.0)',
          'Accept': 'application/json',
        },
      })

      if (!response.ok) {
        console.warn(`[scout:remoteok] HTTP ${response.status} for tag="${tag}"`)
        continue
      }

      const data: RemoteOKJob[] = await response.json()

      // First element is metadata/legal notice — skip it
      const jobs = data.slice(1)
      console.log(`[scout:remoteok] Tag "${tag}": ${jobs.length} raw jobs`)

      for (const job of jobs) {
        const title = job.position?.trim() ?? ''
        const company = job.company?.trim() ?? ''
        const location = job.location?.trim() || 'Remote'

        // Skip if missing critical fields
        if (!title || !company) continue

        // Filter: design roles only
        if (!isDesignRole(title)) continue

        // Filter: excluded companies
        if (isExcludedCompany(company, excluded)) continue

        // Filter: timezone compatibility
        if (!isTimezoneCompatible(location)) continue

        // Filter: poker / gambling
        const titleLower = title.toLowerCase()
        if (titleLower.includes('poker') || titleLower.includes('gambling')) continue

        // Build URL
        const jobUrl = job.url
          ? job.url
          : job.slug
            ? `https://remoteok.com/remote-jobs/${job.slug}`
            : job.id
              ? `https://remoteok.com/remote-jobs/${job.id}`
              : ''

        if (!jobUrl) continue

        // Dedup by URL
        if (seenUrls.has(jobUrl)) continue
        seenUrls.add(jobUrl)

        // Dedup by company+title
        const companyTitleKey = `${normalizeForDedup(company)}|${normalizeForDedup(title)}`
        if (seenCompanyTitle.has(companyTitleKey)) continue
        seenCompanyTitle.add(companyTitleKey)

        allJobs.push({
          title,
          company,
          location,
          url: jobUrl,
          isEasyApply: false,
          postedDate: job.date ?? new Date().toISOString(),
          source: 'remoteok',
        })
      }

      // Small delay between tag queries to be polite
      await randomDelay(500, 1500)
    } catch (err) {
      console.warn(`[scout:remoteok] Error for tag="${tag}": ${(err as Error).message}`)
    }
  }

  console.log(`[scout:remoteok] Total unique design jobs: ${allJobs.length}`)
  return allJobs
}

// ---------------------------------------------------------------------------
// Wellfound (ex-AngelList) scraper (Playwright needed — React SPA)
// ---------------------------------------------------------------------------

/**
 * Role slug paths to search on Wellfound.
 * Each keyword maps to one or more URL slugs.
 */
const WELLFOUND_ROLE_SLUGS: Record<string, string[]> = {
  'product designer': ['product-designer'],
  'ux designer': ['ux-designer'],
  'ui designer': ['ui-ux-designer'],
  'design': ['designer', 'product-designer', 'ux-designer'],
  'visual designer': ['visual-designer'],
  'interaction designer': ['interaction-designer'],
  'design system': ['product-designer', 'ux-designer'],
  'lead designer': ['design-lead'],
  'staff designer': ['product-designer'],
  'principal designer': ['product-designer'],
}

/**
 * Scout jobs from Wellfound (ex-AngelList Talent) by scraping their React SPA.
 * Requires a Playwright Page (ideally via Bright Data browser for anti-bot).
 *
 * @param page - Playwright Page instance (Bright Data or local browser)
 * @param keywords - Search keywords, e.g. ['product designer', 'ux designer']
 * @param excludedCompanies - Additional company names to exclude
 * @returns DiscoveredJob[] with source = 'wellfound'
 */
export async function scoutWellfound(
  page: Page,
  keywords: string[],
  excludedCompanies: string[] = [],
): Promise<DiscoveredJob[]> {
  const allJobs: DiscoveredJob[] = []
  const seenUrls = new Set<string>()
  const seenCompanyTitle = new Set<string>()

  const excluded = [...DEFAULT_EXCLUDED, ...excludedCompanies.map(c => c.toLowerCase())]

  // Build list of role slugs to visit
  const slugsToVisit = new Set<string>()
  const searchKeywords = keywords.length > 0 ? keywords : ['product designer', 'ux designer']

  for (const kw of searchKeywords) {
    const kwLower = kw.toLowerCase()
    const slugs = WELLFOUND_ROLE_SLUGS[kwLower] ?? WELLFOUND_ROLE_SLUGS['design'] ?? ['product-designer']
    for (const slug of slugs) {
      slugsToVisit.add(slug)
    }
  }

  for (const slug of slugsToVisit) {
    // Wellfound role pages with remote filter
    const searchUrl = `https://wellfound.com/role/r/${slug}/remote`
    console.log(`[scout:wellfound] Navigating to: ${searchUrl}`)

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await randomDelay(2000, 4000)

      // Wait for job cards to render (React SPA)
      await page.waitForSelector(
        '[class*="styles_jobCard"], [class*="JobCard"], [data-test="job-card"], .job-list-item, [class*="StartupResult"], [class*="styles_result"]',
        { timeout: 10_000 },
      ).catch(() => {
        console.warn(`[scout:wellfound] No job cards selector found for slug="${slug}"`)
      })

      // Scroll down to load more results (lazy-loaded React list)
      for (let i = 0; i < 5; i++) {
        await page.evaluate(
          (scrollY) => window.scrollBy(0, scrollY),
          600 + Math.floor(Math.random() * 300),
        )
        await randomDelay(800, 1500)
      }

      // Extract job cards from the React-rendered DOM
      const cards = await page.evaluate(() => {
        const results: Array<{
          title: string
          company: string
          location: string
          url: string
        }> = []

        // Wellfound renders job cards in various structures; try multiple selectors
        const cardSelectors = [
          // Modern Wellfound layout (2024+)
          '[class*="styles_jobCard"]',
          '[class*="JobCard"]',
          '[data-test="job-card"]',
          '.job-list-item',
          // Startup result cards
          '[class*="StartupResult"]',
          '[class*="styles_result"]',
          // Fallback: any job listing link structure
          'a[href*="/jobs/"]',
        ]

        let cardElements: Element[] = []
        for (const selector of cardSelectors) {
          const found = document.querySelectorAll(selector)
          if (found.length > 0) {
            cardElements = Array.from(found)
            break
          }
        }

        // If no structured cards found, try to extract from links
        if (cardElements.length === 0) {
          const jobLinks = document.querySelectorAll('a[href*="/jobs/"], a[href*="/role/"]')
          cardElements = Array.from(jobLinks)
        }

        for (const card of cardElements) {
          // --- Title ---
          const titleEl =
            card.querySelector('h2, h3, h4') ??
            card.querySelector('[class*="title"], [class*="Title"]') ??
            card.querySelector('[class*="jobTitle"], [class*="role"]')
          let title = titleEl?.textContent?.trim() ?? ''

          // If the card is an <a> tag itself, title might be in text
          if (!title && card.tagName === 'A') {
            title = card.textContent?.trim()?.substring(0, 80) ?? ''
          }

          // --- Company ---
          const companyEl =
            card.querySelector('[class*="company"], [class*="Company"]') ??
            card.querySelector('[class*="startup"], [class*="Startup"]') ??
            card.querySelector('h3, h4') // often second heading is company
          let company = companyEl?.textContent?.trim() ?? ''

          // Avoid using title text as company
          if (company === title) {
            const allHeadings = card.querySelectorAll('h2, h3, h4, span[class*="name"]')
            for (const h of allHeadings) {
              const text = h.textContent?.trim() ?? ''
              if (text && text !== title) {
                company = text
                break
              }
            }
          }

          // --- Location ---
          const locationEl =
            card.querySelector('[class*="location"], [class*="Location"]') ??
            card.querySelector('[class*="meta"], [class*="info"]') ??
            card.querySelector('span[class*="tag"]')
          const location = locationEl?.textContent?.trim() ?? 'Remote'

          // --- URL ---
          let url = ''
          const linkEl =
            (card.querySelector('a[href*="/jobs/"]') as HTMLAnchorElement) ??
            (card.querySelector('a[href*="/role/"]') as HTMLAnchorElement) ??
            (card.closest('a') as HTMLAnchorElement) ??
            (card.tagName === 'A' ? card as HTMLAnchorElement : null)
          if (linkEl?.href) {
            url = linkEl.href
          }

          if (title && url) {
            results.push({ title, company, location, url })
          }
        }

        return results
      })

      console.log(`[scout:wellfound] Slug "${slug}": extracted ${cards.length} cards`)

      for (const card of cards) {
        const { title, company, location } = card
        let { url } = card

        // Ensure absolute URL
        if (url && !url.startsWith('http')) {
          url = `https://wellfound.com${url}`
        }

        // Clean tracking params
        if (url.includes('?')) {
          url = url.split('?')[0]
        }

        // Skip if missing critical fields
        if (!title) continue

        // Filter: design roles
        if (!isDesignRole(title)) continue

        // Filter: excluded companies
        if (company && isExcludedCompany(company, excluded)) continue

        // Filter: timezone compatibility
        if (!isTimezoneCompatible(location)) continue

        // Filter: poker / gambling
        const titleLower = title.toLowerCase()
        if (titleLower.includes('poker') || titleLower.includes('gambling')) continue

        // Dedup by URL
        if (url && seenUrls.has(url)) continue
        if (url) seenUrls.add(url)

        // Dedup by company+title
        if (company) {
          const companyTitleKey = `${normalizeForDedup(company)}|${normalizeForDedup(title)}`
          if (seenCompanyTitle.has(companyTitleKey)) continue
          seenCompanyTitle.add(companyTitleKey)
        }

        allJobs.push({
          title,
          company: company || 'Unknown Startup',
          location,
          url,
          isEasyApply: false,
          postedDate: new Date().toISOString(),
          source: 'wellfound',
        })
      }

      await randomDelay(2000, 4000)
    } catch (err) {
      console.warn(`[scout:wellfound] Error for slug="${slug}": ${(err as Error).message}`)
    }
  }

  console.log(`[scout:wellfound] Total unique design jobs: ${allJobs.length}`)
  return allJobs
}
