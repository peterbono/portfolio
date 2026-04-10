import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Plus,
  Search,
  MapPin,
  X,
  ChevronDown,
  SlidersHorizontal,
  Loader2,
  AlertTriangle,
  Save,
  Zap,
} from 'lucide-react'
import CompanyChipInput from '../components/CompanyChipInput'
import { useScout } from '../context/ScoutContext'

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
  tailorCoverLetter: boolean
  tailorCVSummary: boolean
}

const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  keywords: [],
  locationRules: [],
  excludedCompanies: [],
  dailyLimit: 15,
  tailorCoverLetter: true,
  tailorCVSummary: true,
}

const ZONES: Record<string, { label: string; countries: string[] }> = {
  'APAC': { label: 'Asia-Pacific', countries: ['Thailand', 'Singapore', 'Japan', 'South Korea', 'Australia', 'New Zealand', 'India', 'Philippines', 'Vietnam', 'Indonesia', 'Malaysia', 'Taiwan', 'Hong Kong', 'China'] },
  'EMEA': { label: 'Europe, Middle East & Africa', countries: ['UK', 'Germany', 'France', 'Netherlands', 'Spain', 'Italy', 'Sweden', 'Denmark', 'Norway', 'Finland', 'Switzerland', 'Ireland', 'Belgium', 'Portugal', 'Poland', 'Czech Republic', 'Austria', 'UAE', 'Saudi Arabia', 'Israel', 'South Africa', 'Nigeria', 'Kenya', 'Egypt'] },
  'Americas': { label: 'North & South America', countries: ['USA', 'Canada', 'Mexico', 'Brazil', 'Argentina', 'Colombia', 'Chile'] },
  'Middle East': { label: 'Middle East', countries: ['UAE', 'Saudi Arabia', 'Qatar', 'Bahrain', 'Kuwait', 'Oman', 'Israel', 'Turkey'] },
  'Global': { label: 'Worldwide (Remote Only)', countries: [] },
}

const ZONE_NAMES = Object.keys(ZONES)

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

/* ------------------------------------------------------------------ */
/*  Persistence                                                        */
/* ------------------------------------------------------------------ */
const LS_KEY = 'tracker_v2_search_config'
const LS_KEY_OLD = 'tracker_v2_search_profiles'

function migrateFromProfiles(): SearchConfig | null {
  try {
    const raw = localStorage.getItem(LS_KEY_OLD)
    if (!raw) return null
    const profiles = JSON.parse(raw)
    if (!Array.isArray(profiles) || profiles.length === 0) return null
    const p = profiles[0]
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
    return {
      keywords: p.keywords || [],
      locationRules,
      excludedCompanies: p.excludedCompanies || [],
      dailyLimit: p.dailyLimit || 15,
      tailorCoverLetter: p.tailorCoverLetter ?? true,
      tailorCVSummary: p.tailorCVSummary ?? true,
    }
  } catch {
    return null
  }
}

