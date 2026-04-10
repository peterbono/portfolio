import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database, SearchProfile } from '../types/database.js'
import type { ApplyResult } from './types.js'

// ---------------------------------------------------------------------------
// Server-side Supabase client (service_role — full access, never expose to browser)
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export const supabaseServer: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
)

// ---------------------------------------------------------------------------
// Typed insert helpers — work around strict generic overloads in supabase-js v2
// ---------------------------------------------------------------------------

type _Tables = Database['public']['Tables'] // referenced for documentation only

// We use `as any` casts on the Supabase client calls because the generated
// Database type produces `never` overload mismatches for insert/update in
// supabase-js v2. The payloads themselves are well-typed at the call sites.

const db = supabaseServer as any

async function insertRow(table: string, row: Record<string, unknown>) {
  return db.from(table).insert(row).select('id').single()
}

async function insertRowNoReturn(table: string, row: Record<string, unknown>) {
  return db.from(table).insert(row)
}

async function updateRowById(table: string, id: string, changes: Record<string, unknown>) {
  return db.from(table).update(changes).eq('id', id)
}

// ---------------------------------------------------------------------------
// Bot run lifecycle
// ---------------------------------------------------------------------------

export interface BotRunInsert {
  user_id: string
  search_profile_id: string
  status: string
  started_at: string
}

/**
 * Cleanup zombie bot_runs: any "running" rows for this user older than 30 min
 * are force-failed. This catches cases where the Trigger.dev task process was
 * killed (OOM, timeout) and the finally block never executed.
 */
export async function cleanupZombieRuns(userId: string): Promise<number> {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()

  const { data, error } = await (db as any)
    .from('bot_runs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: 'Zombie run: process killed (OOM/timeout) without finalization',
    })
    .eq('user_id', userId)
    .eq('status', 'running')
    .lt('created_at', thirtyMinAgo)
    .select('id')

  if (error) {
    console.error('[supabase] Failed to cleanup zombie runs:', error.message)
    return 0
  }

  const count = data?.length ?? 0
  if (count > 0) {
    console.log(`[supabase] Cleaned up ${count} zombie bot_run(s) for user ${userId}`)
  }
  return count
}

/** Create a new bot_run row and return its id */
export async function createBotRun(
  userId: string,
  profileId: string,
): Promise<string> {
  // If profileId is not a valid UUID (e.g. "inline-xxx"), set to null
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profileId)
  const { data, error } = await insertRow('bot_runs', {
    user_id: userId,
    search_profile_id: isUuid ? profileId : null,
    status: 'running',
    started_at: new Date().toISOString(),
  })

  if (error || !data) {
    throw new Error(`Failed to create bot run: ${error?.message ?? 'no data'}`)
  }
  return (data as any).id
}

/**
 * Partially update an existing bot_run row.
 *
 * Supports two styles of values:
 *   - Plain values: `{ status: 'completed', finished_at: '...' }` → direct SET
 *   - Increment sentinel: `{ jobs_applied: { __increment: 1 } }` → atomic increment via RPC
 *
 * Atomic increments are required because multiple apply-worker invocations run
 * in parallel from Vercel Queues; a read-then-write pattern would race and lose
 * counts. The RPC `increment_bot_run_counter(run_id, field, delta)` must exist
 * in Supabase — see migration 006_bot_runs_increment_rpc.sql.
 */
export async function updateBotRun(
  runId: string,
  stats: Record<string, unknown>,
): Promise<void> {
  // Split stats into plain updates and increment sentinels
  const plainUpdates: Record<string, unknown> = {}
  const increments: Array<{ field: string; delta: number }> = []

  for (const [key, value] of Object.entries(stats)) {
    if (
      value &&
      typeof value === 'object' &&
      '__increment' in (value as Record<string, unknown>) &&
      typeof (value as { __increment: unknown }).__increment === 'number'
    ) {
      increments.push({
        field: key,
        delta: (value as { __increment: number }).__increment,
      })
    } else {
      plainUpdates[key] = value
    }
  }

  // Run increments atomically via RPC
  for (const { field, delta } of increments) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: rpcErr } = await (supabaseServer as any).rpc(
      'increment_bot_run_counter',
      { p_run_id: runId, p_field: field, p_delta: delta },
    )
    if (rpcErr) {
      console.error(
        `[supabase] RPC increment failed for bot_run ${runId}.${field}:`,
        rpcErr.message,
      )
    }
  }

  // Run plain updates
  if (Object.keys(plainUpdates).length > 0) {
    const { error } = await updateRowById('bot_runs', runId, plainUpdates)
    if (error) {
      console.error(`[supabase] Failed to update bot run ${runId}:`, error.message)
    }
  }
}

