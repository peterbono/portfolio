import { useMemo, useState, useCallback, useRef, lazy, Suspense } from 'react'
import {
  Brain,
  Ghost,
  Zap,
  Clock,
  FileCheck,
  Calendar,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  BarChart3,
  Target,
  Layers,
  GitBranch,
  Map,
  Users,
  Timer,
  ArrowRight,
} from 'lucide-react'
import { useFeedbackLoop } from '../hooks/useFeedbackLoop'
import { useJobs } from '../context/JobsContext'
import {
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
} from 'recharts'

// Lazy-load chart containers
const RechartsBarChart = lazy(() =>
  import('recharts').then((m) => ({ default: m.BarChart })),
)

// Lazy-load individual Deep Dive chart components
const LazyManualVsBotFunnel = lazy(() =>
  import('./AnalyticsCharts').then((m) => ({ default: m.ManualVsBotFunnel })),
)
const LazyTimeToResponse = lazy(() =>
  import('./AnalyticsCharts').then((m) => ({ default: m.TimeToResponse })),
)
const LazyPipelineHealth = lazy(() =>
  import('./AnalyticsCharts').then((m) => ({ default: m.PipelineHealth })),
)
const LazyVelocityVsQuality = lazy(() =>
  import('./AnalyticsCharts').then((m) => ({ default: m.VelocityVsQuality })),
)
const LazyWeeklyCadenceHeatmap = lazy(() =>
  import('./AnalyticsCharts2').then((m) => ({ default: m.WeeklyCadenceHeatmap })),
)
const LazyRoleCategoryPerformance = lazy(() =>
  import('./AnalyticsCharts2').then((m) => ({ default: m.RoleCategoryPerformance })),
)
const LazyGeographicPerformance = lazy(() =>
  import('./AnalyticsCharts2').then((m) => ({ default: m.GeographicPerformance })),
)

// Mobile responsive CSS
const insightsResponsiveCSS = `
@media (max-width: 767px) {
  .insights-container {
    padding: 16px !important;
  }
  .insights-card {
    padding: 14px !important;
  }
  .signal-cards-grid {
    grid-template-columns: 1fr 1fr !important;
  }
  .insights-grid {
    grid-template-columns: 1fr !important;
  }
}
@media (max-width: 479px) {
  .signal-cards-grid {
    grid-template-columns: 1fr !important;
  }
}
`
if (typeof document !== 'undefined') {
  const id = 'insights-responsive-styles'
  if (!document.getElementById(id)) {
    const style = document.createElement('style')
    style.id = id
    style.textContent = insightsResponsiveCSS
    document.head.appendChild(style)
  }
}

// ---------------------------------------------------------------------------
//  localStorage helpers for section expansion state
// ---------------------------------------------------------------------------
const STORAGE_KEY = 'insights-expanded-sections'

function loadExpandedSections(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch { /* ignore */ }
  return new Set<string>()
}

function saveExpandedSections(sections: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...sections]))
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
//  Shared styles
// ---------------------------------------------------------------------------

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

function ChartLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#71717a' }}>
      Loading chart...
    </div>
  )
}

// ---------------------------------------------------------------------------
//  Card: What's Working (formerly ATS Playbook)
// ---------------------------------------------------------------------------

