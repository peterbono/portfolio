import { useState } from 'react'
import type { EventType, EventOutcome, JobEvent } from '../types/job'
import { Plus } from 'lucide-react'

const EVENT_TYPES: { value: EventType; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'call', label: 'Call' },
  { value: 'linkedin_dm', label: 'LinkedIn DM' },
  { value: 'portfolio_review', label: 'Portfolio Review' },
  { value: 'design_challenge', label: 'Design Challenge' },
  { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'note', label: 'Note' },
]

const OUTCOMES: { value: EventOutcome; label: string; color: string }[] = [
  { value: 'aligned', label: 'Aligned', color: '#34d399' },
  { value: 'misaligned', label: 'Misaligned', color: '#ef4444' },
  { value: 'waiting', label: 'Waiting', color: '#fbbf24' },
  { value: null, label: 'None', color: 'var(--text-tertiary)' },
]

function generateId(): string {
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).substring(2, 10)
  )
}

function todayISO(): string {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

interface EventFormProps {
  jobId: string
  onSubmit: (jobId: string, event: JobEvent) => void
}

export function EventForm({ jobId, onSubmit }: EventFormProps) {
  const [date, setDate] = useState(todayISO)
  const [type, setType] = useState<EventType>('email')
  const [person, setPerson] = useState('')
  const [notes, setNotes] = useState('')
  const [outcome, setOutcome] = useState<EventOutcome>(null)
  const [isExpanded, setIsExpanded] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!notes.trim()) return

    const event: JobEvent = {
      id: generateId(),
      date,
      type,
      person: person.trim(),
      notes: notes.trim(),
      outcome,
      createdAt: new Date().toISOString(),
    }

    onSubmit(jobId, event)

    // Reset form
    setDate(todayISO())
    setType('email')
    setPerson('')
    setNotes('')
    setOutcome(null)
    setIsExpanded(false)
  }

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        style={{
          width: '100%',
          padding: '12px 16px',
          background: 'var(--bg-elevated)',
          border: '1px dashed var(--border)',
          borderRadius: 'var(--radius-lg)',
          color: 'var(--text-tertiary)',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          transition: 'all var(--transition-fast)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--accent)'
          e.currentTarget.style.color = 'var(--accent)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--border)'
          e.currentTarget.style.color = 'var(--text-tertiary)'
        }}
      >
        <Plus size={14} />
        Add Event
      </button>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <h4
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        New Event
      </h4>

      {/* Row: Date + Type */}
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={inputStyle}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as EventType)}
            style={inputStyle}
          >
            {EVENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Person */}
      <div>
        <label style={labelStyle}>Person (optional)</label>
        <input
          type="text"
          value={person}
          onChange={(e) => setPerson(e.target.value)}
          placeholder="Recruiter name, hiring manager..."
          style={inputStyle}
        />
      </div>

      {/* Notes */}
      <div>
        <label style={labelStyle}>Notes *</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What happened? Key takeaways..."
          rows={3}
          required
          style={{
            ...inputStyle,
            resize: 'vertical',
            minHeight: 60,
          }}
        />
      </div>

      {/* Outcome */}
      <div>
        <label style={labelStyle}>Outcome</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {OUTCOMES.map((o) => {
            const isSelected = outcome === o.value
            return (
              <button
                key={String(o.value)}
                type="button"
                onClick={() => setOutcome(o.value)}
                style={{
                  flex: 1,
                  padding: '5px 0',
                  fontSize: 11,
                  fontWeight: 500,
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${isSelected ? o.color : 'var(--border)'}`,
                  color: isSelected ? o.color : 'var(--text-tertiary)',
                  background: isSelected ? `${o.color}15` : 'transparent',
                  transition: 'all var(--transition-fast)',
                }}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={() => setIsExpanded(false)}
          style={{
            padding: '6px 14px',
            fontSize: 12,
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            color: 'var(--text-tertiary)',
            background: 'transparent',
            transition: 'all var(--transition-fast)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-hover)'
            e.currentTarget.style.color = 'var(--text-secondary)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border)'
            e.currentTarget.style.color = 'var(--text-tertiary)'
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          style={{
            padding: '6px 16px',
            fontSize: 12,
            fontWeight: 500,
            borderRadius: 'var(--radius-md)',
            border: 'none',
            color: '#09090b',
            background: 'var(--accent)',
            transition: 'all var(--transition-fast)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '0.85'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '1'
          }}
        >
          Add Event
        </button>
      </div>
    </form>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--text-tertiary)',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  fontSize: 13,
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
}
