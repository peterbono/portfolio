import React, { Suspense } from 'react'
import { Sidebar } from './Sidebar'
import { DetailDrawer } from './DetailDrawer'
import { useUI, type TimeRange, type AreaFilter, type WorkMode } from '../context/UIContext'
import { useJobs } from '../context/JobsContext'
import { useSupabase } from '../context/SupabaseContext'
import { TableView } from '../views/TableView'
import { PipelineView } from '../views/PipelineView'
import { AutopilotView } from '../views/AutopilotView'
import { SettingsView } from '../views/SettingsView'

const LazyAnalyticsView = React.lazy(() => import('../views/AnalyticsView').then(m => ({ default: m.AnalyticsView })))
const LazyCoachView = React.lazy(() => import('../views/CoachView').then(m => ({ default: m.CoachView })))
const LazyInsightsView = React.lazy(() => import('../views/InsightsView').then(m => ({ default: m.InsightsView })))
const LazyPricingView = React.lazy(() => import('../views/PricingView').then(m => ({ default: m.PricingViewWithResponsive })))
import { TrustIndicator } from '../components/TrustIndicator'
import { DemoBanner } from '../components/DemoBanner'
import { SunkCostNudge } from '../components/SunkCostNudge'
import { EmptyState } from '../components/EmptyState'
import { SkeletonForView } from '../components/SkeletonView'
import { LayoutList, Kanban, BarChart3, Flame, Brain, Bot } from 'lucide-react'

const TIME_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: '3months', label: 'Last 3 months' },
]

const AREA_OPTIONS: { value: AreaFilter; label: string }[] = [
  { value: 'all', label: 'All areas' },
  { value: 'apac', label: 'APAC' },
  { value: 'emea', label: 'EMEA' },
  { value: 'americas', label: 'Americas' },
]

const MODE_OPTIONS: { value: WorkMode; label: string }[] = [
  { value: 'all', label: 'All modes' },
  { value: 'remote', label: 'Remote' },
  { value: 'onsite', label: 'On-site' },
  { value: 'hybrid', label: 'Hybrid' },
]

function GlobalFilters() {
  const { timeRange, setTimeRange, areaFilter, setAreaFilter, workMode, setWorkMode } = useUI()
  return (
    <div style={styles.timeBar} data-filter-bar>
      {TIME_OPTIONS.map(opt => (
        <button
          key={opt.value}
          onClick={() => setTimeRange(opt.value)}
          style={{
            ...styles.timeBtn,
            ...(timeRange === opt.value ? styles.timeBtnActive : {}),
          }}
        >
          {opt.label}
        </button>
      ))}
      <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 8px' }} />
      <select
        value={areaFilter}
        onChange={e => setAreaFilter(e.target.value as AreaFilter)}
        style={styles.filterSelect}
        aria-label="Filter by region"
      >
        {AREA_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <select
        value={workMode}
        onChange={e => setWorkMode(e.target.value as WorkMode)}
        style={styles.filterSelect}
        aria-label="Filter by work mode"
      >
        {MODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

const VIEWS_WITH_FILTERS = new Set(['table', 'pipeline', 'analytics'])

export function AppShell({ onBackToLanding }: { onBackToLanding?: () => void }) {
  const { activeView, drawerOpen, selectedJobId } = useUI()
  const { isDemo, clearDemoData } = useJobs()
  const { session } = useSupabase()
  const isAnonymous = !session
  const isGatedView = activeView in EMPTY_STATES

  return (
    <div style={styles.container}>
      <Sidebar onBackToLanding={onBackToLanding} />
      <main style={styles.main}>
        {isDemo && (
          <div style={{ padding: '12px 20px 0' }}>
            <DemoBanner onClearDemo={clearDemoData} />
          </div>
        )}
        {VIEWS_WITH_FILTERS.has(activeView) && !(isAnonymous && isGatedView) && <GlobalFilters />}
        <ActiveViewContent view={activeView} />
      </main>
      {drawerOpen && selectedJobId && <DetailDrawer />}
      <TrustIndicator />
      <SunkCostNudge />
    </div>
  )
}

const EMPTY_STATES: Record<string, { icon: typeof LayoutList; title: string; description: string; ctaLabel: string }> = {
  autopilot: { icon: Bot, title: 'Auto-apply on autopilot', description: 'Sign up to configure search profiles and let the bot apply to jobs while you sleep.', ctaLabel: 'Sign up to get started' },
  table: { icon: LayoutList, title: 'No applications yet', description: 'Start the auto-apply bot or add jobs manually to begin tracking your job search.', ctaLabel: 'Set up Autopilot' },
  pipeline: { icon: Kanban, title: 'Your pipeline is empty', description: 'Applications will flow through stages as you apply and hear back from companies.', ctaLabel: 'Configure Autopilot' },
  analytics: { icon: BarChart3, title: 'No data to analyze yet', description: 'Analytics charts will populate as your application history grows. Start applying to unlock insights.', ctaLabel: 'Launch Autopilot' },
  coach: { icon: Flame, title: 'Your coach needs data', description: 'Apply to a few jobs and your AI coach will start giving personalized advice and daily goals.', ctaLabel: 'Set up Autopilot' },
  insights: { icon: Brain, title: 'The AI brain is waiting', description: 'The feedback engine learns from your applications — response rates, best ATS platforms, ghost detection.', ctaLabel: 'Configure Autopilot' },
}

function ActiveViewContent({ view }: { view: string }) {
  const { session } = useSupabase()
  const isAnonymous = !session

  // Show skeleton placeholder + empty state overlay for anonymous users on gated views
  const emptyConfig = EMPTY_STATES[view]
  if (isAnonymous && emptyConfig) {
    return (
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        <div style={{ opacity: 0.8, pointerEvents: 'none', overflow: 'hidden', maxHeight: '100%' }}>
          <SkeletonForView view={view} />
        </div>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent' }}>
          <EmptyState icon={emptyConfig.icon} title={emptyConfig.title} description={emptyConfig.description} ctaLabel={emptyConfig.ctaLabel} />
        </div>
      </div>
    )
  }

  const fallback = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50vh', gap: 12 }}>
      <div style={{ width: 24, height: 24, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Loading...</span>
    </div>
  )

  switch (view) {
    case 'table': return <TableView />
    case 'pipeline': return <PipelineView />
    case 'analytics': return <Suspense fallback={fallback}><LazyAnalyticsView /></Suspense>
    case 'coach': return <Suspense fallback={fallback}><LazyCoachView /></Suspense>
    case 'insights': return <Suspense fallback={fallback}><LazyInsightsView /></Suspense>
    case 'autopilot': return <AutopilotView />
    case 'settings': return <SettingsView />
    case 'pricing': return <Suspense fallback={fallback}><LazyPricingView /></Suspense>
    default: return null
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    height: '100vh',
    width: '100vw',
    overflow: 'hidden',
    background: 'var(--bg-base)',
  },
  main: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
  },
  timeBar: {
    display: 'flex',
    gap: 4,
    padding: '10px 24px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    flexShrink: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  timeBtn: {
    padding: '5px 14px',
    borderRadius: 6,
    border: '1px solid transparent',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s',
    fontFamily: 'inherit',
  },
  timeBtnActive: {
    background: 'var(--accent)',
    color: '#000',
    fontWeight: 600,
  },
  filterSelect: {
    padding: '5px 10px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg-surface)',
    color: 'var(--text-secondary)',
    fontSize: 12,
    fontFamily: 'inherit',
    cursor: 'pointer',
    outline: 'none',
  },
}
