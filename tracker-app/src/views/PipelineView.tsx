import { useMemo, useState, useRef, useEffect } from 'react'
import { Search, X, Plus, ChevronDown } from 'lucide-react'
import { useJobs } from '../context/JobsContext'
import { useUI } from '../context/UIContext'
import { StatusBadge } from '../components/StatusBadge'
import type { Job, JobStatus, EventType } from '../types/job'
import { STATUS_CONFIG } from '../types/job'

/** Map pipeline stages to the event types that represent that stage */
const STAGE_EVENT_MAP: Partial<Record<JobStatus, EventType[]>> = {
  // screening merged into interviewing
  interviewing: ['interview'],
  challenge: ['design_challenge', 'portfolio_review'],
  offer: ['offer', 'negotiation'],
}

type StageProgress = {
  state: 'not-scheduled' | 'scheduled' | 'done' | 'awaiting-response'
  label: string
  date?: string
  color: string
  bg: string
}

/** Try to extract a date from notes text (e.g. "call scheduled 26 March", "interview on 2026-03-28") */
function parseDateFromNotes(notes: string): string | null {
  if (!notes) return null
  const lower = notes.toLowerCase()

  // Only parse if scheduling-related keywords are present
  const keywords = ['scheduled', 'schedule', 'call', 'interview', 'meeting', 'booked', 'confirmed', 'intro']
  if (!keywords.some(k => lower.includes(k))) return null

  const currentYear = new Date().getFullYear()

  // Pattern: "DD Month" or "DD Month YYYY" (e.g. "26 March", "26 March 2026")
  const months: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  }
  const monthNames = Object.keys(months).join('|')
  const dmRe = new RegExp(`(\\d{1,2})\\s+(${monthNames})(?:\\s+(\\d{4}))?`, 'i')
  const dmMatch = lower.match(dmRe)
  if (dmMatch) {
    const day = parseInt(dmMatch[1], 10)
    const mon = months[dmMatch[2].toLowerCase()]
    const year = dmMatch[3] ? parseInt(dmMatch[3], 10) : currentYear
    if (mon !== undefined && day >= 1 && day <= 31) {
      const d = new Date(year, mon, day)
      return d.toISOString().split('T')[0]
    }
  }

  // Pattern: "Month DD" or "Month DD, YYYY" (e.g. "March 26", "March 26, 2026")
  const mdRe = new RegExp(`(${monthNames})\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?`, 'i')
  const mdMatch = lower.match(mdRe)
  if (mdMatch) {
    const mon = months[mdMatch[1].toLowerCase()]
    const day = parseInt(mdMatch[2], 10)
    const year = mdMatch[3] ? parseInt(mdMatch[3], 10) : currentYear
    if (mon !== undefined && day >= 1 && day <= 31) {
      const d = new Date(year, mon, day)
      return d.toISOString().split('T')[0]
    }
  }

  // Pattern: YYYY-MM-DD
  const isoMatch = notes.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return isoMatch[0]

  // Pattern: DD/MM/YYYY or DD/MM
  const slashMatch = notes.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/)
  if (slashMatch) {
    const day = parseInt(slashMatch[1], 10)
    const mon = parseInt(slashMatch[2], 10) - 1
    const year = slashMatch[3] ? parseInt(slashMatch[3], 10) : currentYear
    if (mon >= 0 && mon <= 11 && day >= 1 && day <= 31) {
      const d = new Date(year, mon, day)
      return d.toISOString().split('T')[0]
    }
  }

  // Has scheduling keyword but no parseable date — assume scheduled without date
  return 'unknown'
}

