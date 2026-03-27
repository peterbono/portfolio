import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Bot,
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Search,
  MapPin,
  Building2,
  SkipForward,
  Eye,
  ThumbsDown,
  Play,
  Square,
  History,
  Loader2,
  X,
  Check,
  Shield,
  ChevronDown,
  SlidersHorizontal,
  ChevronLeft,
  Tag,
  Zap,
  User,
  ChevronUp,
  Save,
  Pencil,
  Sparkles,
  Link2,
  Briefcase,
  List,
  LayoutGrid,
  BrainCircuit,
} from 'lucide-react'
import { useBotActivity } from '../hooks/useBotActivity'
import { usePlan } from '../hooks/usePlan'
import { useUI } from '../context/UIContext'
import type { BotActivityItem, BotRunStatus } from '../hooks/useBotActivity'
import { triggerBotRun } from '../lib/bot-api'
import { supabase } from '../lib/supabase'
import { useAuthWall } from '../hooks/useAuthWall'
import { useSupabase } from '../context/SupabaseContext'
import { useAuthWallContext } from '../context/AuthWallContext'
import CompanyChipInput from '../components/CompanyChipInput'
import { ProfileSetupModal, isProfileComplete } from '../components/ProfileSetupModal'
import CardStackReview from '../components/CardStackReview'
import {
  recordSignal,
  calibrateRubric,
  getLearningStatus,
  type FeedbackSignal,
} from '../lib/feedback-signals'

/* ------------------------------------------------------------------ */
/*  Mobile responsive CSS injection                                    */
/* ------------------------------------------------------------------ */
const autopilotResponsiveCSS = `
@media (max-width: 767px) {
  /* Preview drawer: full-screen on mobile */
  .autopilot-preview-drawer {
    width: 100vw !important;
    border-left: none !important;
  }
  /* Container padding */
  .autopilot-container {
    padding: 16px !important;
    gap: 12px !important;
  }
  /* Status banner padding */
  .autopilot-status-banner {
    padding: 16px !important;
  }
  /* Hero section */
  .autopilot-hero {
    padding: 24px 16px !important;
  }
  .autopilot-hero-title {
    font-size: 22px !important;
  }
  /* Top bar padding */
  .autopilot-top-bar {
    padding: 12px 16px 10px !important;
  }
  /* Main panel padding */
  .autopilot-main-panel {
    padding: 12px 16px !important;
  }
  /* Review cards: ensure full width */
  .autopilot-review-card {
    padding: 12px !important;
  }
  /* Bot controls stack vertically */
  .autopilot-top-bar-right {
    flex-wrap: wrap !important;
    gap: 6px !important;
  }
  /* Filter tags horizontal scroll */
  .autopilot-filter-tags {
    flex-wrap: nowrap !important;
    overflow-x: auto !important;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .autopilot-filter-tags::-webkit-scrollbar {
    display: none;
  }
  /* Run history table scroll */
  .autopilot-history-table {
    overflow-x: auto !important;
    -webkit-overflow-scrolling: touch;
  }
}
`
if (typeof document !== 'undefined') {
  const id = 'autopilot-responsive-styles'
  if (!document.getElementById(id)) {
    const style = document.createElement('style')
    style.id = id
    style.textContent = autopilotResponsiveCSS
    document.head.appendChild(style)
  }
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface LocationRule {
  id: string
  type: 'zone' | 'city' | 'country'
  value: string
  workArrangement: 'remote' | 'hybrid' | 'onsite' | 'any'
  minSalary?: number
  currency?: string
}

const CURRENCY_OPTIONS = [
  { value: 'EUR', symbol: '\u20AC', label: 'EUR' },
  { value: 'USD', symbol: '$', label: 'USD' },
  { value: 'GBP', symbol: '\u00A3', label: 'GBP' },
  { value: 'SGD', symbol: 'S$', label: 'SGD' },
  { value: 'AUD', symbol: 'A$', label: 'AUD' },
  { value: 'THB', symbol: '\u0E3F', label: 'THB' },
  { value: 'JPY', symbol: '\u00A5', label: 'JPY' },
  { value: 'INR', symbol: '\u20B9', label: 'INR' },
  { value: 'AED', symbol: 'AED', label: 'AED' },
]

function getCurrencySymbol(code?: string): string {
  if (!code) return '\u20AC'
  return CURRENCY_OPTIONS.find(c => c.value === code)?.symbol || code
}

interface SearchConfig {
  keywords: string[]
  locationRules: LocationRule[]
  excludedCompanies: string[]
  dailyLimit: number
}

const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  keywords: [],
  locationRules: [],
  excludedCompanies: [],
  dailyLimit: 15,
}

const ZONES: Record<string, { label: string; countries: string[] }> = {
  'APAC': { label: 'Asia-Pacific', countries: ['Thailand', 'Singapore', 'Japan', 'South Korea', 'Australia', 'New Zealand', 'India', 'Philippines', 'Vietnam', 'Indonesia', 'Malaysia', 'Taiwan', 'Hong Kong', 'China'] },
  'EMEA': { label: 'Europe, Middle East & Africa', countries: ['UK', 'Germany', 'France', 'Netherlands', 'Spain', 'Italy', 'Sweden', 'Denmark', 'Norway', 'Finland', 'Switzerland', 'Ireland', 'Belgium', 'Portugal', 'Poland', 'Czech Republic', 'Austria', 'UAE', 'Saudi Arabia', 'Israel', 'South Africa', 'Nigeria', 'Kenya', 'Egypt'] },
  'Americas': { label: 'North & South America', countries: ['USA', 'Canada', 'Mexico', 'Brazil', 'Argentina', 'Colombia', 'Chile'] },
  'Middle East': { label: 'Middle East', countries: ['UAE', 'Saudi Arabia', 'Qatar', 'Bahrain', 'Kuwait', 'Oman', 'Israel', 'Turkey'] },
  'Global': { label: 'Worldwide (Remote Only)', countries: [] },
}

const ZONE_NAMES = Object.keys(ZONES)

// All unique countries extracted from ZONES for country autocomplete
const ALL_COUNTRIES = Array.from(
  new Set(Object.values(ZONES).flatMap((z) => z.countries))
).sort()

const WORK_ARRANGEMENTS = [
  { value: 'remote' as const, label: 'Remote' },
  { value: 'hybrid' as const, label: 'Hybrid' },
  { value: 'onsite' as const, label: 'On-site' },
  { value: 'any' as const, label: 'Any' },
]

function getLocationRuleIcon(rule: LocationRule): string {
  if (rule.type === 'zone') return '\u{1F30F}'
  if (rule.workArrangement === 'onsite') return '\u{1F3E2}'
  return '\u{1F4CD}'
}

function getLocationRuleLabel(rule: LocationRule): string {
  const arrangement = rule.workArrangement === 'any' ? 'Any' :
    rule.workArrangement === 'remote' ? 'Remote' :
    rule.workArrangement === 'hybrid' ? 'Hybrid' : 'On-site'
  const salaryPart = rule.minSalary
    ? ` ${getCurrencySymbol(rule.currency)}${(rule.minSalary / 1000).toFixed(0)}k+`
    : ''
  return `${rule.value} ${arrangement}${salaryPart}`
}

const LS_KEY = 'tracker_v2_search_config'
const LS_KEY_OLD = 'tracker_v2_search_profiles'

/** Migrate from old multi-profile array to single config */
function migrateFromProfiles(): SearchConfig | null {
  try {
    const raw = localStorage.getItem(LS_KEY_OLD)
    if (!raw) return null
    const profiles = JSON.parse(raw)
    if (!Array.isArray(profiles) || profiles.length === 0) return null
    const p = profiles[0]
    // Build locationRules from old format
    let locationRules: LocationRule[] = p.locationRules || []
    if (locationRules.length === 0) {
      if (p.location) {
        locationRules = [{
          id: crypto.randomUUID(),
          type: 'city',
          value: p.location,
          workArrangement: p.remoteOnly ? 'remote' : 'any',
        }]
      } else if (p.remoteOnly) {
        locationRules = [{
          id: crypto.randomUUID(),
          type: 'zone',
          value: 'Global',
          workArrangement: 'remote',
        }]
      }
    }
    const config: SearchConfig = {
      keywords: p.keywords || [],
      locationRules,
      excludedCompanies: p.excludedCompanies || [],
      dailyLimit: p.dailyLimit || 15,
    }
    return config
  } catch {
    return null
  }
}

function loadSearchConfig(): SearchConfig {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return { ...DEFAULT_SEARCH_CONFIG, ...JSON.parse(raw) }
    // Attempt migration from old profiles array
    const migrated = migrateFromProfiles()
    if (migrated) {
      localStorage.setItem(LS_KEY, JSON.stringify(migrated))
      localStorage.removeItem(LS_KEY_OLD)
      return migrated
    }
    return { ...DEFAULT_SEARCH_CONFIG }
  } catch {
    return { ...DEFAULT_SEARCH_CONFIG }
  }
}

function saveSearchConfig(config: SearchConfig) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(config))
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/*  Run History types                                                   */
/* ------------------------------------------------------------------ */
interface BotRunHistoryItem {
  id: string
  status: string
  startedAt: string | null
  completedAt: string | null
  jobsFound: number
  jobsApplied: number
  jobsSkipped: number
  jobsFailed: number
  errorMessage: string | null
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt || !completedAt) return '--'
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.round((ms % 60_000) / 1000)
  return `${mins}m ${secs}s`
}

function formatRunDate(iso: string | null): string {
  if (!iso) return '--'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  } catch {
    return '--'
  }
}

/* ------------------------------------------------------------------ */
/*  Review Queue types + persistence                                   */
/* ------------------------------------------------------------------ */
interface ReviewQueueItem {
  id: string
  company: string
  role: string
  matchScore: number
  matchReasons: string[]
  cvName: string
  coverLetterSnippet: string
  status: 'pending' | 'approved' | 'skipped'
  editedCoverLetter?: string
  editedAnswers?: Record<string, string>
  jobUrl?: string
}

interface DiscoveredJob {
  title: string
  company: string
  location: string
  url: string
  isEasyApply: boolean
}

const REVIEW_LS_KEY = 'tracker_v2_review_queue'
const RUN_COUNT_LS_KEY = 'tracker_v2_run_count'
const AUTO_SUBMIT_LS_KEY = 'tracker_v2_auto_submit'
const AUTO_SUBMIT_DISMISS_LS_KEY = 'tracker_v2_auto_submit_dismissed_at'
const REVIEW_MODE_LS_KEY = 'tracker_v2_review_mode'

type ReviewMode = 'list' | 'card'

function loadReviewMode(): ReviewMode {
  try {
    const raw = localStorage.getItem(REVIEW_MODE_LS_KEY)
    return raw === 'card' ? 'card' : 'list'
  } catch {
    return 'list'
  }
}

function saveReviewMode(mode: ReviewMode) {
  try {
    localStorage.setItem(REVIEW_MODE_LS_KEY, mode)
  } catch { /* ignore */ }
}

function loadReviewQueue(): ReviewQueueItem[] {
  try {
    const raw = localStorage.getItem(REVIEW_LS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveReviewQueue(queue: ReviewQueueItem[]) {
  try {
    localStorage.setItem(REVIEW_LS_KEY, JSON.stringify(queue))
  } catch {
    /* ignore */
  }
}

function getRunCount(): number {
  try {
    return parseInt(localStorage.getItem(RUN_COUNT_LS_KEY) || '0') || 0
  } catch {
    return 0
  }
}

function incrementRunCount(): number {
  const next = getRunCount() + 1
  try { localStorage.setItem(RUN_COUNT_LS_KEY, String(next)) } catch { /* ignore */ }
  return next
}

function getAutoSubmitEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_SUBMIT_LS_KEY) === 'true'
  } catch {
    return false
  }
}

function setAutoSubmitEnabled(val: boolean) {
  try { localStorage.setItem(AUTO_SUBMIT_LS_KEY, String(val)) } catch { /* ignore */ }
}

function isAutoSubmitDismissedRecently(): boolean {
  try {
    const ts = localStorage.getItem(AUTO_SUBMIT_DISMISS_LS_KEY)
    if (!ts) return false
    const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000
    return Date.now() - parseInt(ts) < TWO_WEEKS
  } catch {
    return false
  }
}

function dismissAutoSubmitSuggestion() {
  try { localStorage.setItem(AUTO_SUBMIT_DISMISS_LS_KEY, String(Date.now())) } catch { /* ignore */ }
}

const RUN_STATUS_COLORS: Record<string, string> = {
  completed: '#34d399',
  running: '#60a5fa',
  pending: '#fbbf24',
  failed: '#f43f5e',
  cancelled: '#6b7280',
}


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
      label: 'Ready to search',
      description: 'Set up your search criteria and find matching jobs',
      dotColor: '#6b7280',
      pulsing: false,
    }
  }

  switch (run.status) {
    case 'pending':
      return {
        label: 'Search queued',
        description: 'Starting soon...',
        dotColor: '#fbbf24',
        pulsing: false,
      }
    case 'running':
      return {
        label: 'Searching...',
        description: `Found ${run.jobsFound} match${run.jobsFound !== 1 ? 'es' : ''} so far`,
        dotColor: '#34d399',
        pulsing: true,
      }
    case 'completed':
      return {
        label: 'Search complete',
        description: `Found ${run.jobsFound} match${run.jobsFound !== 1 ? 'es' : ''}`,
        dotColor: '#34d399',
        pulsing: false,
      }
    case 'failed':
      return {
        label: 'Something went wrong',
        description: run.errorMessage || 'Something went wrong during the search. Try again?',
        dotColor: '#f43f5e',
        pulsing: false,
      }
    case 'cancelled':
      return {
        label: 'Search cancelled',
        description: `Found ${run.jobsFound} match${run.jobsFound !== 1 ? 'es' : ''} before cancellation`,
        dotColor: '#6b7280',
        pulsing: false,
      }
    default:
      return {
        label: 'Ready to search',
        description: 'Set up your search criteria and find matching jobs',
        dotColor: '#6b7280',
        pulsing: false,
      }
  }
}

/* ------------------------------------------------------------------ */
/*  Job title suggestions (curated ~100)                               */
/* ------------------------------------------------------------------ */
const JOB_TITLE_SUGGESTIONS = [
  'Product Designer', 'Senior Product Designer', 'Staff Product Designer',
  'Principal Product Designer', 'Lead Product Designer', 'UX Designer',
  'Senior UX Designer', 'UX/UI Designer', 'UI Designer', 'Senior UI Designer',
  'Visual Designer', 'Senior Visual Designer', 'Interaction Designer',
  'UX Researcher', 'Senior UX Researcher', 'Design Systems Designer',
  'Design Systems Lead', 'Design Ops Manager', 'Design Manager',
  'Head of Design', 'VP of Design', 'Director of Design', 'Creative Director',
  'Design Lead', 'Design Director', 'Brand Designer', 'Graphic Designer',
  'Web Designer', 'Mobile Designer', 'Motion Designer', 'Service Designer',
  'Content Designer', 'UX Writer', 'UX Engineer', 'Design Technologist',
  'Frontend Designer', 'Product Design Lead', 'Product Design Manager',
  'User Experience Architect', 'Information Architect', 'Accessibility Designer',
  'Design Researcher', 'User Researcher', 'Research Lead',
  'Figma Designer', 'Prototyper', 'Design Consultant',
  'Product Manager', 'Senior Product Manager', 'Technical Product Manager',
  'Growth Designer', 'Conversion Designer', 'E-commerce Designer',
  'SaaS Designer', 'B2B Designer', 'Fintech Designer', 'Healthtech Designer',
  'Gaming Designer', 'iGaming Designer', 'EdTech Designer',
  'Design Sprint Facilitator', 'Workshop Facilitator',
  'CX Designer', 'Customer Experience Designer',
  'Full Stack Designer', 'Unicorn Designer', 'Zero-to-One Designer',
  'Design System Engineer', 'Component Library Designer',
  'Illustration Designer', 'Icon Designer', 'Data Visualization Designer',
  'Dashboard Designer', 'Enterprise UX Designer', 'Platform Designer',
  'Design Strategist', 'UX Strategist', 'Product Strategist',
  'Creative Technologist', 'Webflow Designer', 'Framer Designer',
  'AR/VR Designer', '3D Designer', 'Spatial Designer',
  'Conversational Designer', 'Voice UI Designer', 'AI Product Designer',
  'Design Ops Lead', 'DesignOps', 'Design Program Manager',
  'Art Director', 'Senior Art Director', 'Associate Art Director',
  'Packaging Designer', 'Environmental Designer', 'Experience Designer',
  'Multidisciplinary Designer', 'Communication Designer',
  'Head of Product Design', 'Head of UX', 'VP Product Design',
  'Staff UX Designer', 'Principal UX Designer', 'Staff Visual Designer',
  'Founding Designer', 'Solo Designer', 'Contract Designer', 'Freelance Designer',
]

