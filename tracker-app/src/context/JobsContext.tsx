import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from 'react'
import type { Job, JobStatus, JobEvent } from '../types/job'
import seedData from '../data/jobs.json'

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

function mergeJobs(seed: Job[], overrides: Overrides): Job[] {
  const merged = seed.map((job) => {
    const override = overrides[job.id]
    return override ? { ...job, ...override } : job
  })

  // Include any jobs that exist only in overrides (manually added)
  const seedIds = new Set(seed.map((j) => j.id))
  for (const [id, override] of Object.entries(overrides)) {
    if (!seedIds.has(id) && override.company && override.role) {
      merged.push({ ...override, id } as Job)
    }
  }

  return merged
}

interface JobsContextValue {
  jobs: Job[]
  updateJobStatus: (id: string, status: JobStatus) => void
  addJobEvent: (id: string, event: JobEvent) => void
  addJob: (job: Job) => void
  counts: Record<JobStatus, number>
}

const JobsContext = createContext<JobsContextValue | null>(null)

export function JobsProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Overrides>(loadOverrides)

  const jobs = useMemo(() => mergeJobs(seedJobs, overrides), [overrides])

  useEffect(() => {
    saveOverrides(overrides)
  }, [overrides])

  const updateJobStatus = useCallback((id: string, status: JobStatus) => {
    setOverrides((prev) => ({
      ...prev,
      [id]: { ...prev[id], status },
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

  const addJob = useCallback((job: Job) => {
    setOverrides((prev) => ({
      ...prev,
      [job.id]: job,
    }))
  }, [])

  const counts = useMemo(() => {
    const c = {} as Record<JobStatus, number>
    const allStatuses: JobStatus[] = [
      'submitted', 'manual', 'a_soumettre', 'skipped', 'saved',
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
    <JobsContext.Provider value={{ jobs, updateJobStatus, addJobEvent, addJob, counts }}>
      {children}
    </JobsContext.Provider>
  )
}

export function useJobs() {
  const ctx = useContext(JobsContext)
  if (!ctx) throw new Error('useJobs must be used within JobsProvider')
  return ctx
}
