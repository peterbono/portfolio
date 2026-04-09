import { useMemo, useState, lazy, Suspense } from 'react'
import { useJobs } from '../context/JobsContext'
import { STATUS_CONFIG, type JobStatus } from '../types/job'
import { computeIntelligenceSummary } from '../utils/intelligence'

const RechartsBarChart = lazy(() =>
  import('recharts').then((m) => ({ default: m.BarChart }))
)
const RechartsAreaChart = lazy(() =>
  import('recharts').then((m) => ({ default: m.AreaChart }))
)

// We need the sub-components synchronously once the chunk loads, so import
// them eagerly alongside the lazy charts via a single recharts import.
import {
  Bar,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
} from 'recharts'

/* ------------------------------------------------------------------ */
/*  Tooltip styling                                                    */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/*  StatusDistribution — horizontal bar chart                          */
/* ------------------------------------------------------------------ */
function StatusDistribution() {
  const { counts } = useJobs()

  const data = useMemo(() => {
    return (Object.entries(counts) as [JobStatus, number][])
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => ({
        name: STATUS_CONFIG[status].label,
        count,
        color: STATUS_CONFIG[status].color,
      }))
  }, [counts])

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>Status Distribution</h3>
      <div style={{ width: '100%', height: 320 }}>
        <Suspense fallback={<ChartLoader />}>
          <ResponsiveContainer width="100%" height="100%">
            <RechartsBarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a35" horizontal={false} />
              <XAxis type="number" tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fill: '#a1a1aa', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={90}
              />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={18}>
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </RechartsBarChart>
          </ResponsiveContainer>
        </Suspense>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  ApplicationsOverTime — area chart by week                          */
/* ------------------------------------------------------------------ */
function ApplicationsOverTime() {
  const { jobs } = useJobs()

  const data = useMemo(() => {
    const submitted = jobs
      .filter((j) => j.date)
      .sort((a, b) => a.date.localeCompare(b.date))

    if (!submitted.length) return []

    // Group by ISO week
    const weekMap = new Map<string, number>()
    for (const job of submitted) {
      const d = new Date(job.date)
      // Get Monday of the week
      const day = d.getDay()
      const diff = d.getDate() - day + (day === 0 ? -6 : 1)
      const monday = new Date(d.setDate(diff))
      const key = monday.toISOString().slice(0, 10)
      weekMap.set(key, (weekMap.get(key) ?? 0) + 1)
    }

    // Cumulative
    const weeks = [...weekMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    let cumulative = 0
    return weeks.map(([week, count]) => {
      cumulative += count
      return {
        week: week.slice(5), // MM-DD format
        count,
        cumulative,
      }
    })
  }, [jobs])

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>Applications Over Time</h3>
      <div style={{ width: '100%', height: 280 }}>
        <Suspense fallback={<ChartLoader />}>
          <ResponsiveContainer width="100%" height="100%">
            <RechartsAreaChart data={data} margin={{ left: 0, right: 24, top: 8, bottom: 8 }}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a35" />
              <XAxis
                dataKey="week"
                tick={{ fill: '#a1a1aa', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle} />
              <Area
                type="monotone"
                dataKey="cumulative"
                stroke="#34d399"
                strokeWidth={2}
                fill="url(#areaGrad)"
                name="Total Applications"
              />
            </RechartsAreaChart>
          </ResponsiveContainer>
        </Suspense>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  ResponseRate — stat cards                                          */
/* ------------------------------------------------------------------ */
function ResponseRate() {
  const { jobs } = useJobs()

  const stats = useMemo(() => {
    const applied = ['submitted','interviewing','challenge','offer','rejected']
    const totalApplied = jobs.filter(j => applied.includes(j.status)).length

    const gotResponse = jobs.filter(
      j => ['interviewing','offer','rejected','challenge'].includes(j.status)
    ).length

    const rejected = jobs.filter(j => j.status === 'rejected').length

    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const noResponse = jobs.filter(j => {
      if (j.status !== 'submitted') return false
      if (j.events && j.events.length > 0) return false
      return new Date(j.date) < sevenDaysAgo
    }).length

    const responseRate = totalApplied > 0 ? ((gotResponse / totalApplied) * 100).toFixed(1) : '0.0'
    const rejectionRate = totalApplied > 0 ? ((rejected / totalApplied) * 100).toFixed(1) : '0.0'

    return { totalApplied, gotResponse, noResponse, rejected, responseRate, rejectionRate }
  }, [jobs])

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>Response Rate</h3>
      <div style={styles.statsGrid}>
        <StatCard label="Total Applied" value={stats.totalApplied} color="#34d399" />
        <StatCard label="Got Response" value={stats.gotResponse} color="#60a5fa" />
        <StatCard label="Rejected" value={stats.rejected} color="#a855f7" />
        <StatCard label="No Response (7d+)" value={stats.noResponse} color="#52525b" />
        <StatCard label="Response Rate" value={`${stats.responseRate}%`} color="#fbbf24" />
        <StatCard label="Rejection Rate" value={`${stats.rejectionRate}%`} color="#ef4444" />
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={styles.statCard}>
      <span style={{ ...styles.statValue, color }}>{value}</span>
      <span style={styles.statLabel}>{label}</span>
    </div>
  )
}

function ChartLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#71717a' }}>
      Loading chart...
    </div>
  )
}

