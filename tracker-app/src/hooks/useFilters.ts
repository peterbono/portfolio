import { useState, useCallback, useMemo } from 'react'
import type { Job, JobStatus } from '../types/job'

export type StatusFilterValue = JobStatus | 'all'
export type SortDirection = 'asc' | 'desc'

export interface FilterState {
  statusFilter: StatusFilterValue
  searchQuery: string
  areaFilter: string
  companyFilter: string
  sortColumn: string
  sortDirection: SortDirection
}

export interface FilterActions {
  setStatusFilter: (status: StatusFilterValue) => void
  setSearch: (query: string) => void
  setArea: (area: string) => void
  setCompany: (company: string) => void
  toggleSort: (column: string) => void
  resetFilters: () => void
}

export interface UseFiltersReturn extends FilterState, FilterActions {
  filteredJobs: (jobs: Job[]) => Job[]
  uniqueCompanies: (jobs: Job[]) => string[]
}

function getJobArea(job: Job): string {
  if (job.area) return job.area

  const loc = (job.location ?? '').toLowerCase()

  const apacKeywords = [
    'bangkok', 'singapore', 'tokyo', 'sydney', 'melbourne', 'manila',
    'hong kong', 'seoul', 'mumbai', 'delhi', 'india', 'thailand',
    'vietnam', 'indonesia', 'malaysia', 'philippines', 'australia',
    'new zealand', 'japan', 'china', 'taiwan', 'apac', 'asia',
  ]
  const americasKeywords = [
    'new york', 'san francisco', 'los angeles', 'chicago', 'austin',
    'seattle', 'boston', 'toronto', 'vancouver', 'usa', 'us ', 'canada',
    'brazil', 'mexico', 'americas', 'united states',
  ]

  if (apacKeywords.some((k) => loc.includes(k))) return 'apac'
  if (americasKeywords.some((k) => loc.includes(k))) return 'americas'
  if (loc === 'remote' || loc === '') return ''

  return 'emea'
}

function compareValues(a: unknown, b: unknown, direction: SortDirection): number {
  const aStr = String(a ?? '').toLowerCase()
  const bStr = String(b ?? '').toLowerCase()

  // Try numeric comparison for dates
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
  const [areaFilter, setAreaFilter] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [sortColumn, setSortColumn] = useState('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const setSearch = useCallback((query: string) => setSearchQuery(query), [])
  const setArea = useCallback((area: string) => setAreaFilter(area), [])
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
    setAreaFilter('')
    setCompanyFilter('')
    setSortColumn('date')
    setSortDirection('desc')
  }, [])

  const filteredJobs = useCallback(
    (jobs: Job[]): Job[] => {
      let result = [...jobs]

      // Status filter
      if (statusFilter !== 'all') {
        result = result.filter((j) => j.status === statusFilter)
      }

      // Search filter
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

      // Area filter
      if (areaFilter) {
        result = result.filter((j) => getJobArea(j) === areaFilter)
      }

      // Company filter
      if (companyFilter) {
        result = result.filter((j) => j.company === companyFilter)
      }

      // Sort
      if (sortColumn) {
        result.sort((a, b) => {
          const aVal = a[sortColumn as keyof Job]
          const bVal = b[sortColumn as keyof Job]
          return compareValues(aVal, bVal, sortDirection)
        })
      }

      return result
    },
    [statusFilter, searchQuery, areaFilter, companyFilter, sortColumn, sortDirection]
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
    areaFilter,
    companyFilter,
    sortColumn,
    sortDirection,
    setStatusFilter,
    setSearch,
    setArea,
    setCompany,
    toggleSort,
    resetFilters,
    filteredJobs,
    uniqueCompanies,
  }
}
