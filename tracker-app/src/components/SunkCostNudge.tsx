import { useState, useEffect, useCallback, useRef } from 'react'
import { Bot, X, ArrowRight } from 'lucide-react'
import { useSupabase } from '../context/SupabaseContext'
import { useAuthWallContext } from '../context/AuthWallContext'
import { useUI } from '../context/UIContext'

const NUDGE_KEY = 'tracker_v2_sunk_cost_nudge_dismissed'
const SESSION_START_KEY = 'tracker_v2_session_start'
/** Time in ms before the nudge appears (2 minutes) */
const TIME_THRESHOLD_MS = 2 * 60 * 1000
/** Number of distinct view navigations to trigger the nudge */
const VIEW_CLICK_THRESHOLD = 3

export function SunkCostNudge() {
  const { session } = useSupabase()
  const { showAuthWall } = useAuthWallContext()
  const { activeView } = useUI()

  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(NUDGE_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [visible, setVisible] = useState(false)

  // Track distinct view navigations
  const viewClicksRef = useRef(0)
  const prevViewRef = useRef(activeView)

  // Record session start time once
  useEffect(() => {
    try {
      if (!sessionStorage.getItem(SESSION_START_KEY)) {
        sessionStorage.setItem(SESSION_START_KEY, String(Date.now()))
      }
    } catch { /* ignore */ }
  }, [])

  // Count distinct view changes
  useEffect(() => {
    if (activeView !== prevViewRef.current) {
      viewClicksRef.current += 1
      prevViewRef.current = activeView
    }
  }, [activeView])

  // Check triggers: time-based OR interaction-based
  useEffect(() => {
    if (session || dismissed) {
      setVisible(false)
      return
    }

    // Check every 5 seconds
    const interval = setInterval(() => {
      // View click threshold
      if (viewClicksRef.current >= VIEW_CLICK_THRESHOLD) {
        setVisible(true)
        clearInterval(interval)
        return
      }
      // Time threshold
      try {
        const start = sessionStorage.getItem(SESSION_START_KEY)
        if (start && Date.now() - Number(start) >= TIME_THRESHOLD_MS) {
          setVisible(true)
          clearInterval(interval)
        }
      } catch { /* ignore */ }
    }, 5000)

    return () => clearInterval(interval)
  }, [session, dismissed])

  const handleDismiss = useCallback(() => {
    setVisible(false)
    setDismissed(true)
    try {
      localStorage.setItem(NUDGE_KEY, 'true')
    } catch { /* ignore */ }
  }, [])

  const handleStartBot = useCallback(() => {
    handleDismiss()
    showAuthWall('start_bot', () => {})
  }, [handleDismiss, showAuthWall])

  if (!visible) return null

  return (
    <div style={styles.toast}>
      <div style={styles.content}>
        <Bot size={16} color="var(--accent)" style={{ flexShrink: 0 }} />
        <div style={styles.textWrap}>
          <span style={styles.title}>
            Like what you see?
          </span>
          <span style={styles.subtitle}>
            Start the auto-apply bot and get real results like these.
          </span>
        </div>
      </div>
      <div style={styles.actions}>
        <button style={styles.ctaBtn} onClick={handleStartBot}>
          Start Bot
          <ArrowRight size={14} />
        </button>
        <button
          style={styles.dismissBtn}
          onClick={handleDismiss}
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  toast: {
    position: 'fixed',
    bottom: 20,
    right: 20,
    zIndex: 8000,
    maxWidth: 420,
    width: 'calc(100% - 40px)',
    background: 'var(--bg-surface)',
    border: '1px solid rgba(52, 211, 153, 0.25)',
    borderRadius: 12,
    padding: '14px 16px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    animation: 'slideUp 0.3s ease',
  },
  content: {
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
  },
  textWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  subtitle: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    lineHeight: 1.4,
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ctaBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: '#000',
    background: 'var(--accent)',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  dismissBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    background: 'transparent',
    border: 'none',
    color: 'var(--text-tertiary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
}
