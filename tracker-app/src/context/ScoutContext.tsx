import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'

/**
 * ScoutContext — global state for the scout pipeline progress.
 *
 * Lives above AutopilotView + OpenJobsView so both pages can see and
 * react to the same in-flight scout. When the user clicks "Save" on
 * Autopilot OR "Find new jobs" on OpenJobs, we flip this state to
 * `running` and poll `bot_runs` every 5s for the counters.
 *
 * Stage inference (client-side, since backend doesn't emit phase events):
 *   - elapsed 0-5s OR not yet polled                  → 'init'     (5%)
 *   - elapsed 5s+ AND jobs_found = 0                  → 'scouting' (20%)
 *   - jobs_found > 0 AND jobs_qualified = 0           → 'scouting' (15% + jobs_found/50 * 40%)
 *   - jobs_qualified > 0 AND status = 'running'       → 'qualifying' (60% + jobs_qualified/jobs_found * 25%)
 *   - status = 'completed'                            → 'done' (100%)
 *
 * % is a LIE but a believable one. It's tied to real counter updates from
 * the backend so it moves when work happens. Never goes backwards.
 */

export type ScoutStage = 'idle' | 'init' | 'scouting' | 'qualifying' | 'persisting' | 'done' | 'error'

export interface ScoutState {
  runId: string | null
  stage: ScoutStage
  percent: number        // 0-100, monotonically increasing
  jobsFound: number
  jobsQualified: number
  startedAt: number | null  // epoch ms
  elapsedSec: number
  errorMessage: string | null
}

interface ScoutContextValue extends ScoutState {
  /** Start tracking a new scout run. Called by triggerScout() wrapper. */
  startScout: (runId: string) => void
  /** Reset to idle (after user acknowledges completion). */
  dismiss: () => void
  /** Is a scout currently in flight? */
  isRunning: boolean
}

const ScoutContext = createContext<ScoutContextValue | undefined>(undefined)

const INITIAL_STATE: ScoutState = {
  runId: null,
  stage: 'idle',
  percent: 0,
  jobsFound: 0,
  jobsQualified: 0,
  startedAt: null,
  elapsedSec: 0,
  errorMessage: null,
}

const POLL_INTERVAL_MS = 4000  // 4s — balance freshness vs Supabase load
const MAX_DURATION_MS = 5 * 60 * 1000  // 5 min hard stop
const EXPECTED_DURATION_S = 90  // typical scout time, used for time-based % floor

