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
} from 'lucide-react'
import { useBotActivity } from '../hooks/useBotActivity'
import type { BotActivityItem, BotRunStatus } from '../hooks/useBotActivity'
import { triggerBotRun, triggerDryRun } from '../lib/bot-api'
import { supabase } from '../lib/supabase'
import { useAuthWall } from '../hooks/useAuthWall'
import { useSupabase } from '../context/SupabaseContext'
import { useAuthWallContext } from '../context/AuthWallContext'
import CompanyChipInput from '../components/CompanyChipInput'
import { ProfileSetupModal, isProfileComplete } from '../components/ProfileSetupModal'

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
/*  Preview Queue types + persistence                                  */
/* ------------------------------------------------------------------ */
interface PreviewQueueItem {
  id: string
  company: string
  role: string
  matchScore: number
  matchReasons: string[]
  cvName: string
  coverLetterSnippet: string
  status: 'pending' | 'approved' | 'skipped'
}

const PREVIEW_LS_KEY = 'tracker_v2_preview_queue'

function loadPreviewQueue(): PreviewQueueItem[] {
  try {
    const raw = localStorage.getItem(PREVIEW_LS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function savePreviewQueue(queue: PreviewQueueItem[]) {
  try {
    localStorage.setItem(PREVIEW_LS_KEY, JSON.stringify(queue))
  } catch {
    /* ignore */
  }
}

const MOCK_PREVIEW_QUEUE: PreviewQueueItem[] = [
  {
    id: 'preview-1',
    company: 'Canva',
    role: 'Senior Product Designer',
    matchScore: 88,
    matchReasons: ['Remote APAC', 'Design Systems keyword', 'Salary > 80k EUR'],
    cvName: 'cvflo.pdf',
    coverLetterSnippet: 'With 7+ years of experience in product design and design systems, I am excited to bring my expertise to Canva...',
    status: 'pending',
  },
  {
    id: 'preview-2',
    company: 'Wise',
    role: 'Product Designer',
    matchScore: 62,
    matchReasons: ['Fintech SaaS match', 'Location: Singapore (GMT+8)'],
    cvName: 'cvflo.pdf',
    coverLetterSnippet: 'I bring deep experience in complex B2B product architecture and regulated industries, making me a strong fit...',
    status: 'pending',
  },
  {
    id: 'preview-3',
    company: 'Agoda',
    role: 'UX/UI Designer',
    matchScore: 41,
    matchReasons: ['Bangkok on-site', 'Salary below threshold'],
    cvName: 'cvflo.pdf',
    coverLetterSnippet: 'Having lived and worked in Bangkok for several years, I understand the local market and would bring a unique...',
    status: 'pending',
  },
]

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
      label: 'Bot Inactive',
      description: 'Set up your search profile to get started',
      dotColor: '#6b7280',
      pulsing: false,
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
/*  ApplicationPreviewCard                                             */
/* ------------------------------------------------------------------ */
function ApplicationPreviewCard({
  item,
  onApprove,
  onSkip,
}: {
  item: PreviewQueueItem
  onApprove: (id: string) => void
  onSkip: (id: string) => void
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
    <div style={previewStyles.card}>
      {/* Top row: company + score */}
      <div style={previewStyles.cardTop}>
        <div style={previewStyles.cardInfo}>
          <span style={previewStyles.cardCompany}>{item.company}</span>
          <span style={previewStyles.cardRole}>{item.role}</span>
        </div>
        <div
          style={{
            ...previewStyles.scoreBadge,
            color: scoreColor,
            background: scoreBg,
            border: `1px solid ${scoreColor}33`,
          }}
        >
          <Shield size={12} />
          <span>{item.matchScore}</span>
        </div>
      </div>

      {/* Match reasons */}
      <div style={previewStyles.reasonsWrap}>
        {item.matchReasons.map((reason, i) => (
          <span key={i} style={previewStyles.reasonChip}>{reason}</span>
        ))}
      </div>

      {/* What will be sent */}
      <div style={previewStyles.sentSection}>
        <div style={previewStyles.sentRow}>
          <span style={previewStyles.sentLabel}>CV:</span>
          <span style={previewStyles.sentValue}>{item.cvName}</span>
        </div>
        <div style={previewStyles.sentRow}>
          <span style={previewStyles.sentLabel}>Cover:</span>
          <span style={previewStyles.sentCover}>{item.coverLetterSnippet}</span>
        </div>
      </div>

      {/* Actions */}
      {item.status === 'pending' && (
        <div style={previewStyles.cardActions}>
          <button
            style={previewStyles.btnApprove}
            onClick={() => onApprove(item.id)}
            title="Approve this application"
          >
            <Check size={14} />
            <span>Approve</span>
          </button>
          <button
            style={previewStyles.btnSkip}
            onClick={() => onSkip(item.id)}
            title="Skip this application"
          >
            <X size={14} />
            <span>Skip</span>
          </button>
        </div>
      )}
      {item.status === 'approved' && (
        <div style={previewStyles.statusLabel}>
          <CheckCircle2 size={12} color="#34d399" />
          <span style={{ color: '#34d399', fontSize: 12, fontWeight: 600 }}>Approved</span>
        </div>
      )}
      {item.status === 'skipped' && (
        <div style={previewStyles.statusLabel}>
          <XCircle size={12} color="#6b7280" />
          <span style={{ color: '#6b7280', fontSize: 12, fontWeight: 600 }}>Skipped</span>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  PreviewQueue                                                       */
/* ------------------------------------------------------------------ */
function PreviewQueue() {
  const [queue, setQueue] = useState<PreviewQueueItem[]>(() => {
    const saved = loadPreviewQueue()
    return saved.length > 0 ? saved : MOCK_PREVIEW_QUEUE
  })
  const [isDemo] = useState(() => loadPreviewQueue().length === 0)

  // Persist on every change (but not the initial mock load)
  useEffect(() => {
    if (!isDemo) savePreviewQueue(queue)
  }, [queue, isDemo])

  const pendingCount = queue.filter((i) => i.status === 'pending').length
  if (queue.length === 0) return null

  const handleApprove = (id: string) => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: 'approved' as const } : item))
    )
  }

  const handleSkip = (id: string) => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: 'skipped' as const } : item))
    )
  }

  const handleApproveAll = () => {
    setQueue((prev) =>
      prev.map((item) =>
        item.status === 'pending' ? { ...item, status: 'approved' as const } : item
      )
    )
  }

  const handleSkipAll = () => {
    setQueue((prev) =>
      prev.map((item) =>
        item.status === 'pending' ? { ...item, status: 'skipped' as const } : item
      )
    )
  }

  return (
    <section style={previewStyles.queueSection}>
      {/* Header */}
      <div style={previewStyles.queueHeader}>
        <div style={previewStyles.queueTitleRow}>
          <Eye size={16} color="var(--accent)" />
          <h2 style={previewStyles.queueTitle}>
            {pendingCount > 0
              ? `${pendingCount} application${pendingCount !== 1 ? 's' : ''} ready to send`
              : 'All applications reviewed'}
          </h2>
          {isDemo && (
            <span style={previewStyles.demoBadge}>Preview mode — sample data</span>
          )}
        </div>
        {pendingCount > 0 && (
          <div style={previewStyles.queueBulkActions}>
            <button style={previewStyles.btnApproveAll} onClick={handleApproveAll}>
              <Check size={12} />
              <span>Approve All</span>
            </button>
            <button style={previewStyles.btnSkipAll} onClick={handleSkipAll}>
              <X size={12} />
              <span>Skip All</span>
            </button>
          </div>
        )}
      </div>

      {/* Scrollable list */}
      <div style={previewStyles.queueList}>
        {queue.map((item) => (
          <ApplicationPreviewCard
            key={item.id}
            item={item}
            onApprove={handleApprove}
            onSkip={handleSkip}
          />
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/*  PreviewQueue + Card styles                                         */
/* ------------------------------------------------------------------ */
const previewStyles: Record<string, React.CSSProperties> = {
  queueSection: {
    background: 'var(--bg-surface)',
    border: '1px solid rgba(96, 165, 250, 0.25)',
    borderRadius: 'var(--radius-lg)',
    padding: 20,
  },
  queueHeader: {
    display: 'flex',
    alignItems: 'center',
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
}: {
  config: SearchConfig
  onChange: (patch: Partial<SearchConfig>) => void
  showSaved: boolean
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

  // Preview mode state
  const [previewMode, setPreviewMode] = useState(false)
  const [showApplyModal, setShowApplyModal] = useState(false)

  // Profile setup modal state
  const [showProfileModal, setShowProfileModal] = useState(false)
  const pendingBotActionRef = useRef<(() => void) | null>(null)

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
    try {
      await triggerBotRun('search_config')
    } catch (err) {
      setTriggerError((err as Error).message)
    } finally {
      setIsTriggering(false)
    }
  }, [hasConfig])

  const doDryRun = useCallback(async () => {
    if (!hasConfig) return
    setIsTriggering(true)
    setTriggerError(null)
    try {
      await triggerDryRun('search_config')
    } catch (err) {
      setTriggerError((err as Error).message)
    } finally {
      setIsTriggering(false)
    }
  }, [hasConfig])

  // Core bot action after auth + profile checks
  const executeBotAction = useCallback(() => {
    if (previewMode) {
      if (!requireAuth('start_bot', () => { doDryRun() })) return
      doDryRun()
    } else {
      if (!requireAuth('start_bot', () => { doStartBot() })) return
      doStartBot()
    }
  }, [requireAuth, doStartBot, doDryRun, previewMode])

  // Handlers with auth wall gate + profile completeness check
  const handleStartBot = useCallback(() => {
    // Check if profile is complete first
    if (!isProfileComplete()) {
      pendingBotActionRef.current = executeBotAction
      setShowProfileModal(true)
      return
    }
    executeBotAction()
  }, [executeBotAction])

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

  const handleApplyAll = useCallback(() => {
    setShowApplyModal(false)
    setPreviewMode(false)
    if (!requireAuth('start_bot', () => { doStartBot() })) return
    doStartBot()
  }, [requireAuth, doStartBot])

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
            Set your criteria. The bot scouts LinkedIn, qualifies jobs, and auto-applies for you.
          </p>

          {/* How it works steps */}
          <div style={styles.heroSteps}>
            {[
              { num: '1', text: 'Set your search criteria' },
              { num: '2', text: 'Bot scouts LinkedIn daily' },
              { num: '3', text: 'Smart filtering by timezone, salary, fit' },
              { num: '4', text: 'Auto-applies via Greenhouse, Lever, Workable...' },
            ].map((step) => (
              <div key={step.num} style={styles.heroStep}>
                <span style={styles.heroStepNum}>{step.num}</span>
                <span style={styles.heroStepText}>{step.text}</span>
              </div>
            ))}
          </div>

          <button style={styles.heroCta} onClick={handleAnonStartBot}>
            <Play size={16} />
            Start My Bot
          </button>
        </div>

        {/* Preview Queue */}
        <PreviewQueue />

        {/* Live Activity Feed (the hook) */}
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Bot Activity</h2>
              <p style={styles.sectionSubtitle}>
                Activity from bot runs will appear here
              </p>
            </div>
          </div>
          <div style={styles.timeline}>
            <p style={styles.emptyTimelineText}>
              No activity yet — start the bot to see results here
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
                <Play size={14} />
                <span>Start My Bot</span>
              </button>
            </div>
          )}
        </section>

        {/* Bottom CTA */}
        <div style={styles.bottomCta}>
          <button style={styles.heroCta} onClick={handleAnonStartBot}>
            <Play size={16} />
            Start My Bot
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
        `}</style>
      </div>
    )
  }

  /* ------------------------------------------------------------------ */
  /*  AUTHENTICATED USER: 2-panel layout (filter sidebar + main)         */
  /* ------------------------------------------------------------------ */
  return (
    <div style={layoutStyles.root}>
      {/* Top bar: title + Filters toggle */}
      <div style={layoutStyles.topBar}>
        <div style={layoutStyles.topBarLeft}>
          <Bot size={20} color="var(--accent)" />
          <h1 style={layoutStyles.topBarTitle}>Autopilot</h1>
          {isLive && (
            <span style={styles.liveBadge}>
              <span style={styles.liveDot} />
              LIVE
            </span>
          )}
        </div>
        <div style={layoutStyles.topBarRight}>
          {/* Bot controls */}
          {hasConfig && !isBotActive && !isTriggering && (
            <>
              {/* Preview Mode toggle */}
              <div style={styles.previewToggleWrap} title="Find jobs without applying. Review everything first, then go live.">
                <span style={styles.previewToggleLabel}>Preview Mode</span>
                <button
                  role="switch"
                  aria-checked={previewMode}
                  style={{
                    ...styles.toggleTrack,
                    background: previewMode ? '#f59e0b' : 'var(--border)',
                  }}
                  onClick={() => setPreviewMode((v) => !v)}
                >
                  <span
                    style={{
                      ...styles.toggleThumb,
                      transform: previewMode ? 'translateX(16px)' : 'translateX(2px)',
                    }}
                  />
                </button>
              </div>

              {/* Main action button */}
              <button
                style={previewMode ? styles.btnStartPreview : styles.btnStartBot}
                onClick={handleStartBot}
              >
                {previewMode ? <Eye size={14} /> : <Play size={14} />}
                <span>{previewMode ? 'Start Preview' : 'Start Bot'}</span>
              </button>
            </>
          )}
          {isTriggering && (
            <span style={styles.triggeringBadge}>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
              Triggering...
            </span>
          )}
          {isBotActive && !isTriggering && (
            <button style={styles.btnStopBot} onClick={() => {/* future: cancel run */}}>
              <Square size={14} />
              <span>Stop Bot</span>
            </button>
          )}

          {/* Filter toggle */}
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
              />
            </div>
          </>
        )}

        {/* RIGHT: Main content */}
        <div style={layoutStyles.main}>
          {/* Active filter tags bar */}
          <ActiveFilterTags config={searchConfig} />

          {/* Status Banner */}
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
                  </div>
                  <p style={styles.statusDesc}>{statusCfg.description}</p>
                </div>
              </div>
            </div>
          </section>

          {/* Preview Mode active banner */}
          {isBotActive && previewMode && (
            <div style={styles.previewBannerWrap}>
              <Eye size={14} color="#d97706" />
              <span style={styles.previewBannerText}>
                Preview mode &mdash; no applications are being submitted
              </span>
            </div>
          )}

          {/* Preview Results (after preview run completes) */}
          {currentRun?.status === 'completed' && previewMode && (
            <section style={styles.previewResultsCard}>
              <div style={styles.previewResultsHeader}>
                <CheckCircle2 size={20} color="#f59e0b" />
                <div>
                  <h3 style={styles.previewResultsTitle}>
                    Preview Complete &mdash; {currentRun.jobsFound} job{currentRun.jobsFound !== 1 ? 's' : ''} found
                  </h3>
                  <p style={styles.previewResultsSubtitle}>
                    Nothing was submitted. Here&apos;s what the bot would apply to.
                  </p>
                </div>
              </div>
              <div style={styles.previewResultsActions}>
                <button
                  style={styles.btnApplyAll}
                  onClick={() => setShowApplyModal(true)}
                >
                  <Play size={14} />
                  Apply to All {currentRun.jobsFound} Job{currentRun.jobsFound !== 1 ? 's' : ''}
                </button>
                <button
                  style={styles.btnReviewIndividually}
                  onClick={() => {/* future: scroll to queue / toggle individual review */}}
                >
                  or review and select individually
                </button>
              </div>
              <p style={styles.previewReassurance}>
                <Shield size={12} color="var(--text-tertiary)" />
                You&apos;ll see a confirmation before anything is submitted.
              </p>
            </section>
          )}

          {/* Apply All Confirmation Modal */}
          {showApplyModal && (
            <div style={styles.modalOverlay} onClick={() => setShowApplyModal(false)}>
              <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
                <h3 style={styles.modalTitle}>
                  Ready to apply to {currentRun?.jobsFound ?? 0} job{(currentRun?.jobsFound ?? 0) !== 1 ? 's' : ''}?
                </h3>
                <p style={styles.modalDesc}>
                  The bot will submit your application to each job. You can pause at any time.
                </p>
                <div style={styles.modalActions}>
                  <button style={styles.btnModalApply} onClick={handleApplyAll}>
                    <Play size={14} />
                    Apply Now
                  </button>
                  <button style={styles.btnModalCancel} onClick={() => setShowApplyModal(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Preview Queue */}
          <PreviewQueue />

          {/* Activity Log */}
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
              <div style={styles.timeline}>
                <p style={styles.emptyTimelineText}>
                  No activity yet — start the bot to see results here
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

      {/* Profile Setup Modal */}
      {showProfileModal && (
        <ProfileSetupModal
          onComplete={handleProfileComplete}
          onDismiss={handleProfileDismiss}
          locationRulesSummary={locationRulesSummary}
          remotePreference={remotePreferenceSummary}
        />
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
      `}</style>
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
    background: 'rgba(96, 165, 250, 0.08)',
    border: '1px solid rgba(96, 165, 250, 0.3)',
    color: '#93c5fd',
  },
  filterCount: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: 'rgba(96, 165, 250, 0.2)',
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
  btnStartPreview: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'transparent',
    color: '#f59e0b',
    fontWeight: 600,
    fontSize: 13,
    padding: '8px 16px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid rgba(245, 158, 11, 0.4)',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    transition: 'border-color 0.15s, background 0.15s',
  },
  previewToggleWrap: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'default',
  },
  previewToggleLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap' as const,
    userSelect: 'none' as const,
  },
  toggleTrack: {
    position: 'relative' as const,
    width: 34,
    height: 20,
    borderRadius: 10,
    border: 'none',
    cursor: 'pointer',
    transition: 'background 0.2s',
    padding: 0,
    flexShrink: 0,
  },
  toggleThumb: {
    position: 'absolute' as const,
    top: 2,
    width: 16,
    height: 16,
    borderRadius: '50%',
    background: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
    transition: 'transform 0.2s',
  },
  /* Preview active banner */
  previewBannerWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 16px',
    borderRadius: 'var(--radius-md)',
    background: 'rgba(245, 158, 11, 0.08)',
    border: '1px solid rgba(245, 158, 11, 0.25)',
    marginBottom: 12,
  },
  previewBannerText: {
    fontSize: 13,
    fontWeight: 500,
    color: '#d97706',
  },
  /* Preview results card */
  previewResultsCard: {
    padding: 20,
    borderRadius: 'var(--radius-lg)',
    background: 'var(--bg-elevated)',
    border: '1px solid rgba(245, 158, 11, 0.3)',
    marginBottom: 16,
  },
  previewResultsHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  previewResultsTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--text-primary)',
    margin: 0,
    lineHeight: 1.3,
  },
  previewResultsSubtitle: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    margin: '4px 0 0',
  },
  previewResultsActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 12,
  },
  btnApplyAll: {
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
  btnReviewIndividually: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: 13,
    cursor: 'pointer',
    textDecoration: 'underline',
    textUnderlineOffset: 2,
    padding: 0,
  },
  previewReassurance: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: 'var(--text-tertiary)',
    margin: 0,
  },
  /* Apply All confirmation modal */
  modalOverlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  modalCard: {
    background: 'var(--bg-elevated)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--border)',
    padding: '28px 32px',
    maxWidth: 420,
    width: '90vw',
    boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: 'var(--text-primary)',
    margin: '0 0 8px',
  },
  modalDesc: {
    fontSize: 14,
    color: 'var(--text-secondary)',
    margin: '0 0 20px',
    lineHeight: 1.5,
  },
  modalActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  btnModalApply: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: '#34d399',
    color: '#09090b',
    fontWeight: 700,
    fontSize: 14,
    padding: '10px 24px',
    borderRadius: 'var(--radius-md)',
    border: 'none',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  btnModalCancel: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: 14,
    cursor: 'pointer',
    padding: '10px 12px',
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
