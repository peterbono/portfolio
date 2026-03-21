import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database, SearchProfile } from '../types/database'
import type { ApplyResult } from './types'

// ---------------------------------------------------------------------------
// Server-side Supabase client (service_role — full access, never expose to browser)
// ---------------------------------------------------------------------------

const SUPABASE_URL = 'https://vcevscplobshspnficnk.supabase.co'
const SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZXZzY3Bsb2JzaHNwbmZpY25rIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDA5ODk3NSwiZXhwIjoyMDg5Njc0OTc1fQ.e7bwDGdAYcg4k-Co5n1nOl4Zzfvu5I2RbQxtmQrbXls'

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

/** Create a new bot_run row and return its id */
export async function createBotRun(
  userId: string,
  profileId: string,
): Promise<string> {
  const { data, error } = await insertRow('bot_runs', {
    user_id: userId,
    search_profile_id: profileId,
    status: 'running',
    started_at: new Date().toISOString(),
  })

  if (error || !data) {
    throw new Error(`Failed to create bot run: ${error?.message ?? 'no data'}`)
  }
  return (data as any).id
}

/** Partially update an existing bot_run row */
export async function updateBotRun(
  runId: string,
  stats: Record<string, unknown>,
): Promise<void> {
  const { error } = await updateRowById('bot_runs', runId, stats)

  if (error) {
    console.error(`[supabase] Failed to update bot run ${runId}:`, error.message)
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

/** Insert a single activity log entry */
export async function logBotActivity(entry: ActivityLogEntry): Promise<void> {
  const { error } = await insertRowNoReturn('bot_activity_log', {
    user_id: entry.user_id,
    run_id: entry.run_id,
    action: entry.action,
    company: entry.company ?? null,
    role: entry.role ?? null,
    ats: entry.ats ?? null,
    reason: entry.reason ?? null,
    screenshot_url: entry.screenshot_url ?? null,
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

/** Create a job_listing + application record from a bot apply result */
export async function createApplicationFromBot(
  userId: string,
  job: DiscoveredJobForDB,
  result: ApplyResult,
): Promise<void> {
  // 1. Insert the job listing
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

  const listingId = (listing as any).id as string

  // 2. Create the application
  const statusMap: Record<ApplyResult['status'], string> = {
    applied: 'submitted',
    skipped: 'skipped',
    failed: 'manual',
    needs_manual: 'manual',
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
