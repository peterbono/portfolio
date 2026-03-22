import { useMemo, lazy, Suspense } from 'react'
import { useJobs } from '../context/JobsContext'
import type { Job, JobStatus } from '../types/job'

/* ------------------------------------------------------------------ */
/*  Recharts lazy loading                                              */
/* ------------------------------------------------------------------ */
const RechartsBarChart = lazy(() =>
  import('recharts').then((m) => ({ default: m.BarChart }))
)

import {
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'

/* ------------------------------------------------------------------ */
/*  Shared constants & helpers                                         */
/* ------------------------------------------------------------------ */
const DARK = {
  bg: '#1a1a1f',
  text: '#a1a1aa',
  textBright: '#e0e0e0',
  grid: '#2a2a35',
  border: '#2a2a35',
  surface: '#131316',
}

const tooltipStyle = {
  contentStyle: {
    background: 'var(--tooltip-bg)',
    border: '1px solid var(--tooltip-border)',
    borderRadius: 6,
    color: 'var(--tooltip-text)',
    fontSize: 12,
  },
  itemStyle: { color: 'var(--tooltip-text)' },
  labelStyle: { color: 'var(--tooltip-label)', marginBottom: 4 },
}

const cardStyle: React.CSSProperties = {
  background: DARK.bg,
  border: `1px solid ${DARK.border}`,
  borderRadius: 12,
  padding: 20,
}

const cardTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: DARK.text,
  marginBottom: 16,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

function ChartLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#71717a' }}>
      Loading chart...
    </div>
  )
}

/** Statuses that indicate progression beyond "submitted" */
const PROGRESSED_STATUSES: Set<JobStatus> = new Set([
  'screening', 'interviewing', 'challenge', 'offer', 'negotiation',
])

/** All statuses representing an actually-sent application */
const APPLIED_STATUSES: Set<JobStatus> = new Set([
  'submitted', 'screening', 'interviewing', 'challenge',
  'offer', 'negotiation', 'rejected', 'withdrawn', 'ghosted',
])

const INTERVIEW_STATUSES: Set<JobStatus> = new Set([
  'interviewing', 'challenge', 'offer', 'negotiation',
])

/** Map a status to a numeric pipeline stage */
function statusToStage(status: JobStatus): number {
  switch (status) {
    case 'submitted': return 1
    case 'screening': return 2
    case 'interviewing': return 3
    case 'challenge': return 4
    case 'offer':
    case 'negotiation': return 5
    case 'rejected': return 1
    case 'withdrawn': return 1
    case 'ghosted': return 1
    default: return 0
  }
}

/** Company HQ lookup for area fallback */
import companyHQ from '../data/company-hq.json'
const COMPANY_HQ: Record<string, string> = companyHQ as Record<string, string>

/** Infer geographic area from job data */
function inferArea(job: Job): 'apac' | 'emea' | 'americas' | 'unknown' {
  if (job.area && (job.area as string) !== '') return job.area as 'apac' | 'emea' | 'americas'
  const loc = (job.location || '').toLowerCase()
  const apacKeywords = [
    'bangkok', 'singapore', 'india', 'mumbai', 'delhi', 'bangalore',
    'tokyo', 'japan', 'korea', 'seoul', 'hong kong', 'manila',
    'philippines', 'thailand', 'vietnam', 'indonesia', 'jakarta',
    'malaysia', 'kuala lumpur', 'australia', 'sydney', 'melbourne',
    'new zealand', 'auckland', 'china', 'shanghai', 'beijing',
    'taiwan', 'taipei', 'apac',
  ]
  const emeaKeywords = [
    'london', 'berlin', 'paris', 'amsterdam', 'dublin', 'europe',
    'european', 'germany', 'france', 'uk', 'united kingdom', 'spain',
    'portugal', 'ireland', 'netherlands', 'sweden', 'denmark', 'norway',
    'finland', 'switzerland', 'austria', 'italy', 'poland', 'czech',
    'israel', 'dubai', 'uae', 'south africa', 'nigeria', 'emea',
  ]
  const americasKeywords = [
    'new york', 'san francisco', 'usa', 'united states', 'canada',
    'toronto', 'vancouver', 'los angeles', 'chicago', 'austin',
    'seattle', 'boston', 'miami', 'denver', 'atlanta', 'brazil',
    'mexico', 'argentina', 'colombia', 'sao paulo', 'bogota',
    'americas',
  ]
  if (apacKeywords.some((kw) => loc.includes(kw))) return 'apac'
  if (emeaKeywords.some((kw) => loc.includes(kw))) return 'emea'
  if (americasKeywords.some((kw) => loc.includes(kw))) return 'americas'
  // Fallback: company HQ lookup
  const hq = COMPANY_HQ[job.company]
  if (hq === 'apac' || hq === 'emea' || hq === 'americas') return hq
  return 'unknown'
}