function WorkModeDistribution() {
  const { jobs } = useJobs()
  const [view, setView] = useState<'mode' | 'country'>('mode')
  const [expandedMode, setExpandedMode] = useState<string | null>(null)

  const data = useMemo(() => {
    const applied = jobs.filter(j => ['submitted','interviewing','challenge','offer','rejected'].includes(j.status))

    type ModeKey = 'remote' | 'onsite' | 'hybrid'
    const modeJobs: Record<ModeKey, { company: string; location: string; area: string }[]> = { remote: [], onsite: [], hybrid: [] }
    const countries: Record<string, number> = {}

    for (const j of applied) {
      const loc = (j.location || '').toLowerCase()
      let mode: ModeKey = 'onsite'
      if (loc.includes('remote') || loc.includes('à distance')) mode = 'remote'
      else if (loc.includes('hybrid') || loc.includes('hybride')) mode = 'hybrid'

      const area = (j as unknown as Record<string, string>).area || ''
      modeJobs[mode].push({ company: j.company, location: j.location || '', area: area || '—' })

      const parts = (j.location || '').split(/[·,()]/).map(s => s.trim()).filter(Boolean)
      const country = parts[parts.length - 1]?.replace(/remote|hybrid|on-site|à distance/gi, '').trim() || 'Unknown'
      if (country && country.length > 1) countries[country] = (countries[country] || 0) + 1
    }

    const total = applied.length
    const modeData = [
      { key: 'remote' as ModeKey, label: 'Remote', count: modeJobs.remote.length, pct: total ? Math.round(modeJobs.remote.length / total * 100) : 0, color: '#34d399' },
      { key: 'onsite' as ModeKey, label: 'On-site', count: modeJobs.onsite.length, pct: total ? Math.round(modeJobs.onsite.length / total * 100) : 0, color: '#fb923c' },
      { key: 'hybrid' as ModeKey, label: 'Hybrid', count: modeJobs.hybrid.length, pct: total ? Math.round(modeJobs.hybrid.length / total * 100) : 0, color: '#60a5fa' },
    ]
    const countryData = Object.entries(countries).sort((a, b) => b[1] - a[1])

    return { modeData, modeJobs, countryData, total }
  }, [jobs])

  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>Work Mode Distribution</h3>
        <button
          onClick={() => { setView(view === 'mode' ? 'country' : 'mode'); setExpandedMode(null) }}
          style={{ background: 'transparent', border: '1px solid #2a2a35', borderRadius: 6, color: '#a1a1aa', fontSize: 10, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {view === 'mode' ? 'By Country' : 'By Mode'}
        </button>
      </div>

      {view === 'mode' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.modeData.map(m => {
            const isExpanded = expandedMode === m.key
            const companyList = data.modeJobs[m.key]
            return (
              <div key={m.label}>
                <div
                  onClick={() => setExpandedMode(isExpanded ? null : m.key)}
                  style={{ cursor: 'pointer', padding: '6px 0' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: '#e0e0e0', fontWeight: 500 }}>
                      {isExpanded ? '▾' : '▸'} {m.label}
                    </span>
                    <span style={{ fontSize: 13, color: m.color, fontWeight: 700 }}>{m.count} <span style={{ fontSize: 10, fontWeight: 400, color: '#71717a' }}>({m.pct}%)</span></span>
                  </div>
                  <div style={{ height: 8, background: '#1a1a1f', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${m.pct}%`, background: m.color, borderRadius: 4, transition: 'width 0.5s' }} />
                  </div>
                </div>
                {isExpanded && (
                  <div style={{ maxHeight: 250, overflowY: 'auto', marginTop: 6, background: '#0f0f14', borderRadius: 6, border: `1px solid ${m.color}22`, padding: 8 }}>
                    {companyList.map((c, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #1a1a1f', gap: 8 }}>
                        <span style={{ fontSize: 11, color: '#e0e0e0' }}>{c.company}</span>
                        <span style={{ fontSize: 10, color: '#71717a', flexShrink: 0 }}>{c.area !== '—' ? c.area.toUpperCase() : c.location.substring(0, 20)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          {data.countryData.map(([country, count]) => (
            <div key={country} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #1a1a1f' }}>
              <span style={{ fontSize: 12, color: '#e0e0e0' }}>{country}</span>
              <span style={{ fontSize: 12, color: '#34d399', fontWeight: 600 }}>{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TopRejectors() {
  const { jobs } = useJobs()
  const [showAllAts, setShowAllAts] = useState(false)
  const [showAllCompanies, setShowAllCompanies] = useState(false)

  const data = useMemo(() => {
    const rejected = jobs.filter(j => j.status === 'rejected')
    const atsCount: Record<string, number> = {}
    const roleCount: Record<string, number> = {}
    const companyList: { company: string; role: string; ats: string }[] = []

    const ATS_NORMALIZE: Record<string, string> = {
      'linkedin': 'Easy Apply LinkedIn', 'linkedin ea': 'Easy Apply LinkedIn', 'easy apply': 'Easy Apply LinkedIn',
      'greenhouse (embedded)': 'Greenhouse', 'custom (greenhouse)': 'Greenhouse',
      'lever eu': 'Lever', 'ashby hq': 'Ashby', 'breezy hr': 'Breezy HR', 'breezy': 'Breezy HR',
      'careers-page.com': 'Manatal', 'smartrecruiters (own)': 'SmartRecruiters',
    }
    const ATS_SKIP = new Set(['soumise', 'à soumettre', 'a soumettre', 'unknown', 'manual', 'custom', 'email', 'direct', '—', '', 'trop long', 'skip (us only)', 'pending', 'manual submit', 'no ats'])
    for (const j of rejected) {
      const raw = (j.ats || '').trim().toLowerCase()
      if (ATS_SKIP.has(raw)) continue
      const ats = ATS_NORMALIZE[raw] || j.ats?.trim()
      if (!ats) continue
      atsCount[ats] = (atsCount[ats] || 0) + 1
      const r = j.role.toLowerCase()
      const cat = r.includes('senior') ? 'Senior' : r.includes('lead') || r.includes('staff') || r.includes('principal') ? 'Lead+' : r.includes('junior') || r.includes('intern') ? 'Junior' : 'Mid-level'
      roleCount[cat] = (roleCount[cat] || 0) + 1
      companyList.push({ company: j.company, role: j.role, ats })
    }

    const allAts = Object.entries(atsCount).sort((a, b) => b[1] - a[1])
    const roles = Object.entries(roleCount).sort((a, b) => b[1] - a[1])

    return { total: rejected.length, allAts, roles, companyList }
  }, [jobs])

  const visibleAts = showAllAts ? data.allAts : data.allAts.slice(0, 5)
  const visibleCompanies = showAllCompanies ? data.companyList : data.companyList.slice(0, 8)

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>Rejection Breakdown</h3>
      <p style={{ color: '#a1a1aa', fontSize: 12, margin: '0 0 16px' }}>{data.total} total rejections</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* By ATS */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h4 style={{ fontSize: 11, color: '#71717a', margin: 0, textTransform: 'uppercase', letterSpacing: 1 }}>By ATS</h4>
            {data.allAts.length > 5 && (
              <button onClick={() => setShowAllAts(!showAllAts)} style={{ background: 'none', border: 'none', color: '#a1a1aa', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
                {showAllAts ? 'Top 5' : `All ${data.allAts.length}`}
              </button>
            )}
          </div>
          <div style={{ maxHeight: showAllAts ? 300 : undefined, overflowY: showAllAts ? 'auto' : undefined }}>
            {visibleAts.map(([ats, count]) => (
              <div key={ats} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #1a1a1f' }}>
                <span style={{ fontSize: 12, color: '#e0e0e0' }}>{ats}</span>
                <span style={{ fontSize: 12, color: '#a855f7', fontWeight: 600 }}>{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* By seniority */}
        <div>
          <h4 style={{ fontSize: 11, color: '#71717a', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>By Seniority</h4>
          {data.roles.map(([role, count]) => (
            <div key={role} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #1a1a1f' }}>
              <span style={{ fontSize: 12, color: '#e0e0e0' }}>{role}</span>
              <span style={{ fontSize: 12, color: '#a855f7', fontWeight: 600 }}>{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Company list */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h4 style={{ fontSize: 11, color: '#71717a', margin: 0, textTransform: 'uppercase', letterSpacing: 1 }}>Rejected Companies</h4>
          {data.companyList.length > 8 && (
            <button onClick={() => setShowAllCompanies(!showAllCompanies)} style={{ background: 'none', border: 'none', color: '#a1a1aa', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
              {showAllCompanies ? 'Show less' : `All ${data.companyList.length}`}
            </button>
          )}
        </div>
        <div style={{ maxHeight: showAllCompanies ? 300 : undefined, overflowY: showAllCompanies ? 'auto' : undefined }}>
          {visibleCompanies.map((j, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #1a1a1f', gap: 8 }}>
              <span style={{ fontSize: 12, color: '#e0e0e0', fontWeight: 500 }}>{j.company}</span>
              <span style={{ fontSize: 10, color: '#71717a', flexShrink: 0 }}>{j.ats}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  IntelligenceCards — 4 KPI cards at the top                         */
/* ------------------------------------------------------------------ */
function IntelligenceCards() {
  const { allJobs } = useJobs()

  const intel = useMemo(() => computeIntelligenceSummary(allJobs), [allJobs])

  // Ghost rate display
  const ghostPct = Math.round(intel.ghostRate * 100)
  const submittedCount = allJobs.length
  const ghostColor = ghostPct > 30 ? '#fb923c' : ghostPct < 15 ? '#34d399' : '#fbbf24'

  // Completeness score (formerly "Avg Quality")
  const avgQ = intel.avgQualityScore
  const qualityColor = avgQ > 70 ? '#34d399' : avgQ >= 50 ? '#fbbf24' : '#f43f5e'

  // Response rate
  const responseStatuses = ['interviewing', 'challenge', 'offer', 'rejected']
  const gotResponse = allJobs.filter(j => responseStatuses.includes(j.status)).length
  const responseRate = submittedCount > 0 ? Math.round((gotResponse / submittedCount) * 100) : 0
  const responseColor = responseRate > 20 ? '#34d399' : responseRate >= 10 ? '#fbbf24' : '#f43f5e'

  return (
    <div style={intelStyles.row}>
      {/* Ghost Rate */}
      <div style={intelStyles.card}>
        <span style={{ ...intelStyles.value, color: ghostColor }}>{ghostPct}%</span>
        <span style={intelStyles.label}>Ghost Rate</span>
        <span style={intelStyles.sub}>{intel.totalGhosts} of {submittedCount} applications</span>
      </div>

      {/* Response Rate */}
      <div style={intelStyles.card}>
        <span style={{ ...intelStyles.value, color: responseColor }}>{responseRate}%</span>
        <span style={intelStyles.label}>Response Rate</span>
        <span style={intelStyles.sub}>{gotResponse} of {submittedCount} got a reply</span>
      </div>

      {/* Completeness */}
      <div style={intelStyles.card}>
        <span style={{ ...intelStyles.value, color: qualityColor }}>{avgQ}</span>
        <span style={intelStyles.label}>Completeness</span>
        <span style={intelStyles.sub}>out of 100</span>
      </div>

      {/* Total Applied */}
      <div style={intelStyles.card}>
        <span style={{ ...intelStyles.value, color: '#a78bfa' }}>{submittedCount}</span>
        <span style={intelStyles.label}>Total Applied</span>
        <span style={intelStyles.sub}>across all channels</span>
      </div>
    </div>
  )
}

const intelStyles: Record<string, React.CSSProperties> = {
  row: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 16,
    marginBottom: 24,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '24px 16px',
    gap: 6,
  },
  value: {
    fontSize: 32,
    fontWeight: 700,
    lineHeight: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginTop: 4,
  },
  sub: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
  },
}

/* ------------------------------------------------------------------ */
/*  AnalyticsView                                                      */
/* ------------------------------------------------------------------ */
/** Inner analytics content */
export function AnalyticsContent() {
  return (
    <>
      <IntelligenceCards />
      <div style={styles.grid}>
        <ResponseRate />
        <StatusDistribution />
        <ApplicationsOverTime />
        <TopRejectors />
      </div>
    </>
  )
}

export function AnalyticsView() {
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Analytics</h1>
        <p style={styles.subtitle}>Visual breakdown of your job search progress</p>
      </div>
      <AnalyticsContent />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */
const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    overflow: 'auto',
    padding: 24,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--text-primary)',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
    gap: 16,
  },
  card: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: 20,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: 16,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 12,
  },
  statCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: '20px 12px',
    gap: 6,
  },
  statValue: {
    fontSize: 28,
    fontWeight: 700,
    lineHeight: 1,
  },
  statLabel: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
}
