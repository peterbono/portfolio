import type { JobEvent, EventType, EventOutcome } from '../types/job'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'

const EVENT_TYPE_COLORS: Record<EventType, string> = {
  email: '#60a5fa',
  call: '#34d399',
  portfolio_review: '#c084fc',
  design_challenge: '#f472b6',
  interview: '#fb923c',
  offer: '#fbbf24',
  negotiation: '#f59e0b',
  note: '#71717a',
}

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  email: 'Email',
  call: 'Call',
  portfolio_review: 'Portfolio Review',
  design_challenge: 'Design Challenge',
  interview: 'Interview',
  offer: 'Offer',
  negotiation: 'Negotiation',
  note: 'Note',
}

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
}

export function EventTimeline({ events, onDelete }: EventTimelineProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

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

            {/* Event card */}
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
              {/* Top row: date + type badge + outcome + delete */}
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

                {/* Type badge */}
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

                {/* Outcome indicator */}
                {oc && (
                  <span style={{ fontSize: 13, color: oc.color, lineHeight: 1 }}>
                    {oc.icon}
                  </span>
                )}

                {/* Spacer */}
                <div style={{ flex: 1 }} />

                {/* Delete button */}
                {onDelete && isHovered && (
                  <button
                    onClick={() => onDelete(evt.id)}
                    style={{
                      padding: 2,
                      color: 'var(--text-tertiary)',
                      transition: 'color var(--transition-fast)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = '#ef4444'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--text-tertiary)'
                    }}
                    title="Delete event"
                  >
                    <Trash2 size={13} />
                  </button>
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
          </div>
        )
      })}
    </div>
  )
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}