/** Parse salary string to annual EUR estimate */
function parseSalaryToEUR(salary: string): number | null {
  if (!salary || salary === '—' || salary === '-' || salary.trim() === '') return null
  const s = salary.toLowerCase().replace(/,/g, '').replace(/\s+/g, '')

  // Try to extract numbers
  const rangeMatch = s.match(/(\d+\.?\d*)k?\s*[-–]\s*(\d+\.?\d*)k?/)
  const singleMatch = s.match(/(\d+\.?\d*)k?/)

  let value: number
  if (rangeMatch) {
    let low = parseFloat(rangeMatch[1])
    let high = parseFloat(rangeMatch[2])
    // If both sides have 'k' or the numbers are small enough to be in thousands
    if (s.includes('k') || (low < 500 && high < 500)) {
      if (low < 500) low *= 1000
      if (high < 500) high *= 1000
    }
    value = (low + high) / 2
  } else if (singleMatch) {
    value = parseFloat(singleMatch[1])
    if (s.includes('k') || value < 500) {
      value *= 1000
    }
  } else {
    return null
  }

  if (value < 1000) return null // unreasonable

  // Currency conversion rough estimates
  if (s.includes('$') || s.includes('usd')) value *= 0.92
  else if (s.includes('gbp') || s.includes('£')) value *= 1.16

  // If it looks like monthly (< 15000), annualize
  if (value < 15000) value *= 12

  return Math.round(value)
}