/* ------------------------------------------------------------------ */
/*  Teleport city search (debounced)                                   */
/* ------------------------------------------------------------------ */
interface CityResult {
  name: string
  fullName: string
}

async function searchCities(query: string): Promise<CityResult[]> {
  if (!query || query.length < 2) return []
  try {
    const res = await fetch(
      `https://api.teleport.org/api/cities/?search=${encodeURIComponent(query)}&limit=5`
    )
    if (!res.ok) return []
    const data = await res.json()
    const embedded = data?._embedded?.['city:search-results']
    if (!Array.isArray(embedded)) return []
    return embedded.map((item: Record<string, unknown>) => ({
      name: (item.matching_full_name as string) || '',
      fullName: (item.matching_full_name as string) || '',
    }))
  } catch {
    return []
  }
}

/* ------------------------------------------------------------------ */
/*  Reusable ChipInput component                                       */
/* ------------------------------------------------------------------ */
function ChipInput({
  chips,
  onAdd,
  onRemove,
  placeholder,
  suggestions,
  onQueryChange,
  isLoading,
  noResults,
}: {
  chips: string[]
  onAdd: (value: string) => void
  onRemove: (index: number) => void
  placeholder: string
  suggestions?: string[]
  onQueryChange?: (q: string) => void
  isLoading?: boolean
  noResults?: boolean
}) {
  const [query, setQuery] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = suggestions
    ? suggestions.filter(
        (s) =>
          s.toLowerCase().includes(query.toLowerCase()) &&
          !chips.includes(s)
      ).slice(0, 8)
    : []

  const addChip = useCallback(
    (value: string) => {
      const trimmed = value.trim()
      if (trimmed && !chips.includes(trimmed)) {
        onAdd(trimmed)
      }
      setQuery('')
      setShowDropdown(false)
      setHighlightIdx(-1)
      onQueryChange?.('')
    },
    [chips, onAdd, onQueryChange]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (highlightIdx >= 0 && filtered[highlightIdx]) {
          addChip(filtered[highlightIdx])
        } else if (query.trim()) {
          addChip(query)
        }
      } else if (e.key === ',' && query.trim()) {
        e.preventDefault()
        addChip(query)
      } else if (e.key === 'Backspace' && !query && chips.length > 0) {
        onRemove(chips.length - 1)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightIdx((prev) => Math.min(prev + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightIdx((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Escape') {
        setShowDropdown(false)
        setHighlightIdx(-1)
      }
    },
    [query, chips, filtered, highlightIdx, addChip, onRemove]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
      // If user types comma, add what's before as a chip
      if (val.endsWith(',')) {
        const before = val.slice(0, -1).trim()
        if (before) addChip(before)
        return
      }
      setQuery(val)
      setShowDropdown(val.length > 0)
      setHighlightIdx(-1)
      onQueryChange?.(val)
    },
    [addChip, onQueryChange]
  )

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const showSuggestions =
    showDropdown && (filtered.length > 0 || isLoading || noResults)

  return (
    <div ref={wrapperRef} style={chipStyles.wrapper}>
      <div
        style={chipStyles.inputArea}
        onClick={() => inputRef.current?.focus()}
      >
        {chips.map((chip, i) => (
          <span key={`${chip}-${i}`} style={chipStyles.chip}>
            <span style={chipStyles.chipText}>{chip}</span>
            <button
              type="button"
              style={chipStyles.chipRemove}
              onClick={(e) => {
                e.stopPropagation()
                onRemove(i)
              }}
              aria-label={`Remove ${chip}`}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <div style={chipStyles.inputWrap}>
          <input
            ref={inputRef}
            style={chipStyles.chipInput}
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (query.length > 0) setShowDropdown(true) }}
            placeholder={chips.length === 0 ? placeholder : ''}
          />
          {isLoading && (
            <Loader2
              size={14}
              color="var(--text-tertiary)"
              style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}
            />
          )}
        </div>
      </div>
      {showSuggestions && (
        <div style={chipStyles.dropdown}>
          {isLoading && filtered.length === 0 && (
            <div style={chipStyles.dropdownLoading}>
              <Loader2
                size={12}
                color="var(--text-tertiary)"
                style={{ animation: 'spin 1s linear infinite' }}
              />
              <span>Searching...</span>
            </div>
          )}
          {noResults && !isLoading && filtered.length === 0 && (
            <div style={chipStyles.dropdownEmpty}>No results found</div>
          )}
          {filtered.map((item, idx) => (
            <div
              key={item}
              style={{
                ...chipStyles.dropdownItem,
                ...(idx === highlightIdx ? chipStyles.dropdownItemHighlight : {}),
              }}
              onMouseEnter={() => setHighlightIdx(idx)}
              onMouseDown={(e) => {
                e.preventDefault()
                addChip(item)
              }}
            >
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  LocationInput with Teleport API                                    */
/* ------------------------------------------------------------------ */
function LocationAutocomplete({
  value,
  onChange,
}: {
  value: string
  onChange: (val: string) => void
}) {
  const [query, setQuery] = useState(value)
  const [results, setResults] = useState<CityResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Sync external value
  useEffect(() => {
    setQuery(value)
  }, [value])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
      setQuery(val)
      onChange(val)
      setHighlightIdx(-1)

      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (val.length < 2) {
        setResults([])
        setShowDropdown(false)
        setIsLoading(false)
        return
      }
      setIsLoading(true)
      setShowDropdown(true)
      debounceRef.current = setTimeout(async () => {
        const cities = await searchCities(val)
        setResults(cities)
        setIsLoading(false)
      }, 300)
    },
    [onChange]
  )

  const selectCity = useCallback(
    (city: CityResult) => {
      setQuery(city.fullName)
      onChange(city.fullName)
      setShowDropdown(false)
      setResults([])
    },
    [onChange]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightIdx((prev) => Math.min(prev + 1, results.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightIdx((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter' && highlightIdx >= 0 && results[highlightIdx]) {
        e.preventDefault()
        selectCity(results[highlightIdx])
      } else if (e.key === 'Escape') {
        setShowDropdown(false)
      }
    },
    [results, highlightIdx, selectCity]
  )

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const showSuggestions =
    showDropdown && (results.length > 0 || isLoading || (query.length >= 2 && !isLoading && results.length === 0))

  return (
    <div ref={wrapperRef} style={chipStyles.locWrapper}>
      <div style={chipStyles.locInputWrap}>
        <input
          style={chipStyles.locInput}
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length > 0) setShowDropdown(true) }}
          placeholder="Search city..."
        />
        {isLoading && (
          <Loader2
            size={14}
            color="var(--text-tertiary)"
            style={{ animation: 'spin 1s linear infinite', position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}
          />
        )}
      </div>
      {showSuggestions && (
        <div style={chipStyles.dropdown}>
          {isLoading && results.length === 0 && (
            <div style={chipStyles.dropdownLoading}>
              <Loader2
                size={12}
                color="var(--text-tertiary)"
                style={{ animation: 'spin 1s linear infinite' }}
              />
              <span>Searching cities...</span>
            </div>
          )}
          {!isLoading && results.length === 0 && query.length >= 2 && (
            <div style={chipStyles.dropdownEmpty}>No cities found</div>
          )}
          {results.map((city, idx) => (
            <div
              key={city.fullName}
              style={{
                ...chipStyles.dropdownItem,
                ...(idx === highlightIdx ? chipStyles.dropdownItemHighlight : {}),
              }}
              onMouseEnter={() => setHighlightIdx(idx)}
              onMouseDown={(e) => {
                e.preventDefault()
                selectCity(city)
              }}
            >
              <MapPin size={12} color="var(--text-tertiary)" style={{ flexShrink: 0, marginRight: 6 }} />
              {city.fullName}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  LocationRuleEditor — inline form to add a location rule             */
/* ------------------------------------------------------------------ */
function LocationRuleEditor({
  onAdd,
  onCancel,
}: {
  onAdd: (rule: LocationRule) => void
  onCancel: () => void
}) {
  const [ruleType, setRuleType] = useState<'zone' | 'country' | 'city'>('zone')
  const [zoneValue, setZoneValue] = useState(ZONE_NAMES[0])
  const [countryQuery, setCountryQuery] = useState('')
  const [countryValue, setCountryValue] = useState('')
  const [showCountryDrop, setShowCountryDrop] = useState(false)
  const [cityValue, setCityValue] = useState('')
  const [arrangement, setArrangement] = useState<'remote' | 'hybrid' | 'onsite' | 'any'>('remote')
  const [ruleSalary, setRuleSalary] = useState('')
  const [ruleCurrency, setRuleCurrency] = useState('EUR')
  const countryWrapRef = useRef<HTMLDivElement>(null)

  // City autocomplete state
  const [cityResults, setCityResults] = useState<CityResult[]>([])
  const [cityLoading, setCityLoading] = useState(false)
  const [showCityDrop, setShowCityDrop] = useState(false)
  const [cityHighlight, setCityHighlight] = useState(-1)
  const cityDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cityWrapRef = useRef<HTMLDivElement>(null)

  // Force remote for Global zone
  useEffect(() => {
    if (ruleType === 'zone' && zoneValue === 'Global') {
      setArrangement('remote')
    }
  }, [ruleType, zoneValue])

  // Country filtering
  const filteredCountries = countryQuery.length >= 1
    ? ALL_COUNTRIES.filter((c) => c.toLowerCase().includes(countryQuery.toLowerCase())).slice(0, 8)
    : []

  // Close country dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (countryWrapRef.current && !countryWrapRef.current.contains(e.target as Node)) {
        setShowCountryDrop(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Close city dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cityWrapRef.current && !cityWrapRef.current.contains(e.target as Node)) {
        setShowCityDrop(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleCityChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setCityValue(val)
    setCityHighlight(-1)
    if (cityDebounceRef.current) clearTimeout(cityDebounceRef.current)
    if (val.length < 2) {
      setCityResults([])
      setShowCityDrop(false)
      setCityLoading(false)
      return
    }
    setCityLoading(true)
    setShowCityDrop(true)
    cityDebounceRef.current = setTimeout(async () => {
      const cities = await searchCities(val)
      setCityResults(cities)
      setCityLoading(false)
    }, 300)
  }, [])

  const selectCityResult = useCallback((city: CityResult) => {
    setCityValue(city.fullName)
    setShowCityDrop(false)
    setCityResults([])
  }, [])

  const handleCityKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCityHighlight((prev) => Math.min(prev + 1, cityResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCityHighlight((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && cityHighlight >= 0 && cityResults[cityHighlight]) {
      e.preventDefault()
      selectCityResult(cityResults[cityHighlight])
    } else if (e.key === 'Escape') {
      setShowCityDrop(false)
    }
  }, [cityResults, cityHighlight, selectCityResult])

  const currentValue =
    ruleType === 'zone' ? zoneValue :
    ruleType === 'country' ? countryValue :
    cityValue

  const canAdd = currentValue.trim().length > 0

  const handleAdd = () => {
    if (!canAdd) return
    const salaryNum = parseInt(ruleSalary) || 0
    onAdd({
      id: crypto.randomUUID(),
      type: ruleType,
      value: currentValue.trim(),
      workArrangement: arrangement,
      ...(salaryNum > 0 ? { minSalary: salaryNum, currency: ruleCurrency } : {}),
    })
  }

  const pillBase: React.CSSProperties = {
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 16,
    border: '1px solid var(--border)',
    background: 'var(--bg-surface)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  }
  const pillActive: React.CSSProperties = {
    ...pillBase,
    background: 'rgba(96, 165, 250, 0.15)',
    border: '1px solid rgba(96, 165, 250, 0.4)',
    color: '#93c5fd',
  }

  const arrangePillBase: React.CSSProperties = {
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 12,
    border: '1px solid var(--border)',
    background: 'var(--bg-surface)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  }
  const arrangePillActive: React.CSSProperties = {
    ...arrangePillBase,
    background: 'rgba(52, 211, 153, 0.12)',
    border: '1px solid rgba(52, 211, 153, 0.35)',
    color: '#34d399',
  }

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      {/* Type selector pills */}
      <div style={{ display: 'flex', gap: 6 }}>
        {(['zone', 'country', 'city'] as const).map((t) => (
          <button
            key={t}
            type="button"
            style={ruleType === t ? pillActive : pillBase}
            onClick={() => setRuleType(t)}
          >
            {t === 'zone' && <>{'\u{1F30F}'} Zone</>}
            {t === 'country' && <>{'\u{1F1FA}\u{1F1F3}'} Country</>}
            {t === 'city' && <>{'\u{1F4CD}'} City</>}
          </button>
        ))}
      </div>

      {/* Value selector */}
      {ruleType === 'zone' && (
        <div style={{ position: 'relative' }}>
          <select
            value={zoneValue}
            onChange={(e) => setZoneValue(e.target.value)}
            style={{
              width: '100%',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '8px 32px 8px 12px',
              color: 'var(--text-primary)',
              fontSize: 13,
              outline: 'none',
              appearance: 'none',
              cursor: 'pointer',
            }}
          >
            {ZONE_NAMES.map((z) => (
              <option key={z} value={z}>{z} — {ZONES[z].label}</option>
            ))}
          </select>
          <ChevronDown size={14} color="var(--text-tertiary)" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        </div>
      )}

      {ruleType === 'country' && (
        <div ref={countryWrapRef} style={{ position: 'relative' }}>
          <input
            value={countryQuery}
            onChange={(e) => {
              setCountryQuery(e.target.value)
              setCountryValue(e.target.value)
              setShowCountryDrop(e.target.value.length >= 1)
            }}
            onFocus={() => { if (countryQuery.length >= 1) setShowCountryDrop(true) }}
            placeholder="Search country..."
            style={{
              width: '100%',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '8px 12px',
              color: 'var(--text-primary)',
              fontSize: 13,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {showCountryDrop && filteredCountries.length > 0 && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: 4,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              zIndex: 50,
              maxHeight: 180,
              overflowY: 'auto',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            }}>
              {filteredCountries.map((c) => (
                <div
                  key={c}
                  style={{
                    padding: '8px 12px',
                    fontSize: 13,
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    transition: 'background 0.1s',
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setCountryQuery(c)
                    setCountryValue(c)
                    setShowCountryDrop(false)
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background = 'rgba(96, 165, 250, 0.1)'
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLDivElement).style.background = 'transparent'
                  }}
                >
                  {c}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {ruleType === 'city' && (
        <div ref={cityWrapRef} style={{ position: 'relative' }}>
          <input
            value={cityValue}
            onChange={handleCityChange}
            onKeyDown={handleCityKeyDown}
            onFocus={() => { if (cityResults.length > 0) setShowCityDrop(true) }}
            placeholder="Search city..."
            style={{
              width: '100%',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '8px 12px',
              paddingRight: 32,
              color: 'var(--text-primary)',
              fontSize: 13,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {cityLoading && (
            <Loader2
              size={14}
              color="var(--text-tertiary)"
              style={{ animation: 'spin 1s linear infinite', position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}
            />
          )}
          {showCityDrop && (cityResults.length > 0 || cityLoading || (cityValue.length >= 2 && !cityLoading && cityResults.length === 0)) && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: 4,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              zIndex: 50,
              maxHeight: 180,
              overflowY: 'auto',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            }}>
              {cityLoading && cityResults.length === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', fontSize: 12, color: 'var(--text-tertiary)' }}>
                  <Loader2 size={12} color="var(--text-tertiary)" style={{ animation: 'spin 1s linear infinite' }} />
                  <span>Searching cities...</span>
                </div>
              )}
              {!cityLoading && cityResults.length === 0 && cityValue.length >= 2 && (
                <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                  No cities found
                </div>
              )}
              {cityResults.map((city, idx) => (
                <div
                  key={city.fullName}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '8px 12px',
                    fontSize: 13,
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    transition: 'background 0.1s',
                    background: idx === cityHighlight ? 'rgba(96, 165, 250, 0.1)' : 'transparent',
                  }}
                  onMouseEnter={() => setCityHighlight(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    selectCityResult(city)
                  }}
                >
                  <MapPin size={12} color="var(--text-tertiary)" style={{ flexShrink: 0, marginRight: 6 }} />
                  {city.fullName}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Work arrangement pills */}
      <div>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6, display: 'block' }}>
          Work arrangement
        </span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {WORK_ARRANGEMENTS.map((wa) => {
            const disabled = ruleType === 'zone' && zoneValue === 'Global' && wa.value !== 'remote'
            return (
              <button
                key={wa.value}
                type="button"
                style={{
                  ...(arrangement === wa.value ? arrangePillActive : arrangePillBase),
                  ...(disabled ? { opacity: 0.35, cursor: 'not-allowed' } : {}),
                }}
                onClick={() => { if (!disabled) setArrangement(wa.value) }}
                disabled={disabled}
              >
                {wa.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Salary for this location */}
      <div>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6, display: 'block' }}>
          Min salary (optional)
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select
            value={ruleCurrency}
            onChange={(e) => setRuleCurrency(e.target.value)}
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '6px 8px',
              color: 'var(--text-primary)',
              fontSize: 12,
              outline: 'none',
              width: 72,
              cursor: 'pointer',
            }}
          >
            {CURRENCY_OPTIONS.map(c => (
              <option key={c.value} value={c.value}>{c.symbol} {c.label}</option>
            ))}
          </select>
          <input
            type="number"
            value={ruleSalary}
            onChange={(e) => setRuleSalary(e.target.value)}
            placeholder="e.g. 80000"
            style={{
              flex: 1,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '6px 10px',
              color: 'var(--text-primary)',
              fontSize: 12,
              outline: 'none',
              boxSizing: 'border-box' as const,
            }}
          />
          {ruleSalary && parseInt(ruleSalary) > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
              {getCurrencySymbol(ruleCurrency)}{(parseInt(ruleSalary) / 1000).toFixed(0)}k+
            </span>
          )}
        </div>
      </div>

      {/* Action row */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 500,
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
            background: 'var(--bg-surface)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!canAdd}
          style={{
            padding: '6px 14px',
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 'var(--radius-md)',
            border: 'none',
            background: canAdd ? 'var(--accent)' : 'var(--bg-surface)',
            color: canAdd ? '#09090b' : 'var(--text-tertiary)',
            cursor: canAdd ? 'pointer' : 'not-allowed',
            opacity: canAdd ? 1 : 0.5,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={12} />
            Add Rule
          </span>
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  LocationRuleChips — display rules as compact chips                  */
/* ------------------------------------------------------------------ */
function LocationRuleChips({
  rules,
  onRemove,
  compact,
}: {
  rules: LocationRule[]
  onRemove?: (id: string) => void
  compact?: boolean
}) {
  if (rules.length === 0) return null

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: compact ? 4 : 6 }}>
      {rules.map((rule) => {
        const icon = getLocationRuleIcon(rule)
        const arrangement = rule.workArrangement === 'any' ? 'Any' :
          rule.workArrangement === 'remote' ? 'Remote' :
          rule.workArrangement === 'hybrid' ? 'Hybrid' : 'On-site'
        const arrangementColor =
          rule.workArrangement === 'remote' ? '#34d399' :
          rule.workArrangement === 'hybrid' ? '#fbbf24' :
          rule.workArrangement === 'onsite' ? '#f97316' : '#93c5fd'

        return (
          <span
            key={rule.id}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: compact ? 3 : 5,
              padding: compact ? '2px 6px' : '3px 8px 3px 10px',
              borderRadius: 14,
              background: 'rgba(96, 165, 250, 0.08)',
              border: '1px solid rgba(96, 165, 250, 0.18)',
              fontSize: compact ? 11 : 12,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
            }}
          >
            <span>{icon}</span>
            <span style={{ fontWeight: 500 }}>{rule.value}</span>
            <span style={{
              fontSize: compact ? 10 : 11,
              color: arrangementColor,
              fontWeight: 600,
              padding: '0 4px',
              borderRadius: 8,
              background: `${arrangementColor}15`,
            }}>
              {arrangement}
            </span>
            {rule.minSalary && rule.minSalary > 0 && (
              <span style={{
                fontSize: compact ? 10 : 11,
                color: '#34d399',
                fontWeight: 600,
              }}>
                {getCurrencySymbol(rule.currency)}{(rule.minSalary / 1000).toFixed(0)}k+
              </span>
            )}
            {onRemove && (
              <button
                type="button"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-tertiary)',
                  cursor: 'pointer',
                  padding: 1,
                  borderRadius: '50%',
                  flexShrink: 0,
                }}
                onClick={() => onRemove(rule.id)}
                aria-label={`Remove ${rule.value}`}
              >
                <X size={10} />
              </button>
            )}
          </span>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  LocationRulesField — full field: chips + add button + editor         */
/* ------------------------------------------------------------------ */
function LocationRulesField({
  rules,
  onChange,
}: {
  rules: LocationRule[]
  onChange: (rules: LocationRule[]) => void
}) {
  const [showEditor, setShowEditor] = useState(false)

  const handleAdd = useCallback((rule: LocationRule) => {
    onChange([...rules, rule])
    setShowEditor(false)
  }, [rules, onChange])

  const handleRemove = useCallback((id: string) => {
    onChange(rules.filter((r) => r.id !== id))
  }, [rules, onChange])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Existing rules as chips */}
      <LocationRuleChips rules={rules} onRemove={handleRemove} />

      {/* Editor or add button */}
      {showEditor ? (
        <LocationRuleEditor
          onAdd={handleAdd}
          onCancel={() => setShowEditor(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowEditor(true)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            fontSize: 12,
            fontWeight: 500,
            borderRadius: 'var(--radius-md)',
            border: '1px dashed var(--border)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'all 0.15s',
            alignSelf: 'flex-start',
          }}
        >
          <Plus size={12} />
          Add Location Rule
        </button>
      )}

      {rules.length === 0 && !showEditor && (
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>
          No location rules yet. Add zones, countries, or cities with work arrangements.
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  ChipInput + Dropdown styles                                        */
/* ------------------------------------------------------------------ */
const chipStyles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: 'relative',
  },
  inputArea: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
    minHeight: 38,
    padding: '4px 8px',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    cursor: 'text',
    boxSizing: 'border-box',
  },
  inputWrap: {
    display: 'flex',
    alignItems: 'center',
    flex: 1,
    minWidth: 80,
    gap: 4,
  },
  chipInput: {
    flex: 1,
    minWidth: 60,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'var(--text-primary)',
    fontSize: 13,
    padding: '4px 0',
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 6px 2px 8px',
    borderRadius: 12,
    background: 'rgba(96, 165, 250, 0.15)',
    border: '1px solid rgba(96, 165, 250, 0.25)',
    fontSize: 12,
    color: '#93c5fd',
    whiteSpace: 'nowrap',
    maxWidth: 200,
    overflow: 'hidden',
  },
  chipText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  chipRemove: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    color: '#93c5fd',
    cursor: 'pointer',
    padding: 2,
    borderRadius: '50%',
    flexShrink: 0,
    transition: 'background 0.15s',
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    zIndex: 50,
    maxHeight: 200,
    overflowY: 'auto',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  dropdownItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 12px',
    fontSize: 13,
    color: 'var(--text-primary)',
    cursor: 'pointer',
    transition: 'background 0.1s',
  },
  dropdownItemHighlight: {
    background: 'rgba(96, 165, 250, 0.1)',
  },
  dropdownLoading: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 12px',
    fontSize: 12,
    color: 'var(--text-tertiary)',
  },
  dropdownEmpty: {
    padding: '10px 12px',
    fontSize: 12,
    color: 'var(--text-tertiary)',
    textAlign: 'center',
  },
  locWrapper: {
    position: 'relative',
    width: '100%',
  },
  locInputWrap: {
    position: 'relative',
  },
  locInput: {
    width: '100%',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: '8px 12px',
    paddingRight: 32,
    color: 'var(--text-primary)',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  },
}

/* ------------------------------------------------------------------ */
/*  ApplicationReviewCard                                              */
/* ------------------------------------------------------------------ */
function ApplicationReviewCard({
  item,
  onApprove,
  onSkip,
  onUndo,
  onPreview,
}: {
  item: ReviewQueueItem
  onApprove: (id: string) => void
  onSkip: (id: string) => void
  onUndo: (id: string) => void
  onPreview?: (id: string) => void
}) {
  const scoreColor =
    item.matchScore > 70 ? '#34d399' : item.matchScore >= 50 ? '#fbbf24' : '#f43f5e'
  const scoreBg =
    item.matchScore > 70
      ? 'rgba(52, 211, 153, 0.12)'
      : item.matchScore >= 50
        ? 'rgba(251, 191, 36, 0.12)'
        : 'rgba(244, 63, 94, 0.12)'

  return (
    <div style={reviewStyles.card}>
      {/* Top row: company + score */}
      <div style={reviewStyles.cardTop}>
        <div style={reviewStyles.cardInfo}>
          <span style={reviewStyles.cardCompany}>{item.company}</span>
          <span style={reviewStyles.cardRole}>{item.role}</span>
        </div>
        <div
          style={{
            ...reviewStyles.scoreBadge,
            color: scoreColor,
            background: scoreBg,
            border: `1px solid ${scoreColor}33`,
          }}
        >
          <Shield size={12} />
          <span>{item.matchScore}%</span>
        </div>
      </div>

      {/* Match reasons */}
      <div style={reviewStyles.reasonsWrap}>
        {item.matchReasons.map((reason, i) => (
          <span key={i} style={reviewStyles.reasonChip}>{reason}</span>
        ))}
      </div>

      {/* What will be sent */}
      <div style={reviewStyles.sentSection}>
        <div style={reviewStyles.sentRow}>
          <span style={reviewStyles.sentLabel}>CV:</span>
          <span style={reviewStyles.sentValue}>{item.cvName}</span>
        </div>
        <div style={reviewStyles.sentRow}>
          <span style={reviewStyles.sentLabel}>Cover:</span>
          <span style={reviewStyles.sentCover}>{item.coverLetterSnippet}</span>
        </div>
      </div>

      {/* Actions: Approve | Preview | Skip */}
      {item.status === 'pending' && (
        <div style={reviewStyles.cardActions}>
          <button
            style={reviewStyles.btnApprove}
            onClick={() => onApprove(item.id)}
            title="Approve this application"
          >
            <Check size={14} />
            <span>Approve</span>
          </button>
          {onPreview && (
            <button
              style={reviewStyles.btnPreview}
              onClick={() => onPreview(item.id)}
              title="Preview &amp; edit this application"
            >
              <Eye size={14} />
              <span>Preview</span>
            </button>
          )}
          <button
            style={reviewStyles.btnSkip}
            onClick={() => onSkip(item.id)}
            title="Skip this application"
          >
            <X size={14} />
            <span>Skip</span>
          </button>
        </div>
      )}
      {item.status === 'approved' && (
        <div style={reviewStyles.cardActions}>
          <div style={reviewStyles.statusLabel}>
            <CheckCircle2 size={12} color="#34d399" />
            <span style={{ color: '#34d399', fontSize: 12, fontWeight: 600 }}>Approved</span>
          </div>
          <button
            style={reviewStyles.btnUndo}
            onClick={() => onUndo(item.id)}
            title="Undo — move back to pending"
          >
            Undo
          </button>
        </div>
      )}
      {item.status === 'skipped' && (
        <div style={reviewStyles.cardActions}>
          <div style={reviewStyles.statusLabel}>
            <XCircle size={12} color="#6b7280" />
            <span style={{ color: '#6b7280', fontSize: 12, fontWeight: 600 }}>Skipped</span>
          </div>
          <button
            style={reviewStyles.btnUndo}
            onClick={() => onUndo(item.id)}
            title="Undo — move back to pending"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  ApplicationPreviewDrawer                                            */
/* ------------------------------------------------------------------ */
const DEFAULT_SCREENING_QUESTIONS: { key: string; label: string; type: 'number' | 'textarea' | 'select' | 'text'; options?: string[]; defaultValue: string }[] = [
  { key: 'years_experience', label: 'Years of experience', type: 'number', defaultValue: '7' },
  { key: 'why_interested', label: 'Why are you interested in this role?', type: 'textarea', defaultValue: '' },
  { key: 'work_authorization', label: 'Are you authorized to work?', type: 'select', options: ['Yes', 'No', 'Requires sponsorship'], defaultValue: 'Yes' },
  { key: 'expected_salary', label: 'Expected salary', type: 'text', defaultValue: '' },
  { key: 'notice_period', label: 'Notice period', type: 'select', options: ['Immediately', '2 weeks', '1 month', '2 months', '3 months'], defaultValue: 'Immediately' },
]

function ApplicationPreviewDrawer({
  item,
  onClose,
  onApproveWithEdits,
  onSkip,
}: {
  item: ReviewQueueItem
  onClose: () => void
  onApproveWithEdits: (id: string, edits: { editedCoverLetter?: string; editedAnswers?: Record<string, string> }) => void
  onSkip: (id: string) => void
}) {
  const [coverLetter, setCoverLetter] = useState(
    item.editedCoverLetter || item.coverLetterSnippet
  )
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    if (item.editedAnswers) return { ...item.editedAnswers }
    // Load user profile for pre-filling
    let prof: Record<string, unknown> | null = null
    try {
      const raw = localStorage.getItem('tracker_v2_user_profile')
      if (raw) prof = JSON.parse(raw)
    } catch { /* ignore */ }
    const defaults: Record<string, string> = {}
    DEFAULT_SCREENING_QUESTIONS.forEach(q => {
      if (q.key === 'years_experience') {
        defaults[q.key] = String(prof?.yearsOfExperience ?? 7)
      } else if (q.key === 'why_interested') {
        const role = prof?.currentRole ? String(prof.currentRole) : 'design'
        const skills = Array.isArray(prof?.keySkills) ? (prof.keySkills as string[]).slice(0, 3).join(', ') : ''
        defaults[q.key] = `I am excited about the ${item.role} role at ${item.company}. With ${prof?.yearsOfExperience ?? '7+'}  years in ${role}${skills ? ` specializing in ${skills}` : ''}, I bring deep experience that aligns well with this position. ${item.coverLetterSnippet}`
      } else if (q.key === 'work_authorization') {
        const auths = Array.isArray(prof?.workAuthorizations) ? (prof.workAuthorizations as string[]) : []
        if (auths.some(a => a.includes('Citizen') || a.includes('Right to Work') || a.includes('PR'))) {
          defaults[q.key] = 'Yes'
        } else if (auths.some(a => a.includes('Sponsorship'))) {
          defaults[q.key] = 'Requires sponsorship'
        } else {
          defaults[q.key] = auths.length > 0 ? 'Yes' : q.defaultValue
        }
      } else if (q.key === 'expected_salary') {
        // Try to find salary from search config location rules
        try {
          const configRaw = localStorage.getItem('tracker_v2_search_config')
          if (configRaw) {
            const config = JSON.parse(configRaw)
            const rules = config.locationRules || []
            const withSalary = rules.find((r: { minSalary?: number }) => r.minSalary)
            if (withSalary) {
              defaults[q.key] = `${withSalary.currency || 'EUR'} ${withSalary.minSalary}`
            } else {
              defaults[q.key] = ''
            }
          } else {
            defaults[q.key] = ''
          }
        } catch { defaults[q.key] = '' }
      } else if (q.key === 'notice_period') {
        defaults[q.key] = (prof?.noticePeriod as string) || q.defaultValue
      } else {
        defaults[q.key] = q.defaultValue
      }
    })
    return defaults
  })

  const scoreColor =
    item.matchScore > 70 ? '#34d399' : item.matchScore >= 50 ? '#fbbf24' : '#f43f5e'
  const scoreBg =
    item.matchScore > 70
      ? 'rgba(52, 211, 153, 0.12)'
      : item.matchScore >= 50
        ? 'rgba(251, 191, 36, 0.12)'
        : 'rgba(244, 63, 94, 0.12)'

  const handleAnswerChange = useCallback((key: string, value: string) => {
    setAnswers(prev => ({ ...prev, [key]: value }))
  }, [])

  const handleApprove = useCallback(() => {
    onApproveWithEdits(item.id, {
      editedCoverLetter: coverLetter !== item.coverLetterSnippet ? coverLetter : undefined,
      editedAnswers: answers,
    })
  }, [item.id, item.coverLetterSnippet, coverLetter, answers, onApproveWithEdits])

  // Read profile from localStorage if available
  const profileData = (() => {
    try {
      const raw = localStorage.getItem('tracker_v2_user_profile')
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  })()

  const cvDisplayName = profileData?.cvFileName || item.cvName
  const portfolioUrl = profileData?.portfolioUrl || ''
  const linkedinUrl = profileData?.linkedinUrl || ''
  const githubUrl = profileData?.githubUrl || ''

  return (
    <>
      {/* Backdrop */}
      <div style={drawerStyles.backdrop} onClick={onClose} />
      {/* Drawer */}
      <div className="autopilot-preview-drawer" style={drawerStyles.drawer}>
        {/* Header */}
        <div style={drawerStyles.header}>
          <div style={drawerStyles.headerInfo}>
            <div style={drawerStyles.headerTitleRow}>
              <span style={drawerStyles.headerCompany}>{item.company}</span>
              <div
                style={{
                  ...drawerStyles.scoreBadge,
                  color: scoreColor,
                  background: scoreBg,
                  border: `1px solid ${scoreColor}33`,
                }}
              >
                <Shield size={12} />
                <span>{item.matchScore}%</span>
              </div>
            </div>
            <span style={drawerStyles.headerRole}>{item.role}</span>
          </div>
          <button style={drawerStyles.closeBtn} onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable content */}
        <div style={drawerStyles.body}>
          {/* Section 1: What the recruiter sees */}
          <div style={drawerStyles.section}>
            <h3 style={drawerStyles.sectionTitle}>What the recruiter sees</h3>

            <div style={drawerStyles.fieldGroup}>
              <label style={drawerStyles.fieldLabel}>CV</label>
              <div style={drawerStyles.fieldReadonly}>{cvDisplayName}</div>
            </div>

            <div style={drawerStyles.fieldGroup}>
              <label style={drawerStyles.fieldLabel}>Cover Letter</label>
              <textarea
                style={drawerStyles.textarea}
                value={coverLetter}
                onChange={e => setCoverLetter(e.target.value)}
                rows={6}
              />
            </div>

            {portfolioUrl && (
              <div style={drawerStyles.fieldGroup}>
                <label style={drawerStyles.fieldLabel}>Portfolio</label>
                <div style={drawerStyles.fieldReadonly}>{portfolioUrl}</div>
              </div>
            )}

            {linkedinUrl && (
              <div style={drawerStyles.fieldGroup}>
                <label style={drawerStyles.fieldLabel}>LinkedIn</label>
                <div style={drawerStyles.fieldReadonly}>{linkedinUrl}</div>
              </div>
            )}

            {githubUrl && (
              <div style={drawerStyles.fieldGroup}>
                <label style={drawerStyles.fieldLabel}>GitHub</label>
                <div style={drawerStyles.fieldReadonly}>{githubUrl}</div>
              </div>
            )}
          </div>

          {/* Section 2: Screening Answers */}
          <div style={drawerStyles.section}>
            <h3 style={drawerStyles.sectionTitle}>Screening Answers</h3>
            {DEFAULT_SCREENING_QUESTIONS.map(q => (
              <div key={q.key} style={drawerStyles.fieldGroup}>
                <label style={drawerStyles.fieldLabel}>{q.label}</label>
                {q.type === 'textarea' ? (
                  <textarea
                    style={drawerStyles.textarea}
                    value={answers[q.key] || ''}
                    onChange={e => handleAnswerChange(q.key, e.target.value)}
                    rows={4}
                  />
                ) : q.type === 'select' && q.options ? (
                  <select
                    style={drawerStyles.select}
                    value={answers[q.key] || q.defaultValue}
                    onChange={e => handleAnswerChange(q.key, e.target.value)}
                  >
                    {q.options.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    style={drawerStyles.input}
                    type={q.type === 'number' ? 'number' : 'text'}
                    value={answers[q.key] || ''}
                    onChange={e => handleAnswerChange(q.key, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Section 3: Match Details */}
          <div style={drawerStyles.section}>
            <h3 style={drawerStyles.sectionTitle}>Match Details</h3>
            <div style={drawerStyles.matchReasonsWrap}>
              {item.matchReasons.map((reason, i) => (
                <span key={i} style={drawerStyles.matchChip}>{reason}</span>
              ))}
            </div>
            <div style={drawerStyles.scoreBreakdown}>
              <span style={drawerStyles.scoreBreakdownLabel}>Match Score</span>
              <div style={drawerStyles.scoreBar}>
                <div
                  style={{
                    ...drawerStyles.scoreBarFill,
                    width: `${item.matchScore}%`,
                    background: scoreColor,
                  }}
                />
              </div>
              <span style={{ ...drawerStyles.scoreBreakdownValue, color: scoreColor }}>
                {item.matchScore}%
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={drawerStyles.footer}>
          <button style={drawerStyles.btnApproveSubmit} onClick={handleApprove}>
            <Check size={14} />
            <span>Approve &amp; Submit</span>
          </button>
          <button
            style={drawerStyles.btnFooterSkip}
            onClick={() => { onSkip(item.id); onClose() }}
          >
            Skip
          </button>
        </div>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  ReviewQueue                                                        */
/* ------------------------------------------------------------------ */
function ReviewQueue({
  queue,
  onApprove,
  onSkip,
  onUndo,
  onApproveAll,
  onSkipAll,
  onSubmitApproved,
  onPreview,
  isDemo,
  reviewMode,
  onToggleMode,
}: {
  queue: ReviewQueueItem[]
  onApprove: (id: string) => void
  onSkip: (id: string) => void
  onUndo: (id: string) => void
  onApproveAll: () => void
  onSkipAll: () => void
  onSubmitApproved: () => void
  onPreview?: (id: string) => void
  isDemo: boolean
  reviewMode: ReviewMode
  onToggleMode: (mode: ReviewMode) => void
}) {
  const pendingCount = queue.filter((i) => i.status === 'pending').length
  const approvedCount = queue.filter((i) => i.status === 'approved').length
  if (queue.length === 0) return null

  return (
    <section style={reviewStyles.queueSection}>
      {/* Header */}
      <div style={reviewStyles.queueHeader}>
        <div>
          <div style={reviewStyles.queueTitleRow}>
            <Search size={16} color="var(--accent)" />
            <h2 style={reviewStyles.queueTitle}>
              Search complete &mdash; {queue.length} match{queue.length !== 1 ? 'es' : ''} found
            </h2>
            {isDemo && (
              <span style={reviewStyles.demoBadge}>Sample data</span>
            )}
          </div>
          <p style={reviewStyles.queueSubtext}>
            Review your matches. Nothing is submitted until you approve.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* View toggle */}
          <div style={reviewStyles.viewToggleWrap}>
            <button
              style={{
                ...reviewStyles.viewToggleBtn,
                ...(reviewMode === 'list' ? reviewStyles.viewToggleBtnActive : {}),
              }}
              onClick={() => onToggleMode('list')}
              title="List view"
            >
              <List size={14} />
            </button>
            <button
              style={{
                ...reviewStyles.viewToggleBtn,
                ...(reviewMode === 'card' ? reviewStyles.viewToggleBtnActive : {}),
              }}
              onClick={() => onToggleMode('card')}
              title="Card view"
            >
              <LayoutGrid size={14} />
            </button>
          </div>
          {/* Bulk actions (list mode only) */}
          {pendingCount > 0 && reviewMode === 'list' && (
            <div style={reviewStyles.queueBulkActions}>
              <button style={reviewStyles.btnApproveAll} onClick={onApproveAll}>
                <Check size={12} />
                <span>Approve All</span>
              </button>
              <button style={reviewStyles.btnSkipAll} onClick={onSkipAll}>
                <X size={12} />
                <span>Skip All</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Card Stack mode */}
      {reviewMode === 'card' && (
        <CardStackReview
          queue={queue}
          onApprove={onApprove}
          onSkip={onSkip}
          onUndo={onUndo}
        />
      )}

      {/* List mode */}
      {reviewMode === 'list' && (
        <div style={reviewStyles.queueList}>
          {queue.map((item) => (
            <ApplicationReviewCard
              key={item.id}
              item={item}
              onApprove={onApprove}
              onUndo={onUndo}
              onSkip={onSkip}
              onPreview={onPreview}
            />
          ))}
        </div>
      )}

      {/* Bottom CTA */}
      <div style={reviewStyles.queueBottom}>
        <button
          style={{
            ...reviewStyles.btnSubmitApproved,
            ...(approvedCount === 0 ? { opacity: 0.4, cursor: 'not-allowed' } : {}),
          }}
          disabled={approvedCount === 0}
          onClick={onSubmitApproved}
        >
          <Play size={14} />
          <span>Submit {approvedCount} Approved Application{approvedCount !== 1 ? 's' : ''}</span>
        </button>
        <button style={reviewStyles.btnSaveLater}>
          <Save size={12} />
          <span>Save and submit later</span>
        </button>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  AutoSubmitSuggestion card                                          */
/* ------------------------------------------------------------------ */
function AutoSubmitSuggestionCard({
  runCount,
  onEnable,
  onDismiss,
}: {
  runCount: number
  onEnable: () => void
  onDismiss: () => void
}) {
  return (
    <section style={autoSubmitStyles.card}>
      <div style={autoSubmitStyles.header}>
        <Zap size={20} color="#f59e0b" />
        <h3 style={autoSubmitStyles.title}>Your bot is getting good at this.</h3>
      </div>
      <p style={autoSubmitStyles.evidence}>
        After {runCount} searches, you approved 80%+ of jobs with a 85%+ match score.
      </p>
      <ul style={autoSubmitStyles.bulletList}>
        <li style={autoSubmitStyles.bullet}>Only auto-submits jobs scoring 90% or above</li>
        <li style={autoSubmitStyles.bullet}>Jobs below that threshold still come to you for review</li>
        <li style={autoSubmitStyles.bullet}>You can turn it off anytime from the top bar</li>
        <li style={autoSubmitStyles.bullet}>Every submission is logged in your activity feed</li>
      </ul>
      <div style={autoSubmitStyles.actions}>
        <button style={autoSubmitStyles.btnEnable} onClick={onEnable}>
          <Zap size={14} />
          <span>Enable Auto-Submit</span>
        </button>
        <button style={autoSubmitStyles.btnDismiss} onClick={onDismiss}>
          No thanks
        </button>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  AutoSubmit Queue sections (when auto-submit is ON)                 */
/* ------------------------------------------------------------------ */
function AutoSubmitQueues({
  needsReview,
  autoSubmitted,
  onApprove,
  onUndo,
  onSkip,
  onPreview,
}: {
  needsReview: ReviewQueueItem[]
  autoSubmitted: { company: string; role: string; time: string }[]
  onApprove: (id: string) => void
  onUndo: (id: string) => void
  onSkip: (id: string) => void
  onPreview?: (id: string) => void
}) {
  const [autoExpanded, setAutoExpanded] = useState(false)

  return (
    <>
      {/* Needs Review section — expanded */}
      {needsReview.length > 0 && (
        <section style={reviewStyles.queueSection}>
          <div style={reviewStyles.queueHeader}>
            <div style={reviewStyles.queueTitleRow}>
              <Eye size={16} color="#f59e0b" />
              <h2 style={reviewStyles.queueTitle}>
                Needs Your Review ({needsReview.length})
              </h2>
            </div>
          </div>
          <div style={reviewStyles.queueList}>
            {needsReview.map((item) => (
              <ApplicationReviewCard
                key={item.id}
                item={item}
                onApprove={onApprove}
                onUndo={onUndo}
                onSkip={onSkip}
                onPreview={onPreview}
              />
            ))}
          </div>
        </section>
      )}

      {/* Auto-submitted section — collapsed by default */}
      {autoSubmitted.length > 0 && (
        <section style={autoSubmitStyles.queueSection}>
          <button
            style={autoSubmitStyles.queueToggle}
            onClick={() => setAutoExpanded(!autoExpanded)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle2 size={16} color="#34d399" />
              <span style={autoSubmitStyles.queueToggleTitle}>
                Auto-Submitted Today ({autoSubmitted.length})
              </span>
            </div>
            {autoExpanded ? <ChevronUp size={14} color="var(--text-tertiary)" /> : <ChevronDown size={14} color="var(--text-tertiary)" />}
          </button>
          {autoExpanded && (
            <div style={autoSubmitStyles.submittedList}>
              {autoSubmitted.map((item, i) => (
                <div key={i} style={autoSubmitStyles.submittedItem}>
                  <CheckCircle2 size={12} color="#34d399" />
                  <span style={autoSubmitStyles.submittedCompany}>{item.company}</span>
                  <span style={autoSubmitStyles.submittedRole}>{item.role}</span>
                  <span style={autoSubmitStyles.submittedTime}>{item.time}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  ReviewQueue + Card styles                                          */
/* ------------------------------------------------------------------ */
const reviewStyles: Record<string, React.CSSProperties> = {
  queueSection: {
    background: 'var(--bg-surface)',
    border: '1px solid rgba(96, 165, 250, 0.25)',
    borderRadius: 'var(--radius-lg)',
    padding: 20,
  },
  queueHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
    flexWrap: 'wrap' as const,
  },
  queueTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  queueTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary)',
    margin: 0,
  },
  queueSubtext: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    margin: '4px 0 0 24px',
  },
  demoBadge: {
    fontSize: 10,
    fontWeight: 500,
    padding: '2px 8px',
    borderRadius: 6,
    background: 'rgba(139, 92, 246, 0.12)',
    color: '#a78bfa',
    whiteSpace: 'nowrap' as const,
    letterSpacing: '0.02em',
  },
  queueBulkActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  btnApproveAll: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: 'rgba(52, 211, 153, 0.12)',
    color: '#34d399',
    fontWeight: 600,
    fontSize: 12,
    padding: '6px 12px',
    borderRadius: 6,
    border: '1px solid rgba(52, 211, 153, 0.25)',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    transition: 'background 0.15s',
  },
  btnSkipAll: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: 'rgba(107, 114, 128, 0.12)',
    color: '#9ca3af',
    fontWeight: 600,
    fontSize: 12,
    padding: '6px 12px',
    borderRadius: 6,
    border: '1px solid rgba(107, 114, 128, 0.25)',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    transition: 'background 0.15s',
  },
  queueList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    maxHeight: 480,
    overflowY: 'auto',
  },
  queueBottom: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginTop: 16,
    paddingTop: 16,
    borderTop: '1px solid var(--border)',
  },
  btnSubmitApproved: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: '#34d399',
    color: '#09090b',
    fontWeight: 700,
    fontSize: 14,
    padding: '10px 20px',
    borderRadius: 'var(--radius-md)',
    border: 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    transition: 'opacity 0.15s',
  },
  btnSaveLater: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: 13,
    cursor: 'pointer',
    textDecoration: 'underline',
    textUnderlineOffset: 2,
    padding: 0,
  },
  card: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  cardTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  cardCompany: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  cardRole: {
    fontSize: 13,
    color: 'var(--text-secondary)',
  },
  scoreBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 14,
    fontWeight: 700,
    padding: '4px 10px',
    borderRadius: 8,
    flexShrink: 0,
  },
  reasonsWrap: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 4,
  },
  reasonChip: {
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 12,
    background: 'rgba(96, 165, 250, 0.10)',
    color: '#93c5fd',
    border: '1px solid rgba(96, 165, 250, 0.15)',
    whiteSpace: 'nowrap' as const,
  },
  sentSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '8px 10px',
    background: 'rgba(255,255,255,0.02)',
    borderRadius: 6,
    border: '1px solid var(--border)',
  },
  sentRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
  },
  sentLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-tertiary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
    flexShrink: 0,
  },
  sentValue: {
    fontSize: 12,
    color: 'var(--text-secondary)',
  },
  sentCover: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    lineHeight: 1.4,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
    overflow: 'hidden',
  },
  cardActions: {
    display: 'flex',
    gap: 8,
    marginTop: 2,
  },
  btnApprove: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: '#34d399',
    color: '#09090b',
    fontWeight: 600,
    fontSize: 12,
    padding: '6px 14px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  btnUndo: {
    background: 'none',
    border: 'none',
    color: 'var(--text-tertiary)',
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
    textDecoration: 'underline' as const,
    textUnderlineOffset: '2px',
    padding: '4px 8px',
    marginLeft: 'auto',
  },
  btnSkip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: 'transparent',
    color: '#9ca3af',
    fontWeight: 500,
    fontSize: 12,
    padding: '6px 14px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    transition: 'border-color 0.15s',
  },
  statusLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  btnPreview: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: 'transparent',
    color: '#93c5fd',
    fontWeight: 500,
    fontSize: 12,
    padding: '6px 14px',
    borderRadius: 6,
    border: '1px solid rgba(96, 165, 250, 0.3)',
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
  },
  viewToggleWrap: {
    display: 'inline-flex',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 2,
    gap: 2,
  },
  viewToggleBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 30,
    height: 28,
    borderRadius: 6,
    border: 'none',
    background: 'transparent',
    color: 'var(--text-tertiary)',
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
  },
  viewToggleBtnActive: {
    background: 'rgba(96, 165, 250, 0.12)',
    color: '#93c5fd',
  },
}

/* ------------------------------------------------------------------ */
/*  AutoSubmit suggestion + queue styles                                */
/* ------------------------------------------------------------------ */
const autoSubmitStyles: Record<string, React.CSSProperties> = {
  card: {
    background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.06) 0%, rgba(251, 191, 36, 0.03) 100%)',
    border: '1px solid rgba(245, 158, 11, 0.2)',
    borderRadius: 'var(--radius-lg)',
    padding: 20,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--text-primary)',
    margin: 0,
  },
  evidence: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    margin: '0 0 12px',
    lineHeight: 1.4,
  },
  bulletList: {
    margin: '0 0 16px',
    padding: '0 0 0 20px',
    listStyle: 'none',
  },
  bullet: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    lineHeight: 1.8,
    position: 'relative' as const,
    paddingLeft: 4,
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  btnEnable: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: '#f59e0b',
    color: '#09090b',
    fontWeight: 700,
    fontSize: 14,
    padding: '10px 20px',
    borderRadius: 'var(--radius-md)',
    border: 'none',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  btnDismiss: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: 13,
    cursor: 'pointer',
    padding: '10px 12px',
  },
  /* Auto-submit ON badge */
  topBarBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 12px',
    borderRadius: 20,
    background: 'rgba(245, 158, 11, 0.12)',
    border: '1px solid rgba(245, 158, 11, 0.25)',
    fontSize: 12,
    fontWeight: 600,
    color: '#f59e0b',
    whiteSpace: 'nowrap' as const,
  },
  topBarBadgeOff: {
    marginLeft: 4,
    background: 'none',
    border: 'none',
    color: 'var(--text-tertiary)',
    fontSize: 11,
    cursor: 'pointer',
    textDecoration: 'underline',
    padding: 0,
  },
  /* Queue sections */
  queueSection: {
    background: 'var(--bg-surface)',
    border: '1px solid rgba(52, 211, 153, 0.2)',
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden',
  },
  queueToggle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '14px 16px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--text-primary)',
  },
  queueToggleTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  submittedList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    padding: '0 16px 12px',
  },
  submittedItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 0',
    borderBottom: '1px solid var(--border)',
    fontSize: 13,
  },
  submittedCompany: {
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  submittedRole: {
    color: 'var(--text-secondary)',
    flex: 1,
  },
  submittedTime: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
    whiteSpace: 'nowrap' as const,
  },
}

/* ------------------------------------------------------------------ */
/*  SearchSettingsForm — always-visible, auto-saving settings form      */
/* ------------------------------------------------------------------ */
function SearchSettingsForm({
  config,
  onChange,
  showSaved,
  compact,
}: {
  config: SearchConfig
  onChange: (patch: Partial<SearchConfig>) => void
  showSaved: boolean
  compact?: boolean
}) {
  return (
    <div style={compact ? sidebarFormStyles.card : styles.formCard}>
      <div style={styles.fieldGroup}>
        <label style={styles.label}>Keywords</label>
        <p style={styles.hint}>Type a keyword and press Enter</p>
        <ChipInput
          chips={config.keywords}
          onAdd={(val) => onChange({ keywords: [...config.keywords, val] })}
          onRemove={(idx) => onChange({ keywords: config.keywords.filter((_, i) => i !== idx) })}
          placeholder="Search job titles..."
          suggestions={JOB_TITLE_SUGGESTIONS}
        />
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.label}>Location Rules</label>
        <p style={styles.hint}>Set salary per location — different markets, different expectations</p>
        <LocationRulesField rules={config.locationRules} onChange={(rules) => onChange({ locationRules: rules })} />
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.label}>Excluded Companies</label>
        <CompanyChipInput
          chips={config.excludedCompanies}
          onAdd={(val) => onChange({ excludedCompanies: [...config.excludedCompanies, val] })}
          onRemove={(idx) => onChange({ excludedCompanies: config.excludedCompanies.filter((_, i) => i !== idx) })}
          placeholder="Search companies..."
        />
      </div>

      {/* Daily Limit */}
      <div style={styles.fieldGroup}>
        <label style={styles.label}>Daily Cap</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            style={{ ...styles.input, width: 80, flex: 'none' }}
            type="number"
            min={1}
            max={50}
            value={config.dailyLimit}
            onChange={(e) => {
              const val = Math.max(1, Math.min(50, parseInt(e.target.value) || 1))
              onChange({ dailyLimit: val })
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>/day</span>
          {config.dailyLimit > 25 && (
            <div style={dailyLimitStyles.warning}>
              <AlertTriangle size={14} color="#f97316" />
              <span style={dailyLimitStyles.warningText}>Risk of restrictions</span>
            </div>
          )}
          {showSaved && (
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              color: '#34d399',
              marginLeft: 'auto',
              whiteSpace: 'nowrap' as const,
              animation: 'fadeInOut 2s ease-in-out forwards',
            }}>
              Saved
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Sidebar-specific form styles                                        */
/* ------------------------------------------------------------------ */
const sidebarFormStyles: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
}

/* ------------------------------------------------------------------ */
/*  ActiveFilterTags — compact summary tags for the right panel         */
/* ------------------------------------------------------------------ */
function ActiveFilterTags({ config }: { config: SearchConfig }) {
  const hasAnything = config.keywords.length > 0 || config.locationRules.length > 0 ||
    config.excludedCompanies.length > 0
  if (!hasAnything) return null

  return (
    <div style={filterTagStyles.bar}>
      <Tag size={12} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />

      {/* Keywords as tags */}
      {config.keywords.map((kw, i) => (
        <span key={`kw-${i}`} style={filterTagStyles.tag}>
          <Search size={10} />
          {kw}
        </span>
      ))}

      {/* Location rules as tags */}
      {config.locationRules.map((rule) => {
        const icon = getLocationRuleIcon(rule)
        const salaryPart = rule.minSalary && rule.minSalary > 0
          ? ` ${getCurrencySymbol(rule.currency)}${(rule.minSalary / 1000).toFixed(0)}k+`
          : ''
        const arrangement = rule.workArrangement === 'any' ? '' :
          rule.workArrangement === 'remote' ? ' Remote' :
          rule.workArrangement === 'hybrid' ? ' Hybrid' : ' On-site'
        return (
          <span key={rule.id} style={filterTagStyles.tagLocation}>
            {icon} {rule.value}{arrangement}{salaryPart}
          </span>
        )
      })}

      {/* Excluded count */}
      {config.excludedCompanies.length > 0 && (
        <span style={filterTagStyles.tagExcluded}>
          <Building2 size={10} />
          {config.excludedCompanies.length} excluded
        </span>
      )}

      {/* Daily cap */}
      {config.dailyLimit && (
        <span style={filterTagStyles.tagCap}>
          <Shield size={10} />
          {config.dailyLimit}/day
        </span>
      )}
    </div>
  )
}

const filterTagStyles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    padding: '10px 14px',
    background: 'rgba(96, 165, 250, 0.04)',
    border: '1px solid rgba(96, 165, 250, 0.12)',
    borderRadius: 'var(--radius-md)',
  },
  profileName: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap',
  },
  divider: {
    width: 1,
    height: 16,
    background: 'var(--border)',
    flexShrink: 0,
  },
  tag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    fontSize: 11,
    fontWeight: 500,
    borderRadius: 12,
    background: 'rgba(96, 165, 250, 0.10)',
    color: '#93c5fd',
    border: '1px solid rgba(96, 165, 250, 0.18)',
    whiteSpace: 'nowrap',
  },
  tagLocation: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    padding: '2px 8px',
    fontSize: 11,
    fontWeight: 500,
    borderRadius: 12,
    background: 'rgba(52, 211, 153, 0.08)',
    color: '#6ee7b7',
    border: '1px solid rgba(52, 211, 153, 0.18)',
    whiteSpace: 'nowrap',
  },
  tagExcluded: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    fontSize: 11,
    fontWeight: 500,
    borderRadius: 12,
    background: 'rgba(244, 63, 94, 0.08)',
    color: '#fda4af',
    border: '1px solid rgba(244, 63, 94, 0.15)',
    whiteSpace: 'nowrap',
  },
  tagCap: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    fontSize: 11,
    fontWeight: 500,
    borderRadius: 12,
    background: 'rgba(251, 191, 36, 0.08)',
    color: '#fcd34d',
    border: '1px solid rgba(251, 191, 36, 0.15)',
    whiteSpace: 'nowrap',
  },
}

/* ------------------------------------------------------------------ */
/*  FilterSidebar — collapsible left panel showing search settings       */
/* ------------------------------------------------------------------ */
function FilterSidebar({
  config,
  onChange,
  showSaved,
  onEditProfile,
}: {
  config: SearchConfig
  onChange: (patch: Partial<SearchConfig>) => void
  showSaved: boolean
  onEditProfile?: () => void
}) {
  return (
    <div style={sidebarStyles.inner}>
      {/* Sidebar header */}
      <div style={sidebarStyles.header}>
        <SlidersHorizontal size={16} color="var(--accent)" />
        <h2 style={sidebarStyles.title}>Search Settings</h2>
        {showSaved && (
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#34d399',
            marginLeft: 'auto',
            whiteSpace: 'nowrap' as const,
          }}>
            Saved
          </span>
        )}
      </div>

      {/* Always-visible form */}
      <div style={sidebarStyles.formWrap}>
        <SearchSettingsForm
          config={config}
          onChange={onChange}
          showSaved={false}
          compact
        />
      </div>

      {/* Edit Profile link removed — now in top bar */}
    </div>
  )
}

const sidebarStyles: Record<string, React.CSSProperties> = {
  inner: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    height: '100%',
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '16px 14px',
  },
  editProfileLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'none',
    border: 'none',
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    padding: '8px 0',
    marginTop: 4,
    opacity: 0.8,
    transition: 'opacity 0.15s',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  title: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text-primary)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    margin: 0,
  },
  profileList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  profileCard: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: '10px 12px',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  profileCardActive: {
    border: '1px solid rgba(96, 165, 250, 0.4)',
    background: 'rgba(96, 165, 250, 0.06)',
  },
  profileTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  profileName: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  meta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
  },
  metaChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    padding: '1px 6px',
    fontSize: 10,
    fontWeight: 500,
    borderRadius: 8,
    background: 'rgba(255,255,255,0.04)',
    color: 'var(--text-tertiary)',
    whiteSpace: 'nowrap',
  },
  locationLine: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    color: 'var(--text-secondary)',
    lineHeight: 1.6,
  },
  addBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: '100%',
    padding: '8px 12px',
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 'var(--radius-md)',
    border: '1px dashed var(--border)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  formWrap: {
    maxHeight: 'calc(100vh - 200px)',
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  emptyHint: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    padding: '20px 8px',
  },
}

/* ------------------------------------------------------------------ */
/*  Daily Limit warning styles                                         */
/* ------------------------------------------------------------------ */
const dailyLimitStyles: Record<string, React.CSSProperties> = {
  warning: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    borderRadius: 6,
    background: 'rgba(249, 115, 22, 0.08)',
    border: '1px solid rgba(249, 115, 22, 0.2)',
  },
  warningText: {
    fontSize: 12,
    color: '#f97316',
    lineHeight: 1.3,
  },
}

