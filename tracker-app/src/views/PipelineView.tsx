import { useMemo } from 'react'
import { useJobs } from '../context/JobsContext'
import { useUI } from '../context/UIContext'
import { StatusBadge } from '../components/StatusBadge'
import type { Job, JobStatus } from '../types/job'
import { STATUS_CONFIG, ACTIVE_STATUSES, PENDING_STATUSES, INACTIVE_STATUSES } from '../types/job'

/** Column ordering for the pipeline view */
const PIPELINE_COLUMNS: JobStatus[] = [
  ...PENDING_STATUSES,
  ...ACTIVE_STATUSES,
  ...INACTIVE_STATUSES,
]

export function PipelineView() {
  const { jobs } = useJobs()
  const { selectJob } = useUI()

  const grouped = useMemo(() => {
    const map: Record<JobStatus, Job[]> = {} as Record<JobStatus, Job[]>
    for (const status of PIPELINE_COLUMNS) {
      map[status] = []
    }
    for (const job of jobs) {
      if (map[job.status]) {
        map[job.status].push(job)
      }
    }
    // Sort each column by most recent date first
    for (const status of PIPELINE_COLUMNS) {
      map[status].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      )
    }
    return map
  }, [jobs])

  // Only show columns that have at least 1 job
  const visibleColumns = PIPELINE_COLUMNS.filter(
    (status) => grouped[status].length > 0
  )

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div
        style={{
          padding: '20px 24px 12px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <h1
          style={{
            fontSize: 20,
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}
        >
          Pipeline
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4 }}>
          Drag-and-drop coming soon. Click any card to view details.
        </p>
      </div>

      {/* Kanban grid */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 16,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${visibleColumns.length}, minmax(220px, 1fr))`,
            gap: 12,
            minWidth: visibleColumns.length * 232,
          }}
        >
          {visibleColumns.map((status) => (
            <PipelineColumn
              key={status}
              status={status}
              jobs={grouped[status]}
              onCardClick={selectJob}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Column ── */

function PipelineColumn({
  status,
  jobs,
  onCardClick,
}: {
  status: JobStatus
  jobs: Job[]
  onCardClick: (id: string) => void
}) {
  const config = STATUS_CONFIG[status]

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minHeight: 100,
      }}
    >
      {/* Column header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          position: 'sticky',
          top: 0,
          zIndex: 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13 }}>{config.icon}</span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: config.color,
            }}
          >
            {config.label}
          </span>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--text-tertiary)',
            background: 'var(--bg-elevated)',
            padding: '1px 7px',
            borderRadius: 9999,
          }}
        >
          {jobs.length}
        </span>
      </div>

      {/* Cards */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {jobs.map((job) => (
          <PipelineCard key={job.id} job={job} onClick={() => onCardClick(job.id)} />
        ))}
      </div>
    </div>
  )
}

/* ── Card ── */

function PipelineCard({ job, onClick }: { job: Job; onClick: () => void }) {
  const lastEvent = job.events?.[job.events.length - 1]

  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left',
        width: '100%',
        padding: '10px 12px',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        transition: 'all var(--transition-fast)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-hover)'
        e.currentTarget.style.background = '#1f1f26'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.background = 'var(--bg-elevated)'
      }}
    >
      {/* Company */}
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          width: '100%',
        }}
      >
        {job.company}
      </span>

      {/* Role */}
      <span
        style={{
          fontSize: 12,
          color: 'var(--text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          width: '100%',
        }}
      >
        {job.role}
      </span>

      {/* Bottom row: badge + last event date */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <StatusBadge status={job.status} size="sm" />
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
          {lastEvent ? formatShortDate(lastEvent.date) : formatShortDate(job.date)}
        </span>
      </div>
    </button>
  )
}

function formatShortDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  } catch {
    return dateStr
  }
}
