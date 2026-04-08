import { useEffect, useRef, useMemo, useState } from 'react'
import { X, ExternalLink, ChevronRight } from 'lucide-react'
import { useUI } from '../context/UIContext'
import { useJobs } from '../context/JobsContext'
import { StatusBadge } from '../components/StatusBadge'
import { EventForm } from '../components/EventForm'
import { useJobEvents } from '../hooks/useJobEvents'
import type { JobStatus, JobEvent } from '../types/job'
import { STATUS_CONFIG } from '../types/job'

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

/** Format an ISO date string (YYYY-MM-DD) into "16 Mar 2026" style */
function formatDateNice(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Get the rejection date from lastContactDate or most recent rejection event */
function getRejectionDate(job: { lastContactDate?: string; date: string; events?: JobEvent[] }, events: JobEvent[]): string | null {
  // Priority 1: lastContactDate on a rejected job
  if (job.lastContactDate) {
    const d = job.lastContactDate.includes('T') ? job.lastContactDate.split('T')[0] : job.lastContactDate
    if (d && !isNaN(new Date(d + 'T00:00:00').getTime())) return d
  }
  // Priority 2: most recent rejection event
  const rejectionEvents = events.filter(e => e.type === 'rejection')
  if (rejectionEvents.length > 0) {
    // events are already sorted desc by date
    const latest = rejectionEvents[0]
    const d = latest.date.includes('T') ? latest.date.split('T')[0] : latest.date
    if (d && !isNaN(new Date(d + 'T00:00:00').getTime())) return d
  }
  return null
}

// Only statuses that appear in the pipeline
const ALLOWED_STATUSES: JobStatus[] = [
  'submitted', 'screening', 'interviewing', 'challenge',
  'offer', 'rejected', 'ghosted', 'expired',
]

export function DetailDrawer() {
  const { selectedJobId, closeDrawer } = useUI()
  const { jobs, updateJobStatus, updateJobField, addJobEvent, removeJobEvent, deleteJob } = useJobs()
  const { events: localEvents, addEvent: addLocalEvent, deleteEvent: deleteLocalEvent } = useJobEvents(selectedJobId)
  const drawerRef = useRef<HTMLDivElement>(null)

  const job = jobs.find((j) => j.id === selectedJobId)

  // Unique ATS and location values for autocomplete
  const atsSuggestions = useMemo(() => {
    const set = new Set<string>()
    for (const j of jobs) if (j.ats) set.add(j.ats)
    return Array.from(set).sort()
  }, [jobs])

  const locationSuggestions = useMemo(() => {
    const set = new Set<string>()
    for (const j of jobs) if (j.location) set.add(j.location)
    return Array.from(set).sort()
  }, [jobs])

  // Escape key handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeDrawer()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeDrawer])

  // Merge events from JobsContext + localStorage, deduplicate by id
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

  function handleAddEvent(jobId: string, event: JobEvent) {
    addJobEvent(jobId, event)
    addLocalEvent(jobId, event)
  }

  function handleDeleteEvent(eventId: string) {
    if (!selectedJobId) return
    deleteLocalEvent(selectedJobId, eventId)
    removeJobEvent(selectedJobId, eventId)
  }

  function handleEditEvent(eventId: string, updated: JobEvent) {
    if (!selectedJobId) return
    // Delete old, add updated
    deleteLocalEvent(selectedJobId, eventId)
    addLocalEvent(selectedJobId, updated)
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
        {/* Mobile close bar — visible only on small screens */}
        <button
          onClick={closeDrawer}
          aria-label="Close drawer"
          className="drawer-mobile-close"
          style={{
            display: 'none', // shown via CSS media query
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '10px 0',
            background: 'var(--bg-elevated)',
            borderBottom: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            width: '100%',
            flexShrink: 0,
          }}
        >
          <span style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--text-tertiary)', opacity: 0.5 }} />
        </button>

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
              <EditableField
                value={job.company}
                onSave={(v) => updateJobField(job.id, 'company', v)}
                style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}
                placeholder="Company name"
              />
              <EditableField
                value={job.role}
                onSave={(v) => updateJobField(job.id, 'role', v)}
                style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 2 }}
                placeholder="Role title"
              />
            </div>
            <button
              onClick={closeDrawer}
              aria-label="Close detail panel"
              style={{
                padding: 6,
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-tertiary)',
                transition: 'all var(--transition-fast)',
                flexShrink: 0,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <StatusBadge status={job.status} />
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                Applied {formatDateNice(job.date)}
              </span>
              {job.location && (
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  {job.location}
                </span>
              )}
            </div>
            {job.status === 'rejected' && (() => {
              const rejDate = getRejectionDate(job, allEvents)
              if (!rejDate) return null
              const rejD = new Date(rejDate + 'T00:00:00')
              if (isNaN(rejD.getTime())) return null
              const formatted = rejD.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
              const nowMs = new Date().setHours(0,0,0,0)
              const diffDays = Math.round((nowMs - rejD.getTime()) / 86400000)
              const ago = diffDays === 0 ? 'today' : diffDays === 1 ? '1d ago' : `${diffDays}d ago`
              // Response time
              const applyD = new Date(job.date + 'T00:00:00')
              const responseDays = Math.round((rejD.getTime() - applyD.getTime()) / 86400000)
              const responseText = responseDays <= 0 ? 'same day' : responseDays === 1 ? '1 day' : `${responseDays} days`
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: '#a855f7', fontWeight: 500 }}>
                    Rejected {formatted} ({ago})
                  </span>
                  <span style={{
                    fontSize: 11,
                    color: 'var(--text-tertiary)',
                    background: 'rgba(168, 85, 247, 0.1)',
                    padding: '1px 8px',
                    borderRadius: 10,
                    border: '1px solid rgba(168, 85, 247, 0.2)',
                  }}>
                    Response time: {responseText}
                  </span>
                </div>
              )
            })()}
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
            {ALLOWED_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_CONFIG[s].icon} {STATUS_CONFIG[s].label}
              </option>
            ))}
          </select>

          <ActionButton
            label="Ghost"
            color="#3f3f46"
            onClick={() => updateJobStatus(job.id, 'ghosted')}
          />
          <ActionButton
            label="Reject"
            color="#a855f7"
            onClick={() => updateJobStatus(job.id, 'rejected')}
          />
          <ActionButton
            label="Delete"
            color="#71717a"
            onClick={() => { if (confirm('Delete this job permanently?')) { deleteJob(job.id); closeDrawer() } }}
          />
        </div>

        {/* ── Scrollable Body ── */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
          {/* Details section — all editable */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
            <AutocompleteDetailRow label="Location" value={job.location} onSave={(v) => updateJobField(job.id, 'location', v)} suggestions={locationSuggestions} placeholder="e.g. Remote, EMEA" />
            <EditableDetailRow label="Salary" value={job.salary} onSave={(v) => updateJobField(job.id, 'salary', v)} placeholder="e.g. 80-100k EUR" />
            <DateDetailRow label="Applied" value={job.date} onSave={(v) => updateJobField(job.id, 'date', v)} formatted={formatDateNice(job.date)} />
            {job.status === 'rejected' && (() => {
              const rejDate = getRejectionDate(job, allEvents)
              if (!rejDate) return null
              return (
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{ ...detailLabelStyle, color: '#a855f7' }}>Rejected</span>
                  <span style={{ fontSize: 13, color: '#a855f7', fontWeight: 500 }}>
                    {formatDateNice(rejDate)}
                  </span>
                </div>
              )
            })()}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={detailLabelStyle}>Link</span>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                <EditableField
                  value={job.link}
                  onSave={(v) => updateJobField(job.id, 'link', v)}
                  style={{ fontSize: 13, color: 'var(--accent)', flex: 1 }}
                  placeholder="https://..."
                />
                {job.link && isValidUrl(job.link) && (
                  <a href={job.link} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', flexShrink: 0 }}>
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </div>
            <EditableDetailRow label="Notes" value={job.notes} onSave={(v) => updateJobField(job.id, 'notes', v)} placeholder="Any notes..." />
          </div>

          {/* ── Technical Details (collapsible) ── */}
          <TechnicalDetails
            job={job}
            atsSuggestions={atsSuggestions}
            onUpdateField={(field, value) => updateJobField(job.id, field, value)}
          />

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
            {allEvents.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No events yet</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {allEvents.map((evt) => (
                  <div key={evt.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.02)' }}>
                    <div>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{evt.type}</span>
                      {evt.notes && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 8 }}>{evt.notes}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{evt.date?.split('T')[0]}</span>
                      <button onClick={() => handleDeleteEvent(evt.id)} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 11 }}>x</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
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

/* ── Technical Details (collapsible) ── */
function TechnicalDetails({ job, atsSuggestions, onUpdateField }: {
  job: { id: string; ats: string; cv: string; portfolio: string }
  atsSuggestions: string[]
  onUpdateField: (field: string, value: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ marginBottom: 24 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '4px 0',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          width: '100%',
        }}
      >
        <ChevronRight
          size={14}
          style={{
            transition: 'transform 0.2s',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        />
        Technical Details
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10, paddingLeft: 4 }}>
          <AutocompleteDetailRow label="ATS" value={job.ats} onSave={(v) => onUpdateField('ats', v)} suggestions={atsSuggestions} placeholder="e.g. Greenhouse" />
          <ToggleDetailRow label="CV" value={job.cv === '\u2713' || job.cv === 'Yes' || job.cv === 'yes'} onToggle={(v) => onUpdateField('cv', v ? '\u2713' : '')} />
          <ToggleDetailRow label="Folio" value={job.portfolio === '\u2713' || job.portfolio === 'Yes' || job.portfolio === 'yes'} onToggle={(v) => onUpdateField('portfolio', v ? '\u2713' : '')} />
        </div>
      )}
    </div>
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
        cursor: 'pointer',
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

const detailLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-tertiary)',
  minWidth: 60,
  paddingTop: 1,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
  flexShrink: 0,
}

function EditableField({
  value,
  onSave,
  style: customStyle,
  placeholder,
}: {
  value: string
  onSave: (val: string) => void
  style?: React.CSSProperties
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const commit = () => {
    if (draft !== value) onSave(draft)
    setEditing(false)
  }

  if (!editing) {
    return (
      <div
        onClick={() => { setDraft(value); setEditing(true) }}
        style={{
          cursor: 'pointer',
          minHeight: 20,
          borderRadius: 4,
          padding: '1px 4px',
          margin: '-1px -4px',
          transition: 'background 0.1s',
          ...customStyle,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
        title="Click to edit"
      >
        {value || <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic', fontSize: 12 }}>{placeholder || 'Empty — click to add'}</span>}
      </div>
    )
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') { setDraft(value); setEditing(false) }
      }}
      placeholder={placeholder}
      style={{
        width: '100%',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--accent)',
        borderRadius: 4,
        padding: '3px 6px',
        fontSize: (customStyle?.fontSize as number) || 13,
        fontWeight: (customStyle?.fontWeight as number) || 400,
        color: 'var(--text-primary)',
        outline: 'none',
      }}
    />
  )
}

function EditableDetailRow({
  label,
  value,
  onSave,
  placeholder,
}: {
  label: string
  value: string
  onSave: (val: string) => void
  placeholder?: string
}) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <span style={detailLabelStyle}>{label}</span>
      <EditableField
        value={value}
        onSave={onSave}
        style={{ fontSize: 13, color: 'var(--text-secondary)', flex: 1 }}
        placeholder={placeholder}
      />
    </div>
  )
}