function getStageProgress(job: Job): StageProgress | null {
  const relevantTypes = STAGE_EVENT_MAP[job.status]
  if (!relevantTypes) return null // Only for actionable stages

  const events = job.events ?? []
  const stageEvents = events.filter(e => relevantTypes.includes(e.type))

  if (stageEvents.length === 0) {
    // Fallback: check notes for scheduling info
    const notesDate = parseDateFromNotes(job.notes)
    if (notesDate) {
      const today = new Date().toISOString().split('T')[0]
      if (notesDate === 'unknown') {
        // Keyword found but no date — show as scheduled (no date)
        return {
          state: 'scheduled',
          label: 'from notes',
          color: '#60a5fa',
          bg: 'rgba(96, 165, 250, 0.08)',
        }
      }
      if (notesDate > today) {
        return {
          state: 'scheduled',
          label: formatShortDate(notesDate),
          date: notesDate,
          color: '#60a5fa',
          bg: 'rgba(96, 165, 250, 0.08)',
        }
      }
      const daysSince = Math.floor(
        (new Date().getTime() - new Date(notesDate + 'T00:00:00').getTime()) / 86400000
      )
      if (daysSince >= 3) {
        return {
          state: 'awaiting-response',
          label: `${daysSince}d waiting`,
          date: notesDate,
          color: '#fbbf24',
          bg: 'rgba(251, 191, 36, 0.08)',
        }
      }
      return {
        state: 'done',
        label: 'Done',
        date: notesDate,
        color: '#34d399',
        bg: 'rgba(52, 211, 153, 0.08)',
      }
    }

    return {
      state: 'not-scheduled',
      label: 'Not scheduled',
      color: '#fb923c',
      bg: 'rgba(251, 146, 60, 0.08)',
    }
  }

  // Sort by date, most recent first
  const sorted = [...stageEvents].sort((a, b) => b.date.localeCompare(a.date))
  const latest = sorted[0]
  const today = new Date().toISOString().split('T')[0]

  if (latest.date > today) {
    return {
      state: 'scheduled',
      label: formatShortDate(latest.date),
      date: latest.date,
      color: '#60a5fa',
      bg: 'rgba(96, 165, 250, 0.08)',
    }
  }

  // Event is in the past
  const daysSince = Math.floor(
    (new Date().getTime() - new Date(latest.date + 'T00:00:00').getTime()) / 86400000
  )

  if (daysSince >= 3) {
    return {
      state: 'awaiting-response',
      label: `${daysSince}d waiting`,
      date: latest.date,
      color: '#fbbf24',
      bg: 'rgba(251, 191, 36, 0.08)',
    }
  }

  return {
    state: 'done',
    label: 'Done',
    date: latest.date,
    color: '#34d399',
    bg: 'rgba(52, 211, 153, 0.08)',
  }
}

/** Fixed columns for the pipeline view */
const PIPELINE_COLUMNS: JobStatus[] = [
  'submitted',
  'interviewing',
  'challenge',
  'offer',
  'rejected',
]

