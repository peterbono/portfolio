import { useState, useEffect, Suspense, lazy } from 'react'
import { Kanban, LayoutList } from 'lucide-react'

const LazyTableView = lazy(() => import('./TableView').then(m => ({ default: m.TableView })))
const LazyPipelineView = lazy(() => import('./PipelineView').then(m => ({ default: m.PipelineView })))

type ViewMode = 'table' | 'kanban'

const STORAGE_KEY = 'tracker_v2_applications_view_mode'

function getInitialMode(): ViewMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'table' || saved === 'kanban') return saved
  } catch { /* ignore */ }
  return 'table'
}

const fallback = (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50vh', gap: 12 }}>
    <div style={{ width: 24, height: 24, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Loading...</span>
  </div>
)

export function ApplicationsView() {
  const [mode, setMode] = useState<ViewMode>(getInitialMode)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode)
    } catch { /* ignore */ }
  }, [mode])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Toggle bar */}
      <div data-applications-toggle style={styles.toggleBar}>
        <div style={styles.toggleGroup}>
          <button
            onClick={() => setMode('table')}
            title="Table view"
            aria-label="Table view"
            aria-pressed={mode === 'table'}
            style={{
              ...styles.toggleBtn,
              ...(mode === 'table' ? styles.toggleBtnActive : {}),
            }}
            onMouseEnter={e => {
              if (mode !== 'table') e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
            }}
            onMouseLeave={e => {
              if (mode !== 'table') e.currentTarget.style.background = 'transparent'
            }}
          >
            <LayoutList size={14} />
            <span style={styles.toggleLabel}>Table</span>
          </button>
          <button
            onClick={() => setMode('kanban')}
            title="Kanban view"
            aria-label="Kanban view"
            aria-pressed={mode === 'kanban'}
            style={{
              ...styles.toggleBtn,
              ...(mode === 'kanban' ? styles.toggleBtnActive : {}),
            }}
            onMouseEnter={e => {
              if (mode !== 'kanban') e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
            }}
            onMouseLeave={e => {
              if (mode !== 'kanban') e.currentTarget.style.background = 'transparent'
            }}
          >
            <Kanban size={14} />
            <span style={styles.toggleLabel}>Kanban</span>
          </button>
        </div>
      </div>

      {/* Active view */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {mode === 'table' ? (
          <Suspense fallback={fallback}><LazyTableView /></Suspense>
        ) : (
          <Suspense fallback={fallback}><LazyPipelineView /></Suspense>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  toggleBar: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    padding: '8px 24px 0',
    flexShrink: 0,
  },
  toggleGroup: {
    display: 'flex',
    gap: 2,
    padding: 2,
    borderRadius: 8,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid var(--border)',
  },
  toggleBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '5px 10px',
    borderRadius: 6,
    border: 'none',
    background: 'transparent',
    color: 'var(--text-tertiary)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    fontFamily: 'inherit',
  },
  toggleBtnActive: {
    background: 'rgba(52, 211, 153, 0.15)',
    color: 'var(--text-primary)',
    fontWeight: 600,
  },
  toggleLabel: {
    lineHeight: 1,
  },
}
