import type { Page, Browser, BrowserContext } from 'playwright'
import type { SearchProfile } from '../types/database'
import type { ApplicantProfile, ATSAdapter, ApplyResult } from './types'
import { APPLICANT } from './types'
import { scoutJobs, type DiscoveredJob } from './scout'
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
  createApplicationFromBot,
  getActiveSearchProfile,
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
}

/** Progress data sent via onProgress callback for live UI updates */
export interface PipelineProgress {
  phase: 'starting' | 'scout' | 'pre-filter' | 'qualify' | 'apply' | 'done' | 'error'
  jobsFound: number
  jobsProcessed: number
  jobsQualified: number
  jobsPreFiltered: number
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

export interface PipelineResult {
  runId: string
  jobsFound: number
  jobsPreFiltered?: number
  jobsQualified: number
  jobsApplied: number
  jobsSkipped: number
  jobsFailed: number
  duration: number // ms
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
// ATS adapter registry
// ---------------------------------------------------------------------------

const adapters: ATSAdapter[] = []

/** Register an ATS adapter so the orchestrator can use it */
export function registerAdapter(adapter: ATSAdapter): void {
  adapters.push(adapter)
}

/** Detect which adapter matches a URL, or null */
function detectAdapter(url: string): ATSAdapter | null {
  for (const adapter of adapters) {
    if (adapter.detect(url)) return adapter
  }
  return null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Delay with jitter for human-like behavior */
function humanDelay(baseMs: number, jitterMs: number = 500): Promise<void> {
  const ms = baseMs + Math.floor(Math.random() * jitterMs * 2) - jitterMs
  return new Promise(r => setTimeout(r, Math.max(100, ms)))
}

/** 2-minute gap between applications (with ±15s jitter) */
const APPLY_GAP_MS = 120_000
const APPLY_GAP_JITTER_MS = 15_000

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

async function phaseScout(
  page: Page,
  config: PipelineConfig,
  runId: string,
  activities: ActivityLogEntry[],
): Promise<DiscoveredJob[]> {
  console.log('[pipeline] Phase 1: SCOUT')

  const existing = await getExistingApplications(config.userId)

  const logEntry: ActivityLogEntry = {
    user_id: config.userId,
    run_id: runId,
    action: 'scout_start',
    reason: `Keywords: ${config.searchProfile.keywords?.join(', ') ?? 'default'}`,
  }
  await logBotActivity(logEntry)
  activities.push(logEntry)

  const result = await scoutJobs(page, config.searchProfile, existing)

  const scoutDone: ActivityLogEntry = {
    user_id: config.userId,
    run_id: runId,
    action: 'scout_complete',
    reason: `Found ${result.totalFound}, filtered ${result.filteredOut}, candidates: ${result.jobs.length}`,
  }
  await logBotActivity(scoutDone)
  activities.push(scoutDone)

  await updateBotRun(runId, {
    jobs_found: result.jobs.length,
  })

  return result.jobs
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
): Promise<QualifiedJob[]> {
  console.log(`[pipeline] Phase 2: QUALIFY (${jobs.length} candidates)`)

  // -------------------------------------------------------------------------
  // Pass 1: Rules-based pre-filter (instant, $0 cost)
  // -------------------------------------------------------------------------
  const { survivors, stats } = preQualifyBatch(
    jobs.map(j => ({ title: j.title, company: j.company, location: j.location, url: j.url })),
    APPLICANT,
    { excludedCompanies: config.searchProfile.excluded_companies ?? null },
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

  let processedCount = 0
  for (const job of dedupedSurvivors) {
    // Emit progress: currently processing this job
    onQualifyProgress?.({
      action: 'found',
      company: job.company,
      role: job.title,
      reason: `Analyzing "${job.title}" at ${job.company}...`,
      processed: processedCount,
      qualified: qualified.length,
      preFiltered: stats.filtered,
    })

    try {
      let jobDescription = ''
      try {
        jobDescription = await extractJobDescription(page, job.url)
      } catch (extractErr) {
        console.warn(`[pipeline] JD extraction error for ${job.company}: ${(extractErr as Error).message}`)
      }

      // Fallback: build synthetic JD from scout metadata instead of skipping
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

      const result = await qualifyJob(
        jobDescription,
        config.searchProfile,
        APPLICANT,
      )

      processedCount++

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

      // Small delay between JD fetches for human-like behavior
      await humanDelay(1500, 800)
    } catch (err) {
      console.warn(
        `[pipeline] Qualification error for ${job.company}:`,
        (err as Error).message,
      )
      const errEntry: ActivityLogEntry = {
        user_id: config.userId,
        run_id: runId,
        action: 'qualify_error',
        company: job.company,
        role: job.title,
        reason: (err as Error).message,
      }
      await logBotActivity(errEntry)
      activities.push(errEntry)
    }
  }

  console.log(`[pipeline] Qualified: ${qualified.length}/${jobs.length} (${stats.filtered} pre-filtered, ${survivingJobs.length} scored by AI)`)
  return qualified
}

// ---------------------------------------------------------------------------
// Phase 3: Apply
// ---------------------------------------------------------------------------

async function phaseApply(
  page: Page,
  qualifiedJobs: QualifiedJob[],
  config: PipelineConfig,
  runId: string,
  activities: ActivityLogEntry[],
): Promise<{ applied: number; skipped: number; failed: number }> {
  console.log(`[pipeline] Phase 3: APPLY (${qualifiedJobs.length} qualified, max ${config.maxApplications})`)

  let applied = 0
  let skipped = 0
  let failed = 0

  // Cap at maxApplications
  const toApply = qualifiedJobs.slice(0, config.maxApplications)

  for (const { job, qualification } of toApply) {
    const adapter = detectAdapter(job.url)

    if (!adapter) {
      // No adapter — mark as needs_manual
      const noAdapterEntry: ActivityLogEntry = {
        user_id: config.userId,
        run_id: runId,
        action: 'apply_no_adapter',
        company: job.company,
        role: job.title,
        reason: 'No ATS adapter matched this URL',
      }
      await logBotActivity(noAdapterEntry)
      activities.push(noAdapterEntry)

      // Still create the application record as needs_manual
      if (!config.dryRun) {
        await createApplicationFromBot(config.userId, job, {
          success: false,
          status: 'needs_manual',
          company: job.company,
          role: job.title,
          ats: 'unknown',
          reason: 'No ATS adapter available',
          duration: 0,
        })
      }

      skipped++
      continue
    }

    // Dry run — log but don't actually apply
    if (config.dryRun) {
      const dryEntry: ActivityLogEntry = {
        user_id: config.userId,
        run_id: runId,
        action: 'apply_dry_run',
        company: job.company,
        role: job.title,
        ats: adapter.name,
        reason: `Score ${qualification.score} — would apply via ${adapter.name}`,
      }
      await logBotActivity(dryEntry)
      activities.push(dryEntry)
      applied++
      continue
    }

    // Real application — up to 2 retries
    let result: ApplyResult | null = null
    let attempts = 0
    const MAX_RETRIES = 2

    while (attempts < MAX_RETRIES) {
      attempts++
      try {
        console.log(
          `[pipeline] Applying to ${job.company} — ${job.title} (attempt ${attempts}, ATS: ${adapter.name})`,
        )

        result = await adapter.apply(page, job.url, APPLICANT)

        if (result.success || result.status === 'applied') {
          break // Success — no need to retry
        }

        if (result.status === 'needs_manual') {
          break // Won't succeed with retry
        }

        // Failed — retry after a short delay
        console.warn(
          `[pipeline] Attempt ${attempts} failed for ${job.company}: ${result.reason}`,
        )
        await humanDelay(5000, 2000)
      } catch (err) {
        console.error(
          `[pipeline] Apply exception for ${job.company} (attempt ${attempts}):`,
          (err as Error).message,
        )
        result = {
          success: false,
          status: 'failed',
          company: job.company,
          role: job.title,
          ats: adapter.name,
          reason: (err as Error).message,
          duration: 0,
        }
      }
    }

    if (!result) {
      result = {
        success: false,
        status: 'failed',
        company: job.company,
        role: job.title,
        ats: adapter.name,
        reason: 'All retries exhausted',
        duration: 0,
      }
    }

    // After max retries, downgrade to needs_manual
    if (result.status === 'failed' && attempts >= MAX_RETRIES) {
      result.status = 'needs_manual'
      result.reason = `Failed after ${MAX_RETRIES} attempts: ${result.reason}`
    }

    // Log the apply result
    const applyEntry: ActivityLogEntry = {
      user_id: config.userId,
      run_id: runId,
      action: `apply_${result.status}`,
      company: job.company,
      role: job.title,
      ats: adapter.name,
      reason: result.reason,
      screenshot_url: result.screenshotUrl,
    }
    await logBotActivity(applyEntry)
    activities.push(applyEntry)

    // Save to DB
    await createApplicationFromBot(config.userId, job, result)

    // Update counters
    if (result.status === 'applied') {
      applied++
    } else if (result.status === 'skipped' || result.status === 'needs_manual') {
      skipped++
    } else {
      failed++
    }

    // Rate limit: 2-minute gap between applications
    if (toApply.indexOf({ job, qualification }) < toApply.length - 1) {
      console.log('[pipeline] Waiting 2 minutes before next application...')
      await humanDelay(APPLY_GAP_MS, APPLY_GAP_JITTER_MS)
    }
  }

  return { applied, skipped, failed }
}

// ---------------------------------------------------------------------------
// Main pipeline orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full Scout → Qualify → Apply pipeline.
 *
 * @param config - Pipeline configuration including user, search profile, and limits
 * @returns Summary of the pipeline run
 */
export async function runPipeline(config: PipelineConfig & { onProgress?: (p: PipelineProgress) => void }): Promise<PipelineResult> {
  const startTime = Date.now()
  const activities: ActivityLogEntry[] = []
  const progressActivities: PipelineProgress['activities'] = []

  // Default values
  const minScore = config.minScore ?? 60
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
    const discoveredJobs = await phaseScout(page, effectiveConfig, runId, activities)
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
        activities,
      }
    }

    // --- Phase 2: Qualify (inline — rules pre-filter + Haiku scoring) ---
    emitProgress('qualify', { jobsFound })
    const qualifiedJobs = await phaseQualify(
      page!,
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

  return {
    runId,
    jobsFound,
    jobsQualified,
    jobsApplied,
    jobsSkipped,
    jobsFailed,
    duration,
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
    minScore: options?.minScore ?? 60,
  })
}

/**
 * Run pipeline from inline config (passed directly from frontend).
 * No Supabase lookup needed — config is in the payload.
 */
export async function runPipelineFromInline(cfg: InlinePipelineConfig): Promise<PipelineResult> {
  // Build a SearchProfile-compatible object from inline config
  const searchProfile: SearchProfile = {
    id: 'inline-' + Date.now(),
    user_id: cfg.userId,
    name: 'Search from dashboard',
    keywords: cfg.searchConfig.keywords,
    location: cfg.searchConfig.locationRules?.[0]?.value || '',
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
    minScore: 60,
  })
}