export function PipelineView() {
  const { jobs, addJob, updateJobStatus } = useJobs()
  const { selectJob } = useUI()
  const [search, setSearch] = useState('')
  const [draggedJobId, setDraggedJobId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<JobStatus | null>(null)

  // Mobile detection
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const filtered = useMemo(() => {
    if (!search.trim()) return jobs
    const q = search.toLowerCase().trim()
    return jobs.filter(
      (j) =>
        j.company.toLowerCase().includes(q) ||
        j.role.toLowerCase().includes(q)
    )
  }, [jobs, search])

  const grouped = useMemo(() => {
    const map: Record<string, Job[]> = {}
    for (const status of PIPELINE_COLUMNS) {
      map[status] = []
    }
    for (const job of filtered) {
      if (map[job.status]) {
        map[job.status].push(job)
      }
    }
    for (const status of PIPELINE_COLUMNS) {
      map[status].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      )
    }
    return map
  }, [filtered])

  // Total active (non-empty columns)
  const activeTotal = useMemo(
    () => PIPELINE_COLUMNS.reduce((acc, s) => acc + grouped[s].length, 0),
    [grouped]
  )

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div
        data-pipeline-header
        style={{
          padding: '20px 24px 12px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            Pipeline
            <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 8 }}>
              {activeTotal} jobs
            </span>
          </h1>
        </div>

        {/* Search */}
        <PipelineSearch value={search} onChange={setSearch} jobs={jobs} />
      </div>

      {/* Kanban grid */}
      <div
        data-pipeline-scroll
        style={{
          flex: 1,
          overflow: 'auto',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: isMobile ? 8 : 16,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile
              ? `repeat(${PIPELINE_COLUMNS.length}, 260px)`
              : `repeat(${PIPELINE_COLUMNS.length}, minmax(220px, 1fr))`,
            gap: isMobile ? 8 : 12,
            minWidth: isMobile
              ? PIPELINE_COLUMNS.length * 268
              : PIPELINE_COLUMNS.length * 232,
          }}
        >
          {PIPELINE_COLUMNS.map((status) => (
            <PipelineColumn
              key={status}
              status={status}
              jobs={grouped[status]}
              onCardClick={selectJob}
              onAddJob={(company, role) => {
                const id = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)
                addJob({
                  id,
                  date: new Date().toISOString().split('T')[0],
                  status,
                  company,
                  role,
                  location: '',
                  salary: '',
                  ats: '',
                  cv: '',
                  portfolio: '',
                  link: '',
                  notes: '',
                })
                selectJob(id)
              }}
              searchQuery={search}
              isDropTarget={dropTarget === status}
              onDragOver={(e) => { e.preventDefault(); setDropTarget(status) }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={() => {
                if (draggedJobId && status !== jobs.find(j => j.id === draggedJobId)?.status) {
                  updateJobStatus(draggedJobId, status)
                }
                setDraggedJobId(null)
                setDropTarget(null)
              }}
              onCardDragStart={(jobId) => setDraggedJobId(jobId)}
              onCardDragEnd={() => { setDraggedJobId(null); setDropTarget(null) }}
              draggedJobId={draggedJobId}
              isMobile={isMobile}
              onStatusChange={updateJobStatus}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Search with autocomplete ── */

function PipelineSearch({
  value,
  onChange,
  jobs,
}: {
  value: string
  onChange: (v: string) => void
  jobs: Job[]
}) {
  const [showSuggestions, setShowSuggestions] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const suggestions = useMemo(() => {
    if (!value.trim()) return []
    const q = value.toLowerCase().trim()
    const seen = new Set<string>()
    const results: string[] = []
    for (const j of jobs) {
      if (!seen.has(j.company) && j.company.toLowerCase().includes(q)) {
        seen.add(j.company)
        results.push(j.company)
        if (results.length >= 6) break
      }
    }
    return results
  }, [value, jobs])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative', minWidth: 220 }}>
      <Search
        size={13}
        color="var(--text-tertiary)"
        style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setShowSuggestions(true) }}
        onFocus={() => value.trim() && setShowSuggestions(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setShowSuggestions(false); inputRef.current?.blur() }
          if (e.key === 'Enter' && suggestions.length) { onChange(suggestions[0]); setShowSuggestions(false) }
        }}
        placeholder="Search company or role..."
        style={{
          width: '100%',
          padding: '7px 28px 7px 30px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-primary)',
          fontSize: 13,
          outline: 'none',
        }}
      />
      {value && (
        <button
          onClick={() => { onChange(''); setShowSuggestions(false) }}
          style={{
            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 2, display: 'flex',
          }}
        >
          <X size={12} />
        </button>
      )}
      {showSuggestions && suggestions.length > 0 && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)', zIndex: 50, maxHeight: 200, overflowY: 'auto',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {suggestions.map((c) => (
            <div
              key={c}
              style={{
                padding: '8px 12px', fontSize: 13, color: 'var(--text-primary)',
                cursor: 'pointer', borderBottom: '1px solid var(--border)',
              }}
              onMouseDown={() => { onChange(c); setShowSuggestions(false) }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              {highlightMatch(c, value)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function highlightMatch(text: string, query: string) {
  if (!query.trim()) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase().trim())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <strong style={{ color: 'var(--accent)' }}>{text.slice(idx, idx + query.trim().length)}</strong>
      {text.slice(idx + query.trim().length)}
    </>
  )
}

/* ── Column ── */

function PipelineColumn({
  status,
  jobs,
  onCardClick,
  onAddJob,
  searchQuery,
  isDropTarget,
  onDragOver,
  onDragLeave,
  onDrop,
  onCardDragStart,
  onCardDragEnd,
  draggedJobId,
  isMobile,
  onStatusChange,
}: {
  status: JobStatus
  jobs: Job[]
  onCardClick: (id: string) => void
  onAddJob: (company: string, role: string) => void
  searchQuery: string
  isDropTarget: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: () => void
  onCardDragStart: (jobId: string) => void
  onCardDragEnd: () => void
  draggedJobId: string | null
  isMobile: boolean
  onStatusChange: (jobId: string, status: JobStatus) => void
}) {
  const config = STATUS_CONFIG[status]
  const [showAdd, setShowAdd] = useState(false)
  const [newCompany, setNewCompany] = useState('')
  const [newRole, setNewRole] = useState('')
  const companyRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showAdd && companyRef.current) companyRef.current.focus()
  }, [showAdd])

  function handleSubmitAdd() {
    if (!newCompany.trim()) return
    onAddJob(newCompany.trim(), newRole.trim())
    setNewCompany('')
    setNewRole('')
    setShowAdd(false)
  }

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.preventDefault(); onDrop() }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minHeight: 100,
        borderRadius: 'var(--radius-md)',
        border: isDropTarget ? `2px dashed ${config.color}` : '2px solid transparent',
        background: isDropTarget ? `${config.color}08` : 'transparent',
        transition: 'all 150ms',
        padding: isDropTarget ? 4 : 0,
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
          <button
            onClick={() => setShowAdd(!showAdd)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-tertiary)',
              padding: 2,
              display: 'flex',
              alignItems: 'center',
              transition: 'color 150ms',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = config.color }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)' }}
            title="Add job to this column"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Quick add form */}
      {showAdd && (
        <div
          style={{
            background: 'var(--bg-elevated)',
            border: `1px solid ${config.color}50`,
            borderRadius: 'var(--radius-md)',
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <input
            ref={companyRef}
            type="text"
            value={newCompany}
            onChange={(e) => setNewCompany(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitAdd(); if (e.key === 'Escape') setShowAdd(false) }}
            placeholder="Company *"
            style={quickInputStyle}
          />
          <input
            type="text"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitAdd(); if (e.key === 'Escape') setShowAdd(false) }}
            placeholder="Role (optional)"
            style={quickInputStyle}
          />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button
              onClick={() => setShowAdd(false)}
              style={{ ...quickBtnStyle, color: 'var(--text-tertiary)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmitAdd}
              style={{ ...quickBtnStyle, color: config.color, border: `1px solid ${config.color}` }}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Cards */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {jobs.length === 0 && !showAdd ? (
          <div
            style={{
              padding: '20px 12px',
              fontSize: 12,
              color: 'var(--text-tertiary)',
              fontStyle: 'italic',
              textAlign: 'center',
            }}
          >
            No jobs in this stage
          </div>
        ) : (
          jobs.map((job) => (
            <PipelineCard
              key={job.id}
              job={job}
              onClick={() => onCardClick(job.id)}
              searchQuery={searchQuery}
              isDragging={draggedJobId === job.id}
              onDragStart={() => onCardDragStart(job.id)}
              onDragEnd={onCardDragEnd}
              isMobile={isMobile}
              onStatusChange={onStatusChange}
            />
          ))
        )}
      </div>
    </div>
  )
}

const quickInputStyle: React.CSSProperties = {
  padding: '6px 8px',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  fontSize: 12,
  outline: 'none',
  width: '100%',
}

const quickBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 11,
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'transparent',
  cursor: 'pointer',
}

/* ── Card ── */

const PROGRESS_ICONS: Record<StageProgress['state'], string> = {
  'not-scheduled': '○',
  'scheduled': '◎',
  'done': '✓',
  'awaiting-response': '◷',
}

/** Touch-friendly status dropdown for mobile kanban cards */
function TouchStatusDropdown({ job, onStatusChange, onClose }: {
  job: Job
  onStatusChange: (jobId: string, status: JobStatus) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const statuses: JobStatus[] = [
    'submitted', 'interviewing', 'challenge',
    'offer', 'rejected',
  ]

  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
      style={{
        position: 'absolute', bottom: '100%', left: 0, right: 0,
        marginBottom: 4, zIndex: 50,
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '4px 0',
        boxShadow: '0 -8px 24px rgba(0,0,0,0.5)',
        maxHeight: 240, overflowY: 'auto',
      }}
    >
      <div style={{ padding: '4px 10px 6px', fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Move to...
      </div>
      {statuses.map(s => {
        const cfg = STATUS_CONFIG[s]
        const isActive = job.status === s
        return (
          <button
            key={s}
            onClick={(e) => {
              e.stopPropagation()
              if (!isActive) onStatusChange(job.id, s)
              onClose()
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', padding: '8px 12px',
              background: isActive ? 'rgba(255,255,255,0.05)' : 'transparent',
              border: 'none', cursor: 'pointer', fontSize: 12, color: cfg.color,
              textAlign: 'left', minHeight: 36,
            }}
          >
            <span style={{ width: 16, textAlign: 'center' }}>{cfg.icon}</span>
            {cfg.label}
            {isActive && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-tertiary)' }}>current</span>}
          </button>
        )
      })}
    </div>
  )
}

function PipelineCard({
  job, onClick, searchQuery, isDragging, onDragStart, onDragEnd, isMobile, onStatusChange,
}: {
  job: Job; onClick: () => void; searchQuery: string
  isDragging: boolean; onDragStart: () => void; onDragEnd: () => void
  isMobile: boolean; onStatusChange: (jobId: string, status: JobStatus) => void
}) {
  const lastEvent = job.events?.[job.events.length - 1]
  const progress = getStageProgress(job)
  const [showStatusMenu, setShowStatusMenu] = useState(false)

  return (
    <div style={{ position: 'relative' }}>
      <button
        data-pipeline-card
        draggable={!isMobile}
        onDragStart={isMobile ? undefined : (e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', job.id)
          onDragStart()
        }}
        onDragEnd={isMobile ? undefined : onDragEnd}
        onClick={onClick}
        style={{
          textAlign: 'left',
          width: '100%',
          padding: isMobile ? '8px 10px' : '10px 12px',
          background: isDragging ? 'var(--bg-surface)' : 'var(--bg-elevated)',
          borderTop: '1px solid var(--border)',
          borderRight: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
          borderLeft: progress ? `3px solid ${progress.color}` : '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          cursor: isDragging ? 'grabbing' : isMobile ? 'pointer' : 'grab',
          transition: 'all var(--transition-fast)',
          display: 'flex',
          flexDirection: 'column',
          gap: isMobile ? 4 : 6,
          opacity: isDragging ? 0.4 : 1,
        }}
        onMouseEnter={(e) => {
          if (!isDragging) {
            e.currentTarget.style.borderColor = 'var(--border-hover)'
            e.currentTarget.style.background = '#1f1f26'
          }
        }}
        onMouseLeave={(e) => {
          if (!isDragging) {
            e.currentTarget.style.borderColor = 'var(--border)'
            e.currentTarget.style.background = 'var(--bg-elevated)'
          }
        }}
      >
        {/* Company */}
        <span
          data-card-company
          style={{
            fontSize: isMobile ? 12 : 13,
            fontWeight: 600,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            width: '100%',
          }}
        >
          {searchQuery ? highlightMatch(job.company, searchQuery) : job.company}
        </span>

        {/* Role */}
        <span
          data-card-role
          style={{
            fontSize: isMobile ? 11 : 12,
            color: 'var(--text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            width: '100%',
          }}
        >
          {searchQuery ? highlightMatch(job.role, searchQuery) : job.role}
        </span>

        {/* Stage progress badge */}
        {progress && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '3px 8px', borderRadius: 6,
            background: progress.bg,
            width: 'fit-content',
          }}>
            <span style={{ fontSize: 11, color: progress.color, fontWeight: 600 }}>
              {PROGRESS_ICONS[progress.state]}
            </span>
            <span style={{ fontSize: 10, color: progress.color, fontWeight: 500 }}>
              {progress.state === 'scheduled' ? `Scheduled ${progress.label}` : progress.label}
            </span>
          </div>
        )}

        {/* Bottom row: date + mobile status change button */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
            {lastEvent ? formatShortDate(lastEvent.date) : formatShortDate(job.date)}
          </span>
          {isMobile && (
            <button
              data-touch-status
              onClick={(e) => {
                e.stopPropagation()
                setShowStatusMenu(v => !v)
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 2,
                padding: '2px 6px', borderRadius: 4,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid var(--border)',
                color: 'var(--text-tertiary)', fontSize: 10,
                cursor: 'pointer', minHeight: 24,
              }}
            >
              Move <ChevronDown size={10} />
            </button>
          )}
        </div>
      </button>

      {/* Touch status dropdown (mobile only) */}
      {showStatusMenu && isMobile && (
        <TouchStatusDropdown
          job={job}
          onStatusChange={onStatusChange}
          onClose={() => setShowStatusMenu(false)}
        />
      )}
    </div>
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
