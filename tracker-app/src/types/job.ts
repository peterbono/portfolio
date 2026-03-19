export type JobStatus =
  | 'submitted'
  | 'manual'
  | 'skipped'
  | 'saved'
  | 'rejected'
  | 'screening'
  | 'interviewing'
  | 'challenge'
  | 'offer'
  | 'negotiation'
  | 'withdrawn'
  | 'ghosted'

export type EventType =
  | 'email'
  | 'call'
  | 'portfolio_review'
  | 'design_challenge'
  | 'interview'
  | 'offer'
  | 'negotiation'
  | 'note'

export type EventOutcome = 'aligned' | 'misaligned' | 'waiting' | null

export type Area = 'apac' | 'emea' | 'americas' | ''

export interface JobEvent {
  id: string
  date: string
  type: EventType
  person: string
  notes: string
  outcome: EventOutcome
  createdAt: string
}

export interface Job {
  id: string
  date: string
  status: JobStatus
  role: string
  company: string
  location: string
  salary: string
  ats: string
  cv: string
  portfolio: string
  link: string
  notes: string
  source?: 'auto' | 'manual'
  area?: Area
  events?: JobEvent[]
  lastContactDate?: string
}

export const STATUS_CONFIG: Record<JobStatus, { label: string; color: string; bg: string; border: string; icon: string }> = {
  submitted:    { label: 'Submitted',    color: '#34d399', bg: '#052e1f', border: '#064e3b', icon: '✓' },
  manual:       { label: 'To Submit',    color: '#fb923c', bg: '#2a1505', border: '#422006', icon: '✎' },
  skipped:      { label: 'Skipped',      color: '#52525b', bg: '#131316', border: '#1e1e24', icon: '→' },
  saved:        { label: 'Easy Apply',   color: '#38bdf8', bg: '#0c2844', border: '#1e3a5f', icon: '⚡' },
  rejected:     { label: 'Rejected',     color: '#a855f7', bg: '#1a0a2e', border: '#3b0764', icon: '💀' },
  screening:    { label: 'Screening',    color: '#60a5fa', bg: '#0c2844', border: '#1e3a5f', icon: '📞' },
  interviewing: { label: 'Interviewing', color: '#fb923c', bg: '#2a1505', border: '#422006', icon: '🎤' },
  challenge:    { label: 'Challenge',    color: '#c084fc', bg: '#1a0a2e', border: '#4c1d95', icon: '🎨' },
  offer:        { label: 'Offer',        color: '#fbbf24', bg: '#2a1a05', border: '#78350f', icon: '⭐' },
  negotiation:  { label: 'Negotiation',  color: '#f59e0b', bg: '#2a1a05', border: '#78350f', icon: '💰' },
  withdrawn:    { label: 'Withdrawn',    color: '#52525b', bg: '#131316', border: '#1e1e24', icon: '🚪' },
  ghosted:      { label: 'Ghosted',      color: '#3f3f46', bg: '#131316', border: '#1e1e24', icon: '👻' },
}

export const ACTIVE_STATUSES: JobStatus[] = ['submitted', 'screening', 'interviewing', 'challenge', 'offer', 'negotiation']
export const INACTIVE_STATUSES: JobStatus[] = ['rejected', 'withdrawn', 'ghosted', 'skipped']
export const PENDING_STATUSES: JobStatus[] = ['manual', 'saved']