// ---------------------------------------------------------------------------
// Screenshot storage — upload to Supabase Storage instead of inline base64
// ---------------------------------------------------------------------------

const SCREENSHOT_BUCKET = 'bot-screenshots'
let bucketEnsured = false

/**
 * Ensure the screenshots storage bucket exists (idempotent, runs once per process).
 */
async function ensureScreenshotBucket(): Promise<void> {
  if (bucketEnsured) return
  try {
    const { error } = await supabaseServer.storage.createBucket(SCREENSHOT_BUCKET, {
      public: true, // public URLs for easy viewing in dashboard
      fileSizeLimit: 1024 * 1024, // 1MB max per screenshot
    })
    // Ignore "already exists" error
    if (error && !error.message?.includes('already exists')) {
      console.warn(`[supabase] Could not create bucket "${SCREENSHOT_BUCKET}":`, error.message)
    }
  } catch (err) {
    console.warn('[supabase] Bucket creation error:', err)
  }
  bucketEnsured = true
}

/**
 * Upload a base64 screenshot to Supabase Storage and return the public URL.
 * Returns null on failure (non-blocking — screenshot is optional debug data).
 */
async function uploadScreenshot(base64Data: string, runId: string | null): Promise<string | null> {
  try {
    await ensureScreenshotBucket()

    // Strip data URI prefix if present
    const raw = base64Data.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(raw, 'base64')

    // Generate a unique path: run_id/timestamp.jpg
    const prefix = runId ?? 'unknown'
    const filename = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`

    const { error } = await supabaseServer.storage
      .from(SCREENSHOT_BUCKET)
      .upload(filename, buffer, {
        contentType: 'image/jpeg',
        upsert: false,
      })

    if (error) {
      console.warn(`[supabase] Screenshot upload failed:`, error.message)
      return null
    }

    // Get public URL
    const { data: urlData } = supabaseServer.storage
      .from(SCREENSHOT_BUCKET)
      .getPublicUrl(filename)

    return urlData?.publicUrl ?? null
  } catch (err) {
    console.warn('[supabase] Screenshot upload error:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

export interface ActivityLogEntry {
  user_id: string
  run_id: string | null
  action: string
  company?: string
  role?: string
  ats?: string
  reason?: string
  screenshot_url?: string
}

/**
 * The DB has a CHECK constraint on bot_activity_log.action limiting values to:
 *   applied, skipped, failed, found, qualified, disqualified
 * The orchestrator uses more granular names — we normalize them here.
 */
const VALID_DB_ACTIONS = new Set(['applied', 'skipped', 'failed', 'found', 'qualified', 'disqualified'])

function normalizeAction(action: string): string {
  // Already a valid DB action
  if (VALID_DB_ACTIONS.has(action)) return action

  // Scout phase → found
  if (action.startsWith('scout')) return 'found'

  // Qualify phase
  if (action === 'qualify_pass') return 'qualified'
  if (action === 'qualify_fail' || action === 'qualify_skip') return 'disqualified'
  if (action === 'qualify_error') return 'disqualified'

  // Apply phase
  if (action === 'apply_applied' || action === 'apply_dry_run') return 'applied'
  // NOTE: apply_needs_manual is mapped to 'skipped' due to DB CHECK constraint
  // limiting allowed values. It's not truly skipped — it means submitted but
  // unconfirmed. A future migration could add 'needs_manual' to the constraint.
  if (action === 'apply_skipped' || action === 'apply_needs_manual' || action === 'apply_no_adapter') return 'skipped'
  if (action === 'apply_failed') return 'failed'

  // Pipeline lifecycle → found (generic event, reason field carries the detail)
  if (action.startsWith('pipeline')) return 'found'

  // Fallback — log a warning and use 'found' to avoid DB constraint violation
  console.warn(`[supabase] Unknown action "${action}" — normalizing to "found"`)
  return 'found'
}

/** Insert a single activity log entry.
 *  If screenshot_url contains base64 data (>1KB), uploads it to Supabase Storage
 *  and stores only the public URL (~100 bytes instead of 300-500KB). */
export async function logBotActivity(entry: ActivityLogEntry): Promise<void> {
  let screenshotUrl: string | null = entry.screenshot_url ?? null

  // Detect base64 screenshot (raw base64 or data URI) and upload to Storage
  if (screenshotUrl && screenshotUrl.length > 1000) {
    const storageUrl = await uploadScreenshot(screenshotUrl, entry.run_id)
    screenshotUrl = storageUrl // null if upload failed (non-blocking)
  }

  const { error } = await insertRowNoReturn('bot_activity_log', {
    user_id: entry.user_id,
    run_id: entry.run_id,
    action: normalizeAction(entry.action),
    company: entry.company ?? null,
    role: entry.role ?? null,
    ats: entry.ats ?? null,
    reason: entry.reason ?? null,
    screenshot_url: screenshotUrl,
  })

  if (error) {
    console.error('[supabase] Failed to log activity:', error.message)
  }
}

// ---------------------------------------------------------------------------
// Existing applications — dedup check
// ---------------------------------------------------------------------------

/**
 * Returns an array of "company|role" lowercase keys for all jobs the user
 * has already applied to (status != 'skipped'). Used by the scout to skip
 * duplicate applications.
 */
export async function getExistingApplications(
  userId: string,
): Promise<string[]> {
  // Pull job_listings joined through applications
  const { data, error } = await supabaseServer
    .from('applications')
    .select('job_id, job_listings!inner(company, role)')
    .eq('user_id', userId)
    .neq('status', 'skipped')

  if (error) {
    console.error('[supabase] Failed to fetch existing applications:', error.message)
    return []
  }

  if (!data) return []

  return data.map((row: any) => {
    const company = (row.job_listings?.company ?? '').toLowerCase().trim()
    const role = (row.job_listings?.role ?? '').toLowerCase().trim()
    return `${company}|${role}`
  })
}

/**
 * Returns both "company|role" keys AND job URLs for all existing applications.
 * Used by the orchestrator to dedup by URL in addition to company+title.
 */
export async function getExistingApplicationsWithUrls(
  userId: string,
): Promise<{ keys: string[]; urls: string[] }> {
  const { data, error } = await supabaseServer
    .from('applications')
    .select('job_id, job_listings!inner(company, role, link)')
    .eq('user_id', userId)
    .neq('status', 'skipped')

  if (error) {
    console.error('[supabase] Failed to fetch existing applications with URLs:', error.message)
    return { keys: [], urls: [] }
  }

  if (!data) return { keys: [], urls: [] }

  const keys: string[] = []
  const urls: string[] = []

  for (const row of data as any[]) {
    const company = (row.job_listings?.company ?? '').toLowerCase().trim()
    const role = (row.job_listings?.role ?? '').toLowerCase().trim()
    keys.push(`${company}|${role}`)
    const link = (row.job_listings?.link ?? '').trim()
    if (link) urls.push(link)
  }

  return { keys, urls }
}

// ---------------------------------------------------------------------------
// Create application + job listing from bot discovery
// ---------------------------------------------------------------------------

export interface DiscoveredJobForDB {
  title: string
  company: string
  location: string
  url: string
  ats?: string
}

/** Create a job_listing + application record from a bot apply result.
 *
 * Dedup behavior (Phase 1b — April 2026): if a job_listing with the same
 * (user_id, link) already exists, reuse it instead of inserting a duplicate.
 * Same for applications — if a 'submitted' application already exists for
 * the listing, skip the insert so the user isn't counted as having applied
 * to the same job twice. This fixes the bug where Fueled/Circle.so/Virtru
 * accumulated 3-4 identical submissions from scout re-discoveries.
 */
export async function createApplicationFromBot(
  userId: string,
  job: DiscoveredJobForDB,
  result: ApplyResult,
): Promise<void> {
  // 1. Look up existing job_listing by (user_id, link) — reuse if present
  let listingId: string | null = null
  if (job.url) {
    const { data: existing } = await db
      .from('job_listings')
      .select('id')
      .eq('user_id', userId)
      .eq('link', job.url)
      .limit(1)
      .maybeSingle()
    if (existing?.id) {
      listingId = existing.id as string
      console.log(`[supabase] Reusing existing job_listing ${listingId} for ${job.url}`)
    }
  }

  // 2. Insert a new job_listing only if no match was found
  if (!listingId) {
    const { data: listing, error: listingErr } = await insertRow('job_listings', {
      user_id: userId,
      company: job.company,
      role: job.title,
      location: job.location,
      link: job.url,
      ats: job.ats ?? result.ats,
      source: 'bot',
    })

    if (listingErr || !listing) {
      console.error('[supabase] Failed to create job listing:', listingErr?.message)
      return
    }
    listingId = (listing as any).id as string
  }

  // 3. Dedup check on applications — skip if a submitted application
  //    already exists for this (user_id, job_id) pair. This is the main
  //    guard against the re-submission bug.
  const { data: existingApp } = await db
    .from('applications')
    .select('id, status')
    .eq('user_id', userId)
    .eq('job_id', listingId)
    .eq('status', 'submitted')
    .limit(1)
    .maybeSingle()

  if (existingApp) {
    console.log(`[supabase] Skipping duplicate application — job_id ${listingId} already has a submitted application`)
    return
  }

  // 4. Create the application record
  const statusMap: Record<ApplyResult['status'], string> = {
    applied: 'submitted',
    skipped: 'rejected',
    failed: 'submitted',
    needs_manual: 'submitted',
  }

  const { error: appErr } = await insertRowNoReturn('applications', {
    user_id: userId,
    job_id: listingId,
    status: statusMap[result.status],
    applied_at: result.status === 'applied' ? new Date().toISOString() : null,
    cv_uploaded: result.status === 'applied',
    portfolio_included: result.status === 'applied',
    cover_letter_variant: null,
  })

  if (appErr) {
    console.error('[supabase] Failed to create application:', appErr.message)
  }
}

// ---------------------------------------------------------------------------
// Apply receipt — stores what was actually sent per application
// ---------------------------------------------------------------------------

/**
 * SQL migration for apply_receipts table:
 *
 * CREATE TABLE IF NOT EXISTS apply_receipts (
 *   id bigint generated always as identity primary key,
 *   user_id uuid references auth.users(id) not null,
 *   company text not null,
 *   role text not null,
 *   job_url text not null,
 *   cover_letter_sent text,
 *   cv_summary_sent text,
 *   applied_at timestamptz not null,
 *   created_at timestamptz default now()
 * );
 * CREATE INDEX idx_apply_receipts_user ON apply_receipts(user_id);
 */

export async function storeApplyReceipt(data: {
  userId: string
  company: string
  role: string
  jobUrl: string
  coverLetterSent: string
  cvSummarySent: string
  appliedAt: string
}): Promise<void> {
  const { error } = await insertRowNoReturn('apply_receipts', {
    user_id: data.userId,
    company: data.company,
    role: data.role,
    job_url: data.jobUrl,
    cover_letter_sent: data.coverLetterSent || null,
    cv_summary_sent: data.cvSummarySent || null,
    applied_at: data.appliedAt,
  })

  if (error) {
    console.error('[supabase] Failed to store apply receipt:', error.message)
  }
}

// ---------------------------------------------------------------------------
// Search profile lookup
// ---------------------------------------------------------------------------

/** Get the active search profile for a user */
export async function getActiveSearchProfile(
  userId: string,
): Promise<SearchProfile | null> {
  const { data, error } = await supabaseServer
    .from('search_profiles')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (error || !data) return null
  return data
}

// ---------------------------------------------------------------------------
// User profile fetch (for apply-worker fallback when queue message lacks it)
// ---------------------------------------------------------------------------

export interface UserProfileRow {
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  location?: string
  linkedin?: string
  portfolio?: string
  cvUrl?: string
  yearsExperience?: number
}

/**
 * Fetch an applicant profile from the `profiles` table by user id.
 *
 * Reads whatever applicant-facing columns exist on `profiles`. The base schema
 * only guarantees `email` and `full_name`; richer columns (phone, linkedin,
 * portfolio, cv_url, years_experience, location) are optional and will be
 * undefined until added by a future migration.
 *
 * Returns null if the profile row does not exist (brand new user).
 * The caller is responsible for merging this with any passed-in override
 * and falling back to the hardcoded APPLICANT profile if both are empty.
 */
export async function getUserProfile(
  userId: string,
): Promise<UserProfileRow | null> {
  try {
    const { data, error } = await db
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .limit(1)
      .maybeSingle()

    if (error) {
      console.warn(
        `[supabase] getUserProfile(${userId}) failed: ${error.message}`,
      )
      return null
    }
    if (!data) return null

    // Split full_name into first/last — naive but good enough as a default.
    const fullName: string = (data.full_name as string) ?? ''
    const [firstFromFull, ...restFromFull] = fullName.trim().split(/\s+/)
    const lastFromFull = restFromFull.join(' ')

    const row: UserProfileRow = {
      firstName: (data.first_name as string) || firstFromFull || undefined,
      lastName: (data.last_name as string) || lastFromFull || undefined,
      email: (data.email as string) || undefined,
      phone: (data.phone as string) || undefined,
      location: (data.location as string) || undefined,
      linkedin: (data.linkedin as string) || undefined,
      portfolio: (data.portfolio as string) || undefined,
      cvUrl:
        (data.cv_url as string) ||
        (data.cvUrl as string) ||
        undefined,
      yearsExperience:
        typeof data.years_experience === 'number'
          ? (data.years_experience as number)
          : undefined,
    }

    // Drop empty record → return null so callers can fall back cleanly.
    const hasAny = Object.values(row).some((v) => v !== undefined && v !== '')
    return hasAny ? row : null
  } catch (err) {
    console.warn(
      `[supabase] getUserProfile(${userId}) threw: ${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }
}

// ---------------------------------------------------------------------------
// Discovered job listings — proactive scout persistence (OpenJobsView source)
// ---------------------------------------------------------------------------

export interface DiscoveredJobUpsert {
  company: string
  role: string
  location?: string
  salary?: string
  link: string
  ats?: string
  qualificationScore?: number
  qualificationResult?: Record<string, unknown>
  workArrangement?: string
  postedAt?: string
}

/**
 * Upsert a discovered job listing for a user, keyed on (user_id, link).
 *
 * Relies on the unique constraint added in migration 004 so repeated scout
 * runs re-use the same row instead of creating duplicates. Updates the
 * qualification score/result + posted_at/work_arrangement on every call so
 * the latest Haiku output always wins.
 *
 * Returns the row id on success, or null on failure (never throws — the
 * scout pipeline treats persistence as best-effort so DB hiccups don't
 * abort the run).
 */
export async function upsertDiscoveredJobListing(
  userId: string,
  job: DiscoveredJobUpsert,
): Promise<string | null> {
  if (!job.link) {
    console.warn('[supabase] upsertDiscoveredJobListing: missing link, skipping')
    return null
  }

  const row: Record<string, unknown> = {
    user_id: userId,
    company: job.company,
    role: job.role,
    title: job.role,
    location: job.location ?? null,
    salary: job.salary ?? null,
    salary_range: job.salary ?? null,
    link: job.link,
    ats: job.ats ?? null,
    source: 'scout',
    qualification_score:
      typeof job.qualificationScore === 'number'
        ? Math.round(job.qualificationScore)
        : null,
    qualification_result: job.qualificationResult ?? null,
    work_arrangement: job.workArrangement ?? null,
    posted_at: job.postedAt ?? null,
  }

  // Upsert on the (user_id, link) unique index from migration 004.
  const { data, error } = await db
    .from('job_listings')
    .upsert(row, { onConflict: 'user_id,link' })
    .select('id')
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn(
      `[supabase] upsertDiscoveredJobListing(${job.company}/${job.role}) failed: ${error.message}`,
    )
    return null
  }
  return (data?.id as string) ?? null
}

