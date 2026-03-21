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
  Brain,
  Bot,
  LogOut,
  CreditCard,
  Lock,
} from 'lucide-react'
import { useUI, type ActiveView } from '../context/UIContext'
import { useJobs } from '../context/JobsContext'
import { useSupabase } from '../context/SupabaseContext'
import { usePlan } from '../hooks/usePlan'
import type { PlanTier } from '../lib/billing'

const PLAN_BADGE_COLORS: Record<PlanTier, { bg: string; color: string }> = {
  free: { bg: 'rgba(113, 113, 122, 0.15)', color: '#71717a' },
  starter: { bg: 'rgba(96, 165, 250, 0.15)', color: '#60a5fa' },
  pro: { bg: 'rgba(52, 211, 153, 0.15)', color: '#34d399' },
  premium: { bg: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' },
}

const NAV_ITEMS: { view: ActiveView; label: string; icon: typeof LayoutList }[] = [
  { view: 'table', label: 'Table', icon: LayoutList },
  { view: 'pipeline', label: 'Pipeline', icon: Kanban },
  { view: 'analytics', label: 'Analytics', icon: BarChart3 },
  { view: 'coach', label: 'Coach', icon: Flame },
  { view: 'insights', label: 'Insights', icon: Brain },
  { view: 'autopilot', label: 'Autopilot', icon: Bot },
  { view: 'settings', label: 'Settings', icon: Settings },
  { view: 'pricing', label: 'Pricing', icon: CreditCard },
]

/** Views that require auth — show lock icon for anonymous users */
const LOCKED_VIEWS = new Set<ActiveView>(['table', 'pipeline', 'analytics', 'coach', 'insights'])

export function Sidebar() {
  const { activeView, setActiveView, sidebarCollapsed, toggleSidebar } = useUI()
  const { jobs } = useJobs()
  const { user, signOut } = useSupabase()
  const { plan } = usePlan()

  const userEmail = user?.email ?? ''
  const userName = user?.user_metadata?.full_name ?? userEmail
  const userInitial = (userName || '?')[0].toUpperCase()

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
        <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(52, 211, 153, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Bot size={16} color="var(--accent)" />
        </div>
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
          const isAutopilotHighlight = view === 'autopilot' && !user
          const isLocked = !user && LOCKED_VIEWS.has(view)
          return (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              title={sidebarCollapsed ? (isLocked ? `${label} (Sign up to unlock)` : label) : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: sidebarCollapsed ? '10px 0' : '10px 16px',
                justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                background: isActive
                  ? 'rgba(52, 211, 153, 0.08)'
                  : isAutopilotHighlight && !isActive
                    ? 'rgba(52, 211, 153, 0.04)'
                    : 'transparent',
                color: isActive || isAutopilotHighlight
                  ? 'var(--text-primary)'
                  : 'var(--text-secondary)',
                fontSize: 13,
                fontWeight: isActive || isAutopilotHighlight ? 500 : 400,
                transition: 'all var(--transition-fast)',
                width: '100%',
                cursor: 'pointer',
                position: 'relative',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                  e.currentTarget.style.color = 'var(--text-primary)'
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = isAutopilotHighlight
                    ? 'rgba(52, 211, 153, 0.04)'
                    : 'transparent'
                  e.currentTarget.style.color = isAutopilotHighlight
                    ? 'var(--text-primary)'
                    : 'var(--text-secondary)'
                }
              }}
            >
              <Icon
                size={18}
                style={isAutopilotHighlight && !isActive ? { color: 'var(--accent)' } : undefined}
              />
              {!sidebarCollapsed && (
                <span style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                  {label}
                  {isAutopilotHighlight && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: 4,
                        background: 'rgba(52, 211, 153, 0.15)',
                        color: '#34d399',
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        animation: 'subtlePulse 2s ease-in-out infinite',
                      }}
                    >
                      NEW
                    </span>
                  )}
                  {isLocked && (
                    <Lock
                      size={11}
                      style={{
                        opacity: 0.35,
                        marginLeft: 'auto',
                        flexShrink: 0,
                      }}
                    />
                  )}
                </span>
              )}
              {sidebarCollapsed && isLocked && (
                <Lock
                  size={8}
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 12,
                    opacity: 0.3,
                  }}
                />
              )}
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

      {/* User section */}
      {user && (
        <div
          style={{
            padding: sidebarCollapsed ? '10px 0' : '10px 16px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'rgba(52, 211, 153, 0.15)',
              color: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 600,
              flexShrink: 0,
            }}
            title={sidebarCollapsed ? userEmail : undefined}
          >
            {userInitial}
          </div>
          {!sidebarCollapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {userEmail}
              </div>
              <span
                style={{
                  display: 'inline-block',
                  marginTop: 2,
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: PLAN_BADGE_COLORS[plan].bg,
                  color: PLAN_BADGE_COLORS[plan].color,
                }}
              >
                {plan}
              </span>
            </div>
          )}
          {!sidebarCollapsed && (
            <button
              onClick={signOut}
              title="Sign out"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 4,
                color: 'var(--text-tertiary)',
                transition: 'color 150ms ease',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#f87171'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-tertiary)'
              }}
            >
              <LogOut size={14} />
            </button>
          )}
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
