/**
 * ATS URL resolver + detector.
 *
 * Two concerns, one module:
 *
 *   1. `detectAts(url)` — pure, synchronous regex classifier.
 *      Returns the **TitleCase** ATS name (e.g. "Greenhouse", "Lever")
 *      or the sentinel string "unknown". Safe on empty / garbage input.
 *
 *   2. `resolveAggregatorUrl(url, opts)` — async best-effort HEAD follower
 *      that turns an aggregator landing page (remoteok.com/l/123, wwr, etc.)
 *      into the real ATS URL it ultimately redirects to. Fully mockable via
 *      `globalThis.fetch`, swallows every error, never throws.
 *
 * Downstream convention note
 * --------------------------
 * Historically the codebase stored ATS names on `DiscoveredJob.ats` in
 * **lowercase** ('greenhouse', 'lever', …) because `ATS_PRIORITY` in
 * apply-job.ts and `BLOCKED_ATS` in orchestrator.ts both key on lowercase.
 * This module now returns **TitleCase** from `detectAts` so the public API
 * matches the naming people use in logs / docs. Callers that persist the
 * value on `DiscoveredJob.ats` must lowercase it first — the helper
 * `detectAtsLower(url)` is provided for exactly that use case.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result returned by `resolveAggregatorUrl`.
 *
 * - `url`        : final URL after redirects (or the input URL on failure)
 * - `ats`        : TitleCase ATS name on match, otherwise the string "unknown"
 * - `confidence` : 0..1 — rough signal the caller can use to gate retries:
 *                    1   → resolved to a known ATS host
 *                    0.6 → resolved *something* (non-ATS host), partial win
 *                    0   → total failure (abort, 4xx, 5xx, network, …)
 */
export interface ResolvedAts {
  url: string
  ats: string
  confidence: number
}

export interface ResolveAggregatorOptions {
  /** Abort the HEAD request after N ms (default 8000). */
  timeoutMs?: number
  /** Override the User-Agent sent with HEAD (default: desktop Chrome). */
  userAgent?: string
}

// ---------------------------------------------------------------------------
// ATS pattern catalog — TitleCase name + host/path regex
// ---------------------------------------------------------------------------

/**
 * Order matters — more specific matchers come first. Each regex is matched
 * against the **lowercased** URL, and is anchored on the host portion to
 * avoid false positives like "greenhouse" appearing inside an unrelated
 * domain ("greenhousegrowers.com").
 *
 * Adding a new ATS:
 *   1. Append `[TitleCase, regex]` below.
 *   2. Add a positive-match test in `__tests__/ats-resolver.test.ts`.
 *   3. Update `ATS_PRIORITY` in `src/trigger/apply-job.ts` if the apply-path
 *      needs to treat it specially (remember: that file keys on *lowercase*
 *      ATS names — use `detectAtsLower(url)` at write sites).
 */
