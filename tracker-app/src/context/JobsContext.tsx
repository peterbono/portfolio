import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from 'react'
import type { Job, JobStatus, JobEvent, EventType } from '../types/job'
import { useUI, type TimeRange, type AreaFilter, type WorkMode } from './UIContext'
import companyHQ from '../data/company-hq.json'
const HQ_MAP: Record<string, string> = companyHQ as Record<string, string>
import seedData from '../data/jobs.json'
import knownRejections from '../data/known-rejections.json'
import { DEMO_JOBS } from '../data/demo-jobs'
import {
  mergeJobs,
  toLocalDateStr,
  getTimeThreshold,
  computeMarkSubmitted,
  computeMarkRejected,
  type Overrides,
} from './jobs-logic'

const seedJobs: Job[] = seedData as Job[]

const STORAGE_KEY = 'tracker_v2_overrides'
const DEMO_CLEARED_KEY = 'tracker_v2_demo_cleared'

function loadOverrides(): Overrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveOverrides(overrides: Overrides) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
}

const rejectedSet = new Set((knownRejections as string[]).map(c => c.toLowerCase()))

interface JobsContextValue {
  jobs: Job[]
  allJobs: Job[]
  updateJobStatus: (id: string, status: JobStatus) => void
  updateJobField: (id: string, field: string, value: string) => void
  addJobEvent: (id: string, event: JobEvent) => void
  removeJobEvent: (id: string, eventId: string) => void
  deleteJob: (id: string) => void
  addJob: (job: Job) => void
  markRejected: (rejections: { company: string; date?: string; role?: string }[]) => void
  markSubmitted: (applications: { company: string; role?: string; date?: string }[]) => void
  counts: Record<JobStatus, number>
  /** True when showing demo data (no user data, not authenticated) */
  isDemo: boolean
  /** Clear demo data and switch to empty state */
  clearDemoData: () => void
  /** Count of non-demo, manually-added jobs (for sunk cost nudge) */
  manualJobCount: number
}

const JobsContext = createContext<JobsContextValue | null>(null)

