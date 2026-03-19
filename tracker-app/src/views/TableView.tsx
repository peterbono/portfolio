import { useMemo } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink } from 'lucide-react'
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

const columns: ColumnDef<Job, unknown>[] = [
  {
    accessorKey: 'date',
    header: 'Date',
    size: 75,
    cell: ({ getValue }) => (
      <span style={{ color: 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>
        {formatDate(getValue<string>())}
      </span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    size: 120,
    cell: ({ getValue }) => <StatusBadge status={getValue<JobStatus>()} size="sm" />,
  },
  {
    accessorKey: 'role',
    header: 'Role',
    size: 220,
    cell: ({ getValue }) => (
      <span
        style={{
          fontWeight: 500,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'block',
          maxWidth: 220,
        }}
      >
        {getValue<string>() || '—'}
      </span>
    ),
  },
  {
    accessorKey: 'company',
    header: 'Company',
    size: 160,
    cell: ({ getValue }) => (
      <span
        style={{
          fontWeight: 500,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'block',
          maxWidth: 160,
        }}
      >
        {getValue<string>() || '—'}
      </span>
    ),
  },
  {
    accessorKey: 'location',
    header: 'Location',
    size: 130,
    cell: ({ getValue }) => (
      <span style={{ color: 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>
        {getValue<string>() || '—'}
      </span>
    ),
  },
  {
    accessorKey: 'salary',
    header: 'Salary',
    size: 100,
    cell: ({ getValue }) => (
      <span style={{ color: 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>
        {getValue<string>() || '—'}
      </span>
    ),
  },
  {
    accessorKey: 'ats',
    header: 'ATS',
    size: 90,
    cell: ({ getValue }) => (
      <span style={{ color: 'var(--text-tertiary)', fontSize: 12, whiteSpace: 'nowrap' }}>
        {getValue<string>() || '—'}
      </span>
    ),
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
    cell: ({ getValue }) => <CellLink href={getValue<string>()} />,
  },
  {
    accessorKey: 'notes',
    header: 'Notes',
    size: 180,
    cell: ({ getValue }) => (
      <span
        style={{
          color: 'var(--text-tertiary)',
          fontSize: 12,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'block',
          maxWidth: 180,
        }}
      >
        {getValue<string>() || '—'}
      </span>
    ),
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

// ─── Main TableView ─────────────────────────────────────────────────
export function TableView() {
  const { jobs, counts } = useJobs()
  const { selectJob } = useUI()
  const filters = useFilters()

  const filteredData = useMemo(() => filters.filteredJobs(jobs), [filters, jobs])
  const companies = useMemo(() => filters.uniqueCompanies(jobs), [filters, jobs])

  const submittedPct = useMemo(() => {
    if (jobs.length === 0) return 0
    return (counts.submitted / jobs.length) * 100
  }, [counts.submitted, jobs.length])

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
          <span style={styles.jobCount}>{filteredData.length} of {jobs.length}</span>
        </div>
        <ProgressRing percentage={submittedPct} />
      </div>

      {/* Stat cards */}
      <StatCards
        counts={counts}
        totalJobs={jobs.length}
        activeFilter={filters.statusFilter}
        onFilterChange={filters.setStatusFilter}
      />

      {/* Search bar */}
      <div style={{ marginTop: 12 }}>
        <SearchBar
          searchQuery={filters.searchQuery}
          onSearchChange={filters.setSearch}
          areaFilter={filters.areaFilter}
          onAreaChange={filters.setArea}
          companyFilter={filters.companyFilter}
          onCompanyChange={filters.setCompany}
          companies={companies}
        />
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
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => selectJob(row.original.id)}
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
              ))
            )}
          </tbody>
        </table>
      </div>
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
}