const ATS_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  // Greenhouse — boards.greenhouse.io, job-boards.greenhouse.io, boards-api.greenhouse.io
  ['Greenhouse', /^https?:\/\/(?:[a-z0-9-]+\.)*greenhouse\.io(?:\/|$)/i],

  // Lever — jobs.lever.co, hire.lever.co, api.lever.co
  ['Lever', /^https?:\/\/(?:jobs|hire|api)\.lever\.co(?:\/|$)/i],

  // Workable — acme.workable.com (tenant) or apply.workable.com / jobs.workable.com
  ['Workable', /^https?:\/\/(?:[a-z0-9-]+\.)?workable\.com(?:\/|$)/i],

  // Ashby — jobs.ashbyhq.com/acme/...  |  acme.ashbyhq.com
  ['Ashby', /^https?:\/\/(?:[a-z0-9-]+\.)?ashbyhq\.com(?:\/|$)/i],

  // BreezyHR — acme.breezy.hr, app.breezy.hr
  ['BreezyHR', /^https?:\/\/(?:[a-z0-9-]+\.)?breezy\.hr(?:\/|$)/i],

  // Manatal — careers-page.com is Manatal's public careers host
  ['Manatal', /^https?:\/\/(?:www\.)?careers-page\.com(?:\/|$)/i],
  ['Manatal', /^https?:\/\/(?:[a-z0-9-]+\.)?manatal\.com(?:\/|$)/i],

  // Teamtailor — acme.teamtailor.com
  ['Teamtailor', /^https?:\/\/(?:[a-z0-9-]+\.)?teamtailor\.com(?:\/|$)/i],

  // Recruitee — acme.recruitee.com
  ['Recruitee', /^https?:\/\/(?:[a-z0-9-]+\.)?recruitee\.com(?:\/|$)/i],

  // Personio — acme.jobs.personio.com / .personio.de
  ['Personio', /^https?:\/\/(?:[a-z0-9-]+\.)*personio\.(?:com|de)(?:\/|$)/i],

  // BambooHR — acme.bamboohr.com/careers/...
  ['BambooHR', /^https?:\/\/(?:[a-z0-9-]+\.)?bamboohr\.com(?:\/|$)/i],

  // Workday — *.myworkdayjobs.com (and bare workday.com tenants)
  ['Workday', /^https?:\/\/(?:[a-z0-9-]+\.)*myworkdayjobs\.com(?:\/|$)/i],
  ['Workday', /^https?:\/\/(?:[a-z0-9-]+\.)*workday\.com(?:\/|$)/i],

  // Oracle HCM / Taleo cloud — *.oraclecloud.com/hcmUI/CandidateExperience
  // We lowercase the URL before matching so /hcmUI/ → /hcmui/.
  ['OracleHCM', /^https?:\/\/[a-z0-9.-]+\.oraclecloud\.com\/hcmui\//i],

  // iCIMS — *.icims.com (jobs-<tenant>.icims.com / careers-<tenant>.icims.com)
  ['iCIMS', /^https?:\/\/(?:[a-z0-9-]+\.)*icims\.com(?:\/|$)/i],

  // Jobvite — jobs.jobvite.com, hire.jobvite.com
  ['Jobvite', /^https?:\/\/(?:[a-z0-9-]+\.)*jobvite\.com(?:\/|$)/i],

  // SmartRecruiters — jobs.smartrecruiters.com, careers.smartrecruiters.com
  ['SmartRecruiters', /^https?:\/\/(?:[a-z0-9-]+\.)*smartrecruiters\.com(?:\/|$)/i],

  // Recruiterbox — acme.recruiterbox.com
  ['Recruiterbox', /^https?:\/\/(?:[a-z0-9-]+\.)*recruiterbox\.com(?:\/|$)/i],

  // JazzHR — acme.applytojob.com
  ['JazzHR', /^https?:\/\/(?:[a-z0-9-]+\.)*applytojob\.com(?:\/|$)/i],

  // Pinpoint HR — acme.pinpointhq.com
  ['Pinpoint', /^https?:\/\/(?:[a-z0-9-]+\.)*pinpointhq\.com(?:\/|$)/i],

  // Welcome to the Jungle — welcometothejungle.com
  ['WelcomeToTheJungle', /^https?:\/\/(?:[a-z0-9-]+\.)*welcometothejungle\.com(?:\/|$)/i],

  // Gupy — acme.gupy.io
  ['Gupy', /^https?:\/\/(?:[a-z0-9-]+\.)*gupy\.io(?:\/|$)/i],
]

/**
 * Known aggregator hosts. A URL that matches one of these (and nothing in
 * `ATS_PATTERNS`) is an unresolved aggregator listing — the scout should
 * have resolved it to a real ATS URL before storing it. Used by
 * `isAggregatorUrl()` and by the orchestrator telemetry that counts
 * "leaked aggregator URLs" in the funnel.
 */
const AGGREGATOR_HOSTS: ReadonlySet<string> = new Set([
  'remoteok.com',
  'remoteok.io',
  'weworkremotely.com',
  'himalayas.app',
  'remotive.com',
  'jobicy.com',
  'wellfound.com',
  'angel.co',
  'dribbble.com',
  'aiok.co', // RemoteOK tracker redirect host
  'linkedin.com', // only the jobs subtree is really an aggregator for us
])

