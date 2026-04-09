import React, { Suspense } from 'react'
import { Sidebar } from './Sidebar'
const LazyDetailDrawer = React.lazy(() => import('./DetailDrawer').then(m => ({ default: m.DetailDrawer })))
import { useUI, type TimeRange, type AreaFilter, type WorkMode } from '../context/UIContext'
import { useJobs } from '../context/JobsContext'
import { useSupabase } from '../context/SupabaseContext'
const LazyApplicationsView = React.lazy(() => import('../views/ApplicationsView').then(m => ({ default: m.ApplicationsView })))
const LazySettingsView = React.lazy(() => import('../views/SettingsView').then(m => ({ default: m.SettingsView })))
const LazyPricingView = React.lazy(() => import('../views/PricingView').then(m => ({ default: m.PricingViewWithResponsive })))
const LazyAutopilotView = React.lazy(() => import('../views/AutopilotView').then(m => ({ default: m.AutopilotView })))
const LazyOpenJobsView = React.lazy(() => import('../views/OpenJobsView').then(m => ({ default: m.OpenJobsView })))
const LazyProfileSetupModal = React.lazy(() => import('../components/ProfileSetupModal').then(m => ({ default: m.ProfileSetupModal })))
import { EmptyState } from '../components/EmptyState'
import { SkeletonForView } from '../components/SkeletonView'
import { LayoutList, FolderKanban, Bot } from 'lucide-react'

// Mobile responsive CSS
const appShellResponsiveCSS = `
@media (max-width: 767px) {
  .app-shell-filter-bar {
    overflow-x: auto !important;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    padding: 8px 12px !important;
    gap: 4px !important;
    flex-wrap: nowrap !important;
  }
  .app-shell-filter-bar::-webkit-scrollbar {
    display: none;
  }
  .app-shell-filter-bar button,
  .app-shell-filter-bar select {
    flex-shrink: 0 !important;
    min-height: 36px !important;
  }
}
`
if (typeof document !== 'undefined') {
  const id = 'appshell-responsive-styles'
  if (!document.getElementById(id)) {
    const style = document.createElement('style')
    style.id = id
    style.textContent = appShellResponsiveCSS
    document.head.appendChild(style)
  }
}

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
    <div className="app-shell-filter-bar" style={styles.timeBar} data-filter-bar>
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

const VIEWS_WITH_FILTERS = new Set(['applications'])

export function AppShell({ onBackToLanding }: { onBackToLanding?: () => void }) {
  const { activeView, drawerOpen, selectedJobId } = useUI()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { isDemo } = useJobs()
  const { session } = useSupabase()
  const isAnonymous = !session
  const isGatedView = activeView in EMPTY_STATES

  return (
    <div style={styles.container}>
      <Sidebar onBackToLanding={onBackToLanding} />
      <main style={styles.main}>
        {VIEWS_WITH_FILTERS.has(activeView) && !(isAnonymous && isGatedView) && <GlobalFilters />}
        <ActiveViewContent view={activeView} />
      </main>
      {drawerOpen && selectedJobId && <Suspense fallback={null}><LazyDetailDrawer /></Suspense>}
    </div>
  )
}

const EMPTY_STATES: Record<string, { icon: typeof LayoutList; title: string; description: string; ctaLabel: string }> = {
  autopilot: { icon: Bot, title: 'Auto-apply on autopilot', description: 'Sign up to configure search profiles and let the bot apply to jobs while you sleep.', ctaLabel: 'Sign up to get started' },
  applications: { icon: FolderKanban, title: 'No applications yet', description: 'Start the auto-apply bot or add jobs manually to begin tracking your job search.', ctaLabel: 'Set up Autopilot' },
}

function ProfileViewWrapper() {
  const { setActiveView } = useUI()
  return (
    <div style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 24px 0' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Profile</h1>
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 24 }}>Complete your profile so the bot can apply to jobs for you.</p>
      </div>
      <LazyProfileSetupModal
        editMode
        inline
        onComplete={() => setActiveView('open-jobs')}
        onDismiss={() => setActiveView('open-jobs')}
      />
    </div>
  )
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
    case 'applications': return <Suspense fallback={fallback}><LazyApplicationsView /></Suspense>
    case 'autopilot': return <Suspense fallback={fallback}><LazyAutopilotView /></Suspense>
    case 'open-jobs': return <Suspense fallback={fallback}><LazyOpenJobsView /></Suspense>
    case 'profile': return <Suspense fallback={fallback}><ProfileViewWrapper /></Suspense>
    case 'settings': return <Suspense fallback={fallback}><LazySettingsView /></Suspense>
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
