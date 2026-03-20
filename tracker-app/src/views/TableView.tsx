import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'

const PAGE_SIZE = 50
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, MoreHorizontal, Plus } from 'lucide-react'
import { format, parseISO, isValid } from 'date-fns'

import { useJobs } from '../context/JobsContext'
import { useUI } from '../context/UIContext'
import { useFilters } from '../hooks/useFilters'
import type { Job, JobStatus } from '../types/job'
import { STATUS_CONFIG } from '../types/job'

import { ProgressRing } from '../components/ProgressRing'
import { StatCards } from '../components/StatCards'
import { SearchBar } from '../components/SearchBar'
import { StatusBadge } from '../components/StatusBadge'

// ─── Column definitions ─────────────────────────────────────────────
function formatDate(dateStr: string): string {
  if (!dateStr) return '—'
  try {
    const parsed = parseISO(dateStr)
    return isValid(parsed) ? format(parsed, 'MMM d') : dateStr
  } catch {
    return dateStr
  }
}

function CellLink({ href }: { href: string }) {
  if (!href) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
    >
      <ExternalLink size={12} />
    </a>
  )
}

function CellCheck({ value }: { value: string }) {
  if (value === '✓' || value === 'Yes' || value === 'yes') {
    return <span style={{ color: '#34d399' }}>✓</span>
  }
  if (value === '✗' || value === 'No' || value === 'no') {
    return <span style={{ color: '#ef4444' }}>✗</span>
  }
  return <span style={{ color: 'var(--text-tertiary)' }}>{value || '—'}</span>
}

// ─── Editable Cell ──────────────────────────────────────────────────
function EditableCell({ value, field, jobId, display }: {
  value: string
  field: string
  jobId: string
  display?: React.ReactNode
}) {
  const { updateJobField } = useJobs()
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
    if (draft !== value) {
      updateJobField(jobId, field, draft)
    }
    setEditing(false)
  }

  if (!editing) {
    return (
      <div
        onDoubleClick={(e) => {
          e.stopPropagation()
          setDraft(value)
          setEditing(true)
        }}
        style={{ cursor: 'default', minHeight: 20 }}
        title="Double-click to edit"
      >
        {display ?? <span style={{ color: value ? 'var(--text-secondary)' : 'var(--text-tertiary)', fontSize: 12 }}>{value || '—'}</span>}
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
      onClick={(e) => e.stopPropagation()}
      style={{
        width: '100%',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--accent)',
        borderRadius: 4,
        padding: '2px 6px',
        fontSize: 12,
        color: 'var(--text-primary)',
        outline: 'none',
      }}
    />
  )
}