// ---------------------------------------------------------------------------
// detectAts — pure regex classifier
// ---------------------------------------------------------------------------

/**
 * Classify a URL as a known ATS or the sentinel "unknown".
 *
 * - Returns TitleCase name ('Greenhouse', 'Lever', …) on match.
 * - Returns `"unknown"` for aggregators, careers pages, and garbage input.
 * - Case-insensitive on host.
 * - Never throws — empty / malformed strings yield `"unknown"`.
 *
 * LinkedIn is intentionally NOT listed here. LinkedIn Easy Apply is handled
 * upstream in scout.ts which sets `ats: 'linkedin'` directly. Keeping
 * LinkedIn out of this classifier prevents the resolver from mislabelling
 * `linkedin.com/jobs/...` as "an ATS".
 */
export function detectAts(url: string): string {
  if (!url || typeof url !== 'string') return 'unknown'

  const trimmed = url.trim()
  if (trimmed.length === 0) return 'unknown'

  // Lowercase once up front so patterns stay simple.
  const lowered = trimmed.toLowerCase()

  // Quickly reject obviously malformed inputs — require a positive http(s)
  // scheme so "htp:/broken" and "not a url at all!!!" return unknown.
  if (!lowered.startsWith('http://') && !lowered.startsWith('https://')) return 'unknown'

  for (const [name, regex] of ATS_PATTERNS) {
    if (regex.test(lowered)) return name
  }
  return 'unknown'
}

/**
 * Convenience: returns the **lowercase** ATS key expected by the existing
 * downstream consumers (`ATS_PRIORITY` in apply-job.ts, `BLOCKED_ATS` in
 * orchestrator.ts). Maps `"Greenhouse" → "greenhouse"`, etc.
 *
 * Use this in scraper call sites that set `DiscoveredJob.ats`.
 */
export function detectAtsLower(url: string): string {
  const ats = detectAts(url)
  return ats === 'unknown' ? 'unknown' : ats.toLowerCase()
}

/**
 * Return true when `url`'s hostname is a known aggregator host. Used by
 * the orchestrator to log a warning about a leaked aggregator URL and
 * to avoid misclassifying self-referential links (e.g. himalayas.app's
 * `applicationLink` field that just points back to himalayas.app).
 */
export function isAggregatorUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    for (const agg of AGGREGATOR_HOSTS) {
      if (host === agg || host.endsWith(`.${agg}`)) return true
    }
  } catch {
    /* not a parseable URL */
  }
  return false
}

// ---------------------------------------------------------------------------
// resolveAggregatorUrl — async HEAD follower
// ---------------------------------------------------------------------------

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

/**
 * Follow an aggregator URL to its final destination using a HEAD request.
 *
 * Strategy:
 *   1. Empty / garbage input → return `{ url, ats: 'unknown', confidence: 0 }`
 *      without touching the network.
 *   2. Already a known ATS URL → return immediately (no fetch, confidence 1).
 *   3. Otherwise fire a HEAD request with `redirect: 'follow'` so `fetch()`
 *      transparently walks the 3xx chain. Read `response.url` for the final
 *      URL and classify it with `detectAts()`:
 *      - Known ATS → confidence 1
 *      - Unknown host → confidence 0.6 (we did resolve *something*, but
 *        it's a company career page / landing page / unknown host)
 *   4. Any error (AbortError, TypeError, 4xx, 5xx) → fall back to the
 *      ORIGINAL url with `ats='unknown'` and `confidence=0`.
 *
 * The function NEVER throws — all failure paths produce a safe result.
 *
 * The caller is responsible for rate-limiting. See
 * `resolveAggregatorUrlsConcurrent` for a capped-parallel helper.
 */
