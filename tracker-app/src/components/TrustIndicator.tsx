import { useState, useEffect, useCallback } from 'react'
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  ChevronDown,
  ChevronUp,
  X,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
} from 'lucide-react'

type BotStatus = 'safe' | 'paused' | 'off'

interface ActivityEntry {
  time: string
  text: string
  type: 'success' | 'skip' | 'error'
}

const STATUS_CONFIG: Record<BotStatus, {
  label: string
  color: string
  bg: string
  Icon: typeof Shield
}> = {
  safe: {
    label: 'Bot: Safe',
    color: '#34d399',
    bg: 'rgba(52, 211, 153, 0.1)',
    Icon: ShieldCheck,
  },
  paused: {
    label: 'Bot: Paused',
    color: '#fbbf24',
    bg: 'rgba(251, 191, 36, 0.1)',
    Icon: ShieldAlert,
  },
  off: {
    label: 'Bot: Off',
    color: '#71717a',
    bg: 'rgba(113, 113, 122, 0.1)',
    Icon: ShieldOff,
  },
}

const ACTIVITY_ICON: Record<string, typeof CheckCircle2> = {
  success: CheckCircle2,
  skip: AlertTriangle,
  error: XCircle,
}

const ACTIVITY_COLOR: Record<string, string> = {
  success: '#34d399',
  skip: '#fbbf24',
  error: '#f43f5e',
}

function getRecentActivity(): ActivityEntry[] {
  // Try to read from localStorage for real activity
  try {
    const raw = localStorage.getItem('tracker_v2_bot_activity')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.slice(0, 3)
    }
  } catch { /* ignore */ }

  // No real activity found
  return []
}

function getBotStatus(): BotStatus {
  try {
    const raw = localStorage.getItem('tracker_v2_bot_mode')
    if (raw === 'paused') return 'paused'
    if (raw === 'off' || raw === 'disabled') return 'off'
  } catch { /* ignore */ }
  return 'safe'
}

export function TrustIndicator() {
  const [expanded, setExpanded] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [status, setStatus] = useState<BotStatus>('safe')
  const [activities, setActivities] = useState<ActivityEntry[]>([])

  useEffect(() => {
    setStatus(getBotStatus())
    setActivities(getRecentActivity())

    // Poll for status changes
    const interval = setInterval(() => {
      setStatus(getBotStatus())
      setActivities(getRecentActivity())
    }, 5000)

    return () => clearInterval(interval)
  }, [])

  const handleDismiss = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setDismissed(true)
  }, [])

  if (dismissed) return null

  const config = STATUS_CONFIG[status]
  const StatusIcon = config.Icon

  return (
    <div style={styles.container}>
      {/* Expanded panel */}
      {expanded && (
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <span style={styles.panelTitle}>Bot Activity</span>
            <button onClick={handleDismiss} style={styles.closeBtn} aria-label="Dismiss bot activity panel">
              <X size={14} />
            </button>
          </div>

          {/* Activity list */}
          <div style={styles.activityList}>
            {activities.length === 0 ? (
              <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                No recent activity
              </div>
            ) : (
              activities.map((activity, i) => {
                const Icon = ACTIVITY_ICON[activity.type] ?? Clock
                const color = ACTIVITY_COLOR[activity.type] ?? 'var(--text-tertiary)'
                return (
                  <div key={i} style={styles.activityItem}>
                    <Icon size={14} color={color} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={styles.activityText}>{activity.text}</p>
                      <span style={styles.activityTime}>{activity.time}</span>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Trust message */}
          <div style={styles.trustMessage}>
            <Shield size={12} color="var(--accent)" />
            <span>The bot applies within your configured rules</span>
          </div>

          {/* Link to full log */}
          <button
            onClick={() => {
              // This would navigate to the autopilot view in the real app
              setExpanded(false)
            }}
            style={styles.viewLogBtn}
          >
            View full activity log
          </button>
        </div>
      )}

      {/* Pill */}
      <button
        onClick={() => setExpanded(!expanded)}
        aria-label={`${config.label} — ${expanded ? 'collapse' : 'expand'} activity panel`}
        aria-expanded={expanded}
        style={{
          ...styles.pill,
          border: `1px solid ${config.color}33`,
        }}
      >
        <StatusIcon size={14} color={config.color} />
        <span style={{ ...styles.pillLabel, color: config.color }}>
          {config.label}
        </span>
        {expanded
          ? <ChevronDown size={12} color="var(--text-tertiary)" />
          : <ChevronUp size={12} color="var(--text-tertiary)" />
        }
      </button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    bottom: 20,
    right: 20,
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 8,
  },
  pill: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 20,
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    cursor: 'pointer',
    transition: 'all 200ms ease',
    boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
  },
  pillLabel: {
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.01em',
  },
  panel: {
    width: 300,
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-xl)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    overflow: 'hidden',
  },
  panelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 14px',
    borderBottom: '1px solid var(--border)',
  },
  panelTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  closeBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
    borderRadius: 4,
    color: 'var(--text-tertiary)',
    cursor: 'pointer',
    transition: 'color 150ms ease',
  },
  activityList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    padding: '8px 0',
  },
  activityItem: {
    display: 'flex',
    gap: 10,
    padding: '8px 14px',
  },
  activityText: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    lineHeight: 1.4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  activityTime: {
    fontSize: 10,
    color: 'var(--text-tertiary)',
  },
  trustMessage: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 14px',
    borderTop: '1px solid var(--border)',
    fontSize: 11,
    color: 'var(--text-tertiary)',
    fontStyle: 'italic',
  },
  viewLogBtn: {
    width: '100%',
    padding: '10px 14px',
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--accent)',
    borderTop: '1px solid var(--border)',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'background 150ms ease',
  },
}
