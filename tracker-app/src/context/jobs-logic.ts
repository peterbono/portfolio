/**
 * Pure logic functions extracted from JobsContext for testability.
 * These have zero React dependencies.
 */
import type { Job, JobStatus, JobEvent, EventType } from '../types/job'

/* ── Types ─────────────────────────────────────────────────────────── */

export interface Overrides {
  [jobId: string]: Partial<Job> & { _deleted?: boolean; _autoExpired?: boolean }
}

export type TimeRange = 'all' | 'today' | 'week' | 'month' | '3months'

/* ── Date helpers ──────────────────────────────────────────────────── */

export function toLocalDateStr(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function getTimeThreshold(range: TimeRange): string | null {
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

/* ── Merge logic ───────────────────────────────────────────────────── */

export function mergeJobs(
  seed: Job[],
  overrides: Overrides,
  rejectedSet: Set<string>,
): Job[] {
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
      if (!userSetStatus && rejectedSet.has(result.company.toLowerCase()) && (result.status === 'submitted')) {
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

/* ── markSubmitted logic (pure: takes prev overrides, returns next) ─ */

export function computeMarkSubmitted(
  prev: Overrides,
  seedJobs: Job[],
  applications: { company: string; role?: string; date?: string }[],
): Overrides {
  const appList = applications.map(a => ({
    company: a.company,
    role: a.role || '',
    date: a.date ? a.date.split('T')[0] : toLocalDateStr(new Date()),
  }))
  const appMap = new Map<string, { date: string; role: string }>()
  for (const a of appList) appMap.set(a.company.toLowerCase(), { date: a.date, role: a.role })

  const next = { ...prev }
  const matchedCompanies = new Set<string>()

  // Check seed jobs — mark as submitted if not already
  for (const job of seedJobs) {
    const companyLower = job.company.toLowerCase()
    if (!appMap.has(companyLower)) continue
    matchedCompanies.add(companyLower)
    const effectiveStatus = (next[job.id]?.status || job.status) as string
    if (effectiveStatus !== 'submitted') {
      next[job.id] = { ...next[job.id], status: 'submitted' as JobStatus }
    }
  }
  // Check overridden jobs
  for (const [id, override] of Object.entries(prev)) {
    const job = seedJobs.find(j => j.id === id)
    const company = override.company || job?.company || ''
    const status = override.status || job?.status
    const companyLower = company.toLowerCase()
    if (!appMap.has(companyLower)) continue
    matchedCompanies.add(companyLower)
    if (status !== 'submitted') {
      next[id] = { ...next[id], status: 'submitted' as JobStatus }
    }
  }

  // Auto-create jobs for confirmations with no matching job
  for (const [companyLower, { date, role }] of appMap.entries()) {
    if (matchedCompanies.has(companyLower)) continue
    // Check if already exists (seed or override)
    const alreadyExists = seedJobs.some(j => j.company.toLowerCase() === companyLower) ||
      Object.values(next).some(ov => ov.company && ov.company.toLowerCase() === companyLower)
    if (alreadyExists) continue
    const id = `auto-app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const company = appList.find(a => a.company.toLowerCase() === companyLower)?.company || companyLower
    const newJob: Partial<Job> = {
      company,
      role: role || 'Unknown Role',
      status: 'submitted' as JobStatus,
      date,
      location: '',
      salary: '',
      ats: 'LinkedIn',
      cv: '',
      portfolio: '',
      link: '',
      notes: 'Auto-created from Gmail confirmation',
      source: 'auto' as const,
    }
    next[id] = newJob
  }

  return next
}

/* ── markRejected logic (pure: takes prev overrides, returns next) ── */

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

export function computeMarkRejected(
  prev: Overrides,
  seedJobs: Job[],
  rejections: { company: string; date?: string; role?: string }[],
): Overrides {
  const rejList = rejections.map(r => ({
    company: r.company,
    role: r.role || '',
    date: r.date ? r.date.split('T')[0] : undefined,
  }))
  const rejMap = new Map<string, { date?: string; role: string }>()
  for (const r of rejList) rejMap.set(r.company.toLowerCase(), { date: r.date, role: r.role })

  const next = { ...prev }
  const matchedCompanies = new Set<string>()

  for (const job of seedJobs) {
    const companyLower = job.company.toLowerCase()
    if (!rejMap.has(companyLower)) continue
    matchedCompanies.add(companyLower)
    const { date: rejDate } = rejMap.get(companyLower)!
    if (job.status === 'submitted') {
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
    if (status === 'submitted') {
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
}

/* ── Auto-expiration heuristics ───────────────────────────────────── */

/** Statuses that should never be auto-expired (active pipeline stages) */
const PROTECTED_STATUSES: Set<JobStatus> = new Set([
  'screening', 'interviewing', 'challenge', 'offer',
  'rejected', 'ghosted', 'expired',
])

/** Days after which a 'submitted' job with no activity is considered ghosted */
const SUBMITTED_GHOST_DAYS = 45

/**
 * Returns the latest activity date for a job: max of job.date,
 * job.lastContactDate, and all event dates.
 */
function getLatestActivityDate(job: Job): string {
  const candidates = [job.date]
  if (job.lastContactDate) candidates.push(job.lastContactDate.split('T')[0])
  if (job.events && job.events.length > 0) {
    for (const ev of job.events) {
      if (ev.date) candidates.push(ev.date.split('T')[0])
    }
  }
  return candidates.reduce((a, b) => (a > b ? a : b))
}

/**
 * Pure function: computes override patches for auto-expiration.
 * - 'submitted' jobs older than 45 days with no activity -> 'ghosted'
 * Only applies to jobs where the user has NOT manually set a status override.
 *
 * The `_autoExpired` flag is stored alongside each auto-transition so we
 * can distinguish bot-set statuses from user-set ones. If the user later
 * manually changes the status, their override.status will differ from the
 * auto-set value, and we will not re-override it.
 */
export function computeAutoExpiration(
  prev: Overrides,
  allJobs: Job[],
): Overrides | null {
  const now = new Date()
  let changed = false
  const next = { ...prev }

  for (const job of allJobs) {
    const override = prev[job.id]
    const effectiveStatus = (override?.status ?? job.status) as JobStatus

    // Never touch protected statuses
    if (PROTECTED_STATUSES.has(effectiveStatus)) continue

    // If the user explicitly set a status via override (and it wasn't set by
    // auto-expiration), respect it — do not override.
    if (override?.status && !(override as Record<string, unknown>)._autoExpired) continue

    const latestActivity = getLatestActivityDate(job)
    const activityDate = new Date(latestActivity + 'T00:00:00')
    const daysSinceActivity = Math.floor(
      (now.getTime() - activityDate.getTime()) / (1000 * 60 * 60 * 24)
    )

    if (
      effectiveStatus === 'submitted' &&
      daysSinceActivity >= SUBMITTED_GHOST_DAYS
    ) {
      next[job.id] = {
        ...next[job.id],
        status: 'ghosted' as JobStatus,
        _autoExpired: true,
      } as Partial<Job> & { _autoExpired?: boolean }
      changed = true
    }
  }

  return changed ? next : null
}

/* ── Area detection helpers ────────────────────────────────────────── */

const APAC_KEYWORDS = ['bangkok','singapore','india','tokyo','japan','korea','seoul','hong kong','manila','philippines','thailand','vietnam','indonesia','malaysia','australia','china','taiwan','apac']
const EMEA_KEYWORDS = ['london','berlin','paris','amsterdam','dublin','europe','germany','france','uk','spain','portugal','ireland','netherlands','sweden','switzerland','israel','dubai','emea']
const AMERICAS_KEYWORDS = ['new york','san francisco','usa','united states','canada','toronto','los angeles','chicago','seattle','boston','brazil','mexico','americas']

export function detectArea(location: string): 'apac' | 'emea' | 'americas' | null {
  const loc = location.toLowerCase()
  if (APAC_KEYWORDS.some(k => loc.includes(k))) return 'apac'
  if (EMEA_KEYWORDS.some(k => loc.includes(k))) return 'emea'
  if (AMERICAS_KEYWORDS.some(k => loc.includes(k))) return 'americas'
  return null
}

export function detectWorkMode(location: string): 'remote' | 'hybrid' | 'onsite' {
  const loc = location.toLowerCase()
  if (loc.includes('remote')) return 'remote'
  if (loc.includes('hybrid')) return 'hybrid'
  return 'onsite'
}