function ATSPlaybookCard() {
  const { recommendations, atsArms } = useFeedbackLoop()

  const confidenceBadge = (conf: 'high' | 'medium' | 'low') => {
    const colors = {
      high: { bg: 'rgba(52, 211, 153, 0.15)', color: '#34d399' },
      medium: { bg: 'rgba(251, 191, 36, 0.15)', color: '#fbbf24' },
      low: { bg: 'rgba(113, 113, 122, 0.15)', color: '#71717a' },
    }
    return (
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          padding: '2px 6px',
          borderRadius: 4,
          background: colors[conf].bg,
          color: colors[conf].color,
        }}
      >
        {conf}
      </span>
    )
  }

  return (
    <div className="insights-card" style={styles.card}>
      <div style={styles.cardHeader}>
        <Zap size={16} color="#fbbf24" />
        <h3 style={styles.cardTitle}>What's Working</h3>
      </div>
      <p style={styles.cardSubtitle}>Platforms ranked by response rate from your applications</p>

      <div style={{ marginTop: 12 }}>
        {recommendations.length === 0 && (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-tertiary)', fontSize: 12 }}>
            Not enough data yet. Apply to more platforms to unlock rankings.
          </div>
        )}
        {recommendations.slice(0, 10).map((rec, i) => {
          const arm = atsArms.find((a) => a.label === rec.ats)
          const isTop = i < 3
          const isBottom = i >= recommendations.length - 2 && recommendations.length > 4
          return (
            <div
              key={rec.ats}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 0',
                borderBottom: '1px solid #1a1a1f',
                ...(isTop ? { borderLeft: '2px solid #34d399', paddingLeft: 8 } : {}),
                ...(isBottom ? { borderLeft: '2px solid #f43f5e', paddingLeft: 8, opacity: 0.7 } : {}),
              }}
            >
              <span style={{ width: 20, fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                {i + 1}
              </span>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                {rec.ats}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: isTop ? '#34d399' : isBottom ? '#f43f5e' : 'var(--text-secondary)' }}>
                {rec.score}%
              </span>
              {confidenceBadge(rec.confidence)}
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', minWidth: 30, textAlign: 'right' }}>
                n={arm?.sampleSize ?? 0}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
//  Card: Ghost Radar
// ---------------------------------------------------------------------------

function GhostRadarCard() {
  const { ghostCompanies } = useFeedbackLoop()
  const { updateJobStatus } = useJobs()

  return (
    <div className="insights-card" style={styles.card}>
      <div style={styles.cardHeader}>
        <Ghost size={16} color="#71717a" />
        <h3 style={styles.cardTitle}>Ghost Radar</h3>
      </div>
      <p style={styles.cardSubtitle}>
        {ghostCompanies.length > 0
          ? `${ghostCompanies.length} compan${ghostCompanies.length === 1 ? 'y' : 'ies'} ghosting you right now`
          : 'No ghosts detected. Nice.'}
      </p>

      <div style={{ marginTop: 12, maxHeight: 340, overflowY: 'auto' }}>
        {ghostCompanies.length === 0 && (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-tertiary)', fontSize: 12 }}>
            All companies have responded. Keep it up.
          </div>
        )}
        {ghostCompanies.slice(0, 15).map((g) => (
          <div
            key={g.jobId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 0',
              borderBottom: '1px solid #1a1a1f',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {g.company}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                {g.daysSinceApply}d ago
              </div>
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: g.ghostRate >= 80 ? '#f43f5e' : g.ghostRate >= 50 ? '#fb923c' : '#fbbf24' }}>
              {g.ghostRate}%
            </span>
            <button
              onClick={() => updateJobStatus(g.jobId, 'ghosted')}
              style={{
                fontSize: 10,
                padding: '3px 8px',
                borderRadius: 4,
                border: '1px solid #2a2a35',
                background: 'transparent',
                color: 'var(--text-tertiary)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
                transition: 'all 150ms',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#f43f5e'
                e.currentTarget.style.color = '#f43f5e'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#2a2a35'
                e.currentTarget.style.color = 'var(--text-tertiary)'
              }}
            >
              Mark Ghosted
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
//  Card: Quality Impact
// ---------------------------------------------------------------------------

function QualityImpactCard() {
  const { qualityImpact } = useFeedbackLoop()

  const barData = useMemo(
    () =>
      qualityImpact.map((f) => ({
        name: f.label,
        'With': f.withFactor,
        'Without': f.withoutFactor,
        multiplier: f.multiplier,
      })),
    [qualityImpact],
  )

  const bestFactor = qualityImpact.length > 0 ? qualityImpact[0] : null

  return (
    <div className="insights-card" style={styles.card}>
      <div style={styles.cardHeader}>
        <FileCheck size={16} color="#60a5fa" />
        <h3 style={styles.cardTitle}>Quality Impact</h3>
      </div>
      <p style={styles.cardSubtitle}>Which factors correlate with getting responses</p>

      {barData.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-tertiary)', fontSize: 12 }}>
          Not enough data to analyze quality factors yet.
        </div>
      ) : (
        <>
          <div style={{ width: '100%', height: 200, marginTop: 12 }}>
            <Suspense fallback={<ChartLoader />}>
              <ResponsiveContainer width="100%" height="100%">
                <RechartsBarChart data={barData} margin={{ left: 0, right: 8, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a35" />
                  <XAxis dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tick={{ fill: '#a1a1aa', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: number) => `${value}%`}
                  />
                  <Bar dataKey="With" fill="#34d399" radius={[4, 4, 0, 0]} barSize={20} />
                  <Bar dataKey="Without" fill="#3f3f46" radius={[4, 4, 0, 0]} barSize={20} />
                </RechartsBarChart>
              </ResponsiveContainer>
            </Suspense>
          </div>

          {bestFactor && bestFactor.multiplier > 1 && (
            <div
              style={{
                marginTop: 12,
                padding: '10px 12px',
                borderRadius: 6,
                background: 'rgba(52, 211, 153, 0.08)',
                border: '1px solid rgba(52, 211, 153, 0.15)',
                fontSize: 12,
                color: '#34d399',
              }}
            >
              Always include your {bestFactor.label.toLowerCase()} — {bestFactor.multiplier}x better response rate.
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
//  Card: Timing Analysis
// ---------------------------------------------------------------------------

function TimingAnalysisCard() {
  const { timingPatterns } = useFeedbackLoop()

  const dayColors: Record<string, string> = {
    Sunday: '#71717a',
    Monday: '#60a5fa',
    Tuesday: '#34d399',
    Wednesday: '#fbbf24',
    Thursday: '#fb923c',
    Friday: '#a855f7',
    Saturday: '#71717a',
  }

  return (
    <div className="insights-card" style={styles.card}>
      <div style={styles.cardHeader}>
        <Calendar size={16} color="#fb923c" />
        <h3 style={styles.cardTitle}>Timing Analysis</h3>
      </div>
      <p style={styles.cardSubtitle}>Response rates by day of week</p>

      {timingPatterns.data.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-tertiary)', fontSize: 12 }}>
          Not enough data for timing analysis yet.
        </div>
      ) : (
        <>
          <div style={{ width: '100%', height: 200, marginTop: 12 }}>
            <Suspense fallback={<ChartLoader />}>
              <ResponsiveContainer width="100%" height="100%">
                <RechartsBarChart data={timingPatterns.data} margin={{ left: 0, right: 8, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a35" />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: '#a1a1aa', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: string) => v.slice(0, 3)}
                  />
                  <YAxis
                    tick={{ fill: '#a1a1aa', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value: number, name: string) => [
                      name === 'rate' ? `${value}%` : value,
                      name === 'rate' ? 'Response Rate' : name === 'count' ? 'Applications' : name,
                    ]}
                  />
                  <Bar dataKey="rate" radius={[4, 4, 0, 0]} barSize={28}>
                    {timingPatterns.data.map((entry) => (
                      <Cell key={entry.day} fill={dayColors[entry.day] ?? '#71717a'} />
                    ))}
                  </Bar>
                </RechartsBarChart>
              </ResponsiveContainer>
            </Suspense>
          </div>

          {timingPatterns.bestDay !== 'N/A' && (
            <div
              style={{
                marginTop: 12,
                padding: '10px 12px',
                borderRadius: 6,
                background: 'rgba(251, 191, 36, 0.08)',
                border: '1px solid rgba(251, 191, 36, 0.15)',
                fontSize: 12,
                color: '#fbbf24',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Clock size={14} />
              Applications sent on {timingPatterns.bestDay}s get the best response rate.
            </div>
          )}

          {/* Day breakdown list */}
          <div style={{ marginTop: 12 }}>
            {timingPatterns.data.map((d) => (
              <div
                key={d.day}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '5px 0',
                  borderBottom: '1px solid #1a1a1f',
                  fontSize: 12,
                }}
              >
                <span style={{ width: 60, color: 'var(--text-secondary)' }}>{d.day.slice(0, 3)}</span>
                <div style={{ flex: 1, height: 6, background: '#1e1e24', borderRadius: 3, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${Math.min(100, d.rate * 3)}%`,
                      height: '100%',
                      background: dayColors[d.day] ?? '#71717a',
                      borderRadius: 3,
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
                <span style={{ width: 40, textAlign: 'right', color: 'var(--text-tertiary)' }}>
                  {d.rate}%
                </span>
                <span style={{ width: 30, textAlign: 'right', color: 'var(--text-tertiary)', fontSize: 10 }}>
                  n={d.count}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
//  Active Insights Banner
// ---------------------------------------------------------------------------

function InsightsBanner() {
  const { insights } = useFeedbackLoop()

  if (insights.length === 0) return null

  const impactColor = (impact: string) => {
    if (impact === 'high') return '#f43f5e'
    if (impact === 'medium') return '#fbbf24'
    return '#71717a'
  }

  const typeIcon = (type: string) => {
    switch (type) {
      case 'ats_recommendation': return <Zap size={14} color="#fbbf24" />
      case 'ghost_alert': return <Ghost size={14} color="#71717a" />
      case 'quality_tip': return <FileCheck size={14} color="#60a5fa" />
      case 'timing_insight': return <Clock size={14} color="#fb923c" />
      default: return <Brain size={14} color="#a78bfa" />
    }
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Brain size={16} color="#a78bfa" />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Active Insights</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '1px 6px',
            borderRadius: 10,
            background: 'rgba(167, 139, 250, 0.15)',
            color: '#a78bfa',
          }}
        >
          {insights.length}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {insights.map((insight) => (
          <div
            key={insight.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '12px 14px',
              borderRadius: 8,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ marginTop: 2, flexShrink: 0 }}>{typeIcon(insight.type)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2 }}>
                {insight.title}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
                {insight.description}
              </div>
              {insight.action && (
                <div style={{ fontSize: 11, color: '#34d399', marginTop: 4 }}>
                  {insight.action}
                </div>
              )}
            </div>
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                textTransform: 'uppercase',
                padding: '2px 6px',
                borderRadius: 4,
                background: `${impactColor(insight.impact)}22`,
                color: impactColor(insight.impact),
                flexShrink: 0,
              }}
            >
              {insight.impact}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
//  Key Signal Cards (Layer 2.5 — between insights grid and Deep Dive)
// ---------------------------------------------------------------------------

interface SignalCardData {
  id: string
  label: string
  value: string
  subtext: string
  color: string
  trend: 'up' | 'down' | 'flat'
  trendLabel: string
  icon: React.ReactNode
  targetSection: string // links to a Deep Dive section ID
  sparklineData: number[]
}

function MiniSparkline({ data, color, width = 60, height = 24 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * height
    return `${x},${y}`
  }).join(' ')

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function TrendArrow({ trend, color }: { trend: 'up' | 'down' | 'flat'; color: string }) {
  if (trend === 'up') return <TrendingUp size={14} color={color} />
  if (trend === 'down') return <TrendingDown size={14} color={color} />
  return <Minus size={14} color={color} />
}

function useSignalCardData(): SignalCardData[] {
  const { jobs, allJobs } = useJobs()
  const { ghostCompanies } = useFeedbackLoop()

  return useMemo(() => {
    const applied = ['submitted', 'screening', 'interviewing', 'challenge', 'offer', 'negotiation', 'rejected', 'withdrawn', 'ghosted']
    const responseStatuses = ['screening', 'interviewing', 'challenge', 'offer', 'negotiation', 'rejected', 'withdrawn']
    const activeStatuses = ['screening', 'interviewing', 'challenge', 'offer', 'negotiation']

    const submittedJobs = allJobs.filter(j => applied.includes(j.status))
    const totalApplied = submittedJobs.length
    const gotResponse = allJobs.filter(j => responseStatuses.includes(j.status)).length
    const responseRate = totalApplied > 0 ? Math.round((gotResponse / totalApplied) * 100) : 0

    // Ghost rate
    const ghostCount = ghostCompanies.length
    const ghostRate = totalApplied > 0 ? Math.round((ghostCount / totalApplied) * 100) : 0

    // Active pipeline
    const activeCount = allJobs.filter(j => activeStatuses.includes(j.status)).length

    // Weekly velocity (apps per week over last 4 weeks)
    const now = new Date()
    const fourWeeksAgo = new Date(now.getTime() - 28 * 86400000)
    const recentJobs = submittedJobs.filter(j => j.date && new Date(j.date) >= fourWeeksAgo)
    const weeklyAvg = recentJobs.length > 0 ? Math.round(recentJobs.length / 4) : 0

    // Sparkline data: weekly counts over last 8 weeks
    const weeklySparkline: number[] = []
    for (let w = 7; w >= 0; w--) {
      const weekStart = new Date(now.getTime() - (w + 1) * 7 * 86400000)
      const weekEnd = new Date(now.getTime() - w * 7 * 86400000)
      const count = submittedJobs.filter(j => {
        if (!j.date) return false
        const d = new Date(j.date)
        return d >= weekStart && d < weekEnd
      }).length
      weeklySparkline.push(count)
    }

    // Response rate sparkline (last 8 weeks)
    const responseSparkline: number[] = []
    for (let w = 7; w >= 0; w--) {
      const weekStart = new Date(now.getTime() - (w + 1) * 7 * 86400000)
      const weekEnd = new Date(now.getTime() - w * 7 * 86400000)
      const weekJobs = submittedJobs.filter(j => {
        if (!j.date) return false
        const d = new Date(j.date)
        return d >= weekStart && d < weekEnd
      })
      const weekResponses = weekJobs.filter(j => responseStatuses.includes(j.status)).length
      responseSparkline.push(weekJobs.length > 0 ? Math.round((weekResponses / weekJobs.length) * 100) : 0)
    }

    // Ghost sparkline (cumulative ghosted count by week)
    const ghostSparkline: number[] = []
    for (let w = 7; w >= 0; w--) {
      const weekEnd = new Date(now.getTime() - w * 7 * 86400000)
      const count = ghostCompanies.filter(g => {
        const applyDate = new Date(now.getTime() - g.daysSinceApply * 86400000)
        return applyDate <= weekEnd
      }).length
      ghostSparkline.push(count)
    }

    // Pipeline sparkline (just repeat activeCount as a flat line with slight variation from data)
    const pipelineSparkline = weeklySparkline.map((_, i) => {
      // Approximate: active count doesn't have historical data, so show velocity as proxy
      return Math.max(0, weeklySparkline[i])
    })

    // Trend calculation helpers
    const calcTrend = (data: number[]): 'up' | 'down' | 'flat' => {
      if (data.length < 2) return 'flat'
      const recent = data.slice(-3).reduce((a, b) => a + b, 0)
      const older = data.slice(-6, -3).reduce((a, b) => a + b, 0)
      if (recent > older * 1.1) return 'up'
      if (recent < older * 0.9) return 'down'
      return 'flat'
    }

    const responseTrend = calcTrend(responseSparkline)
    const velocityTrend = calcTrend(weeklySparkline)
    const ghostTrend = calcTrend(ghostSparkline)

    const responseColor = responseRate > 20 ? '#34d399' : responseRate >= 10 ? '#fbbf24' : '#f43f5e'
    const ghostColor = ghostRate > 30 ? '#f43f5e' : ghostRate < 15 ? '#34d399' : '#fb923c'

    return [
      {
        id: 'response-rate',
        label: 'Response Rate',
        value: `${responseRate}%`,
        subtext: `${gotResponse} of ${totalApplied} replied`,
        color: responseColor,
        trend: responseTrend,
        trendLabel: responseTrend === 'up' ? 'Improving' : responseTrend === 'down' ? 'Declining' : 'Stable',
        icon: <Target size={16} color={responseColor} />,
        targetSection: 'deep-dive-response-speed',
        sparklineData: responseSparkline,
      },
      {
        id: 'ghost-rate',
        label: 'Ghost Rate',
        value: `${ghostRate}%`,
        subtext: `${ghostCount} unanswered`,
        color: ghostColor,
        trend: ghostTrend,
        trendLabel: ghostTrend === 'up' ? 'Rising' : ghostTrend === 'down' ? 'Improving' : 'Stable',
        icon: <Ghost size={16} color={ghostColor} />,
        targetSection: 'deep-dive-pipeline-health',
        sparklineData: ghostSparkline,
      },
      {
        id: 'active-pipeline',
        label: 'Active Pipeline',
        value: `${activeCount}`,
        subtext: activeCount === 1 ? '1 active process' : `${activeCount} active processes`,
        color: '#a78bfa',
        trend: 'flat',
        trendLabel: activeCount > 0 ? 'In progress' : 'Empty',
        icon: <Activity size={16} color="#a78bfa" />,
        targetSection: 'deep-dive-pipeline-health',
        sparklineData: pipelineSparkline,
      },
      {
        id: 'weekly-velocity',
        label: 'Weekly Velocity',
        value: `${weeklyAvg}`,
        subtext: 'apps/week (4w avg)',
        color: '#60a5fa',
        trend: velocityTrend,
        trendLabel: velocityTrend === 'up' ? 'Accelerating' : velocityTrend === 'down' ? 'Slowing' : 'Steady',
        icon: <TrendingUp size={16} color="#60a5fa" />,
        targetSection: 'deep-dive-velocity-quality',
        sparklineData: weeklySparkline,
      },
    ]
  }, [allJobs, ghostCompanies])
}

function KeySignalCards({ onNavigateToSection }: { onNavigateToSection: (sectionId: string) => void }) {
  const signals = useSignalCardData()

  return (
    <div style={{ marginTop: 24, marginBottom: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <BarChart3 size={16} color="#60a5fa" />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Key Signals</span>
      </div>
      <div
        className="signal-cards-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
        }}
      >
        {signals.map((signal) => (
          <div
            key={signal.id}
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: '16px 16px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              transition: 'border-color 150ms',
              cursor: 'pointer',
            }}
            onClick={() => onNavigateToSection(signal.targetSection)}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = signal.color + '55'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)'
            }}
          >
            {/* Top row: icon + label */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {signal.icon}
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {signal.label}
                </span>
              </div>
              <MiniSparkline data={signal.sparklineData} color={signal.color} />
            </div>

            {/* Value */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 28, fontWeight: 700, color: signal.color, lineHeight: 1 }}>
                {signal.value}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <TrendArrow trend={signal.trend} color={signal.trend === 'up' ? '#34d399' : signal.trend === 'down' ? '#f43f5e' : '#71717a'} />
                <span style={{ fontSize: 10, color: signal.trend === 'up' ? '#34d399' : signal.trend === 'down' ? '#f43f5e' : '#71717a' }}>
                  {signal.trendLabel}
                </span>
              </div>
            </div>

            {/* Subtext + detail link */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{signal.subtext}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 10, color: '#60a5fa', fontWeight: 500 }}>
                Detail <ArrowRight size={10} />
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
//  Individual Collapsible Deep Dive Section
// ---------------------------------------------------------------------------

interface DeepDiveSectionConfig {
  id: string
  title: string
  description: string
  icon: React.ReactNode
  fullWidth?: boolean
  component: React.ReactNode
}

function CollapsibleSection({
  config,
  isExpanded,
  onToggle,
}: {
  config: DeepDiveSectionConfig
  isExpanded: boolean
  onToggle: () => void
}) {
  const sectionRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={sectionRef}
      id={config.id}
      style={{
        ...(config.fullWidth ? { gridColumn: '1 / -1' } : {}),
      }}
    >
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '12px 14px',
          background: isExpanded ? 'var(--bg-surface)' : 'transparent',
          border: '1px solid var(--border)',
          borderRadius: isExpanded ? 'var(--radius-lg) var(--radius-lg) 0 0' : 'var(--radius-lg)',
          cursor: 'pointer',
          color: 'var(--text-primary)',
          transition: 'all 150ms',
          fontFamily: 'inherit',
        }}
        aria-expanded={isExpanded}
        onMouseEnter={(e) => {
          if (!isExpanded) e.currentTarget.style.background = 'var(--bg-surface)'
        }}
        onMouseLeave={(e) => {
          if (!isExpanded) e.currentTarget.style.background = 'transparent'
        }}
      >
        <div style={{ flexShrink: 0, marginTop: 1 }}>{config.icon}</div>
        <div style={{ flex: 1, textAlign: 'left' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{config.title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
            {config.description}
          </div>
        </div>
        {isExpanded
          ? <ChevronDown size={16} color="var(--text-tertiary)" />
          : <ChevronRight size={16} color="var(--text-tertiary)" />}
      </button>

      {isExpanded && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderTop: 'none',
            borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
            padding: 16,
            background: 'var(--bg-surface)',
          }}
        >
          <Suspense
            fallback={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#71717a' }}>
                Loading...
              </div>
            }
          >
            {config.component}
          </Suspense>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
//  Deep Dive Sections Container
// ---------------------------------------------------------------------------

function DeepDiveSections({ expandedSections, onToggleSection }: {
  expandedSections: Set<string>
  onToggleSection: (id: string) => void
}) {
  const sections: DeepDiveSectionConfig[] = useMemo(() => [
    {
      id: 'deep-dive-velocity-quality',
      title: 'Velocity vs Quality',
      description: 'Weekly application volume plotted against response rate to find the sweet spot',
      icon: <TrendingUp size={16} color="#fbbf24" />,
      component: <LazyVelocityVsQuality />,
    },
    {
      id: 'deep-dive-response-speed',
      title: 'Response Speed',
      description: 'How fast companies respond after your application, broken down by time brackets',
      icon: <Timer size={16} color="#60a5fa" />,
      component: <LazyTimeToResponse />,
    },
    {
      id: 'deep-dive-manual-vs-bot',
      title: 'Manual vs Bot Funnel',
      description: 'Compare conversion rates between manual applications and automated submissions',
      icon: <GitBranch size={16} color="#34d399" />,
      component: <LazyManualVsBotFunnel />,
    },
    {
      id: 'deep-dive-pipeline-health',
      title: 'Pipeline Health',
      description: 'Active pipeline items and their staleness — identify processes that need follow-up',
      icon: <Activity size={16} color="#a78bfa" />,
      component: <LazyPipelineHealth />,
    },
    {
      id: 'deep-dive-weekly-cadence',
      title: 'Weekly Cadence Heatmap',
      description: 'Application distribution by day of week and hour — find your most productive windows',
      icon: <Layers size={16} color="#fb923c" />,
      component: <LazyWeeklyCadenceHeatmap />,
    },
    {
      id: 'deep-dive-role-performance',
      title: 'Role Category Performance',
      description: 'Response rates broken down by role seniority and type — where do you convert best',
      icon: <Users size={16} color="#34d399" />,
      component: <LazyRoleCategoryPerformance />,
    },
    {
      id: 'deep-dive-geographic',
      title: 'Geographic Performance',
      description: 'Response rates by region and country — map your best markets',
      icon: <Map size={16} color="#60a5fa" />,
      fullWidth: true,
      component: <LazyGeographicPerformance />,
    },
  ], [])

  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <BarChart3 size={16} color="#60a5fa" />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Deep Dive Analytics</span>
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-tertiary)',
            marginLeft: 4,
          }}
        >
          {sections.length} sections
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))',
          gap: 12,
        }}
      >
        {sections.map((section) => (
          <CollapsibleSection
            key={section.id}
            config={section}
            isExpanded={expandedSections.has(section.id)}
            onToggle={() => onToggleSection(section.id)}
          />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
//  Main InsightsView
// ---------------------------------------------------------------------------

export function InsightsView() {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => loadExpandedSections())
  const containerRef = useRef<HTMLDivElement>(null)

  const toggleSection = useCallback((id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      saveExpandedSections(next)
      return next
    })
  }, [])

  const navigateToSection = useCallback((sectionId: string) => {
    // First, ensure the section is expanded
    setExpandedSections((prev) => {
      if (prev.has(sectionId)) return prev
      const next = new Set(prev)
      next.add(sectionId)
      saveExpandedSections(next)
      return next
    })

    // Then scroll to it after a brief delay to let the DOM update
    requestAnimationFrame(() => {
      setTimeout(() => {
        const el = document.getElementById(sectionId)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' })
          // Add a brief highlight effect
          el.style.outline = '2px solid rgba(96, 165, 250, 0.4)'
          el.style.outlineOffset = '4px'
          el.style.borderRadius = '12px'
          setTimeout(() => {
            el.style.outline = 'none'
            el.style.outlineOffset = '0'
          }, 1500)
        }
      }, 100)
    })
  }, [])

  return (
    <div ref={containerRef} className="insights-container" style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Intelligence</h1>
        <p style={styles.subtitle}>Personalized recommendations and analytics based on your results</p>
      </div>

      {/* Layer 1: Active Insights */}
      <InsightsBanner />

      {/* Layer 2: Insight Cards (What's Working, Ghost Radar, Quality, Timing) */}
      <div className="insights-grid" style={styles.grid}>
        <ATSPlaybookCard />
        <GhostRadarCard />
        <QualityImpactCard />
        <TimingAnalysisCard />
      </div>

      {/* Layer 2.5: Key Signal Cards */}
      <KeySignalCards onNavigateToSection={navigateToSection} />

      {/* Layer 3: Individual Deep Dive Sections */}
      <DeepDiveSections
        expandedSections={expandedSections}
        onToggleSection={toggleSection}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
//  Styles
// ---------------------------------------------------------------------------

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
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(380px, 100%), 1fr))',
    gap: 16,
  },
  card: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: 20,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    margin: 0,
  },
  cardSubtitle: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
    margin: 0,
    marginBottom: 4,
  },
}
