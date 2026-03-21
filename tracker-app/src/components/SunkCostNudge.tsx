import { useState, useEffect, useCallback } from 'react'
import { Shield, X, ArrowRight } from 'lucide-react'
import { useSupabase } from '../context/SupabaseContext'
import { useAuthWallContext } from '../context/AuthWallContext'

const NUDGE_KEY = 'tracker_v2_sunk_cost_nudge_dismissed'
const NUDGE_THRESHOLD = 5

interface SunkCostNudgeProps {
  /** Total number of manually-added (non-demo) jobs */
  manualJobCount: number
}

export function SunkCostNudge({ manualJobCount }: SunkCostNudgeProps) {
  const { session } = useSupabase()
  const { showAuthWall } = useAuthWallContext()
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(NUDGE_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Show nudge if: not authenticated, not dismissed, >= threshold jobs
    if (!session && !dismissed && manualJobCount >= NUDGE_THRESHOLD) {
      // Small delay so it doesn't flash on page load
      const timer = setTimeout(() => setVisible(true), 2000)
      return () => clearTimeout(timer)
    }
    setVisible(false)
  }, [session, dismissed, manualJobCount])

  const handleDismiss = useCallback(() => {
    setVisible(false)
    setDismissed(true)
    try {
      localStorage.setItem(NUDGE_KEY, 'true')
    } catch { /* ignore */ }
  }, [])

  const handleSignUp = useCallback(() => {
    handleDismiss()
    showAuthWall('save_cloud', () => {})
  }, [handleDismiss, showAuthWall])

  if (!visible) return null

  return (
    <div style={styles.toast}>
      <div style={styles.content}>
        <Shield size={16} color="var(--accent)" style={{ flexShrink: 0 }} />
        <div style={styles.textWrap}>
          <span style={styles.title}>
            You've tracked {manualJobCount} jobs!
          </span>
          <span style={styles.subtitle}>
            Create a free account to keep your data safe and unlock auto-apply.
          </span>
        </div>
      </div>
      <div style={styles.actions}>
        <button style={styles.ctaBtn} onClick={handleSignUp}>
          Sign up free
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