export function ScoutProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ScoutState>(INITIAL_STATE)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const cleanup = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
  }, [])

  const dismiss = useCallback(() => {
    cleanup()
    setState(INITIAL_STATE)
  }, [cleanup])

  const computeStage = (
    status: string,
    jobsFound: number,
    jobsQualified: number,
    elapsedSec: number,
  ): { stage: ScoutStage; percent: number } => {
    if (status === 'completed') return { stage: 'done', percent: 100 }
    if (status === 'failed') return { stage: 'error', percent: 0 }

    // Init: first 5 seconds
    if (elapsedSec < 5 && jobsFound === 0) {
      return { stage: 'init', percent: Math.min(5 + elapsedSec, 10) }
    }

    // Scouting: jobs being discovered
    if (jobsFound === 0 || jobsQualified === 0) {
      // Time-based floor (15% → 55% over 0-60s)
      const timePct = Math.min(15 + (elapsedSec / 60) * 40, 55)
      // Counter boost (up to +5%)
      const counterPct = Math.min(jobsFound / 10, 5)
      return { stage: 'scouting', percent: Math.round(timePct + counterPct) }
    }

    // Qualifying: we have found jobs AND some are qualified
    const ratio = jobsFound > 0 ? jobsQualified / jobsFound : 0
    return { stage: 'qualifying', percent: Math.round(60 + ratio * 30) }
  }

  const pollOnce = useCallback(async (runId: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('bot_runs') as any)
        .select('status, jobs_found, jobs_qualified')
        .eq('id', runId)
        .maybeSingle()

      if (error) {
        console.warn('[scout] poll error:', error.message)
        return
      }

      if (!data) return  // row not visible yet (eventual consistency)

      setState(prev => {
        // Ignore updates if a different run has started
        if (prev.runId !== runId) return prev
        if (prev.stage === 'done' || prev.stage === 'error') return prev

        const jobsFound = (data.jobs_found as number) || 0
        const jobsQualified = (data.jobs_qualified as number) || 0
        const status = (data.status as string) || 'running'
        const elapsedSec = prev.startedAt ? Math.floor((Date.now() - prev.startedAt) / 1000) : 0

        const { stage, percent: newPercent } = computeStage(status, jobsFound, jobsQualified, elapsedSec)
        // Monotonic: never go backwards
        const percent = Math.max(prev.percent, newPercent)

        return { ...prev, stage, percent, jobsFound, jobsQualified, elapsedSec }
      })
    } catch (err) {
      console.warn('[scout] poll exception:', err)
    }
  }, [])

  const scheduleNextPoll = useCallback((runId: string) => {
    pollTimerRef.current = setTimeout(async () => {
      await pollOnce(runId)
      setState(prev => {
        if (prev.runId !== runId) return prev
        if (prev.stage === 'done' || prev.stage === 'error') return prev
        // Hard stop after MAX_DURATION_MS
        if (prev.startedAt && Date.now() - prev.startedAt > MAX_DURATION_MS) {
          return { ...prev, stage: 'error', errorMessage: 'Scout is taking longer than usual. Check back soon.' }
        }
        // Schedule next poll
        scheduleNextPoll(runId)
        return prev
      })
    }, POLL_INTERVAL_MS)
  }, [pollOnce])

  const startScout = useCallback((runId: string) => {
    cleanup()
    const now = Date.now()
    setState({
      runId,
      stage: 'init',
      percent: 5,
      jobsFound: 0,
      jobsQualified: 0,
      startedAt: now,
      elapsedSec: 0,
      errorMessage: null,
    })
    // Tick elapsed every second for smooth time-based % updates
    elapsedTimerRef.current = setInterval(() => {
      setState(prev => {
        if (prev.runId !== runId) return prev
        if (prev.stage === 'done' || prev.stage === 'error') return prev
        const elapsedSec = prev.startedAt ? Math.floor((Date.now() - prev.startedAt) / 1000) : 0
        // Also bump percent based on time if counters haven't updated
        const { stage, percent: timePercent } = computeStage('running', prev.jobsFound, prev.jobsQualified, elapsedSec)
        const percent = Math.max(prev.percent, timePercent)
        return { ...prev, stage, percent, elapsedSec }
      })
    }, 1000)
    // First poll immediately, then schedule recurring
    pollOnce(runId)
    scheduleNextPoll(runId)
  }, [cleanup, pollOnce, scheduleNextPoll])

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup])

  // When done, stop polling (keep state so UI can show completion banner)
  useEffect(() => {
    if (state.stage === 'done' || state.stage === 'error') {
      cleanup()
      // Auto-dismiss after 10s (gives user time to see the success)
      const t = setTimeout(() => setState(INITIAL_STATE), 10_000)
      return () => clearTimeout(t)
    }
  }, [state.stage, cleanup])

  // Listen for tracker:jobs-refresh events (fired by existing code paths)
  useEffect(() => {
    function onRefresh(e: Event) {
      const detail = (e as CustomEvent).detail as { runId?: string } | undefined
      if (detail?.runId && detail.runId === state.runId) {
        // Backend says the run is done — force a final poll
        pollOnce(detail.runId)
      }
    }
    window.addEventListener('tracker:jobs-refresh', onRefresh)
    return () => window.removeEventListener('tracker:jobs-refresh', onRefresh)
  }, [state.runId, pollOnce])

  const isRunning = state.stage !== 'idle' && state.stage !== 'done' && state.stage !== 'error'

  return (
    <ScoutContext.Provider value={{ ...state, startScout, dismiss, isRunning }}>
      {children}
    </ScoutContext.Provider>
  )
}

/**
 * Resilient scout hook. Returns a no-op default when no provider is mounted
 * (e.g., in unit tests that render a single view in isolation). In a real
 * app, the provider is always mounted at the top of App.tsx.
 */
const NOOP_SCOUT_VALUE: ScoutContextValue = {
  ...INITIAL_STATE,
  isRunning: false,
  startScout: () => {
    if (typeof console !== 'undefined') {
      console.warn('[scout] startScout called outside ScoutProvider — no-op')
    }
  },
  dismiss: () => {},
}

export function useScout(): ScoutContextValue {
  const ctx = useContext(ScoutContext)
  return ctx ?? NOOP_SCOUT_VALUE
}

// Expose the expected duration for any component that wants to show a
// time-based countdown fallback.
export { EXPECTED_DURATION_S as SCOUT_EXPECTED_DURATION_S }
