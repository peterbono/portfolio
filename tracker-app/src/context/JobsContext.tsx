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

const seedJobs: Job[] = seedData as Job[]

const STORAGE_KEY = 'tracker_v2_overrides'

interface Overrides {
  [jobId: string]: Partial<Job>
}

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

function mergeJobs(seed: Job[], overrides: Overrides): Job[] {
  const deletedIds = new Set<string>()
  for (const [id, ov] of Object.entries(overrides)) {
    if ((ov as Record<string, unknown>)._deleted) deletedIds.add(id)
  }

  const merged = seed
    .filter(job => !deletedIds.has(job.id))
    .map((job) => {
      const override = overrides[job.id]
      let result = override ? { ...job, ...override } : { ...job }
      // Apply known rejections ONLY if user hasn't manually set a different status
      const userSetStatus = override?.status
      if (!userSetStatus && rejectedSet.has(result.company.toLowerCase()) && (result.status === 'submitted' || result.status === 'manual')) {
        result = { ...result, status: 'rejected' as JobStatus }
      }
      return result
    })

  // Include any jobs that exist only in overrides (manually added, not deleted)
  const seedIds = new Set(seed.map((j) => j.id))
  for (const [id, override] of Object.entries(overrides)) {
    if (!seedIds.has(id) && !deletedIds.has(id) && override.company && override.role) {
      merged.push({ ...override, id } as Job)
    }
  }

  return merged
}

function toLocalDateStr(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function getTimeThreshold(range: TimeRange): string | null {
  if (range === 'all') return null
  const now = new Date()
  let d: Date
  switch (range) {
    case 'today': d = new Date(now); d.setHours(0,0,0,0); break
    case 'week': d = new Date(now); d.setDate(d.getDate() - d.getDay()); d.setHours(0,0,0,0); break
    case 'month': d = new Date(now.getFullYear(), now.getMonth(), 1); break
    case '3months': d = new Date(now.getFullYear(), now.getMonth() - 3, 1); break
    default: return null
  }
  return toLocalDateStr(d)
}

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
  counts: Record<JobStatus, number>
}

const JobsContext = createContext<JobsContextValue | null>(null)

export function JobsProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Overrides>(loadOverrides)
  const { timeRange, areaFilter, workMode } = useUI()

  const allJobs = useMemo(() => mergeJobs(seedJobs, overrides), [overrides])

  const jobs = useMemo(() => {
    let filtered = allJobs

    // Time filter — use most recent activity date (apply, event, or rejection)
    const threshold = getTimeThreshold(timeRange)
    if (threshold) {
      filtered = filtered.filter(j => {
        const activityDate = j.lastContactDate?.split('T')[0]
          || (j.events && j.events.length > 0
            ? [...j.events].sort((a, b) => b.date.localeCompare(a.date))[0].date.split('T')[0]
            : null)
          || j.date
        return activityDate >= threshold
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
        [id]: { ...existing, events, lastContactDate: event.date },
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
    const rejList = rejections.map(r => ({
      company: r.company,
      role: r.role || '',
      date: r.date ? r.date.split('T')[0] : undefined,
    }))
    const rejMap = new Map<string, { date?: string; role: string }>()
    for (const r of rejList) rejMap.set(r.company.toLowerCase(), { date: r.date, role: r.role })

    function addRejectionEvent(existing: Partial<Job>, rejDate: string): Partial<Job> {
      const events = existing.events ?? []
      // Don't add duplicate rejection events
      if (events.some(e => e.type === 'rejection' as unknown)) return existing
      const rejEvent: JobEvent = {
        id: `rej-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        date: rejDate,
        type: 'rejection' as EventType,
        person: '',
        notes: 'Application rejected',
        outcome: 'misaligned',
        createdAt: new Date().toISOString(),
      }
      return { ...existing, events: [...events, rejEvent], lastContactDate: rejDate }
    }

    setOverrides((prev) => {
      const next = { ...prev }
      const matchedCompanies = new Set<string>()

      for (const job of seedJobs) {
        const companyLower = job.company.toLowerCase()
        if (!rejMap.has(companyLower)) continue
        matchedCompanies.add(companyLower)
        const { date: rejDate } = rejMap.get(companyLower)!
        if (job.status === 'submitted' || job.status === 'manual') {
          next[job.id] = {
            ...next[job.id],
            status: 'rejected' as JobStatus,
            ...(rejDate ? addRejectionEvent(next[job.id] ?? {}, rejDate) : {}),
          }
        } else if (job.status === 'rejected' && rejDate) {
          next[job.id] = {
            ...next[job.id],
            ...addRejectionEvent(next[job.id] ?? {}, rejDate),
          }
        }
      }
      // Also check overridden jobs
      for (const [id, override] of Object.entries(prev)) {
        const job = seedJobs.find(j => j.id === id)
        const company = override.company || job?.company || ''
        const status = override.status || job?.status
        const companyLower = company.toLowerCase()
        if (!rejMap.has(companyLower)) continue
        matchedCompanies.add(companyLower)
        const { date: rejDate } = rejMap.get(companyLower)!
        if (status === 'submitted' || status === 'manual') {
          next[id] = {
            ...next[id],
            status: 'rejected' as JobStatus,
            ...(rejDate ? addRejectionEvent(next[id] ?? {}, rejDate) : {}),
          }
        } else if (status === 'rejected' && rejDate) {
          next[id] = {
            ...next[id],
            ...addRejectionEvent(next[id] ?? {}, rejDate),
          }
        }
      }

      // Auto-create jobs for rejections with no matching job
      for (const [companyLower, { date: rejDate, role }] of rejMap.entries()) {
        if (matchedCompanies.has(companyLower)) continue
        // Check if already created in a previous sync
        const alreadyExists = Object.values(next).some(ov =>
          ov.company && ov.company.toLowerCase() === companyLower && ov.status === 'rejected'
        )
        if (alreadyExists) continue
        const id = `auto-rej-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const company = rejList.find(r => r.company.toLowerCase() === companyLower)?.company || companyLower
        const newJob: Partial<Job> = {
          company,
          role: role || 'Unknown Role',
          status: 'rejected' as JobStatus,
          date: rejDate || toLocalDateStr(new Date()),
          location: '',
          salary: '',
          ats: 'LinkedIn',
          cv: '',
          portfolio: '',
          link: '',
          notes: 'Auto-created from Gmail rejection (no prior application tracked)',
          source: 'auto' as const,
          ...(rejDate ? addRejectionEvent({}, rejDate) : {}),
        }
        next[id] = newJob
      }

      return next
    })
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
    <JobsContext.Provider value={{ jobs, allJobs, updateJobStatus, updateJobField, addJobEvent, removeJobEvent, deleteJob, addJob, markRejected, counts }}>
      {children}
    </JobsContext.Provider>
  )
}

export function useJobs() {
  const ctx = useContext(JobsContext)
  if (!ctx) throw new Error('useJobs must be used within JobsProvider')
  return ctx
}
