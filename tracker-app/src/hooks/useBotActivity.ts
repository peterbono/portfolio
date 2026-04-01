import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
export interface BotActivityItem {
  id: string
  action: 'applied' | 'skipped' | 'failed' | 'found' | 'qualified' | 'disqualified'
  company: string
  role: string
  ats: string
  reason?: string
  createdAt: string
}

export interface BotRunStatus {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  jobsFound: number
  jobsApplied: number
  jobsSkipped: number
  jobsFailed: number
  startedAt?: string
  completedAt?: string
  errorMessage?: string
}

interface UseBotActivityReturn {
  activities: BotActivityItem[]
  currentRun: BotRunStatus | null
  isLive: boolean
  /** Force-refresh activities from Supabase (useful when realtime is down) */
  refresh: () => Promise<void>
}

const ACTIVITY_LIMIT = 50
const POLL_INTERVAL_MS = 10_000 // Fallback polling every 10 seconds (was 3s — reduced for egress)

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function toActivityItem(row: Record<string, unknown>): BotActivityItem {
  return {
    id: row.id as string,
    action: row.action as BotActivityItem['action'],
    company: (row.company as string) ?? '',
    role: (row.role as string) ?? '',
    ats: (row.ats as string) ?? '',
    reason: (row.reason as string) ?? undefined,
    createdAt: row.created_at as string,
  }
}

function toRunStatus(row: Record<string, unknown>): BotRunStatus {
  return {
    id: row.id as string,
    status: row.status as BotRunStatus['status'],
    jobsFound: (row.jobs_found as number) ?? 0,
    jobsApplied: (row.jobs_applied as number) ?? 0,
    jobsSkipped: (row.jobs_skipped as number) ?? 0,
    jobsFailed: (row.jobs_failed as number) ?? 0,
    startedAt: (row.started_at as string) ?? undefined,
    completedAt: (row.completed_at as string) ?? undefined,
    errorMessage: (row.error_message as string) ?? undefined,
  }
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */
export function useBotActivity(): UseBotActivityReturn {
  const [activities, setActivities] = useState<BotActivityItem[]>([])
  const [currentRun, setCurrentRun] = useState<BotRunStatus | null>(null)
  const [isLive, setIsLive] = useState(false)
  const channelsRef = useRef<RealtimeChannel[]>([])
  const lastActivityIdRef = useRef<string | null>(null)

  // ---- Load / refresh data from Supabase --------------------------------
  const loadActivities = useCallback(async () => {
    try {
      // Fetch last 50 activity log entries, newest first
      // IMPORTANT: Select only columns used by toActivityItem() — exclude screenshot_url
      // (base64 screenshots are 300-500KB each; .select('*') was causing 39 GB/month egress)
      const { data: activityData } = await supabase
        .from('bot_activity_log')
        .select('id, action, company, role, ats, reason, created_at')
        .order('created_at', { ascending: false })
        .limit(ACTIVITY_LIMIT)

      if (activityData && activityData.length > 0) {
        const items = activityData.map(toActivityItem)
        // Only update if we got new data (compare first item id)
        const newFirstId = items[0]?.id
        if (newFirstId !== lastActivityIdRef.current) {
          lastActivityIdRef.current = newFirstId
          setActivities(items)
        }
      }

      // Fetch the most recent non-cancelled bot run (select only needed columns)
      const { data: runData } = await supabase
        .from('bot_runs')
        .select('id, status, jobs_found, jobs_applied, jobs_skipped, jobs_failed, started_at, completed_at, error_message, created_at')
        .order('created_at', { ascending: false })
        .limit(1)

      if (runData && runData.length > 0) {
        const run = toRunStatus(runData[0])
        // Auto-expire: if run has been 'running' for > 10 minutes, treat as stale/failed
        if (run.status === 'running' && run.startedAt) {
          const elapsed = Date.now() - new Date(run.startedAt).getTime()
          if (elapsed > 10 * 60 * 1000) {
            run.status = 'failed'
            run.errorMessage = 'Run expired (stale > 10 minutes)'
            // Also update Supabase so it doesn't keep coming back
            ;(supabase as any).from('bot_runs').update({
              status: 'failed',
              completed_at: new Date().toISOString(),
              error_message: 'Auto-expired: stale run > 10 minutes',
            }).eq('id', run.id).then(() => {})
          }
        }
        setCurrentRun(run)
      }
    } catch {
      // Supabase unreachable -- stay in offline mode with empty data
    }
  }, [])

  // Load on mount
  useEffect(() => {
    loadActivities()
  }, [loadActivities])

  // ---- Realtime subscriptions ------------------------------------
  useEffect(() => {
    let mounted = true

    // Channel for bot_activity_log INSERT events
    const activityChannel = supabase
      .channel('bot-activity-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bot_activity_log',
        },
        (payload) => {
          if (!mounted) return
          const item = toActivityItem(payload.new)
          lastActivityIdRef.current = item.id
          setActivities((prev) => {
            const next = [item, ...prev]
            // Keep only the latest N items
            return next.length > ACTIVITY_LIMIT ? next.slice(0, ACTIVITY_LIMIT) : next
          })
        },
      )
      .subscribe((status) => {
        if (mounted) setIsLive(status === 'SUBSCRIBED')
      })

    // Channel for bot_runs changes (INSERT + UPDATE)
    const runsChannel = supabase
      .channel('bot-runs-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bot_runs',
        },
        (payload) => {
          if (!mounted) return
          setCurrentRun(toRunStatus(payload.new))
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'bot_runs',
        },
        (payload) => {
          if (!mounted) return
          setCurrentRun((prev) => {
            // Only update if this is the run we're tracking
            if (prev && prev.id === (payload.new as Record<string, unknown>).id) {
              return toRunStatus(payload.new)
            }
            // If no current run, accept any update
            if (!prev) return toRunStatus(payload.new)
            return prev
          })
        },
      )
      .subscribe()

    channelsRef.current = [activityChannel, runsChannel]

    return () => {
      mounted = false
      // Clean up subscriptions
      channelsRef.current.forEach((ch) => {
        supabase.removeChannel(ch)
      })
      channelsRef.current = []
    }
  }, [])

  // ---- Fallback polling when realtime isn't working ----
  // If `isLive` is false (realtime subscription failed), poll every 4 seconds
  // Also poll if there's an active run (belt and suspenders)
  useEffect(() => {
    const hasActiveRun = currentRun?.status === 'running' || currentRun?.status === 'pending'
    const shouldPoll = !isLive || hasActiveRun

    if (!shouldPoll) return

    const interval = setInterval(() => {
      loadActivities()
    }, POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [isLive, currentRun?.status, loadActivities])

  return { activities, currentRun, isLive, refresh: loadActivities }
}
