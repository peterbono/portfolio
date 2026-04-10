import type { Page, Browser, BrowserContext } from 'playwright'
import type { SearchProfile } from '../types/database.js'
import { APPLICANT } from './types.js'
import { scoutJobsMultiPass, normalizeForDedup, type DiscoveredJob, type MultiPassConfig, type ScoutProgressUpdate } from './scout.js'
import { scoutRemoteOK, scoutWellfound, scoutHimalayas, scoutRemotive, scoutWWR, scoutDribbble, scoutJobicy } from './scout-boards.js'
import { detectAts, isAggregatorUrl, atsDistribution } from './ats-resolver.js'
import {
  qualifyJob,
  clearQualificationCache,
  preQualifyBatch,
  formatPreQualifyStats,
  type QualificationResult,
} from './qualifier.js'
import { blockUnnecessaryResources } from './helpers.js'
import {
  createBotRun,
  updateBotRun,
  logBotActivity,
  getExistingApplications,
  getExistingApplicationsWithUrls,
  getActiveSearchProfile,
  cleanupZombieRuns,
  upsertDiscoveredJobListing,
  type ActivityLogEntry,
} from './supabase-server.js'

// ---------------------------------------------------------------------------
// Supabase resilience wrappers (module-level — used by all pipeline functions)
// Trigger.dev workers can't always reach Supabase (upstream request timeout).
// All DB calls are non-critical: pipeline MUST run even if tracking fails.
// ---------------------------------------------------------------------------
export const fireLog = (entry: ActivityLogEntry) => {
  logBotActivity(entry).catch(e => console.warn(`[pipeline] logBotActivity failed: ${(e as Error).message}`))
}
export const fireUpdate = (id: string, stats: Record<string, unknown>) => {
  updateBotRun(id, stats).catch(e => console.warn(`[pipeline] updateBotRun failed: ${(e as Error).message}`))
}

// ---------------------------------------------------------------------------
// Pipeline configuration & result types
// ---------------------------------------------------------------------------

export interface PipelineConfig {
  userId: string
  searchProfile: SearchProfile
  maxApplications: number // Per run, default 20
  dryRun: boolean // If true, don't actually submit — just log
  browser: Browser // Playwright browser instance
  browserContext?: BrowserContext // pre-authenticated context (LinkedIn cookie)
  minScore: number // Minimum qualification score, default 60
  /** All location rules from search config — used by multi-pass scout */
  allLocations?: string[]
  /** All keywords from search config — used by multi-pass scout */
  allKeywords?: string[]
  /**
   * If true, stop after scout + qualify + persistDiscoveredJobs. Do NOT
   * invoke the apply loop. Used by the /api/trigger-scout entry point so
   * the frontend can populate OpenJobsView without submitting applications.
   *
   * Note: today the apply phase is already disabled inline (see Phase 3
   * comment below), so this flag is functionally a no-op — but it's plumbed
   * through so the contract is explicit when apply is re-enabled.
   */
  skipApply?: boolean
  /**
   * Pre-created bot_run id. When provided, runPipeline uses this instead of
   * calling createBotRun again — lets the HTTP entry point return the runId
   * to the client before the pipeline starts doing real work.
   */
  runId?: string
}

/** Progress data sent via onProgress callback for live UI updates */
export interface PipelineProgress {
  phase: 'starting' | 'scout' | 'pre-filter' | 'qualify' | 'apply' | 'done' | 'error'
  jobsFound: number
  jobsProcessed: number
  jobsQualified: number
  jobsPreFiltered: number
  /** During scout phase: total number of keyword x location searches to run */
  scoutSearchesTotal?: number
  currentJob: { company: string; role: string } | null
  activities: Array<{
    action: string
    company?: string
    role?: string
    reason?: string
    timestamp: string
  }>
}

/** Inline config passed from frontend (no Supabase lookup needed) */
export interface InlinePipelineConfig {
  userId: string
  browser: Browser
  browserContext?: BrowserContext // pre-authenticated context (e.g. LinkedIn cookie)
  searchConfig: {
    keywords: string[]
    locationRules: Array<{
      type: string
      value: string
      workArrangement: string
      minSalary?: number
      currency?: string
    }>
    excludedCompanies: string[]
    dailyLimit: number
  }
  userProfile: Record<string, unknown>
  maxApplications?: number
  dryRun?: boolean
  /** If true, stop after scout + qualify + persist. Do NOT run apply loop. */
  skipApply?: boolean
  /** Pre-created bot_run id from the HTTP entry point (so client can poll). */
  runId?: string
  /** Optional callback for live progress updates (used by Trigger.dev metadata) */
  onProgress?: (progress: PipelineProgress) => void
}

export interface QualifiedJobOutput {
  title: string
  company: string
  location: string
  url: string
  isEasyApply?: boolean
  score: number
  matchReasons: string[]
  coverLetterSnippet: string
  ats?: string
}

/** Cost estimate breakdown for a pipeline run */
export interface RunCostEstimate {
  scout: number   // Bright Data proxy costs (LinkedIn, Wellfound)
  qualify: number  // Haiku API costs
  total: number    // scout + qualify
}

export interface PipelineResult {
  runId: string
  jobsFound: number
  jobsPreFiltered?: number
  jobsQualified: number
  jobsApplied: number
  jobsSkipped: number
  jobsFailed: number
  duration: number // ms
  costEstimate?: RunCostEstimate
  activities: ActivityLogEntry[]
  discoveredJobs?: Array<{
    title: string
    company: string
    location: string
    url: string
    isEasyApply: boolean
    source?: string
    ats?: string
  }>
  qualifiedJobs?: QualifiedJobOutput[]
}

// ---------------------------------------------------------------------------
// Cost tracking constants (per-unit estimates)
// ---------------------------------------------------------------------------

/** Haiku API cost per qualification call (~$0.003 per job) */
const COST_HAIKU_PER_CALL = 0.003

/** Bright Data proxy cost per LinkedIn page (~$0.01/page) */
const COST_LINKEDIN_PER_PAGE = 0.01

/** Bright Data proxy cost per Wellfound page (~$0.005/page) */
const COST_WELLFOUND_PER_PAGE = 0.005

/** RemoteOK is a free JSON API — no proxy needed */
const COST_REMOTEOK_PER_PAGE = 0

/** Himalayas is a free JSON API — no proxy needed */
const COST_HIMALAYAS_PER_PAGE = 0

/** Remotive is a free JSON API — no proxy needed */
const COST_REMOTIVE_PER_PAGE = 0

/** WWR is a free RSS feed — no proxy needed */
const COST_WWR_PER_PAGE = 0

/** Dribbble uses Playwright (browser-based scraping) — uses Bright Data proxy */
const COST_DRIBBBLE_PER_PAGE = 0.005

/** Jobicy is a free JSON API — no proxy needed */
const COST_JOBICY_PER_PAGE = 0

