import { useState, useCallback, useRef, useEffect, type CSSProperties, type ReactNode } from 'react'
import {
  User,
  Search,
  Bell,
  CreditCard,
  Shield,
  Bot,
  Mail,
  Database,
  ChevronDown,
  ChevronRight,
  MapPin,
  Briefcase,
  Clock,
  DollarSign,
  Building2,
  Zap,
  AlertTriangle,
  Trash2,
  Download,
  Upload,
  ExternalLink,
  Eye,
  Play,
  Pause,
  RefreshCw,
} from 'lucide-react'
import { useJobs } from '../context/JobsContext'
import { useGmailAPI } from '../hooks/useGmailAPI'
import { useSupabase } from '../context/SupabaseContext'
import { usePlan } from '../hooks/usePlan'
import { useUI } from '../context/UIContext'
import { useAuthWall } from '../hooks/useAuthWall'
import { getPlanConfig, createPortalSession } from '../lib/billing'
import type { Job } from '../types/job'

/* ------------------------------------------------------------------ */
/*  localStorage keys                                                   */
/* ------------------------------------------------------------------ */
const LS_PROFILE = 'tracker_v2_user_profile'
const LS_SEARCH_PREFS = 'tracker_v2_search_prefs'
const LS_NOTIFICATIONS = 'tracker_v2_notification_prefs'
const LS_BOT_PREFS = 'tracker_v2_bot_prefs'

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */
interface UserProfile {
  displayName: string
  email: string
  timezone: string
  location: string
  currentRole: string
  seniority: string
  yearsExperience: number
}

interface SearchPrefs {
  preferredRoles: string[]
  salaryMin: number
  salaryCurrency: string
  workMode: 'any' | 'remote' | 'hybrid' | 'onsite'
  excludedCompanies: string[]
}

interface NotificationPrefs {
  applicationsSubmitted: boolean
  rejectionsReceived: boolean
  interviewsScheduled: boolean
  weeklyDigest: boolean
  botErrors: boolean
}

interface BotPrefs {
  autonomy: 'preview' | 'copilot' | 'autopilot'
  maxAppliesPerDay: number
  activeHoursStart: number
  activeHoursEnd: number
  paused: boolean
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */
function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function saveJSON<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* ignore */ }
}

const DEFAULT_PROFILE: UserProfile = {
  displayName: '',
  email: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  location: '',
  currentRole: '',
  seniority: 'mid',
  yearsExperience: 3,
}

const DEFAULT_SEARCH_PREFS: SearchPrefs = {
  preferredRoles: [],
  salaryMin: 0,
  salaryCurrency: 'USD',
  workMode: 'any',
  excludedCompanies: [],
}

const DEFAULT_NOTIFICATIONS: NotificationPrefs = {
  applicationsSubmitted: true,
  rejectionsReceived: true,
  interviewsScheduled: true,
  weeklyDigest: true,
  botErrors: true,
}

const DEFAULT_BOT_PREFS: BotPrefs = {
  autonomy: 'copilot',
  maxAppliesPerDay: 25,
  activeHoursStart: 9,
  activeHoursEnd: 18,
  paused: false,
}

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Kolkata',
  'Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney',
  'Pacific/Auckland',
]

const SENIORITY_OPTIONS = [
  { value: 'junior', label: 'Junior (0-2 yrs)' },
  { value: 'mid', label: 'Mid-level (2-5 yrs)' },
  { value: 'senior', label: 'Senior (5-8 yrs)' },
  { value: 'staff', label: 'Staff / Lead (8-12 yrs)' },
  { value: 'principal', label: 'Principal / Director (12+ yrs)' },
]

const CURRENCY_OPTIONS = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'THB', 'JPY', 'INR', 'AED']