// ─── Status Cell (editable via dropdown) ────────────────────────────
function EditableStatusCell({ job }: { job: Job }) {
  const { updateJobStatus } = useJobs()
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editing) return
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setEditing(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [editing])

  if (!editing) {
    return (
      <div
        onDoubleClick={(e) => { e.stopPropagation(); setEditing(true) }}
        title="Double-click to change status"
        style={{ cursor: 'default' }}
      >
        <StatusBadge status={job.status} size="sm" />
      </div>
    )
  }

  const allStatuses: JobStatus[] = [
    'submitted', 'manual', 'screening', 'interviewing', 'challenge',
    'offer', 'negotiation', 'rejected', 'withdrawn', 'ghosted', 'skipped',
  ]

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div style={{
        position: 'absolute', top: -4, left: 0, zIndex: 50,
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        borderRadius: 8, padding: '4px 0', minWidth: 160,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      }}>
        {allStatuses.map(s => {
          const cfg = STATUS_CONFIG[s]
          return (
            <button
              key={s}
              onClick={(e) => {
                e.stopPropagation()
                updateJobStatus(job.id, s)
                setEditing(false)
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', padding: '5px 10px',
                background: job.status === s ? 'rgba(255,255,255,0.05)' : 'transparent',
                border: 'none', cursor: 'pointer', fontSize: 12, color: cfg.color,
                textAlign: 'left',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = job.status === s ? 'rgba(255,255,255,0.05)' : 'transparent' }}
            >
              <span style={{ width: 16, textAlign: 'center' }}>{cfg.icon}</span>
              {cfg.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Action menu status options ─────────────────────────────────────
const STATUS_MENU_OPTIONS: JobStatus[] = [
  'screening',
  'interviewing',
  'challenge',
  'offer',
  'negotiation',
  'submitted',
  'rejected',
  'withdrawn',
  'skipped',
]

function ActionMenu({ job }: { job: Job }) {
  const { updateJobStatus } = useJobs()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const handleClose = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handleClose()
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open, handleClose])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={(e) => {
          e.stopPropagation()
          setOpen((prev) => !prev)
        }}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '4px',
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-tertiary)',
          transition: 'background var(--transition-fast)',
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
        <MoreHorizontal size={14} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '4px 0',
            minWidth: 170,
            zIndex: 100,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ padding: '4px 10px 6px', fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Change status
          </div>
          {STATUS_MENU_OPTIONS.map((status) => {
            const config = STATUS_CONFIG[status]
            const isActive = job.status === status
            return (
              <button
                key={status}
                onClick={(e) => {
                  e.stopPropagation()
                  updateJobStatus(job.id, status)
                  setOpen(false)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '6px 12px',
                  background: isActive ? 'rgba(255,255,255,0.05)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: config.color,
                  textAlign: 'left',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isActive ? 'rgba(255,255,255,0.05)' : 'transparent'
                }}
              >
                <span style={{ fontSize: 13, width: 18, textAlign: 'center', flexShrink: 0 }}>{config.icon}</span>
                <span style={{ fontWeight: isActive ? 600 : 400 }}>{config.label}</span>
                {isActive && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-tertiary)' }}>current</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

const columns: ColumnDef<Job, unknown>[] = [
  {
    accessorKey: 'date',
    header: 'Date',
    size: 75,
    cell: ({ row }) => (
      <EditableCell
        value={row.original.date}
        field="date"
        jobId={row.original.id}
        display={
          <span style={{ color: 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>
            {formatDate(row.original.date)}
          </span>
        }
      />
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    size: 120,
    cell: ({ row }) => <EditableStatusCell job={row.original} />,
  },
  {
    accessorKey: 'role',
    header: 'Role',
    size: 220,
    cell: ({ row }) => (
      <EditableCell
        value={row.original.role}
        field="role"
        jobId={row.original.id}
        display={
          <span style={{ fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', maxWidth: 220 }}>
            {row.original.role || '—'}
          </span>
        }
      />
    ),
  },
  {
    accessorKey: 'company',
    header: 'Company',
    size: 160,
    cell: ({ row }) => (
      <EditableCell
        value={row.original.company}
        field="company"
        jobId={row.original.id}
        display={
          <span style={{ fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', maxWidth: 160 }}>
            {row.original.company || '—'}
          </span>
        }
      />
    ),
  },
  {
    accessorKey: 'location',
    header: 'Location',
    size: 130,
    cell: ({ row }) => <EditableCell value={row.original.location} field="location" jobId={row.original.id} />,
  },
  {
    accessorKey: 'salary',
    header: 'Salary',
    size: 100,
    cell: ({ row }) => <EditableCell value={row.original.salary} field="salary" jobId={row.original.id} />,
  },
  {
    accessorKey: 'ats',
    header: 'ATS',
    size: 90,
    cell: ({ row }) => <EditableCell value={row.original.ats} field="ats" jobId={row.original.id} />,
  },
  {
    accessorKey: 'cv',
    header: 'CV',
    size: 40,
    cell: ({ getValue }) => <CellCheck value={getValue<string>()} />,
  },
  {
    accessorKey: 'portfolio',
    header: 'Folio',
    size: 40,
    cell: ({ getValue }) => <CellCheck value={getValue<string>()} />,
  },
  {
    accessorKey: 'link',
    header: 'Link',
    size: 40,
    cell: ({ row }) => <CellLink href={row.original.link} />,
  },
  {
    accessorKey: 'notes',
    header: 'Notes',
    size: 180,
    cell: ({ row }) => <EditableCell value={row.original.notes} field="notes" jobId={row.original.id} />,
  },
  {
    id: 'actions',
    header: '',
    size: 40,
    cell: ({ row }) => <ActionMenu job={row.original} />,
  },
]

// ─── Sort icon ──────────────────────────────────────────────────────
function SortIcon({ column, sortColumn, sortDirection }: {
  column: string
  sortColumn: string
  sortDirection: 'asc' | 'desc'
}) {
  if (column !== sortColumn) {
    return <ArrowUpDown size={11} color="var(--text-tertiary)" />
  }
  return sortDirection === 'asc'
    ? <ArrowUp size={11} color="var(--accent)" />
    : <ArrowDown size={11} color="var(--accent)" />
}

// ─── Add Job Modal ──────────────────────────────────────────────────
function AddJobModal({ onClose }: { onClose: () => void }) {
  const { addJob } = useJobs()
  const [form, setForm] = useState({
    role: '', company: '', location: '', salary: '', ats: '', link: '', notes: '',
  })

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }))

  const handleSubmit = () => {
    if (!form.company && !form.role) return
    const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    addJob({
      id,
      date: new Date().toISOString().split('T')[0],
      status: 'manual',
      role: form.role,
      company: form.company,
      location: form.location,
      salary: form.salary,
      ats: form.ats,
      cv: '',
      portfolio: '',
      link: form.link,
      notes: form.notes,
      source: 'manual',
    })
    onClose()
  }

  const fields = [
    { key: 'company', label: 'Company', placeholder: 'e.g. Spotify' },
    { key: 'role', label: 'Role', placeholder: 'e.g. Senior Product Designer' },
    { key: 'location', label: 'Location', placeholder: 'e.g. Remote, EMEA' },
    { key: 'salary', label: 'Salary', placeholder: 'e.g. 80-100k EUR' },
    { key: 'ats', label: 'ATS', placeholder: 'e.g. Greenhouse' },
    { key: 'link', label: 'Job URL', placeholder: 'https://...' },
    { key: 'notes', label: 'Notes', placeholder: 'Any notes...' },
  ]

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    fontSize: 13,
    color: 'var(--text-primary)',
    outline: 'none',
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: 24, width: 400, maxWidth: '90vw',
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
        }}
      >
        <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>Add Job</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fields.map(f => (
            <div key={f.key}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{f.label}</label>
              <input
                value={(form as Record<string, string>)[f.key]}
                onChange={set(f.key)}
                placeholder={f.placeholder}
                style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
                autoFocus={f.key === 'company'}
              />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSubmit} style={{ padding: '8px 16px', background: 'var(--accent)', border: 'none', borderRadius: 6, fontSize: 13, color: '#000', fontWeight: 600, cursor: 'pointer', opacity: form.company || form.role ? 1 : 0.4 }}>
            Add Job
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main TableView ─────────────────────────────────────────────────
export function TableView() {
  const { jobs, counts } = useJobs()
  const { selectJob } = useUI()
  const filters = useFilters()
  const [showAddModal, setShowAddModal] = useState(false)

  const { statusFilter, searchQuery, companyFilter, sortColumn, sortDirection } = filters
  const allFiltered = useMemo(
    () => filters.filteredJobs(jobs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobs, statusFilter, searchQuery, companyFilter, sortColumn, sortDirection]
  )
  const companies = useMemo(() => {
    const set = new Set(jobs.map(j => j.company).filter(Boolean))
    return Array.from(set).sort()
  }, [jobs])
  const [page, setPage] = useState(0)

  // Reset page when filters change
  const filterKey = `${statusFilter}|${searchQuery}|${companyFilter}`
  useMemo(() => { setPage(0) }, [filterKey]) // eslint-disable-line

  const totalPages = Math.ceil(allFiltered.length / PAGE_SIZE)
  const filteredData = useMemo(() => allFiltered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [allFiltered, page])

  const submittedPct = useMemo(() => {
    const excluded = (counts.skipped ?? 0) + (counts.saved ?? 0)
    const actionable = jobs.length - excluded
    if (actionable <= 0) return 0
    const applied = (counts.submitted ?? 0) + (counts.screening ?? 0) + (counts.interviewing ?? 0)
      + (counts.challenge ?? 0) + (counts.offer ?? 0) + (counts.negotiation ?? 0)
      + (counts.rejected ?? 0) + (counts.withdrawn ?? 0) + (counts.ghosted ?? 0)
    return Math.min(100, Math.round((applied / actionable) * 100))
  }, [counts, jobs.length])

  // tanstack table requires sorting state even though we handle sorting ourselves
  const sorting: SortingState = []

  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: { sorting },
    manualSorting: true,
  })

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.title}>Applications</h1>
          <span style={styles.jobCount}>{allFiltered.length} of {jobs.length}</span>
        </div>
        <ProgressRing percentage={submittedPct} />
      </div>
      {showAddModal && <AddJobModal onClose={() => setShowAddModal(false)} />}

      {/* Stat cards */}
      <StatCards
        counts={counts}
        totalJobs={jobs.length}
        activeFilter={filters.statusFilter}
        onFilterChange={filters.setStatusFilter}
      />

      {/* Search bar + Add Job */}
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <SearchBar
            searchQuery={filters.searchQuery}
            onSearchChange={filters.setSearch}
            companyFilter={filters.companyFilter}
            onCompanyChange={filters.setCompany}
            companies={companies}
          />
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 14px', borderRadius: 8,
            background: 'var(--accent)', border: 'none',
            fontSize: 12, fontWeight: 600, color: '#000',
            cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          <Plus size={14} /> Add Job
        </button>
      </div>

      {/* Table */}
      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const colId = header.column.id
                  return (
                    <th
                      key={header.id}
                      style={{
                        ...styles.th,
                        width: header.getSize(),
                        minWidth: header.getSize(),
                      }}
                      onClick={() => filters.toggleSort(colId)}
                    >
                      <div style={styles.thContent}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <SortIcon
                          column={colId}
                          sortColumn={filters.sortColumn}
                          sortDirection={filters.sortDirection}
                        />
                      </div>
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  style={styles.emptyCell}
                >
                  No jobs match current filters
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => {
                let clickTimer: ReturnType<typeof setTimeout> | null = null
                return (
                <tr
                  key={row.id}
                  onClick={() => {
                    clickTimer = setTimeout(() => selectJob(row.original.id), 250)
                  }}
                  onDoubleClick={() => {
                    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null }
                  }}
                  style={styles.tr}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-elevated)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{
                        ...styles.td,
                        width: cell.column.getSize(),
                        minWidth: cell.column.getSize(),
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              )})
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '8px 0', flexShrink: 0 }}>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{ ...styles.pageBtn, opacity: page === 0 ? 0.3 : 1 }}
          >
            Previous
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            style={{ ...styles.pageBtn, opacity: page >= totalPages - 1 ? 0.3 : 1 }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Styles ─────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: '20px 24px',
    minHeight: 0,
    flex: 1,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--text-primary)',
    lineHeight: 1.2,
  },
  jobCount: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
    fontVariantNumeric: 'tabular-nums',
  },
  tableWrapper: {
    flex: 1,
    overflow: 'auto',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--border)',
    background: 'var(--bg-surface)',
    marginTop: 4,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    tableLayout: 'fixed',
    minWidth: 1100,
  },
  th: {
    position: 'sticky',
    top: 0,
    zIndex: 2,
    padding: '8px 10px',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-tertiary)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    background: 'var(--bg-surface)',
    borderBottom: '1px solid var(--border)',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  },
  thContent: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  },
  tr: {
    cursor: 'pointer',
    transition: 'background var(--transition-fast)',
    borderBottom: '1px solid var(--border)',
  },
  td: {
    padding: '7px 10px',
    verticalAlign: 'middle',
    fontSize: 13,
  },
  emptyCell: {
    padding: '40px 10px',
    textAlign: 'center',
    color: 'var(--text-tertiary)',
    fontSize: 13,
  },
  pageBtn: {
    padding: '6px 14px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg-surface)',
    color: 'var(--text-secondary)',
    fontSize: 12,
    cursor: 'pointer',
  },
}
