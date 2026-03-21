import { useMemo, useState, lazy, Suspense } from 'react'
import { useJobs } from '../context/JobsContext'
import { STATUS_CONFIG, type JobStatus } from '../types/job'
import type { Job } from '../types/job'
import {
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
  Area,
  Line,
  ReferenceLine,
  Legend,
} from 'recharts'

/* ------------------------------------------------------------------ */
/*  Lazy chart containers                                              */
/* ------------------------------------------------------------------ */
const LazyBarChart = lazy(() =>
  import('recharts').then((m) => ({ default: m.BarChart }))
)
const LazyAreaChart = lazy(() =>
  import('recharts').then((m) => ({ default: m.AreaChart }))
)
const LazyComposedChart = lazy(() =>
  import('recharts').then((m) => ({ default: m.ComposedChart }))
)

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                                */
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

const TICK_STYLE = { fill: '#a1a1aa', fontSize: 11 }
const GRID_COLOR = '#2a2a35'

const COLOR_MANUAL = '#34d399'
const COLOR_BOT = '#60a5fa'

function ChartLoader() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#71717a',
      }}
    >
      Loading chart...
    </div>
  )
}

/** Source map from git history analysis */
import sourceMapData from '../data/source-map.json'
const SOURCE_MAP: Record<string, string> = (sourceMapData as { companies: Record<string, string> }).companies ?? {}

type ApplySource = 'bot' | 'claude-chrome' | 'manual' | 'unknown'

function getSource(job: Job): ApplySource {
  const mapped = SOURCE_MAP[job.company]
  if (mapped === 'bot') return 'bot'
  if (mapped === 'claude-chrome') return 'claude-chrome'
  if (mapped === 'manual') return 'manual'
  return 'unknown'
}

function isBot(job: Job): boolean {
  const src = getSource(job)
  return src === 'bot'
}

function isClaudeChrome(job: Job): boolean {
  return getSource(job) === 'claude-chrome'
}

/** Get the ISO-week Monday for a date string */
function getWeekMonday(dateStr: string): string {
  const d = new Date(dateStr)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(d)
  monday.setDate(diff)
  return monday.toISOString().slice(0, 10)
}

/** Shared ATS normalization and exclusion maps (same as TopATSPlatforms) */
const ATS_EXCLUDE = new Set([
  'unknown', 'soumise', 'à soumettre', 'a soumettre', 'manual', 'custom',
  'email', 'direct', '—', '', 'recruiter', 'aggregator', 'various',
  'skip (us only)', 'trop long', 'external', 'custom (remote.com)',
  'wwr (paywall)', 'buscojobs',
])

