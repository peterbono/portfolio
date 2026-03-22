import { useGmailSync, type GmailEvent } from '../hooks/useGmailSync'
import { useGmailAPI } from '../hooks/useGmailAPI'
import { useJobs } from '../context/JobsContext'
import type { JobStatus, JobEvent as TrackerJobEvent, EventType } from '../types/job'
import type { JobEvent as GmailAPIEvent } from '../lib/gmail-scanner'

// ─── Apps Script event mappers (legacy) ─────────────────────────────────────

function mapEventType(type: string, source?: string, meetLink?: string): EventType {
  switch (type) {
    case 'screening':
      if (source && source.startsWith('calendar')) return 'call'
      if (meetLink) return 'call'
      return 'email'
    case 'interview': return 'interview'
    case 'challenge': return 'design_challenge'
    case 'portfolio_review': return 'portfolio_review'
    case 'offer': return 'offer'
    case 'negotiation': return 'negotiation'
    case 'withdrawn': return 'note'
    default: return 'email'
  }
}

function mapEventToStatus(type: string): JobStatus | null {
  switch (type) {
    case 'screening': return 'screening'
    case 'interview': return 'interviewing'
    case 'challenge': return 'challenge'
    case 'portfolio_review': return 'interviewing'
    case 'offer': return 'offer'
    case 'negotiation': return 'negotiation'
    case 'withdrawn': return 'withdrawn'
    default: return null
  }
}

// ─── Gmail API event mappers ────────────────────────────────────────────────

function mapGmailAPIEventType(type: GmailAPIEvent['type']): EventType {
  switch (type) {
    case 'rejection': return 'rejection'
    case 'confirmation': return 'email'
    case 'interview': return 'interview'
    case 'offer': return 'offer'
  }
}

function mapGmailAPIEventToStatus(type: GmailAPIEvent['type']): JobStatus | null {
  switch (type) {
    case 'rejection': return 'rejected'
    case 'interview': return 'interviewing'
    case 'offer': return 'offer'
    case 'confirmation': return null
  }
}

// Status upgrade priority
const STATUS_PRIORITY: Record<string, number> = {
  manual: 0, submitted: 1, screening: 2, interviewing: 3,
  challenge: 4, offer: 5, negotiation: 6, withdrawn: 10, rejected: 10,
}

export function GmailSyncBridge() {
  const { jobs, markRejected, updateJobStatus, addJobEvent } = useJobs()

  // ── Legacy Apps Script sync (still works if URL is configured) ──────────
  useGmailSync({
    onNewRejections: (_companies, rejections) => {
      markRejected(rejections ?? _companies.map(c => ({ company: c })))
    },
    onNewEvents: (events: GmailEvent[]) => {
      for (const evt of events) {
        const companyLower = evt.company.toLowerCase()
        const job = jobs.find((j) => {
          const jc = j.company.toLowerCase()
          return jc === companyLower || jc.includes(companyLower) || companyLower.includes(jc)
        })
        if (!job) continue

        const mappedType = mapEventType(evt.type, evt.source, evt.meetLink)
        if (mappedType !== 'email') {
          const newStatus = mapEventToStatus(evt.type)
          if (newStatus) {
            const currentPriority = STATUS_PRIORITY[job.status] ?? 0
            const newPriority = STATUS_PRIORITY[newStatus] ?? 0
            if (newPriority > currentPriority) {
              updateJobStatus(job.id, newStatus)
            }
          }
        }

        const existingEvents = job.events ?? []
        const evtDate = evt.date ? new Date(evt.date).toISOString().split('T')[0] : ''
        const alreadyExists = existingEvents.some(
          (e) => e.date === evtDate && e.type === mappedType
        )
        if (!alreadyExists && evtDate) {
          const jobEvent: TrackerJobEvent = {
            id: 'gmail_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
            date: evtDate,
            type: mappedType,
            person: evt.person || '',
            notes: evt.subject + (evt.meetLink ? '\n' + evt.meetLink : ''),
            outcome: null,
            createdAt: new Date().toISOString(),
          }
          addJobEvent(job.id, jobEvent)
        }
      }
    },
  })

  // ── New Gmail API sync ──────────────────────────────────────────────────
  useGmailAPI({
    onNewEvents: (events: GmailAPIEvent[]) => {
      // Collect rejections for bulk processing
      const rejections: { company: string; date?: string; role?: string }[] = []

      for (const evt of events) {
        if (evt.type === 'rejection') {
          rejections.push({ company: evt.company, date: evt.date })
          continue
        }

        const companyLower = evt.company.toLowerCase()
        const job = jobs.find((j) => {
          const jc = j.company.toLowerCase()
          return jc === companyLower || jc.includes(companyLower) || companyLower.includes(jc)
        })

        if (!job) continue

        const mappedType = mapGmailAPIEventType(evt.type)
        const newStatus = mapGmailAPIEventToStatus(evt.type)

        // Upgrade status if applicable
        if (newStatus) {
          const currentPriority = STATUS_PRIORITY[job.status] ?? 0
          const newPriority = STATUS_PRIORITY[newStatus] ?? 0
          if (newPriority > currentPriority) {
            updateJobStatus(job.id, newStatus)
          }
        }

        // Add timeline event (deduplicate)
        const existingEvents = job.events ?? []
        const alreadyExists = existingEvents.some(
          (e) => e.date === evt.date && e.type === mappedType
        )
        if (!alreadyExists) {
          const jobEvent: TrackerJobEvent = {
            id: 'gapi_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
            date: evt.date,
            type: mappedType,
            person: '',
            notes: evt.subject,
            outcome: null,
            createdAt: new Date().toISOString(),
          }
          addJobEvent(job.id, jobEvent)
        }
      }

      // Process rejections in bulk
      if (rejections.length > 0) {
        markRejected(rejections)
      }
    },
  })

  return null
}
