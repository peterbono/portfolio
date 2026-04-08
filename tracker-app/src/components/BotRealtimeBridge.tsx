/**
 * BotRealtimeBridge — bridges Supabase realtime events into JobsContext.
 *
 * When the bot (Trigger.dev task) creates a job_listing + application in
 * Supabase, the kanban/table needs to reflect it instantly without a page
 * refresh. This component subscribes to Supabase Realtime INSERT events on
 * `job_listings` (where company/role/location live) and, when a bot-sourced
 * listing appears, fetches the linked application status and calls addJob().
 *
 * Mounted inside <JobsProvider> in App.tsx, alongside GmailSyncBridge.
 */

import { useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useJobs } from '../context/JobsContext'
import type { Job, JobStatus } from '../types/job'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { notifyApplicationsSubmitted } from '../lib/notifications'

/** Map Supabase application status strings to our local JobStatus type */
function toJobStatus(dbStatus: string | null): JobStatus {
  switch (dbStatus) {
    case 'submitted': return 'submitted'
    case 'skipped': return 'expired'
    case 'manual': return 'submitted'
    case 'rejected': return 'rejected'
    case 'screening': return 'screening'
    case 'interviewing': return 'interviewing'
    case 'offer': return 'offer'
    case 'negotiation': return 'offer'
    case 'withdrawn': return 'rejected'
    case 'saved': return 'submitted'
    default: return 'submitted'
  }
}

export function BotRealtimeBridge() {
  const { allJobs, addJob } = useJobs()
  const channelRef = useRef<RealtimeChannel | null>(null)

  // Keep a ref to allJobs so the realtime callback always sees the latest
  const allJobsRef = useRef(allJobs)
  useEffect(() => {
    allJobsRef.current = allJobs
  }, [allJobs])

  // Track IDs we've already processed to avoid double-adds from re-renders
  const processedIds = useRef(new Set<string>())

  // ── Batched notification: accumulate jobs for 5s then send ONE email ──
  const batchBuffer = useRef<{ company: string; role: string }[]>([])
  const batchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushBatchNotification = useCallback(() => {
    const items = batchBuffer.current
    if (items.length === 0) return
    batchBuffer.current = []

    // Use the first job's info as representative; count = total batch size
    const first = items[0]
    notifyApplicationsSubmitted({
      company: items.length > 1 ? `${first.company} + ${items.length - 1} more` : first.company,
      role: first.role,
      count: items.length,
    })
  }, [])

  const queueNotification = useCallback((company: string, role: string) => {
    batchBuffer.current.push({ company, role })
    // Reset the 5-second debounce timer
    if (batchTimer.current) clearTimeout(batchTimer.current)
    batchTimer.current = setTimeout(flushBatchNotification, 5000)
  }, [flushBatchNotification])

  // Flush pending notifications on unmount
  useEffect(() => {
    return () => {
      if (batchTimer.current) {
        clearTimeout(batchTimer.current)
        flushBatchNotification()
      }
    }
  }, [flushBatchNotification])

  useEffect(() => {
    let mounted = true

    const channel = supabase
      .channel('bot-jobs-bridge')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'job_listings',
        },
        async (payload) => {
          if (!mounted) return

          const row = payload.new as Record<string, unknown>

          // Only process bot-created listings
          if (row.source !== 'bot') return

          const listingId = row.id as string

          // Skip if already processed
          if (processedIds.current.has(listingId)) return
          processedIds.current.add(listingId)

          const company = (row.company as string) ?? ''
          const role = (row.role as string) ?? ''

          // Deduplicate: check if this company+role combo already exists in jobs
          const companyLower = company.toLowerCase()
          const roleLower = role.toLowerCase()
          const exists = allJobsRef.current.some(
            (j) =>
              j.company.toLowerCase() === companyLower &&
              j.role.toLowerCase() === roleLower,
          )
          if (exists) return

          // Fetch the linked application to get the status and applied_at date
          let status: JobStatus = 'submitted'
          let appliedAt: string | null = null
          try {
            const { data: appData } = await supabase
              .from('applications')
              .select('status, applied_at')
              .eq('job_id', listingId)
              .limit(1)
              .single() as { data: { status: string; applied_at: string | null } | null; error: unknown }

            if (appData) {
              status = toJobStatus(appData.status)
              appliedAt = appData.applied_at
            }
          } catch {
            // Application might not be inserted yet (race condition).
            // Default to 'submitted' — the user can fix manually if needed.
          }

          if (!mounted) return

          // Build the Job object and add to context
          // Prefer applied_at (actual submission date) over created_at (listing discovery date)
          const job: Job = {
            id: `bot-${listingId}`,
            company,
            role,
            status,
            date: (appliedAt ?? (row.created_at as string) ?? new Date().toISOString()).split('T')[0],
            location: (row.location as string) ?? '',
            salary: (row.salary as string) ?? '',
            ats: (row.ats as string) ?? '',
            cv: '',
            portfolio: '',
            link: (row.link as string) ?? '',
            notes: 'Auto-created by bot run',
            source: 'auto',
            area: (row.area as Job['area']) ?? undefined,
          }

          addJob(job)

          // Queue batched email notification (fires after 5s of inactivity)
          queueNotification(company, role)
        },
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      mounted = false
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addJob, queueNotification])

  return null
}
