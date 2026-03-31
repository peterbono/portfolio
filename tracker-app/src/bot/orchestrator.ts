import type { Page, Browser, BrowserContext } from 'playwright'
import type { SearchProfile } from '../types/database'
import { APPLICANT } from './types'
import { scoutJobsMultiPass, normalizeForDedup, type DiscoveredJob, type MultiPassConfig, type ScoutProgressUpdate } from './scout'
import { scoutRemoteOK, scoutWellfound, scoutHimalayas } from './scout-boards'
import {
  qualifyJob,
  clearQualificationCache,
  preQualifyBatch,
  formatPreQualifyStats,
  type QualificationResult,
} from './qualifier'
import { blockUnnecessaryResources } from './helpers'
import {
  createBotRun,
  updateBotRun,
  logBotActivity,
  getExistingApplications,
  getActiveSearchProfile,
  cleanupZombieRuns,
  type ActivityLogEntry,
} from './supabase-server'

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

/** Extract the full job description text from a job page (with retry) */
async function extractJobDescription(page: Page, url: string): Promise<string> {
  // For LinkedIn job URLs, try the guest view endpoint first (simpler HTML, no SPA)
  const linkedInJobIdMatch = url.match(/linkedin\.com\/jobs\/view\/(\d+)/)
  if (linkedInJobIdMatch) {
    try {
      const guestUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${linkedInJobIdMatch[1]}`
      console.log(`[orchestrator] Trying LinkedIn guest API for job ${linkedInJobIdMatch[1]}`)
      await page.goto(guestUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })
      await page.waitForTimeout(1500)

      // Guest API returns simpler HTML with these selectors
      const guestSelectors = [
        '.show-more-less-html__markup',
        '.description__text',
        '.decorated-job-posting__details',
        'section.description',
      ]
      for (const sel of guestSelectors) {
        const el = page.locator(sel).first()
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
          const text = await el.innerText().catch(() => '')
          if (text.length > 100) {
            console.log(`[orchestrator] JD via LinkedIn guest API "${sel}" (${text.length} chars)`)
            return text.slice(0, 6000)
          }
        }
      }
      // Try full body as fallback for guest API
      const bodyText = await page.locator('body').innerText().catch(() => '')
      if (bodyText.length > 100) {
        console.log(`[orchestrator] JD via LinkedIn guest API body (${bodyText.length} chars)`)
        return bodyText.slice(0, 6000)
      }
    } catch (err) {
      console.warn(`[orchestrator] LinkedIn guest API failed: ${(err as Error).message}`)
    }
  }

  // Standard extraction: navigate to the URL directly
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
          console.log(`[orchestrator] JD extracted via "${sel}" (${text.length} chars)`)
          return text.slice(0, 6000)
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

/** Number of LinkedIn pages to scrape per keyword×location combo (25 results/page) */
const PAGES_PER_SEARCH = 3

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
  await logBotActivity(logEntry)
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
  await logBotActivity(linkedinDone)
  activities.push(linkedinDone)

  // Build dedup set for cross-source filtering
  const existingSet = new Set(existing)

  // --- RemoteOK (JSON API — fast, no Playwright needed) ---
  console.log('[pipeline] Phase 1b: SCOUT RemoteOK (JSON API)')
  const remoteokLogEntry: ActivityLogEntry = {
    user_id: config.userId,
    run_id: runId,
    action: 'scout_remoteok_start',
    reason: `RemoteOK: ${uniqueKeywords.length} tags`,
  }
  await logBotActivity(remoteokLogEntry)
  activities.push(remoteokLogEntry)

  let remoteokJobs: DiscoveredJob[] = []
  try {
    // Map keywords to RemoteOK-friendly tags
    const remoteokTags = [
      'design', 'ux', 'ui', 'product-designer', 'ux-designer',
      'ui-designer', 'visual-designer', 'design-system',
    ]
    remoteokJobs = await scoutRemoteOK(
      remoteokTags,
      config.searchProfile.excluded_companies ?? [],
    )

    // Filter out already-applied jobs
    remoteokJobs = remoteokJobs.filter(j => {
      const dedupKey = `${normalizeForDedup(j.company)}|${normalizeForDedup(j.title)}`
      return !existingSet.has(dedupKey)
    })

    // RemoteOK is free (JSON API, no proxy)
    costTracker?.addScoutCost(remoteokTags.length * COST_REMOTEOK_PER_PAGE)

    const remoteokDone: ActivityLogEntry = {
      user_id: config.userId,
      run_id: runId,
      action: 'scout_remoteok_complete',
      reason: `RemoteOK: found ${remoteokJobs.length} unique design jobs`,
    }
    await logBotActivity(remoteokDone)
    activities.push(remoteokDone)
  } catch (err) {
    const remoteokErr: ActivityLogEntry = {
      user_id: config.userId,
      run_id: runId,
      action: 'scout_remoteok_error',
      reason: `RemoteOK scraping failed: ${(err as Error).message}`,
    }
    await logBotActivity(remoteokErr)
    activities.push(remoteokErr)
    console.warn('[pipeline] RemoteOK scout failed, continuing with LinkedIn results only:', (err as Error).message)
  }

  // --- Wellfound (Playwright — parallel-safe with new page) ---
  console.log('[pipeline] Phase 1c: SCOUT Wellfound')
  let wellfoundJobs: DiscoveredJob[] = []
  try {
    const wellfoundPage = await page.context().newPage()
    const wellfoundKeywords = uniqueKeywords.slice(0, 4) // Top 4 keywords
    wellfoundJobs = await scoutWellfound(
      wellfoundPage,
      wellfoundKeywords,
      config.searchProfile.excluded_companies ?? [],
    )
    await wellfoundPage.close().catch(() => {})

    // Filter already-applied
    wellfoundJobs = wellfoundJobs.filter(j => {
      const dedupKey = `${normalizeForDedup(j.company)}|${normalizeForDedup(j.title)}`
      return !existingSet.has(dedupKey)
    })

    // Wellfound uses Bright Data proxy (~$0.005/page, one page per keyword)
    costTracker?.addScoutCost(wellfoundKeywords.length * COST_WELLFOUND_PER_PAGE)

    const wellfoundDone: ActivityLogEntry = {
      user_id: config.userId,
      run_id: runId,
      action: 'scout_wellfound_complete',
      reason: `Wellfound: found ${wellfoundJobs.length} unique design jobs`,
    }
    await logBotActivity(wellfoundDone)
    activities.push(wellfoundDone)
  } catch (err) {
    console.warn('[pipeline] Wellfound scout failed:', (err as Error).message)
    const wellfoundErr: ActivityLogEntry = {
      user_id: config.userId,
      run_id: runId,
      action: 'scout_wellfound_error',
      reason: `Wellfound failed: ${(err as Error).message}`,
    }
    await logBotActivity(wellfoundErr)
    activities.push(wellfoundErr)
  }

  // --- Himalayas.app (JSON API — fast, timezone=7 native filter) ---
  console.log('[pipeline] Phase 1d: SCOUT Himalayas (JSON API)')
  let himalayasJobs: DiscoveredJob[] = []
  try {
    const himalayasTerms = [
      'product designer', 'ux designer', 'ui designer',
      'design lead', 'design system',
    ]
    himalayasJobs = await scoutHimalayas(
      himalayasTerms,
      config.searchProfile.excluded_companies ?? [],
    )

    // Filter out already-applied jobs
    himalayasJobs = himalayasJobs.filter(j => {
      const dedupKey = `${normalizeForDedup(j.company)}|${normalizeForDedup(j.title)}`
      return !existingSet.has(dedupKey)
    })

    // Himalayas is free (JSON API, no proxy)
    costTracker?.addScoutCost(himalayasTerms.length * COST_HIMALAYAS_PER_PAGE)

    const himalayasDone: ActivityLogEntry = {
      user_id: config.userId,
      run_id: runId,
      action: 'scout_himalayas_complete',
      reason: `Himalayas: found ${himalayasJobs.length} unique design jobs`,
    }
    await logBotActivity(himalayasDone)
    activities.push(himalayasDone)
  } catch (err) {
    const himalayasErr: ActivityLogEntry = {
      user_id: config.userId,
      run_id: runId,
      action: 'scout_himalayas_error',
      reason: `Himalayas scraping failed: ${(err as Error).message}`,
    }
    await logBotActivity(himalayasErr)
    activities.push(himalayasErr)
    console.warn('[pipeline] Himalayas scout failed, continuing with other sources:', (err as Error).message)
  }

  // --- Merge & cross-source dedup ---
  const mergedJobs: DiscoveredJob[] = [...linkedinResult.jobs]
  const seenCompanyTitle = new Set<string>()

  // Index LinkedIn jobs for dedup
  for (const job of linkedinResult.jobs) {
    const key = `${normalizeForDedup(job.company)}|${normalizeForDedup(job.title)}`
    seenCompanyTitle.add(key)
  }

  // Add RemoteOK jobs (dedup)
  let remoteokDedupCount = 0
  for (const job of remoteokJobs) {
    const key = `${normalizeForDedup(job.company)}|${normalizeForDedup(job.title)}`
    if (seenCompanyTitle.has(key)) { remoteokDedupCount++; continue }
    seenCompanyTitle.add(key)
    mergedJobs.push(job)
  }

  // Add Wellfound jobs (dedup)
  let wellfoundDedupCount = 0
  for (const job of wellfoundJobs) {
    const key = `${normalizeForDedup(job.company)}|${normalizeForDedup(job.title)}`
    if (seenCompanyTitle.has(key)) { wellfoundDedupCount++; continue }
    seenCompanyTitle.add(key)
    mergedJobs.push(job)
  }

  // Add Himalayas jobs (dedup)
  let himalayasDedupCount = 0
  for (const job of himalayasJobs) {
    const key = `${normalizeForDedup(job.company)}|${normalizeForDedup(job.title)}`
    if (seenCompanyTitle.has(key)) { himalayasDedupCount++; continue }
    seenCompanyTitle.add(key)
    mergedJobs.push(job)
  }

  const totalDedup = remoteokDedupCount + wellfoundDedupCount + himalayasDedupCount
  if (totalDedup > 0) {
    console.log(`[pipeline] Cross-source dedup: removed ${totalDedup} duplicates (RemoteOK: ${remoteokDedupCount}, Wellfound: ${wellfoundDedupCount}, Himalayas: ${himalayasDedupCount})`)
  }

  console.log(
    `[pipeline] Scout complete: LinkedIn ${linkedinResult.jobs.length} + RemoteOK ${remoteokJobs.length} + Wellfound ${wellfoundJobs.length} + Himalayas ${himalayasJobs.length} - ${totalDedup} dupes = ${mergedJobs.length} unique candidates`,
  )

  const scoutDone: ActivityLogEntry = {
    user_id: config.userId,
    run_id: runId,
    action: 'scout_complete',
    reason: `LinkedIn: ${linkedinResult.jobs.length}, RemoteOK: ${remoteokJobs.length}, Wellfound: ${wellfoundJobs.length}, Himalayas: ${himalayasJobs.length}, dedup: -${totalDedup}, total: ${mergedJobs.length}`,
  }
  await logBotActivity(scoutDone)
  activities.push(scoutDone)

  await updateBotRun(runId, {
    jobs_found: mergedJobs.length,
  })

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
  await logBotActivity(preFilterEntry)
  activities.push(preFilterEntry)
  onQualifyProgress?.({ action: 'found', reason: preFilterSummary, preFiltered: stats.filtered })

  // Map surviving URLs back to DiscoveredJob objects
  const survivorUrls = new Set(survivors.map(s => s.url))
  const survivingJobs = jobs.filter(j => survivorUrls.has(j.url))

  if (survivingJobs.length === 0) {
    console.log('[pipeline] All jobs eliminated by pre-filter. No Haiku calls needed.')
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
  // Step 2a: Extract JDs in PARALLEL (multiple browser pages for speed)
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

  // Extract remaining JDs in parallel using worker pages
  if (needExtractionJobs.length > 0) {
    const JD_CONCURRENCY = 4
    const jdQueue = [...needExtractionJobs]

    async function jdWorker(workerPage: Page) {
      while (jdQueue.length > 0) {
        const job = jdQueue.shift()
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

        let jobDescription = ''
        try {
          jobDescription = await extractJobDescription(workerPage, job.url)
        } catch (extractErr) {
          console.warn(`[pipeline] JD extraction error for ${job.company}: ${(extractErr as Error).message}`)
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
        await humanDelay(800, 400)
      }
    }

    // Create worker pages from existing browser context
    const workerCount = Math.min(JD_CONCURRENCY, needExtractionJobs.length)
    const workerPages: Page[] = []
    console.log(`[pipeline] Launching ${workerCount} parallel JD extraction workers for ${needExtractionJobs.length} jobs`)

    try {
      const ctx = page.context()
      for (let i = 0; i < workerCount; i++) {
        const wp = await ctx.newPage()
        workerPages.push(wp)
      }
      await Promise.all(workerPages.map(wp => jdWorker(wp)))
    } finally {
      // Cleanup worker pages
      for (const wp of workerPages) {
        await wp.close().catch(() => {})
      }
    }
  }

  console.log(`[pipeline] JD extraction complete: ${jobsWithJD.length} jobs (${preFetchedJobs.length} pre-fetched, ${needExtractionJobs.length} extracted)`)

  // -------------------------------------------------------------------------
  // Step 2b: Qualify via Haiku in parallel batches of QUALIFY_BATCH_SIZE
  // -------------------------------------------------------------------------
  const QUALIFY_BATCH_SIZE = 10
  let processedCount = 0

  console.log(`[pipeline] Qualifying ${jobsWithJD.length} jobs in parallel batches of ${QUALIFY_BATCH_SIZE}`)

  for (let batchStart = 0; batchStart < jobsWithJD.length; batchStart += QUALIFY_BATCH_SIZE) {
    const batch = jobsWithJD.slice(batchStart, batchStart + QUALIFY_BATCH_SIZE)
    const batchNum = Math.floor(batchStart / QUALIFY_BATCH_SIZE) + 1
    const totalBatches = Math.ceil(jobsWithJD.length / QUALIFY_BATCH_SIZE)
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
        await logBotActivity(errEntry)
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
      await logBotActivity(qualEntry)
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
      }
    }
  }

  console.log(`[pipeline] Qualified: ${qualified.length}/${jobs.length} (${stats.filtered} pre-filtered, ${survivingJobs.length} scored by AI)`)
  return qualified
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

  // Clean up any zombie runs from previous crashed processes (OOM/timeout)
  await cleanupZombieRuns(config.userId)

  // Create a bot run record
  const runId = await createBotRun(config.userId, config.searchProfile.id)

  console.log(`[pipeline] Starting run ${runId} (dryRun: ${config.dryRun})`)

  const startEntry: ActivityLogEntry = {
    user_id: config.userId,
    run_id: runId,
    action: 'pipeline_start',
    reason: `Profile: ${config.searchProfile.name}, max: ${maxApplications}, dryRun: ${config.dryRun}`,
  }
  await logBotActivity(startEntry)
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
      context = await config.browser.newContext({
        viewport: { width: 1280, height: 900 },
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'en-US',
        timezoneId: 'Asia/Bangkok',
      })
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
      await updateBotRun(runId, {
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
      await logBotActivity(logEntry)
      activities.push(logEntry)

      try {
        // Try SBR reconnect first
        const sbrAuth = (process.env.BRIGHTDATA_SBR_AUTH || '').trim() || undefined
        if (sbrAuth) {
          const { chromium } = await import('playwright')
          const newBrowser = await chromium.connectOverCDP(`wss://${sbrAuth}@brd.superproxy.io:9222`)
          reconnectedContext = newBrowser.contexts()[0] || await newBrowser.newContext({
            viewport: { width: 1280, height: 900 },
            ignoreHTTPSErrors: true,
          })
        } else {
          // Local Chromium fallback
          const { chromium } = await import('playwright')
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
        console.log('[pipeline] Browser reconnected successfully for qualify phase')
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
    }))

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
    await logBotActivity(errEntry)
    activities.push(errEntry)

    await updateBotRun(runId, {
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

  // Finalize bot run
  await updateBotRun(runId, {
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
  await logBotActivity(doneEntry)
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
    minScore: 50,
    // Pass ALL locations and keywords for multi-pass scout
    allLocations,
    allKeywords: cfg.searchConfig.keywords,
  })
}