/** Simple in-memory cost accumulator for a single pipeline run */
function createCostTracker() {
  let scoutCost = 0
  let qualifyCost = 0

  return {
    addScoutCost(amount: number) { scoutCost += amount },
    addQualifyCost(amount: number) { qualifyCost += amount },
    get scout() { return scoutCost },
    get qualify() { return qualifyCost },
    get total() { return scoutCost + qualifyCost },
    toEstimate(): RunCostEstimate {
      return {
        scout: Math.round(scoutCost * 1000) / 1000,
        qualify: Math.round(qualifyCost * 1000) / 1000,
        total: Math.round((scoutCost + qualifyCost) * 1000) / 1000,
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Delay with jitter for human-like behavior */
function humanDelay(baseMs: number, jitterMs: number = 500): Promise<void> {
  const ms = baseMs + Math.floor(Math.random() * jitterMs * 2) - jitterMs
  return new Promise(r => setTimeout(r, Math.max(100, ms)))
}

// ---------------------------------------------------------------------------
// Shared fetch headers (used by both expiration check and JD extraction)
// ---------------------------------------------------------------------------

import * as cheerio from 'cheerio'

/** Standard fetch headers for job page requests */
const JD_FETCH_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}

// ---------------------------------------------------------------------------
// Expiration check: lightweight HEAD/GET to detect dead job postings
// ---------------------------------------------------------------------------

/**
 * Check if a job URL points to an expired/removed posting.
 * Uses a HEAD request (2s timeout) to detect 404/410/301-to-homepage.
 * For LinkedIn jobs, does a lightweight GET to check for "no longer available" text.
 * Returns true if the job appears expired.
 */
async function isJobExpired(url: string): Promise<boolean> {
  try {
    const isLinkedIn = url.includes('linkedin.com/jobs/view/')

    if (isLinkedIn) {
      // LinkedIn guest API: GET to check for expiration text in the response
      const linkedInMatch = url.match(/linkedin\.com\/jobs\/view\/(\d+)/)
      if (linkedInMatch) {
        const guestUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${linkedInMatch[1]}`
        const resp = await fetch(guestUrl, {
          headers: JD_FETCH_HEADERS,
          signal: AbortSignal.timeout(2_000),
        })
        if (resp.status === 404 || resp.status === 410) return true
        if (resp.ok) {
          const html = await resp.text()
          const lower = html.toLowerCase()
          if (
            lower.includes('no longer available') ||
            lower.includes('job has been closed') ||
            lower.includes('no longer accepting applications') ||
            lower.includes('this job is no longer')
          ) {
            return true
          }
        }
      }
      return false
    }

    // Non-LinkedIn: lightweight HEAD request
    const resp = await fetch(url, {
      method: 'HEAD',
      headers: JD_FETCH_HEADERS,
      signal: AbortSignal.timeout(2_000),
      redirect: 'manual', // don't follow redirects — we want to inspect the status
    })

    // 404/410 = page removed
    if (resp.status === 404 || resp.status === 410) return true

    // 301/302 redirect to homepage = job removed, redirected to careers page
    if (resp.status === 301 || resp.status === 302) {
      const location = resp.headers.get('location') ?? ''
      // Check if redirect target is the homepage or a generic careers page
      // (not another job posting URL)
      try {
        const redirectUrl = new URL(location, url)
        const originalUrl = new URL(url)
        // Redirect to root or /careers or /jobs (without a specific job ID) = expired
        const path = redirectUrl.pathname.replace(/\/$/, '')
        if (
          path === '' ||
          path === '/careers' ||
          path === '/jobs' ||
          path === '/job-openings' ||
          path === '/open-positions' ||
          (redirectUrl.hostname === originalUrl.hostname && path.split('/').length <= 2 && !path.match(/\d{4,}/))
        ) {
          return true
        }
      } catch {
        // Invalid redirect URL — treat as not expired
      }
    }

    return false
  } catch {
    // Network error / timeout — give benefit of the doubt, treat as not expired
    return false
  }
}

/**
 * Filter out expired jobs from a batch using concurrent HEAD requests.
 * Returns the surviving (non-expired) jobs.
 */
async function filterExpiredJobs(
  jobs: DiscoveredJob[],
  concurrency: number = 10,
): Promise<{ alive: DiscoveredJob[]; expiredCount: number }> {
  const alive: DiscoveredJob[] = []
  let expiredCount = 0
  const queue = [...jobs]

  async function worker() {
    while (queue.length > 0) {
      const job = queue.shift()
      if (!job) break

      const expired = await isJobExpired(job.url)
      if (expired) {
        expiredCount++
        console.log(`[pipeline] Expired job filtered: ${job.company} - "${job.title}" (${job.url})`)
      } else {
        alive.push(job)
      }
    }
  }

  const workerCount = Math.min(concurrency, jobs.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  return { alive, expiredCount }
}

// ---------------------------------------------------------------------------
// JD extraction: fetch-first strategy (10x faster than Playwright for SSR pages)
// ---------------------------------------------------------------------------

/** In-memory JD cache: same URL = same JD, avoids re-fetching across runs within same process */
const jdCache = new Map<string, string>()

/**
 * Extract JD via fetch() + cheerio for server-rendered pages.
 * Returns the extracted text, or '' if extraction fails.
 * Works for: LinkedIn guest API, Lever, Greenhouse, Ashby, Workable, TeamTailor, Breezy.
 */
async function extractJdViaFetch(url: string): Promise<string> {
  // Check cache first
  const cached = jdCache.get(url)
  if (cached) {
    console.log(`[jd-fetch] Cache hit for ${url} (${cached.length} chars)`)
    return cached
  }

  try {
    // --- LinkedIn: use guest API endpoint ---
    const linkedInMatch = url.match(/linkedin\.com\/jobs\/view\/(\d+)/)
    if (linkedInMatch) {
      const guestUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${linkedInMatch[1]}`
      const resp = await fetch(guestUrl, { headers: JD_FETCH_HEADERS, signal: AbortSignal.timeout(10_000) })
      if (resp.ok) {
        const html = await resp.text()
        const $ = cheerio.load(html)
        const text =
          $('.show-more-less-html__markup').text().trim() ||
          $('.description__text').text().trim() ||
          $('.decorated-job-posting__details').text().trim() ||
          $('section.description').text().trim() ||
          $('body').text().trim()
        if (text.length > 100) {
          const result = text.slice(0, 6000)
          jdCache.set(url, result)
          console.log(`[jd-fetch] LinkedIn guest API: ${result.length} chars`)
          return result
        }
      }
    }

    // --- Lever: server-rendered, clean HTML ---
    if (url.includes('lever.co') || url.includes('jobs.lever')) {
      const resp = await fetch(url, { headers: JD_FETCH_HEADERS, signal: AbortSignal.timeout(10_000) })
      if (resp.ok) {
        const html = await resp.text()
        const $ = cheerio.load(html)
        const text =
          $('[data-qa="job-description"]').text().trim() ||
          $('.posting-page .section-wrapper').text().trim() ||
          $('.content .section-wrapper').text().trim() ||
          $('[class*="posting-description"]').text().trim() ||
          $('main').text().trim()
        if (text.length > 100) {
          const result = text.slice(0, 6000)
          jdCache.set(url, result)
          console.log(`[jd-fetch] Lever: ${result.length} chars`)
          return result
        }
      }
    }

    // --- Greenhouse: server-rendered ---
    if (url.includes('greenhouse.io') || url.includes('boards.greenhouse')) {
      const resp = await fetch(url, { headers: JD_FETCH_HEADERS, signal: AbortSignal.timeout(10_000) })
      if (resp.ok) {
        const html = await resp.text()
        const $ = cheerio.load(html)
        const text =
          $('#content .section-wrapper').text().trim() ||
          $('[class*="job-description"]').text().trim() ||
          $('main').text().trim() ||
          $('[role="main"]').text().trim()
        if (text.length > 100) {
          const result = text.slice(0, 6000)
          jdCache.set(url, result)
          console.log(`[jd-fetch] Greenhouse: ${result.length} chars`)
          return result
        }
      }
    }

    // --- Ashby: server-rendered ---
    if (url.includes('ashbyhq.com')) {
      const resp = await fetch(url, { headers: JD_FETCH_HEADERS, signal: AbortSignal.timeout(10_000) })
      if (resp.ok) {
        const html = await resp.text()
        const $ = cheerio.load(html)
        const text =
          $('[data-testid="job-description"]').text().trim() ||
          $('[class*="job-description"]').text().trim() ||
          $('[class*="jobDescription"]').text().trim() ||
          $('main').text().trim()
        if (text.length > 100) {
          const result = text.slice(0, 6000)
          jdCache.set(url, result)
          console.log(`[jd-fetch] Ashby: ${result.length} chars`)
          return result
        }
      }
    }

    // --- Workable: server-rendered ---
    if (url.includes('workable.com')) {
      const resp = await fetch(url, { headers: JD_FETCH_HEADERS, signal: AbortSignal.timeout(10_000) })
      if (resp.ok) {
        const html = await resp.text()
        const $ = cheerio.load(html)
        const text =
          $('[data-ui="job-description"]').text().trim() ||
          $('[class*="job-description"]').text().trim() ||
          $('main').text().trim()
        if (text.length > 100) {
          const result = text.slice(0, 6000)
          jdCache.set(url, result)
          console.log(`[jd-fetch] Workable: ${result.length} chars`)
          return result
        }
      }
    }

    // --- TeamTailor: server-rendered ---
    if (url.includes('teamtailor.com')) {
      const resp = await fetch(url, { headers: JD_FETCH_HEADERS, signal: AbortSignal.timeout(10_000) })
      if (resp.ok) {
        const html = await resp.text()
        const $ = cheerio.load(html)
        const text =
          $('[class*="job-description"]').text().trim() ||
          $('article').text().trim() ||
          $('main').text().trim()
        if (text.length > 100) {
          const result = text.slice(0, 6000)
          jdCache.set(url, result)
          console.log(`[jd-fetch] TeamTailor: ${result.length} chars`)
          return result
        }
      }
    }

    // --- Breezy: server-rendered ---
    if (url.includes('breezy.hr')) {
      const resp = await fetch(url, { headers: JD_FETCH_HEADERS, signal: AbortSignal.timeout(10_000) })
      if (resp.ok) {
        const html = await resp.text()
        const $ = cheerio.load(html)
        const text =
          $('[class*="description"]').text().trim() ||
          $('main').text().trim()
        if (text.length > 100) {
          const result = text.slice(0, 6000)
          jdCache.set(url, result)
          console.log(`[jd-fetch] Breezy: ${result.length} chars`)
          return result
        }
      }
    }

    // --- Generic fetch: try any URL with common selectors ---
    const resp = await fetch(url, {
      headers: JD_FETCH_HEADERS,
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    })
    if (resp.ok) {
      const contentType = resp.headers.get('content-type') || ''
      if (contentType.includes('text/html')) {
        const html = await resp.text()
        const $ = cheerio.load(html)

        // Remove script/style noise
        $('script, style, nav, header, footer').remove()

        const text =
          $('[data-testid="job-description"]').text().trim() ||
          $('[class*="job-description"]').text().trim() ||
          $('[class*="jobDescription"]').text().trim() ||
          $('[class*="job_description"]').text().trim() ||
          $('[class*="JobDescription"]').text().trim() ||
          $('[class*="posting-description"]').text().trim() ||
          $('.job-description').text().trim() ||
          $('article').text().trim() ||
          $('main').text().trim() ||
          $('[role="main"]').text().trim()

        if (text.length > 100) {
          const result = text.slice(0, 6000)
          jdCache.set(url, result)
          console.log(`[jd-fetch] Generic: ${result.length} chars`)
          return result
        }
      }
    }
  } catch (err) {
    console.warn(`[jd-fetch] Failed for ${url}: ${(err as Error).message}`)
  }

  return '' // Empty = caller should try Playwright fallback
}

/** Extract the full job description text from a job page.
 * Strategy: try fetch() first (fast, no browser), fall back to Playwright (slow, reliable).
 */
async function extractJobDescription(page: Page, url: string): Promise<string> {
  // --- Strategy 1: fetch() + cheerio (fast, works for server-rendered pages) ---
  const fetchResult = await extractJdViaFetch(url)
  if (fetchResult.length >= 50) {
    return fetchResult
  }

  // --- Strategy 2: Playwright fallback (slow but handles SPAs and JS-rendered pages) ---
  console.log(`[orchestrator] Fetch extraction insufficient (${fetchResult.length} chars), falling back to Playwright for ${url}`)

  const attempt = async (waitStrategy: 'domcontentloaded' | 'networkidle'): Promise<string> => {
    await page.goto(url, { waitUntil: waitStrategy, timeout: 15_000 })
    await page.waitForTimeout(2000)

    // Try "Show more" buttons (LinkedIn collapses JDs)
    const showMore = page.locator('button.show-more-less-html__button--more, button[aria-label="Show more"], [class*="show-more"]').first()
    if (await showMore.isVisible({ timeout: 1500 }).catch(() => false)) {
      await showMore.click().catch(() => {})
      await page.waitForTimeout(500)
    }

    const descriptionSelectors = [
      '.show-more-less-html__markup',
      '.description__text .show-more-less-html__markup',
      '.description__text',
      '.jobs-description__content',
      '.jobs-box__html-content',
      '.jobs-description-content__text',
      '[data-testid="job-description"]',
      '.job-description',
      '.posting-requirements',
      '#job-details',
      '#content .section-wrapper',
      '.posting-page .section-wrapper',
      '.content .section-wrapper',
      '[class*="job-description"]',
      '[class*="jobDescription"]',
      '[class*="job_description"]',
      '[class*="JobDescription"]',
      '[class*="posting-description"]',
      'article',
      'main',
      '[role="main"]',
    ]

    for (const sel of descriptionSelectors) {
      const el = page.locator(sel).first()
      if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
        const text = await el.innerText().catch(() => '')
        if (text.length > 100) {
          console.log(`[orchestrator] JD extracted via Playwright "${sel}" (${text.length} chars)`)
          const result = text.slice(0, 6000)
          jdCache.set(url, result) // cache for next time
          return result
        }
      }
    }

    const bodyText = await page.locator('body').innerText().catch(() => '')
    return bodyText.slice(0, 5000)
  }

  try {
    const text = await attempt('domcontentloaded')
    if (text.length >= 50) return text

    console.log(`[orchestrator] Retry JD extraction with networkidle for ${url}`)
    const retryText = await attempt('networkidle')
    if (retryText.length >= 50) return retryText

    console.warn(`[orchestrator] JD extraction empty after retry for ${url}`)
    return retryText
  } catch (err) {
    console.warn(`[orchestrator] Failed to extract JD from ${url}:`, (err as Error).message)
    return ''
  }
}

// ---------------------------------------------------------------------------
// Phase 1: Scout
// ---------------------------------------------------------------------------

/** Default locations to search if none are configured */
const DEFAULT_SCOUT_LOCATIONS = [
  'Asia Pacific',
  'Singapore',
  'Philippines',
  'Thailand',
  'India',
  'Australia',
]

/** Default minimum set of keywords to ensure broad coverage */
const DEFAULT_SCOUT_KEYWORDS = [
  'Product Designer',
  'UX Designer',
  'UX UI Designer',
  'UI Designer',
  'Senior Designer',
  'Design Lead',
  'Staff Designer',
  'Visual Designer',
  'Design System',
]

/** Number of LinkedIn pages to scrape per keyword×location combo.
 * LinkedIn guest API serves 10 results per page (NOT 25 — verified empirically).
 * With 4 pages we get up to 40 jobs per combo. Pagination works up to start=50
 * (returns empty at start=100), so PAGES_PER_SEARCH max useful = 6.
 * Historical note: this was 2 with a buggy start=pageNum*25 offset that
 * skipped jobs 10-24 — scout was effectively getting ~20 jobs per combo with
 * gaps. Bumped to 4 alongside the offset fix for ~2x funnel size. */
const PAGES_PER_SEARCH = 4

async function phaseScout(
  page: Page,
  config: PipelineConfig,
  runId: string,
  activities: ActivityLogEntry[],
  onScoutProgress?: (update: ScoutProgressUpdate) => void,
  costTracker?: ReturnType<typeof createCostTracker>,
): Promise<DiscoveredJob[]> {
  console.log('[pipeline] Phase 1: SCOUT (multi-pass)')

  const existing = await getExistingApplications(config.userId)

  // Build the keyword list: use allKeywords if provided, else profile keywords, else defaults
  const keywords = (config.allKeywords && config.allKeywords.length > 0)
    ? config.allKeywords
    : (config.searchProfile.keywords && config.searchProfile.keywords.length > 0)
      ? config.searchProfile.keywords
      : DEFAULT_SCOUT_KEYWORDS

  // Build the location list: use allLocations if provided, else profile location, else defaults
  const locations = (config.allLocations && config.allLocations.length > 0)
    ? config.allLocations
    : config.searchProfile.location
      ? [config.searchProfile.location]
      : DEFAULT_SCOUT_LOCATIONS

  // Deduplicate keywords and locations (case-insensitive)
  const uniqueKeywords = [...new Set(keywords.map(k => k.trim()).filter(Boolean))]
  const uniqueLocations = [...new Set(locations.map(l => l.trim()).filter(Boolean))]

  const logEntry: ActivityLogEntry = {
    user_id: config.userId,
    run_id: runId,
    action: 'scout_start',
    reason: `Multi-pass: ${uniqueKeywords.length} keywords × ${uniqueLocations.length} locations × ${PAGES_PER_SEARCH} pages (keywords: ${uniqueKeywords.join(', ')})`,
  }
  fireLog(logEntry)
  activities.push(logEntry)

  // Use multi-pass scout for maximum coverage
  const multiPassConfig: MultiPassConfig = {
    keywords: uniqueKeywords,
    locations: uniqueLocations,
    pagesPerSearch: PAGES_PER_SEARCH,
    // Pass through per-search progress callback for live UI updates
    onSearchProgress: onScoutProgress,
  }

  // --- LinkedIn multi-pass ---
  const linkedinResult = await scoutJobsMultiPass(page, config.searchProfile, existing, multiPassConfig)

  // Track LinkedIn scout cost: keywords × locations × pages per search
  const linkedinSearches = uniqueKeywords.length * uniqueLocations.length
  const linkedinPages = linkedinSearches * PAGES_PER_SEARCH
  costTracker?.addScoutCost(linkedinPages * COST_LINKEDIN_PER_PAGE)

  const linkedinDone: ActivityLogEntry = {
    user_id: config.userId,
    run_id: runId,
    action: 'scout_linkedin_complete',
    reason: `LinkedIn: ${uniqueKeywords.length}kw × ${uniqueLocations.length}loc = ${uniqueKeywords.length * uniqueLocations.length} searches. Found ${linkedinResult.totalFound}, filtered ${linkedinResult.filteredOut}, unique: ${linkedinResult.jobs.length}`,
  }
  fireLog(linkedinDone)
  activities.push(linkedinDone)

  // Build dedup set for cross-source filtering
  const existingSet = new Set(existing)
  const excludedCompanies = config.searchProfile.excluded_companies ?? []

  // ─── PARALLEL SCOUT: API sources + browser sources ────────────────────
  // API sources (no browser needed) run in parallel via Promise.allSettled.
  // Browser sources (Wellfound, Dribbble) run in parallel on separate pages.
  // Both groups run concurrently — total time = max(API group, browser group).
  console.log('[pipeline] Phase 1b: SCOUT all secondary sources in parallel')

  // ATS allowlist for the focus filter below. Keep in sync with the working
  // auto-apply adapters in src/bot/adapters*. As of April 2026 Greenhouse and
  // LinkedIn Easy Apply are confirmed e2e, and Lever/Workable/Breezy have
  // partial support — we keep them in the funnel so the user can still review
  // and manually apply from the grid. Ashby/Workday/Gupy stay blocked.
  // `undefined`/`null` (= unknown ATS) are allowed through so we don't lose
  // RemoteOK/WWR/Jobicy listings that never resolve to a specific ATS.
  const ALLOWED_ATS = new Set([
    'greenhouse', 'lever', 'workable', 'breezy', 'breezyhr', 'breezy hr',
    'recruitee', 'teamtailor', 'manatal', 'linkedin', 'remoteok', 'wwr',
    'himalayas', 'remotive', 'jobicy', 'wellfound', 'dribbble', 'unknown',
  ])
  const BLOCKED_ATS = new Set(['ashby', 'workday', 'gupy'])

  // --- Helper: wrap a source in timeout + error handling ---
  const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T | null> =>
    Promise.race([
      promise,
      new Promise<null>((resolve) =>
        setTimeout(() => { console.warn(`[pipeline] ${label} timeout (${ms / 1000}s)`); resolve(null) }, ms)
      ),
    ])

  // --- API group (all run in parallel, no Playwright needed) ---
  const remoteokTags = [
    'design', 'ux', 'ui', 'product-designer', 'ux-designer',
    'ui-designer', 'visual-designer', 'design-system',
  ]
  const himalayasTerms = [
    'product designer', 'ux designer', 'ui designer',
    'design lead', 'design system',
  ]
  const remotiveTerms = [
    'product designer', 'ux designer', 'ui designer',
    'design lead', 'design system', 'visual designer',
  ]
  const wwrCategories = ['design', 'product']
  const jobicyTerms = [
    'product designer', 'ux designer', 'ui designer',
    'design lead', 'design system',
  ]
  const wellfoundKeywords = uniqueKeywords.slice(0, 4)
  const dribbbleKeywords = uniqueKeywords.slice(0, 4)

  const [
    remoteokResult,
    himalayasResult,
    remotiveResult,
    wwrResult,
    jobicyResult,
    wellfoundResult,
    dribbbleResult,
  ] = await Promise.allSettled([
    // --- API sources (no browser) ---
    withTimeout(scoutRemoteOK(remoteokTags, excludedCompanies), 60_000, 'RemoteOK'),
    withTimeout(scoutHimalayas(himalayasTerms, excludedCompanies), 60_000, 'Himalayas'),
    withTimeout(scoutRemotive(remotiveTerms, excludedCompanies), 60_000, 'Remotive'),
    withTimeout(scoutWWR(wwrCategories, excludedCompanies), 60_000, 'WWR'),
    withTimeout(scoutJobicy(jobicyTerms, excludedCompanies), 60_000, 'Jobicy'),
    // --- Browser sources (separate pages, safe to run in parallel) ---
    withTimeout((async () => {
      const wellfoundPage = await page.context().newPage()
      try {
        return await scoutWellfound(wellfoundPage, wellfoundKeywords, excludedCompanies)
      } finally {
        await wellfoundPage.close().catch(() => {})
      }
    })(), 90_000, 'Wellfound'),
    withTimeout((async () => {
      const dribbblePage = await page.context().newPage()
      try {
        return await scoutDribbble(dribbblePage, dribbbleKeywords, excludedCompanies)
      } finally {
        await dribbblePage.close().catch(() => {})
      }
    })(), 90_000, 'Dribbble'),
  ])

  // --- Extract results + log each source ---
  const extractResult = (
    result: PromiseSettledResult<DiscoveredJob[] | null>,
    sourceName: string,
    costPerPage: number,
    pageCount: number,
  ): DiscoveredJob[] => {
    if (result.status === 'rejected') {
      console.warn(`[pipeline] ${sourceName} scout failed:`, result.reason?.message ?? result.reason)
      const errEntry: ActivityLogEntry = {
        user_id: config.userId, run_id: runId,
        action: `scout_${sourceName.toLowerCase()}_error`,
        reason: `${sourceName} failed: ${result.reason?.message ?? result.reason}`,
      }
      fireLog(errEntry)
      activities.push(errEntry)
      return []
    }

    const jobs = result.value ?? []

    // Filter out already-applied jobs
    const filtered = jobs.filter(j => {
      const dedupKey = `${normalizeForDedup(j.company)}|${normalizeForDedup(j.title)}`
      return !existingSet.has(dedupKey)
    })

    costTracker?.addScoutCost(pageCount * costPerPage)

    const doneEntry: ActivityLogEntry = {
      user_id: config.userId, run_id: runId,
      action: `scout_${sourceName.toLowerCase()}_complete`,
      reason: `${sourceName}: found ${filtered.length} unique design jobs`,
    }
    fireLog(doneEntry)
    activities.push(doneEntry)

    return filtered
  }

  const remoteokJobs = extractResult(remoteokResult, 'RemoteOK', COST_REMOTEOK_PER_PAGE, remoteokTags.length)
  const himalayasJobs = extractResult(himalayasResult, 'Himalayas', COST_HIMALAYAS_PER_PAGE, himalayasTerms.length)
  const remotiveJobs = extractResult(remotiveResult, 'Remotive', COST_REMOTIVE_PER_PAGE, remotiveTerms.length)
  const wwrJobs = extractResult(wwrResult, 'WWR', COST_WWR_PER_PAGE, wwrCategories.length)
  const jobicyJobs = extractResult(jobicyResult, 'Jobicy', COST_JOBICY_PER_PAGE, jobicyTerms.length)
  const wellfoundJobs = extractResult(wellfoundResult, 'Wellfound', COST_WELLFOUND_PER_PAGE, wellfoundKeywords.length)
  const dribbbleJobs = extractResult(dribbbleResult, 'Dribbble', COST_DRIBBBLE_PER_PAGE, dribbbleKeywords.length)

  // ─── ATS tagging (defense in depth) ───────────────────────────────────
  // Per-source scouts already classify ats via classifyAtsFromUrl → detectAts,
  // but we defensively re-tag here so any job that reached this point with a
  // null/undefined/empty ats still gets a detection from its final URL.
  // This handles: (a) legacy scout code paths missed in refactor, (b) jobs
  // where the scout-time classifier returned null, and (c) future sources
  // added without remembering to tag.
  const allBoardsJobs: DiscoveredJob[] = [
    ...remoteokJobs, ...himalayasJobs, ...remotiveJobs, ...wwrJobs,
    ...jobicyJobs, ...wellfoundJobs, ...dribbbleJobs,
  ]
  let reclassified = 0
  let leakedAggregators = 0
  for (const job of allBoardsJobs) {
    if (!job.ats || job.ats === 'unknown') {
      const detected = detectAts(job.url)
      if (detected !== 'unknown') {
        job.ats = detected
        reclassified++
      } else if (isAggregatorUrl(job.url)) {
        // URL is still on a known aggregator host → the scout's resolution
        // step fell back. Tag 'unknown' explicitly so downstream filters
        // can spot it.
        job.ats = 'unknown'
        leakedAggregators++
      }
    }
  }

  // ─── Telemetry: ATS distribution across ALL board-sourced jobs ────────
  const distribution = atsDistribution(allBoardsJobs)
  const distStr = distribution.map(([ats, n]) => `${n} ${ats}`).join(', ')
  console.log(`[scout-boards] ATS resolution: ${distStr || '(empty)'}`)
  console.log(`[scout-boards] Reclassified ${reclassified} jobs via detectAts, ${leakedAggregators} aggregator URLs leaked through (ats=unknown)`)

  const atsDistEntry: ActivityLogEntry = {
    user_id: config.userId, run_id: runId,
    action: 'scout_ats_distribution',
    reason: `ATS distribution (boards, pre-merge): ${distStr || 'empty'}; reclassified=${reclassified}, leaked_aggregators=${leakedAggregators}`,
  }
  fireLog(atsDistEntry)
  activities.push(atsDistEntry)

  // --- Merge & cross-source dedup ---
  //
  // Focus scope (April 2026 post-migration): we only auto-apply reliably to
  // Greenhouse and LinkedIn Easy Apply. Every other ATS is broken in the
  // extension-based apply flow, so we drop them here rather than wasting
  // qualify LLM calls / user review time on jobs we can't actually submit.
  //
  // Two rules enforced in this block:
  //   1. LinkedIn jobs are only kept if `isEasyApply === true`. Non-EA
  //      LinkedIn postings redirect the user to Lever/Workable/Ashby/etc
  //      which are currently broken.
  //   2. Job-board scouts (RemoteOK/WWR/Himalayas/etc) must have resolved
  //      their URL to a real Greenhouse link during scout-time parsing
  //      (scout-boards.ts extractAtsUrlFromHtml). Untagged jobs (ats=null)
  //      and jobs tagged with any non-Greenhouse ATS are dropped.
  //
  // LinkedIn scout-level filter note: the LinkedIn scout itself currently
  // does NOT set isEasyApply reliably — see Phase 2 fix. Until then, this
  // filter may drop all LinkedIn jobs. That's safer than letting non-EA
  // jobs through.

  const easyApplyLinkedin = linkedinResult.jobs.filter(j => j.isEasyApply === true)
  const droppedLinkedinNonEa = linkedinResult.jobs.length - easyApplyLinkedin.length
  if (droppedLinkedinNonEa > 0) {
    console.log(`[pipeline] Focus filter: dropped ${droppedLinkedinNonEa} LinkedIn non-EasyApply jobs`)
  }

  const mergedJobs: DiscoveredJob[] = [...easyApplyLinkedin]
  const seenCompanyTitle = new Set<string>()

  // Index EA LinkedIn jobs for cross-source dedup
  for (const job of easyApplyLinkedin) {
    const key = `${normalizeForDedup(job.company)}|${normalizeForDedup(job.title)}`
    seenCompanyTitle.add(key)
  }

  // Merge helper: focus filter + dedup against seen set, return drop counts
  // Returns { dupes, blockedAts } so we can surface per-source funnel telemetry.
  const mergeWithDedup = (jobs: DiscoveredJob[]): { dupes: number; blockedAts: number } => {
    let dupes = 0
    let blockedAts = 0
    for (const job of jobs) {
      // Focus filter: drop ONLY the hard-blocked ATSes (Ashby/Workday/Gupy).
      // Everything else — including unknown/null ATS — is allowed through so
      // the user still gets RemoteOK/WWR/Jobicy/Remotive/Himalayas listings
      // in the grid even when the ATS couldn't be resolved at scout time.
      const atsKey = (job.ats ?? 'unknown').toLowerCase()
      if (BLOCKED_ATS.has(atsKey)) {
        blockedAts++
        continue
      }
      const key = `${normalizeForDedup(job.company)}|${normalizeForDedup(job.title)}`
      if (seenCompanyTitle.has(key)) { dupes++; continue }
      seenCompanyTitle.add(key)
      mergedJobs.push(job)
    }
    return { dupes, blockedAts }
  }

  const remoteokMerge = mergeWithDedup(remoteokJobs)
  const wellfoundMerge = mergeWithDedup(wellfoundJobs)
  const himalayasMerge = mergeWithDedup(himalayasJobs)
  const remotiveMerge = mergeWithDedup(remotiveJobs)
  const wwrMerge = mergeWithDedup(wwrJobs)
  const jobicyMerge = mergeWithDedup(jobicyJobs)
  const dribbbleMerge = mergeWithDedup(dribbbleJobs)

  const dedupCounts = {
    remoteok: remoteokMerge.dupes,
    wellfound: wellfoundMerge.dupes,
    himalayas: himalayasMerge.dupes,
    remotive: remotiveMerge.dupes,
    wwr: wwrMerge.dupes,
    jobicy: jobicyMerge.dupes,
    dribbble: dribbbleMerge.dupes,
  }

  const blockedAtsCounts = {
    remoteok: remoteokMerge.blockedAts,
    wellfound: wellfoundMerge.blockedAts,
    himalayas: himalayasMerge.blockedAts,
    remotive: remotiveMerge.blockedAts,
    wwr: wwrMerge.blockedAts,
    jobicy: jobicyMerge.blockedAts,
    dribbble: dribbbleMerge.blockedAts,
  }
  const totalBlockedAts = Object.values(blockedAtsCounts).reduce((a, b) => a + b, 0)
  if (totalBlockedAts > 0) {
    const blockedAtsEntry: ActivityLogEntry = {
      user_id: config.userId, run_id: runId,
      action: 'scout_ats_blocked',
      reason: `Focus filter dropped ${totalBlockedAts} blocked-ATS jobs (Ashby/Workday/Gupy): ${Object.entries(blockedAtsCounts).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`).join(', ')}`,
    }
    fireLog(blockedAtsEntry)
    activities.push(blockedAtsEntry)
  }

  const totalDedup = Object.values(dedupCounts).reduce((a, b) => a + b, 0)
  if (totalDedup > 0) {
    console.log(`[pipeline] Cross-source dedup: removed ${totalDedup} duplicates (${Object.entries(dedupCounts).map(([k, v]) => `${k}: ${v}`).join(', ')})`)
  }

  const sourceCounts = {
    LinkedIn: linkedinResult.jobs.length,
    RemoteOK: remoteokJobs.length,
    Wellfound: wellfoundJobs.length,
    Himalayas: himalayasJobs.length,
    Remotive: remotiveJobs.length,
    WWR: wwrJobs.length,
    Jobicy: jobicyJobs.length,
    Dribbble: dribbbleJobs.length,
  }

  console.log(
    `[pipeline] Scout complete: ${Object.entries(sourceCounts).map(([k, v]) => `${k} ${v}`).join(' + ')} - ${totalDedup} dupes = ${mergedJobs.length} unique candidates`,
  )

  const scoutDone: ActivityLogEntry = {
    user_id: config.userId,
    run_id: runId,
    action: 'scout_complete',
    reason: `${Object.entries(sourceCounts).map(([k, v]) => `${k}: ${v}`).join(', ')}, dedup: -${totalDedup}, total: ${mergedJobs.length}`,
  }
  fireLog(scoutDone)
  activities.push(scoutDone)

  fireUpdate(runId, { jobs_found: mergedJobs.length })

  return mergedJobs
}

// ---------------------------------------------------------------------------
// Phase 2: Qualify
// ---------------------------------------------------------------------------

interface QualifiedJob {
  job: DiscoveredJob
  qualification: QualificationResult
}

async function phaseQualify(
  page: Page,
  jobs: DiscoveredJob[],
  config: PipelineConfig,
  runId: string,
  activities: ActivityLogEntry[],
  onQualifyProgress?: (update: { action: string; company?: string; role?: string; reason?: string; processed?: number; qualified?: number; preFiltered?: number }) => void,
  costTracker?: ReturnType<typeof createCostTracker>,
): Promise<QualifiedJob[]> {
  console.log(`[pipeline] Phase 2: QUALIFY (${jobs.length} candidates)`)

  // -------------------------------------------------------------------------
  // Pass 1: Rules-based pre-filter (instant, $0 cost)
  // -------------------------------------------------------------------------
  const { survivors, stats } = preQualifyBatch(
    jobs.map(j => ({ title: j.title, company: j.company, location: j.location, url: j.url })),
    APPLICANT,
    { excludedCompanies: config.searchProfile.excluded_companies ?? null, keywords: config.searchProfile.keywords ?? [] },
  )

  const preFilterSummary = formatPreQualifyStats(stats)
  console.log(`[pipeline] ${preFilterSummary}`)

  // Log pre-filter results
  const preFilterEntry: ActivityLogEntry = {
    user_id: config.userId,
    run_id: runId,
    action: 'qualify_prefilter',
    reason: preFilterSummary,
  }
  fireLog(preFilterEntry)
  activities.push(preFilterEntry)
  onQualifyProgress?.({ action: 'found', reason: preFilterSummary, preFiltered: stats.filtered })

  // Map surviving URLs back to DiscoveredJob objects
  const survivorUrls = new Set(survivors.map(s => s.url))
  let survivingJobs = jobs.filter(j => survivorUrls.has(j.url))

  if (survivingJobs.length === 0) {
    console.log('[pipeline] All jobs eliminated by pre-filter. No Haiku calls needed.')
    return []
  }

  // -------------------------------------------------------------------------
  // Pass 1b: URL-based dedup against existing applications in kanban
  // -------------------------------------------------------------------------
  try {
    const { urls: existingAppUrls } = await getExistingApplicationsWithUrls(config.userId)
    if (existingAppUrls.length > 0) {
      const existingUrlSet = new Set(existingAppUrls)
      const beforeCount = survivingJobs.length
      survivingJobs = survivingJobs.filter(j => !existingUrlSet.has(j.url))
      const urlDedupCount = beforeCount - survivingJobs.length
      if (urlDedupCount > 0) {
        console.log(`[pipeline] URL dedup: filtered ${urlDedupCount} jobs already in kanban (by URL match)`)
        const urlDedupEntry: ActivityLogEntry = {
          user_id: config.userId,
          run_id: runId,
          action: 'qualify_url_dedup',
          reason: `Filtered ${urlDedupCount} jobs already applied (URL match)`,
        }
        fireLog(urlDedupEntry)
        activities.push(urlDedupEntry)
      }
    }
  } catch (e) {
    console.warn(`[pipeline] URL dedup check failed (non-critical): ${(e as Error).message}`)
  }

  if (survivingJobs.length === 0) {
    console.log('[pipeline] All jobs eliminated after URL dedup. No Haiku calls needed.')
    return []
  }

  // -------------------------------------------------------------------------
  // Pass 1c: Expiration check — filter out dead/expired job postings
  // -------------------------------------------------------------------------
  const { alive: aliveJobs, expiredCount } = await filterExpiredJobs(survivingJobs)
  if (expiredCount > 0) {
    console.log(`[pipeline] Filtered ${expiredCount} expired jobs before qualifying`)
    const expiredEntry: ActivityLogEntry = {
      user_id: config.userId,
      run_id: runId,
      action: 'qualify_expired_filter',
      reason: `Filtered ${expiredCount} expired jobs before qualifying`,
    }
    fireLog(expiredEntry)
    activities.push(expiredEntry)
    onQualifyProgress?.({ action: 'found', reason: `Filtered ${expiredCount} expired job postings` })
  }
  survivingJobs = aliveJobs

  if (survivingJobs.length === 0) {
    console.log('[pipeline] All jobs expired or filtered. No Haiku calls needed.')
    return []
  }

  // -------------------------------------------------------------------------
  // Pass 2: LLM scoring (only on Pass 1 survivors)
  // -------------------------------------------------------------------------
  console.log(`[pipeline] Pass 2: Sending ${survivingJobs.length} jobs to Haiku`)

  clearQualificationCache()
  const qualified: QualifiedJob[] = []

  // Dedup by normalized company+title (scout may return dupes with different URL params)
  const qualifySeenKeys = new Set<string>()
  const dedupedSurvivors = survivingJobs.filter(j => {
    const key = `${j.company.toLowerCase().trim()}|${j.title.toLowerCase().trim()}`
    if (qualifySeenKeys.has(key)) return false
    qualifySeenKeys.add(key)
    return true
  })
  if (dedupedSurvivors.length < survivingJobs.length) {
    console.log(`[pipeline] Deduped ${survivingJobs.length - dedupedSurvivors.length} duplicate jobs in qualify phase`)
  }

  // -------------------------------------------------------------------------
  // Step 2a: Extract JDs — TWO-PHASE strategy for maximum speed
  //   Phase A: fetch() + cheerio in parallel (10 concurrent, ~0.3s each)
  //   Phase B: Playwright fallback only for fetch failures (2 concurrent)
  // -------------------------------------------------------------------------
  const jobsWithJD: Array<{ job: DiscoveredJob; jd: string }> = []
  let extractedCount = 0

  // Split jobs: pre-fetched (no browser needed) vs need extraction
  const preFetchedJobs = dedupedSurvivors.filter(j => j.description && j.description.length > 100)
  const needExtractionJobs = dedupedSurvivors.filter(j => !j.description || j.description.length <= 100)

  // Process pre-fetched JDs immediately (no browser cost)
  for (const job of preFetchedJobs) {
    jobsWithJD.push({ job, jd: job.description! })
    extractedCount++
    console.log(`[pipeline] Using pre-fetched JD for ${job.company} (${job.description!.length} chars)`)
  }

  if (needExtractionJobs.length > 0) {
    // --- Phase A: Parallel fetch-based extraction (10 concurrent, no browser) ---
    const FETCH_CONCURRENCY = 10
    const fetchQueue = [...needExtractionJobs]
    const fetchFailures: DiscoveredJob[] = [] // jobs that need Playwright fallback

    console.log(`[pipeline] Phase A: fetch-based JD extraction for ${needExtractionJobs.length} jobs (${FETCH_CONCURRENCY} concurrent)`)

    async function fetchJdWorker(): Promise<void> {
      while (fetchQueue.length > 0) {
        const job = fetchQueue.shift()
        if (!job) break

        extractedCount++
        onQualifyProgress?.({
          action: 'found',
          company: job.company,
          role: job.title,
          reason: `Extracting JD [${extractedCount}/${dedupedSurvivors.length}]: "${job.title}" at ${job.company}...`,
          processed: extractedCount,
          qualified: qualified.length,
          preFiltered: stats.filtered,
        })

        const fetchedJd = await extractJdViaFetch(job.url)
        if (fetchedJd.length >= 50) {
          jobsWithJD.push({ job, jd: fetchedJd })
        } else {
          fetchFailures.push(job)
        }
      }
    }

    const fetchWorkerCount = Math.min(FETCH_CONCURRENCY, needExtractionJobs.length)
    await Promise.all(Array.from({ length: fetchWorkerCount }, () => fetchJdWorker()))

    const fetchSuccessCount = needExtractionJobs.length - fetchFailures.length
    console.log(`[pipeline] Phase A complete: ${fetchSuccessCount} via fetch, ${fetchFailures.length} need Playwright`)

    // --- Phase B: Playwright fallback for fetch failures only ---
    if (fetchFailures.length > 0) {
      const PW_CONCURRENCY = 3 // Higher than before (was 2) because most heavy lifting done by fetch
      const pwQueue = [...fetchFailures]

      async function pwJdWorker(workerPage: Page) {
        while (pwQueue.length > 0) {
          const job = pwQueue.shift()
          if (!job) break

          let jobDescription = ''
          try {
            jobDescription = await extractJobDescription(workerPage, job.url)
          } catch (extractErr) {
            console.warn(`[pipeline] Playwright JD extraction error for ${job.company}: ${(extractErr as Error).message}`)
          }

          // Fallback: build synthetic JD from scout metadata
          if (jobDescription.length < 50) {
            console.log(`[pipeline] JD too short for ${job.company} — using fallback metadata`)
            jobDescription = [
              `Job Title: ${job.title}`,
              `Company: ${job.company}`,
              `Location: ${job.location || 'Not specified'}`,
              ``,
              `NOTE: Full job description could not be extracted.`,
              `Score based on title, company, and location. Give benefit of the doubt.`,
            ].join('\n')
          }

          jobsWithJD.push({ job, jd: jobDescription })
          await humanDelay(500, 300)
        }
      }

      const workerCount = Math.min(PW_CONCURRENCY, fetchFailures.length)
      const workerPages: Page[] = []
      console.log(`[pipeline] Phase B: Playwright fallback for ${fetchFailures.length} jobs (${workerCount} concurrent)`)

      try {
        const ctx = page.context()
        for (let i = 0; i < workerCount; i++) {
          const wp = await ctx.newPage()
          workerPages.push(wp)
        }
        await Promise.all(workerPages.map(wp => pwJdWorker(wp)))
      } finally {
        for (const wp of workerPages) {
          await wp.close().catch(() => {})
        }
      }
    }
  }

  console.log(`[pipeline] JD extraction complete: ${jobsWithJD.length} jobs (${preFetchedJobs.length} pre-fetched, ${needExtractionJobs.length} extracted)`)

  // -------------------------------------------------------------------------
  // Step 2a.5: Filter out corrupted JDs BEFORE spending Haiku tokens.
  // LinkedIn login walls and SPA shells pass the length gate (they are long
  // blobs of HTML) but contain zero real job description content. Haiku
  // correctly returns score 0, but that wastes ~$0.003/call and pollutes the
  // activity log with misleading disqualifications. Detect them cheaply via
  // string markers, log loudly, and skip the Haiku call entirely.
  // -------------------------------------------------------------------------
  const { detectCorruptJd } = await import('./qualifier-core.js')
  const cleanJobsWithJD: typeof jobsWithJD = []
  let corruptCount = 0
  for (const entry of jobsWithJD) {
    const corruptReason = detectCorruptJd(entry.jd)
    if (corruptReason) {
      corruptCount++
      console.warn(
        `[pipeline] Corrupted JD for ${entry.job.company}/${entry.job.title}: ${corruptReason}`,
      )
      const corruptEntry: ActivityLogEntry = {
        user_id: config.userId,
        run_id: runId,
        action: 'qualify_skipped_corrupt_jd',
        company: entry.job.company,
        role: entry.job.title,
        reason: `Manual review needed — ${corruptReason}. URL: ${entry.job.url}`,
      }
      fireLog(corruptEntry)
      activities.push(corruptEntry)
    } else {
      cleanJobsWithJD.push(entry)
    }
  }
  if (corruptCount > 0) {
    console.log(
      `[pipeline] Skipped ${corruptCount}/${jobsWithJD.length} jobs with corrupted JDs (login walls, SPA shells, etc.)`,
    )
  }

  // Step 2b: Qualify via Haiku in parallel batches of QUALIFY_BATCH_SIZE
  // -------------------------------------------------------------------------
  const QUALIFY_BATCH_SIZE = 15 // Increased from 10 — Haiku handles higher concurrency well
  let processedCount = 0

  console.log(`[pipeline] Qualifying ${cleanJobsWithJD.length} jobs in parallel batches of ${QUALIFY_BATCH_SIZE}`)

  for (let batchStart = 0; batchStart < cleanJobsWithJD.length; batchStart += QUALIFY_BATCH_SIZE) {
    const batch = cleanJobsWithJD.slice(batchStart, batchStart + QUALIFY_BATCH_SIZE)
    const batchNum = Math.floor(batchStart / QUALIFY_BATCH_SIZE) + 1
    const totalBatches = Math.ceil(cleanJobsWithJD.length / QUALIFY_BATCH_SIZE)
    console.log(`[pipeline] Haiku batch ${batchNum}/${totalBatches} (${batch.length} jobs)`)

    const batchResults = await Promise.all(
      batch.map(async ({ job, jd }) => {
        try {
          const result = await qualifyJob(jd, config.searchProfile, APPLICANT)
          return { job, result, error: null as Error | null }
        } catch (err) {
          return { job, result: null as QualificationResult | null, error: err as Error }
        }
      }),
    )

    // Track Haiku cost for this batch (each call costs ~$0.003)
    costTracker?.addQualifyCost(batch.length * COST_HAIKU_PER_CALL)

    // Process batch results sequentially (for logging and progress updates)
    for (const { job, result, error } of batchResults) {
      processedCount++

      if (error || !result) {
        console.warn(
          `[pipeline] Qualification error for ${job.company}:`,
          error?.message ?? 'unknown error',
        )
        const errEntry: ActivityLogEntry = {
          user_id: config.userId,
          run_id: runId,
          action: 'qualify_error',
          company: job.company,
          role: job.title,
          reason: error?.message ?? 'unknown error',
        }
        fireLog(errEntry)
        activities.push(errEntry)
        continue
      }

      const qualEntry: ActivityLogEntry = {
        user_id: config.userId,
        run_id: runId,
        action: result.score >= config.minScore ? 'qualify_pass' : 'qualify_fail',
        company: job.company,
        role: job.title,
        reason: `Score ${result.score}: ${result.reasoning}`,
      }
      fireLog(qualEntry)
      activities.push(qualEntry)

      // Emit progress after qualification
      onQualifyProgress?.({
        action: result.score >= config.minScore ? 'qualified' : 'disqualified',
        company: job.company,
        role: job.title,
        reason: `Score ${result.score}: ${result.reasoning}`,
        processed: processedCount,
        qualified: qualified.length + (result.score >= config.minScore ? 1 : 0),
        preFiltered: stats.filtered,
      })

      if (result.score >= config.minScore) {
        qualified.push({ job, qualification: result })

        // Stream-write this qualified job to job_listings IMMEDIATELY so the
        // frontend's 5s polling can display it while the scout is still
        // running (progressive reveal). Best-effort — failures are logged
        // and ignored. Duplicate writes are idempotent via the
        // (user_id, link) unique index from migration 004.
        upsertDiscoveredJobListing(config.userId, {
          company: job.company,
          role: job.title,
          location: job.location || undefined,
          link: job.url,
          ats: job.ats,
          qualificationScore: result.score,
          qualificationResult: result as unknown as Record<string, unknown>,
          workArrangement: /remote/i.test(job.location || '') ? 'remote' : undefined,
        }).catch((err) =>
          console.warn(
            `[pipeline] stream-write failed for ${job.company}/${job.title}: ${(err as Error).message}`,
          ),
        )
      }
    }
  }

  console.log(`[pipeline] Qualified: ${qualified.length}/${jobs.length} (${stats.filtered} pre-filtered, ${survivingJobs.length} scored by AI)`)
  return qualified
}

// ---------------------------------------------------------------------------
// Persist discovered/qualified jobs to `job_listings`
//
// WHY: OpenJobsView filters job_listings by qualification_score >= 50, but
// before this helper the scout never wrote a row — createApplicationFromBot
// only inserted reactively AFTER an apply. So the dashboard had no source of
// "discovered but not yet applied" jobs and fell back to SAMPLE_JOBS.
//
// This helper iterates each qualified job and upserts it into job_listings
// keyed on (user_id, link) via the unique constraint from migration 004.
// Failures are logged but never thrown — persistence is best-effort.
// ---------------------------------------------------------------------------
async function persistDiscoveredJobs(
  userId: string,
  qualifiedJobs: Array<{
    job: { title: string; company: string; location: string; url: string; ats?: string; isEasyApply?: boolean }
    qualification: QualificationResult
  }>,
): Promise<{ upserted: number; failed: number }> {
  if (!qualifiedJobs.length) return { upserted: 0, failed: 0 }

  let upserted = 0
  let failed = 0

  await Promise.all(
    qualifiedJobs.map(async ({ job, qualification }) => {
      try {
        const id = await upsertDiscoveredJobListing(userId, {
          company: job.company,
          role: job.title,
          location: job.location || undefined,
          link: job.url,
          ats: job.ats,
          qualificationScore: qualification.score,
          qualificationResult: qualification as unknown as Record<string, unknown>,
          workArrangement: /remote/i.test(job.location || '') ? 'remote' : undefined,
        })
        if (id) upserted++
        else failed++
      } catch (err) {
        failed++
        console.warn(
          `[pipeline] persistDiscoveredJobs: upsert failed for ${job.company}/${job.title}: ${(err as Error).message}`,
        )
      }
    }),
  )

  console.log(
    `[pipeline] persistDiscoveredJobs: ${upserted}/${qualifiedJobs.length} upserted (${failed} failed)`,
  )
  return { upserted, failed }
}

// ---------------------------------------------------------------------------
// Phase 3: Apply — handled by separate apply-jobs.ts trigger task
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main pipeline orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the Scout → Qualify pipeline.
 * Apply is handled separately by the apply-jobs.ts trigger task.
 *
 * @param config - Pipeline configuration including user, search profile, and limits
 * @returns Summary of the pipeline run
 */
export async function runPipeline(config: PipelineConfig & { onProgress?: (p: PipelineProgress) => void }): Promise<PipelineResult> {
  const startTime = Date.now()
  const activities: ActivityLogEntry[] = []
  const progressActivities: PipelineProgress['activities'] = []
  const costTracker = createCostTracker()

  // fireLog / fireUpdate are module-level — see top of file

  // Default values
  const minScore = config.minScore ?? 45
  const maxApplications = config.maxApplications ?? 20
  const effectiveConfig = { ...config, minScore, maxApplications }

  // Counters — declared early so emitProgress can reference them
  let jobsFound = 0
  let jobsQualified = 0
  let jobsApplied = 0
  let jobsSkipped = 0
  let jobsFailed = 0
  let discoveredJobsOutput: PipelineResult['discoveredJobs'] = []
  let qualifiedJobsOutput: QualifiedJobOutput[] = []

  // Helper to emit progress
  const emitProgress = (phase: PipelineProgress['phase'], extra?: Partial<PipelineProgress>) => {
    if (!config.onProgress) return
    config.onProgress({
      phase,
      jobsFound,
      jobsProcessed: 0,
      jobsQualified,
      jobsPreFiltered: 0,
      currentJob: null,
      activities: [...progressActivities],
      ...extra,
    })
  }

  // Helper to add a progress activity
  const addProgressActivity = (entry: { action: string; company?: string; role?: string; reason?: string }) => {
    progressActivities.unshift({ ...entry, timestamp: new Date().toISOString() })
    // Keep only last 30 activities
    if (progressActivities.length > 30) progressActivities.length = 30
  }

  // Clean up zombie runs — non-critical, don't block pipeline if Supabase is slow
  try {
    await Promise.race([
      cleanupZombieRuns(config.userId),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)), // 5s timeout
    ])
  } catch (e) {
    console.warn('[pipeline] cleanupZombieRuns failed:', (e as Error).message)
  }

  // Create a bot run record — non-critical, use local fallback ID if Supabase is down.
  // If the caller pre-created a runId (e.g. /api/trigger-scout returning
  // the id to the client before the heavy work starts), reuse it instead.
  let runId: string
  if (config.runId) {
    runId = config.runId
    console.log(`[pipeline] Reusing pre-created runId: ${runId}`)
  } else {
    try {
      runId = await Promise.race([
        createBotRun(config.userId, config.searchProfile.id),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('createBotRun timeout (10s)')), 10_000)
        ),
      ])
    } catch (e) {
      // Generate local run ID as a valid UUID v4 so downstream Supabase inserts
      // (logBotActivity, updateBotRun) don't fail with "invalid input syntax for type uuid".
      runId = crypto.randomUUID()
      console.warn(`[pipeline] createBotRun failed: ${(e as Error).message} — using local runId: ${runId}`)
    }
  }

  console.log(`[pipeline] Starting run ${runId} (dryRun: ${config.dryRun}, skipApply: ${config.skipApply ?? false})`)

  const startEntry: ActivityLogEntry = {
    user_id: config.userId,
    run_id: runId,
    action: 'pipeline_start',
    reason: `Profile: ${config.searchProfile.name}, max: ${maxApplications}, dryRun: ${config.dryRun}`,
  }
  // logBotActivity is non-critical — fire and forget
  logBotActivity(startEntry).catch((e) => console.warn('[pipeline] logBotActivity failed:', (e as Error).message))
  activities.push(startEntry)
  addProgressActivity({ action: 'found', reason: startEntry.reason ?? '' })
  emitProgress('starting')

  // Use pre-authenticated context if provided (LinkedIn cookie), else create new
  let context: BrowserContext | null = null
  let page: Page | null = null
  let reconnectedContext: BrowserContext | null = null // For SBR reconnection in qualify phase
  const ownsContext = !config.browserContext // only close context if we created it

  try {
    if (config.browserContext) {
      context = config.browserContext
    } else {
      // browser.newContext() can hang if the CDP connection is a zombie — wrap with 15s timeout
      try {
        context = await Promise.race([
          config.browser.newContext({
            viewport: { width: 1280, height: 900 },
            userAgent:
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            locale: 'en-US',
            timezoneId: 'Asia/Bangkok',
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('browser.newContext() timeout (15s) — zombie CDP?')), 15_000)
          ),
        ])
      } catch (ctxErr) {
        console.warn(`[pipeline] newContext failed: ${(ctxErr as Error).message} — launching local Chromium`)
        const { chromium } = await import('playwright')
        const localBrowser = await chromium.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        })
        context = await localBrowser.newContext({
          viewport: { width: 1280, height: 900 },
          userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          locale: 'en-US',
          timezoneId: 'Asia/Bangkok',
        })
      }
    }

    // Block images, CSS, fonts, media, and trackers to reduce Bright Data bandwidth (~70% savings)
    await blockUnnecessaryResources(context, 'aggressive')

    page = await context.newPage()

    // --- Phase 1: Scout ---
    addProgressActivity({ action: 'found', reason: `Keywords: ${config.searchProfile.keywords?.join(', ') ?? 'default'}` })
    emitProgress('scout')
    const discoveredJobs = await phaseScout(page, effectiveConfig, runId, activities,
      // Per-search progress callback: fires after each keyword x location search
      (update) => {
        jobsFound = update.totalUniqueJobs
        addProgressActivity({
          action: 'found',
          reason: `Searching '${update.keyword}' in ${update.location}... (${update.searchIndex + 1}/${update.totalSearches}) — ${update.totalUniqueJobs} unique so far`,
        })
        emitProgress('scout', {
          jobsFound: update.totalUniqueJobs,
          // Encode scout sub-progress: searchIndex/totalSearches for frontend % calc
          jobsProcessed: update.searchIndex + 1,
          scoutSearchesTotal: update.totalSearches,
        })
      },
      costTracker,
    )
    jobsFound = discoveredJobs.length
    addProgressActivity({ action: 'found', reason: `Found ${jobsFound} candidates from LinkedIn` })
    emitProgress('scout', { jobsFound })

    if (discoveredJobs.length === 0) {
      console.log('[pipeline] No jobs found — ending early')
      fireUpdate(runId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        jobs_found: 0,
        jobs_applied: 0,
        jobs_skipped: 0,
        jobs_failed: 0,
      })

      return {
        runId,
        jobsFound: 0,
        jobsQualified: 0,
        jobsApplied: 0,
        jobsSkipped: 0,
        jobsFailed: 0,
        duration: Date.now() - startTime,
        costEstimate: costTracker.toEstimate(),
        activities,
      }
    }

    // --- Phase 2: Qualify (inline — rules pre-filter + Haiku scoring) ---
    // SBR sessions can die mid-scout (long-running CDP connections drop).
    // Test if the browser context is still alive; if not, reconnect.
    let qualifyPage = page!
    try {
      // Probe: if this throws, the context is dead
      await page!.context().newPage().then(p => p.close())
    } catch {
      console.warn('[pipeline] Browser context died during scout — reconnecting for qualify phase')
      const logEntry: ActivityLogEntry = {
        user_id: config.userId,
        run_id: runId,
        action: 'pipeline_reconnect',
        reason: 'SBR session died, reconnecting browser for JD extraction',
      }
      fireLog(logEntry)
      activities.push(logEntry)

      try {
        const { chromium } = await import('playwright')
        // Try SBR reconnect first (30s timeout to avoid hangs)
        const sbrAuth = (process.env.BRIGHTDATA_SBR_AUTH || '').trim() || undefined
        let reconnected = false
        if (sbrAuth) {
          try {
            const newBrowser = await Promise.race([
              chromium.connectOverCDP(`wss://${sbrAuth}@brd.superproxy.io:9222`),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('SBR reconnect timeout (30s)')), 30_000)
              ),
            ])
            reconnectedContext = newBrowser.contexts()[0] || await Promise.race([
              newBrowser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true }),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('SBR newContext timeout (10s)')), 10_000)
              ),
            ])
            reconnected = true
          } catch (sbrErr) {
            console.warn(`[pipeline] SBR reconnect failed: ${(sbrErr as Error).message} — using local Chromium`)
          }
        }
        if (!reconnected) {
          // Local Chromium fallback
          const newBrowser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                   '--disable-gpu', '--single-process', '--js-flags=--max-old-space-size=256'],
          })
          reconnectedContext = await newBrowser.newContext({
            viewport: { width: 1280, height: 900 },
            ignoreHTTPSErrors: true,
          })
        }
        await blockUnnecessaryResources(reconnectedContext, 'aggressive')
        qualifyPage = await reconnectedContext.newPage()
        console.log(`[pipeline] Browser reconnected successfully (${reconnected ? 'SBR' : 'local'}) for qualify phase`)
      } catch (reconnErr) {
        console.error('[pipeline] Browser reconnect failed:', (reconnErr as Error).message)
        // Continue anyway — JD extraction will fail but Haiku can still score on metadata
      }
    }

    emitProgress('qualify', { jobsFound })
    const qualifiedJobs = await phaseQualify(
      qualifyPage,
      discoveredJobs,
      effectiveConfig,
      runId,
      activities,
      // Progress callback for each qualified/disqualified job
      (update) => {
        addProgressActivity(update)
        emitProgress('qualify', {
          jobsFound,
          jobsProcessed: update.processed ?? 0,
          jobsQualified: update.qualified ?? jobsQualified,
          jobsPreFiltered: update.preFiltered ?? 0,
          currentJob: update.company && update.role ? { company: update.company, role: update.role } : null,
        })
      },
      costTracker,
    )
    jobsQualified = qualifiedJobs.length
    jobsSkipped += discoveredJobs.length - qualifiedJobs.length

    // Build output arrays for the frontend
    discoveredJobsOutput = discoveredJobs.map(j => ({
      title: j.title,
      company: j.company,
      location: j.location,
      url: j.url,
      isEasyApply: j.isEasyApply,
      source: j.source,
      ats: j.ats,
    }))

    qualifiedJobsOutput = qualifiedJobs.map(qj => ({
      title: qj.job.title,
      company: qj.job.company,
      location: qj.job.location,
      url: qj.job.url,
      isEasyApply: qj.job.isEasyApply,
      score: qj.qualification.score,
      matchReasons: [
        qj.qualification.isDesignRole ? 'Design role' : null,
        qj.qualification.seniorityMatch ? 'Seniority match' : null,
        qj.qualification.locationCompatible ? 'Location compatible' : null,
        qj.qualification.skillsMatch ? 'Skills match' : null,
        qj.job.isEasyApply ? 'Easy Apply' : null,
        qj.job.location || null,
      ].filter((r): r is string => r !== null),
      coverLetterSnippet: qj.qualification.coverLetterSnippet,
      ats: qj.job.ats,
    }))

    // -------------------------------------------------------------------------
    // Persist qualified jobs to `job_listings` so OpenJobsView has a data
    // source BEFORE the user clicks "apply". Before this, job_listings was
    // only written reactively by createApplicationFromBot (post-apply), so
    // the dashboard had zero rows and fell back to SAMPLE_JOBS.
    //
    // Best-effort, non-blocking, in parallel. Failures are logged in
    // upsertDiscoveredJobListing and swallowed here — a DB hiccup must not
    // kill the pipeline run.
    // -------------------------------------------------------------------------
    try {
      await persistDiscoveredJobs(config.userId, qualifiedJobs)
    } catch (persistErr) {
      console.warn(
        '[pipeline] persistDiscoveredJobs failed (non-fatal):',
        (persistErr as Error).message,
      )
    }

    // Phase 3 (Apply) disabled — will be a separate user-triggered action
    console.log(`[pipeline] Scout+Qualify complete: ${discoveredJobs.length} found, ${qualifiedJobs.length} qualified. Skipping apply phase.`)
    addProgressActivity({ action: 'found', reason: `Complete: ${jobsFound} found, ${jobsQualified} qualified` })
    emitProgress('done', { jobsFound, jobsQualified })
  } catch (err) {
    const errorMessage = (err as Error).message
    console.error('[pipeline] Fatal error:', errorMessage)

    const errEntry: ActivityLogEntry = {
      user_id: config.userId,
      run_id: runId,
      action: 'pipeline_error',
      reason: errorMessage,
    }
    fireLog(errEntry)
    activities.push(errEntry)

    fireUpdate(runId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: errorMessage,
      jobs_found: jobsFound,
      jobs_applied: jobsApplied,
      jobs_skipped: jobsSkipped,
      jobs_failed: jobsFailed,
    })
  } finally {
    // Clean up browser resources
    if (page) await page.close().catch(() => {})
    if (context && ownsContext) await context.close().catch(() => {})
    // Clean up reconnected context (from SBR reconnection in qualify phase)
    if (reconnectedContext) {
      try {
        const reconnectedBrowser = reconnectedContext.browser()
        await reconnectedContext.close().catch(() => {})
        if (reconnectedBrowser) await reconnectedBrowser.close().catch(() => {})
      } catch { /* already closed */ }
    }
  }

  const duration = Date.now() - startTime

  // Finalize bot run (fire-and-forget — don't delay return)
  fireUpdate(runId, {
    status: 'completed',
    completed_at: new Date().toISOString(),
    jobs_found: jobsFound,
    jobs_applied: jobsApplied,
    jobs_skipped: jobsSkipped,
    jobs_failed: jobsFailed,
  })

  // Cost estimate
  const costEstimate = costTracker.toEstimate()

  const doneEntry: ActivityLogEntry = {
    user_id: config.userId,
    run_id: runId,
    action: 'pipeline_complete',
    reason: `Found ${jobsFound}, qualified ${jobsQualified}, applied ${jobsApplied}, skipped ${jobsSkipped}, failed ${jobsFailed} in ${Math.round(duration / 1000)}s`,
  }
  fireLog(doneEntry)
  activities.push(doneEntry)

  console.log(
    `[pipeline] Run ${runId} complete in ${Math.round(duration / 1000)}s: ` +
    `found=${jobsFound} qualified=${jobsQualified} applied=${jobsApplied} ` +
    `skipped=${jobsSkipped} failed=${jobsFailed}`,
  )
  console.log(
    `[pipeline] Run cost estimate: $${costEstimate.total.toFixed(2)} ` +
    `(scout: $${costEstimate.scout.toFixed(2)}, qualify: $${costEstimate.qualify.toFixed(2)})`,
  )

  return {
    runId,
    jobsFound,
    jobsQualified,
    jobsApplied,
    jobsSkipped,
    jobsFailed,
    duration,
    costEstimate,
    activities,
    discoveredJobs: discoveredJobsOutput,
    qualifiedJobs: qualifiedJobsOutput,
  }
}

