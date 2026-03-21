import { supabase } from './supabase'
import type { Job, JobEvent, JobStatus } from '../types/job'

/**
 * Dual-write sync layer.
 *
 * These functions mirror localStorage writes to Supabase.
 * They are fire-and-forget: errors are logged but never bubble up.
 * localStorage remains the primary store.
 *
 * Uses `as any` casts on .upsert()/.update() because the Supabase typed client
 * infers `never` for write operations when RLS policies are active. The actual
 * data shapes match the DB schema and the runtime calls succeed with a valid session.
 */

/** Get the current user id from the active session, or null. */
async function getUserId(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.user?.id ?? null
  } catch {
    return null
  }
}

/**
 * Sync an entire Job object to Supabase (upsert job_listing + application).
 * Called after every localStorage write that touches a job.
 */
export async function syncJobToSupabase(job: Job): Promise<void> {
  try {
    const userId = await getUserId()
    if (!userId) return // not signed in, skip silently

    // Upsert job_listing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: listingErr } = await (supabase.from('job_listings') as any).upsert(
      {
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
      },
      { onConflict: 'id' },
    )
    if (listingErr) {
      console.warn('[sync] job_listings upsert failed:', listingErr.message)
      return
    }

    // Upsert application
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: appErr } = await (supabase.from('applications') as any).upsert(
      {
        id: job.id,
        user_id: userId,
        job_id: job.id,
        status: job.status,
        applied_at: job.date || null,
        cv_uploaded: job.cv === '\u2713' || job.cv === 'true',
        portfolio_included: job.portfolio === '\u2713' || job.portfolio === 'true',
        last_contact_at: job.lastContactDate || null,
        rejected_at:
          job.status === 'rejected'
            ? job.lastContactDate || job.date || null
            : null,
      },
      { onConflict: 'id' },
    )
    if (appErr) {
      console.warn('[sync] applications upsert failed:', appErr.message)
    }
  } catch (err) {
    console.warn('[sync] syncJobToSupabase error:', err)
  }
}

/**
 * Sync a single event to Supabase.
 * Called when a new event is added to a job.
 */
export async function syncEventToSupabase(
  jobId: string,
  event: JobEvent,
): Promise<void> {
  try {
    const userId = await getUserId()
    if (!userId) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('application_events') as any).upsert(
      {
        id: event.id,
        user_id: userId,
        application_id: jobId,
        type: event.type,
        date: event.date || null,
        person: event.person || null,
        notes: event.notes || null,
        outcome: event.outcome || null,
        created_at: event.createdAt || new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    if (error) {
      console.warn('[sync] application_events upsert failed:', error.message)
    }
  } catch (err) {
    console.warn('[sync] syncEventToSupabase error:', err)
  }
}

/**
 * Sync a status change to Supabase.
 * Lightweight: only updates the application's status column.
 */
export async function syncStatusChange(
  jobId: string,
  status: JobStatus,
): Promise<void> {
  try {
    const userId = await getUserId()
    if (!userId) return

    const update: { status: string; updated_at: string; rejected_at?: string } = {
      status,
      updated_at: new Date().toISOString(),
    }

    // If switching to rejected, set rejected_at
    if (status === 'rejected') {
      update.rejected_at = new Date().toISOString().slice(0, 10)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('applications') as any)
      .update(update)
      .eq('id', jobId)
      .eq('user_id', userId)

    if (error) {
      console.warn('[sync] status update failed:', error.message)
    }
  } catch (err) {
    console.warn('[sync] syncStatusChange error:', err)
  }
}

/**
 * Sync deletion (soft-delete) to Supabase.
 * Deletes the application and job_listing rows.
 */
export async function syncJobDeletion(jobId: string): Promise<void> {
  try {
    const userId = await getUserId()
    if (!userId) return

    // Delete events first (FK constraint)
    await supabase
      .from('application_events')
      .delete()
      .eq('application_id', jobId)
      .eq('user_id', userId)

    // Delete application
    await supabase
      .from('applications')
      .delete()
      .eq('id', jobId)
      .eq('user_id', userId)

    // Delete job listing
    await supabase
      .from('job_listings')
      .delete()
      .eq('id', jobId)
      .eq('user_id', userId)
  } catch (err) {
    console.warn('[sync] syncJobDeletion error:', err)
  }
}
