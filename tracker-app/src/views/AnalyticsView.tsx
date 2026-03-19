import { useMemo, lazy, Suspense } from 'react'
import { useJobs } from '../context/JobsContext'
import { STATUS_CONFIG, type JobStatus } from '../types/job'

const RechartsBarChart = lazy(() =>
  import('recharts').then((m) => ({ default: m.BarChart }))
)
const RechartsAreaChart = lazy(() =>
  import('recharts').then((m) => ({ default: m.AreaChart }))
)
const RechartsPieChart = lazy(() =>
  import('recharts').then((m) => ({ default: m.PieChart }))
)

// We need the sub-components synchronously once the chunk loads, so import
// them eagerly alongside the lazy charts via a single recharts import.
import {
  Bar,
  Area,
  Pie,
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
    background: '#1a1a1f',
    border: '1px solid #2a2a35',
    borderRadius: 6,
    color: '#e0e0e0',
    fontSize: 12,
  },
  itemStyle: { color: '#e0e0e0' },
  labelStyle: { color: '#a1a1aa', marginBottom: 4 },
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
/*  TopATSPlatforms — pie chart                                        */
/* ------------------------------------------------------------------ */
const ATS_COLORS = [
  '#34d399', '#60a5fa', '#fb923c', '#a855f7', '#f43f5e',
  '#38bdf8', '#fbbf24', '#c084fc', '#4ade80', '#818cf8',
]

function TopATSPlatforms() {
  const { jobs } = useJobs()

  const data = useMemo(() => {
    // Normalize ATS names and exclude non-ATS values
    const EXCLUDE = new Set([
      'unknown', 'soumise', 'à soumettre', 'a soumettre', 'manual', 'custom',
      'email', 'direct', '—', '', 'recruiter', 'aggregator', 'various',
      'skip (us only)', 'trop long', 'external', 'custom (remote.com)',
      'wwr (paywall)', 'buscojobs',
    ])
    const NORMALIZE: Record<string, string> = {
      'linkedin ea': 'Easy Apply',
      'easy apply': 'Easy Apply',
      'linkedin easy apply': 'Easy Apply',
      'linkedin easy apply (workable)': 'Workable',
      'linkedin': 'LinkedIn',
      'greenhouse': 'Greenhouse',
      'greenhouse (embedded)': 'Greenhouse',
      'custom (greenhouse)': 'Greenhouse',
      'lever': 'Lever',
      'lever eu': 'Lever',
      'ashby': 'Ashby',
      'ashby hq': 'Ashby',
      'workable': 'Workable',
      'teamtailor': 'Teamtailor',
      'breezy hr': 'Breezy HR',
      'breezy': 'Breezy HR',
      'smartrecruiters': 'SmartRecruiters',
      'smartrecruiters (own)': 'SmartRecruiters',
      'recruitee': 'Recruitee',
      'careers-page.com': 'Manatal',
      'manatal': 'Manatal',
      'workday': 'Workday',
      'indeed': 'Indeed',
      'glassdoor': 'Indeed',
      'dribbble': 'Dribbble',
      'netflix custom': 'Netflix',
      'jazzhr': 'JazzHR',
      'authenticjobs': 'AuthenticJobs',
      'deel_careers': 'Deel Careers',
      'wellfound': 'Wellfound',
      'jobvite': 'Jobvite',
      'oracle hcm': 'Oracle HCM',
      'rippling': 'Rippling',
      'gupy': 'Gupy',
      'bamboohr': 'BambooHR',
      'notion form': 'Notion Form',
      'notion forms': 'Notion Form',
      'canonical ats': 'Canonical',
      'pinpoint hq': 'Pinpoint',
      'gem': 'Gem',
    }
    const atsMap = new Map<string, number>()
    for (const job of jobs) {
      if (!job.ats) continue
      const raw = job.ats.trim().toLowerCase()
      if (EXCLUDE.has(raw)) continue
      const name = NORMALIZE[raw] || job.ats.trim()
      atsMap.set(name, (atsMap.get(name) ?? 0) + 1)
    }
    return [...atsMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }))
  }, [jobs])

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>Top ATS Platforms</h3>
      <div style={{ width: '100%', height: 280 }}>
        <Suspense fallback={<ChartLoader />}>
          <ResponsiveContainer width="100%" height="100%">
            <RechartsPieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={90}
                paddingAngle={2}
                dataKey="value"
                nameKey="name"
                label={({ name, percent }) =>
                  `${name} ${(percent * 100).toFixed(0)}%`
                }
                labelLine={{ stroke: '#52525b' }}
                fontSize={10}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={ATS_COLORS[i % ATS_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip {...tooltipStyle} />
            </RechartsPieChart>
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
    const totalApplied = jobs.filter(
      (j) => j.status === 'submitted' || j.status === 'screening' || j.status === 'interviewing' ||
        j.status === 'challenge' || j.status === 'offer' || j.status === 'negotiation' ||
        j.status === 'rejected' || j.status === 'withdrawn' || j.status === 'ghosted'
    ).length

    const gotResponse = jobs.filter(
      (j) => j.status === 'screening' || j.status === 'interviewing' ||
        j.status === 'offer' || j.status === 'rejected' || j.status === 'challenge' ||
        j.status === 'negotiation'
    ).length

    // No response = submitted, no events, and submitted > 7 days ago
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const noResponse = jobs.filter((j) => {
      if (j.status !== 'submitted') return false
      if (j.events && j.events.length > 0) return false
      const submitted = new Date(j.date)
      return submitted < sevenDaysAgo
    }).length

    const rate = totalApplied > 0 ? ((gotResponse / totalApplied) * 100).toFixed(1) : '0.0'

    return { totalApplied, gotResponse, noResponse, rate }
  }, [jobs])

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>Response Rate</h3>
      <div style={styles.statsGrid}>
        <StatCard label="Total Applied" value={stats.totalApplied} color="#34d399" />
        <StatCard label="Got Response" value={stats.gotResponse} color="#60a5fa" />
        <StatCard label="No Response (7d+)" value={stats.noResponse} color="#52525b" />
        <StatCard label="Response Rate" value={`${stats.rate}%`} color="#fbbf24" />
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

/* ------------------------------------------------------------------ */
/*  AnalyticsView                                                      */
/* ------------------------------------------------------------------ */
export function AnalyticsView() {
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Analytics</h1>
        <p style={styles.subtitle}>Visual breakdown of your job search progress</p>
      </div>
      <div style={styles.grid}>
        <ResponseRate />
        <StatusDistribution />
        <ApplicationsOverTime />
        <TopATSPlatforms />
      </div>
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
