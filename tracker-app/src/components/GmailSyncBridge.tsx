import { useRef } from 'react'
import { useGmailAPI } from '../hooks/useGmailAPI'
import { useJobs } from '../context/JobsContext'
import type { JobStatus, JobEvent as TrackerJobEvent, EventType } from '../types/job'
import type { JobEvent as GmailAPIEvent } from '../lib/gmail-scanner'
import { notifyRejectionDetected, notifyInterviewScheduled } from '../lib/notifications'

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
    case 'confirmation': return 'submitted'
  }
}

// Status upgrade priority
const STATUS_PRIORITY: Record<string, number> = {
  manual: 0, submitted: 1, screening: 2, interviewing: 3,
  challenge: 4, offer: 5, negotiation: 6, withdrawn: 10, rejected: 10,
}

export function GmailSyncBridge() {
  const { jobs, markRejected, markSubmitted, updateJobStatus, addJobEvent } = useJobs()

  // Track already-notified events to avoid duplicate emails in this session
  const notifiedKeysRef = useRef(new Set<string>())

  // ── Gmail API OAuth sync (production — no Apps Script needed) ────────────
  useGmailAPI({
    onNewEvents: (events: GmailAPIEvent[]) => {
      // Collect rejections and confirmations for bulk processing
      const rejections: { company: string; date?: string; role?: string }[] = []
      const applications: { company: string; role?: string; date?: string }[] = []

      for (const evt of events) {
        if (evt.type === 'rejection') {
          rejections.push({ company: evt.company, date: evt.date })

          // Fire-and-forget email notification (deduplicated)
          const rejKey = `rejection:${evt.company}:${evt.role ?? ''}`
          if (!notifiedKeysRef.current.has(rejKey)) {
            notifiedKeysRef.current.add(rejKey)
            notifyRejectionDetected({ company: evt.company, role: evt.role ?? '' })
          }
          continue
        }

        if (evt.type === 'confirmation') {
          applications.push({ company: evt.company, role: evt.role, date: evt.date })
          // Don't skip — also add timeline event below if job exists
        }

        // Fire-and-forget email notification for interviews (deduplicated)
        if (evt.type === 'interview') {
          const intKey = `interview:${evt.company}:${evt.role ?? ''}`
          if (!notifiedKeysRef.current.has(intKey)) {
            notifiedKeysRef.current.add(intKey)
            notifyInterviewScheduled({ company: evt.company, role: evt.role ?? '', date: evt.date })
          }
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

      // Process rejections and applications in bulk
      if (rejections.length > 0) {
        markRejected(rejections)
      }
      if (applications.length > 0) {
        markSubmitted(applications)
      }
    },
  })

  return null
}