/* ------------------------------------------------------------------ */
/*  ApplicationPreviewDrawer styles                                     */
/* ------------------------------------------------------------------ */
const drawerStyles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.55)',
    zIndex: 200,
  },
  drawer: {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: 500,
    maxWidth: '100vw',
    background: 'var(--bg-surface)',
    borderLeft: '1px solid var(--border)',
    zIndex: 201,
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.4)',
    animation: 'drawerSlideIn 0.2s ease-out',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: '20px 20px 16px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  headerInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 0,
  },
  headerTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  headerCompany: {
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  headerRole: {
    fontSize: 14,
    color: 'var(--text-secondary)',
  },
  scoreBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 13,
    fontWeight: 700,
    padding: '3px 8px',
    borderRadius: 6,
    flexShrink: 0,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-tertiary)',
    cursor: 'pointer',
    padding: 4,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'color 0.15s',
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '0 20px 20px',
  },
  section: {
    padding: '16px 0',
    borderBottom: '1px solid var(--border)',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    margin: '0 0 12px',
  },
  fieldGroup: {
    marginBottom: 12,
  },
  fieldLabel: {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: 4,
  },
  fieldReadonly: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
    padding: '8px 10px',
    background: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 6,
    border: '1px solid var(--border)',
  },
  textarea: {
    width: '100%',
    minHeight: 120,
    fontSize: 13,
    color: 'var(--text-primary)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '8px 10px',
    resize: 'vertical' as const,
    fontFamily: 'inherit',
    lineHeight: 1.5,
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  input: {
    width: '100%',
    fontSize: 13,
    color: 'var(--text-primary)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '8px 10px',
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  select: {
    width: '100%',
    fontSize: 13,
    color: 'var(--text-primary)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '8px 10px',
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box' as const,
    cursor: 'pointer',
  },
  matchReasonsWrap: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 6,
    marginBottom: 12,
  },
  matchChip: {
    fontSize: 12,
    padding: '3px 10px',
    borderRadius: 12,
    background: 'rgba(96, 165, 250, 0.10)',
    color: '#93c5fd',
    border: '1px solid rgba(96, 165, 250, 0.15)',
    whiteSpace: 'nowrap' as const,
  },
  scoreBreakdown: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  scoreBreakdownLabel: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    flexShrink: 0,
  },
  scoreBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    background: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden',
  },
  scoreBarFill: {
    height: '100%',
    borderRadius: 3,
    transition: 'width 0.3s ease',
  },
  scoreBreakdownValue: {
    fontSize: 14,
    fontWeight: 700,
    flexShrink: 0,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '16px 20px',
    borderTop: '1px solid var(--border)',
    flexShrink: 0,
  },
  btnApproveSubmit: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: '#34d399',
    color: '#09090b',
    fontWeight: 700,
    fontSize: 14,
    padding: '10px 20px',
    borderRadius: 'var(--radius-md)',
    border: 'none',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  btnFooterSkip: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: 13,
    cursor: 'pointer',
    textDecoration: 'underline' as const,
    textUnderlineOffset: '2px',
    padding: '10px 12px',
  },
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function AutopilotView() {
  const [searchConfig, setSearchConfig] = useState<SearchConfig>(loadSearchConfig)
  const [showSaved, setShowSaved] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Whether the config has any meaningful content
  const hasConfig = searchConfig.keywords.length > 0 || searchConfig.locationRules.length > 0

  // Plan / trial gating
  const {
    canUseBot,
    isTrialActive: trialIsActive,
    isTrialExpired: trialIsExpired,
    trialDaysLeft,
    effectivePlan,
    plan: basePlan,
    platformLimits,
    linkedInUsedToday,
    atsUsedToday,
    linkedInRemainingToday,
    atsRemainingToday,
  } = usePlan()
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const { setActiveView: navigateToView } = useUI()

  // Auto-save handler with debounce
  const handleConfigChange = useCallback((patch: Partial<SearchConfig>) => {
    setSearchConfig(prev => {
      const next = { ...prev, ...patch }
      // Debounced save
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => {
        saveSearchConfig(next)
        setShowSaved(true)
        setTimeout(() => setShowSaved(false), 2000)
      }, 400)
      return next
    })
  }, [])

  // Mobile detection (simple)
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // On mobile, sidebar starts closed
  useEffect(() => {
    if (isMobile) setSidebarOpen(false)
  }, [isMobile])

  // Realtime bot data
  const { activities, currentRun, isLive } = useBotActivity()
  const hasRealData = activities.length > 0 || currentRun !== null

  // Bot triggering state
  const [isTriggering, setIsTriggering] = useState(false)
  const [triggerError, setTriggerError] = useState<string | null>(null)

  // Run polling state (real-time progress tracking)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [runStartTime, setRunStartTime] = useState<number | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [polledRunStatus, setPolledRunStatus] = useState<'QUEUED' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'CRASHED' | 'REATTEMPTING' | null>(null)
  const [polledRunOutput, setPolledRunOutput] = useState<{ jobsFound?: number; jobsQualified?: number; discoveredJobs?: DiscoveredJob[] } | null>(null)

  // Review queue state
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueItem[]>(() => loadReviewQueue())
  const [isReviewDemo] = useState(false)
  const [reviewMode, setReviewMode] = useState<ReviewMode>(() => loadReviewMode())

  const handleToggleReviewMode = useCallback((mode: ReviewMode) => {
    setReviewMode(mode)
    saveReviewMode(mode)
  }, [])

  // Preview drawer state
  const [previewItemId, setPreviewItemId] = useState<string | null>(null)
  const previewItem = previewItemId ? reviewQueue.find(i => i.id === previewItemId) ?? null : null

  // Feedback signal / bot learning state
  const [learningToast, setLearningToast] = useState<string | null>(null)
  const [learningStatus, setLearningStatus] = useState(() => getLearningStatus())
  const learningToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-submit state
  const [autoSubmitOn, setAutoSubmitOn] = useState(getAutoSubmitEnabled)
  const [showAutoSubmitSuggestion, setShowAutoSubmitSuggestion] = useState(false)
  const [runCount] = useState(getRunCount)

  // Persist review queue on change
  useEffect(() => {
    if (!isReviewDemo) saveReviewQueue(reviewQueue)
  }, [reviewQueue, isReviewDemo])

  // Check if auto-submit suggestion should show
  useEffect(() => {
    if (!autoSubmitOn && runCount >= 3 && !isAutoSubmitDismissedRecently()) {
      // Check approval rate for high-score jobs
      const highScoreJobs = reviewQueue.filter(j => j.matchScore >= 85)
      const approvedHighScore = highScoreJobs.filter(j => j.status === 'approved').length
      if (highScoreJobs.length > 0 && approvedHighScore / highScoreJobs.length >= 0.8) {
        setShowAutoSubmitSuggestion(true)
      }
    }
  }, [autoSubmitOn, runCount, reviewQueue])

  // Profile setup modal state
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [showProfileEditModal, setShowProfileEditModal] = useState(false)
  const pendingBotActionRef = useRef<(() => void) | null>(null)
  const reviewQueueRef = useRef<HTMLDivElement>(null)

  // Run history
  const [runHistory, setRunHistory] = useState<BotRunHistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)

  // Computed: is the bot currently active
  const isBotActive = currentRun?.status === 'running' || currentRun?.status === 'pending'

  // Load run history on mount
  useEffect(() => {
    async function loadHistory() {
      try {
        const { data } = await supabase
          .from('bot_runs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(20)

        if (data) {
          setRunHistory((data as Record<string, unknown>[]).map((row) => ({
            id: row.id as string,
            status: row.status as string,
            startedAt: (row.started_at as string) ?? null,
            completedAt: (row.completed_at as string) ?? null,
            jobsFound: (row.jobs_found as number) ?? 0,
            jobsApplied: (row.jobs_applied as number) ?? 0,
            jobsSkipped: (row.jobs_skipped as number) ?? 0,
            jobsFailed: (row.jobs_failed as number) ?? 0,
            errorMessage: (row.error_message as string) ?? null,
          })))
        }
      } catch {
        // Ignore — offline
      } finally {
        setHistoryLoading(false)
      }
    }
    loadHistory()
  }, [])

  // Auth wall for bot features
  const { requireAuth } = useAuthWall()

  // Core bot run logic (called after auth check)
  // Pass 'search_config' as profileId — the backend resolves the single config
  const doStartBot = useCallback(async () => {
    if (!hasConfig) return
    setIsTriggering(true)
    setTriggerError(null)
    // Reset polling state
    setActiveRunId(null)
    setRunStartTime(null)
    setElapsedSeconds(0)
    setPolledRunStatus(null)
    setPolledRunOutput(null)
    try {
      const result = await triggerBotRun('search_config')
      // Start polling
      setActiveRunId(result.runId)
      setRunStartTime(Date.now())
      setPolledRunStatus('QUEUED')
    } catch (err) {
      setTriggerError((err as Error).message)
    } finally {
      setIsTriggering(false)
    }
  }, [hasConfig])

  // ---- Trigger.dev run polling (every 5s) ----------------------------
  useEffect(() => {
    if (!activeRunId) return
    const TERMINAL = ['COMPLETED', 'FAILED', 'CRASHED', 'CANCELED', 'SYSTEM_FAILURE']
    const triggerKey = import.meta.env.VITE_TRIGGER_PUBLIC_KEY || ''

    const poll = async () => {
      try {
        // Try the individual run endpoint first
        let data: Record<string, unknown> | null = null
        const res = await fetch(`https://api.trigger.dev/api/v1/runs/${activeRunId}`, {
          headers: { Authorization: `Bearer ${triggerKey}` },
        })
        if (res.ok) {
          data = await res.json()
        } else if (res.status === 404) {
          // Fallback: use list endpoint and find our run
          const listRes = await fetch(`https://api.trigger.dev/api/v1/runs?limit=5`, {
            headers: { Authorization: `Bearer ${triggerKey}` },
          })
          if (listRes.ok) {
            const listData = await listRes.json()
            const runs = listData.data || listData.runs || []
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data = runs.find((r: any) => r.id === activeRunId) || (runs.length > 0 ? runs[0] : null)
          }
        }

        if (!data) return
        const status = data.status as string
        setPolledRunStatus(status as typeof polledRunStatus)

        // Try to extract output/stats from the run data
        const output = data.output as Record<string, unknown> | undefined
        if (output) {
          const discovered = (output.discoveredJobs ?? output.discovered_jobs) as DiscoveredJob[] | undefined
          setPolledRunOutput({
            jobsFound: (output.jobsFound ?? output.jobs_found) as number | undefined,
            jobsQualified: (output.jobsQualified ?? output.jobs_qualified) as number | undefined,
            discoveredJobs: Array.isArray(discovered) ? discovered : undefined,
          })
        }

        if (TERMINAL.includes(status)) {
          // Run reached a terminal state — stop polling
          setActiveRunId(null)
        }
      } catch {
        // Network error — keep polling, don't crash
      }
    }

    // Poll immediately, then every 5 seconds
    poll()
    const interval = setInterval(poll, 5000)
    return () => clearInterval(interval)
  }, [activeRunId])

  // ---- Elapsed time counter (every 1s while a run is active) ---------
  useEffect(() => {
    if (!runStartTime || !activeRunId) return
    const tick = () => {
      setElapsedSeconds(Math.floor((Date.now() - runStartTime) / 1000))
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [runStartTime, activeRunId])

  // ---- Convert discoveredJobs into ReviewQueueItems when run completes ---
  useEffect(() => {
    if (polledRunStatus !== 'COMPLETED') return
    const jobs = polledRunOutput?.discoveredJobs
    if (!jobs || jobs.length === 0) return

    // Load user profile for CV name
    let cvName = 'cvflo.pdf'
    try {
      const raw = localStorage.getItem('tracker_v2_user_profile')
      if (raw) {
        const prof = JSON.parse(raw)
        if (prof?.cvFileName) cvName = prof.cvFileName
      }
    } catch { /* ignore */ }

    // Build new review queue items, avoiding duplicates by URL
    const existingUrls = new Set(reviewQueue.map(i => i.jobUrl).filter(Boolean))
    const newItems: ReviewQueueItem[] = jobs
      .filter(job => !existingUrls.has(job.url))
      .map((job, index) => ({
        id: `discovered-${Date.now()}-${index}`,
        company: job.company,
        role: job.title,
        matchScore: 0,
        matchReasons: [job.location, job.isEasyApply ? 'Easy Apply' : 'External'].filter(Boolean),
        cvName,
        coverLetterSnippet: '',
        status: 'pending' as const,
        jobUrl: job.url,
      }))

    if (newItems.length > 0) {
      setReviewQueue(prev => [...newItems, ...prev])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polledRunStatus])

  // Helper: format elapsed seconds as M:SS
  const formatElapsed = (secs: number): string => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  // Derived: is a polled run actively in progress
  const isRunPolling = activeRunId !== null
  const isRunTerminal = polledRunStatus === 'COMPLETED' || polledRunStatus === 'FAILED' || polledRunStatus === 'CRASHED'

  // Core bot action after auth + profile checks
  const executeBotAction = useCallback(() => {
    if (!requireAuth('start_bot', () => { doStartBot() })) return
    doStartBot()
    incrementRunCount()
  }, [requireAuth, doStartBot])

  // Handlers with auth wall gate + profile completeness check
  const handleStartBot = useCallback(() => {
    // Check plan gating first — trial expired + free plan = blocked
    if (!canUseBot) {
      setShowUpgradeModal(true)
      return
    }
    // Check if profile is complete first
    if (!isProfileComplete()) {
      pendingBotActionRef.current = executeBotAction
      setShowProfileModal(true)
      return
    }
    executeBotAction()
  }, [executeBotAction, canUseBot])

  // Callback when profile modal completes
  const handleProfileComplete = useCallback(() => {
    setShowProfileModal(false)
    // Auto-trigger the bot run that was interrupted
    const pending = pendingBotActionRef.current
    pendingBotActionRef.current = null
    if (pending) pending()
  }, [])

  const handleProfileDismiss = useCallback(() => {
    setShowProfileModal(false)
    pendingBotActionRef.current = null
  }, [])

  // --- Feedback signal helper ---
  const emitFeedbackSignal = useCallback((item: ReviewQueueItem, action: 'approved' | 'skipped') => {
    const signal: FeedbackSignal = {
      jobId: item.id,
      company: item.company,
      role: item.role,
      matchScore: item.matchScore,
      matchReasons: item.matchReasons,
      action,
      timestamp: new Date().toISOString(),
    }
    const totalSignals = recordSignal(signal)

    // Every 5th signal show a "learning" toast
    if (totalSignals % 5 === 0) {
      // Attempt calibration at 20+ signals
      if (totalSignals >= 20) {
        const cal = calibrateRubric()
        if (cal && cal.adjustments.length > 0) {
          setLearningToast(`Bot calibrated: ${cal.adjustments[0]}`)
        } else {
          setLearningToast(`Learning from your feedback (${totalSignals} signals)`)
        }
      } else {
        setLearningToast(`Learning from your feedback (${totalSignals} signals)`)
      }
      // Auto-dismiss toast after 4 seconds
      if (learningToastTimer.current) clearTimeout(learningToastTimer.current)
      learningToastTimer.current = setTimeout(() => setLearningToast(null), 4000)
    }

    // Refresh the learning status indicator
    setLearningStatus(getLearningStatus())
  }, [])

  // Review queue handlers
  const handleReviewApprove = useCallback((id: string) => {
    setReviewQueue(prev => {
      const updated = prev.map(item => item.id === id ? { ...item, status: 'approved' as const } : item)
      const item = updated.find(i => i.id === id)
      if (item) emitFeedbackSignal(item, 'approved')
      return updated
    })
  }, [emitFeedbackSignal])

  const handleReviewUndo = useCallback((id: string) => {
    setReviewQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: 'pending' as const } : item))
    )
  }, [])

  const handleReviewSkip = useCallback((id: string) => {
    setReviewQueue(prev => {
      const updated = prev.map(item => item.id === id ? { ...item, status: 'skipped' as const } : item)
      const item = updated.find(i => i.id === id)
      if (item) emitFeedbackSignal(item, 'skipped')
      return updated
    })
  }, [emitFeedbackSignal])

  const handleReviewApproveAll = useCallback(() => {
    setReviewQueue(prev => {
      const updated = prev.map(item => item.status === 'pending' ? { ...item, status: 'approved' as const } : item)
      // Record signals for all newly approved items
      updated.filter(i => i.status === 'approved').forEach(item => {
        // Only emit for items that were pending (not already approved)
        const wasPending = prev.find(p => p.id === item.id)?.status === 'pending'
        if (wasPending) emitFeedbackSignal(item, 'approved')
      })
      return updated
    })
  }, [emitFeedbackSignal])

  const handleReviewSkipAll = useCallback(() => {
    setReviewQueue(prev => {
      const updated = prev.map(item => item.status === 'pending' ? { ...item, status: 'skipped' as const } : item)
      // Record signals for all newly skipped items
      updated.filter(i => i.status === 'skipped').forEach(item => {
        const wasPending = prev.find(p => p.id === item.id)?.status === 'pending'
        if (wasPending) emitFeedbackSignal(item, 'skipped')
      })
      return updated
    })
  }, [emitFeedbackSignal])

  const handleReviewPreview = useCallback((id: string) => {
    setPreviewItemId(id)
  }, [])

  const handlePreviewClose = useCallback(() => {
    setPreviewItemId(null)
  }, [])

  const handleApproveWithEdits = useCallback((id: string, edits: { editedCoverLetter?: string; editedAnswers?: Record<string, string> }) => {
    setReviewQueue(prev => {
      const updated = prev.map(item =>
        item.id === id
          ? { ...item, status: 'approved' as const, editedCoverLetter: edits.editedCoverLetter, editedAnswers: edits.editedAnswers }
          : item
      )
      const item = updated.find(i => i.id === id)
      if (item) emitFeedbackSignal(item, 'approved')
      return updated
    })
    setPreviewItemId(null)
  }, [emitFeedbackSignal])

  const handleSubmitApproved = useCallback(() => {
    // Future: trigger actual submission of approved jobs
    if (!requireAuth('start_bot', () => { doStartBot() })) return
    doStartBot()
  }, [requireAuth, doStartBot])

  const handleEnableAutoSubmit = useCallback(() => {
    setAutoSubmitOn(true)
    setAutoSubmitEnabled(true)
    setShowAutoSubmitSuggestion(false)
  }, [])

  const handleDismissAutoSubmit = useCallback(() => {
    setShowAutoSubmitSuggestion(false)
    dismissAutoSubmitSuggestion()
  }, [])

  const handleDisableAutoSubmit = useCallback(() => {
    setAutoSubmitOn(false)
    setAutoSubmitEnabled(false)
  }, [])

  // Persist config on change is handled by handleConfigChange debounce above

  // Profile modal summaries from search config
  const locationRulesSummary = searchConfig.locationRules
    .filter((r) => r.minSalary)
    .map((r) => `${r.value}: ${getCurrencySymbol(r.currency)}${((r.minSalary ?? 0) / 1000).toFixed(0)}k+`)
    .join(', ') || undefined

  const remotePreferenceSummary = (() => {
    const arrangements = searchConfig.locationRules.map((r) => r.workArrangement)
    if (arrangements.length === 0) return undefined
    const unique = [...new Set(arrangements)]
    return unique.map((a) => a === 'any' ? 'Any' : a === 'remote' ? 'Remote' : a === 'hybrid' ? 'Hybrid' : 'On-site').join(', ')
  })()

  // Status banner config
  const statusCfg = getStatusConfig(currentRun)

  // Auth state for anonymous-vs-authenticated branching
  const { session } = useSupabase()
  const { showAuthWall } = useAuthWallContext()
  const isAnonymous = !session

  // Anonymous CTA handler
  const handleAnonStartBot = useCallback(() => {
    showAuthWall('start_bot', () => {
      // After sign-up, bot starts with saved preferences
      if (hasConfig) {
        doStartBot()
      }
    })
  }, [showAuthWall, hasConfig, doStartBot])

  /* ------------------------------------------------------------------ */
  /*  ANONYMOUS USER: Conversion-focused layout                          */
  /* ------------------------------------------------------------------ */
  if (isAnonymous) {
    return (
      <div style={styles.container}>
        {/* Hero Section */}
        <div style={styles.heroSection}>
          <div style={styles.heroIconWrap}>
            <Bot size={32} color="var(--accent)" />
          </div>
          <h1 style={styles.heroTitle}>Auto-Apply Bot</h1>
          <p style={styles.heroSubtitle}>
            Set your criteria. Find matching jobs. Review everything before anything is sent.
          </p>

          {/* How it works steps */}
          <div style={styles.heroSteps}>
            {[
              { num: '1', text: 'Set your search criteria' },
              { num: '2', text: 'Find matching jobs' },
              { num: '3', text: 'Review and approve matches' },
              { num: '4', text: 'Submit approved applications' },
            ].map((step) => (
              <div key={step.num} style={styles.heroStep}>
                <span style={styles.heroStepNum}>{step.num}</span>
                <span style={styles.heroStepText}>{step.text}</span>
              </div>
            ))}
          </div>

          <button style={styles.heroCta} onClick={handleAnonStartBot}>
            <Search size={16} />
            Find Jobs
          </button>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>
            You&apos;ll review everything before anything is sent.
          </p>
        </div>

        {/* Bot Learning Indicator (anonymous) */}
        {learningStatus.signalCount > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 14px',
            borderRadius: 8,
            background: 'rgba(139, 92, 246, 0.08)',
            border: '1px solid rgba(139, 92, 246, 0.2)',
            fontSize: 12,
            color: '#a78bfa',
            marginBottom: 8,
          }}>
            <BrainCircuit size={14} style={{ flexShrink: 0 }} />
            <span style={{ opacity: 0.9 }}>{learningStatus.summary}</span>
          </div>
        )}

        {/* Review Queue */}
        <ReviewQueue
          queue={reviewQueue}
          onApprove={handleReviewApprove}
          onUndo={handleReviewUndo}
          onSkip={handleReviewSkip}
          onApproveAll={handleReviewApproveAll}
          onSkipAll={handleReviewSkipAll}
          onSubmitApproved={handleSubmitApproved}
          onPreview={handleReviewPreview}
          isDemo={isReviewDemo}
          reviewMode={reviewMode}
          onToggleMode={handleToggleReviewMode}
        />

        {/* Preview Drawer */}
        {previewItem && (
          <ApplicationPreviewDrawer
            item={previewItem}
            onClose={handlePreviewClose}
            onApproveWithEdits={handleApproveWithEdits}
            onSkip={handleReviewSkip}
          />
        )}

        {/* Live Activity Feed */}
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Activity</h2>
              <p style={styles.sectionSubtitle}>
                Find jobs to see results here
              </p>
            </div>
          </div>
          <div style={styles.timeline}>
            <p style={styles.emptyTimelineText}>
              Find jobs to see results here
            </p>
          </div>
        </section>

        {/* Search Settings (anonymous users can configure before sign-up) */}
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Search Settings</h2>
              <p style={styles.sectionSubtitle}>
                Configure now — the bot starts immediately after sign-up
              </p>
            </div>
            {showSaved && (
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#34d399',
                whiteSpace: 'nowrap' as const,
              }}>
                Saved
              </span>
            )}
          </div>

          <SearchSettingsForm
            config={searchConfig}
            onChange={handleConfigChange}
            showSaved={false}
          />

          {hasConfig && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
              <button style={styles.heroCta} onClick={handleAnonStartBot}>
                <Search size={14} />
                <span>Find Jobs</span>
              </button>
            </div>
          )}
        </section>

        {/* Bottom CTA */}
        <div style={styles.bottomCta}>
          <button style={styles.heroCta} onClick={handleAnonStartBot}>
            <Search size={16} />
            Find Jobs
          </button>
        </div>

        <style>{`
          @keyframes pulseGlow {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.6; transform: scale(1.3); }
          }
          @keyframes livePulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @keyframes fadeInOut {
            0% { opacity: 0; }
            15% { opacity: 1; }
            85% { opacity: 1; }
            100% { opacity: 0; }
          }
          @keyframes drawerSlideIn {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }
        `}</style>
      </div>
    )
  }

  /* ------------------------------------------------------------------ */
  /*  AUTHENTICATED USER: 2-panel layout (filter sidebar + main)         */
  /* ------------------------------------------------------------------ */
  return (
    <div style={layoutStyles.root}>
      {/* Top bar: title + Hide Filters (left) | Bot Profile + Find Jobs (right) */}
      <div className="autopilot-top-bar" style={layoutStyles.topBar}>
        <div style={layoutStyles.topBarLeft}>
          <Bot size={20} color="var(--accent)" />
          <h1 style={layoutStyles.topBarTitle}>Autopilot</h1>
          {isLive && (
            <span style={styles.liveBadge}>
              <span style={styles.liveDot} />
              LIVE
            </span>
          )}
          {/* Filter toggle — left side, next to title */}
          <button
            style={{
              ...layoutStyles.filterToggle,
              ...(sidebarOpen ? layoutStyles.filterToggleActive : {}),
            }}
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <ChevronLeft size={14} /> : <SlidersHorizontal size={14} />}
            <span>{sidebarOpen ? 'Hide Filters' : 'Filters'}</span>
            {hasConfig && !sidebarOpen && (
              <span style={layoutStyles.filterCount}>{searchConfig.keywords.length + searchConfig.locationRules.length}</span>
            )}
          </button>
        </div>
        <div className="autopilot-top-bar-right" style={layoutStyles.topBarRight}>
          {/* Auto-submit badge when ON */}
          {autoSubmitOn && (
            <span style={autoSubmitStyles.topBarBadge}>
              <Zap size={12} />
              Auto-submit: ON (90%+)
              <button style={autoSubmitStyles.topBarBadgeOff as React.CSSProperties} onClick={handleDisableAutoSubmit}>[Turn off]</button>
            </span>
          )}

          {/* Bot Profile button — secondary/outline style */}
          <button
            onClick={() => setShowProfileEditModal(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 'var(--radius-md)',
              background: 'none',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: 13, fontWeight: 600,
              cursor: 'pointer', whiteSpace: 'nowrap',
              transition: 'all 150ms ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
            title="Edit your bot profile (CV, skills, screening answers)"
          >
            <User size={13} />
            Bot Profile
            <Pencil size={10} style={{ opacity: 0.5 }} />
          </button>

          {/* Bot controls */}
          {hasConfig && !isBotActive && !isTriggering && (
            <button
              style={styles.btnStartBot}
              onClick={handleStartBot}
            >
              <Search size={14} />
              <span>Find Jobs</span>
            </button>
          )}
          {isTriggering && (
            <span style={styles.triggeringBadge}>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
              Searching...
            </span>
          )}
          {isBotActive && !isTriggering && (
            <button style={styles.btnStopBot} onClick={() => {/* future: cancel run */}}>
              <Square size={14} />
              <span>Stop</span>
            </button>
          )}
        </div>
      </div>

      {triggerError && (
        <div style={styles.triggerErrorRow}>
          <XCircle size={14} color="#f43f5e" />
          <span style={styles.triggerErrorText}>{triggerError}</span>
        </div>
      )}

      {/* 2-panel body */}
      <div style={layoutStyles.body}>
        {/* LEFT: Collapsible filter sidebar */}
        {sidebarOpen && !isMobile && (
          <div style={layoutStyles.sidebar}>
            <FilterSidebar
              config={searchConfig}
              onChange={handleConfigChange}
              showSaved={showSaved}
              onEditProfile={() => setShowProfileEditModal(true)}
            />
          </div>
        )}

        {/* Mobile: overlay sidebar */}
        {sidebarOpen && isMobile && (
          <>
            <div
              style={layoutStyles.mobileOverlay}
              onClick={() => setSidebarOpen(false)}
            />
            <div style={layoutStyles.mobileSidebar}>
              <div style={layoutStyles.mobileSheetHeader}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Filters</span>
                <button
                  style={layoutStyles.mobileCloseBtn}
                  onClick={() => setSidebarOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>
              <FilterSidebar
                config={searchConfig}
                onChange={handleConfigChange}
                showSaved={showSaved}
                onEditProfile={() => setShowProfileEditModal(true)}
              />
            </div>
          </>
        )}

        {/* RIGHT: Main content */}
        <div className="autopilot-main-panel" style={layoutStyles.main}>
          {/* Trial expired banner */}
          {trialIsExpired && basePlan === 'free' && (
            <div style={{
              padding: '10px 16px',
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.2)',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 8,
            }}>
              <span style={{ fontSize: 13, color: '#f59e0b', fontWeight: 500 }}>
                Your 14-day trial has ended. Subscribe to continue auto-applying.
              </span>
              <button
                onClick={() => navigateToView('pricing')}
                style={{
                  padding: '5px 14px',
                  borderRadius: 6,
                  background: 'var(--accent)',
                  color: '#000',
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                Upgrade
              </button>
            </div>
          )}

          {/* Active filter tags bar + platform credit bars */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ActiveFilterTags config={searchConfig} />
            </div>
            {/* Platform credit bars — polished mini progress bars */}
            {canUseBot && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 16,
                flexShrink: 0,
              }}>
                {/* LinkedIn credit bar */}
                {(() => {
                  const liMax = platformLimits.linkedInPerDay >= 999 ? Infinity : platformLimits.linkedInPerDay
                  const liRemaining = linkedInRemainingToday
                  const liUsed = linkedInUsedToday
                  const liIsUnlimited = liMax === Infinity
                  const liPct = liIsUnlimited ? (liUsed > 0 ? 30 : 0) : (liMax > 0 ? (liUsed / liMax) * 100 : 0)
                  const liBarColor = liRemaining === 0 ? '#ef4444' : liRemaining <= 2 ? '#f59e0b' : 'var(--text-tertiary)'
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', minWidth: 52 }}>LinkedIn</span>
                      <div style={{
                        width: 80, height: 4, borderRadius: 2,
                        background: 'rgba(255,255,255,0.06)',
                        overflow: 'hidden', flexShrink: 0,
                      }}>
                        <div style={{
                          width: liIsUnlimited ? '100%' : `${Math.max(liPct, 0)}%`,
                          height: '100%', borderRadius: 2,
                          background: liBarColor,
                          transition: 'width 0.3s ease, background 0.3s ease',
                        }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 500, color: liBarColor, minWidth: 44 }}>
                        {liIsUnlimited ? `${liUsed} used` : `${liUsed}/${liMax} used`}
                      </span>
                    </div>
                  )
                })()}

                {/* ATS credit bar */}
                {(() => {
                  const atsMax = platformLimits.atsPerDay >= 999 ? Infinity : platformLimits.atsPerDay
                  const atsRemaining = atsRemainingToday
                  const atsUsed = atsUsedToday
                  const atsIsUnlimited = atsMax === Infinity
                  const atsPct = atsIsUnlimited ? (atsUsed > 0 ? 30 : 0) : (atsMax > 0 ? (atsUsed / atsMax) * 100 : 0)
                  const atsBarColor = atsRemaining === 0 ? '#ef4444' : atsRemaining <= 3 ? '#f59e0b' : 'var(--text-tertiary)'
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', minWidth: 24 }}>ATS</span>
                      <div style={{
                        width: 80, height: 4, borderRadius: 2,
                        background: 'rgba(255,255,255,0.06)',
                        overflow: 'hidden', flexShrink: 0,
                      }}>
                        <div style={{
                          width: atsIsUnlimited ? '100%' : `${Math.max(atsPct, 0)}%`,
                          height: '100%', borderRadius: 2,
                          background: atsBarColor,
                          transition: 'width 0.3s ease, background 0.3s ease',
                        }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 500, color: atsBarColor, minWidth: 44 }}>
                        {atsIsUnlimited ? `${atsUsed} used` : `${atsUsed}/${atsMax} used`}
                      </span>
                    </div>
                  )
                })()}

                {/* LinkedIn exhausted — auto-switch badge */}
                {linkedInRemainingToday === 0 && platformLimits.linkedInPerDay < 999 && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '3px 10px', borderRadius: 12,
                    background: 'rgba(96, 165, 250, 0.1)',
                    border: '1px solid rgba(96, 165, 250, 0.2)',
                    fontSize: 10, fontWeight: 600,
                    color: '#93c5fd', whiteSpace: 'nowrap',
                  }}>
                    <Briefcase size={10} />
                    ATS only mode
                  </span>
                )}
              </div>
            )}

            {/* LinkedIn limit reached info banner */}
            {canUseBot && linkedInRemainingToday === 0 && platformLimits.linkedInPerDay < 999 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 12px', borderRadius: 6,
                background: 'rgba(96, 165, 250, 0.06)',
                border: '1px solid rgba(96, 165, 250, 0.12)',
              }}>
                <AlertTriangle size={12} color="#93c5fd" />
                <span style={{ fontSize: 11, color: '#93c5fd', fontWeight: 500 }}>
                  LinkedIn daily limit reached — applying via direct ATS only
                </span>
              </div>
            )}
          </div>

          {/* Progress Banner — shows during and after bot runs */}
          {(isRunPolling || isRunTerminal || isTriggering || isBotActive || currentRun?.status === 'completed' || currentRun?.status === 'failed') && (
            <section style={progressBannerStyles.container}>
              {/* Top row: status + elapsed */}
              <div style={progressBannerStyles.topRow}>
                <div style={progressBannerStyles.statusLabel}>
                  {(isTriggering || polledRunStatus === 'QUEUED' || polledRunStatus === 'REATTEMPTING') && (
                    <>
                      <span style={progressBannerStyles.pulsingDot} />
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Searching for jobs...</span>
                    </>
                  )}
                  {(polledRunStatus === 'EXECUTING' || (isBotActive && !isTriggering && !isRunPolling)) && (
                    <>
                      <span style={progressBannerStyles.pulsingDot} />
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Searching for jobs...</span>
                    </>
                  )}
                  {(polledRunStatus === 'COMPLETED' || (!isRunPolling && !isTriggering && currentRun?.status === 'completed')) && (
                    <>
                      <CheckCircle2 size={16} color="#34d399" />
                      <span style={{ fontWeight: 600, color: '#34d399' }}>Search complete</span>
                    </>
                  )}
                  {(polledRunStatus === 'FAILED' || polledRunStatus === 'CRASHED' || (!isRunPolling && !isTriggering && currentRun?.status === 'failed')) && (
                    <>
                      <XCircle size={16} color="#f43f5e" />
                      <span style={{ fontWeight: 600, color: '#f43f5e' }}>Search failed</span>
                    </>
                  )}
                </div>
                {(runStartTime || currentRun?.startedAt) && (
                  <span style={progressBannerStyles.elapsed}>
                    <Clock size={12} />
                    {activeRunId
                      ? formatElapsed(elapsedSeconds)
                      : currentRun?.completedAt && currentRun?.startedAt
                        ? formatElapsed(Math.floor((new Date(currentRun.completedAt).getTime() - new Date(currentRun.startedAt).getTime()) / 1000))
                        : ''
                    }
                  </span>
                )}
              </div>

              {/* Pulsing progress bar (only while running) */}
              {(isTriggering || isRunPolling || isBotActive) && !(polledRunStatus === 'COMPLETED' || polledRunStatus === 'FAILED' || polledRunStatus === 'CRASHED') && (
                <div style={progressBannerStyles.barTrack}>
                  <div style={progressBannerStyles.barFill} />
                </div>
              )}

              {/* Subtitle: search query while running */}
              {(isTriggering || isRunPolling || isBotActive) && !(polledRunStatus === 'COMPLETED' || polledRunStatus === 'FAILED' || polledRunStatus === 'CRASHED') && (
                <span style={progressBannerStyles.subtitle}>
                  Finding matches for {searchConfig.keywords.length > 0
                    ? `"${searchConfig.keywords.slice(0, 2).join(', ')}${searchConfig.keywords.length > 2 ? '...' : ''}"`
                    : 'your criteria'
                  }
                </span>
              )}

              {/* Completed: stats + review button */}
              {(polledRunStatus === 'COMPLETED' || (!isRunPolling && !isTriggering && currentRun?.status === 'completed')) && (
                <div style={progressBannerStyles.resultRow}>
                  <span style={progressBannerStyles.resultText}>
                    Found {polledRunOutput?.jobsFound ?? currentRun?.jobsFound ?? 0} match{(polledRunOutput?.jobsFound ?? currentRun?.jobsFound ?? 0) !== 1 ? 'es' : ''}
                    {(polledRunOutput?.jobsQualified ?? currentRun?.jobsApplied) != null && (
                      <> &middot; {polledRunOutput?.jobsQualified ?? currentRun?.jobsApplied} qualified</>
                    )}
                  </span>
                  {reviewQueue.filter(i => i.status === 'pending').length > 0 && (
                    <button
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent, #818cf8)',
                        cursor: 'pointer',
                        fontSize: 13,
                        fontWeight: 600,
                        textDecoration: 'underline',
                        padding: '2px 6px',
                      }}
                      onClick={() => reviewQueueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    >
                      Review below &darr;
                    </button>
                  )}
                </div>
              )}

              {/* Failed: error message + retry */}
              {(polledRunStatus === 'FAILED' || polledRunStatus === 'CRASHED' || (!isRunPolling && !isTriggering && currentRun?.status === 'failed')) && (
                <div style={progressBannerStyles.resultRow}>
                  <span style={{ ...progressBannerStyles.resultText, color: '#f87171' }}>
                    Something went wrong. Try again?
                  </span>
                  <button style={progressBannerStyles.retryBtn} onClick={handleStartBot}>
                    Retry
                  </button>
                </div>
              )}
            </section>
          )}

          {/* Auto-submit suggestion card */}
          {showAutoSubmitSuggestion && !autoSubmitOn && (
            <AutoSubmitSuggestionCard
              runCount={runCount}
              onEnable={handleEnableAutoSubmit}
              onDismiss={handleDismissAutoSubmit}
            />
          )}

          {/* Auto-submit queue sections (when enabled) */}
          {autoSubmitOn && (
            <AutoSubmitQueues
              needsReview={reviewQueue.filter(j => j.status === 'pending' && j.matchScore < 90)}
              autoSubmitted={
                // Demo auto-submitted data
                activities
                  .filter(a => a.action === 'applied')
                  .map(a => ({ company: a.company, role: a.role, time: formatActivityTime(a.createdAt) }))
              }
              onApprove={handleReviewApprove}
              onUndo={handleReviewUndo}
              onSkip={handleReviewSkip}
              onPreview={handleReviewPreview}
            />
          )}

          {/* Bot Learning Indicator */}
          {learningStatus.signalCount > 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              borderRadius: 8,
              background: 'rgba(139, 92, 246, 0.08)',
              border: '1px solid rgba(139, 92, 246, 0.2)',
              fontSize: 12,
              color: '#a78bfa',
              marginBottom: 8,
            }}>
              <BrainCircuit size={14} style={{ flexShrink: 0 }} />
              <span style={{ opacity: 0.9 }}>{learningStatus.summary}</span>
              {learningStatus.calibrated && (
                <span style={{
                  marginLeft: 'auto',
                  fontSize: 10,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: 'rgba(139, 92, 246, 0.15)',
                  color: '#c4b5fd',
                  whiteSpace: 'nowrap' as const,
                  flexShrink: 0,
                }}>
                  Threshold: {learningStatus.effectiveThreshold}
                </span>
              )}
            </div>
          )}

          {/* Review Queue (standard flow, shown when auto-submit is OFF) */}
          {!autoSubmitOn && reviewQueue.length > 0 && (
            <div ref={reviewQueueRef}>
              <ReviewQueue
                queue={reviewQueue}
                onApprove={handleReviewApprove}
                onUndo={handleReviewUndo}
                onSkip={handleReviewSkip}
                onApproveAll={handleReviewApproveAll}
                onSkipAll={handleReviewSkipAll}
                onSubmitApproved={handleSubmitApproved}
                onPreview={handleReviewPreview}
                isDemo={isReviewDemo}
                reviewMode={reviewMode}
                onToggleMode={handleToggleReviewMode}
              />
            </div>
          )}

          {/* Preview Drawer (authenticated) */}
          {previewItem && (
            <ApplicationPreviewDrawer
              item={previewItem}
              onClose={handlePreviewClose}
              onApproveWithEdits={handleApproveWithEdits}
              onSkip={handleReviewSkip}
            />
          )}

          {/* Activity Log */}
          <section style={styles.section}>
            <div style={styles.sectionHeader}>
              <div>
                <h2 style={styles.sectionTitle}>Activity</h2>
                <p style={styles.sectionSubtitle}>
                  {hasRealData ? 'Live search activity' : 'Find jobs to see results here'}
                </p>
              </div>
              {hasRealData && isLive && (
                <span style={styles.liveIndicator}>
                  <span style={styles.liveIndicatorDot} />
                  Realtime
                </span>
              )}
            </div>

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
                    No activity yet for the current search.
                  </p>
                )}
              </div>
            ) : (
              <div style={styles.timeline}>
                <p style={styles.emptyTimelineText}>
                  Find jobs to see results here
                </p>
              </div>
            )}
          </section>

          {/* Run History */}
          <section style={styles.section}>
            <div style={styles.sectionHeader}>
              <div>
                <h2 style={styles.sectionTitle}>Run History</h2>
                <p style={styles.sectionSubtitle}>Past bot pipeline runs</p>
              </div>
              <History size={16} color="var(--text-tertiary)" />
            </div>

            {historyLoading ? (
              <div style={styles.historyLoading}>
                <Loader2 size={16} color="var(--text-tertiary)" style={{ animation: 'spin 1s linear infinite' }} />
                <span style={styles.historyLoadingText}>Loading history...</span>
              </div>
            ) : runHistory.length === 0 ? (
              <p style={styles.emptyTimelineText}>No bot runs yet.</p>
            ) : (
              <div style={styles.historyTable}>
                <div style={styles.historyHeaderRow}>
                  <span style={{ ...styles.historyCell, flex: 2 }}>Date</span>
                  <span style={{ ...styles.historyCell, flex: 1 }}>Status</span>
                  <span style={{ ...styles.historyCell, flex: 1, textAlign: 'right' as const }}>Applied</span>
                  <span style={{ ...styles.historyCell, flex: 1, textAlign: 'right' as const }}>Skipped</span>
                  <span style={{ ...styles.historyCell, flex: 1, textAlign: 'right' as const }}>Failed</span>
                  <span style={{ ...styles.historyCell, flex: 1, textAlign: 'right' as const }}>Duration</span>
                </div>
                {runHistory.map((run) => (
                  <div key={run.id} style={styles.historyRow}>
                    <span style={{ ...styles.historyCellValue, flex: 2 }}>
                      {formatRunDate(run.startedAt || run.completedAt)}
                    </span>
                    <span style={{ ...styles.historyCellValue, flex: 1 }}>
                      <span
                        style={{
                          ...styles.historyStatusDot,
                          background: RUN_STATUS_COLORS[run.status] || '#6b7280',
                        }}
                      />
                      {run.status}
                    </span>
                    <span style={{ ...styles.historyCellValue, flex: 1, textAlign: 'right' as const, color: '#34d399' }}>
                      {run.jobsApplied}
                    </span>
                    <span style={{ ...styles.historyCellValue, flex: 1, textAlign: 'right' as const, color: '#fbbf24' }}>
                      {run.jobsSkipped}
                    </span>
                    <span style={{ ...styles.historyCellValue, flex: 1, textAlign: 'right' as const, color: '#f43f5e' }}>
                      {run.jobsFailed}
                    </span>
                    <span style={{ ...styles.historyCellValue, flex: 1, textAlign: 'right' as const }}>
                      {formatDuration(run.startedAt, run.completedAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Profile Setup Modal (first-time setup) */}
      {showProfileModal && (
        <ProfileSetupModal
          onComplete={handleProfileComplete}
          onDismiss={handleProfileDismiss}
          locationRulesSummary={locationRulesSummary}
          remotePreference={remotePreferenceSummary}
          locationRules={searchConfig.locationRules.map((r) => ({
            value: r.value,
            type: r.type,
            workArrangement: r.workArrangement,
            salary: r.minSalary ? `${getCurrencySymbol(r.currency)}${((r.minSalary) / 1000).toFixed(0)}k+` : undefined,
          }))}
        />
      )}

      {/* Profile Setup Modal (edit mode) */}
      {showProfileEditModal && (
        <ProfileSetupModal
          editMode
          onComplete={() => setShowProfileEditModal(false)}
          onDismiss={() => setShowProfileEditModal(false)}
          locationRulesSummary={locationRulesSummary}
          remotePreference={remotePreferenceSummary}
          locationRules={searchConfig.locationRules.map((r) => ({
            value: r.value,
            type: r.type,
            workArrangement: r.workArrangement,
            salary: r.minSalary ? `${getCurrencySymbol(r.currency)}${((r.minSalary) / 1000).toFixed(0)}k+` : undefined,
          }))}
        />
      )}

      {/* Upgrade Modal — shown when trial expired + free plan tries to use bot */}
      {showUpgradeModal && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => setShowUpgradeModal(false)}
        >
          <div
            style={{
              background: 'var(--card-bg, #1a1a2e)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              padding: 32,
              maxWidth: 420,
              width: '90%',
              textAlign: 'center',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{
              width: 56, height: 56, borderRadius: 16,
              background: 'rgba(52, 211, 153, 0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <Sparkles size={28} color="#34d399" />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 8px' }}>
              Trial Ended
            </h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: '0 0 20px', lineHeight: 1.5 }}>
              Your 14-day free trial has expired. Upgrade to a paid plan to unlock auto-apply, Stealth Mode, and LinkedIn access.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={() => setShowUpgradeModal(false)}
                style={{
                  padding: '10px 20px', borderRadius: 8,
                  background: 'none', border: '1px solid var(--border)',
                  color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Maybe later
              </button>
              <button
                onClick={() => {
                  setShowUpgradeModal(false)
                  navigateToView('pricing')
                }}
                style={{
                  padding: '10px 20px', borderRadius: 8,
                  background: 'var(--accent)', border: 'none',
                  color: '#000', fontSize: 13, fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                View Plans
              </button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '16px 0 0' }}>
              Dashboard, pipeline, analytics, and manual tracking remain free forever.
            </p>
          </div>
        </div>
      )}

      {/* Keyframe injection for pulsing dot + spinner */}
      <style>{`
        @keyframes pulseGlow {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.3); }
        }
        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes drawerSlideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes progressPulse {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        @keyframes dotPulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 4px #34d399; }
          50% { opacity: 0.5; box-shadow: 0 0 10px #34d399, 0 0 20px rgba(52,211,153,0.3); }
        }
        @keyframes feedbackToastIn {
          from { transform: translateX(-50%) translateY(20px); opacity: 0; }
          to { transform: translateX(-50%) translateY(0); opacity: 1; }
        }
      `}</style>

      {/* Learning feedback toast */}
      {learningToast && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 18px',
          borderRadius: 10,
          background: 'rgba(139, 92, 246, 0.15)',
          border: '1px solid rgba(139, 92, 246, 0.3)',
          backdropFilter: 'blur(12px)',
          fontSize: 13,
          color: '#c4b5fd',
          fontWeight: 500,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          animation: 'feedbackToastIn 0.3s ease-out',
          whiteSpace: 'nowrap' as const,
        }}>
          <BrainCircuit size={14} />
          {learningToast}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  2-Panel layout styles                                               */
/* ------------------------------------------------------------------ */
const layoutStyles: Record<string, React.CSSProperties> = {
  root: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px 12px',
    gap: 12,
    flexWrap: 'wrap',
    flexShrink: 0,
    borderBottom: '1px solid var(--border)',
  },
  topBarLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  topBarTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: 'var(--text-primary)',
    margin: 0,
  },
  topBarRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  filterToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 14px',
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)',
    background: 'var(--bg-surface)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  },
  filterToggleActive: {
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    color: 'var(--text-primary)',
  },
  filterCount: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.1)',
    color: '#93c5fd',
    fontSize: 10,
    fontWeight: 700,
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    minHeight: 0,
  },
  sidebar: {
    width: 280,
    minWidth: 280,
    maxWidth: 280,
    borderRight: '1px solid var(--border)',
    background: 'var(--bg-surface)',
    overflowY: 'auto',
    overflowX: 'hidden',
    flexShrink: 0,
  },
  main: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    minWidth: 0,
  },
  /* Mobile overlay */
  mobileOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 90,
  },
  mobileSidebar: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '80vh',
    background: 'var(--bg-surface)',
    borderTop: '1px solid var(--border)',
    borderRadius: '16px 16px 0 0',
    zIndex: 91,
    overflowY: 'auto',
    boxShadow: '0 -8px 32px rgba(0,0,0,0.4)',
  },
  mobileSheetHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px 0',
    position: 'sticky',
    top: 0,
    background: 'var(--bg-surface)',
    zIndex: 1,
  },
  mobileCloseBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 8,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
  },
}

