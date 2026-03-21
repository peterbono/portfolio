import { useState, useCallback, useEffect } from 'react'
import {
  Bot,
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Search,
  MapPin,
  DollarSign,
  Wifi,
  Building2,
  Trash2,
  Sparkles,
  SkipForward,
  Eye,
  ThumbsDown,
} from 'lucide-react'
import { useBotActivity } from '../hooks/useBotActivity'
import type { BotActivityItem, BotRunStatus } from '../hooks/useBotActivity'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface SearchProfile {
  id: string
  name: string
  keywords: string[]
  location: string
  minSalary: number
  remoteOnly: boolean
  excludedCompanies: string[]
  createdAt: string
}

const LS_KEY = 'tracker_v2_search_profiles'

function loadProfiles(): SearchProfile[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveProfiles(profiles: SearchProfile[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(profiles))
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/*  Mock activity data (fallback when no real data)                     */
/* ------------------------------------------------------------------ */
const MOCK_ACTIVITY = [
  {
    time: '10:23',
    text: 'Applied to "Senior Product Designer" at Canva via Greenhouse',
    status: 'success' as const,
  },
  {
    time: '10:21',
    text: 'Skipped "UX Lead" at Meta \u2014 timezone incompatible (PST)',
    status: 'skipped' as const,
  },
  {
    time: '10:19',
    text: 'Applied to "Product Designer" at Wise via Lever',
    status: 'success' as const,
  },
  {
    time: '10:15',
    text: 'Error: CV upload failed at Ashby \u2014 marked "\u00c0 soumettre"',
    status: 'error' as const,
  },
]

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  success: CheckCircle2,
  skipped: AlertTriangle,
  error: XCircle,
}

const STATUS_COLOR: Record<string, string> = {
  success: '#34d399',
  skipped: '#fbbf24',
  error: '#f43f5e',
}

/* ------------------------------------------------------------------ */
/*  Activity helpers                                                    */
/* ------------------------------------------------------------------ */
const ACTION_ICON_MAP: Record<string, typeof CheckCircle2> = {
  applied: CheckCircle2,
  skipped: SkipForward,
  failed: XCircle,
  found: Eye,
  qualified: CheckCircle2,
  disqualified: ThumbsDown,
}

const ACTION_COLOR_MAP: Record<string, string> = {
  applied: '#34d399',
  skipped: '#fbbf24',
  failed: '#f43f5e',
  found: '#60a5fa',
  qualified: '#34d399',
  disqualified: '#f97316',
}

function formatActivityTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return '--:--'
  }
}

function formatActivityText(item: BotActivityItem): string {
  const atsLabel = item.ats ? ` via ${item.ats}` : ''
  switch (item.action) {
    case 'applied':
      return `Applied to "${item.role}" at ${item.company}${atsLabel}`
    case 'skipped':
      return `Skipped "${item.role}" at ${item.company}${item.reason ? ` \u2014 ${item.reason}` : ''}`
    case 'failed':
      return `Failed "${item.role}" at ${item.company}${item.reason ? ` \u2014 ${item.reason}` : ''}`
    case 'found':
      return `Found "${item.role}" at ${item.company}${atsLabel}`
    case 'qualified':
      return `Qualified "${item.role}" at ${item.company}`
    case 'disqualified':
      return `Disqualified "${item.role}" at ${item.company}${item.reason ? ` \u2014 ${item.reason}` : ''}`
    default:
      return `${item.action} "${item.role}" at ${item.company}`
  }
}

function activityStatusKey(action: string): string {
  if (action === 'applied' || action === 'qualified') return 'success'
  if (action === 'skipped' || action === 'disqualified') return 'skipped'
  if (action === 'failed') return 'error'
  return 'success'
}

/* ------------------------------------------------------------------ */
/*  Status banner helpers                                              */
/* ------------------------------------------------------------------ */
interface StatusConfig {
  label: string
  description: string
  dotColor: string
  pulsing: boolean
  badgeLabel?: string
  badgeColor?: string
  badgeBg?: string
}

