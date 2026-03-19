import { useEffect, useRef, useMemo } from 'react'
import { X } from 'lucide-react'
import { useUI } from '../context/UIContext'
import { useJobs } from '../context/JobsContext'
import { StatusBadge } from '../components/StatusBadge'
import { EventTimeline } from '../components/EventTimeline'
import { EventForm } from '../components/EventForm'
import { useJobEvents } from '../hooks/useJobEvents'
import type { JobStatus, JobEvent } from '../types/job'
import { STATUS_CONFIG } from '../types/job'

export function DetailDrawer() {
  const { selectedJobId, closeDrawer } = useUI()
  const { jobs, updateJobStatus, addJobEvent } = useJobs()
  const { events: localEvents, addEvent: addLocalEvent, deleteEvent } = useJobEvents(selectedJobId)
  const drawerRef = useRef<HTMLDivElement>(null)

  const job = jobs.find((j) => j.id === selectedJobId)

  // Escape key handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeDrawer()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeDrawer])

  // Merge events from JobsContext (overrides) + local hook store, deduplicate by id
  const allEvents = useMemo(() => {
    const contextEvents = job?.events ?? []
    const map = new Map<string, JobEvent>()
    for (const e of contextEvents) map.set(e.id, e)
    for (const e of localEvents) map.set(e.id, e)
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )
  }, [job?.events, localEvents])

  if (!job) return null

  const allStatuses = Object.keys(STATUS_CONFIG) as JobStatus[]

  function handleAddEvent(jobId: string, event: JobEvent) {
    // Persist in both stores for resilience
    addJobEvent(jobId, event)
    addLocalEvent(jobId, event)
  }

  function handleDeleteEvent(eventId: string) {
    if (!selectedJobId) return
    deleteEvent(selectedJobId, eventId)
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={closeDrawer}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.4)',
          zIndex: 40,
          animation: 'fadeIn 200ms ease',
        }}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 450,
          maxWidth: '100vw',
          background: 'var(--bg-surface)',
          borderLeft: '1px solid var(--border)',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          animation: 'slideInRight 250ms ease',
          overflow: 'hidden',
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  lineHeight: 1.3,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {job.company}
              </h2>
              <p
                style={{
                  fontSize: 14,
                  color: 'var(--text-secondary)',
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {job.role}
              </p>
            </div>
            <button
              onClick={closeDrawer}
              style={{
                padding: 6,
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-tertiary)',
                transition: 'all var(--transition-fast)',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-elevated)'
                e.currentTarget.style.color = 'var(--text-primary)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--text-tertiary)'
              }}
            >
              <X size={18} />
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusBadge status={job.status} />
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
              {job.date}
            </span>
            {job.location && (
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                {job.location}
              </span>
            )}
          </div>
        </div>

        {/* ── Quick Actions ── */}
        <div
          style={{
            padding: '12px 24px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <select
            value={job.status}
            onChange={(e) => updateJobStatus(job.id, e.target.value as JobStatus)}
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '6px 10px',
              fontSize: 13,
              color: 'var(--text-primary)',
              cursor: 'pointer',
              flex: 1,
            }}
          >
            {allStatuses.map((s) => (
              <option key={s} value={s}>
                {STATUS_CONFIG[s].label}
              </option>
            ))}
          </select>

          <ActionButton
            label="Withdraw"
            color="#ef4444"
            onClick={() => updateJobStatus(job.id, 'withdrawn')}
          />
          <ActionButton
            label="Reject"
            color="#a855f7"
            onClick={() => updateJobStatus(job.id, 'rejected')}
          />
        </div>

        {/* ── Scrollable Body ── */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
          {/* Details section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 32 }}>
            {job.salary && <DetailRow label="Salary" value={job.salary} />}
            {job.ats && <DetailRow label="ATS" value={job.ats} />}
            {job.link && (
              <DetailRow label="Link">
                <a
                  href={job.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 13, color: 'var(--accent)' }}
                >
                  Open listing
                </a>
              </DetailRow>
            )}
            {job.notes && <DetailRow label="Notes" value={job.notes} />}
          </div>

          {/* ── Event Timeline ── */}
          <div style={{ marginBottom: 24 }}>
            <h3
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: 12,
              }}
            >
              Timeline
              {allEvents.length > 0 && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    fontWeight: 400,
                    color: 'var(--text-tertiary)',
                  }}
                >
                  ({allEvents.length})
                </span>
              )}
            </h3>
            <EventTimeline events={allEvents} onDelete={handleDeleteEvent} />
          </div>

          {/* ── Event Form ── */}
          <EventForm jobId={job.id} onSubmit={handleAddEvent} />
        </div>
      </div>

      {/* Animations */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </>
  )
}

/* ── Sub-components ── */

function ActionButton({
  label,
  color,
  onClick,
}: {
  label: string
  color: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px',
        fontSize: 13,
        borderRadius: 'var(--radius-md)',
        border: '1px solid #3f3f46',
        color,
        background: 'transparent',
        transition: 'all var(--transition-fast)',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = `${color}18`
        e.currentTarget.style.borderColor = color
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.borderColor = '#3f3f46'
      }}
    >
      {label}
    </button>
  )
}

function DetailRow({
  label,
  value,
  children,
}: {
  label: string
  value?: string
  children?: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <span
        style={{
          fontSize: 12,
          color: 'var(--text-tertiary)',
          minWidth: 60,
          paddingTop: 1,
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', flex: 1 }}>
        {children ?? value}
      </span>
    </div>
  )
}
