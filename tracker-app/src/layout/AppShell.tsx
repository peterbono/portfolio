import { Sidebar } from './Sidebar'
import { DetailDrawer } from './DetailDrawer'
import { useUI, type TimeRange, type AreaFilter, type WorkMode } from '../context/UIContext'
import { TableView } from '../views/TableView'
import { PipelineView } from '../views/PipelineView'
import { AnalyticsView } from '../views/AnalyticsView'
import { SettingsView } from '../views/SettingsView'
import { CoachView } from '../views/CoachView'

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
    <div style={styles.timeBar}>
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
      >
        {AREA_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <select
        value={workMode}
        onChange={e => setWorkMode(e.target.value as WorkMode)}
        style={styles.filterSelect}
      >
        {MODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

const VIEWS_WITH_FILTERS = new Set(['table', 'pipeline', 'analytics'])

export function AppShell() {
  const { activeView, drawerOpen, selectedJobId } = useUI()

  return (
    <div style={styles.container}>
      <Sidebar />
      <main style={styles.main}>
        {VIEWS_WITH_FILTERS.has(activeView) && <GlobalFilters />}
        <ActiveViewContent view={activeView} />
      </main>
      {drawerOpen && selectedJobId && <DetailDrawer />}
    </div>
  )
}

function ActiveViewContent({ view }: { view: string }) {
  switch (view) {
    case 'table':
      return <TableView />
    case 'pipeline':
      return <PipelineView />
    case 'analytics':
      return <AnalyticsView />
    case 'coach':
      return <CoachView />
    case 'settings':
      return <SettingsView />
    default:
      return null
  }
}

function ViewPlaceholder({ name, description }: { name: string; description: string }) {
  return (
    <div style={styles.placeholder}>
      <h1 style={styles.placeholderTitle}>{name}</h1>
      <p style={styles.placeholderDesc}>{description}</p>
    </div>
  )
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
  placeholder: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: 8,
    opacity: 0.5,
  },
  placeholderTitle: {
    fontSize: 24,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  placeholderDesc: {
    fontSize: 14,
    color: 'var(--text-tertiary)',
  },
}
