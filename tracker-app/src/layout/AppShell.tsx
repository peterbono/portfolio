import { Sidebar } from './Sidebar'
import { DetailDrawer } from './DetailDrawer'
import { useUI } from '../context/UIContext'
import { TableView } from '../views/TableView'
import { PipelineView } from '../views/PipelineView'
import { AnalyticsView } from '../views/AnalyticsView'
import { SettingsView } from '../views/SettingsView'

export function AppShell() {
  const { activeView, drawerOpen, selectedJobId } = useUI()

  return (
    <div style={styles.container}>
      <Sidebar />
      <main style={styles.main}>
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
    case 'village':
      return <ViewPlaceholder name="Village" description="3D village visualization of your progress" />
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