const ATS_NORMALIZE: Record<string, string> = {
  'linkedin ea': 'Easy Apply LinkedIn',
  'easy apply': 'Easy Apply LinkedIn',
  'linkedin easy apply': 'Easy Apply',
  'linkedin easy apply (workable)': 'Workable',
  'linkedin': 'Easy Apply LinkedIn',
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

function normalizeATS(raw: string): string | null {
  const lower = raw.trim().toLowerCase()
  if (ATS_EXCLUDE.has(lower)) return null
  return ATS_NORMALIZE[lower] || raw.trim()
}

/** Funnel stages in order */
const FUNNEL_STAGES: { key: JobStatus | 'responded'; label: string }[] = [
  { key: 'submitted', label: 'Submitted' },
  { key: 'responded', label: 'Got Response' },
  { key: 'screening', label: 'Screening' },
  { key: 'interviewing', label: 'Interviewing' },
  { key: 'challenge', label: 'Challenge' },
  { key: 'offer', label: 'Offer' },
]

/** Statuses that mean the company responded (positive or negative) */
const RESPONDED_STATUSES = new Set<JobStatus>([
  'screening', 'interviewing', 'challenge', 'offer', 'negotiation', 'rejected', 'withdrawn',
])

/** Statuses that count as "applied" (entered the funnel) */
const APPLIED_STATUSES = new Set<JobStatus>([
  'submitted', 'screening', 'interviewing', 'challenge',
  'offer', 'negotiation', 'rejected', 'withdrawn', 'ghosted',
])

/** Statuses that mean the job reached at least a given funnel stage */
function reachedStage(status: JobStatus, stage: JobStatus | 'responded'): boolean {
  // For applied jobs, submitted is always reached
  if (stage === 'submitted') return APPLIED_STATUSES.has(status)
  // "Got Response" = any response from the company
  if (stage === 'responded') return RESPONDED_STATUSES.has(status)
  const order: JobStatus[] = [
    'submitted', 'screening', 'interviewing', 'challenge', 'offer', 'negotiation',
  ]
  const stageIdx = order.indexOf(stage)
  const statusIdx = order.indexOf(status)
  // Jobs that are rejected/withdrawn/ghosted only reached response, not screening+
  if (status === 'rejected' || status === 'withdrawn' || status === 'ghosted') {
    return false
  }
  if (statusIdx === -1 || stageIdx === -1) return false
  return statusIdx >= stageIdx
}

/** Response statuses: anything beyond submitted (got a reply) */
const RESPONSE_STATUSES = new Set<JobStatus>([
  'screening', 'interviewing', 'challenge', 'offer',
  'negotiation', 'rejected', 'withdrawn',
])

const INTERVIEW_STATUSES = new Set<JobStatus>([
  'interviewing', 'challenge', 'offer', 'negotiation',
])

const ACTIVE_PIPELINE = new Set<JobStatus>([
  'screening', 'interviewing', 'challenge', 'offer', 'negotiation',
])

const TERMINAL_STATUSES = new Set<JobStatus>([
  'rejected', 'withdrawn', 'ghosted',
])

/* ------------------------------------------------------------------ */
/*  Shared styles                                                      */
/* ------------------------------------------------------------------ */
const styles: Record<string, React.CSSProperties> = {
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
  kpi: {
    fontSize: 13,
    color: '#a1a1aa',
    marginBottom: 12,
  },
  kpiValue: {
    fontWeight: 700,
    color: '#e0e0e0',
  },
  miniTable: {
    width: '100%',
    fontSize: 11,
    color: '#a1a1aa',
    borderCollapse: 'collapse' as const,
    marginTop: 12,
  },
  miniTh: {
    textAlign: 'left' as const,
    padding: '6px 8px',
    borderBottom: '1px solid #2a2a35',
    color: '#71717a',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    fontSize: 10,
  },
  miniTd: {
    padding: '5px 8px',
    borderBottom: '1px solid #1e1e24',
    color: '#a1a1aa',
  },
}

/* ================================================================== */
/*  1. ManualVsBotFunnel                                               */
/* ================================================================== */
export function ManualVsBotFunnel() {
  const { jobs } = useJobs()
  const [drillDown, setDrillDown] = useState(false)

  const isBotAny = (j: Job) => isBot(j) || isClaudeChrome(j)

  const data = useMemo(() => {
    if (drillDown) {
      // Drill-down: Bot VPS vs Claude Chrome
      const botJobs = jobs.filter((j) => APPLIED_STATUSES.has(j.status) && isBot(j))
      const chromeJobs = jobs.filter((j) => APPLIED_STATUSES.has(j.status) && isClaudeChrome(j))
      return FUNNEL_STAGES.map((stage) => ({
        stage: stage.label,
        a: botJobs.filter((j) => reachedStage(j.status, stage.key)).length,
        b: chromeJobs.filter((j) => reachedStage(j.status, stage.key)).length,
      }))
    } else {
      // Default: Manual vs Bot (all AI)
      const manualJobs = jobs.filter((j) => APPLIED_STATUSES.has(j.status) && !isBotAny(j))
      const botAllJobs = jobs.filter((j) => APPLIED_STATUSES.has(j.status) && isBotAny(j))
      return FUNNEL_STAGES.map((stage) => ({
        stage: stage.label,
        a: manualJobs.filter((j) => reachedStage(j.status, stage.key)).length,
        b: botAllJobs.filter((j) => reachedStage(j.status, stage.key)).length,
      }))
    }
  }, [jobs, drillDown])

  const totals = useMemo(() => {
    const applied = jobs.filter(j => APPLIED_STATUSES.has(j.status))
    return {
      manual: applied.filter(j => !isBotAny(j)).length,
      botAll: applied.filter(j => isBotAny(j)).length,
      botVps: applied.filter(j => isBot(j)).length,
      chrome: applied.filter(j => isClaudeChrome(j)).length,
    }
  }, [jobs])

  const labelA = drillDown ? 'Bot VPS' : 'Manual'
  const labelB = drillDown ? 'Claude Chrome' : 'Bot (AI)'
  const colorA = drillDown ? COLOR_BOT : '#f97316'
  const colorB = drillDown ? COLOR_MANUAL : COLOR_BOT

  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>
          {drillDown ? 'Bot VPS vs Claude Chrome' : 'Manual vs Bot'}
        </h3>
        <button
          onClick={() => setDrillDown(!drillDown)}
          style={{
            background: 'transparent', border: '1px solid #2a2a35', borderRadius: 6,
            color: '#a1a1aa', fontSize: 10, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {drillDown ? 'Show Manual vs Bot' : 'Drill down by bot type'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 12 }}>
        {drillDown ? (
          <>
            <span style={{ color: COLOR_BOT }}>Bot VPS: <b>{totals.botVps}</b></span>
            <span style={{ color: COLOR_MANUAL }}>Claude Chrome: <b>{totals.chrome}</b></span>
          </>
        ) : (
          <>
            <span style={{ color: '#f97316' }}>Manual: <b>{totals.manual}</b></span>
            <span style={{ color: COLOR_BOT }}>Bot (AI): <b>{totals.botAll}</b></span>
          </>
        )}
      </div>
      <div style={{ width: '100%', height: 300 }}>
        <Suspense fallback={<ChartLoader />}>
          <ResponsiveContainer width="100%" height="100%">
            <LazyBarChart
              data={data}
              layout="vertical"
              margin={{ left: 8, right: 24, top: 8, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
              <XAxis type="number" tick={TICK_STYLE} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey="stage"
                tick={TICK_STYLE}
                axisLine={false}
                tickLine={false}
                width={90}
              />
              <Tooltip
                {...tooltipStyle}
                formatter={(value: number, name: string) => [value, name === 'a' ? labelA : labelB]}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }}
                formatter={(value: string) => (value === 'a' ? labelA : labelB)}
              />
              <Bar dataKey="a" fill={colorA} radius={[0, 4, 4, 0]} barSize={14} />
              <Bar dataKey="b" fill={colorB} radius={[0, 4, 4, 0]} barSize={14} />
            </LazyBarChart>
          </ResponsiveContainer>
        </Suspense>
      </div>
    </div>
  )
}

/* ================================================================== */
/*  2. ATSConversionComparison                                         */
/* ================================================================== */
interface ATSRow {
  name: string
  total: number
  responded: number
  interviewed: number
  responseRate: number
}

export function ATSConversionComparison() {
  const { jobs } = useJobs()
  const [showAll, setShowAll] = useState(false)

  const { topData, allData } = useMemo(() => {
    const atsMap = new Map<string, { total: number; responded: number; interviewed: number }>()

    for (const job of jobs) {
      if (!job.ats) continue
      if (!APPLIED_STATUSES.has(job.status)) continue
      const name = normalizeATS(job.ats)
      if (!name) continue

      const entry = atsMap.get(name) ?? { total: 0, responded: 0, interviewed: 0 }
      entry.total++
      if (RESPONSE_STATUSES.has(job.status)) entry.responded++
      if (INTERVIEW_STATUSES.has(job.status)) entry.interviewed++
      atsMap.set(name, entry)
    }

    const rows: ATSRow[] = []
    for (const [name, stats] of atsMap) {
      rows.push({
        name,
        total: stats.total,
        responded: stats.responded,
        interviewed: stats.interviewed,
        responseRate: stats.total > 0 ? stats.responded / stats.total : 0,
      })
    }

    rows.sort((a, b) => b.responseRate - a.responseRate || b.total - a.total)
    return {
      topData: rows.filter(r => r.total >= 5),
      allData: rows,
    }
  }, [jobs])

  const data = showAll ? allData : topData
  const chartHeight = Math.max(280, data.length * 36 + 60)

  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ ...styles.cardTitle, margin: 0 }}>ATS Conversion Comparison</h3>
        <button
          onClick={() => setShowAll(!showAll)}
          style={{
            background: 'transparent', border: '1px solid #2a2a35', borderRadius: 6,
            color: '#a1a1aa', fontSize: 10, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {showAll ? `Top ${topData.length} (5+ apps)` : `Show all ${allData.length} ATS`}
        </button>
      </div>
      <div style={{ width: '100%', height: chartHeight, maxHeight: 500, overflowY: showAll ? 'auto' : 'hidden' }}>
        <Suspense fallback={<ChartLoader />}>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <LazyBarChart
              data={data}
              layout="vertical"
              margin={{ left: 8, right: 24, top: 8, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
              <XAxis type="number" tick={TICK_STYLE} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fill: '#a1a1aa', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={110}
              />
              <Tooltip
                {...tooltipStyle}
                formatter={(value: number, name: string, props: { payload?: ATSRow }) => {
                  const row = props.payload
                  const label =
                    name === 'total' ? 'Total Apps' :
                    name === 'responded' ? 'Got Response' :
                    'Got Interview'
                  const rate = row && name !== 'total' ? ` (${((value / (row.total || 1)) * 100).toFixed(0)}%)` : ''
                  return [`${value}${rate}`, label]
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }}
                formatter={(value: string) =>
                  value === 'total' ? 'Total Apps' :
                  value === 'responded' ? 'Got Response' :
                  'Got Interview'
                }
              />
              <Bar dataKey="total" fill="#52525b" radius={[0, 4, 4, 0]} barSize={10} />
              <Bar dataKey="responded" fill={COLOR_BOT} radius={[0, 4, 4, 0]} barSize={10} />
              <Bar dataKey="interviewed" fill="#fb923c" radius={[0, 4, 4, 0]} barSize={10} />
            </LazyBarChart>
          </ResponsiveContainer>
        </Suspense>
      </div>
    </div>
  )
}

/* ================================================================== */
/*  3. TimeToResponse                                                  */
/* ================================================================== */
interface HistogramBin {
  label: string
  binStart: number
  positive: number
  negative: number
}

export function TimeToResponse() {
  const { jobs } = useJobs()

  const data = useMemo(() => {
    const buckets = [
      { label: '< 3 days', icon: '\u26A1', min: 0, max: 3, count: 0, color: '#34d399', desc: 'Automated / Fast' },
      { label: '3-7 days', icon: '\uD83D\uDCE7', min: 3, max: 7, count: 0, color: '#60a5fa', desc: 'Recruiter review' },
      { label: '7-14 days', icon: '\uD83D\uDC0C', min: 7, max: 14, count: 0, color: '#fbbf24', desc: 'Standard process' },
      { label: '14+ days', icon: '\uD83D\uDC7B', min: 14, max: 999, count: 0, color: '#71717a', desc: 'Slow / Ghosting' },
    ]

    let total = 0
    let totalDays = 0

    for (const job of jobs) {
      if (!job.date) continue
      const hasResponse = ['screening','interviewing','challenge','offer','negotiation','rejected'].includes(job.status)
      if (!hasResponse) continue

      let responseDateStr: string | null = null

      if (job.status === 'rejected') {
        // For rejections: use lastContactDate (rejection date) as the definitive response date
        if (job.lastContactDate) {
          responseDateStr = job.lastContactDate
        } else if (job.events && job.events.length > 0) {
          // Fallback: look for a rejection event
          const rejEvent = job.events.find(e => e.type === 'rejection')
          responseDateStr = rejEvent ? rejEvent.date : null
        }
        // No date at all → skip (don't estimate)
      } else if (job.events && job.events.length > 0) {
        // For non-rejected: first real response event (exclude auto-confirmation emails)
        const meaningful = job.events.filter(e => e.type !== 'email')
        const sorted = (meaningful.length > 0 ? meaningful : job.events).sort((a, b) => a.date.localeCompare(b.date))
        responseDateStr = sorted[0].date
      } else if (job.lastContactDate) {
        responseDateStr = job.lastContactDate
      } else if (job.status === 'screening' || job.status === 'interviewing') {
        responseDateStr = new Date().toISOString().split('T')[0]
      }
      if (!responseDateStr) continue

      const diffDays = Math.max(0, Math.floor((new Date(responseDateStr).getTime() - new Date(job.date).getTime()) / 86400000))
      if (diffDays > 90) continue

      total++
      totalDays += diffDays
      const bucket = buckets.find(b => diffDays >= b.min && diffDays < b.max) || buckets[3]
      bucket.count++
    }

    const avgDays = total > 0 ? Math.round(totalDays / total) : 0
    return { buckets, total, avgDays }
  }, [jobs])

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>Response Speed</h3>
      <p style={{ color: '#a1a1aa', fontSize: 12, margin: '0 0 16px' }}>
        Avg response time: <span style={{ color: '#e0e0e0', fontWeight: 600 }}>{data.avgDays} days</span> ({data.total} responses tracked)
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {data.buckets.map(b => (
          <div key={b.label} style={{
            background: '#1a1a1f', borderRadius: 10, padding: '16px 12px', textAlign: 'center',
            border: `1px solid ${b.count > 0 ? b.color + '33' : '#2a2a35'}`,
          }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>{b.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: b.color }}>{b.count}</div>
            <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 2 }}>{b.label}</div>
            <div style={{ fontSize: 10, color: '#71717a', marginTop: 2 }}>{b.desc}</div>
            {data.total > 0 && (
              <div style={{ fontSize: 10, color: b.color, marginTop: 4, opacity: 0.8 }}>
                {Math.round(b.count / data.total * 100)}%
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ================================================================== */
/*  4. PipelineHealth                                                  */
/* ================================================================== */
interface ActiveItem {
  company: string
  role: string
  status: string
  daysStale: number
}

export function PipelineHealth() {
  const { jobs } = useJobs()

  const { barData, activeItems, kpiText } = useMemo(() => {
    const now = new Date()
    let activeCount = 0
    let terminalCount = 0
    const items: ActiveItem[] = []
    let totalAge = 0

    for (const job of jobs) {
      if (ACTIVE_PIPELINE.has(job.status)) {
        activeCount++
        // Calculate staleness: days since last event or application date
        let lastDate = job.date
        if (job.lastContactDate && job.lastContactDate > lastDate) {
          lastDate = job.lastContactDate
        }
        if (job.events && job.events.length > 0) {
          for (const ev of job.events) {
            if (ev.date > lastDate) lastDate = ev.date
          }
        }
        const diffMs = now.getTime() - new Date(lastDate).getTime()
        const daysStale = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)))
        totalAge += daysStale
        items.push({
          company: job.company,
          role: job.role,
          status: STATUS_CONFIG[job.status].label,
          daysStale,
        })
      } else if (TERMINAL_STATUSES.has(job.status)) {
        terminalCount++
      }
    }

    items.sort((a, b) => b.daysStale - a.daysStale)
    const avgAge = activeCount > 0 ? Math.round(totalAge / activeCount) : 0
    const kpi = `Active pipeline: ${activeCount} items, ${avgAge} days avg age`

    const bar = [
      {
        name: 'Pipeline',
        active: activeCount,
        terminal: terminalCount,
      },
    ]

    return { barData: bar, activeItems: items.slice(0, 10), kpiText: kpi }
  }, [jobs])

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>Pipeline Health</h3>
      <p style={styles.kpi}>
        <span style={styles.kpiValue}>{kpiText}</span>
      </p>
      <div style={{ width: '100%', height: 60 }}>
        <Suspense fallback={<ChartLoader />}>
          <ResponsiveContainer width="100%" height="100%">
            <LazyBarChart
              data={barData}
              layout="vertical"
              stackOffset="expand"
              margin={{ left: 0, right: 24, top: 0, bottom: 0 }}
            >
              <XAxis
                type="number"
                tick={TICK_STYLE}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              />
              <YAxis type="category" dataKey="name" hide />
              <Tooltip
                {...tooltipStyle}
                formatter={(value: number, name: string) => [
                  value,
                  name === 'active' ? 'Active Pipeline' : 'Terminal (rejected/withdrawn/ghosted)',
                ]}
              />
              <Bar dataKey="active" stackId="a" fill={COLOR_MANUAL} barSize={28} radius={[4, 0, 0, 4]}>
                <Cell fill={COLOR_MANUAL} />
              </Bar>
              <Bar dataKey="terminal" stackId="a" fill="#52525b" barSize={28} radius={[0, 4, 4, 0]}>
                <Cell fill="#52525b" />
              </Bar>
            </LazyBarChart>
          </ResponsiveContainer>
        </Suspense>
      </div>

      {/* Staleness table */}
      {activeItems.length > 0 && (
        <table style={styles.miniTable}>
          <thead>
            <tr>
              <th style={styles.miniTh}>Company</th>
              <th style={styles.miniTh}>Role</th>
              <th style={styles.miniTh}>Status</th>
              <th style={{ ...styles.miniTh, textAlign: 'right' as const }}>Days Stale</th>
            </tr>
          </thead>
          <tbody>
            {activeItems.map((item, i) => (
              <tr key={i}>
                <td style={styles.miniTd}>{item.company}</td>
                <td style={{ ...styles.miniTd, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.role}
                </td>
                <td style={styles.miniTd}>{item.status}</td>
                <td style={{ ...styles.miniTd, textAlign: 'right' as const, color: item.daysStale > 14 ? '#f43f5e' : '#a1a1aa' }}>
                  {item.daysStale}d
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/* ================================================================== */
/*  5. VelocityVsQuality                                               */
/* ================================================================== */
interface WeekPoint {
  week: string
  count: number
  responseRate: number
}

export function VelocityVsQuality() {
  const { jobs } = useJobs()

  const data = useMemo(() => {
    // Only consider jobs that entered the funnel
    const applied = jobs.filter((j) => APPLIED_STATUSES.has(j.status) && j.date)

    if (!applied.length) return [] as WeekPoint[]

    // Group by ISO week
    const weekMap = new Map<string, { total: number; responded: number }>()
    for (const job of applied) {
      const key = getWeekMonday(job.date)
      const entry = weekMap.get(key) ?? { total: 0, responded: 0 }
      entry.total++
      if (RESPONSE_STATUSES.has(job.status)) entry.responded++
      weekMap.set(key, entry)
    }

    const weeks = [...weekMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week, stats]): WeekPoint => ({
        week: week.slice(5), // MM-DD
        count: stats.total,
        responseRate: stats.total > 0
          ? Math.round((stats.responded / stats.total) * 100)
          : 0,
      }))

    return weeks
  }, [jobs])

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>Velocity vs Quality</h3>
      <div style={{ width: '100%', height: 300 }}>
        <Suspense fallback={<ChartLoader />}>
          <ResponsiveContainer width="100%" height="100%">
            <LazyComposedChart
              data={data}
              margin={{ left: 0, right: 16, top: 8, bottom: 8 }}
            >
              <defs>
                <linearGradient id="velAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLOR_BOT} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={COLOR_BOT} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
              <XAxis
                dataKey="week"
                tick={{ fill: '#a1a1aa', fontSize: 9 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                yAxisId="left"
                tick={TICK_STYLE}
                axisLine={false}
                tickLine={false}
                label={{
                  value: 'Apps / week',
                  angle: -90,
                  position: 'insideLeft',
                  fill: '#71717a',
                  fontSize: 10,
                  offset: 10,
                }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={TICK_STYLE}
                axisLine={false}
                tickLine={false}
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
                label={{
                  value: 'Response %',
                  angle: 90,
                  position: 'insideRight',
                  fill: '#71717a',
                  fontSize: 10,
                  offset: 10,
                }}
              />
              <Tooltip
                {...tooltipStyle}
                formatter={(value: number, name: string) => [
                  name === 'responseRate' ? `${value}%` : value,
                  name === 'count' ? 'Applications' : 'Response Rate',
                ]}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, color: '#a1a1aa' }}
                formatter={(value: string) =>
                  value === 'count' ? 'Applications / week' : 'Response Rate %'
                }
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="count"
                stroke={COLOR_BOT}
                strokeWidth={2}
                fill="url(#velAreaGrad)"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="responseRate"
                stroke="#fbbf24"
                strokeWidth={2}
                dot={{ r: 3, fill: '#fbbf24' }}
                activeDot={{ r: 5 }}
              />
            </LazyComposedChart>
          </ResponsiveContainer>
        </Suspense>
      </div>
    </div>
  )
}
