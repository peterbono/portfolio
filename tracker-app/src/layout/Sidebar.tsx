import { useEffect } from 'react'
import {
  LayoutList,
  Kanban,
  BarChart3,
  Settings,
  PanelLeftClose,
  PanelLeft,
  Briefcase,
  Flame,
  Bot,
} from 'lucide-react'
import { useUI, type ActiveView } from '../context/UIContext'
import { useJobs } from '../context/JobsContext'

const NAV_ITEMS: { view: ActiveView; label: string; icon: typeof LayoutList }[] = [
  { view: 'table', label: 'Table', icon: LayoutList },
  { view: 'pipeline', label: 'Pipeline', icon: Kanban },
  { view: 'analytics', label: 'Analytics', icon: BarChart3 },
  { view: 'coach', label: 'Coach', icon: Flame },
  { view: 'autopilot', label: 'Autopilot', icon: Bot },
  { view: 'settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const { activeView, setActiveView, sidebarCollapsed, toggleSidebar } = useUI()
  const { jobs } = useJobs()

  // Cmd+B keyboard shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleSidebar])

  const width = sidebarCollapsed ? 64 : 240

  return (
    <aside
      style={{
        width,
        minWidth: width,
        height: '100vh',
        background: '#0c0c0e',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width var(--transition-normal), min-width var(--transition-normal)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: sidebarCollapsed ? '20px 0' : '20px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
          borderBottom: '1px solid var(--border)',
          minHeight: 64,
        }}
      >
        <Briefcase size={20} color="var(--accent)" />
        {!sidebarCollapsed && (
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
            }}
          >
            Job Tracker
          </span>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV_ITEMS.map(({ view, label, icon: Icon }) => {
          const isActive = activeView === view
          return (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              title={sidebarCollapsed ? label : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: sidebarCollapsed ? '10px 0' : '10px 16px',
                justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                background: isActive ? 'rgba(52, 211, 153, 0.08)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontSize: 13,
                fontWeight: isActive ? 500 : 400,
                transition: 'all var(--transition-fast)',
                width: '100%',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                  e.currentTarget.style.color = 'var(--text-primary)'
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--text-secondary)'
                }
              }}
            >
              <Icon size={18} />
              {!sidebarCollapsed && <span style={{ whiteSpace: 'nowrap' }}>{label}</span>}
            </button>
          )
        })}
      </nav>

      {/* Job count */}
      {!sidebarCollapsed && (
        <div
          style={{
            padding: '12px 16px',
            fontSize: 12,
            color: 'var(--text-tertiary)',
            borderTop: '1px solid var(--border)',
          }}
        >
          {jobs.length} jobs tracked
        </div>
      )}

      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        title={sidebarCollapsed ? 'Expand sidebar (Cmd+B)' : 'Collapse sidebar (Cmd+B)'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
          gap: 10,
          padding: sidebarCollapsed ? '14px 0' : '14px 16px',
          borderTop: '1px solid var(--border)',
          color: 'var(--text-tertiary)',
          fontSize: 12,
          transition: 'color var(--transition-fast)',
          width: '100%',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--text-primary)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-tertiary)'
        }}
      >
        {sidebarCollapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        {!sidebarCollapsed && <span>Collapse</span>}
      </button>
    </aside>
  )
}
