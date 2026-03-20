import { useState, useCallback, useMemo } from 'react'
import type { Job, JobStatus } from '../types/job'

export type StatusFilterValue = JobStatus | 'all'
export type SortDirection = 'asc' | 'desc'

export interface FilterState {
  statusFilter: StatusFilterValue
  searchQuery: string
  companyFilter: string
  sortColumn: string
  sortDirection: SortDirection
}

export interface FilterActions {
  setStatusFilter: (status: StatusFilterValue) => void
  setSearch: (query: string) => void
  setCompany: (company: string) => void
  toggleSort: (column: string) => void
  resetFilters: () => void
}

export interface UseFiltersReturn extends FilterState, FilterActions {
  filteredJobs: (jobs: Job[]) => Job[]
  uniqueCompanies: (jobs: Job[]) => string[]
}

function compareValues(a: unknown, b: unknown, direction: SortDirection): number {
  const aStr = String(a ?? '').toLowerCase()
  const bStr = String(b ?? '').toLowerCase()

  if (!isNaN(Date.parse(aStr)) && !isNaN(Date.parse(bStr))) {
    const diff = new Date(aStr).getTime() - new Date(bStr).getTime()
    return direction === 'asc' ? diff : -diff
  }

  const cmp = aStr.localeCompare(bStr)
  return direction === 'asc' ? cmp : -cmp
}

export function useFilters(): UseFiltersReturn {
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [sortColumn, setSortColumn] = useState('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const setSearch = useCallback((query: string) => setSearchQuery(query), [])
  const setCompany = useCallback((company: string) => setCompanyFilter(company), [])

  const toggleSort = useCallback((column: string) => {
    setSortColumn((prev) => {
      if (prev === column) {
        setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
        return prev
      }
      setSortDirection('asc')
      return column
    })
  }, [])

  const resetFilters = useCallback(() => {
    setStatusFilter('all')
    setSearchQuery('')
    setCompanyFilter('')
    setSortColumn('date')
    setSortDirection('desc')
  }, [])

  const filteredJobs = useCallback(
    (jobs: Job[]): Job[] => {
      let result = [...jobs]

      if (statusFilter !== 'all') {
        result = result.filter((j) => j.status === statusFilter)
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        result = result.filter(
          (j) =>
            j.company.toLowerCase().includes(q) ||
            j.role.toLowerCase().includes(q) ||
            j.ats.toLowerCase().includes(q) ||
            j.location.toLowerCase().includes(q) ||
            (j.notes ?? '').toLowerCase().includes(q)
        )
      }

      if (companyFilter) {
        result = result.filter((j) => j.company === companyFilter)
      }

      if (sortColumn) {
        result.sort((a, b) => {
          const aVal = a[sortColumn as keyof Job]
          const bVal = b[sortColumn as keyof Job]
          return compareValues(aVal, bVal, sortDirection)
        })
      }

      return result
    },
    [statusFilter, searchQuery, companyFilter, sortColumn, sortDirection]
  )

  const uniqueCompanies = useMemo(
    () => (jobs: Job[]): string[] => {
      const set = new Set(jobs.map((j) => j.company).filter(Boolean))
      return Array.from(set).sort((a, b) => a.localeCompare(b))
    },
    []
  )

  return {
    statusFilter,
    searchQuery,
    companyFilter,
    sortColumn,
    sortDirection,
    setStatusFilter,
    setSearch,
    setCompany,
    toggleSort,
    resetFilters,
    filteredJobs,
    uniqueCompanies,
  }
}
