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

/**
 * ⚠️ DISABLED — P0 safety fix (April 2026).
 *
 * This helper used to probe known ATS platforms with the company name slug
 * and return the first open job URL found, using a loose title-match scorer.
 * That scorer accepted "Product Engineer" as a match for "Product Designer"
 * (both share "product"), and the Lever public-API fallback returned best-
 * match jobs even with score 1/N. As a result the bot submitted to totally
 * different roles at the right company (JumpCloud, Ethena Labs — Apr 2026).
 *
 * resolveUrl() is called from the /api/resolve-url endpoint invoked by
 * src/lib/bot-api.ts right before dispatching jobs to the Chrome extension
 * — i.e. the apply dispatch path. It must NEVER return a wrong URL silently.
 *
 * Kept as dead code (guarded) until a strict title-matching replacement is
 * designed. A caller that absolutely needs probing must add its own strict
 * URL-vs-role slug check after getting the result.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function probeCompanyAtsPages(_companyName: string, _roleTitle?: string): Promise<string | null> {
  console.warn('[resolve-url] probeCompanyAtsPages is disabled on the apply-dispatch path for safety (P0 fix, Apr 2026).')
  return null
}

/**
 * DEAD CODE (April 2026): kept for reference but no longer called.
 * The Lever public API returns the "best" match even when the best score
 * is 1 out of many tokens, which caused wrong-role submissions.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function findJobViaLeverApi(companySlug: string, roleTitle: string): Promise<string | null> {
  try {
    const response = await fetch(`https://api.lever.co/v0/postings/${companySlug}?mode=json`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) return null
    const jobs = await response.json() as Array<{ text: string; hostedUrl: string }>
    if (!Array.isArray(jobs) || jobs.length === 0) return null

    const roleWords = roleTitle.toLowerCase().split(/[\s/,\-–—]+/).filter(w => w.length >= 3)
    let bestMatch: { url: string; score: number } | null = null
    for (const job of jobs) {
      const text = (job.text || '').toLowerCase()
      const score = roleWords.filter(w => text.includes(w)).length
      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { url: job.hostedUrl, score }
      }
    }
    if (bestMatch) {
      console.log(`[resolve-url] Lever API match: "${roleTitle}" → ${bestMatch.url} (score ${bestMatch.score})`)
      return bestMatch.url
    }
  } catch (err) {
    console.log(`[resolve-url] Lever API failed for ${companySlug}: ${err instanceof Error ? err.message : err}`)
  }
  return null
}

/**
 * DEAD CODE (April 2026): kept for reference but no longer called.
 * The loose scoring (ceil(words/2)) let unrelated roles sharing a single
 * token (e.g. "product" in Product Engineer vs Product Designer) match.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
 * Tokenize a role title into significant slug tokens.
 * Keeps 2-letter industry terms (ux/ui/ai/etc). Drops stopwords.
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
 * Title-match safeguard: require that at least half the role's significant
 * tokens (min 1) appear in the resolved URL path/query. Returns false if
 * no tokens can be extracted or the resolved URL is invalid.
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
        // SECURITY: Limit HTML download to 512KB to prevent OOM on Vercel
        const contentLength = parseInt(response.headers.get('content-length') || '0', 10)
        if (contentLength > 512_000) {
          console.log(`[resolve-url] HTML too large (${contentLength} bytes), skipping`)
        }
        const reader = response.body?.getReader()
        let html = ''
        const MAX_HTML_BYTES = 512_000
        if (reader) {
          const decoder = new TextDecoder()
          let totalBytes = 0
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            totalBytes += value.length
            html += decoder.decode(value, { stream: true })
            if (totalBytes > MAX_HTML_BYTES) {
              reader.cancel()
              break
            }
          }
        }
        const atsUrl = extractAtsUrlFromHtml(html)
        if (atsUrl) {
          // SAFETY (P0, April 2026): require the extracted ATS URL to mention
          // the original role. Some listing pages embed multiple ATS links
          // (including links to unrelated jobs in "see also" sections).
          if (meta?.role && !urlContainsRoleSlug(atsUrl, meta.role)) {
            console.warn(`[resolve-url] Title-match guard REJECTED extracted ATS URL ${atsUrl} for role "${meta.role}" — returning original URL`)
            return url
          }
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
      // SAFETY (P0, April 2026): require resolved URL to mention the role.
      if (meta?.role && !urlContainsRoleSlug(resolved, meta.role)) {
        console.warn(`[resolve-url] Title-match guard REJECTED redirect-chain resolution ${resolved} for role "${meta.role}" — returning original URL`)
        return url
      }
      console.log(`[resolve-url] Redirect chain resolved: ${url} -> ${resolved}`)
      return resolved
    }
  } catch (err) {
    console.log(`[resolve-url] Redirect chain failed: ${err instanceof Error ? err.message : err}`)
  }

  // Strategy 3: ATS probing with company name — DISABLED on apply-dispatch path.
  //
  // HISTORICAL INCIDENT (April 2026): probeCompanyAtsPages matched unrelated
  // roles at the right company (JumpCloud Engineer instead of Product Designer
  // on RemoteOK, Ethena Labs similar). Until a strict title-matching scorer
  // is written, this strategy is off. See probeCompanyAtsPages above.
  if (meta?.company && meta.company !== 'Unknown') {
    console.warn(`[resolve-url] ATS probing disabled on apply-dispatch path (P0 safety). Company="${meta.company}" role="${meta.role ?? ''}" — returning original URL.`)
  }

  // Resolution failed — return original URL
  console.log(`[resolve-url] Resolution failed for ${url}, returning original`)
  return url
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // SECURITY: Only allow requests from our own dashboard origin
  const allowedOrigins = [
    'https://tracker-app-lyart.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000',
  ]
  const origin = req.headers.origin || ''
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0])
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  // Only accept POST (no GET to prevent CSRF via URL params)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Accept both GET (query param) and POST (body)
  const url = req.body?.url as string | undefined
  const company = req.body?.company as string | undefined
  const role = req.body?.role as string | undefined

  if (!url) {
    return res.status(400).json({ error: 'url parameter required' })
  }

  // SECURITY: Validate URL is a known job board — reject arbitrary URLs
  // This prevents SSRF (Server-Side Request Forgery) attacks
  if (!isJobBoardUrl(url) && !isAlreadyAts(url)) {
    return res.status(400).json({ error: 'URL must be a known job board or ATS domain' })
  }

  // SECURITY: Block internal/private network URLs
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('172.') ||
      hostname === '169.254.169.254' ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.local') ||
      parsed.protocol !== 'https:' && parsed.protocol !== 'http:'
    ) {
      return res.status(400).json({ error: 'URL not allowed' })
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' })
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