/* ── Toggle Row (CV / Folio) ── */
function ToggleDetailRow({ label, value, onToggle }: { label: string; value: boolean; onToggle: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <span style={detailLabelStyle} id={`toggle-label-${label.toLowerCase()}`}>{label}</span>
      <button
        role="switch"
        aria-checked={value}
        aria-labelledby={`toggle-label-${label.toLowerCase()}`}
        onClick={() => onToggle(!value)}
        style={{
          width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
          background: value ? '#34d399' : 'rgba(255,255,255,0.1)',
          position: 'relative', transition: 'background 0.2s',
          flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: value ? 20 : 2,
          width: 18, height: 18, borderRadius: '50%',
          background: '#fff', transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }} />
      </button>
      <span style={{ fontSize: 12, color: value ? '#34d399' : 'var(--text-tertiary)' }}>
        {value ? 'Yes' : 'No'}
      </span>
    </div>
  )
}

/* ── Date Picker Row ── */
function DateDetailRow({ label, value, onSave, formatted }: { label: string; value: string; onSave: (v: string) => void; formatted?: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <span style={detailLabelStyle}>{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onSave(e.target.value)}
        aria-label={`${label} date`}
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: '3px 8px',
          fontSize: 13,
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          outline: 'none',
          colorScheme: 'dark',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)' }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
      />
      {formatted && (
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{formatted}</span>
      )}
    </div>
  )
}