function getStatusConfig(run: BotRunStatus | null): StatusConfig {
  if (!run) {
    return {
      label: 'Bot Inactive',
      description: 'Set up your search profile to get started',
      dotColor: '#6b7280',
      pulsing: false,
      badgeLabel: 'Coming Soon',
      badgeColor: '#fbbf24',
      badgeBg: 'rgba(251, 191, 36, 0.12)',
    }
  }

  switch (run.status) {
    case 'pending':
      return {
        label: 'Bot Queued',
        description: 'Starting soon...',
        dotColor: '#fbbf24',
        pulsing: false,
      }
    case 'running':
      return {
        label: 'Bot Running',
        description: `Applied ${run.jobsApplied}, Found ${run.jobsFound}, Skipped ${run.jobsSkipped}`,
        dotColor: '#34d399',
        pulsing: true,
      }
    case 'completed':
      return {
        label: 'Last run completed',
        description: `Applied ${run.jobsApplied} job${run.jobsApplied !== 1 ? 's' : ''}`,
        dotColor: '#34d399',
        pulsing: false,
      }
    case 'failed':
      return {
        label: 'Last run failed',
        description: run.errorMessage || 'Unknown error',
        dotColor: '#f43f5e',
        pulsing: false,
      }
    case 'cancelled':
      return {
        label: 'Run cancelled',
        description: `Applied ${run.jobsApplied} before cancellation`,
        dotColor: '#6b7280',
        pulsing: false,
      }
    default:
      return {
        label: 'Bot Inactive',
        description: 'Set up your search profile to get started',
        dotColor: '#6b7280',
        pulsing: false,
      }
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function AutopilotView() {
  const [profiles, setProfiles] = useState<SearchProfile[]>(loadProfiles)
  const [showForm, setShowForm] = useState(false)

  // Realtime bot data
  const { activities, currentRun, isLive } = useBotActivity()
  const hasRealData = activities.length > 0 || currentRun !== null

  // Form state
  const [formName, setFormName] = useState('')
  const [formKeywords, setFormKeywords] = useState('')
  const [formLocation, setFormLocation] = useState('')
  const [formSalary, setFormSalary] = useState('')
  const [formRemote, setFormRemote] = useState(false)
  const [formExcluded, setFormExcluded] = useState('')

  // Persist on change
  useEffect(() => {
    saveProfiles(profiles)
  }, [profiles])

  const resetForm = useCallback(() => {
    setFormName('')
    setFormKeywords('')
    setFormLocation('')
    setFormSalary('')
    setFormRemote(false)
    setFormExcluded('')
  }, [])

  const handleSave = useCallback(() => {
    if (!formName.trim()) return
    const newProfile: SearchProfile = {
      id: crypto.randomUUID(),
      name: formName.trim(),
      keywords: formKeywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
      location: formLocation.trim(),
      minSalary: parseInt(formSalary) || 0,
      remoteOnly: formRemote,
      excludedCompanies: formExcluded
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
      createdAt: new Date().toISOString(),
    }
    setProfiles((prev) => [...prev, newProfile])
    resetForm()
    setShowForm(false)
  }, [formName, formKeywords, formLocation, formSalary, formRemote, formExcluded, resetForm])

  const handleDelete = useCallback((id: string) => {
    setProfiles((prev) => prev.filter((p) => p.id !== id))
  }, [])

  // Status banner config
  const statusCfg = getStatusConfig(currentRun)

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Autopilot</h1>
        <p style={styles.subtitle}>Automated job search and application bot</p>
      </div>

      {/* 1 -- Status Banner */}
      <section style={styles.statusBanner}>
        <div style={styles.statusRow}>
          <div style={styles.statusLeft}>
            <div style={styles.botIconWrap}>
              <Bot size={24} color="var(--text-secondary)" />
            </div>
            <div>
              <div style={styles.statusTitle}>
                <span
                  style={{
                    ...styles.statusDot,
                    background: statusCfg.dotColor,
                    ...(statusCfg.pulsing
                      ? {
                          animation: 'pulseGlow 1.5s ease-in-out infinite',
                          boxShadow: `0 0 6px ${statusCfg.dotColor}`,
                        }
                      : {}),
                  }}
                />
                {statusCfg.label}
                {isLive && (
                  <span style={styles.liveBadge}>
                    <span style={styles.liveDot} />
                    LIVE
                  </span>
                )}
              </div>
              <p style={styles.statusDesc}>{statusCfg.description}</p>
            </div>
          </div>
          {statusCfg.badgeLabel && (
            <span
              style={{
                ...styles.comingSoonBadge,
                color: statusCfg.badgeColor,
                background: statusCfg.badgeBg,
              }}
            >
              {statusCfg.badgeLabel}
            </span>
          )}
        </div>
      </section>

      {/* 2 -- Search Profiles */}
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <div>
            <h2 style={styles.sectionTitle}>Search Profiles</h2>
            <p style={styles.sectionSubtitle}>
              Define what jobs the bot should look for
            </p>
          </div>
          {profiles.length > 0 && !showForm && (
            <button
              style={styles.btnPrimary}
              onClick={() => setShowForm(true)}
            >
              <Plus size={14} />
              <span>New Profile</span>
            </button>
          )}
        </div>

        {/* Profile list */}
        {profiles.length > 0 && (
          <div style={styles.profileList}>
            {profiles.map((p) => (
              <div key={p.id} style={styles.profileCard}>
                <div style={styles.profileTop}>
                  <span style={styles.profileName}>{p.name}</span>
                  <button
                    style={styles.deleteBtn}
                    onClick={() => handleDelete(p.id)}
                    title="Delete profile"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div style={styles.profileMeta}>
                  {p.keywords.length > 0 && (
                    <div style={styles.metaItem}>
                      <Search size={12} color="var(--text-tertiary)" />
                      <span style={styles.metaText}>
                        {p.keywords.join(', ')}
                      </span>
                    </div>
                  )}
                  {p.location && (
                    <div style={styles.metaItem}>
                      <MapPin size={12} color="var(--text-tertiary)" />
                      <span style={styles.metaText}>{p.location}</span>
                    </div>
                  )}
                  {p.minSalary > 0 && (
                    <div style={styles.metaItem}>
                      <DollarSign size={12} color="var(--text-tertiary)" />
                      <span style={styles.metaText}>
                        {p.minSalary.toLocaleString()} EUR min
                      </span>
                    </div>
                  )}
                  {p.remoteOnly && (
                    <div style={styles.metaItem}>
                      <Wifi size={12} color="var(--text-tertiary)" />
                      <span style={styles.metaText}>Remote only</span>
                    </div>
                  )}
                  {p.excludedCompanies.length > 0 && (
                    <div style={styles.metaItem}>
                      <Building2 size={12} color="var(--text-tertiary)" />
                      <span style={styles.metaText}>
                        {p.excludedCompanies.length} excluded
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {profiles.length === 0 && !showForm && (
          <div style={styles.emptyState}>
            <div style={styles.emptyIllustration}>
              <Sparkles size={40} color="var(--text-tertiary)" strokeWidth={1.2} />
            </div>
            <p style={styles.emptyText}>
              No search profiles yet
            </p>
            <p style={styles.emptyHint}>
              Create a profile to tell the bot what to search for
            </p>
            <button
              style={styles.btnPrimary}
              onClick={() => setShowForm(true)}
            >
              <Plus size={14} />
              <span>Create your first search profile</span>
            </button>
          </div>
        )}

        {/* Form */}
        {showForm && (
          <div style={styles.formCard}>
            <h3 style={styles.formTitle}>New Search Profile</h3>

            <div style={styles.fieldGroup}>
              <label style={styles.label}>Profile Name</label>
              <input
                style={styles.input}
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder='e.g. "Senior Product Designer APAC"'
              />
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.label}>Keywords</label>
              <p style={styles.hint}>Comma-separated search terms</p>
              <input
                style={styles.input}
                type="text"
                value={formKeywords}
                onChange={(e) => setFormKeywords(e.target.value)}
                placeholder="product designer, UX lead, design systems"
              />
            </div>

            <div style={styles.fieldRow}>
              <div style={{ flex: 1 }}>
                <label style={styles.label}>Location</label>
                <input
                  style={styles.input}
                  type="text"
                  value={formLocation}
                  onChange={(e) => setFormLocation(e.target.value)}
                  placeholder="Bangkok, Remote APAC"
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={styles.label}>Min Salary (EUR)</label>
                <input
                  style={styles.input}
                  type="number"
                  value={formSalary}
                  onChange={(e) => setFormSalary(e.target.value)}
                  placeholder="70000"
                />
              </div>
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.toggleRow}>
                <input
                  type="checkbox"
                  checked={formRemote}
                  onChange={(e) => setFormRemote(e.target.checked)}
                  style={styles.checkbox}
                />
                <span style={styles.toggleLabel}>Remote only</span>
              </label>
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.label}>Excluded Companies</label>
              <p style={styles.hint}>Comma-separated list of companies to skip</p>
              <input
                style={styles.input}
                type="text"
                value={formExcluded}
                onChange={(e) => setFormExcluded(e.target.value)}
                placeholder="Company A, Company B"
              />
            </div>

            <div style={styles.formActions}>
              <button
                style={styles.btnSecondary}
                onClick={() => {
                  resetForm()
                  setShowForm(false)
                }}
              >
                Cancel
              </button>
              <button
                style={{
                  ...styles.btnPrimary,
                  opacity: formName.trim() ? 1 : 0.5,
                }}
                onClick={handleSave}
                disabled={!formName.trim()}
              >
                Save Profile
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 3 -- Activity Log */}
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <div>
            <h2 style={styles.sectionTitle}>Bot Activity</h2>
            <p style={styles.sectionSubtitle}>
              {hasRealData ? 'Live automated actions' : 'Recent automated actions'}
            </p>
          </div>
          {!hasRealData && (
            <span style={styles.previewBadge}>Preview &mdash; sample activity</span>
          )}
          {hasRealData && isLive && (
            <span style={styles.liveIndicator}>
              <span style={styles.liveIndicatorDot} />
              Realtime
            </span>
          )}
        </div>

        {/* Real activity feed */}
        {hasRealData ? (
          <div style={styles.timeline}>
            {activities.map((item, i) => {
              const Icon = ACTION_ICON_MAP[item.action] || CheckCircle2
              const color = ACTION_COLOR_MAP[item.action] || '#60a5fa'
              const isError = item.action === 'failed'
              return (
                <div key={item.id} style={styles.timelineItem}>
                  <div style={styles.timelineIconWrap}>
                    <Icon size={14} color={color} />
                    {i < activities.length - 1 && (
                      <div style={styles.timelineLine} />
                    )}
                  </div>
                  <div style={styles.timelineContent}>
                    <span style={styles.timelineTime}>
                      <Clock size={10} color="var(--text-tertiary)" />
                      {formatActivityTime(item.createdAt)}
                    </span>
                    <span
                      style={{
                        ...styles.timelineText,
                        color: isError ? '#f87171' : 'var(--text-primary)',
                      }}
                    >
                      {formatActivityText(item)}
                    </span>
                  </div>
                </div>
              )
            })}
            {activities.length === 0 && (
              <p style={styles.emptyTimelineText}>
                No activity yet for the current run.
              </p>
            )}
          </div>
        ) : (
          /* Mock fallback */
          <div style={styles.timeline}>
            {MOCK_ACTIVITY.map((item, i) => {
              const Icon = STATUS_ICON[item.status]
              const color = STATUS_COLOR[item.status]
              return (
                <div key={i} style={styles.timelineItem}>
                  <div style={styles.timelineIconWrap}>
                    <Icon size={14} color={color} />
                    {i < MOCK_ACTIVITY.length - 1 && (
                      <div style={styles.timelineLine} />
                    )}
                  </div>
                  <div style={styles.timelineContent}>
                    <span style={{ ...styles.timelineTime }}>
                      <Clock size={10} color="var(--text-tertiary)" />
                      {item.time}
                    </span>
                    <span
                      style={{
                        ...styles.timelineText,
                        color:
                          item.status === 'error'
                            ? '#f87171'
                            : 'var(--text-primary)',
                      }}
                    >
                      {item.text}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Keyframe injection for pulsing dot */}
      <style>{`
        @keyframes pulseGlow {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.3); }
        }
        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */
const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    overflow: 'auto',
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  header: {
    marginBottom: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--text-primary)',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
  },

  /* ---- Status Banner ---- */
  statusBanner: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: 24,
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap' as const,
  },
  statusLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  botIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  statusTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-primary)',
    marginBottom: 2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#6b7280',
    flexShrink: 0,
  },
  statusDesc: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
    marginTop: 2,
  },
  comingSoonBadge: {
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: 20,
    background: 'rgba(251, 191, 36, 0.12)',
    color: '#fbbf24',
    whiteSpace: 'nowrap' as const,
    letterSpacing: '0.02em',
    textTransform: 'uppercase' as const,
  },

  /* ---- LIVE badge ---- */
  liveBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 12,
    background: 'rgba(52, 211, 153, 0.12)',
    color: '#34d399',
    letterSpacing: '0.05em',
    textTransform: 'uppercase' as const,
    marginLeft: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#34d399',
    animation: 'livePulse 1.5s ease-in-out infinite',
    flexShrink: 0,
  },

  /* ---- Sections ---- */
  section: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: 20,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
    flexWrap: 'wrap' as const,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: 2,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
  },

  /* ---- Empty State ---- */
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 16px',
    gap: 8,
  },
  emptyIllustration: {
    width: 72,
    height: 72,
    borderRadius: 16,
    background: 'var(--bg-elevated)',
    border: '1px dashed var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--text-secondary)',
  },
  emptyHint: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    marginBottom: 8,
  },

  /* ---- Profile List ---- */
  profileList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginBottom: 8,
  },
  profileCard: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: '12px 16px',
  },
  profileTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  profileName: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  deleteBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-tertiary)',
    cursor: 'pointer',
    padding: 4,
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 0.15s',
  },
  profileMeta: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 12,
  },
  metaItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
  },

  /* ---- Form ---- */
  formCard: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: 20,
  },
  formTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary)',
    marginBottom: 16,
  },
  fieldGroup: {
    marginBottom: 14,
  },
  fieldRow: {
    display: 'flex',
    gap: 12,
    marginBottom: 14,
  },
  label: {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-tertiary)',
    marginBottom: 6,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
  },
  hint: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: '8px 12px',
    color: 'var(--text-primary)',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
  },
  checkbox: {
    accentColor: 'var(--accent)',
    width: 16,
    height: 16,
    cursor: 'pointer',
  },
  toggleLabel: {
    fontSize: 13,
    color: 'var(--text-primary)',
  },
  formActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },

  /* ---- Buttons ---- */
  btnPrimary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'var(--accent)',
    color: '#09090b',
    fontWeight: 600,
    fontSize: 13,
    padding: '8px 16px',
    borderRadius: 'var(--radius-md)',
    border: 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  btnSecondary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    fontWeight: 500,
    fontSize: 13,
    padding: '8px 16px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },

  /* ---- Preview Badge ---- */
  previewBadge: {
    fontSize: 11,
    fontWeight: 500,
    padding: '3px 8px',
    borderRadius: 6,
    background: 'rgba(139, 92, 246, 0.12)',
    color: '#a78bfa',
    whiteSpace: 'nowrap' as const,
  },

  /* ---- Live Indicator (activity section) ---- */
  liveIndicator: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    fontWeight: 600,
    padding: '3px 10px',
    borderRadius: 6,
    background: 'rgba(52, 211, 153, 0.10)',
    color: '#34d399',
    whiteSpace: 'nowrap' as const,
    letterSpacing: '0.02em',
  },
  liveIndicatorDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#34d399',
    animation: 'livePulse 1.5s ease-in-out infinite',
    flexShrink: 0,
  },

  /* ---- Timeline ---- */
  timeline: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  timelineItem: {
    display: 'flex',
    gap: 12,
    minHeight: 44,
  },
  timelineIconWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    paddingTop: 2,
    width: 20,
    flexShrink: 0,
  },
  timelineLine: {
    flex: 1,
    width: 1,
    background: 'var(--border)',
    minHeight: 16,
  },
  timelineContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    paddingBottom: 12,
  },
  timelineTime: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    color: 'var(--text-tertiary)',
    fontVariantNumeric: 'tabular-nums',
  },
  timelineText: {
    fontSize: 13,
    color: 'var(--text-primary)',
    lineHeight: 1.4,
  },
  emptyTimelineText: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
    textAlign: 'center',
    padding: '16px 0',
  },
}