// ---------------------------------------------------------------------------
// Convenience: run with defaults (for quick invocation)
// ---------------------------------------------------------------------------

/**
 * Convenience wrapper that fetches the active search profile and runs the pipeline.
 */
export async function runPipelineForUser(
  userId: string,
  browser: Browser,
  options?: {
    maxApplications?: number
    dryRun?: boolean
    minScore?: number
  },
): Promise<PipelineResult> {
  const searchProfile = await getActiveSearchProfile(userId)

  if (!searchProfile) {
    throw new Error(`No active search profile found for user ${userId}`)
  }

  return runPipeline({
    userId,
    searchProfile,
    browser,
    maxApplications: options?.maxApplications ?? 20,
    dryRun: options?.dryRun ?? false,
    minScore: options?.minScore ?? 50,
  })
}

/**
 * Run pipeline from inline config (passed directly from frontend).
 * No Supabase lookup needed — config is in the payload.
 */
export async function runPipelineFromInline(cfg: InlinePipelineConfig): Promise<PipelineResult> {
  // Extract ALL location values from locationRules for multi-pass scout
  const allLocations = (cfg.searchConfig.locationRules ?? [])
    .map(r => r.value)
    .filter(Boolean)

  // Build a SearchProfile-compatible object from inline config
  // The single `location` field is kept for backward compatibility (used as fallback)
  const searchProfile: SearchProfile = {
    id: 'inline-' + Date.now(),
    user_id: cfg.userId,
    name: 'Search from dashboard',
    keywords: cfg.searchConfig.keywords,
    location: allLocations[0] || '',
    remote_only: cfg.searchConfig.locationRules?.some(r => r.workArrangement === 'remote') ?? false,
    min_salary: cfg.searchConfig.locationRules?.find(r => r.minSalary)?.minSalary ?? 0,
    excluded_companies: cfg.searchConfig.excludedCompanies,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  return runPipeline({
    userId: cfg.userId,
    searchProfile,
    onProgress: cfg.onProgress,
    browser: cfg.browser,
    browserContext: cfg.browserContext, // pass pre-authenticated context
    maxApplications: cfg.maxApplications ?? 20,
    dryRun: cfg.dryRun ?? false,
    // Lowered from 50 → 40 so borderline jobs (e.g. Fuse Energy score 42)
    // still reach the grid. The OpenJobsView filter also queries >= 40 for
    // consistency. Raise back if the grid gets noisy with low-quality matches.
    minScore: 40,
    skipApply: cfg.skipApply,
    runId: cfg.runId,
    // Pass ALL locations and keywords for multi-pass scout
    allLocations,
    allKeywords: cfg.searchConfig.keywords,
  })
}
