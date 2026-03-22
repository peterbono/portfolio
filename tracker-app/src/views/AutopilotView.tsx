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
  DollarSign,
  Wifi,
  Building2,
  Trash2,
  Sparkles,
  SkipForward,
  Eye,
  ThumbsDown,
  Play,
  FlaskConical,
  Square,
  History,
  Loader2,
  X,
} from 'lucide-react'
import { useBotActivity } from '../hooks/useBotActivity'
import type { BotActivityItem, BotRunStatus } from '../hooks/useBotActivity'
import { triggerBotRun, triggerDryRun } from '../lib/bot-api'
import { supabase } from '../lib/supabase'
import { useAuthWall } from '../hooks/useAuthWall'
import { useSupabase } from '../context/SupabaseContext'
import { useAuthWallContext } from '../context/AuthWallContext'
import CompanyChipInput from '../components/CompanyChipInput'

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

const RUN_STATUS_COLORS: Record<string, string> = {
  completed: '#34d399',
  running: '#60a5fa',
  pending: '#fbbf24',
  failed: '#f43f5e',
  cancelled: '#6b7280',
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
/*  Extracted SearchProfileForm (shared by anon + auth)                 */
/* ------------------------------------------------------------------ */
function SearchProfileForm({
  formName, setFormName,
  formKeywords, setFormKeywords,
  formLocation, setFormLocation,
  formSalary, setFormSalary,
  formRemote, setFormRemote,
  formExcluded, setFormExcluded,
  onSave, onCancel,
}: {
  formName: string; setFormName: (v: string) => void
  formKeywords: string[]; setFormKeywords: React.Dispatch<React.SetStateAction<string[]>>
  formLocation: string; setFormLocation: (v: string) => void
  formSalary: string; setFormSalary: (v: string) => void
  formRemote: boolean; setFormRemote: (v: boolean) => void
  formExcluded: string[]; setFormExcluded: React.Dispatch<React.SetStateAction<string[]>>
  onSave: () => void; onCancel: () => void
}) {
  return (
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
        <p style={styles.hint}>Search or type a keyword and press Enter</p>
        <ChipInput
          chips={formKeywords}
          onAdd={(val) => setFormKeywords((prev) => [...prev, val])}
          onRemove={(idx) => setFormKeywords((prev) => prev.filter((_, i) => i !== idx))}
          placeholder="Search job titles..."
          suggestions={JOB_TITLE_SUGGESTIONS}
        />
      </div>

      <div style={styles.fieldRow}>
        <div style={{ flex: 1 }}>
          <label style={styles.label}>Location</label>
          <LocationAutocomplete value={formLocation} onChange={setFormLocation} />
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
        <p style={styles.hint}>Search for a company or type a name and press Enter</p>
        <CompanyChipInput
          chips={formExcluded}
          onAdd={(val) => setFormExcluded((prev) => [...prev, val])}
          onRemove={(idx) => setFormExcluded((prev) => prev.filter((_, i) => i !== idx))}
          placeholder="Search companies..."
        />
      </div>

      <div style={styles.formActions}>
        <button style={styles.btnSecondary} onClick={onCancel}>
          Cancel
        </button>
        <button
          style={{
            ...styles.btnPrimary,
            opacity: formName.trim() ? 1 : 0.5,
          }}
          onClick={onSave}
          disabled={!formName.trim()}
        >
          Save Profile
        </button>
      </div>
    </div>
  )
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

  // Bot triggering state
  const [isTriggering, setIsTriggering] = useState(false)
  const [triggerError, setTriggerError] = useState<string | null>(null)

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
  const doStartBot = useCallback(async () => {
    if (profiles.length === 0) return
    setIsTriggering(true)
    setTriggerError(null)
    try {
      await triggerBotRun(profiles[0].id)
    } catch (err) {
      setTriggerError((err as Error).message)
    } finally {
      setIsTriggering(false)
    }
  }, [profiles])

  const doDryRun = useCallback(async () => {
    if (profiles.length === 0) return
    setIsTriggering(true)
    setTriggerError(null)
    try {
      await triggerDryRun(profiles[0].id)
    } catch (err) {
      setTriggerError((err as Error).message)
    } finally {
      setIsTriggering(false)
    }
  }, [profiles])

  // Handlers with auth wall gate
  const handleStartBot = useCallback(() => {
    if (!requireAuth('start_bot', () => { doStartBot() })) return
    doStartBot()
  }, [requireAuth, doStartBot])

  const handleDryRun = useCallback(() => {
    if (!requireAuth('start_bot', () => { doDryRun() })) return
    doDryRun()
  }, [requireAuth, doDryRun])

  // Form state
  const [formName, setFormName] = useState('')
  const [formKeywords, setFormKeywords] = useState<string[]>([])
  const [formLocation, setFormLocation] = useState('')
  const [formSalary, setFormSalary] = useState('')
  const [formRemote, setFormRemote] = useState(false)
  const [formExcluded, setFormExcluded] = useState<string[]>([])

  // Persist on change
  useEffect(() => {
    saveProfiles(profiles)
  }, [profiles])

  const resetForm = useCallback(() => {
    setFormName('')
    setFormKeywords([])
    setFormLocation('')
    setFormSalary('')
    setFormRemote(false)
    setFormExcluded([])
  }, [])

  const handleSave = useCallback(() => {
    if (!formName.trim()) return
    const newProfile: SearchProfile = {
      id: crypto.randomUUID(),
      name: formName.trim(),
      keywords: [...formKeywords],
      location: formLocation.trim(),
      minSalary: parseInt(formSalary) || 0,
      remoteOnly: formRemote,
      excludedCompanies: [...formExcluded],
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

  // Auth state for anonymous-vs-authenticated branching
  const { session } = useSupabase()
  const { showAuthWall } = useAuthWallContext()
  const isAnonymous = !session

  // Anonymous CTA handler
  const handleAnonStartBot = useCallback(() => {
    showAuthWall('start_bot', () => {
      // After sign-up, bot starts with saved preferences
      if (profiles.length > 0) {
        doStartBot()
      }
    })
  }, [showAuthWall, profiles, doStartBot])

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

        {/* Live Activity Feed (the hook) */}
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Bot Activity</h2>
              <p style={styles.sectionSubtitle}>
                What the bot does in a typical run
              </p>
            </div>
            <span style={styles.liveIndicator}>
              <span style={styles.liveIndicatorDot} />
              Live Demo
            </span>
          </div>
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
                    <span style={styles.timelineTime}>
                      <Clock size={10} color="var(--text-tertiary)" />
                      {item.time}
                    </span>
                    <span
                      style={{
                        ...styles.timelineText,
                        color: item.status === 'error' ? '#f87171' : 'var(--text-primary)',
                      }}
                    >
                      {item.text}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Search Profiles (anonymous users can configure before sign-up) */}
        <section style={styles.section}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>Your Search Profile</h2>
              <p style={styles.sectionSubtitle}>
                Configure now — the bot starts immediately after sign-up
              </p>
            </div>
          </div>

          {/* Profile list */}
          {profiles.length > 0 && !showForm && (
            <>
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
                          <span style={styles.metaText}>{p.keywords.join(', ')}</span>
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
                          <span style={styles.metaText}>{p.minSalary.toLocaleString()} EUR min</span>
                        </div>
                      )}
                      {p.remoteOnly && (
                        <div style={styles.metaItem}>
                          <Wifi size={12} color="var(--text-tertiary)" />
                          <span style={styles.metaText}>Remote only</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button style={styles.btnPrimary} onClick={() => setShowForm(true)}>
                  <Plus size={14} />
                  <span>Add another</span>
                </button>
                <button style={styles.heroCta} onClick={handleAnonStartBot}>
                  <Play size={14} />
                  <span>Start My Bot</span>
                </button>
              </div>
            </>
          )}

          {/* Empty — show form directly */}
          {profiles.length === 0 && !showForm && (
            <div style={styles.emptyState}>
              <div style={styles.emptyIllustration}>
                <Sparkles size={40} color="var(--text-tertiary)" strokeWidth={1.2} />
              </div>
              <p style={styles.emptyText}>Tell the bot what to search for</p>
              <p style={styles.emptyHint}>Your preferences are saved locally — the bot starts right after sign-up</p>
              <button style={styles.btnPrimary} onClick={() => setShowForm(true)}>
                <Plus size={14} />
                <span>Create your search profile</span>
              </button>
            </div>
          )}

          {/* Form (same for anon + auth) */}
          {showForm && <SearchProfileForm
            formName={formName} setFormName={setFormName}
            formKeywords={formKeywords} setFormKeywords={setFormKeywords}
            formLocation={formLocation} setFormLocation={setFormLocation}
            formSalary={formSalary} setFormSalary={setFormSalary}
            formRemote={formRemote} setFormRemote={setFormRemote}
            formExcluded={formExcluded} setFormExcluded={setFormExcluded}
            onSave={handleSave} onCancel={() => { resetForm(); setShowForm(false) }}
          />}
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
        `}</style>
      </div>
    )
  }

  /* ------------------------------------------------------------------ */
  /*  AUTHENTICATED USER: Full dashboard (existing behavior)             */
  /* ------------------------------------------------------------------ */
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
          <div style={styles.statusActions}>
            {profiles.length > 0 && !isBotActive && !isTriggering && (
              <>
                <button
                  style={styles.btnStartBot}
                  onClick={handleStartBot}
                  title="Start the bot pipeline"
                >
                  <Play size={14} />
                  <span>Start Bot</span>
                </button>
                <button
                  style={styles.btnDryRun}
                  onClick={handleDryRun}
                  title="Run without submitting applications"
                >
                  <FlaskConical size={14} />
                  <span>Dry Run</span>
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
              <button
                style={styles.btnStopBot}
                onClick={() => {/* future: cancel run */}}
                title="Stop the bot (coming soon)"
              >
                <Square size={14} />
                <span>Stop Bot</span>
              </button>
            )}
            {profiles.length === 0 && !isBotActive && statusCfg.badgeLabel && (
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
        </div>
        {triggerError && (
          <div style={styles.triggerErrorRow}>
            <XCircle size={14} color="#f43f5e" />
            <span style={styles.triggerErrorText}>{triggerError}</span>
          </div>
        )}
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

        {showForm && <SearchProfileForm
          formName={formName} setFormName={setFormName}
          formKeywords={formKeywords} setFormKeywords={setFormKeywords}
          formLocation={formLocation} setFormLocation={setFormLocation}
          formSalary={formSalary} setFormSalary={setFormSalary}
          formRemote={formRemote} setFormRemote={setFormRemote}
          formExcluded={formExcluded} setFormExcluded={setFormExcluded}
          onSave={handleSave} onCancel={() => { resetForm(); setShowForm(false) }}
        />}
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

      {/* 4 -- Run History */}
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
            {/* Header */}
            <div style={styles.historyHeaderRow}>
              <span style={{ ...styles.historyCell, flex: 2 }}>Date</span>
              <span style={{ ...styles.historyCell, flex: 1 }}>Status</span>
              <span style={{ ...styles.historyCell, flex: 1, textAlign: 'right' as const }}>Applied</span>
              <span style={{ ...styles.historyCell, flex: 1, textAlign: 'right' as const }}>Skipped</span>
              <span style={{ ...styles.historyCell, flex: 1, textAlign: 'right' as const }}>Failed</span>
              <span style={{ ...styles.historyCell, flex: 1, textAlign: 'right' as const }}>Duration</span>
            </div>
            {/* Rows */}
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
  btnDryRun: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontWeight: 500,
    fontSize: 13,
    padding: '8px 16px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    transition: 'border-color 0.15s',
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
