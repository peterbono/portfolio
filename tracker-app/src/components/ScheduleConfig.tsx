import { useState, useEffect, useCallback, type CSSProperties } from 'react'
import { Clock, Zap, Power, AlertTriangle, CheckCircle, Loader2, Calendar } from 'lucide-react'
import { usePlan } from '../hooks/usePlan'
import { useSupabase } from '../context/SupabaseContext'
import { UpgradePrompt } from './UpgradePrompt'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScheduleConfig {
  enabled: boolean
  frequency: string
  lastRunAt: string | null
  lastRunStatus: string | null
  lastRunJobsFound: number | null
}

interface FrequencyOption {
  value: string
  label: string
  description: string
  runsPerDay: number
  minPlan: 'starter' | 'pro' | 'boost'
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FREQUENCY_OPTIONS: FrequencyOption[] = [
  { value: 'once_daily', label: 'Once daily', description: 'Scans once every 24 hours', runsPerDay: 1, minPlan: 'starter' },
  { value: 'twice_daily', label: 'Twice daily', description: 'Scans every 12 hours', runsPerDay: 2, minPlan: 'pro' },
  { value: 'every_12h', label: 'Every 12 hours', description: 'Scans at 12-hour intervals', runsPerDay: 2, minPlan: 'pro' },
  { value: 'every_8h', label: 'Every 8 hours', description: 'Scans 3 times per day', runsPerDay: 3, minPlan: 'pro' },
  { value: 'every_4h', label: 'Every 4 hours', description: 'Maximum frequency — 6 scans/day', runsPerDay: 6, minPlan: 'boost' },
]

const PLAN_MAX_RUNS: Record<string, number> = {
  free: 0,
  starter: 1,
  pro: 3,
  boost: 6,
}

const DEFAULT_CONFIG: ScheduleConfig = {
  enabled: false,
  frequency: 'every_8h',
  lastRunAt: null,
  lastRunStatus: null,
  lastRunJobsFound: null,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function getNextRunTime(lastRunAt: string | null, frequency: string): string {
  const gapHours: Record<string, number> = {
    every_4h: 4,
    every_8h: 8,
    every_12h: 12,
    twice_daily: 12,
    once_daily: 24,
  }
  const gap = gapHours[frequency] ?? 8
  const base = lastRunAt ? new Date(lastRunAt) : new Date()
  const next = new Date(base.getTime() + gap * 60 * 60 * 1000)

  // If next run is in the past (e.g. first enable), show "soon"
  if (next.getTime() < Date.now()) return 'Soon'

  const diffMs = next.getTime() - Date.now()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 60) return `in ${diffMins}m`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `in ${diffHours}h ${diffMins % 60}m`
  return next.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScheduleConfig() {
  const { plan, effectivePlan } = usePlan()
  const { user, supabase } = useSupabase()

  const [config, setConfig] = useState<ScheduleConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const isFree = plan === 'free'
  const maxRuns = PLAN_MAX_RUNS[plan] ?? 0

  // ─── Fetch current config on mount ───
  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }

    let cancelled = false

    async function fetchConfig() {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token
        if (!token || cancelled) return

        const res = await fetch('/api/update-schedule', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('Failed to fetch schedule config')
        const data = await res.json()
        if (!cancelled) {
          setConfig(data.schedule_config ?? DEFAULT_CONFIG)
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[ScheduleConfig] fetch error:', (err as Error).message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchConfig()
    return () => { cancelled = true }
  }, [user, supabase.auth])

  // ─── Save config to API ───
  const saveConfig = useCallback(async (updates: Partial<ScheduleConfig>) => {
    if (!user) return

    setSaving(true)
    setError(null)
    setSaveSuccess(false)

    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      if (!token) throw new Error('Not authenticated')

      const res = await fetch('/api/update-schedule', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(updates),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Failed to save schedule')
        return
      }

      setConfig(data.schedule_config)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }, [user, supabase.auth])

  // ─── Toggle handler ───
  const handleToggle = useCallback(() => {
    saveConfig({ enabled: !config.enabled })
  }, [config.enabled, saveConfig])

  // ─── Frequency change handler ───
  const handleFrequencyChange = useCallback((frequency: string) => {
    saveConfig({ frequency })
  }, [saveConfig])

  // ─── Free plan: show upgrade prompt ───
  if (isFree) {
    return (
      <div>
        <div style={styles.disabledOverlay}>
          <div style={styles.featurePreview}>
            <Clock size={20} color="var(--text-tertiary)" />
            <div>
              <div style={styles.previewTitle}>Auto-scan for new jobs</div>
              <div style={styles.previewDesc}>
                Automatically scan for matching jobs on a schedule. New listings are qualified and added to your review queue.
              </div>
            </div>
          </div>
        </div>
        <UpgradePrompt feature="Scheduled Scans" requiredPlan="starter" variant="inline" />
      </div>
    )
  }

  if (loading) {
    return (
      <div style={styles.loadingWrap}>
        <Loader2 size={16} color="var(--text-tertiary)" style={{ animation: 'spin 1s linear infinite' }} />
        <span style={styles.loadingText}>Loading schedule...</span>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      {/* Toggle + Status Row */}
      <div style={styles.toggleRow}>
        <div style={styles.toggleLeft}>
          <Power size={16} color={config.enabled ? '#34d399' : 'var(--text-tertiary)'} />
          <div>
            <div style={styles.toggleLabel}>Auto-scan for new jobs</div>
            <div style={styles.toggleDesc}>
              {config.enabled
                ? 'Scans run automatically on schedule'
                : 'Enable to automatically discover new jobs'}
            </div>
          </div>
        </div>
        <button
          style={{
            ...styles.toggleButton,
            background: config.enabled ? '#34d399' : 'rgba(255,255,255,0.08)',
          }}
          onClick={handleToggle}
          disabled={saving}
          aria-label="Toggle scheduled scans"
        >
          <div style={{
            ...styles.toggleKnob,
            transform: config.enabled ? 'translateX(16px)' : 'translateX(2px)',
          }} />
        </button>
      </div>

      {/* Frequency Selector (only when enabled) */}
      {config.enabled && (
        <div style={styles.frequencySection}>
          <label style={styles.label}>Scan Frequency</label>
          <div style={styles.frequencyGrid}>
            {FREQUENCY_OPTIONS.map(opt => {
              const allowed = maxRuns >= opt.runsPerDay
              const isSelected = config.frequency === opt.value
              return (
                <button
                  key={opt.value}
                  style={{
                    ...styles.frequencyCard,
                    borderColor: isSelected ? '#34d399' : 'var(--border)',
                    background: isSelected
                      ? 'rgba(52, 211, 153, 0.08)'
                      : 'rgba(255,255,255,0.02)',
                    opacity: allowed ? 1 : 0.45,
                    cursor: allowed ? 'pointer' : 'not-allowed',
                  }}
                  onClick={() => allowed && handleFrequencyChange(opt.value)}
                  disabled={!allowed || saving}
                >
                  <div style={styles.freqCardHeader}>
                    <span style={{
                      ...styles.freqLabel,
                      color: isSelected ? '#34d399' : 'var(--text-primary)',
                    }}>{opt.label}</span>
                    {!allowed && (
                      <span style={styles.planBadge}>{opt.minPlan}</span>
                    )}
                    {isSelected && <CheckCircle size={14} color="#34d399" />}
                  </div>
                  <div style={styles.freqDesc}>{opt.description}</div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Status Info */}
      {config.enabled && (
        <div style={styles.statusSection}>
          {/* Next Run */}
          <div style={styles.statusRow}>
            <Calendar size={14} color="var(--text-tertiary)" />
            <span style={styles.statusLabel}>Next scan:</span>
            <span style={styles.statusValue}>
              {getNextRunTime(config.lastRunAt, config.frequency)}
            </span>
          </div>

          {/* Last Run */}
          {config.lastRunAt && (
            <div style={styles.statusRow}>
              {config.lastRunStatus === 'error' ? (
                <AlertTriangle size={14} color="#f43f5e" />
              ) : (
                <CheckCircle size={14} color="#34d399" />
              )}
              <span style={styles.statusLabel}>Last run:</span>
              <span style={styles.statusValue}>
                {formatRelativeTime(config.lastRunAt)}
                {config.lastRunStatus === 'error' && (
                  <span style={{ color: '#f43f5e', marginLeft: 8 }}>Failed</span>
                )}
                {config.lastRunStatus === 'triggered' && (
                  <span style={{ color: '#34d399', marginLeft: 8 }}>Success</span>
                )}
                {config.lastRunJobsFound !== null && config.lastRunJobsFound > 0 && (
                  <span style={{ color: 'var(--text-tertiary)', marginLeft: 8 }}>
                    {config.lastRunJobsFound} jobs found
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Saving indicator */}
      {saving && (
        <div style={styles.savingBar}>
          <Loader2 size={12} color="var(--text-tertiary)" style={{ animation: 'spin 1s linear infinite' }} />
          <span style={styles.savingText}>Saving...</span>
        </div>
      )}

      {/* Success feedback */}
      {saveSuccess && (
        <div style={styles.successBar}>
          <CheckCircle size={12} color="#34d399" />
          <span style={styles.successText}>Schedule updated</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={styles.errorBar}>
          <AlertTriangle size={12} color="#f43f5e" />
          <span style={styles.errorText}>{error}</span>
        </div>
      )}

      {/* Plan info */}
      <div style={styles.planInfo}>
        <Zap size={12} color="var(--text-tertiary)" />
        <span style={styles.planInfoText}>
          Your <strong>{effectivePlan}</strong> plan allows up to {maxRuns}x scans/day.
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  loadingWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 0',
  },
  loadingText: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
  },

  // ── Toggle row ──
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  toggleLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  toggleDesc: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    marginTop: 2,
  },
  toggleButton: {
    position: 'relative' as const,
    width: 38,
    height: 22,
    borderRadius: 11,
    border: 'none',
    cursor: 'pointer',
    transition: 'background 0.2s',
    flexShrink: 0,
    padding: 0,
  },
  toggleKnob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    background: '#fff',
    transition: 'transform 0.2s',
    position: 'absolute' as const,
    top: 2,
  },

  // ── Frequency selector ──
  frequencySection: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
  frequencyGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 8,
  },
  frequencyCard: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    textAlign: 'left' as const,
    color: 'inherit',
    transition: 'border-color 0.15s, background 0.15s',
  },
  freqCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  freqLabel: {
    fontSize: 13,
    fontWeight: 600,
    flex: 1,
  },
  freqDesc: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
    lineHeight: 1.4,
  },
  planBadge: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    color: '#8b5cf6',
    background: 'rgba(139, 92, 246, 0.1)',
    border: '1px solid rgba(139, 92, 246, 0.2)',
    borderRadius: 4,
    padding: '1px 5px',
    letterSpacing: '0.03em',
  },

  // ── Status section ──
  statusSection: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid var(--border)',
    borderRadius: 8,
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
  },
  statusLabel: {
    color: 'var(--text-tertiary)',
  },
  statusValue: {
    color: 'var(--text-primary)',
    fontWeight: 500,
  },

  // ── Saving / success / error bars ──
  savingBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 0',
  },
  savingText: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
  },
  successBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 0',
  },
  successText: {
    fontSize: 12,
    color: '#34d399',
  },
  errorBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 10px',
    background: 'rgba(244, 63, 94, 0.06)',
    border: '1px solid rgba(244, 63, 94, 0.15)',
    borderRadius: 6,
  },
  errorText: {
    fontSize: 12,
    color: '#f43f5e',
  },

  // ── Plan info ──
  planInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 0',
  },
  planInfoText: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
  },

  // ── Disabled / free plan overlay ──
  disabledOverlay: {
    opacity: 0.5,
    pointerEvents: 'none' as const,
    marginBottom: 8,
  },
  featurePreview: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '12px 0',
  },
  previewTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  previewDesc: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    marginTop: 2,
    lineHeight: 1.5,
  },
}