// ---------------------------------------------------------------------------
// Job listing lookup by URL (for apply-worker to hydrate jdKeywords)
// ---------------------------------------------------------------------------

export interface JobListingRow {
  id: string
  company: string
  role: string
  link: string
  ats: string | null
  qualification_score: number | null
  qualification_result: Record<string, unknown> | null
}

/**
 * Fetch a job_listings row by (user_id, link).
 *
 * Used by apply-worker to retrieve the stored qualification_result JSONB
 * when the queue message didn't carry jdKeywords (e.g. the job was
 * discovered by the scout and applied to later by the user from the
 * OpenJobsView instead of immediately after qualification).
 *
 * Returns null if no row matches or on DB error (logged + swallowed).
 */
export async function getJobListingByUrl(
  userId: string,
  url: string,
): Promise<JobListingRow | null> {
  if (!url) return null
  try {
    const { data, error } = await db
      .from('job_listings')
      .select('id, company, role, link, ats, qualification_score, qualification_result')
      .eq('user_id', userId)
      .eq('link', url)
      .limit(1)
      .maybeSingle()

    if (error) {
      console.warn(
        `[supabase] getJobListingByUrl failed: ${error.message}`,
      )
      return null
    }
    return (data as JobListingRow) ?? null
  } catch (err) {
    console.warn(
      `[supabase] getJobListingByUrl threw: ${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }
}
