import { useGmailSync, type GmailEvent } from '../hooks/useGmailSync'
import { useJobs } from '../context/JobsContext'
import type { JobStatus, JobEvent, EventType } from '../types/job'

// Map Apps Script event types to our EventType
// If source is gmail (not calendar) and no meetLink, screening is likely just a confirmation
function mapEventType(type: string, source?: string, meetLink?: string): EventType {
  switch (type) {
    case 'screening':
      // Calendar-sourced screenings are trustworthy; Gmail without meet link = likely confirmation
      if (source && source.startsWith('calendar')) return 'call'
      if (meetLink) return 'call'
      return 'email' // Downgrade: no calendar event, no meet link → confirmation email
    case 'interview': return 'interview'
    case 'challenge': return 'design_challenge'
    case 'portfolio_review': return 'portfolio_review'
    case 'offer': return 'offer'
    case 'negotiation': return 'negotiation'
    case 'withdrawn': return 'note'
    default: return 'email'
  }
}

// Map Apps Script event types to job statuses
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

export function GmailSyncBridge() {
  const { jobs, markRejected, updateJobStatus, addJobEvent } = useJobs()

  useGmailSync({
    onNewRejections: (_companies, rejections) => {
      markRejected(rejections ?? _companies.map(c => ({ company: c })))
    },
    onNewEvents: (events: GmailEvent[]) => {
      for (const evt of events) {
        const companyLower = evt.company.toLowerCase()

        // Find matching job by company name (fuzzy)
        const job = jobs.find((j) => {
          const jc = j.company.toLowerCase()
          return jc === companyLower || jc.includes(companyLower) || companyLower.includes(jc)
        })

        if (!job) continue

        const mappedType = mapEventType(evt.type, evt.source, evt.meetLink)

        // Update job status if the event implies a status change
        // Skip status upgrade for downgraded events (email = confirmation, not a real stage change)
        if (mappedType !== 'email') {
          const newStatus = mapEventToStatus(evt.type)
          if (newStatus) {
            // Only upgrade status (don't downgrade from interview to screening)
            const statusPriority: Record<string, number> = {
              manual: 0, submitted: 1, screening: 2, interviewing: 3,
              challenge: 4, offer: 5, negotiation: 6, withdrawn: 10, rejected: 10,
            }
            const currentPriority = statusPriority[job.status] ?? 0
            const newPriority = statusPriority[newStatus] ?? 0
            if (newPriority > currentPriority) {
              updateJobStatus(job.id, newStatus)
            }
          }
        }

        // Add as timeline event (deduplicate by checking if we already have an event on same date with same type)
        const existingEvents = job.events ?? []
        const evtDate = evt.date ? new Date(evt.date).toISOString().split('T')[0] : ''
        const alreadyExists = existingEvents.some(
          (e) => e.date === evtDate && e.type === mappedType
        )

        if (!alreadyExists && evtDate) {
          const jobEvent: JobEvent = {
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

  return null
}
