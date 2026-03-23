import { useMemo, lazy, Suspense } from 'react'
import {
  Brain,
  Ghost,
  Zap,
  Clock,
  FileCheck,
  Calendar,
} from 'lucide-react'
import { useFeedbackLoop } from '../hooks/useFeedbackLoop'

// Mobile responsive CSS
const insightsResponsiveCSS = `
@media (max-width: 767px) {
  .insights-container {
    padding: 16px !important;
  }
  .insights-card {
    padding: 14px !important;
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

const RechartsBarChart = lazy(() =>
  import('recharts').then((m) => ({ default: m.BarChart })),
)

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
//  Card 3: Ghost Radar
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
//  Card 4: Quality Impact
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

  // Find best factor for the actionable tip
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
//  Card 5: Timing Analysis
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
//  Main InsightsView
// ---------------------------------------------------------------------------

export function InsightsView() {
  return (
    <div className="insights-container" style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Insights</h1>
        <p style={styles.subtitle}>Personalized recommendations based on your results</p>
      </div>

      <InsightsBanner />

      <div style={styles.grid}>
        <ATSPlaybookCard />
        <GhostRadarCard />
        <QualityImpactCard />
        <TimingAnalysisCard />
      </div>
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
