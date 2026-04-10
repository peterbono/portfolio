import { useEffect, useState } from 'react'
import {
  LayoutList,
  Settings,
  PanelLeftClose,
  PanelLeft,
  Search,
  Bot,
  LogOut,
  CreditCard,
  Lock,
  ArrowLeft,
  FolderKanban,
  User,
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
  boost: { bg: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' },
}

type NavEntry =
  | { kind: 'item'; view: ActiveView; label: string; icon: typeof LayoutList }
  | { kind: 'separator'; label?: string }

const NAV_ITEMS: NavEntry[] = [
  // --- SET UP (first, like Jack) ---
  { kind: 'item', view: 'profile', label: 'Profile', icon: User },
  { kind: 'separator' },
  // --- CONFIGURE (Autopilot before Open Jobs — scout criteria comes first) ---
  { kind: 'item', view: 'autopilot', label: 'Autopilot', icon: Bot },
  { kind: 'item', view: 'open-jobs', label: 'Open Jobs', icon: Search },
  // --- TRACK ---
  { kind: 'item', view: 'applications', label: 'Applications', icon: FolderKanban },
  { kind: 'separator' },
  { kind: 'item', view: 'pricing', label: 'Account', icon: CreditCard },
]

/** Views that require auth — show lock icon for anonymous users */
const LOCKED_VIEWS = new Set<ActiveView>(['autopilot', 'applications'])

export function Sidebar({ onBackToLanding }: { onBackToLanding?: () => void }) {
  const { activeView, setActiveView, sidebarCollapsed, toggleSidebar } = useUI()
  const { jobs } = useJobs()
  const { user, signOut } = useSupabase()
  const { plan, effectivePlan, isTrialActive, isTrialExpired, trialDaysLeft } = usePlan()

  const userEmail = user?.email ?? ''
  const userName = user?.user_metadata?.full_name ?? userEmail
  const userInitial = (userName || '?')[0].toUpperCase()

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // On mobile, when user navigates, collapse sidebar automatically
  const handleNavClick = (view: typeof activeView) => {
    setActiveView(view)
    if (isMobile && !sidebarCollapsed) {
      toggleSidebar()
    }
  }

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

  // On mobile with sidebar expanded, render as overlay
  const isMobileExpanded = isMobile && !sidebarCollapsed

  return (
    <>
      {/* Mobile overlay backdrop */}
      {isMobileExpanded && (
        <div
          data-sidebar-overlay
          onClick={toggleSidebar}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(4px)',
          }}
        />
      )}
      <aside
        data-sidebar-mobile={isMobileExpanded ? '' : undefined}
        style={{
          width: isMobileExpanded ? 240 : width,
          minWidth: isMobileExpanded ? 240 : width,
          height: '100vh',
          background: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width var(--transition-normal), min-width var(--transition-normal)',
          overflow: 'hidden',
          ...(isMobileExpanded ? {
            position: 'fixed',
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: 101,
            boxShadow: '8px 0 24px rgba(0, 0, 0, 0.6)',
          } : {}),
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
        <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(52, 211, 153, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-hidden="true">
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

      {/* Back to landing (anonymous users only) */}
      {onBackToLanding && (
        <button
          onClick={onBackToLanding}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: sidebarCollapsed ? '8px 0' : '8px 16px',
            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
            background: 'none',
            border: 'none',
            color: 'var(--text-tertiary)',
            fontSize: 12,
            cursor: 'pointer',
            width: '100%',
            transition: 'color 150ms ease',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
          title="Back to home"
        >
          <ArrowLeft size={14} />
          {!sidebarCollapsed && 'Back to home'}
        </button>
      )}

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV_ITEMS.map((entry, idx) => {
          if (entry.kind === 'separator') {
            return (
              <div key={`sep-${idx}`} style={{ padding: sidebarCollapsed ? '6px 12px' : '6px 16px', margin: '2px 0' }}>
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} />
                {entry.label && !sidebarCollapsed && (
                  <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginTop: 8 }}>
                    {entry.label}
                  </span>
                )}
              </div>
            )
          }
          const { view, label, icon: Icon } = entry
          const isActive = activeView === view
          const isAutopilotHighlight = view === 'autopilot' && !user && !LOCKED_VIEWS.has(view)
          const isLocked = !user && LOCKED_VIEWS.has(view)
          return (
            <button
              key={view}
              onClick={() => handleNavClick(view)}
              title={sidebarCollapsed ? (isLocked ? `${label} (Sign up to unlock)` : label) : undefined}
              aria-label={isLocked ? `${label} (Sign up to unlock)` : label}
              aria-current={isActive ? 'page' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: sidebarCollapsed ? '10px 0' : '10px 16px',
                justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent',
                background: isActive
                  ? 'rgba(52, 211, 153, 0.12)'
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
                  size={10}
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 10,
                    opacity: 0.35,
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
              {/* Plan badge */}
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
                  background: isTrialActive
                    ? 'rgba(52, 211, 153, 0.15)'
                    : isTrialExpired && plan === 'free'
                      ? 'rgba(113, 113, 122, 0.15)'
                      : PLAN_BADGE_COLORS[plan].bg,
                  color: isTrialActive
                    ? '#34d399'
                    : isTrialExpired && plan === 'free'
                      ? '#71717a'
                      : PLAN_BADGE_COLORS[plan].color,
                }}
              >
                {isTrialActive ? 'Pro Trial' : isTrialExpired && plan === 'free' ? 'Free Plan' : plan}
              </span>
              {/* Trial status line */}
              {isTrialActive && (
                <div
                  style={{
                    fontSize: 10,
                    marginTop: 3,
                    color: trialDaysLeft <= 3 ? '#f59e0b' : 'var(--text-tertiary)',
                    fontWeight: trialDaysLeft <= 3 ? 600 : 400,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {trialDaysLeft <= 3 ? '\u26a0' : '\u23f1'} Trial: {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} left
                </div>
              )}
              {isTrialExpired && plan === 'free' && (
                <button
                  onClick={() => handleNavClick('pricing')}
                  style={{
                    display: 'block',
                    marginTop: 3,
                    fontSize: 10,
                    fontWeight: 600,
                    color: '#34d399',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    textUnderlineOffset: 2,
                  }}
                >
                  Upgrade
                </button>
              )}
            </div>
          )}
          {!sidebarCollapsed && (
            <button
              onClick={signOut}
              title="Sign out"
              aria-label="Sign out"
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
    </>
  )
}
