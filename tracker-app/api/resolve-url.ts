import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * API route: /api/resolve-url
 *
 * Resolves job board URLs (weworkremotely.com, remoteok.com, dribbble.com, etc.)
 * to their actual ATS URLs (greenhouse.io, lever.co, etc.) server-side.
 *
 * Called by the dashboard (bot-api.ts) before sending jobs to the Chrome extension,
 * because job board → ATS resolution requires HTTP redirects and HTML fetching
 * that can't reliably run in the browser due to CORS.
 *
 * Query params:
 *   - url (required): the job board URL to resolve
 *   - company (optional): company name for ATS probing fallback
 *   - role (optional): role title for specific job matching on career pages
 *
 * Returns: { resolvedUrl: string, wasResolved: boolean }
 */

// Known job board patterns (mirrors JOB_BOARD_PATTERNS from job-board-redirect.ts)
const JOB_BOARD_PATTERNS = [
  /remoteok\.com/i,
  /himalayas\.app/i,
  /wellfound\.com/i,
  /weworkremotely\.com/i,
  /remotive\.com/i,
  /dribbble\.com/i,
  /jobicy\.com/i,
]

// Known ATS domains — if the URL already points to one, skip resolution
const KNOWN_ATS_DOMAINS = [
  'greenhouse.io', 'lever.co', 'workable.com', 'breezy.hr',
  'ashbyhq.com', 'recruitee.com', 'smartrecruiters.com',
  'bamboohr.com', 'myworkdayjobs.com', 'icims.com',
  'jobvite.com', 'teamtailor.com', 'linkedin.com',
]

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

function isJobBoardUrl(url: string): boolean {
  return JOB_BOARD_PATTERNS.some(p => p.test(url))
}

function isAlreadyAts(url: string): boolean {
  try {
    const hostname = new URL(url).hostname
    return KNOWN_ATS_DOMAINS.some(ats => hostname.includes(ats))
  } catch {
    return false
  }
}

/** Extract ATS URLs from raw HTML (href attributes) */
function extractAtsUrlFromHtml(html: string): string | null {
  const hrefRegex = /href=["'](https?:\/\/[^"']+)["']/gi
  let match: RegExpExecArray | null
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1]
    try {
      const hostname = new URL(href).hostname
      if (KNOWN_ATS_DOMAINS.some(ats => hostname.includes(ats))) {
        return href.replace(/[&;'"<>)}\]]+$/, '') // trim trailing junk
      }
    } catch { /* skip invalid URLs */ }
  }
  return null
}

/** Follow HTTP redirect chain (HEAD then GET fallback), max 10 hops */
async function resolveRedirectChain(url: string, maxHops = 10): Promise<string | null> {
  let currentUrl = url
  let hops = 0
  let reachable = false
  const chainStart = Date.now()
  const CHAIN_TIMEOUT = 20_000

  while (hops < maxHops) {
    if (Date.now() - chainStart > CHAIN_TIMEOUT) break
    try {
      const response = await fetch(currentUrl, {
        method: 'HEAD',
        redirect: 'manual',
        headers: { 'User-Agent': UA, 'Accept': 'text/html' },
        signal: AbortSignal.timeout(8_000),
      })
      reachable = true
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) break
        currentUrl = new URL(location, currentUrl).href
        hops++
        continue
      }
      break
    } catch {
      if (!reachable) {
        try {
          const response = await fetch(currentUrl, {
            method: 'GET',
            redirect: 'follow',
            headers: { 'User-Agent': UA },
            signal: AbortSignal.timeout(10_000),
          })
          reachable = true
          if (response.url && response.url !== currentUrl) {
            currentUrl = response.url
          }
        } catch {
          return null
        }
      }
      break
    }
  }

  if (!reachable) return null

  // Extract real URL from sign-up walls (e.g. RemoteOK /sign-up?redirect_url=...)
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
        if (parsed.hostname !== finalUrlObj.hostname) return decoded
      }
    }
  } catch { /* URL parsing failed */ }

  return currentUrl
}