export function JobsProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Overrides>(loadOverrides)
  const [demoCleared, setDemoCleared] = useState(
    () => localStorage.getItem(DEMO_CLEARED_KEY) === 'true'
  )
  const { timeRange, areaFilter, workMode } = useUI()

  // Determine if we should show demo data:
  // - No localStorage overrides exist (fresh user)
  // - User hasn't explicitly cleared demo data
  const hasUserData = useMemo(() => {
    const keys = Object.keys(overrides)
    // If there are any overrides that are NOT demo-prefixed, user has their own data
    return keys.length > 0 && keys.some(k => !k.startsWith('demo-'))
  }, [overrides])

  const isDemo = !hasUserData && !demoCleared

  const allJobs = useMemo(() => {
    const baseJobs = mergeJobs(seedJobs, overrides, rejectedSet)
    if (isDemo) {
      // Prepend demo jobs (they won't collide with seed IDs)
      return [...DEMO_JOBS, ...baseJobs]
    }
    return baseJobs
  }, [overrides, isDemo])

  const clearDemoData = useCallback(() => {
    setDemoCleared(true)
    try {
      localStorage.setItem(DEMO_CLEARED_KEY, 'true')
    } catch { /* ignore */ }
  }, [])

  // Count of non-demo, manually-added jobs (for sunk cost nudge)
  const manualJobCount = useMemo(() => {
    return Object.keys(overrides).filter(
      k => !k.startsWith('demo-') && !(overrides[k] as Record<string, unknown>)._deleted
    ).length
  }, [overrides])

  const jobs = useMemo(() => {
    let filtered = allJobs

    // Time filter — use MAX date across apply, lastContact, and latest event
    const threshold = getTimeThreshold(timeRange)
    if (threshold) {
      filtered = filtered.filter(j => {
        const candidates = [j.date]
        if (j.lastContactDate) candidates.push(j.lastContactDate.split('T')[0])
        if (j.events && j.events.length > 0) {
          for (const ev of j.events) {
            if (ev.date) candidates.push(ev.date.split('T')[0])
          }
        }
        const latestActivity = candidates.reduce((a, b) => a > b ? a : b)
        return latestActivity >= threshold
      })
    }

    // Area filter
    if (areaFilter !== 'all') {
      filtered = filtered.filter(j => {
        const area = (j as unknown as Record<string, string>).area
        if (area) return area === areaFilter
        const loc = (j.location || '').toLowerCase()
        const apac = ['bangkok','singapore','india','tokyo','japan','korea','seoul','hong kong','manila','philippines','thailand','vietnam','indonesia','malaysia','australia','china','taiwan','apac']
        const emea = ['london','berlin','paris','amsterdam','dublin','europe','germany','france','uk','spain','portugal','ireland','netherlands','sweden','switzerland','israel','dubai','emea']
        const americas = ['new york','san francisco','usa','united states','canada','toronto','los angeles','chicago','seattle','boston','brazil','mexico','americas']
        if (areaFilter === 'apac' && apac.some(k => loc.includes(k))) return true
        if (areaFilter === 'emea' && emea.some(k => loc.includes(k))) return true
        if (areaFilter === 'americas' && americas.some(k => loc.includes(k))) return true
        // Company HQ fallback
        return HQ_MAP[j.company] === areaFilter
      })
    }

    // Work mode filter
    if (workMode !== 'all') {
      filtered = filtered.filter(j => {
        const loc = (j.location || '').toLowerCase()
        if (workMode === 'remote') return loc.includes('remote')
        if (workMode === 'hybrid') return loc.includes('hybrid')
        if (workMode === 'onsite') return !loc.includes('remote') && !loc.includes('hybrid')
        return true
      })
    }

    return filtered
  }, [allJobs, timeRange, areaFilter, workMode])

  useEffect(() => {
    saveOverrides(overrides)
  }, [overrides])

  const updateJobStatus = useCallback((id: string, status: JobStatus) => {
    setOverrides((prev) => ({
      ...prev,
      [id]: { ...prev[id], status },
    }))
  }, [])

  const updateJobField = useCallback((id: string, field: string, value: string) => {
    setOverrides((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }))
  }, [])

  const addJobEvent = useCallback((id: string, event: JobEvent) => {
    setOverrides((prev) => {
      const existing = prev[id] ?? {}
      const events = [...(existing.events ?? []), event]
      return {
        ...prev,
        [id]: { ...existing, events, lastContactDate: event.date.split('T')[0] },
      }
    })
  }, [])

  const removeJobEvent = useCallback((id: string, eventId: string) => {
    setOverrides((prev) => {
      const existing = prev[id] ?? {}
      const events = (existing.events ?? []).filter(e => e.id !== eventId)
      return {
        ...prev,
        [id]: { ...existing, events },
      }
    })
  }, [])

  const addJob = useCallback((job: Job) => {
    setOverrides((prev) => ({
      ...prev,
      [job.id]: job,
    }))
  }, [])

  const deleteJob = useCallback((id: string) => {
    setOverrides((prev) => ({
      ...prev,
      [id]: { ...prev[id], _deleted: true } as unknown as Partial<Job>,
    }))
  }, [])

  const markRejected = useCallback((rejections: { company: string; date?: string; role?: string }[]) => {
    setOverrides((prev) => computeMarkRejected(prev, seedJobs, rejections))
  }, [])

  // ─── Mark applications as submitted (from Gmail confirmation emails) ───
  const markSubmitted = useCallback((applications: { company: string; role?: string; date?: string }[]) => {
    setOverrides((prev) => computeMarkSubmitted(prev, seedJobs, applications))
  }, [])

  const counts = useMemo(() => {
    const c = {} as Record<JobStatus, number>
    const allStatuses: JobStatus[] = [
      'submitted', 'manual', 'skipped', 'saved',
      'rejected', 'screening', 'interviewing', 'challenge',
      'offer', 'negotiation', 'withdrawn', 'ghosted',
    ]
    for (const s of allStatuses) c[s] = 0
    for (const job of jobs) {
      c[job.status] = (c[job.status] ?? 0) + 1
    }
    return c
  }, [jobs])

  return (
    <JobsContext.Provider value={{ jobs, allJobs, updateJobStatus, updateJobField, addJobEvent, removeJobEvent, deleteJob, addJob, markRejected, markSubmitted, counts, isDemo, clearDemoData, manualJobCount }}>
      {children}
    </JobsContext.Provider>
  )
}

export function useJobs() {
  const ctx = useContext(JobsContext)
  if (!ctx) throw new Error('useJobs must be used within JobsProvider')
  return ctx
}