/* ================================================================== */
/*  1. WeeklyCadenceHeatmap                                            */
/* ================================================================== */
export function WeeklyCadenceHeatmap() {
  const { jobs } = useJobs()

  const { grid, dayStats, weekLabels, maxCount } = useMemo(() => {
    const appliedJobs = jobs.filter((j) => j.date && APPLIED_STATUSES.has(j.status))

    if (appliedJobs.length === 0) {
      return { grid: [] as number[][], dayStats: [] as { day: string; rate: number; total: number }[], weekLabels: [] as string[], maxCount: 0 }
    }

    // Determine date range
    const dates = appliedJobs.map((j) => new Date(j.date))
    const minDate = new Date(Math.min(...dates.map((d) => d.getTime())))
    const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())))

    // Align minDate to Monday
    const startDay = minDate.getDay()
    const mondayOffset = startDay === 0 ? -6 : 1 - startDay
    const startMonday = new Date(minDate)
    startMonday.setDate(minDate.getDate() + mondayOffset)
    startMonday.setHours(0, 0, 0, 0)

    // Calculate weeks
    const msPerDay = 86400000
    const totalDays = Math.ceil((maxDate.getTime() - startMonday.getTime()) / msPerDay) + 1
    const numWeeks = Math.ceil(totalDays / 7)

    // Build grid: 7 rows (Mon=0 to Sun=6) x numWeeks columns
    const g: number[][] = Array.from({ length: 7 }, () => Array(numWeeks).fill(0) as number[])

    // Day-of-week stats for "best day" sub-chart
    const dayApps: number[] = Array(7).fill(0) as number[]
    const dayProgressed: number[] = Array(7).fill(0) as number[]

    let maxC = 0
    for (const job of appliedJobs) {
      const d = new Date(job.date)
      const daysSinceStart = Math.floor((d.getTime() - startMonday.getTime()) / msPerDay)
      if (daysSinceStart < 0) continue
      const weekIdx = Math.floor(daysSinceStart / 7)
      const dayIdx = daysSinceStart % 7 // 0=Mon, 6=Sun
      if (weekIdx < numWeeks && dayIdx >= 0 && dayIdx < 7) {
        g[dayIdx][weekIdx]++
        if (g[dayIdx][weekIdx] > maxC) maxC = g[dayIdx][weekIdx]
      }
      // Day of week stats (convert to Mon=0 system)
      const jsDay = d.getDay() // 0=Sun
      const normalDay = jsDay === 0 ? 6 : jsDay - 1 // 0=Mon
      dayApps[normalDay]++
      if (PROGRESSED_STATUSES.has(job.status)) {
        dayProgressed[normalDay]++
      }
    }

    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    const stats = dayNames.map((day, i) => ({
      day,
      rate: dayApps[i] > 0 ? Math.round((dayProgressed[i] / dayApps[i]) * 100) : 0,
      total: dayApps[i],
    }))

    // Week labels (month abbreviation for first week of each month)
    const labels: string[] = []
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    for (let w = 0; w < numWeeks; w++) {
      const weekDate = new Date(startMonday.getTime() + w * 7 * msPerDay)
      if (w === 0 || weekDate.getDate() <= 7) {
        labels.push(months[weekDate.getMonth()])
      } else {
        labels.push('')
      }
    }

    return { grid: g, dayStats: stats, weekLabels: labels, maxCount: maxC }
  }, [jobs])

  const getColor = (count: number): string => {
    if (count === 0) return '#161b22'
    if (maxCount === 0) return '#161b22'
    const ratio = count / maxCount
    if (ratio <= 0.25) return '#0e4429'
    if (ratio <= 0.5) return '#006d32'
    if (ratio <= 0.75) return '#26a641'
    return '#39d353'
  }

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const numWeeks = grid.length > 0 ? grid[0].length : 0

  const bestDayMax = Math.max(...dayStats.map((d) => d.rate), 1)

  return (
    <div style={cardStyle}>
      <h3 style={cardTitleStyle}>Weekly Cadence Heatmap</h3>

      {/* Heatmap */}
      <div style={{ overflowX: 'auto', marginBottom: 24 }}>
        {/* Month labels */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `40px repeat(${numWeeks}, 14px)`,
            gap: 2,
            marginBottom: 2,
          }}
        >
          <div />
          {weekLabels.map((label, i) => (
            <div key={i} style={{ fontSize: 9, color: DARK.text, textAlign: 'center', lineHeight: '14px' }}>
              {label}
            </div>
          ))}
        </div>

        {/* Grid rows */}
        {dayNames.map((dayName, dayIdx) => (
          <div
            key={dayName}
            style={{
              display: 'grid',
              gridTemplateColumns: `40px repeat(${numWeeks}, 14px)`,
              gap: 2,
              marginBottom: 2,
            }}
          >
            <div style={{ fontSize: 10, color: DARK.text, lineHeight: '14px', textAlign: 'right', paddingRight: 6 }}>
              {dayIdx % 2 === 0 ? dayName : ''}
            </div>
            {grid[dayIdx]?.map((count, weekIdx) => (
              <div
                key={weekIdx}
                title={`${count} application${count !== 1 ? 's' : ''}`}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 2,
                  background: getColor(count),
                }}
              />
            )) ?? null}
          </div>
        ))}

        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, marginLeft: 42 }}>
          <span style={{ fontSize: 10, color: DARK.text, marginRight: 4 }}>Less</span>
          {['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'].map((c) => (
            <div key={c} style={{ width: 12, height: 12, borderRadius: 2, background: c }} />
          ))}
          <span style={{ fontSize: 10, color: DARK.text, marginLeft: 4 }}>More</span>
        </div>
      </div>

      {/* Best day to apply bar chart */}
      <h4 style={{ fontSize: 12, fontWeight: 600, color: DARK.text, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Best Day to Apply (Response Rate %)
      </h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {dayStats.map((d) => (
          <div key={d.day} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: DARK.text, width: 30, textAlign: 'right', flexShrink: 0 }}>{d.day}</span>
            <div style={{ flex: 1, height: 18, background: DARK.surface, borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
              <div
                style={{
                  width: `${bestDayMax > 0 ? (d.rate / bestDayMax) * 100 : 0}%`,
                  height: '100%',
                  background: d.rate > 0
                    ? `linear-gradient(90deg, #0e4429, ${d.rate === bestDayMax ? '#39d353' : '#26a641'})`
                    : 'transparent',
                  borderRadius: 4,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <span style={{ fontSize: 11, color: DARK.textBright, width: 55, textAlign: 'right', flexShrink: 0 }}>
              {d.rate}% <span style={{ color: DARK.text, fontSize: 9 }}>({d.total})</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ================================================================== */
/*  2. RoleCategoryPerformance                                         */
/* ================================================================== */
type RoleCategory =
  | 'Product Designer'
  | 'UX/UI Designer'
  | 'Design Lead/Staff/Principal'
  | 'Visual/Motion Designer'
  | 'Design System'
  | 'Other Design'

function categorizeRole(role: string): RoleCategory {
  const r = role.toLowerCase()
  if (r.includes('design system') || r.includes('design ops') || r.includes('designops')) return 'Design System'
  if (r.includes('lead') || r.includes('staff') || r.includes('principal') || r.includes('head of') || r.includes('director') || r.includes('manager')) return 'Design Lead/Staff/Principal'
  if (r.includes('visual') || r.includes('motion') || r.includes('graphic') || r.includes('brand')) return 'Visual/Motion Designer'
  if (r.includes('ux/ui') || r.includes('ui/ux') || r.includes('ux ui') || r.includes('ui ux') || r.includes('ux designer') || r.includes('ui designer')) return 'UX/UI Designer'
  if (r.includes('product design')) return 'Product Designer'
  return 'Other Design'
}

export function RoleCategoryPerformance() {
  const { jobs } = useJobs()

  const data = useMemo(() => {
    const categories: Record<RoleCategory, { total: number; progressed: number }> = {
      'Product Designer': { total: 0, progressed: 0 },
      'UX/UI Designer': { total: 0, progressed: 0 },
      'Design Lead/Staff/Principal': { total: 0, progressed: 0 },
      'Visual/Motion Designer': { total: 0, progressed: 0 },
      'Design System': { total: 0, progressed: 0 },
      'Other Design': { total: 0, progressed: 0 },
    }

    for (const job of jobs) {
      if (!APPLIED_STATUSES.has(job.status)) continue
      const cat = categorizeRole(job.role)
      categories[cat].total++
      if (PROGRESSED_STATUSES.has(job.status)) {
        categories[cat].progressed++
      }
    }

    return (Object.entries(categories) as [RoleCategory, { total: number; progressed: number }][])
      .filter(([, v]) => v.total > 0)
      .map(([name, v]) => ({
        name,
        total: v.total,
        conversionRate: Math.round((v.progressed / v.total) * 100),
        progressed: v.progressed,
      }))
      .sort((a, b) => b.conversionRate - a.conversionRate)
  }, [jobs])

  const maxTotal = Math.max(...data.map((d) => d.total), 1)

  const categoryColors: Record<RoleCategory, string> = {
    'Product Designer': '#34d399',
    'UX/UI Designer': '#60a5fa',
    'Design Lead/Staff/Principal': '#fb923c',
    'Visual/Motion Designer': '#c084fc',
    'Design System': '#38bdf8',
    'Other Design': '#71717a',
  }

  return (
    <div style={cardStyle}>
      <h3 style={cardTitleStyle}>Role Category Performance</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {data.map((d) => (
          <div key={d.name}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: DARK.textBright, fontWeight: 500 }}>{d.name}</span>
              <span style={{ fontSize: 11, color: DARK.text }}>
                {d.total} apps | <span style={{ color: d.conversionRate > 0 ? '#34d399' : DARK.text, fontWeight: 600 }}>{d.conversionRate}%</span> conversion
              </span>
            </div>
            <div style={{ position: 'relative', height: 22, background: DARK.surface, borderRadius: 4, overflow: 'hidden' }}>
              {/* Total bar */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: `${(d.total / maxTotal) * 100}%`,
                  height: '100%',
                  background: categoryColors[d.name] || '#71717a',
                  opacity: 0.25,
                  borderRadius: 4,
                }}
              />
              {/* Conversion overlay */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: `${(d.progressed / maxTotal) * 100}%`,
                  height: '100%',
                  background: categoryColors[d.name] || '#71717a',
                  borderRadius: 4,
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: DARK.text }}>
          <div style={{ width: 12, height: 12, borderRadius: 2, background: '#60a5fa', opacity: 0.25 }} />
          Total applications
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: DARK.text }}>
          <div style={{ width: 12, height: 12, borderRadius: 2, background: '#60a5fa' }} />
          Progressed (screening+)
        </div>
      </div>
    </div>
  )
}

/* ================================================================== */
/*  3. GeographicPerformance                                           */
/* ================================================================== */
interface RegionStats {
  total: number
  responded: number
  interviewed: number
  totalDaysToResponse: number
  responseCount: number
}

export function GeographicPerformance() {
  const { jobs } = useJobs()

  const regions = useMemo(() => {
    const stats: Record<string, RegionStats> = {
      apac: { total: 0, responded: 0, interviewed: 0, totalDaysToResponse: 0, responseCount: 0 },
      emea: { total: 0, responded: 0, interviewed: 0, totalDaysToResponse: 0, responseCount: 0 },
      americas: { total: 0, responded: 0, interviewed: 0, totalDaysToResponse: 0, responseCount: 0 },
      unknown: { total: 0, responded: 0, interviewed: 0, totalDaysToResponse: 0, responseCount: 0 },
    }

    for (const job of jobs) {
      if (!APPLIED_STATUSES.has(job.status)) continue
      const area = inferArea(job)
      const region = stats[area]
      if (!region) continue

      region.total++

      if (PROGRESSED_STATUSES.has(job.status) || job.status === 'rejected' || job.status === 'withdrawn') {
        region.responded++
        // Estimate days to response
        if (job.date) {
          const appDate = new Date(job.date)
          let responseDate: Date | null = null
          if (job.lastContactDate) {
            responseDate = new Date(job.lastContactDate)
          } else if (job.events && job.events.length > 0) {
            // Use earliest event date
            const sorted = [...job.events].sort((a, b) => a.date.localeCompare(b.date))
            responseDate = new Date(sorted[0].date)
          }
          if (responseDate) {
            const days = Math.max(0, Math.floor((responseDate.getTime() - appDate.getTime()) / 86400000))
            if (days <= 180) { // exclude outliers
              region.totalDaysToResponse += days
              region.responseCount++
            }
          }
        }
      }

      if (INTERVIEW_STATUSES.has(job.status)) {
        region.interviewed++
      }
    }

    return stats
  }, [jobs])

  const panels: { key: string; label: string; color: string; borderColor: string }[] = [
    { key: 'apac', label: 'APAC', color: '#34d399', borderColor: '#064e3b' },
    { key: 'emea', label: 'EMEA', color: '#60a5fa', borderColor: '#1e3a5f' },
    { key: 'americas', label: 'Americas', color: '#fb923c', borderColor: '#422006' },
    { key: 'unknown', label: 'Unknown', color: '#71717a', borderColor: '#2a2a35' },
  ]

  const grandTotal = panels.reduce((acc, p) => acc + (regions[p.key]?.total || 0), 0)

  return (
    <div style={cardStyle}>
      <h3 style={cardTitleStyle}>Geographic Performance</h3>
      <p style={{ color: DARK.text, fontSize: 12, margin: '0 0 12px' }}>
        {grandTotal} classified applications
        {(() => {
          const totalApplied = jobs.filter(j => APPLIED_STATUSES.has(j.status)).length
          const unknown = totalApplied - grandTotal
          return unknown > 0 ? ` (${unknown} unclassified excluded)` : ''
        })()}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {panels.map(({ key, label, color, borderColor }) => {
          const r = regions[key]
          if (!r || r.total === 0) return null
          const responseRate = r.total > 0 ? Math.round((r.responded / r.total) * 100) : 0
          const interviewRate = r.total > 0 ? Math.round((r.interviewed / r.total) * 100) : 0
          const avgDays = r.responseCount > 0 ? Math.round(r.totalDaysToResponse / r.responseCount) : 0
          const pctOfTotal = grandTotal > 0 ? Math.round((r.total / grandTotal) * 100) : 0

          return (
            <div
              key={key}
              style={{
                background: DARK.surface,
                borderRadius: 8,
                padding: 16,
                borderLeft: `3px solid ${color}`,
                borderTop: `1px solid ${borderColor}`,
                borderRight: `1px solid ${borderColor}`,
                borderBottom: `1px solid ${borderColor}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color }}>{label}</span>
                <span style={{ fontSize: 12, color: DARK.text }}>{pctOfTotal}%</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
                <GeoStat label="Apps" value={r.total.toString()} />
                <GeoStat label="Response" value={`${responseRate}%`} highlight={responseRate > 0} />
                <GeoStat label="Interview" value={`${interviewRate}%`} highlight={interviewRate > 0} />
                <GeoStat label="Avg days" value={r.responseCount > 0 ? `${avgDays}d` : '—'} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GeoStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: DARK.text, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: highlight ? '#34d399' : DARK.textBright }}>{value}</div>
    </div>
  )
}

/* ================================================================== */
/*  4. RejectionTimingAnalysis                                         */
/* ================================================================== */
interface RejectionBucket {
  range: string
  count: number
  color: string
  label: string
}

export function RejectionTimingAnalysis() {
  const { jobs } = useJobs()

  const data = useMemo(() => {
    const stages = [
      { label: 'Auto-reject', desc: '< 3 days', icon: '\uD83E\uDD16', min: 0, max: 3, count: 0, color: '#ef4444' },
      { label: 'Quick reject', desc: '3-14 days', icon: '\uD83D\uDCE7', min: 3, max: 14, count: 0, color: '#f97316' },
      { label: 'Slow reject', desc: '14-30 days', icon: '\uD83D\uDC0C', min: 14, max: 30, count: 0, color: '#eab308' },
      { label: 'Ghost reject', desc: '30+ days', icon: '\uD83D\uDC7B', min: 30, max: 999, count: 0, color: '#71717a' },
    ]

    let total = 0

    for (const job of jobs) {
      if (job.status !== 'rejected' || !job.date) continue

      const appDate = new Date(job.date)
      let rejDate: Date | null = null

      if (job.events && job.events.length > 0) {
        const sorted = [...job.events].sort((a, b) => b.date.localeCompare(a.date))
        rejDate = new Date(sorted[0].date)
      } else if (job.lastContactDate) {
        rejDate = new Date(job.lastContactDate)
      } else {
        rejDate = new Date(appDate.getTime() + 14 * 86400000)
      }

      const days = Math.max(0, Math.floor((rejDate.getTime() - appDate.getTime()) / 86400000))
      total++
      const stage = stages.find(s => days >= s.min && days < s.max) || stages[3]
      stage.count++
    }

    return { stages, total }
  }, [jobs])

  const maxCount = Math.max(...data.stages.map(s => s.count), 1)

  return (
    <div style={cardStyle}>
      <h3 style={cardTitleStyle}>Where You Get Rejected</h3>
      <p style={{ color: DARK.text, fontSize: 12, margin: '0 0 16px' }}>
        {data.total} rejections tracked
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {data.stages.map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 20, width: 28, textAlign: 'center' }}>{s.icon}</div>
            <div style={{ width: 130, flexShrink: 0 }}>
              <div style={{ fontSize: 13, color: '#e0e0e0', fontWeight: 500 }}>{s.label}</div>
              <div style={{ fontSize: 10, color: '#71717a' }}>{s.desc}</div>
            </div>
            <div style={{ flex: 1, height: 28, background: '#1a1a1f', borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
              <div style={{
                height: '100%', width: `${(s.count / maxCount) * 100}%`,
                background: s.color, borderRadius: 6, opacity: 0.85,
                transition: 'width 0.5s ease',
              }} />
            </div>
            <div style={{ width: 50, textAlign: 'right' }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.count}</span>
              {data.total > 0 && (
                <span style={{ fontSize: 10, color: '#71717a', marginLeft: 4 }}>
                  {Math.round(s.count / data.total * 100)}%
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ================================================================== */
/*  5. SalaryVsOutcome                                                 */
/* ================================================================== */
interface SalaryBracketData {
  bracket: string
  avgStage: number
  count: number
  stageLabel: string
}

const STAGE_LABELS: Record<number, string> = {
  1: 'Submitted',
  2: 'Screening',
  3: 'Interviewing',
  4: 'Challenge',
  5: 'Offer',
}

function stageToLabel(stage: number): string {
  const rounded = Math.round(stage)
  return STAGE_LABELS[rounded] || STAGE_LABELS[Math.min(rounded, 5)] || 'Submitted'
}

export function SalaryVsOutcome() {
  const { jobs } = useJobs()

  const data = useMemo(() => {
    const brackets: { min: number; max: number; label: string }[] = [
      { min: 0, max: 50000, label: '0-50k' },
      { min: 50000, max: 80000, label: '50-80k' },
      { min: 80000, max: 120000, label: '80-120k' },
      { min: 120000, max: Infinity, label: '120k+' },
    ]

    const bracketData: Record<string, { totalStage: number; count: number }> = {}
    for (const b of brackets) {
      bracketData[b.label] = { totalStage: 0, count: 0 }
    }

    for (const job of jobs) {
      if (!APPLIED_STATUSES.has(job.status) && job.status !== 'manual' && job.status !== 'saved') continue
      const salary = parseSalaryToEUR(job.salary)
      if (salary === null) continue

      const stage = statusToStage(job.status)
      if (stage === 0) continue

      for (const b of brackets) {
        if (salary >= b.min && salary < b.max) {
          bracketData[b.label].totalStage += stage
          bracketData[b.label].count++
          break
        }
      }
    }

    return brackets.map((b) => {
      const bd = bracketData[b.label]
      const avg = bd.count > 0 ? parseFloat((bd.totalStage / bd.count).toFixed(2)) : 0
      return {
        bracket: b.label,
        avgStage: avg,
        count: bd.count,
        stageLabel: bd.count > 0 ? stageToLabel(avg) : 'No data',
      } satisfies SalaryBracketData
    })
  }, [jobs])

  const bracketColors = ['#71717a', '#60a5fa', '#34d399', '#fbbf24']

  return (
    <div style={cardStyle}>
      <h3 style={cardTitleStyle}>Salary vs Outcome</h3>
      <div style={{ width: '100%', height: 280 }}>
        <Suspense fallback={<ChartLoader />}>
          <ResponsiveContainer width="100%" height="100%">
            <RechartsBarChart data={data} margin={{ left: 8, right: 24, top: 16, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={DARK.grid} vertical={false} />
              <XAxis
                dataKey="bracket"
                tick={{ fill: DARK.text, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                label={{ value: 'Annual Salary (EUR)', position: 'insideBottom', offset: -2, style: { fill: DARK.text, fontSize: 10 } }}
              />
              <YAxis
                domain={[0, 5]}
                ticks={[1, 2, 3, 4, 5]}
                tickFormatter={(v: number) => STAGE_LABELS[v] || ''}
                tick={{ fill: DARK.text, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={80}
              />
              <Tooltip
                {...tooltipStyle}
                formatter={(value: number, _name: string, props: { payload?: SalaryBracketData }) => [
                  `Avg stage: ${value.toFixed(2)} (${props.payload?.stageLabel ?? ''})`,
                  `${props.payload?.count ?? 0} jobs`,
                ]}
                labelFormatter={(label: string) => `Salary: ${label} EUR`}
              />
              <Bar dataKey="avgStage" radius={[4, 4, 0, 0]} barSize={48} name="Avg Stage">
                {data.map((_, i) => (
                  <Cell key={i} fill={bracketColors[i % bracketColors.length]} />
                ))}
              </Bar>
            </RechartsBarChart>
          </ResponsiveContainer>
        </Suspense>
      </div>
      {/* Counts below */}
      <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 12 }}>
        {data.map((d, i) => (
          <div key={d.bracket} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: bracketColors[i] }}>{d.count}</div>
            <div style={{ fontSize: 9, color: DARK.text, textTransform: 'uppercase' }}>jobs</div>
          </div>
        ))}
      </div>
    </div>
  )
}
