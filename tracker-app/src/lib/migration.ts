import { supabase } from './supabase'
import type { Job, JobEvent } from '../types/job'
import type { Database } from '../types/database'

type JobListingInsert = Database['public']['Tables']['job_listings']['Insert']
type ApplicationInsert = Database['public']['Tables']['applications']['Insert']
type ApplicationEventInsert = Database['public']['Tables']['application_events']['Insert']
type ProfileInsert = Database['public']['Tables']['profiles']['Insert']

const BATCH_SIZE = 50

export interface MigrationResult {
  migrated: number
  errors: string[]
}

export type MigrationProgress = {
  phase: 'signing-in' | 'ensuring-profile' | 'migrating' | 'done' | 'error'
  current: number
  total: number
  errors: string[]
}

/**
 * Sign in to Supabase with migration credentials.
 * Returns the user id on success, null on failure.
 */
async function signInForMigration(): Promise<string | null> {
  const email = import.meta.env.VITE_MIGRATION_EMAIL
  const password = import.meta.env.VITE_MIGRATION_PASSWORD

  if (!email || !password) {
    return null
  }

  // Check if already signed in
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.user?.id) {
    return session.user.id
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.user) {
    console.error('[migration] Sign-in failed:', error?.message)
    return null
  }
  return data.user.id
}

/**
 * Ensure the user's profile row exists (required by RLS foreign keys).
 */
async function ensureProfile(userId: string, email: string): Promise<void> {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle()

  if (!data) {
    const profile: ProfileInsert = {
      id: userId,
      email,
      full_name: 'Florian Gouloubi',
      timezone: 'Asia/Bangkok',
      plan: 'free',
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('profiles') as any).insert(profile)
    if (error) {
      throw new Error(`Failed to create profile: ${error.message}`)
    }
  }
}

/**
 * Map a local Job to Supabase job_listings insert row.
 */
function mapToJobListing(job: Job, userId: string): JobListingInsert {
  return {
    id: job.id,
    user_id: userId,
    company: job.company,
    role: job.role,
    location: job.location || null,
    salary: job.salary || null,
    ats: job.ats || null,
    link: job.link || null,
    notes: job.notes || null,
    area: job.area || null,
    source: job.source || null,
    created_at: job.date ? `${job.date}T00:00:00Z` : new Date().toISOString(),
  }
}

/**
 * Map a local Job to Supabase applications insert row.
 */
function mapToApplication(job: Job, userId: string): ApplicationInsert {
  return {
    id: job.id, // use same id for 1:1 mapping with job_listing
    user_id: userId,
    job_id: job.id,
    status: job.status,
    applied_at: job.date || null,
    cv_uploaded: job.cv === '\u2713' || job.cv === 'true',
    portfolio_included: job.portfolio === '\u2713' || job.portfolio === 'true',
    last_contact_at: job.lastContactDate || null,
    rejected_at: job.status === 'rejected'
      ? (job.lastContactDate || job.date || null)
      : null,
  }
}

/**
 * Map a local JobEvent to Supabase application_events insert row.
 */
function mapToAppEvent(
  event: JobEvent,
  applicationId: string,
  userId: string,
): ApplicationEventInsert {
  return {
    id: event.id,
    user_id: userId,
    application_id: applicationId,
    type: event.type,
    date: event.date || null,
    person: event.person || null,
    notes: event.notes || null,
    outcome: event.outcome || null,
    created_at: event.createdAt || new Date().toISOString(),
  }
}

/**
 * Process a batch of jobs: upsert into job_listings, applications, and application_events.
 *
 * Uses `as any` casts on .upsert() because the Supabase typed client infers `never`
 * for insert/upsert when RLS policies are active. The actual data shapes are correct
 * (typed via *Insert aliases above) and the runtime calls succeed with a valid session.
 */
async function processBatch(
  jobs: Job[],
  userId: string,
): Promise<string[]> {
  const errors: string[] = []

  // 1. Upsert job_listings
  const listings = jobs.map((j) => mapToJobListing(j, userId))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: listingErr } = await (supabase.from('job_listings') as any)
    .upsert(listings, { onConflict: 'id' })
  if (listingErr) {
    errors.push(`job_listings batch: ${listingErr.message}`)
    return errors // bail if listings fail -- applications depend on them
  }

  // 2. Upsert applications
  const applications = jobs.map((j) => mapToApplication(j, userId))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: appErr } = await (supabase.from('applications') as any)
    .upsert(applications, { onConflict: 'id' })
  if (appErr) {
    errors.push(`applications batch: ${appErr.message}`)
    return errors
  }

  // 3. Collect and upsert all events from this batch
  const events: ApplicationEventInsert[] = []
  for (const job of jobs) {
    if (job.events && job.events.length > 0) {
      for (const evt of job.events) {
        events.push(mapToAppEvent(evt, job.id, userId))
      }
    }
  }
  if (events.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: evtErr } = await (supabase.from('application_events') as any)
      .upsert(events, { onConflict: 'id' })
    if (evtErr) {
      errors.push(`application_events batch: ${evtErr.message}`)
    }
  }

  return errors
}

/**
 * Run the full migration.
 *
 * @param jobs - The merged list of all jobs (seed + localStorage overrides).
 * @param onProgress - Optional callback for progress updates.
 * @returns MigrationResult with count of migrated jobs and any errors.
 */
export async function runMigration(
  jobs: Job[],
  onProgress?: (progress: MigrationProgress) => void,
): Promise<MigrationResult> {
  const allErrors: string[] = []

  // Phase 1: Sign in
  onProgress?.({ phase: 'signing-in', current: 0, total: jobs.length, errors: [] })
  const userId = await signInForMigration()
  if (!userId) {
    return {
      migrated: 0,
      errors: ['Sign-in failed. Check VITE_MIGRATION_EMAIL and VITE_MIGRATION_PASSWORD in .env'],
    }
  }

  // Phase 2: Ensure profile exists
  onProgress?.({ phase: 'ensuring-profile', current: 0, total: jobs.length, errors: [] })
  try {
    const email = import.meta.env.VITE_MIGRATION_EMAIL || 'florian.gouloubi@gmail.com'
    await ensureProfile(userId, email)
  } catch (err) {
    return {
      migrated: 0,
      errors: [err instanceof Error ? err.message : 'Failed to ensure profile'],
    }
  }

  // Phase 3: Migrate in batches
  let migrated = 0
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE)

    onProgress?.({
      phase: 'migrating',
      current: i,
      total: jobs.length,
      errors: allErrors,
    })

    const batchErrors = await processBatch(batch, userId)
    if (batchErrors.length > 0) {
      allErrors.push(...batchErrors)
    } else {
      migrated += batch.length
    }

    // Small delay between batches to be nice to the API
    if (i + BATCH_SIZE < jobs.length) {
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  onProgress?.({
    phase: 'done',
    current: jobs.length,
    total: jobs.length,
    errors: allErrors,
  })

  return { migrated, errors: allErrors }
}