/* ------------------------------------------------------------------ */
/*  Accordion Section Component                                         */
/* ------------------------------------------------------------------ */
function AccordionSection({
  id,
  icon,
  title,
  description,
  openSections,
  toggle,
  children,
  badge,
}: {
  id: string
  icon: ReactNode
  title: string
  description: string
  openSections: Set<string>
  toggle: (id: string) => void
  children: ReactNode
  badge?: ReactNode
}) {
  const isOpen = openSections.has(id)
  return (
    <section style={s.section}>
      <button
        style={s.sectionHeader}
        onClick={() => toggle(id)}
        aria-expanded={isOpen}
        aria-controls={`section-${id}`}
      >
        <div style={s.sectionHeaderLeft}>
          <div style={s.sectionIcon}>{icon}</div>
          <div>
            <div style={s.sectionTitle}>{title}</div>
            <div style={s.sectionDesc}>{description}</div>
          </div>
        </div>
        <div style={s.sectionHeaderRight}>
          {badge}
          {isOpen
            ? <ChevronDown size={16} color="var(--text-tertiary)" />
            : <ChevronRight size={16} color="var(--text-tertiary)" />}
        </div>
      </button>
      {isOpen && (
        <div id={`section-${id}`} style={s.sectionBody}>
          {children}
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                      */
/* ------------------------------------------------------------------ */
export function SettingsView() {
  const { jobs, addJob } = useJobs()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { requireAuth } = useAuthWall()
  const { supabase, user } = useSupabase()
  const { plan, limits, usage, remaining, loading: planLoading } = usePlan()
  const { setActiveView } = useUI()
  const isAuthenticated = !!user
  const planConfig = getPlanConfig(plan)

  // Gmail API hook
  const {
    isConnected: gmailConnected,
    isScanning: gmailScanning,
    lastScanAt: gmailLastScan,
    events: gmailEvents,
    error: gmailError,
    userEmail: gmailEmail,
    scanNow: gmailScanNow,
    needsReauth: gmailNeedsReauth,
  } = useGmailAPI()

  // Accordion state — open Profile and Gmail by default
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set(['profile', 'gmail']))
  const toggleSection = useCallback((id: string) => {
    setOpenSections(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // ---------- Profile state ----------
  const [profile, setProfile] = useState<UserProfile>(() =>
    loadJSON(LS_PROFILE, DEFAULT_PROFILE)
  )
  const [profileSaved, setProfileSaved] = useState(false)

  const updateProfile = useCallback((patch: Partial<UserProfile>) => {
    setProfile(prev => {
      const next = { ...prev, ...patch }
      saveJSON(LS_PROFILE, next)
      return next
    })
    setProfileSaved(true)
    setTimeout(() => setProfileSaved(false), 2000)
  }, [])

  // ---------- Search Preferences state ----------
  const [searchPrefs, setSearchPrefs] = useState<SearchPrefs>(() =>
    loadJSON(LS_SEARCH_PREFS, DEFAULT_SEARCH_PREFS)
  )
  const [roleInput, setRoleInput] = useState('')
  const [excludeInput, setExcludeInput] = useState('')
  const [searchSaved, setSearchSaved] = useState(false)

  const saveSearchPrefs = useCallback((patch: Partial<SearchPrefs>) => {
    setSearchPrefs(prev => {
      const next = { ...prev, ...patch }
      saveJSON(LS_SEARCH_PREFS, next)
      return next
    })
    setSearchSaved(true)
    setTimeout(() => setSearchSaved(false), 2000)
  }, [])

  // ---------- Notification Preferences state ----------
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(() =>
    loadJSON(LS_NOTIFICATIONS, DEFAULT_NOTIFICATIONS)
  )

  const toggleNotif = useCallback((key: keyof NotificationPrefs) => {
    setNotifPrefs(prev => {
      const next = { ...prev, [key]: !prev[key] }
      saveJSON(LS_NOTIFICATIONS, next)
      return next
    })
  }, [])

  // ---------- Bot Preferences state ----------
  const [botPrefs, setBotPrefs] = useState<BotPrefs>(() =>
    loadJSON(LS_BOT_PREFS, DEFAULT_BOT_PREFS)
  )

  const updateBotPrefs = useCallback((patch: Partial<BotPrefs>) => {
    setBotPrefs(prev => {
      const next = { ...prev, ...patch }
      saveJSON(LS_BOT_PREFS, next)
      return next
    })
  }, [])

  // ---------- Gmail handlers ----------
  const handleConnectGmail = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        scopes: 'https://www.googleapis.com/auth/gmail.readonly',
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
  }, [supabase.auth])

  const handleDisconnectGmail = useCallback(async () => {
    await supabase.auth.signOut()
  }, [supabase.auth])

  // ---------- Data Management handlers ----------
  const [importStatus, setImportStatus] = useState<string | null>(null)

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(jobs, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `job-tracker-export-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [jobs])

  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      if (file.size > 10 * 1024 * 1024) {
        setImportStatus('Import failed: File too large (max 10MB)')
        setTimeout(() => setImportStatus(null), 4000)
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string) as Job[]
          if (!Array.isArray(data)) throw new Error('Expected an array')
          if (data.length > 5000) throw new Error('Too many jobs (max 5000)')
          let imported = 0
          for (const job of data) {
            if (job.id && job.company && job.role) {
              const sanitized = {
                ...job,
                company: String(job.company).slice(0, 200),
                role: String(job.role).slice(0, 200),
                notes: job.notes ? String(job.notes).slice(0, 2000) : '',
                link: job.link ? String(job.link).slice(0, 500) : '',
              }
              addJob(sanitized)
              imported++
            }
          }
          setImportStatus(`Imported ${imported} jobs successfully`)
          setTimeout(() => setImportStatus(null), 3000)
        } catch (err) {
          setImportStatus(`Import failed: ${err instanceof Error ? err.message : 'Invalid JSON'}`)
          setTimeout(() => setImportStatus(null), 4000)
        }
      }
      reader.readAsText(file)
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [addJob]
  )

  // ---------- Billing handler ----------
  const [portalLoading, setPortalLoading] = useState(false)
  const handleManageBilling = useCallback(async () => {
    setPortalLoading(true)
    try {
      const url = await createPortalSession()
      if (url && !url.includes('portal=unavailable')) {
        window.location.href = url
      } else {
        setActiveView('pricing')
      }
    } catch {
      setActiveView('pricing')
    } finally {
      setPortalLoading(false)
    }
  }, [setActiveView])

  // ---------- Delete account ----------
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  /* ================================================================== */
  /*  Responsive                                                          */
  /* ================================================================== */
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /* ================================================================== */
  /*  Render                                                              */
  /* ================================================================== */
  return (
    <div style={s.container}>
      <div style={s.header}>
        <h1 style={s.pageTitle}>Settings</h1>
        <p style={s.pageSubtitle}>Manage your account, preferences, and integrations</p>
      </div>

      <div style={{
        ...s.columnsGrid,
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
      }}>
      {/* ═══════════════ LEFT COLUMN ═══════════════ */}
      <div style={s.column}>

      {/* ─────────────── 1. Profile ─────────────── */}
      <AccordionSection
        id="profile"
        icon={<User size={18} color="var(--accent)" />}
        title="Profile"
        description="Your identity used for job applications"
        openSections={openSections}
        toggle={toggleSection}
      >
        <div style={s.profileGrid}>
          <div style={s.fieldGroup}>
            <label style={s.label}>Display Name</label>
            <input
              style={s.input}
              value={profile.displayName}
              onChange={e => updateProfile({ displayName: e.target.value })}
              placeholder="Jane Doe"
            />
          </div>
          <div style={s.fieldGroup}>
            <label style={s.label}>Email</label>
            <input
              style={s.input}
              type="email"
              value={profile.email}
              onChange={e => updateProfile({ email: e.target.value })}
              placeholder="jane@example.com"
            />
          </div>
          <div style={s.fieldGroup}>
            <label style={s.label}><Clock size={12} style={{ marginRight: 4 }} />Timezone</label>
            <select
              style={s.select}
              value={profile.timezone}
              onChange={e => updateProfile({ timezone: e.target.value })}
            >
              {TIMEZONES.map(tz => (
                <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div style={s.fieldGroup}>
            <label style={s.label}><MapPin size={12} style={{ marginRight: 4 }} />Location</label>
            <input
              style={s.input}
              value={profile.location}
              onChange={e => updateProfile({ location: e.target.value })}
              placeholder="Bangkok, Thailand"
            />
          </div>
          <div style={s.fieldGroup}>
            <label style={s.label}><Briefcase size={12} style={{ marginRight: 4 }} />Current Role</label>
            <input
              style={s.input}
              value={profile.currentRole}
              onChange={e => updateProfile({ currentRole: e.target.value })}
              placeholder="Senior Product Designer"
            />
          </div>
          <div style={s.fieldGroup}>
            <label style={s.label}>Seniority Level</label>
            <select
              style={s.select}
              value={profile.seniority}
              onChange={e => updateProfile({ seniority: e.target.value })}
            >
              {SENIORITY_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div style={{ ...s.fieldGroup, gridColumn: '1 / -1' }}>
            <label style={s.label}>Years of Experience</label>
            <input
              style={{ ...s.input, maxWidth: 120 }}
              type="number"
              min={0}
              max={50}
              value={profile.yearsExperience}
              onChange={e => updateProfile({ yearsExperience: parseInt(e.target.value) || 0 })}
            />
          </div>
        </div>
        {profileSaved && <span style={s.successText}>Profile saved</span>}
      </AccordionSection>

      {/* ─────────────── 2. Search Preferences ─────────────── */}
      <AccordionSection
        id="search"
        icon={<Search size={18} color="#60a5fa" />}
        title="Search Preferences"
        description="Define what roles and companies the bot targets"
        openSections={openSections}
        toggle={toggleSection}
      >
        {/* Preferred Roles */}
        <div style={s.fieldGroup}>
          <label style={s.label}>Preferred Roles</label>
          <p style={s.hint}>The bot will prioritize these job titles when searching</p>
          <div style={s.chipContainer}>
            {searchPrefs.preferredRoles.map((role, i) => (
              <span key={i} style={s.chip}>
                {role}
                <button
                  style={s.chipRemove}
                  onClick={() => saveSearchPrefs({
                    preferredRoles: searchPrefs.preferredRoles.filter((_, j) => j !== i),
                  })}
                  aria-label={`Remove ${role}`}
                >&times;</button>
              </span>
            ))}
          </div>
          <div style={s.inputRow}>
            <input
              style={s.input}
              value={roleInput}
              onChange={e => setRoleInput(e.target.value)}
              placeholder="e.g. Product Designer"
              onKeyDown={e => {
                if (e.key === 'Enter' && roleInput.trim()) {
                  saveSearchPrefs({
                    preferredRoles: [...searchPrefs.preferredRoles, roleInput.trim()],
                  })
                  setRoleInput('')
                }
              }}
            />
            <button
              style={s.btnSecondary}
              onClick={() => {
                if (roleInput.trim()) {
                  saveSearchPrefs({
                    preferredRoles: [...searchPrefs.preferredRoles, roleInput.trim()],
                  })
                  setRoleInput('')
                }
              }}
            >Add</button>
          </div>
        </div>

        {/* Salary Minimum */}
        <div style={s.fieldGrid}>
          <div style={s.fieldGroup}>
            <label style={s.label}><DollarSign size={12} style={{ marginRight: 4 }} />Minimum Salary (annual)</label>
            <div style={s.inputRow}>
              <select
                style={{ ...s.select, maxWidth: 90 }}
                value={searchPrefs.salaryCurrency}
                onChange={e => saveSearchPrefs({ salaryCurrency: e.target.value })}
              >
                {CURRENCY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input
                style={s.input}
                type="number"
                min={0}
                step={5000}
                value={searchPrefs.salaryMin || ''}
                onChange={e => saveSearchPrefs({ salaryMin: parseInt(e.target.value) || 0 })}
                placeholder="80000"
              />
            </div>
          </div>

          {/* Work Mode */}
          <div style={s.fieldGroup}>
            <label style={s.label}><Building2 size={12} style={{ marginRight: 4 }} />Work Arrangement</label>
            <select
              style={s.select}
              value={searchPrefs.workMode}
              onChange={e => saveSearchPrefs({ workMode: e.target.value as SearchPrefs['workMode'] })}
            >
              <option value="any">Any (Remote, Hybrid, Onsite)</option>
              <option value="remote">Remote Only</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
            </select>
          </div>
        </div>

        {/* Excluded Companies */}
        <div style={s.fieldGroup}>
          <label style={s.label}><AlertTriangle size={12} style={{ marginRight: 4 }} />Excluded Companies</label>
          <p style={s.hint}>The bot will never apply to these companies</p>
          <div style={s.chipContainer}>
            {searchPrefs.excludedCompanies.map((co, i) => (
              <span key={i} style={{ ...s.chip, background: 'rgba(244, 63, 94, 0.1)', borderColor: 'rgba(244, 63, 94, 0.2)' }}>
                {co}
                <button
                  style={{ ...s.chipRemove, color: '#f43f5e' }}
                  onClick={() => saveSearchPrefs({
                    excludedCompanies: searchPrefs.excludedCompanies.filter((_, j) => j !== i),
                  })}
                  aria-label={`Remove ${co}`}
                >&times;</button>
              </span>
            ))}
          </div>
          <div style={s.inputRow}>
            <input
              style={s.input}
              value={excludeInput}
              onChange={e => setExcludeInput(e.target.value)}
              placeholder="e.g. Acme Corp"
              onKeyDown={e => {
                if (e.key === 'Enter' && excludeInput.trim()) {
                  saveSearchPrefs({
                    excludedCompanies: [...searchPrefs.excludedCompanies, excludeInput.trim()],
                  })
                  setExcludeInput('')
                }
              }}
            />
            <button
              style={s.btnSecondary}
              onClick={() => {
                if (excludeInput.trim()) {
                  saveSearchPrefs({
                    excludedCompanies: [...searchPrefs.excludedCompanies, excludeInput.trim()],
                  })
                  setExcludeInput('')
                }
              }}
            >Add</button>
          </div>
        </div>
        {searchSaved && <span style={s.successText}>Search preferences saved</span>}
      </AccordionSection>

      {/* ─────────────── 3. Bot Preferences ─────────────── */}
      <AccordionSection
        id="bot"
        icon={<Bot size={18} color="#a855f7" />}
        title="Bot Preferences"
        description="Control how the auto-apply bot behaves"
        openSections={openSections}
        toggle={toggleSection}
        badge={botPrefs.paused ? (
          <span style={s.badgeDanger}>Paused</span>
        ) : undefined}
      >
        {/* Autonomy Level */}
        <div style={s.fieldGroup}>
          <label style={s.label}>Autonomy Level</label>
          <p style={s.hint}>Choose how independently the bot operates</p>
          <div style={s.radioGroup}>
            {([
              { value: 'preview', icon: <Eye size={14} />, label: 'Preview', desc: 'Bot finds jobs, you review and approve each one' },
              { value: 'copilot', icon: <Play size={14} />, label: 'Co-pilot', desc: 'Bot applies but asks for confirmation on edge cases' },
              { value: 'autopilot', icon: <Zap size={14} />, label: 'Autopilot', desc: 'Bot applies automatically based on your criteria' },
            ] as const).map(opt => (
              <button
                key={opt.value}
                style={{
                  ...s.radioCard,
                  ...(botPrefs.autonomy === opt.value ? s.radioCardActive : {}),
                }}
                onClick={() => updateBotPrefs({ autonomy: opt.value })}
              >
                <div style={s.radioCardIcon}>{opt.icon}</div>
                <div>
                  <div style={s.radioCardLabel}>{opt.label}</div>
                  <div style={s.radioCardDesc}>{opt.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Max Applies Per Day */}
        <div style={s.fieldGrid}>
          <div style={s.fieldGroup}>
            <label style={s.label}>Max Applications / Day</label>
            <input
              style={{ ...s.input, maxWidth: 100 }}
              type="number"
              min={1}
              max={100}
              value={botPrefs.maxAppliesPerDay}
              onChange={e => updateBotPrefs({ maxAppliesPerDay: parseInt(e.target.value) || 25 })}
            />
            <p style={s.hint}>Limit daily applications to avoid spam flags</p>
          </div>

          {/* Active Hours */}
          <div style={s.fieldGroup}>
            <label style={s.label}><Clock size={12} style={{ marginRight: 4 }} />Application Hours</label>
            <div style={s.inputRow}>
              <select
                style={s.select}
                value={botPrefs.activeHoursStart}
                onChange={e => updateBotPrefs({ activeHoursStart: parseInt(e.target.value) })}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 13, lineHeight: '36px' }}>to</span>
              <select
                style={s.select}
                value={botPrefs.activeHoursEnd}
                onChange={e => updateBotPrefs({ activeHoursEnd: parseInt(e.target.value) })}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                ))}
              </select>
            </div>
            <p style={s.hint}>Bot only applies during these hours in your timezone</p>
          </div>
        </div>

        {/* Pause Bot */}
        <div style={s.fieldGroup}>
          <button
            style={botPrefs.paused ? s.btnPrimary : s.btnDanger}
            onClick={() => updateBotPrefs({ paused: !botPrefs.paused })}
          >
            {botPrefs.paused
              ? <><Play size={14} style={{ marginRight: 6 }} />Resume Bot</>
              : <><Pause size={14} style={{ marginRight: 6 }} />Pause Bot</>}
          </button>
          {botPrefs.paused && (
            <p style={{ ...s.hint, color: '#f59e0b', marginTop: 8 }}>
              The bot is paused and will not apply to any jobs until you resume it.
            </p>
          )}
        </div>
      </AccordionSection>

      {/* ─────────────── 4. Notification Preferences ─────────────── */}
      <AccordionSection
        id="notifications"
        icon={<Bell size={18} color="#fbbf24" />}
        title="Notifications"
        description="Choose which email notifications you receive"
        openSections={openSections}
        toggle={toggleSection}
      >
        <div style={s.toggleList}>
          {([
            { key: 'applicationsSubmitted' as const, label: 'Applications Submitted', desc: 'Get notified when the bot submits an application' },
            { key: 'rejectionsReceived' as const, label: 'Rejections Received', desc: 'Get notified when a rejection email is detected' },
            { key: 'interviewsScheduled' as const, label: 'Interviews Scheduled', desc: 'Get notified when an interview invitation is detected' },
            { key: 'weeklyDigest' as const, label: 'Weekly Digest', desc: 'A summary of your job search progress every Monday' },
            { key: 'botErrors' as const, label: 'Bot Errors', desc: 'Get notified when the bot encounters an error' },
          ]).map((item, idx, arr) => (
            <div key={item.key} style={{
              ...s.toggleRow,
              borderBottom: idx < arr.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={s.toggleLabel}>{item.label}</div>
                <div style={s.toggleDesc}>{item.desc}</div>
              </div>
              <button
                style={{
                  ...s.toggle,
                  background: notifPrefs[item.key] ? 'var(--accent)' : 'var(--bg-elevated)',
                  border: notifPrefs[item.key] ? '1px solid var(--accent)' : '1px solid var(--border)',
                }}
                onClick={() => toggleNotif(item.key)}
                role="switch"
                aria-checked={notifPrefs[item.key]}
                aria-label={item.label}
              >
                <div style={{
                  ...s.toggleKnob,
                  transform: notifPrefs[item.key] ? 'translateX(16px)' : 'translateX(2px)',
                }} />
              </button>
            </div>
          ))}
        </div>
      </AccordionSection>

      </div>{/* END LEFT COLUMN */}

      {/* ═══════════════ RIGHT COLUMN ═══════════════ */}
      <div style={s.column}>

      {/* ─────────────── 5. Gmail Sync ─────────────── */}
      {isAuthenticated && (
        <AccordionSection
          id="gmail"
          icon={<Mail size={18} color="#34d399" />}
          title="Gmail Sync"
          description="Automatically detect rejections, interviews, and offers"
          openSections={openSections}
          toggle={toggleSection}
          badge={gmailConnected ? (
            <span style={s.badgeSuccess}>Connected</span>
          ) : undefined}
        >
          {gmailConnected ? (
            <>
              <div style={s.fieldGroup}>
                <div style={s.statusIndicator}>
                  <span style={s.statusDot} />
                  Gmail connected{gmailEmail ? ` as ${gmailEmail}` : ''}
                </div>
              </div>

              <div style={s.fieldGroup}>
                <label style={s.label}>Last Scan</label>
                <span style={s.value}>
                  {gmailLastScan ? (
                    <>
                      {new Date(gmailLastScan).toLocaleString()}
                      {gmailEvents.length > 0 && (
                        <span style={{ color: 'var(--text-tertiary)', marginLeft: 8 }}>
                          {gmailEvents.length} event{gmailEvents.length !== 1 ? 's' : ''} found
                        </span>
                      )}
                    </>
                  ) : 'Never'}
                </span>
              </div>

              <div style={{ ...s.fieldGroup, display: 'flex', gap: 8 }}>
                <button
                  style={{ ...s.btnPrimary, opacity: gmailScanning ? 0.6 : 1 }}
                  onClick={() => {
                    if (!requireAuth('sync_gmail', () => gmailScanNow())) return
                    gmailScanNow()
                  }}
                  disabled={gmailScanning}
                >
                  <RefreshCw size={14} style={{ marginRight: 6, ...(gmailScanning ? { animation: 'spin 1s linear infinite' } : {}) }} />
                  {gmailScanning ? 'Scanning...' : 'Scan Now'}
                </button>
                <button style={s.btnSecondary} onClick={handleDisconnectGmail}>
                  Disconnect
                </button>
              </div>

              {gmailError && (
                <div style={s.fieldGroup}>
                  <span style={s.errorText}>{gmailError}</span>
                </div>
              )}

              {gmailNeedsReauth && (
                <div style={s.fieldGroup}>
                  <button style={s.btnPrimary} onClick={handleConnectGmail}>
                    Reconnect Gmail
                  </button>
                </div>
              )}

              {gmailEvents.length > 0 && (
                <div style={s.fieldGroup}>
                  <label style={s.label}>Recent Events ({gmailEvents.length})</label>
                  <div style={s.eventList}>
                    {gmailEvents.slice(0, 10).map((evt, i) => (
                      <div key={i} style={s.eventItem}>
                        <span style={{
                          ...s.eventType,
                          color: evt.type === 'rejection' ? '#a855f7'
                            : evt.type === 'interview' ? '#60a5fa'
                            : evt.type === 'offer' ? '#fbbf24'
                            : 'var(--text-primary)',
                        }}>
                          {evt.type}
                        </span>
                        <span style={s.eventCompany}>{evt.company}</span>
                        <span style={s.eventDate}>{evt.date}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={s.fieldGroup}>
              <p style={s.hint}>
                Connect your Gmail to automatically detect rejections, interviews, and offers.
                We only request read-only access and never send emails on your behalf.
              </p>
              <button style={s.btnPrimary} onClick={() => {
                if (!requireAuth('sync_gmail', () => handleConnectGmail())) return
                handleConnectGmail()
              }}>
                <Mail size={14} style={{ marginRight: 6 }} />
                Connect Gmail
              </button>
            </div>
          )}
        </AccordionSection>
      )}

      {/* ─────────────── 6. Plan & Billing ─────────────── */}
      <AccordionSection
        id="billing"
        icon={<CreditCard size={18} color="#f472b6" />}
        title="Plan & Billing"
        description="Manage your subscription and view usage"
        openSections={openSections}
        toggle={toggleSection}
        badge={<span style={{
          ...s.badgeNeutral,
          background: plan === 'free' ? 'rgba(148, 163, 184, 0.1)' : 'rgba(139, 92, 246, 0.1)',
          color: plan === 'free' ? 'var(--text-tertiary)' : '#8b5cf6',
          borderColor: plan === 'free' ? 'var(--border)' : 'rgba(139, 92, 246, 0.2)',
        }}>{planConfig.name}</span>}
      >
        {/* Current Plan */}
        <div style={s.planCard}>
          <div style={s.planCardLeft}>
            <span style={{
              ...s.planBadge,
              background: plan === 'free'
                ? 'rgba(148, 163, 184, 0.12)'
                : 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(168,85,247,0.25))',
              color: plan === 'free' ? 'var(--text-secondary)' : '#a855f7',
              borderColor: plan === 'free' ? 'var(--border)' : 'rgba(139,92,246,0.3)',
            }}>{planConfig.name}</span>
            <div style={s.planName}>{planConfig.name} Plan</div>
            <div style={s.planPrice}>
              {plan === 'free' ? 'Free forever' : `$${planConfig.priceWeekly}/week`}
            </div>
          </div>
          <button
            style={s.btnPrimary}
            onClick={() => {
              if (plan === 'free') setActiveView('pricing')
              else handleManageBilling()
            }}
            disabled={portalLoading}
          >
            {plan === 'free' ? (
              <><Zap size={14} style={{ marginRight: 6 }} />Upgrade</>
            ) : portalLoading ? 'Loading...' : (
              <><ExternalLink size={14} style={{ marginRight: 6 }} />Manage Subscription</>
            )}
          </button>
        </div>

        {/* Usage Stats */}
        <div style={s.fieldGroup}>
          <label style={s.label}>This Month&apos;s Usage</label>
          <div style={s.usageGrid}>
            <div style={s.usageStat}>
              <div style={s.usageValue}>
                {planLoading ? '...' : usage.applies}
                <span style={s.usageMax}>
                  / {limits.botAppliesPerMonth === Infinity ? '\u221e' : limits.botAppliesPerMonth}
                </span>
              </div>
              <div style={s.usageLabel}>Bot Applications</div>
              <div style={s.usageBar}>
                <div style={{
                  ...s.usageBarFill,
                  width: limits.botAppliesPerMonth === Infinity
                    ? '5%'
                    : `${Math.min(100, (usage.applies / limits.botAppliesPerMonth) * 100)}%`,
                }} />
              </div>
            </div>
            <div style={s.usageStat}>
              <div style={s.usageValue}>
                {planLoading ? '...' : usage.coverLetters}
                <span style={s.usageMax}>
                  / {limits.coverLettersPerMonth === Infinity ? '\u221e' : limits.coverLettersPerMonth}
                </span>
              </div>
              <div style={s.usageLabel}>Cover Letters</div>
              <div style={s.usageBar}>
                <div style={{
                  ...s.usageBarFill,
                  width: limits.coverLettersPerMonth === Infinity
                    ? '5%'
                    : `${Math.min(100, (usage.coverLetters / limits.coverLettersPerMonth) * 100)}%`,
                }} />
              </div>
            </div>
          </div>
        </div>
      </AccordionSection>

      {/* ─────────────── 7. Data Management ─────────────── */}
      <AccordionSection
        id="data"
        icon={<Database size={18} color="#60a5fa" />}
        title="Data Management"
        description="Export and import your job tracking data"
        openSections={openSections}
        toggle={toggleSection}
      >
        <div style={s.fieldGroup}>
          <label style={s.label}><Download size={12} style={{ marginRight: 4 }} />Export</label>
          <p style={s.hint}>Download all {jobs.length} jobs as a JSON file</p>
          <button style={s.btnSecondary} onClick={() => {
            if (!requireAuth('export_data', () => handleExport())) return
            handleExport()
          }}>
            <Download size={14} style={{ marginRight: 6 }} />
            Download JSON
          </button>
        </div>

        <div style={s.fieldGroup}>
          <label style={s.label}><Upload size={12} style={{ marginRight: 4 }} />Import</label>
          <p style={s.hint}>Upload a JSON file to merge jobs into the tracker</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            style={s.fileInput}
          />
          {importStatus && (
            <span style={importStatus.startsWith('Import failed') ? s.errorText : s.successText}>
              {importStatus}
            </span>
          )}
        </div>
      </AccordionSection>

      {/* ─────────────── 8. Privacy & Data ─────────────── */}
      <AccordionSection
        id="privacy"
        icon={<Shield size={18} color="#f59e0b" />}
        title="Privacy & Data"
        description="Understand what we access and manage your data rights"
        openSections={openSections}
        toggle={toggleSection}
      >
        {/* Data Access Transparency */}
        <div style={s.fieldGroup}>
          <label style={s.label}>What We Access</label>
          <div style={s.privacyList}>
            <div style={s.privacyItem}>
              <Mail size={14} color="var(--text-tertiary)" />
              <div>
                <div style={s.privacyItemTitle}>Gmail (read-only)</div>
                <div style={s.privacyItemDesc}>
                  We scan subject lines and sender addresses to detect rejections, interviews, and offers.
                  We never read email bodies or send emails.
                </div>
              </div>
            </div>
            <div style={s.privacyItem}>
              <Database size={14} color="var(--text-tertiary)" />
              <div>
                <div style={s.privacyItemTitle}>Job Application Data</div>
                <div style={s.privacyItemDesc}>
                  Company names, job titles, application status, and dates you provide.
                  Stored encrypted in our database.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* GDPR Export */}
        <div style={s.fieldGroup}>
          <label style={s.label}>Export All Data (GDPR)</label>
          <p style={s.hint}>Download a complete copy of all data we store about you</p>
          <button style={s.btnSecondary} onClick={() => {
            if (!requireAuth('export_data', () => handleExport())) return
            handleExport()
          }}>
            <Download size={14} style={{ marginRight: 6 }} />
            Request Data Export
          </button>
        </div>

        {/* Disconnect Gmail */}
        {isAuthenticated && gmailConnected && (
          <div style={s.fieldGroup}>
            <label style={s.label}>Disconnect Gmail</label>
            <p style={s.hint}>Revoke Gmail access. This will stop automatic email scanning.</p>
            <button style={s.btnSecondary} onClick={handleDisconnectGmail}>
              Disconnect Gmail
            </button>
          </div>
        )}

        {/* Delete Account — Danger Zone */}
        <div style={s.dangerZone}>
          <div style={s.dangerZoneHeader}>
            <Trash2 size={14} color="#f43f5e" />
            <span style={s.dangerZoneTitle}>Danger Zone</span>
          </div>
          <p style={s.hint}>
            Permanently delete your account and all associated data. This action cannot be undone.
          </p>
          {!deleteConfirm ? (
            <button
              style={s.btnDanger}
              onClick={() => setDeleteConfirm(true)}
            >
              <Trash2 size={14} style={{ marginRight: 6 }} />
              Delete My Account
            </button>
          ) : (
            <div style={s.deleteConfirmBox}>
              <p style={{ ...s.hint, color: '#f43f5e', fontWeight: 500 }}>
                Are you sure? All your jobs, events, and settings will be permanently deleted.
              </p>
              <div style={s.inputRow}>
                <button
                  style={s.btnDanger}
                  onClick={async () => {
                    // In a real implementation, this would call a backend endpoint
                    // that deletes all user data from Supabase and Stripe
                    if (user) {
                      await supabase.auth.signOut()
                    }
                    try {
                      localStorage.clear()
                    } catch { /* ignore */ }
                    window.location.reload()
                  }}
                >
                  Confirm Delete
                </button>
                <button style={s.btnSecondary} onClick={() => setDeleteConfirm(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </AccordionSection>

      </div>{/* END RIGHT COLUMN */}
      </div>{/* END COLUMNS GRID */}
    </div>
  )
}

/* ================================================================== */
/*  Styles                                                              */
/* ================================================================== */
const s: Record<string, CSSProperties> = {
  container: {
    height: '100%',
    overflow: 'auto',
    padding: 24,
  },
  header: {
    marginBottom: 24,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--text-primary)',
    marginBottom: 4,
  },
  pageSubtitle: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
  },

  /* ── Two-Column Grid ─── */
  columnsGrid: {
    display: 'grid',
    gap: 20,
    alignItems: 'start',
  },
  column: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 0,
  },

  /* ── Accordion Section ─── */
  section: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    marginBottom: 12,
    overflow: 'hidden',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '16px 20px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left' as const,
    color: 'inherit',
    gap: 12,
  },
  sectionHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  sectionHeaderRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg-elevated)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary)',
    lineHeight: 1.3,
  },
  sectionDesc: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    lineHeight: 1.3,
    marginTop: 2,
  },
  sectionBody: {
    padding: '4px 20px 20px',
    borderTop: '1px solid var(--border)',
  },

  /* ── Form Elements ─── */
  profileGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px 16px',
  },
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  label: {
    display: 'flex',
    alignItems: 'center',
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
    marginBottom: 8,
    lineHeight: 1.4,
  },
  value: {
    fontSize: 13,
    color: 'var(--text-primary)',
  },
  inputRow: {
    display: 'flex',
    gap: 8,
  },
  input: {
    flex: 1,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: '8px 12px',
    color: 'var(--text-primary)',
    fontSize: 13,
    outline: 'none',
  },
  select: {
    flex: 1,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: '8px 12px',
    color: 'var(--text-primary)',
    fontSize: 13,
    outline: 'none',
    cursor: 'pointer',
  },
  fileInput: {
    fontSize: 13,
    color: 'var(--text-secondary)',
  },

  /* ── Buttons ─── */
  btnPrimary: {
    display: 'inline-flex',
    alignItems: 'center',
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
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    fontWeight: 500,
    fontSize: 13,
    padding: '8px 16px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  btnDanger: {
    display: 'inline-flex',
    alignItems: 'center',
    background: 'rgba(244, 63, 94, 0.1)',
    color: '#f43f5e',
    fontWeight: 600,
    fontSize: 13,
    padding: '8px 16px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid rgba(244, 63, 94, 0.2)',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },

  /* ── Badges ─── */
  badgeSuccess: {
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 999,
    background: 'rgba(52, 211, 153, 0.1)',
    color: '#34d399',
    border: '1px solid rgba(52, 211, 153, 0.2)',
  },
  badgeDanger: {
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 999,
    background: 'rgba(244, 63, 94, 0.1)',
    color: '#f43f5e',
    border: '1px solid rgba(244, 63, 94, 0.2)',
  },
  badgeNeutral: {
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 999,
    border: '1px solid var(--border)',
  },

  /* ── Status Indicators ─── */
  statusIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    borderRadius: 'var(--radius-md)',
    background: 'rgba(52, 211, 153, 0.08)',
    border: '1px solid rgba(52, 211, 153, 0.2)',
    fontSize: 13,
    color: '#34d399',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#34d399',
    flexShrink: 0,
  },

  /* ── Success / Error Text ─── */
  successText: {
    display: 'block',
    fontSize: 12,
    color: '#34d399',
    marginTop: 6,
  },
  errorText: {
    display: 'block',
    fontSize: 12,
    color: '#f43f5e',
    marginTop: 6,
  },

  /* ── Chips ─── */
  chipContainer: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 6,
    marginBottom: 8,
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 12,
    padding: '4px 10px',
    borderRadius: 999,
    background: 'rgba(96, 165, 250, 0.1)',
    border: '1px solid rgba(96, 165, 250, 0.2)',
    color: '#60a5fa',
    fontWeight: 500,
  },
  chipRemove: {
    background: 'none',
    border: 'none',
    color: '#60a5fa',
    cursor: 'pointer',
    fontSize: 14,
    lineHeight: 1,
    padding: 0,
    marginLeft: 2,
  },

  /* ── Toggle Switch ─── */
  toggleList: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  toggleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 0',
    gap: 16,
  },
  toggleLabel: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text-primary)',
    lineHeight: 1.3,
  },
  toggleDesc: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    lineHeight: 1.3,
    marginTop: 2,
  },
  toggle: {
    width: 40,
    height: 24,
    borderRadius: 999,
    cursor: 'pointer',
    position: 'relative' as const,
    flexShrink: 0,
    transition: 'background 0.2s',
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: '#fff',
    position: 'absolute' as const,
    top: 2,
    transition: 'transform 0.2s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
  },

  /* ── Radio Cards (Bot Autonomy) ─── */
  radioGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  radioCard: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '12px 16px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    cursor: 'pointer',
    textAlign: 'left' as const,
    color: 'inherit',
    width: '100%',
  },
  radioCardActive: {
    borderColor: 'var(--accent)',
    background: 'rgba(168, 85, 247, 0.05)',
  },
  radioCardIcon: {
    width: 28,
    height: 28,
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-surface)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
    color: 'var(--text-secondary)',
  },
  radioCardLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  radioCardDesc: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    marginTop: 2,
    lineHeight: 1.3,
  },

  /* ── Plan & Billing ─── */
  planCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    marginBottom: 16,
    gap: 16,
    flexWrap: 'wrap' as const,
  },
  planCardLeft: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  planName: {
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  planPrice: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
  },
  planBadge: {
    display: 'inline-block',
    fontSize: 11,
    fontWeight: 700,
    padding: '3px 10px',
    borderRadius: 999,
    border: '1px solid',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 6,
    width: 'fit-content',
  },
  usageGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
  },
  usageStat: {
    padding: 12,
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
  },
  usageValue: {
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--text-primary)',
    fontVariantNumeric: 'tabular-nums',
  },
  usageMax: {
    fontSize: 14,
    fontWeight: 400,
    color: 'var(--text-tertiary)',
    marginLeft: 2,
  },
  usageLabel: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    marginTop: 4,
    marginBottom: 8,
  },
  usageBar: {
    width: '100%',
    height: 4,
    borderRadius: 2,
    background: 'var(--bg-surface)',
    overflow: 'hidden',
  },
  usageBarFill: {
    height: '100%',
    borderRadius: 2,
    background: 'var(--accent)',
    transition: 'width 0.3s ease',
  },

  /* ── Gmail Events ─── */
  eventList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    maxHeight: 200,
    overflow: 'auto',
  },
  eventItem: {
    display: 'flex',
    gap: 12,
    padding: '4px 8px',
    background: 'var(--bg-elevated)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 12,
  },
  eventType: {
    fontWeight: 600,
    color: 'var(--text-primary)',
    minWidth: 80,
    textTransform: 'capitalize' as const,
  },
  eventCompany: {
    color: 'var(--text-secondary)',
    flex: 1,
  },
  eventDate: {
    color: 'var(--text-tertiary)',
    whiteSpace: 'nowrap' as const,
  },

  /* ── Privacy Section ─── */
  privacyList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    marginBottom: 8,
  },
  privacyItem: {
    display: 'flex',
    gap: 12,
    padding: '12px 14px',
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    alignItems: 'flex-start',
  },
  privacyItemTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
    lineHeight: 1.3,
  },
  privacyItemDesc: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    lineHeight: 1.4,
    marginTop: 2,
  },
  /* ── Danger Zone ─── */
  dangerZone: {
    marginTop: 4,
    padding: 16,
    borderRadius: 'var(--radius-md)',
    background: 'rgba(244, 63, 94, 0.04)',
    border: '1px solid rgba(244, 63, 94, 0.2)',
  },
  dangerZoneHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  dangerZoneTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: '#f43f5e',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
  },
  deleteConfirmBox: {
    padding: 16,
    borderRadius: 'var(--radius-md)',
    background: 'rgba(244, 63, 94, 0.05)',
    border: '1px solid rgba(244, 63, 94, 0.15)',
    marginTop: 8,
  },
}