export async function resolveAggregatorUrl(
  url: string,
  opts: ResolveAggregatorOptions = {},
): Promise<ResolvedAts> {
  // Empty / garbage input: safe fallback without fetching.
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    return { url, ats: 'unknown', confidence: 0 }
  }

  // Fast path: already an ATS URL — no network call needed.
  const direct = detectAts(url)
  if (direct !== 'unknown') {
    return { url, ats: direct, confidence: 1 }
  }

  const timeoutMs = opts.timeoutMs ?? 8_000
  const userAgent = opts.userAgent ?? DEFAULT_UA

  // Build a controller so we can abort on timeout. We use a manual setTimeout
  // rather than `AbortSignal.timeout()` so the tests' mocked fetch receives
  // an init object with a real `.signal` property that it can inspect.
  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    try {
      controller.abort()
    } catch {
      /* already aborted — ignore */
    }
  }, timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': userAgent,
        Accept: '*/*',
      },
    })

    // Non-2xx → bail, keep the original URL.
    if (!response || !response.ok) {
      return { url, ats: 'unknown', confidence: 0 }
    }

    // `response.url` reflects the final URL after redirects. Fallback to
    // the input URL if the runtime doesn't populate it.
    const finalUrl = response.url || url
    const ats = detectAts(finalUrl)

    if (ats !== 'unknown') {
      return { url: finalUrl, ats, confidence: 1 }
    }
    // Resolved *something*, but it's not a known ATS host. Partial win.
    return { url: finalUrl, ats: 'unknown', confidence: 0.6 }
  } catch {
    // AbortError, TypeError('fetch failed'), DNS, etc. — swallow all.
    return { url, ats: 'unknown', confidence: 0 }
  } finally {
    clearTimeout(timeoutId)
  }
}

// ---------------------------------------------------------------------------
// Concurrency-capped bulk resolver
// ---------------------------------------------------------------------------

/**
 * Resolve an array of aggregator URLs in parallel with a concurrency cap.
 *
 * - Deduplicates in-flight requests via a Map so the same URL is fetched
 *   at most once per call.
 * - Never throws — failures land as safe fallbacks in the corresponding slot.
 * - Preserves input order in the output array.
 *
 * Intended for scraper post-processing:
 *
 *     const resolved = await resolveAggregatorUrlsConcurrent(
 *       candidates.map(c => c.listingUrl),
 *       { concurrency: 10, timeoutMs: 8_000 },
 *     )
 *
 * The concurrency cap defaults to 10, which matches the brief's requirement
 * and is gentle enough for most aggregator hosts.
 */
export async function resolveAggregatorUrlsConcurrent(
  urls: string[],
  opts: ResolveAggregatorOptions & { concurrency?: number } = {},
): Promise<ResolvedAts[]> {
  const { concurrency = 10, ...resolverOpts } = opts
  const results: ResolvedAts[] = new Array(urls.length)
  const cache = new Map<string, Promise<ResolvedAts>>()

  let cursor = 0
  const workerCount = Math.max(1, Math.min(concurrency, urls.length || 1))
  const workers = new Array(workerCount).fill(0).map(async () => {
    while (true) {
      const idx = cursor++
      if (idx >= urls.length) return
      const u = urls[idx]
      let pending = cache.get(u)
      if (!pending) {
        pending = resolveAggregatorUrl(u, resolverOpts)
        cache.set(u, pending)
      }
      try {
        results[idx] = await pending
      } catch {
        // Defensive — resolveAggregatorUrl doesn't throw, but just in case.
        results[idx] = { url: u, ats: 'unknown', confidence: 0 }
      }
    }
  })

  await Promise.all(workers)
  return results
}

// ---------------------------------------------------------------------------
// Telemetry helper
// ---------------------------------------------------------------------------

/**
 * Compute an ATS distribution histogram across a list of jobs.
 * Used by orchestrator telemetry to log which ATSes dominate the funnel.
 *
 * Returns a sorted array of `[ats, count]` pairs, descending by count.
 * Respects a pre-set `job.ats` when present (case-insensitive), otherwise
 * falls back to `detectAts(job.url)` (lowercased for consistency).
 */
export function atsDistribution(
  jobs: Array<{ ats?: string | null; url?: string }>,
): Array<[string, number]> {
  const counts: Record<string, number> = {}
  for (const job of jobs) {
    const fromField = job.ats ? job.ats.toLowerCase() : ''
    const fromUrl = job.url ? detectAts(job.url).toLowerCase() : 'unknown'
    const key = fromField || fromUrl
    counts[key] = (counts[key] ?? 0) + 1
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])
}
