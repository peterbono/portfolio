import type { Page, Browser, BrowserContext } from 'playwright'
import type { SearchProfile } from '../types/database'
import type { ApplicantProfile, ATSAdapter, ApplyResult } from './types'
import { APPLICANT } from './types'
import { scoutJobs, type DiscoveredJob } from './scout'
import { qualifyJob, clearQualificationCache, type QualificationResult } from './qualifier'
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
}

export interface PipelineResult {
  runId: string
  jobsFound: number
  jobsQualified: number
  jobsApplied: number
  jobsSkipped: number
  jobsFailed: number
  duration: number // ms
  activities: ActivityLogEntry[]
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

/** Extract the full job description text from a job page */
async function extractJobDescription(page: Page, url: string): Promise<string> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await humanDelay(2000, 1000)

    // LinkedIn job page: try the description section
    const descriptionSelectors = [
      '.jobs-description__content',
      '.jobs-box__html-content',
      '.description__text',
      '[class*="job-description"]',
      '[class*="jobDescription"]',
      'article',
      'main',
    ]

    for (const sel of descriptionSelectors) {
      const el = page.locator(sel).first()
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        const text = await el.innerText().catch(() => '')
        if (text.length > 100) return text
      }
    }

    // Fallback: grab body text
    const bodyText = await page.locator('body').innerText().catch(() => '')
    return bodyText.slice(0, 5000)
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
): Promise<QualifiedJob[]> {
  console.log(`[pipeline] Phase 2: QUALIFY (${jobs.length} candidates)`)

  clearQualificationCache()
  const qualified: QualifiedJob[] = []

  for (const job of jobs) {
    try {
      const jobDescription = await extractJobDescription(page, job.url)

      if (jobDescription.length < 50) {
        const skipEntry: ActivityLogEntry = {
          user_id: config.userId,
          run_id: runId,
          action: 'qualify_skip',
          company: job.company,
          role: job.title,
          reason: 'Could not extract job description',
        }
        await logBotActivity(skipEntry)
        activities.push(skipEntry)
        continue
      }

      const result = await qualifyJob(
        jobDescription,
        config.searchProfile,
        APPLICANT,
      )

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

  console.log(`[pipeline] Qualified: ${qualified.length}/${jobs.length}`)
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
export async function runPipeline(config: PipelineConfig): Promise<PipelineResult> {
  const startTime = Date.now()
  const activities: ActivityLogEntry[] = []

  // Default values
  const minScore = config.minScore ?? 60
  const maxApplications = config.maxApplications ?? 20
  const effectiveConfig = { ...config, minScore, maxApplications }

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

  let jobsFound = 0
  let jobsQualified = 0
  let jobsApplied = 0
  let jobsSkipped = 0
  let jobsFailed = 0

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

    page = await context.newPage()

    // --- Phase 1: Scout ---
    const discoveredJobs = await phaseScout(page, effectiveConfig, runId, activities)
    jobsFound = discoveredJobs.length

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

    // --- Phase 2: Qualify ---
    const qualifiedJobs = await phaseQualify(
      page,
      discoveredJobs,
      effectiveConfig,
      runId,
      activities,
    )
    jobsQualified = qualifiedJobs.length
    jobsSkipped += discoveredJobs.length - qualifiedJobs.length

    // --- Phase 3: Apply ---
    const applyResults = await phaseApply(
      page,
      qualifiedJobs,
      effectiveConfig,
      runId,
      activities,
    )
    jobsApplied = applyResults.applied
    jobsSkipped += applyResults.skipped
    jobsFailed = applyResults.failed
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
  }

  return runPipeline({
    userId: cfg.userId,
    searchProfile,
    browser: cfg.browser,
    browserContext: cfg.browserContext, // pass pre-authenticated context
    maxApplications: cfg.maxApplications ?? 20,
    dryRun: cfg.dryRun ?? false,
    minScore: 60,
  })
}