/* ── Autocomplete Row (ATS / Location) ── */
function AutocompleteDetailRow({
  label, value, onSave, suggestions, placeholder,
}: {
  label: string; value: string; onSave: (v: string) => void
  suggestions: string[]; placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  useEffect(() => {
    if (!showSuggestions) return
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showSuggestions])

  const filtered = useMemo(() => {
    if (!draft) return suggestions.slice(0, 8)
    const lower = draft.toLowerCase()
    return suggestions.filter(s => s.toLowerCase().includes(lower)).slice(0, 8)
  }, [draft, suggestions])

  const commit = (val?: string) => {
    const final = val ?? draft
    if (final !== value) onSave(final)
    setEditing(false)
    setShowSuggestions(false)
  }

  if (!editing) {
    return (
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={detailLabelStyle}>{label}</span>
        <div
          onClick={() => { setDraft(value); setEditing(true); setShowSuggestions(true) }}
          style={{
            fontSize: 13, color: value ? 'var(--text-secondary)' : 'var(--text-tertiary)',
            cursor: 'pointer', padding: '1px 4px', margin: '-1px -4px',
            borderRadius: 4, transition: 'background 0.1s', flex: 1,
            fontStyle: value ? 'normal' : 'italic',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          title="Click to edit"
        >
          {value || placeholder || 'Empty — click to add'}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <span style={detailLabelStyle}>{label}</span>
      <div ref={wrapRef} style={{ position: 'relative', flex: 1 }}>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setShowSuggestions(true) }}
          onBlur={() => setTimeout(() => commit(), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setDraft(value); setEditing(false); setShowSuggestions(false) }
          }}
          placeholder={placeholder}
          style={{
            width: '100%',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--accent)',
            borderRadius: 4,
            padding: '3px 6px',
            fontSize: 13,
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
        {showSuggestions && filtered.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0,
            marginTop: 2, background: 'var(--bg-elevated)',
            border: '1px solid var(--border)', borderRadius: 6,
            maxHeight: 180, overflow: 'auto', zIndex: 60,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}>
            {filtered.map(s => (
              <button
                key={s}
                onMouseDown={(e) => { e.preventDefault(); setDraft(s); commit(s) }}
                style={{
                  display: 'block', width: '100%', padding: '6px 10px',
                  background: 'transparent', border: 'none',
                  fontSize: 12, color: 'var(--text-secondary)',
                  textAlign: 'left', cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