/** Probe common ATS platforms for a company's career page */
async function probeCompanyAtsPages(companyName: string, roleTitle?: string): Promise<string | null> {
  const raw = companyName.toLowerCase().replace(/['']/g, '')
  const slugs = new Set<string>()
  const baseSlug = raw.replace(/[^a-z0-9]+/g, '')
  const dashSlug = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  slugs.add(baseSlug)
  slugs.add(dashSlug)
  slugs.add(baseSlug + 'careers')

  const noSuffix = raw.replace(/\s+(labs?|inc|co|hq|io|ai|corp|group|tech|digital)\s*$/i, '')
  if (noSuffix !== raw) {
    slugs.add(noSuffix.replace(/[^a-z0-9]+/g, ''))
    slugs.add(noSuffix.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  }
  const firstWord = raw.split(/[^a-z0-9]+/)[0]
  if (firstWord && firstWord.length >= 3 && firstWord !== baseSlug) {
    slugs.add(firstWord)
  }

  const ATS_TEMPLATES = [
    'https://job-boards.greenhouse.io/{slug}',
    'https://boards.greenhouse.io/{slug}',
    'https://jobs.lever.co/{slug}',
    'https://jobs.ashbyhq.com/{slug}',
    'https://apply.workable.com/{slug}/',
    'https://{slug}.breezy.hr',
    'https://careers.smartrecruiters.com/{slug}',
  ]

  const PROBE_TIMEOUT = 20_000
  const probeStart = Date.now()

  for (const slug of slugs) {
    if (Date.now() - probeStart > PROBE_TIMEOUT) break
    for (const template of ATS_TEMPLATES) {
      if (Date.now() - probeStart > PROBE_TIMEOUT) break
      const url = template.replace('{slug}', slug)
      try {
        const response = await fetch(url, {
          method: 'HEAD',
          redirect: 'follow',
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(5_000),
        })
        if (response.ok) {
          const careerPageUrl = response.url || url
          // Try to find specific job if role title given
          if (roleTitle) {
            const specificJob = await findJobOnCareerPage(careerPageUrl, roleTitle)
            if (specificJob) return specificJob
          }
          // Return career page as fallback only for known ATS domains
          if (careerPageUrl.includes('greenhouse') || careerPageUrl.includes('lever')
              || careerPageUrl.includes('ashby') || careerPageUrl.includes('workable')) {
            return careerPageUrl
          }
        }
      } catch { /* skip */ }
    }
  }

  return null
}

/** Find a specific job on a career page by matching role title */
async function findJobOnCareerPage(careerPageUrl: string, roleTitle: string): Promise<string | null> {
  try {
    const response = await fetch(careerPageUrl, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) return null
    const html = await response.text()

    const INDUSTRY_TERMS = new Set(['ux', 'ui', 'ai', 'qa', 'pm', 'vp', 'hr', 'sr', 'cx', 'dx', 'ml'])
    const roleWords = roleTitle.toLowerCase()
      .split(/[\s/,\-–—·•]+/)
      .filter(w => (w.length >= 3 || INDUSTRY_TERMS.has(w)) && !['the', 'and', 'for', 'with', 'at', 'in', 'of'].includes(w))
    if (roleWords.length === 0) return null
    const minScore = Math.max(1, Math.ceil(roleWords.length / 2))

    const linkRegex = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    let bestMatch: { url: string; score: number } | null = null
    let match: RegExpExecArray | null

    while ((match = linkRegex.exec(html)) !== null) {
      const href = match[1]
      const text = match[2].replace(/<[^>]+>/g, '').trim().toLowerCase()
      if (!text || text.length < 3) continue

      const score = roleWords.filter(w => text.includes(w)).length
      if (score >= minScore && (!bestMatch || score > bestMatch.score)) {
        try {
          const absoluteUrl = new URL(href, careerPageUrl).href
          const urlHost = new URL(absoluteUrl).hostname
          const baseHost = new URL(careerPageUrl).hostname
          if (urlHost === baseHost || urlHost.includes('greenhouse') || urlHost.includes('lever')
              || urlHost.includes('ashby') || urlHost.includes('workable')) {
            bestMatch = { url: absoluteUrl, score }
          }
        } catch { /* skip */ }
      }
    }

    return bestMatch?.url ?? null
  } catch {
    return null
  }
}

/**
 * Main resolution logic (mirrors resolveJobBoardUrlServerSide from job-board-redirect.ts)
 */
async function resolveUrl(url: string, meta?: { company?: string; role?: string }): Promise<string> {
  // Already an ATS URL — no resolution needed
  if (isAlreadyAts(url)) return url

  // Not a job board URL — return as-is
  if (!isJobBoardUrl(url)) return url

  console.log(`[resolve-url] Resolving job board URL: ${url}`)

  // Strategy 1: Fetch page HTML and scan for embedded ATS URLs (Jobicy, Dribbble, WWR)
  if (/jobicy\.com|dribbble\.com|weworkremotely\.com/i.test(url)) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html' },
        signal: AbortSignal.timeout(10_000),
      })
      if (response.ok) {
        const html = await response.text()
        const atsUrl = extractAtsUrlFromHtml(html)
        if (atsUrl) {
          console.log(`[resolve-url] Found ATS URL in page HTML: ${atsUrl}`)
          return atsUrl
        }
      }
    } catch (err) {
      console.log(`[resolve-url] HTML fetch failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  // Strategy 2: Follow HTTP redirect chain (Remotive, WWR, RemoteOK)
  try {
    const resolved = await resolveRedirectChain(url)
    if (resolved && resolved !== url && !isJobBoardUrl(resolved)) {
      console.log(`[resolve-url] Redirect chain resolved: ${url} -> ${resolved}`)
      return resolved
    }
  } catch (err) {
    console.log(`[resolve-url] Redirect chain failed: ${err instanceof Error ? err.message : err}`)
  }

  // Strategy 3: ATS probing with company name
  if (meta?.company && meta.company !== 'Unknown') {
    console.log(`[resolve-url] Probing ATS platforms for "${meta.company}"`)
    const probed = await probeCompanyAtsPages(meta.company, meta.role)
    if (probed) {
      console.log(`[resolve-url] ATS probe found: ${probed}`)
      return probed
    }
  }

  // Resolution failed — return original URL
  console.log(`[resolve-url] Resolution failed for ${url}, returning original`)
  return url
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  // Accept both GET (query param) and POST (body)
  const url = (req.method === 'POST' ? req.body?.url : req.query.url) as string | undefined
  const company = (req.method === 'POST' ? req.body?.company : req.query.company) as string | undefined
  const role = (req.method === 'POST' ? req.body?.role : req.query.role) as string | undefined

  if (!url) {
    return res.status(400).json({ error: 'url parameter required' })
  }

  try {
    const resolvedUrl = await resolveUrl(url, { company, role })
    return res.status(200).json({
      resolvedUrl,
      wasResolved: resolvedUrl !== url,
      originalUrl: url,
    })
  } catch (err) {
    console.error(`[resolve-url] Error resolving ${url}:`, err)
    return res.status(200).json({
      resolvedUrl: url,
      wasResolved: false,
      originalUrl: url,
      error: err instanceof Error ? err.message : 'Resolution failed',
    })
  }
}
