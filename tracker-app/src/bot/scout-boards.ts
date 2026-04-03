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

/**
 * US state abbreviations for detecting "City, XX" patterns in locations.
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
 */
function hasUSStateAbbrev(location: string): boolean {
  for (const state of US_STATE_ABBREVS) {
    const pattern = new RegExp(`,\\s*${state}(?:\\s*$|\\s*,|\\s+|\\))`)
    if (pattern.test(location)) {
      const lower = location.toLowerCase()
      const apacSafe = COMPATIBLE_TZ_KEYWORDS.some(kw => lower.includes(kw))
      if (!apacSafe) return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function isTimezoneCompatible(location: string): boolean {
  const lower = location.toLowerCase()

  if (INCOMPATIBLE_TZ_KEYWORDS.some(kw => lower.includes(kw))) {
    return false
  }

  // Reject if contains US state abbreviation pattern (e.g. "Palo Alto, CA")
  if (hasUSStateAbbrev(location)) {
    return false
  }

  // Reject short "US" patterns — "Remote, US", "US", "Remote (US)"
  if (/\bUS\b/.test(location) || /\bU\.S\.?\b/i.test(location)) {
    return false
  }

  if (COMPATIBLE_TZ_KEYWORDS.some(kw => lower.includes(kw))) {
    return true
  }

  // "Remote" alone without APAC signal — REJECT
  if (lower === 'remote' || lower === 'worldwide' || lower === 'anywhere') {
    return false
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

/** Non-product design disciplines — reject before Haiku */
const NON_PRODUCT_DESIGN_BLOCKLIST = [
  'graphic designer', 'graphic design',
  'generative ai', 'ai designer', 'ai artist',
  'motion designer', 'motion graphic', 'animation', 'animator',
  'video designer', 'video editor', 'brand designer',
  'creative director', 'art director', 'illustrat',
  'concept artist', '3d designer', '3d artist', 'game designer',
  'fashion designer', 'interior designer', 'content creator',
  'social media designer', 'social media', 'email designer',
  'packaging designer', 'packaging design', 'print designer',
  'bootcamp', 'participant', 'freelancers', 'branding',
]

/**
 * Allowlist — if title contains one of these, override the blocklist.
 * Prevents false positives on hybrid roles like "UX/Graphic Designer".
 */
const PRODUCT_DESIGN_ALLOWLIST = [
  'product', 'ux', 'ui', 'interaction', 'design system', 'design ops',
  'service design', 'content design', 'design technolog', 'design lead',
  'head of design', 'design manager', 'staff designer', 'principal designer',
  'design strategist',
]

function isDesignRole(title: string): boolean {
  const lower = title.toLowerCase()
  // Check if title has a product-design allowlist keyword
  const hasAllowlistKeyword = PRODUCT_DESIGN_ALLOWLIST.some(kw => lower.includes(kw))
  // Reject non-product design disciplines — unless allowlisted
  if (!hasAllowlistKeyword && NON_PRODUCT_DESIGN_BLOCKLIST.some(kw => lower.includes(kw))) {
    return false
  }
  return DESIGN_KEYWORDS.some(kw => lower.includes(kw))
}

/** Random delay between min and max ms */
function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Resolve a RemoteOK apply URL by following its /l/{id} redirect chain
 * server-side. RemoteOK's /l/{id} links redirect through obfuscated JS
 * and eventually land on `/sign-up?redirect_url=<ACTUAL_ATS_URL>`.
 *
 * This function uses server-side fetch with `redirect: 'manual'` to follow
 * 3xx redirects and extract the `redirect_url` query parameter from the
 * sign-up wall URL, or detect direct redirects to an external ATS domain.
 *
 * Returns the resolved ATS URL, or null if resolution fails.
 */
async function resolveRemoteOKApplyUrl(jobSlugOrId: string): Promise<string | null> {
  // Try both /l/{slug} and /l/{id} patterns
  const candidates = [
    `https://remoteok.com/l/${jobSlugOrId}`,
  ]

  // Also extract numeric ID from slug if present (e.g. "remote-ux-designer-123456" → "123456")
  const numericMatch = jobSlugOrId.match(/(\d+)$/)
  if (numericMatch && numericMatch[1] !== jobSlugOrId) {
    candidates.push(`https://remoteok.com/l/${numericMatch[1]}`)
  }

  for (const redirectUrl of candidates) {
    try {
      let currentUrl = redirectUrl
      let hops = 0
      const maxHops = 8

      while (hops < maxHops) {
        const response = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(8_000),
        })

        // Follow 3xx redirects
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          if (!location) break
          currentUrl = new URL(location, currentUrl).href
          hops++

          // Check if we've left remoteok.com (direct redirect to ATS)
          const hostname = new URL(currentUrl).hostname
          if (!hostname.includes('remoteok.com') && !hostname.includes('aiok.co')) {
            console.log(`[scout:remoteok] Resolved apply URL via redirect chain: ${currentUrl}`)
            return currentUrl
          }

          // Check if we hit the sign-up wall with redirect_url param
          const urlObj = new URL(currentUrl)
          const actualUrl = urlObj.searchParams.get('redirect_url')
            || urlObj.searchParams.get('redirect')
            || urlObj.searchParams.get('return_url')
            || urlObj.searchParams.get('url')
          if (actualUrl) {
            try {
              const decoded = decodeURIComponent(actualUrl)
              const parsed = new URL(decoded)
              if (!parsed.hostname.includes('remoteok.com')) {
                console.log(`[scout:remoteok] Extracted ATS URL from sign-up redirect_url: ${decoded}`)
                return decoded
              }
            } catch { /* invalid URL in param */ }
          }

          continue
        }

        // 2xx — we landed somewhere. Check if it's a sign-up page with redirect_url
        if (response.status >= 200 && response.status < 300) {
          const finalUrlObj = new URL(currentUrl)
          const actualUrl = finalUrlObj.searchParams.get('redirect_url')
            || finalUrlObj.searchParams.get('redirect')
            || finalUrlObj.searchParams.get('return_url')
            || finalUrlObj.searchParams.get('url')
          if (actualUrl) {
            try {
              const decoded = decodeURIComponent(actualUrl)
              const parsed = new URL(decoded)
              if (!parsed.hostname.includes('remoteok.com')) {
                console.log(`[scout:remoteok] Extracted ATS URL from sign-up page params: ${decoded}`)
                return decoded
              }
            } catch { /* invalid URL in param */ }
          }

          // Also try parsing response body for meta-refresh or JS redirects
          // (RemoteOK /l/ pages use obfuscated JS that builds a redirect URL)
          try {
            const body = await response.text()

            // Check for meta refresh: <meta http-equiv="refresh" content="0;url=...">
            const metaMatch = body.match(/content=["'][^"']*url=(https?:\/\/[^"'\s]+)/i)
            if (metaMatch) {
              const url = metaMatch[1]
              if (!url.includes('remoteok.com') && !url.includes('aiok.co')) {
                console.log(`[scout:remoteok] Found ATS URL in meta refresh: ${url}`)
                return url
              }
            }

            // Check for window.location redirects
            const jsMatch = body.match(/window\.location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/)
            if (jsMatch) {
              const url = jsMatch[1]
              if (!url.includes('remoteok.com') && !url.includes('aiok.co')) {
                console.log(`[scout:remoteok] Found ATS URL in JS redirect: ${url}`)
                return url
              }
            }

            // Check for ATS URLs anywhere in the response body
            const atsUrl = extractAtsUrlFromHtml(body)
            if (atsUrl) {
              console.log(`[scout:remoteok] Found ATS URL in /l/ page body: ${atsUrl}`)
              return atsUrl
            }
          } catch { /* body read failed — non-critical */ }
        }

        break
      }
    } catch (err) {
      console.log(`[scout:remoteok] Apply URL resolution failed for ${redirectUrl}: ${(err as Error).message}`)
    }
  }

  return null
}

/**
 * Extract a direct ATS URL from job description HTML.
 * RemoteOK descriptions often contain "Apply" links pointing directly
 * to Greenhouse, Lever, Workable, etc. — bypassing their broken
 * aiok.co tracking redirect.
 */
function extractAtsUrlFromHtml(html: string): string | null {
  const KNOWN_ATS_PATTERNS = [
    /https?:\/\/[a-z0-9-]+\.greenhouse\.io\/[^\s"'<]+/gi,
    /https?:\/\/boards\.greenhouse\.io\/[^\s"'<]+/gi,
    /https?:\/\/[a-z0-9-]+\.lever\.co\/[^\s"'<]+/gi,
    /https?:\/\/jobs\.lever\.co\/[^\s"'<]+/gi,
    /https?:\/\/[a-z0-9-]+\.workable\.com\/[^\s"'<]+/gi,
    /https?:\/\/[a-z0-9-]+\.breezy\.hr\/[^\s"'<]+/gi,
    /https?:\/\/[a-z0-9-]+\.ashbyhq\.com\/[^\s"'<]+/gi,
    /https?:\/\/[a-z0-9-]+\.recruitee\.com\/[^\s"'<]+/gi,
    /https?:\/\/[a-z0-9-]+\.smartrecruiters\.com\/[^\s"'<]+/gi,
    /https?:\/\/[a-z0-9-]+\.bamboohr\.com\/[^\s"'<]+/gi,
    /https?:\/\/[a-z0-9-]+\.myworkdayjobs\.com\/[^\s"'<]+/gi,
    /https?:\/\/[a-z0-9-]+\.jobvite\.com\/[^\s"'<]+/gi,
  ]

  for (const pattern of KNOWN_ATS_PATTERNS) {
    const match = html.match(pattern)
    if (match) {
      // Clean trailing HTML entities/punctuation
      const clean = match[0].replace(/[&;'"<>)}\]]+$/, '')
      console.log(`[scout:remoteok] Extracted ATS URL from description: ${clean}`)
      return clean
    }
  }

  // Fallback 1: look for href="..." containing /apply or /jobs/ or /career
  const hrefMatch = html.match(/href=["'](https?:\/\/[^"']+(?:\/apply|\/jobs\/|\/career)[^"']*?)["']/i)
  if (hrefMatch) {
    const url = hrefMatch[1]
    // Skip remoteok.com and tracking domain links
    if (!url.includes('remoteok.com') && !url.includes('aiok.co')) {
      console.log(`[scout:remoteok] Extracted apply URL from description href: ${url}`)
      return url
    }
  }

  // Fallback 2: plain-text URLs with /apply, /jobs/, /careers/ (not in href)
  // Catches "Apply at https://company.com/careers/role" in job descriptions
  const plainUrlMatch = html.match(/https?:\/\/[^\s"'<>]+(?:\/apply|\/jobs\/|\/careers\/)[^\s"'<>]*/i)
  if (plainUrlMatch) {
    const url = plainUrlMatch[0].replace(/[&;'"<>)}\]]+$/, '')
    if (!url.includes('remoteok.com') && !url.includes('aiok.co')) {
      console.log(`[scout:remoteok] Extracted apply URL from plain text: ${url}`)
      return url
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// ATS type classifier (exported for use in scout.ts and orchestrator)
// ---------------------------------------------------------------------------

/**
 * Classify the ATS type from a job URL by pattern matching on known domains.
 * Returns null if the URL doesn't match any known ATS pattern.
 */
export function classifyAtsFromUrl(url: string): string | null {
  if (!url) return null
  const lower = url.toLowerCase()
  if (lower.includes('lever.co') || lower.includes('jobs.lever')) return 'lever'
  if (lower.includes('greenhouse.io') || lower.includes('boards.greenhouse')) return 'greenhouse'
  if (lower.includes('ashbyhq.com')) return 'ashby'
  if (lower.includes('workable.com')) return 'workable'
  if (lower.includes('teamtailor.com')) return 'teamtailor'
  if (lower.includes('breezy.hr')) return 'breezy'
  if (lower.includes('linkedin.com/jobs')) return 'linkedin'
  return null
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

        // Filter: timezone — RemoteOK is remote-first, accept bare "Remote".
        // Only reject if explicit incompatible TZ signal (US/EU/LATAM).
        const locationLower = location.toLowerCase()
        const hasIncompatibleSignal = INCOMPATIBLE_TZ_KEYWORDS.some(kw => locationLower.includes(kw))
        if (hasIncompatibleSignal) continue

        // Filter: poker / gambling
        const titleLower = title.toLowerCase()
        if (titleLower.includes('poker') || titleLower.includes('gambling')) continue

        // Build URL — extract direct ATS link from description HTML if available.
        // If not found, try to resolve the real ATS URL from RemoteOK's /l/{id}
        // redirect chain (which goes through sign-up wall with redirect_url param).
        // Only fall back to the listing page URL as a last resort.
        const descHtml = job.description ?? ''
        const atsUrlFromDesc = extractAtsUrlFromHtml(descHtml)

        let jobUrl = atsUrlFromDesc ?? ''

        // If description didn't contain a direct ATS link, try resolving via /l/{id}
        // redirect chain (RemoteOK /l/ → sign-up?redirect_url=<ATS_URL>)
        if (!jobUrl) {
          const slugOrId = job.slug || job.id || ''
          if (slugOrId) {
            try {
              const resolvedUrl = await resolveRemoteOKApplyUrl(slugOrId)
              if (resolvedUrl) {
                jobUrl = resolvedUrl
                console.log(`[scout:remoteok] "${company}" — resolved ATS URL: ${resolvedUrl}`)
              }
              // Small delay between resolve calls to avoid rate-limiting
              await randomDelay(200, 600)
            } catch (resolveErr) {
              console.log(`[scout:remoteok] "${company}" — resolve failed: ${(resolveErr as Error).message}`)
            }
          }
        }

        // Final fallback: use the RemoteOK listing page URL
        // (the job-board-redirect adapter will try to resolve at apply time)
        if (!jobUrl) {
          jobUrl = job.url
            ? job.url
            : job.slug
              ? `https://remoteok.com/remote-jobs/${job.slug}`
              : job.id
                ? `https://remoteok.com/remote-jobs/${job.id}`
                : ''
        }

        if (!jobUrl) continue

        // Dedup by URL
        if (seenUrls.has(jobUrl)) continue
        seenUrls.add(jobUrl)

        // Dedup by company+title
        const companyTitleKey = `${normalizeForDedup(company)}|${normalizeForDedup(title)}`
        if (seenCompanyTitle.has(companyTitleKey)) continue
        seenCompanyTitle.add(companyTitleKey)

        // Strip HTML from RemoteOK description for direct use in qualifier
        const plainDesc = (job.description ?? '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 6000)

        allJobs.push({
          title,
          company,
          location,
          url: jobUrl,
          isEasyApply: false,
          postedDate: job.date ?? new Date().toISOString(),
          source: 'remoteok',
          description: plainDesc || undefined,
          ats: classifyAtsFromUrl(jobUrl) ?? undefined,
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
 * Shape of a Wellfound job extracted from the Apollo cache in __NEXT_DATA__.
 */
interface WellfoundApolloJob {
  title?: string
  slug?: string
  description?: string
  jobType?: string
  remote?: boolean
  liveStartAt?: number | string
  primaryRoleTitle?: string
  compensation?: string
  locationNames?: string | { type?: string; json?: string[] }
  // Reference to the parent startup node
  startup?: { id?: string; type?: string } | string
}

/**
 * Shape of a Wellfound startup/company from the Apollo cache.
 */
interface WellfoundApolloStartup {
  name?: string
  slug?: string
  companyUrl?: string
  companySize?: string
  highConcept?: string
  logoUrl?: string
  highlightedJobListings?: Array<{ id?: string; type?: string }>
}

/**
 * Extract jobs from Wellfound's __NEXT_DATA__ Apollo cache embedded in the page.
 * This is the reliable extraction method since Wellfound is a Next.js/Apollo SPA
 * and CSS selectors change frequently.
 */
function extractJobsFromApolloCache(nextDataJson: string): Array<{
  title: string
  company: string
  location: string
  url: string
  postedDate: string
  description?: string
}> {
  const results: Array<{
    title: string
    company: string
    location: string
    url: string
    postedDate: string
    description?: string
  }> = []

  try {
    const data = JSON.parse(nextDataJson)

    // Navigate to the Apollo state graph
    // Try multiple known paths (Wellfound has changed this over time)
    const apolloData: Record<string, any> =
      data?.props?.pageProps?.apolloState?.data ??
      data?.props?.pageProps?.apolloState ??
      data?.props?.pageProps?.__apollo_state__ ??
      data?.props?.pageProps?.urqlState ??
      {}

    if (Object.keys(apolloData).length === 0) {
      console.warn('[scout:wellfound] Apollo state empty or not found in __NEXT_DATA__')
      // Try to find jobs in alternative page props structures
      const pageProps = data?.props?.pageProps ?? {}
      if (pageProps.jobs || pageProps.jobListings || pageProps.seoLandingPage) {
        console.log('[scout:wellfound] Found alternative pageProps structure')
      }
      return results
    }

    // Index all startup/company nodes for quick lookup
    const startupMap = new Map<string, WellfoundApolloStartup>()
    for (const [key, value] of Object.entries(apolloData)) {
      if (
        key.startsWith('StartupResult:') ||
        key.startsWith('Startup:') ||
        (typeof value === 'object' && value !== null && (value as any).__typename === 'Startup')
      ) {
        startupMap.set(key, value as WellfoundApolloStartup)
      }
    }

    // Extract all job listing nodes
    for (const [key, value] of Object.entries(apolloData)) {
      if (
        !key.startsWith('JobListingSearchResult:') &&
        !key.startsWith('JobListing:') &&
        !(typeof value === 'object' && value !== null &&
          ((value as any).__typename === 'JobListingSearchResult' ||
           (value as any).__typename === 'JobListing'))
      ) {
        continue
      }

      const job = value as WellfoundApolloJob

      const title = job.title?.trim() ?? ''
      if (!title) continue

      const slug = job.slug ?? ''

      // --- Location ---
      let location = 'Remote'
      if (job.locationNames) {
        if (typeof job.locationNames === 'string') {
          // Could be a JSON string
          try {
            const parsed = JSON.parse(job.locationNames)
            if (Array.isArray(parsed)) {
              location = parsed.join(', ')
            } else if (parsed?.json && Array.isArray(parsed.json)) {
              location = parsed.json.join(', ')
            }
          } catch {
            location = job.locationNames
          }
        } else if (typeof job.locationNames === 'object') {
          // Typed object: { type: "json", json: ["City"] }
          if (Array.isArray(job.locationNames.json)) {
            location = job.locationNames.json.join(', ')
          }
        }
      }
      if (job.remote) {
        location = location === 'Remote' ? 'Remote' : `${location} (Remote)`
      }

      // --- Company ---
      let company = ''
      if (job.startup) {
        const startupRef = typeof job.startup === 'string'
          ? job.startup
          : job.startup?.id ?? ''
        if (startupRef && startupMap.has(startupRef)) {
          company = startupMap.get(startupRef)!.name?.trim() ?? ''
        }
      }
      // If company not found via direct ref, try to find startup that lists this job
      if (!company) {
        const jobKey = key
        for (const [, startup] of startupMap) {
          const highlighted = startup.highlightedJobListings ?? []
          for (const ref of highlighted) {
            const refId = typeof ref === 'string' ? ref : ref?.id
            if (refId === jobKey) {
              company = startup.name?.trim() ?? ''
              break
            }
          }
          if (company) break
        }
      }

      // --- URL ---
      const url = slug
        ? `https://wellfound.com/jobs/${slug}`
        : ''
      if (!url) continue

      // --- Posted date ---
      let postedDate = new Date().toISOString()
      if (job.liveStartAt) {
        if (typeof job.liveStartAt === 'number') {
          // Could be seconds or milliseconds
          const ts = job.liveStartAt > 1e12 ? job.liveStartAt : job.liveStartAt * 1000
          postedDate = new Date(ts).toISOString()
        } else if (typeof job.liveStartAt === 'string') {
          postedDate = new Date(job.liveStartAt).toISOString()
        }
      }

      // --- Description snippet ---
      const description = (job.description ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 6000) || undefined

      results.push({ title, company, location, url, postedDate, description })
    }
  } catch (err) {
    console.warn(`[scout:wellfound] Failed to parse __NEXT_DATA__: ${(err as Error).message}`)
  }

  return results
}

/**
 * Scout jobs from Wellfound (ex-AngelList Talent) by extracting data from
 * the Next.js __NEXT_DATA__ Apollo cache embedded in each page.
 * Requires a Playwright Page (ideally via Bright Data browser for anti-bot).
 *
 * Falls back to DOM scraping if __NEXT_DATA__ is unavailable.
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
    // Wellfound URL patterns:
    //   /role/{slug}           — role-only listing
    //   /role/l/{slug}/remote  — role + remote location filter
    // The old /role/r/ pattern is invalid and returns 404.
    const searchUrl = `https://wellfound.com/role/l/${slug}/remote`
    console.log(`[scout:wellfound] Navigating to: ${searchUrl}`)

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await randomDelay(2000, 4000)

      // --- Primary method: extract from __NEXT_DATA__ Apollo cache ---
      let cards = await page.evaluate(() => {
        const scriptEl = document.querySelector('script#__NEXT_DATA__')
        if (!scriptEl?.textContent) return null
        return scriptEl.textContent
      })

      let extractedCards: Array<{
        title: string
        company: string
        location: string
        url: string
        postedDate: string
        description?: string
      }> = []

      if (cards) {
        console.log(`[scout:wellfound] Found __NEXT_DATA__ for slug="${slug}", parsing Apollo cache...`)
        extractedCards = extractJobsFromApolloCache(cards)
        console.log(`[scout:wellfound] Apollo cache: extracted ${extractedCards.length} jobs for slug="${slug}"`)
      }

      // --- Fallback: scroll & scrape DOM if Apollo cache yielded nothing ---
      if (extractedCards.length === 0) {
        console.log(`[scout:wellfound] Apollo cache empty, falling back to DOM scraping for slug="${slug}"`)

        // Wait for any content to render
        await page.waitForSelector(
          'main, [id="__next"], [data-testid], [role="list"], [role="listitem"]',
          { timeout: 8_000 },
        ).catch(() => {})

        // Scroll to trigger lazy loading
        for (let i = 0; i < 5; i++) {
          await page.evaluate(
            (scrollY) => window.scrollBy(0, scrollY),
            600 + Math.floor(Math.random() * 300),
          )
          await randomDelay(800, 1500)
        }

        // Extract from DOM using broad, resilient selectors
        const domCards = await page.evaluate(() => {
          const results: Array<{
            title: string
            company: string
            location: string
            url: string
          }> = []

          // Strategy 1: Find all job-related links and extract surrounding context
          const jobLinks = document.querySelectorAll(
            'a[href*="/jobs/"], a[href*="/company/"], a[href*="/role/"]'
          )

          // Strategy 2: Find list items or card-like containers
          const listItems = document.querySelectorAll(
            '[role="listitem"], [data-testid*="job"], [data-testid*="listing"], ' +
            'article, [class*="card"], [class*="Card"], [class*="listing"], [class*="Listing"], ' +
            '[class*="result"], [class*="Result"]'
          )

          // Merge both sets of candidate elements
          const candidates = new Set<Element>([...Array.from(listItems)])

          // For job links, add their closest container
          for (const link of jobLinks) {
            const container =
              link.closest('article') ??
              link.closest('[role="listitem"]') ??
              link.closest('li') ??
              link.closest('div[class*="card"]') ??
              link.closest('div[class*="Card"]') ??
              link.closest('div[class*="result"]') ??
              link.closest('div[class*="Result"]') ??
              link.parentElement?.parentElement // go up 2 levels from the <a>
            if (container) {
              candidates.add(container)
            }
          }

          for (const card of candidates) {
            // --- Title: first heading or prominent text ---
            const titleEl =
              card.querySelector('h1, h2, h3, h4') ??
              card.querySelector('[class*="title" i], [class*="role" i]') ??
              card.querySelector('a[href*="/jobs/"]')
            let title = titleEl?.textContent?.trim() ?? ''
            if (!title) continue
            if (title.length > 120) title = title.substring(0, 120)

            // --- Company ---
            let company = ''
            // Look for a second heading or name-like element
            const headings = card.querySelectorAll('h1, h2, h3, h4, h5, h6')
            if (headings.length > 1) {
              company = headings[1].textContent?.trim() ?? ''
              if (company === title && headings.length > 2) {
                company = headings[2].textContent?.trim() ?? ''
              }
            }
            if (!company) {
              const companyEl =
                card.querySelector('[class*="company" i], [class*="startup" i], [class*="org" i]') ??
                card.querySelector('a[href*="/company/"]')
              company = companyEl?.textContent?.trim() ?? ''
            }
            if (company === title) company = ''

            // --- Location ---
            const locationEl =
              card.querySelector('[class*="location" i]') ??
              card.querySelector('[class*="meta" i], [class*="info" i]')
            const location = locationEl?.textContent?.trim() ?? 'Remote'

            // --- URL ---
            let url = ''
            const linkEl =
              (card.querySelector('a[href*="/jobs/"]') as HTMLAnchorElement) ??
              (card.querySelector('a[href*="/company/"]') as HTMLAnchorElement) ??
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

        for (const card of domCards) {
          extractedCards.push({
            ...card,
            postedDate: new Date().toISOString(),
          })
        }

        console.log(`[scout:wellfound] DOM fallback: extracted ${domCards.length} cards for slug="${slug}"`)
      }

      // --- Process extracted cards through filters ---
      for (const card of extractedCards) {
        const { title, company, location, description } = card
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
          postedDate: card.postedDate ?? new Date().toISOString(),
          source: 'wellfound',
          description,
          ats: classifyAtsFromUrl(url) ?? undefined,
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

// ---------------------------------------------------------------------------
// Himalayas.app scraper (JSON API — no Playwright needed)
// ---------------------------------------------------------------------------

/**
 * Raw shape returned by the Himalayas /jobs/api endpoint.
 */
interface HimalayasJob {
  title?: string
  excerpt?: string
  companyName?: string
  companySlug?: string
  companyLogo?: string
  employmentType?: string
  minSalary?: number | null
  maxSalary?: number | null
  seniority?: string[]
  currency?: string
  locationRestrictions?: string[]
  timezoneRestrictions?: number[]
  categories?: string[]
  parentCategories?: string[]
  description?: string
  pubDate?: number
  expiryDate?: number
  applicationLink?: string
  guid?: string
}

interface HimalayasApiResponse {
  comments?: string
  updatedAt?: number
  offset: number
  limit: number
  totalCount: number
  jobs: HimalayasJob[]
}

/**
 * Scout jobs from Himalayas.app using their public JSON API.
 * No Playwright page needed — uses plain fetch().
 *
 * The API supports timezone filtering natively (timezone=7 for GMT+7),
 * so we get pre-filtered results for Bangkok timezone compatibility.
 *
 * @param keywords - Search terms, e.g. ['product designer', 'ux designer']
 * @param excludedCompanies - Additional company names to exclude
 * @returns DiscoveredJob[] with source = 'himalayas'
 */
export async function scoutHimalayas(
  keywords: string[],
  excludedCompanies: string[] = [],
): Promise<DiscoveredJob[]> {
  const allJobs: DiscoveredJob[] = []
  const seenUrls = new Set<string>()
  const seenCompanyTitle = new Set<string>()

  const excluded = [...DEFAULT_EXCLUDED, ...excludedCompanies.map(c => c.toLowerCase())]

  const searchTerms = keywords.length > 0
    ? keywords
    : ['product designer', 'ux designer', 'ui designer', 'design lead', 'design system']

  for (const term of searchTerms) {
    let offset = 0
    const limit = 20
    let hasMore = true

    while (hasMore) {
      const apiUrl = `https://himalayas.app/jobs/api?q=${encodeURIComponent(term)}&timezone=7&sort=recent&limit=${limit}&offset=${offset}`
      console.log(`[scout:himalayas] Fetching: ${apiUrl}`)

      try {
        const response = await fetch(apiUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; JobScout/1.0)',
            'Accept': 'application/json',
          },
        })

        if (!response.ok) {
          console.warn(`[scout:himalayas] HTTP ${response.status} for term="${term}" offset=${offset}`)
          break
        }

        const data: HimalayasApiResponse = await response.json()
        const jobs = data.jobs ?? []
        console.log(`[scout:himalayas] Term "${term}" offset=${offset}: ${jobs.length} raw jobs (total: ${data.totalCount})`)

        if (jobs.length === 0) {
          hasMore = false
          break
        }

        for (const job of jobs) {
          const title = job.title?.trim() ?? ''
          const company = job.companyName?.trim() ?? ''

          // Skip if missing critical fields
          if (!title || !company) continue

          // Filter: design roles only
          if (!isDesignRole(title)) continue

          // Filter: excluded companies
          if (isExcludedCompany(company, excluded)) continue

          // Filter: poker / gambling
          const titleLower = title.toLowerCase()
          const companyLower = company.toLowerCase()
          if (
            titleLower.includes('poker') || titleLower.includes('gambling') ||
            companyLower.includes('poker') || companyLower.includes('gambling')
          ) continue

          // Build URL — prefer applicationLink, fallback to guid
          const jobUrl = job.applicationLink || job.guid || ''
          if (!jobUrl) continue

          // Dedup by URL
          if (seenUrls.has(jobUrl)) continue
          seenUrls.add(jobUrl)

          // Dedup by company+title
          const companyTitleKey = `${normalizeForDedup(company)}|${normalizeForDedup(title)}`
          if (seenCompanyTitle.has(companyTitleKey)) continue
          seenCompanyTitle.add(companyTitleKey)

          // Build location string from locationRestrictions
          const location = (job.locationRestrictions && job.locationRestrictions.length > 0)
            ? job.locationRestrictions.join(', ')
            : 'Remote'

          // Strip HTML from description for direct use in qualifier
          const plainDesc = (job.description ?? '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 6000)

          // Convert Unix epoch (seconds) to ISO date string
          const postedDate = job.pubDate
            ? new Date(job.pubDate * 1000).toISOString()
            : new Date().toISOString()

          allJobs.push({
            title,
            company,
            location,
            url: jobUrl,
            isEasyApply: false,
            postedDate,
            source: 'himalayas',
            description: plainDesc || undefined,
            ats: classifyAtsFromUrl(jobUrl) ?? undefined,
          })
        }

        // Paginate: stop after 3 pages per term (60 results) to avoid excessive API calls
        offset += limit
        if (offset >= 60 || jobs.length < limit) {
          hasMore = false
        }

        // Small delay between paginated requests to be polite
        await randomDelay(500, 1500)
      } catch (err) {
        console.warn(`[scout:himalayas] Error for term="${term}" offset=${offset}: ${(err as Error).message}`)
        hasMore = false
      }
    }

    // Small delay between search term queries
    await randomDelay(500, 1500)
  }

  console.log(`[scout:himalayas] Total unique design jobs: ${allJobs.length}`)
  return allJobs
}

// ---------------------------------------------------------------------------
// Remotive scraper (JSON API — no Playwright needed)
// ---------------------------------------------------------------------------

/**
 * Raw shape returned by the Remotive public API.
 */
interface RemotiveJob {
  id?: number
  url?: string
  title?: string
  company_name?: string
  category?: string
  candidate_required_location?: string
  publication_date?: string
  description?: string
  salary?: string
  tags?: string[]
}

interface RemotiveApiResponse {
  'api-version'?: string
  'job-count'?: number
  jobs: RemotiveJob[]
}

/**
 * Scout jobs from Remotive using their public JSON API.
 * No Playwright page needed — uses plain fetch().
 *
 * API: https://remotive.com/api/remote-jobs?category=design&search={keyword}
 *
 * @param keywords - Search terms, e.g. ['product designer', 'ux designer']
 * @param excludedCompanies - Additional company names to exclude
 * @returns DiscoveredJob[] with source = 'remotive'
 */
export async function scoutRemotive(
  keywords: string[],
  excludedCompanies: string[] = [],
): Promise<DiscoveredJob[]> {
  const allJobs: DiscoveredJob[] = []
  const seenUrls = new Set<string>()
  const seenCompanyTitle = new Set<string>()

  const excluded = [...DEFAULT_EXCLUDED, ...excludedCompanies.map(c => c.toLowerCase())]

  const searchTerms = keywords.length > 0
    ? keywords
    : ['product designer', 'ux designer', 'ui designer', 'design lead']

  for (const term of searchTerms) {
    const apiUrl = `https://remotive.com/api/remote-jobs?category=design&search=${encodeURIComponent(term)}`
    console.log(`[scout:remotive] Fetching: ${apiUrl}`)

    try {
      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; JobScout/1.0)',
          'Accept': 'application/json',
        },
      })

      if (!response.ok) {
        console.warn(`[scout:remotive] HTTP ${response.status} for term="${term}"`)
        continue
      }

      const data: RemotiveApiResponse = await response.json()
      const jobs = data.jobs ?? []
      console.log(`[scout:remotive] Term "${term}": ${jobs.length} raw jobs`)

      for (const job of jobs) {
        const title = job.title?.trim() ?? ''
        const company = job.company_name?.trim() ?? ''
        const location = job.candidate_required_location?.trim() || 'Remote'

        // Skip if missing critical fields
        if (!title || !company) continue

        // Filter: design roles only
        if (!isDesignRole(title)) continue

        // Filter: excluded companies
        if (isExcludedCompany(company, excluded)) continue

        // Filter: timezone — reject if location contains incompatible TZ keywords
        const locationLower = location.toLowerCase()
        const hasIncompatibleSignal = INCOMPATIBLE_TZ_KEYWORDS.some(kw => locationLower.includes(kw))
        if (hasIncompatibleSignal) continue

        // Reject US state abbreviation patterns (e.g. "San Francisco, CA")
        if (hasUSStateAbbrev(location)) continue

        // Reject short "US" patterns
        if (/\bUS\b/.test(location) || /\bU\.S\.?\b/i.test(location)) continue

        // Filter: poker / gambling
        const titleLower = title.toLowerCase()
        if (titleLower.includes('poker') || titleLower.includes('gambling')) continue

        // Build URL
        const jobUrl = job.url ?? ''
        if (!jobUrl) continue

        // Dedup by URL
        if (seenUrls.has(jobUrl)) continue
        seenUrls.add(jobUrl)

        // Dedup by company+title
        const companyTitleKey = `${normalizeForDedup(company)}|${normalizeForDedup(title)}`
        if (seenCompanyTitle.has(companyTitleKey)) continue
        seenCompanyTitle.add(companyTitleKey)

        // Strip HTML from description
        const plainDesc = (job.description ?? '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 6000)

        allJobs.push({
          title,
          company,
          location,
          url: jobUrl,
          isEasyApply: false,
          postedDate: job.publication_date ?? new Date().toISOString(),
          source: 'remotive',
          description: plainDesc || undefined,
          ats: classifyAtsFromUrl(jobUrl) ?? undefined,
        })
      }

      // Random delay between keyword fetches (500-1500ms)
      await randomDelay(500, 1500)
    } catch (err) {
      console.warn(`[scout:remotive] Error for term="${term}": ${(err as Error).message}`)
    }
  }

  console.log(`[scout:remotive] Total unique design jobs: ${allJobs.length}`)
  return allJobs
}

// ---------------------------------------------------------------------------
// We Work Remotely (WWR) scraper (RSS feed — no Playwright needed)
// ---------------------------------------------------------------------------

/**
 * Scout jobs from We Work Remotely using their public RSS feed.
 * No Playwright page needed — fetches RSS XML and parses with regex.
 *
 * RSS: https://weworkremotely.com/categories/remote-design-jobs.rss
 * WWR titles are formatted "Company: Job Title" — split on first ":".
 *
 * @param keywords - Search terms for post-fetch filtering (WWR RSS has no search param)
 * @param excludedCompanies - Additional company names to exclude
 * @returns DiscoveredJob[] with source = 'wwr'
 */
export async function scoutWWR(
  keywords: string[],
  excludedCompanies: string[] = [],
): Promise<DiscoveredJob[]> {
  const allJobs: DiscoveredJob[] = []
  const seenUrls = new Set<string>()
  const seenCompanyTitle = new Set<string>()

  const excluded = [...DEFAULT_EXCLUDED, ...excludedCompanies.map(c => c.toLowerCase())]

  const rssUrl = 'https://weworkremotely.com/categories/remote-design-jobs.rss'
  console.log(`[scout:wwr] Fetching RSS feed: ${rssUrl}`)

  try {
    // Use Bright Data residential proxy if available (WWR blocks datacenter IPs)
    const proxyAuth = (typeof process !== 'undefined' && process.env?.BRIGHTDATA_RESIDENTIAL_AUTH) || ''
    let response: Response

    if (proxyAuth) {
      console.log('[scout:wwr] Using Bright Data residential proxy')
      const proxyUrl = `http://${proxyAuth}@brd.superproxy.io:22225`
      // Use HTTP CONNECT via proxy — fetch through undici ProxyAgent if available,
      // otherwise fall back to direct fetch with proxy headers
      try {
        const { ProxyAgent } = await import('undici')
        const agent = new ProxyAgent(proxyUrl)
        response = await fetch(rssUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/rss+xml, application/xml, text/xml',
          },
          // @ts-expect-error -- undici dispatcher works with Node fetch
          dispatcher: agent,
        })
      } catch {
        console.warn('[scout:wwr] ProxyAgent failed, trying direct fetch')
        response = await fetch(rssUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/rss+xml, application/xml, text/xml',
          },
        })
      }
    } else {
      response = await fetch(rssUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml',
        },
      })
    }

    if (!response.ok) {
      console.warn(`[scout:wwr] HTTP ${response.status}`)
      return allJobs
    }

    const xml = await response.text()

    // Parse <item> blocks from RSS XML using regex (no external lib)
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi
    const items: string[] = []
    let itemMatch: RegExpExecArray | null
    while ((itemMatch = itemRegex.exec(xml)) !== null) {
      items.push(itemMatch[1])
    }

    console.log(`[scout:wwr] RSS feed: ${items.length} raw items`)

    for (const itemXml of items) {
      // Extract fields from each <item> block
      const extractTag = (tag: string): string => {
        const match = itemXml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'))
        return match ? match[1].trim() : ''
      }

      const rawTitle = extractTag('title')
      const link = extractTag('link')
      const pubDate = extractTag('pubDate')
      const rawDescription = extractTag('description')
      const region = extractTag('region')

      if (!rawTitle || !link) continue

      // WWR titles are "Company: Job Title" — split on first ":"
      let company = ''
      let title = rawTitle
      const colonIdx = rawTitle.indexOf(':')
      if (colonIdx > 0) {
        company = rawTitle.substring(0, colonIdx).trim()
        title = rawTitle.substring(colonIdx + 1).trim()
      }

      if (!title) continue

      // Filter: design roles only
      if (!isDesignRole(title)) continue

      // Filter: excluded companies
      if (company && isExcludedCompany(company, excluded)) continue

      // Filter: timezone — Use <region> tag as primary signal.
      // WWR region "Anywhere in the World" = accept (like RemoteOK bare "Remote").
      // If region is specific (e.g. "USA Only"), check against INCOMPATIBLE_TZ_KEYWORDS.
      const regionLower = region.toLowerCase()
      const isGlobalRemote = regionLower.includes('anywhere') || regionLower.includes('worldwide')

      if (!isGlobalRemote) {
        // Check region + title for incompatible TZ (skip description — too many false positives from US HQ addresses)
        const tzCheckText = `${region} ${title} ${company}`.toLowerCase()
        const hasIncompatibleSignal = INCOMPATIBLE_TZ_KEYWORDS.some(kw => tzCheckText.includes(kw))
        if (hasIncompatibleSignal) continue
        if (hasUSStateAbbrev(region)) continue
        if (/\bUS\b/.test(region) || /\bU\.S\.?\b/i.test(region)) continue
      }

      // Filter: poker / gambling
      const titleLower = title.toLowerCase()
      if (titleLower.includes('poker') || titleLower.includes('gambling')) continue

      // Dedup by URL
      if (seenUrls.has(link)) continue
      seenUrls.add(link)

      // Dedup by company+title
      if (company) {
        const companyTitleKey = `${normalizeForDedup(company)}|${normalizeForDedup(title)}`
        if (seenCompanyTitle.has(companyTitleKey)) continue
        seenCompanyTitle.add(companyTitleKey)
      }

      // Truncate description for qualifier
      const description = descPlain.slice(0, 6000) || undefined

      allJobs.push({
        title,
        company: company || 'Unknown Company',
        location: 'Remote',
        url: link,
        isEasyApply: false,
        postedDate: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        source: 'wwr',
        description,
        ats: classifyAtsFromUrl(link) ?? undefined,
      })
    }
  } catch (err) {
    console.warn(`[scout:wwr] Error fetching RSS: ${(err as Error).message}`)
  }

  console.log(`[scout:wwr] Total unique design jobs: ${allJobs.length}`)
  return allJobs
}

// ---------------------------------------------------------------------------
// Dribbble Jobs scraper (HTML — needs Playwright page)
// ---------------------------------------------------------------------------

/**
 * Scout jobs from Dribbble's job board by scraping their HTML listings.
 * Requires a Playwright Page for rendering (Dribbble has client-side rendering).
 *
 * URL: https://dribbble.com/jobs?keyword={keyword}&location=Anywhere
 *
 * @param page - Playwright Page instance
 * @param keywords - Search keywords, e.g. ['product designer', 'ux designer']
 * @param excludedCompanies - Additional company names to exclude
 * @returns DiscoveredJob[] with source = 'dribbble'
 */
export async function scoutDribbble(
  page: Page,
  keywords: string[],
  excludedCompanies: string[] = [],
): Promise<DiscoveredJob[]> {
  const allJobs: DiscoveredJob[] = []
  const seenUrls = new Set<string>()
  const seenCompanyTitle = new Set<string>()

  const excluded = [...DEFAULT_EXCLUDED, ...excludedCompanies.map(c => c.toLowerCase())]

  const searchTerms = keywords.length > 0
    ? keywords
    : ['product designer', 'ux designer', 'ui designer']

  for (const term of searchTerms) {
    const searchUrl = `https://dribbble.com/jobs?keyword=${encodeURIComponent(term)}&location=Anywhere`
    console.log(`[scout:dribbble] Navigating to: ${searchUrl}`)

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await randomDelay(2000, 4000)

      // Wait for job listing elements to appear
      await page.waitForSelector(
        '[class*="job"], [data-testid*="job"], article, [class*="listing"]',
        { timeout: 10_000 },
      ).catch(() => {
        console.log(`[scout:dribbble] No job card selectors found for term="${term}", trying broad extraction`)
      })

      // Extract job data from the DOM
      const cards = await page.evaluate(() => {
        const results: Array<{
          title: string
          company: string
          location: string
          url: string
        }> = []

        // Dribbble job cards — try multiple selector strategies
        const jobElements = document.querySelectorAll(
          // Known Dribbble job board selectors (may change over time)
          '[class*="job-card"], [class*="JobCard"], [class*="job-listing"], ' +
          '[class*="jobs-list"] li, [class*="JobsList"] li, ' +
          'a[href*="/jobs/"], article[class*="job"], ' +
          '[data-testid*="job"], [role="listitem"]'
        )

        // If no specific job elements, try broad link-based approach
        const elements = jobElements.length > 0
          ? Array.from(jobElements)
          : Array.from(document.querySelectorAll('a[href*="/jobs/"]')).map(
              link => link.closest('li') ?? link.closest('article') ?? link.closest('div') ?? link
            )

        const seenHrefs = new Set<string>()

        for (const el of elements) {
          // --- URL: find the job link ---
          const linkEl = (
            el.tagName === 'A' ? el : el.querySelector('a[href*="/jobs/"]')
          ) as HTMLAnchorElement | null
          const url = linkEl?.href ?? ''
          if (!url || !url.includes('/jobs/')) continue
          // Skip duplicate hrefs within this page
          if (seenHrefs.has(url)) continue
          seenHrefs.add(url)

          // --- Title: heading or link text ---
          const titleEl =
            el.querySelector('h1, h2, h3, h4, h5') ??
            el.querySelector('[class*="title" i], [class*="role" i], [class*="name" i]') ??
            linkEl
          let title = titleEl?.textContent?.trim() ?? ''
          if (!title) continue
          if (title.length > 150) title = title.substring(0, 150)

          // --- Company ---
          let company = ''
          const companyEl =
            el.querySelector('[class*="company" i], [class*="Company" i]') ??
            el.querySelector('[class*="org" i], [class*="employer" i]') ??
            el.querySelector('span[class*="meta" i], span[class*="info" i]')
          if (companyEl) {
            company = companyEl.textContent?.trim() ?? ''
          }
          // If company text equals title, it's likely not the company
          if (company === title) company = ''

          // --- Location ---
          const locationEl =
            el.querySelector('[class*="location" i], [class*="Location" i]') ??
            el.querySelector('[class*="where" i], [class*="place" i]')
          const location = locationEl?.textContent?.trim() ?? 'Anywhere'

          results.push({ title, company, location, url })
        }

        return results
      })

      console.log(`[scout:dribbble] Term "${term}": extracted ${cards.length} cards from DOM`)

      for (const card of cards) {
        const { title, company, location } = card
        let { url } = card

        // Ensure absolute URL
        if (url && !url.startsWith('http')) {
          url = `https://dribbble.com${url}`
        }

        // Strip tracking params
        if (url.includes('?')) {
          url = url.split('?')[0]
        }

        // Skip if missing critical fields
        if (!title || !url) continue

        // Filter: design roles (Dribbble is design-centric but still filter)
        if (!isDesignRole(title)) continue

        // Filter: excluded companies
        if (company && isExcludedCompany(company, excluded)) continue

        // Filter: timezone compatibility
        const locationLower = location.toLowerCase()
        // Accept "Anywhere" from Dribbble (design-focused remote board)
        const isAnywhere = locationLower === 'anywhere' || locationLower === 'remote' || locationLower === 'worldwide'
        if (!isAnywhere) {
          // Check for incompatible TZ signals
          const hasIncompatibleSignal = INCOMPATIBLE_TZ_KEYWORDS.some(kw => locationLower.includes(kw))
          if (hasIncompatibleSignal) continue

          // Reject US state abbreviation patterns
          if (hasUSStateAbbrev(location)) continue

          // Reject short "US" patterns
          if (/\bUS\b/.test(location) || /\bU\.S\.?\b/i.test(location)) continue
        }

        // Filter: poker / gambling
        const titleLower = title.toLowerCase()
        if (titleLower.includes('poker') || titleLower.includes('gambling')) continue

        // Dedup by URL
        if (seenUrls.has(url)) continue
        seenUrls.add(url)

        // Dedup by company+title
        if (company) {
          const companyTitleKey = `${normalizeForDedup(company)}|${normalizeForDedup(title)}`
          if (seenCompanyTitle.has(companyTitleKey)) continue
          seenCompanyTitle.add(companyTitleKey)
        }

        allJobs.push({
          title,
          company: company || 'Unknown Company',
          location: isAnywhere ? 'Remote' : location,
          url,
          isEasyApply: false,
          postedDate: new Date().toISOString(),
          source: 'dribbble',
          ats: classifyAtsFromUrl(url) ?? undefined,
        })
      }

      await randomDelay(2000, 4000)
    } catch (err) {
      console.warn(`[scout:dribbble] Error for term="${term}": ${(err as Error).message}`)
    }
  }

  console.log(`[scout:dribbble] Total unique design jobs: ${allJobs.length}`)
  return allJobs
}

// ---------------------------------------------------------------------------
// Jobicy scraper (JSON API — no Playwright needed)
// ---------------------------------------------------------------------------

/**
 * Raw shape of a single job from the Jobicy API response.
 */
interface JobicyJob {
  id?: number
  url?: string
  jobTitle?: string
  companyName?: string
  jobIndustry?: string
  jobType?: string
  jobGeo?: string
  jobLevel?: string
  jobExcerpt?: string
  pubDate?: string
}

/**
 * Response shape from the Jobicy /api/v2/remote-jobs endpoint.
 */
interface JobicyApiResponse {
  jobs: JobicyJob[]
}

/**
 * Scout jobs from Jobicy using their public JSON API.
 * No Playwright page needed — uses plain fetch().
 *
 * API: https://jobicy.com/api/v2/remote-jobs?count=50&tag={keyword}
 *
 * @param keywords - Search tags, e.g. ['product designer', 'ux designer']
 * @param excludedCompanies - Additional company names to exclude
 * @returns DiscoveredJob[] with source = 'jobicy'
 */
export async function scoutJobicy(
  keywords: string[],
  excludedCompanies: string[] = [],
): Promise<DiscoveredJob[]> {
  const allJobs: DiscoveredJob[] = []
  const seenUrls = new Set<string>()
  const seenCompanyTitle = new Set<string>()

  const excluded = [...DEFAULT_EXCLUDED, ...excludedCompanies.map(c => c.toLowerCase())]

  const searchTerms = keywords.length > 0
    ? keywords
    : ['product designer', 'ux designer', 'ui designer', 'design lead']

  for (const term of searchTerms) {
    const apiUrl = `https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(term)}`
    console.log(`[scout:jobicy] Fetching: ${apiUrl}`)

    try {
      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; JobScout/1.0)',
          'Accept': 'application/json',
        },
      })

      if (!response.ok) {
        console.warn(`[scout:jobicy] HTTP ${response.status} for term="${term}"`)
        continue
      }

      const data: JobicyApiResponse = await response.json()
      const jobs = data.jobs ?? []
      console.log(`[scout:jobicy] Term "${term}": ${jobs.length} raw jobs`)

      for (const job of jobs) {
        const title = job.jobTitle?.trim() ?? ''
        const company = job.companyName?.trim() ?? ''
        const location = job.jobGeo?.trim() || 'Remote'

        // Skip if missing critical fields
        if (!title || !company) continue

        // Filter: design roles only
        if (!isDesignRole(title)) continue

        // Filter: excluded companies
        if (isExcludedCompany(company, excluded)) continue

        // Filter: timezone — reject if jobGeo contains incompatible TZ keywords
        const locationLower = location.toLowerCase()
        const hasIncompatibleSignal = INCOMPATIBLE_TZ_KEYWORDS.some(kw => locationLower.includes(kw))
        if (hasIncompatibleSignal) continue

        // Reject US state abbreviation patterns (e.g. "San Francisco, CA")
        if (hasUSStateAbbrev(location)) continue

        // Reject short "US" patterns
        if (/\bUS\b/.test(location) || /\bU\.S\.?\b/i.test(location)) continue

        // Filter: poker / gambling
        const titleLower = title.toLowerCase()
        const companyLower = company.toLowerCase()
        if (
          titleLower.includes('poker') || titleLower.includes('gambling') ||
          companyLower.includes('poker') || companyLower.includes('gambling')
        ) continue

        // Build URL
        const jobUrl = job.url ?? ''
        if (!jobUrl) continue

        // Dedup by URL
        if (seenUrls.has(jobUrl)) continue
        seenUrls.add(jobUrl)

        // Dedup by company+title
        const companyTitleKey = `${normalizeForDedup(company)}|${normalizeForDedup(title)}`
        if (seenCompanyTitle.has(companyTitleKey)) continue
        seenCompanyTitle.add(companyTitleKey)

        // Strip HTML from jobExcerpt
        const plainDesc = (job.jobExcerpt ?? '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 6000)

        allJobs.push({
          title,
          company,
          location,
          url: jobUrl,
          isEasyApply: false,
          postedDate: job.pubDate ?? new Date().toISOString(),
          source: 'jobicy',
          description: plainDesc || undefined,
          ats: classifyAtsFromUrl(jobUrl) ?? undefined,
        })
      }

      // Random delay between keyword fetches (500-1500ms)
      await randomDelay(500, 1500)
    } catch (err) {
      console.warn(`[scout:jobicy] Error for term="${term}": ${(err as Error).message}`)
    }
  }

  console.log(`[scout:jobicy] Total unique design jobs: ${allJobs.length}`)
  return allJobs
}
