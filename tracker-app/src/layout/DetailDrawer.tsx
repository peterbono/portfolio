import { useEffect, useRef, useMemo, useState } from 'react'
import { X, ExternalLink } from 'lucide-react'
import { useUI } from '../context/UIContext'
import { useJobs } from '../context/JobsContext'
import { StatusBadge } from '../components/StatusBadge'
import { EventTimeline } from '../components/EventTimeline'
import { EventForm } from '../components/EventForm'
import { useJobEvents } from '../hooks/useJobEvents'
import type { JobStatus, JobEvent } from '../types/job'
import { STATUS_CONFIG } from '../types/job'

// Only statuses that appear in the pipeline — no Easy Apply, no saved
const ALLOWED_STATUSES: JobStatus[] = [
  'manual', 'submitted', 'screening', 'interviewing', 'challenge',
  'offer', 'negotiation', 'rejected', 'withdrawn', 'ghosted', 'skipped',
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
            {ALLOWED_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_CONFIG[s].icon} {STATUS_CONFIG[s].label}
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
            <AutocompleteDetailRow label="ATS" value={job.ats} onSave={(v) => updateJobField(job.id, 'ats', v)} suggestions={atsSuggestions} placeholder="e.g. Greenhouse" />
            <DateDetailRow label="Date" value={job.date} onSave={(v) => updateJobField(job.id, 'date', v)} />
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={detailLabelStyle}>Link</span>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                <EditableField
                  value={job.link}
                  onSave={(v) => updateJobField(job.id, 'link', v)}
                  style={{ fontSize: 13, color: 'var(--accent)', flex: 1 }}
                  placeholder="https://..."
                />
                {job.link && (
                  <a href={job.link} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', flexShrink: 0 }}>
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </div>
            <EditableDetailRow label="Notes" value={job.notes} onSave={(v) => updateJobField(job.id, 'notes', v)} placeholder="Any notes..." />
            <ToggleDetailRow label="CV" value={job.cv === '✓' || job.cv === 'Yes' || job.cv === 'yes'} onToggle={(v) => updateJobField(job.id, 'cv', v ? '✓' : '')} />
            <ToggleDetailRow label="Folio" value={job.portfolio === '✓' || job.portfolio === 'Yes' || job.portfolio === 'yes'} onToggle={(v) => updateJobField(job.id, 'portfolio', v ? '✓' : '')} />
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
            <EventTimeline
              events={allEvents}
              onDelete={handleDeleteEvent}
              onEdit={handleEditEvent}
            />
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
      <span style={detailLabelStyle}>{label}</span>
      <button
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
function DateDetailRow({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <span style={detailLabelStyle}>{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onSave(e.target.value)}
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
