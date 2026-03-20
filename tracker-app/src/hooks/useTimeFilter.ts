import { useMemo } from 'react'
import { useUI, type TimeRange } from '../context/UIContext'
import type { Job } from '../types/job'

function getDateThreshold(range: TimeRange): Date | null {
  if (range === 'all') return null
  const now = new Date()
  switch (range) {
    case 'today': {
      const d = new Date(now)
      d.setHours(0, 0, 0, 0)
      return d
    }
    case 'week': {
      const d = new Date(now)
      d.setDate(d.getDate() - d.getDay())
      d.setHours(0, 0, 0, 0)
      return d
    }
    case 'month': {
      return new Date(now.getFullYear(), now.getMonth(), 1)
    }
    case '3months': {
      return new Date(now.getFullYear(), now.getMonth() - 3, 1)
    }
    default:
      return null
  }
}

export function useTimeFilteredJobs(jobs: Job[]): Job[] {
  const { timeRange } = useUI()

  return useMemo(() => {
    const threshold = getDateThreshold(timeRange)
    if (!threshold) return jobs
    const thresholdStr = threshold.toISOString().split('T')[0]
    return jobs.filter(j => j.date >= thresholdStr)
  }, [jobs, timeRange])
}