/* ------------------------------------------------------------------ */
/*  Progress Banner Styles                                             */
/* ------------------------------------------------------------------ */
const progressBannerStyles: Record<string, React.CSSProperties> = {
  container: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '16px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  topRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  statusLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
  },
  pulsingDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: '#34d399',
    flexShrink: 0,
    animation: 'dotPulse 1.5s ease-in-out infinite',
  },
  elapsed: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    fontVariantNumeric: 'tabular-nums',
  },
  barTrack: {
    width: '100%',
    height: 4,
    borderRadius: 2,
    background: 'var(--bg-elevated)',
    overflow: 'hidden',
    position: 'relative',
  },
  barFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '50%',
    height: '100%',
    borderRadius: 2,
    background: 'linear-gradient(90deg, transparent, #34d399, transparent)',
    animation: 'progressPulse 1.8s ease-in-out infinite',
  },
  subtitle: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
  },
  resultRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 4,
  },
  resultText: {
    fontSize: 13,
    color: 'var(--text-secondary)',
  },
  retryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: 'rgba(244, 63, 94, 0.12)',
    color: '#f87171',
    fontWeight: 600,
    fontSize: 12,
    padding: '6px 14px',
    borderRadius: 6,
    border: '1px solid rgba(244, 63, 94, 0.25)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
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
  reassuranceText: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: 'var(--text-tertiary)',
    margin: '12px 0 0',
    paddingTop: 12,
    borderTop: '1px solid var(--border)',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 16px',
    borderRadius: 'var(--radius-md)',
    background: 'rgba(244, 63, 94, 0.08)',
    border: '1px solid rgba(244, 63, 94, 0.2)',
  },
  errorBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#f87171',
  },
  btnRetry: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: 'rgba(244, 63, 94, 0.12)',
    color: '#f87171',
    fontWeight: 600,
    fontSize: 12,
    padding: '6px 14px',
    borderRadius: 6,
    border: '1px solid rgba(244, 63, 94, 0.25)',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
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

  /* ---- Status Actions (bot controls) ---- */
  statusActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  btnStartBot: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: '#34d399',
    color: '#09090b',
    fontWeight: 600,
    fontSize: 13,
    padding: '8px 16px',
    borderRadius: 'var(--radius-md)',
    border: 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    transition: 'opacity 0.15s',
  },
  btnStopBot: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'rgba(244, 63, 94, 0.12)',
    color: '#f43f5e',
    fontWeight: 600,
    fontSize: 13,
    padding: '8px 16px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid rgba(244, 63, 94, 0.25)',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  triggeringBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    padding: '8px 16px',
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
  },
  triggerErrorRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    padding: '8px 12px',
    borderRadius: 'var(--radius-md)',
    background: 'rgba(244, 63, 94, 0.08)',
    border: '1px solid rgba(244, 63, 94, 0.2)',
  },
  triggerErrorText: {
    fontSize: 12,
    color: '#f87171',
  },

  /* ---- Run History ---- */
  historyLoading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '24px 0',
  },
  historyLoadingText: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
  },
  historyTable: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  historyHeaderRow: {
    display: 'flex',
    gap: 8,
    padding: '8px 12px',
    borderBottom: '1px solid var(--border)',
  },
  historyCell: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-tertiary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
  historyRow: {
    display: 'flex',
    gap: 8,
    padding: '10px 12px',
    borderBottom: '1px solid var(--border)',
    transition: 'background 0.1s',
  },
  historyCellValue: {
    fontSize: 13,
    color: 'var(--text-primary)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  historyStatusDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },

  /* ---- Anonymous Hero Section ---- */
  heroSection: {
    background: 'linear-gradient(135deg, rgba(52, 211, 153, 0.06) 0%, rgba(96, 165, 250, 0.04) 100%)',
    border: '1px solid rgba(52, 211, 153, 0.15)',
    borderRadius: 'var(--radius-lg)',
    padding: '40px 32px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: 12,
  },
  heroIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 16,
    background: 'rgba(52, 211, 153, 0.1)',
    border: '1px solid rgba(52, 211, 153, 0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: 700,
    color: 'var(--text-primary)',
    margin: 0,
  },
  heroSubtitle: {
    fontSize: 15,
    color: 'var(--text-secondary)',
    maxWidth: 480,
    lineHeight: 1.5,
    margin: 0,
  },
  heroSteps: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    justifyContent: 'center',
    gap: 12,
    marginTop: 8,
    marginBottom: 8,
  },
  heroStep: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontSize: 13,
    color: 'var(--text-primary)',
  },
  heroStepNum: {
    width: 22,
    height: 22,
    borderRadius: '50%',
    background: 'rgba(52, 211, 153, 0.15)',
    color: '#34d399',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
  },
  heroStepText: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap' as const,
  },
  heroCta: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 28px',
    fontSize: 15,
    fontWeight: 700,
    color: '#09090b',
    background: '#34d399',
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
    marginTop: 4,
    transition: 'opacity 0.15s',
  },
  bottomCta: {
    display: 'flex',
    justifyContent: 'center',
    padding: '16px 0',
  },
}