function loadSearchConfig(): SearchConfig {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return { ...DEFAULT_SEARCH_CONFIG, ...JSON.parse(raw) }
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
/*  Job title suggestions                                              */
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
/*  ChipInput                                                          */
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
              onClick={(e) => { e.stopPropagation(); onRemove(i) }}
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
              <Loader2 size={12} color="var(--text-tertiary)" style={{ animation: 'spin 1s linear infinite' }} />
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
              onMouseDown={(e) => { e.preventDefault(); addChip(item) }}
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
/*  LocationRuleEditor                                                 */
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

  const [cityResults, setCityResults] = useState<CityResult[]>([])
  const [cityLoading, setCityLoading] = useState(false)
  const [showCityDrop, setShowCityDrop] = useState(false)
  const [cityHighlight, setCityHighlight] = useState(-1)
  const cityDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cityWrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ruleType === 'zone' && zoneValue === 'Global') setArrangement('remote')
  }, [ruleType, zoneValue])

  const filteredCountries = countryQuery.length >= 1
    ? ALL_COUNTRIES.filter((c) => c.toLowerCase().includes(countryQuery.toLowerCase())).slice(0, 8)
    : []

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (countryWrapRef.current && !countryWrapRef.current.contains(e.target as Node)) setShowCountryDrop(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cityWrapRef.current && !cityWrapRef.current.contains(e.target as Node)) setShowCityDrop(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleCityChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setCityValue(val)
    setCityHighlight(-1)
    if (cityDebounceRef.current) clearTimeout(cityDebounceRef.current)
    if (val.length < 2) { setCityResults([]); setShowCityDrop(false); setCityLoading(false); return }
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
    if (e.key === 'ArrowDown') { e.preventDefault(); setCityHighlight((prev) => Math.min(prev + 1, cityResults.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCityHighlight((prev) => Math.max(prev - 1, 0)) }
    else if (e.key === 'Enter' && cityHighlight >= 0 && cityResults[cityHighlight]) { e.preventDefault(); selectCityResult(cityResults[cityHighlight]) }
    else if (e.key === 'Escape') setShowCityDrop(false)
  }, [cityResults, cityHighlight, selectCityResult])

  const currentValue = ruleType === 'zone' ? zoneValue : ruleType === 'country' ? countryValue : cityValue
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
    padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 16,
    border: '1px solid var(--border)', background: 'var(--bg-surface)',
    color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
  }
  const pillActive: React.CSSProperties = {
    ...pillBase, background: 'rgba(96, 165, 250, 0.15)',
    border: '1px solid rgba(96, 165, 250, 0.4)', color: '#93c5fd',
  }
  const arrangePillBase: React.CSSProperties = {
    padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 12,
    border: '1px solid var(--border)', background: 'var(--bg-surface)',
    color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
  }
  const arrangePillActive: React.CSSProperties = {
    ...arrangePillBase, background: 'rgba(52, 211, 153, 0.12)',
    border: '1px solid rgba(52, 211, 153, 0.35)', color: '#34d399',
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)', padding: '8px 12px', color: 'var(--text-primary)',
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
  }

  const dropdownStyle: React.CSSProperties = {
    position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)', zIndex: 50, maxHeight: 180,
    overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  }

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)', padding: 14,
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      {/* Type selector pills */}
      <div style={{ display: 'flex', gap: 6 }}>
        {(['zone', 'country', 'city'] as const).map((t) => (
          <button key={t} type="button" style={ruleType === t ? pillActive : pillBase} onClick={() => setRuleType(t)}>
            {t === 'zone' && <>{'\u{1F30F}'} Zone</>}
            {t === 'country' && <>{'\u{1F1FA}\u{1F1F3}'} Country</>}
            {t === 'city' && <>{'\u{1F4CD}'} City</>}
          </button>
        ))}
      </div>

      {/* Value selector */}
      {ruleType === 'zone' && (
        <div style={{ position: 'relative' }}>
          <select value={zoneValue} onChange={(e) => setZoneValue(e.target.value)}
            style={{ ...inputStyle, padding: '8px 32px 8px 12px', appearance: 'none', cursor: 'pointer' }}>
            {ZONE_NAMES.map((z) => <option key={z} value={z}>{z} — {ZONES[z].label}</option>)}
          </select>
          <ChevronDown size={14} color="var(--text-tertiary)" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        </div>
      )}

      {ruleType === 'country' && (
        <div ref={countryWrapRef} style={{ position: 'relative' }}>
          <input value={countryQuery} placeholder="Search country..." style={inputStyle}
            onChange={(e) => { setCountryQuery(e.target.value); setCountryValue(e.target.value); setShowCountryDrop(e.target.value.length >= 1) }}
            onFocus={() => { if (countryQuery.length >= 1) setShowCountryDrop(true) }}
          />
          {showCountryDrop && filteredCountries.length > 0 && (
            <div style={dropdownStyle}>
              {filteredCountries.map((c) => (
                <div key={c} style={{ padding: '8px 12px', fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer', transition: 'background 0.1s' }}
                  onMouseDown={(e) => { e.preventDefault(); setCountryQuery(c); setCountryValue(c); setShowCountryDrop(false) }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(96, 165, 250, 0.1)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                >{c}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {ruleType === 'city' && (
        <div ref={cityWrapRef} style={{ position: 'relative' }}>
          <input value={cityValue} onChange={handleCityChange} onKeyDown={handleCityKeyDown}
            onFocus={() => { if (cityResults.length > 0) setShowCityDrop(true) }}
            placeholder="Search city..." style={{ ...inputStyle, paddingRight: 32 }}
          />
          {cityLoading && (
            <Loader2 size={14} color="var(--text-tertiary)"
              style={{ animation: 'spin 1s linear infinite', position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }} />
          )}
          {showCityDrop && (cityResults.length > 0 || cityLoading || (cityValue.length >= 2 && !cityLoading && cityResults.length === 0)) && (
            <div style={dropdownStyle}>
              {cityLoading && cityResults.length === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', fontSize: 12, color: 'var(--text-tertiary)' }}>
                  <Loader2 size={12} color="var(--text-tertiary)" style={{ animation: 'spin 1s linear infinite' }} />
                  <span>Searching cities...</span>
                </div>
              )}
              {!cityLoading && cityResults.length === 0 && cityValue.length >= 2 && (
                <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>No cities found</div>
              )}
              {cityResults.map((city, idx) => (
                <div key={city.fullName}
                  style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer', transition: 'background 0.1s', background: idx === cityHighlight ? 'rgba(96, 165, 250, 0.1)' : 'transparent' }}
                  onMouseEnter={() => setCityHighlight(idx)}
                  onMouseDown={(e) => { e.preventDefault(); selectCityResult(city) }}
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
              <button key={wa.value} type="button"
                style={{ ...(arrangement === wa.value ? arrangePillActive : arrangePillBase), ...(disabled ? { opacity: 0.35, cursor: 'not-allowed' } : {}) }}
                onClick={() => { if (!disabled) setArrangement(wa.value) }} disabled={disabled}
              >{wa.label}</button>
            )
          })}
        </div>
      </div>

      {/* Min salary */}
      <div>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 6, display: 'block' }}>
          Min salary (optional)
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select value={ruleCurrency} onChange={(e) => setRuleCurrency(e.target.value)}
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '6px 8px', color: 'var(--text-primary)', fontSize: 12, outline: 'none', width: 72, cursor: 'pointer' }}>
            {CURRENCY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.symbol} {c.label}</option>)}
          </select>
          <input type="number" value={ruleSalary} onChange={(e) => setRuleSalary(e.target.value)} placeholder="e.g. 80000"
            style={{ flex: 1, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '6px 10px', color: 'var(--text-primary)', fontSize: 12, outline: 'none', boxSizing: 'border-box' as const }} />
          {ruleSalary && parseInt(ruleSalary) > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
              {getCurrencySymbol(ruleCurrency)}{(parseInt(ruleSalary) / 1000).toFixed(0)}k+
            </span>
          )}
        </div>
      </div>

      {/* Action row */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" onClick={onCancel}
          style={{ padding: '6px 14px', fontSize: 12, fontWeight: 500, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          Cancel
        </button>
        <button type="button" onClick={handleAdd} disabled={!canAdd}
          style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 'var(--radius-md)', border: 'none', background: canAdd ? 'var(--accent)' : 'var(--bg-surface)', color: canAdd ? '#09090b' : 'var(--text-tertiary)', cursor: canAdd ? 'pointer' : 'not-allowed', opacity: canAdd ? 1 : 0.5 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Plus size={12} /> Add Rule
          </span>
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  LocationRuleChips                                                  */
/* ------------------------------------------------------------------ */
function LocationRuleChips({
  rules,
  onRemove,
}: {
  rules: LocationRule[]
  onRemove?: (id: string) => void
}) {
  if (rules.length === 0) return null

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
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
          <span key={rule.id} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '3px 8px 3px 10px', borderRadius: 14,
            background: 'rgba(96, 165, 250, 0.08)', border: '1px solid rgba(96, 165, 250, 0.18)',
            fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'nowrap',
          }}>
            <span>{icon}</span>
            <span style={{ fontWeight: 500 }}>{rule.value}</span>
            <span style={{ fontSize: 11, color: arrangementColor, fontWeight: 600, padding: '0 4px', borderRadius: 8, background: `${arrangementColor}15` }}>
              {arrangement}
            </span>
            {rule.minSalary && rule.minSalary > 0 && (
              <span style={{ fontSize: 11, color: '#34d399', fontWeight: 600 }}>
                {getCurrencySymbol(rule.currency)}{(rule.minSalary / 1000).toFixed(0)}k+
              </span>
            )}
            {onRemove && (
              <button type="button" onClick={() => onRemove(rule.id)} aria-label={`Remove ${rule.value}`}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 1, borderRadius: '50%', flexShrink: 0 }}>
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
/*  LocationRulesField                                                 */
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
      <LocationRuleChips rules={rules} onRemove={handleRemove} />
      {showEditor ? (
        <LocationRuleEditor onAdd={handleAdd} onCancel={() => setShowEditor(false)} />
      ) : (
        <button type="button" onClick={() => setShowEditor(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: 12, fontWeight: 500, borderRadius: 'var(--radius-md)', border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', transition: 'all 0.15s', alignSelf: 'flex-start' }}>
          <Plus size={12} /> Add Location Rule
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
/*  ChipInput styles                                                   */
/* ------------------------------------------------------------------ */
const chipStyles: Record<string, React.CSSProperties> = {
  wrapper: { position: 'relative' },
  inputArea: {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4,
    minHeight: 38, padding: '4px 8px',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)', cursor: 'text', boxSizing: 'border-box',
  },
  inputWrap: { display: 'flex', alignItems: 'center', flex: 1, minWidth: 80, gap: 4 },
  chipInput: {
    flex: 1, minWidth: 60, background: 'transparent', border: 'none',
    outline: 'none', color: 'var(--text-primary)', fontSize: 13, padding: '4px 0',
  },
  chip: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '2px 6px 2px 8px', borderRadius: 12,
    background: 'rgba(96, 165, 250, 0.15)', border: '1px solid rgba(96, 165, 250, 0.25)',
    fontSize: 12, color: '#93c5fd', whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden',
  },
  chipText: { overflow: 'hidden', textOverflow: 'ellipsis' },
  chipRemove: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: 'none', color: '#93c5fd',
    cursor: 'pointer', padding: 2, borderRadius: '50%', flexShrink: 0,
  },
  dropdown: {
    position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)', zIndex: 50, maxHeight: 200,
    overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  dropdownItem: {
    display: 'flex', alignItems: 'center', padding: '8px 12px',
    fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer', transition: 'background 0.1s',
  },
  dropdownItemHighlight: { background: 'rgba(96, 165, 250, 0.1)' },
  dropdownLoading: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 12px', fontSize: 12, color: 'var(--text-tertiary)',
  },
  dropdownEmpty: {
    padding: '10px 12px', fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center',
  },
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */
export function AutopilotView() {
  const scout = useScout()
  const [searchConfig, setSearchConfig] = useState<SearchConfig>(loadSearchConfig)
  const [isSaving, setIsSaving] = useState(false)
  const [showSaved, setShowSaved] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Lightweight ephemeral toast for the Save action only — full scout
  // progress lives in the global ScoutContext + OpenJobs banner.
  const [toast, setToast] = useState<
    | { message: string; type: 'success' | 'error' | 'info'; runId?: string }
    | null
  >(null)

  const [autopilotEnabled, setAutopilotEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem('tracker_v2_autopilot_mode') === 'true' } catch { return false }
  })

  const hasConfig = searchConfig.keywords.length > 0 || searchConfig.locationRules.length > 0

  /* Auto-save with debounce */
  const handleConfigChange = useCallback((patch: Partial<SearchConfig>) => {
    setSearchConfig(prev => {
      const next = { ...prev, ...patch }
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => {
        saveSearchConfig(next)
        setShowSaved(true)
        setTimeout(() => setShowSaved(false), 2000)
      }, 400)
      return next
    })
  }, [])

  /* Manual save — persists config + kicks off a scout via global ScoutContext.
   * The Save button itself only shows ephemeral "Saving... → Saved" feedback
   * (auto-revert in 2s). All scout progress is reported on the OpenJobs page
   * via the ScoutProgressBanner reading from the same context. */
  const handleSave = useCallback(async () => {
    setIsSaving(true)
    saveSearchConfig(searchConfig)
    try {
      localStorage.setItem('tracker_v2_autopilot_mode', String(autopilotEnabled))
    } catch { /* ignore */ }

    // Kick off scout in background. The global ScoutContext tracks progress
    // and the OpenJobs banner displays it. We never block the UI here.
    try {
      const { triggerScout } = await import('../lib/bot-api')
      const { runId } = await triggerScout()
      // Notify the global context — banner on OpenJobs picks it up
      scout.startScout(runId)
      // Brief "Saved" toast with a "View jobs" CTA
      setToast({
        message: 'Saved. Scout is running in the background.',
        type: 'success',
        runId,
      })
      setShowSaved(true)
      setTimeout(() => {
        setToast(null)
        setShowSaved(false)
      }, 4000)
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Failed to start scout',
        type: 'error',
      })
      setTimeout(() => setToast(null), 5000)
    } finally {
      setIsSaving(false)
    }
  }, [searchConfig, autopilotEnabled, scout])

  const toggleAutopilot = useCallback(() => {
    setAutopilotEnabled(prev => {
      const next = !prev
      try { localStorage.setItem('tracker_v2_autopilot_mode', String(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  const toastPalette = (type: 'success' | 'error' | 'info') => {
    if (type === 'success') return { bg: 'rgba(52, 211, 153, 0.15)', border: '#34d399', color: '#34d399' }
    if (type === 'error') return { bg: 'rgba(239, 68, 68, 0.15)', border: '#ef4444', color: '#ef4444' }
    return { bg: 'rgba(52, 211, 153, 0.12)', border: '#34d399', color: '#34d399' }
  }

  return (
    <div style={pageStyles.container}>
      {/* Scout toast */}
      {toast && (() => {
        const p = toastPalette(toast.type)
        return (
          <div
            style={{
              position: 'fixed',
              top: 16,
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '10px 20px',
              borderRadius: 10,
              border: `1px solid ${p.border}`,
              background: p.bg,
              color: p.color,
              fontSize: 14,
              fontWeight: 600,
              zIndex: 200,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              maxWidth: 420,
            }}
          >
            {toast.type === 'info' && (
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
            )}
            <span>{toast.message}</span>
            {toast.type !== 'info' && (
              <button
                onClick={() => setToast(null)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'transparent', border: 'none', color: 'inherit',
                  cursor: 'pointer', padding: 0, marginLeft: 4,
                }}
                aria-label="Close"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )
      })()}

      {/* Header */}
      <div style={pageStyles.header}>
        <div style={pageStyles.headerLeft}>
          <div style={pageStyles.iconWrap}>
            <Zap size={20} color={autopilotEnabled ? '#a78bfa' : 'var(--text-tertiary)'} />
          </div>
          <div>
            <h1 style={pageStyles.title}>Autopilot</h1>
            <p style={pageStyles.subtitle}>
              Configure your job search preferences. The bot will find and apply to matching jobs automatically.
            </p>
          </div>
        </div>

        {/* Toggle */}
        <button onClick={toggleAutopilot}
          title={autopilotEnabled ? 'Autopilot is ON -- jobs will be auto-applied' : 'Autopilot is OFF -- click to enable'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '8px 16px', borderRadius: 'var(--radius-md)',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
            border: autopilotEnabled ? '1px solid rgba(167, 139, 250, 0.4)' : '1px solid var(--border)',
            background: autopilotEnabled ? 'rgba(167, 139, 250, 0.12)' : 'transparent',
            color: autopilotEnabled ? '#a78bfa' : 'var(--text-secondary)',
            transition: 'all 0.15s ease',
          }}>
          <span>{autopilotEnabled ? 'ON' : 'OFF'}</span>
          <span style={{
            width: 36, height: 20, borderRadius: 10, position: 'relative', display: 'inline-block',
            background: autopilotEnabled ? '#a78bfa' : 'var(--border)', transition: 'background 0.15s ease',
          }}>
            <span style={{
              width: 16, height: 16, borderRadius: '50%', background: '#fff',
              position: 'absolute', top: 2, left: autopilotEnabled ? 18 : 2, transition: 'left 0.15s ease',
            }} />
          </span>
        </button>
      </div>

      {/* Job Preferences */}
      <section style={pageStyles.section}>
        <div style={pageStyles.sectionHeader}>
          <Search size={16} color="var(--accent)" />
          <h2 style={pageStyles.sectionTitle}>Job Preferences</h2>
          {showSaved && <span style={pageStyles.savedBadge}>Saved</span>}
        </div>

        <div style={pageStyles.fieldGroup}>
          <label style={pageStyles.label}>Job Titles</label>
          <p style={pageStyles.hint}>Type a job title and press Enter or comma to add</p>
          <ChipInput
            chips={searchConfig.keywords}
            onAdd={(val) => handleConfigChange({ keywords: [...searchConfig.keywords, val] })}
            onRemove={(idx) => handleConfigChange({ keywords: searchConfig.keywords.filter((_, i) => i !== idx) })}
            placeholder="e.g. Product Designer, UX Designer..."
            suggestions={JOB_TITLE_SUGGESTIONS}
          />
        </div>

        <div style={pageStyles.fieldGroup}>
          <label style={pageStyles.label}>Location Rules</label>
          <p style={pageStyles.hint}>Set target locations with work arrangement and optional salary floor</p>
          <LocationRulesField
            rules={searchConfig.locationRules}
            onChange={(rules) => handleConfigChange({ locationRules: rules })}
          />
        </div>
      </section>

      {/* Advanced Preferences */}
      <section style={pageStyles.section}>
        <div style={pageStyles.sectionHeader}>
          <SlidersHorizontal size={16} color="var(--text-tertiary)" />
          <h2 style={pageStyles.sectionTitle}>Advanced Preferences</h2>
        </div>

        <div style={pageStyles.fieldGroup}>
          <label style={pageStyles.label}>Excluded Companies</label>
          <p style={pageStyles.hint}>Companies to always skip (e.g. current employer)</p>
          <CompanyChipInput
            chips={searchConfig.excludedCompanies}
            onAdd={(val) => handleConfigChange({ excludedCompanies: [...searchConfig.excludedCompanies, val] })}
            onRemove={(idx) => handleConfigChange({ excludedCompanies: searchConfig.excludedCompanies.filter((_, i) => i !== idx) })}
            placeholder="Search companies to exclude..."
          />
        </div>

        <div style={pageStyles.fieldGroup}>
          <label style={pageStyles.label}>Jobs per Day</label>
          <p style={pageStyles.hint}>Maximum applications per day (1-50)</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              style={{ ...pageStyles.input, width: 80, flex: 'none' }}
              type="number" min={1} max={50}
              value={searchConfig.dailyLimit}
              onChange={(e) => {
                const val = Math.max(1, Math.min(50, parseInt(e.target.value) || 1))
                handleConfigChange({ dailyLimit: val })
              }}
            />
            <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>per day</span>
            {searchConfig.dailyLimit > 25 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6, background: 'rgba(249, 115, 22, 0.08)', border: '1px solid rgba(249, 115, 22, 0.2)' }}>
                <AlertTriangle size={14} color="#f97316" />
                <span style={{ fontSize: 12, color: '#f97316' }}>Risk of rate limits</span>
              </div>
            )}
          </div>
        </div>

        {/* AI Tailoring toggles */}
        <div style={{ ...pageStyles.fieldGroup, marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
          <label style={pageStyles.label}>AI Application Tailoring</label>
          <p style={pageStyles.hint}>Customize each application to match the job description — increases response rate</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <div
                onClick={() => handleConfigChange({ tailorCoverLetter: !searchConfig.tailorCoverLetter })}
                style={{
                  width: 40, height: 22, borderRadius: 11,
                  background: searchConfig.tailorCoverLetter ? '#34d399' : 'var(--bg-elevated)',
                  border: `1px solid ${searchConfig.tailorCoverLetter ? '#34d399' : 'var(--border)'}`,
                  position: 'relative', cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0,
                }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: 8,
                  background: '#fff', position: 'absolute', top: 2,
                  left: searchConfig.tailorCoverLetter ? 20 : 2,
                  transition: 'left 0.2s',
                }} />
              </div>
              <div>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Custom cover letter</span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'block' }}>AI rewrites your cover letter with keywords from each job</span>
              </div>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <div
                onClick={() => handleConfigChange({ tailorCVSummary: !searchConfig.tailorCVSummary })}
                style={{
                  width: 40, height: 22, borderRadius: 11,
                  background: searchConfig.tailorCVSummary ? '#34d399' : 'var(--bg-elevated)',
                  border: `1px solid ${searchConfig.tailorCVSummary ? '#34d399' : 'var(--border)'}`,
                  position: 'relative', cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0,
                }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: 8,
                  background: '#fff', position: 'absolute', top: 2,
                  left: searchConfig.tailorCVSummary ? 20 : 2,
                  transition: 'left 0.2s',
                }} />
              </div>
              <div>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Custom CV summary</span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'block' }}>AI adapts your headline/summary to emphasize relevant experience</span>
              </div>
            </label>
          </div>
        </div>
      </section>

      {/* Save button */}
      <div style={pageStyles.saveRow}>
        <button onClick={handleSave} disabled={isSaving}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '10px 24px', fontSize: 14, fontWeight: 600,
            borderRadius: 'var(--radius-md)', border: 'none',
            background: hasConfig ? 'var(--accent)' : 'var(--bg-surface)',
            color: hasConfig ? '#09090b' : 'var(--text-tertiary)',
            cursor: hasConfig ? 'pointer' : 'not-allowed',
            opacity: isSaving ? 0.7 : 1, transition: 'all 0.15s',
          }}>
          {isSaving ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={16} />}
          <span>{isSaving ? 'Saving...' : 'Save Preferences'}</span>
        </button>
        {showSaved && (
          <span style={{ fontSize: 13, fontWeight: 600, color: '#34d399' }}>
            Preferences saved
          </span>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Page styles                                                        */
/* ------------------------------------------------------------------ */
const pageStyles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 720,
    margin: '0 auto',
    padding: '32px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    flexWrap: 'wrap',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--text-primary)',
    margin: 0,
  },
  subtitle: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
    margin: '2px 0 0',
    maxWidth: 400,
    lineHeight: 1.4,
  },
  section: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: 24,
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    margin: 0,
  },
  savedBadge: {
    fontSize: 11,
    fontWeight: 600,
    color: '#34d399',
    marginLeft: 'auto',
  },
  fieldGroup: {
    marginBottom: 20,
  },
  label: {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-tertiary)',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  },
  hint: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    margin: '0 0 8px',
    lineHeight: 1.4,
  },
  input: {
    width: '100%',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: '8px 12px',
    color: 'var(--text-primary)',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  saveRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
}

export default AutopilotView
