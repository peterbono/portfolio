import type { JobEvent, EventType, EventOutcome } from '../types/job'
import { Trash2, Pencil, Check, X as XIcon } from 'lucide-react'
import { useState } from 'react'

const EVENT_TYPE_COLORS: Record<EventType, string> = {
  email: '#60a5fa',
  call: '#34d399',
  linkedin_dm: '#0a66c2',
  portfolio_review: '#c084fc',
  design_challenge: '#f472b6',
  interview: '#fb923c',
  offer: '#fbbf24',
  negotiation: '#f59e0b',
  rejection: '#a855f7',
  note: '#71717a',
}

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  email: 'Email',
  call: 'Call',
  linkedin_dm: 'LinkedIn DM',
  portfolio_review: 'Portfolio Review',
  design_challenge: 'Design Challenge',
  interview: 'Interview',
  offer: 'Offer',
  negotiation: 'Negotiation',
  rejection: 'Rejection',
  note: 'Note',
}

const ALL_EVENT_TYPES = Object.keys(EVENT_TYPE_LABELS) as EventType[]

function outcomeIndicator(outcome: EventOutcome): { icon: string; color: string } | null {
  switch (outcome) {
    case 'aligned':
      return { icon: '\u2714', color: '#34d399' }
    case 'misaligned':
      return { icon: '\u2718', color: '#ef4444' }
    case 'waiting':
      return { icon: '\u23f3', color: '#fbbf24' }
    default:
      return null
  }
}

interface EventTimelineProps {
  events: JobEvent[]
  onDelete?: (eventId: string) => void
  onEdit?: (eventId: string, updated: JobEvent) => void
}

export function EventTimeline({ events, onDelete, onEdit }: EventTimelineProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  if (events.length === 0) {
    return (
      <div
        style={{
          padding: '32px 16px',
          textAlign: 'center',
          color: 'var(--text-tertiary)',
          fontSize: 13,
          fontStyle: 'italic',
        }}
      >
        No interactions yet. Add your first event below.
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', paddingLeft: 20 }}>
      {/* Vertical line */}
      <div
        style={{
          position: 'absolute',
          left: 7,
          top: 8,
          bottom: 8,
          width: 2,
          background: 'var(--border)',
          borderRadius: 1,
        }}
      />

      {events.map((evt) => {
        const color = EVENT_TYPE_COLORS[evt.type]
        const oc = outcomeIndicator(evt.outcome)
        const isHovered = hoveredId === evt.id
        const isEditing = editingId === evt.id

        return (
          <div
            key={evt.id}
            style={{
              position: 'relative',
              paddingBottom: 20,
              paddingLeft: 16,
            }}
            onMouseEnter={() => setHoveredId(evt.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            {/* Dot on the line */}
            <div
              style={{
                position: 'absolute',
                left: -1,
                top: 6,
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: color,
                border: '2px solid var(--bg-surface)',
                boxShadow: `0 0 0 2px ${color}33`,
                zIndex: 1,
              }}
            />

            {isEditing ? (
              <InlineEditForm
                event={evt}
                onSave={(updated) => {
                  onEdit?.(evt.id, updated)
                  setEditingId(null)
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div
                style={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px 12px',
                  transition: 'border-color var(--transition-fast)',
                  borderColor: isHovered ? 'var(--border-hover)' : 'var(--border)',
                }}
              >
                {/* Top row: date + type badge + outcome + actions */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {formatDate(evt.date)}
                  </span>

                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '1px 7px',
                      fontSize: 11,
                      fontWeight: 500,
                      borderRadius: 9999,
                      color,
                      background: `${color}18`,
                      border: `1px solid ${color}30`,
                    }}
                  >
                    {EVENT_TYPE_LABELS[evt.type]}
                  </span>

                  {oc && (
                    <span style={{ fontSize: 13, color: oc.color, lineHeight: 1 }}>
                      {oc.icon}
                    </span>
                  )}

                  <div style={{ flex: 1 }} />

                  {/* Edit + Delete buttons */}
                  {isHovered && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      {onEdit && (
                        <button
                          onClick={() => setEditingId(evt.id)}
                          style={iconBtnStyle}
                          title="Edit event"
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#60a5fa' }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)' }}
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={() => onDelete(evt.id)}
                          style={iconBtnStyle}
                          title="Delete event"
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444' }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Person */}
                {evt.person && (
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500, marginBottom: 2 }}>
                    {evt.person}
                  </p>
                )}

                {/* Notes */}
                {evt.notes && (
                  <p style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                    {evt.notes}
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ── Inline Edit Form ── */

function InlineEditForm({
  event,
  onSave,
  onCancel,
}: {
  event: JobEvent
  onSave: (updated: JobEvent) => void
  onCancel: () => void
}) {
  const [date, setDate] = useState(event.date)
  const [type, setType] = useState<EventType>(event.type)
  const [person, setPerson] = useState(event.person)
  const [notes, setNotes] = useState(event.notes)
  const [outcome, setOutcome] = useState<EventOutcome>(event.outcome)

  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--accent)',
        borderRadius: 'var(--radius-md)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={inputStyle}
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as EventType)}
          style={{ ...inputStyle, flex: 1 }}
        >
          {ALL_EVENT_TYPES.map((t) => (
            <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>
          ))}
        </select>
      </div>
      <input
        type="text"
        value={person}
        onChange={(e) => setPerson(e.target.value)}
        placeholder="Person (optional)"
        style={inputStyle}
      />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes"
        rows={2}
        style={{ ...inputStyle, resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {(['aligned', 'misaligned', 'waiting', null] as EventOutcome[]).map((o) => (
          <button
            key={String(o)}
            onClick={() => setOutcome(o)}
            style={{
              padding: '3px 8px',
              fontSize: 11,
              borderRadius: 9999,
              border: `1px solid ${outcome === o ? 'var(--accent)' : 'var(--border)'}`,
              background: outcome === o ? 'var(--accent)18' : 'transparent',
              color: outcome === o ? 'var(--accent)' : 'var(--text-tertiary)',
              cursor: 'pointer',
            }}
          >
            {o === null ? 'None' : o === 'aligned' ? '✔ Aligned' : o === 'misaligned' ? '✘ Misaligned' : '⏳ Waiting'}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={onCancel} style={iconBtnStyle} title="Cancel">
          <XIcon size={14} />
        </button>
        <button
          onClick={() => onSave({ ...event, date, type, person, notes, outcome })}
          style={{ ...iconBtnStyle, color: 'var(--accent)' }}
          title="Save"
        >
          <Check size={14} />
        </button>
      </div>
    </div>
  )
}

const iconBtnStyle: React.CSSProperties = {
  padding: 2,
  color: 'var(--text-tertiary)',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  transition: 'color 150ms',
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  fontSize: 12,
  outline: 'none',
}

function formatDate(dateStr: string): string {
  try {
    // Normalize: strip time portion if full ISO timestamp
    const normalized = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr
    const d = new Date(normalized + 'T00:00:00')
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}
