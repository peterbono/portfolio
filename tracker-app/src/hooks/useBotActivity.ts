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
}

const ACTIVITY_LIMIT = 50

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

  // ---- Load initial data on mount --------------------------------
  const loadInitialData = useCallback(async () => {
    try {
      // Fetch last 50 activity log entries, newest first
      const { data: activityData } = await supabase
        .from('bot_activity_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(ACTIVITY_LIMIT)

      if (activityData) {
        setActivities(activityData.map(toActivityItem))
      }

      // Fetch the most recent non-cancelled bot run
      const { data: runData } = await supabase
        .from('bot_runs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)

      if (runData && runData.length > 0) {
        setCurrentRun(toRunStatus(runData[0]))
      }
    } catch {
      // Supabase unreachable -- stay in offline mode with empty data
    }
  }, [])

  useEffect(() => {
    loadInitialData()
  }, [loadInitialData])

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

  return { activities, currentRun, isLive }
}
