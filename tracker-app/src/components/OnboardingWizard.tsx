import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  Bot,
  ArrowRight,
  ArrowLeft,
  MapPin,
  Mail,
  Sparkles,
  Zap,
  Brain,
  Shield,
  X,
  Check,
  Loader2,
  Search,
  ChevronDown,
  Globe,
  Lock,
  Unplug,
  HelpCircle,
  AlertCircle,
} from 'lucide-react'
import confetti from 'canvas-confetti'
import CompanyChipInput from './CompanyChipInput'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ONBOARDING_KEY = 'tracker_v2_onboarding_done'
const GMAIL_URL_KEY = 'tracker_v2_gmail_url'

/** Maps common IANA timezones to human-readable city labels. */
const TIMEZONE_TO_CITY: Record<string, string> = {
  'Asia/Bangkok': 'Bangkok, Thailand',
  'Asia/Singapore': 'Singapore',
  'Asia/Tokyo': 'Tokyo, Japan',
  'Asia/Seoul': 'Seoul, South Korea',
  'Asia/Shanghai': 'Shanghai, China',
  'Asia/Hong_Kong': 'Hong Kong',
  'Asia/Kolkata': 'Mumbai, India',
  'Asia/Calcutta': 'Mumbai, India',
  'Asia/Dubai': 'Dubai, UAE',
  'Asia/Jakarta': 'Jakarta, Indonesia',
  'Asia/Manila': 'Manila, Philippines',
  'Asia/Taipei': 'Taipei, Taiwan',
  'Asia/Kuala_Lumpur': 'Kuala Lumpur, Malaysia',
  'Asia/Ho_Chi_Minh': 'Ho Chi Minh City, Vietnam',
  'Australia/Sydney': 'Sydney, Australia',
  'Australia/Melbourne': 'Melbourne, Australia',
  'Pacific/Auckland': 'Auckland, New Zealand',
  'Europe/Paris': 'Paris, France',
  'Europe/London': 'London, UK',
  'Europe/Berlin': 'Berlin, Germany',
  'Europe/Amsterdam': 'Amsterdam, Netherlands',
  'Europe/Madrid': 'Madrid, Spain',
  'Europe/Rome': 'Rome, Italy',
  'Europe/Zurich': 'Zurich, Switzerland',
  'Europe/Stockholm': 'Stockholm, Sweden',
  'Europe/Lisbon': 'Lisbon, Portugal',
  'Europe/Warsaw': 'Warsaw, Poland',
  'Europe/Istanbul': 'Istanbul, Turkey',
  'America/New_York': 'New York, USA',
  'America/Los_Angeles': 'Los Angeles, USA',
  'America/Chicago': 'Chicago, USA',
  'America/Denver': 'Denver, USA',
  'America/Toronto': 'Toronto, Canada',
  'America/Vancouver': 'Vancouver, Canada',
  'America/Sao_Paulo': 'Sao Paulo, Brazil',
  'America/Mexico_City': 'Mexico City, Mexico',
  'America/Argentina/Buenos_Aires': 'Buenos Aires, Argentina',
  'Africa/Cairo': 'Cairo, Egypt',
  'Africa/Lagos': 'Lagos, Nigeria',
  'Africa/Johannesburg': 'Johannesburg, South Africa',
}

const EXPERIENCE_LEVELS = ['Junior', 'Mid', 'Senior', 'Lead', 'Principal']

const JOB_TITLES = [
  'Software Engineer', 'Frontend Developer', 'Backend Developer', 'Full Stack Developer',
  'Mobile Developer', 'iOS Developer', 'Android Developer', 'React Developer',
  'Node.js Developer', 'Python Developer', 'Java Developer', 'Go Developer',
  'Rust Developer', 'DevOps Engineer', 'SRE / Site Reliability Engineer',
  'Cloud Engineer', 'Platform Engineer', 'Infrastructure Engineer',
  'Data Engineer', 'Data Scientist', 'Data Analyst', 'Machine Learning Engineer',
  'AI Engineer', 'ML Ops Engineer', 'Business Intelligence Analyst',
  'Product Designer', 'UX Designer', 'UI Designer', 'UX Researcher',
  'Visual Designer', 'Interaction Designer', 'Design Systems Designer',
  'Brand Designer', 'Motion Designer', 'Graphic Designer',
  'Product Manager', 'Technical Program Manager', 'Engineering Manager',
  'Project Manager', 'Scrum Master', 'Agile Coach',
  'QA Engineer', 'SDET', 'Test Automation Engineer', 'Quality Assurance Lead',
  'Security Engineer', 'Cybersecurity Analyst', 'Penetration Tester',
  'Solutions Architect', 'Enterprise Architect', 'Technical Architect',
  'Technical Writer', 'Documentation Engineer',
  'Marketing Manager', 'Growth Marketing Manager', 'Content Marketing Manager',
  'SEO Specialist', 'PPC Specialist', 'Social Media Manager',
  'Digital Marketing Manager', 'Performance Marketing Manager',
  'Sales Representative', 'Account Executive', 'Business Development Rep',
  'Sales Engineer', 'Solutions Consultant',
  'Customer Success Manager', 'Customer Support Engineer', 'Technical Support',
  'Business Analyst', 'Systems Analyst', 'Operations Manager',
  'HR Manager', 'Recruiter', 'Technical Recruiter', 'People Operations',
  'Finance Manager', 'Financial Analyst', 'Accounting Manager',
  'Legal Counsel', 'Compliance Officer',
  'CTO', 'VP Engineering', 'VP Product', 'VP Design',
  'Head of Engineering', 'Head of Product', 'Head of Design',
  'Director of Engineering', 'Director of Product', 'Director of Design',
  'Staff Engineer', 'Principal Engineer', 'Distinguished Engineer',
  'Staff Designer', 'Principal Designer', 'Lead Designer',
  'Game Developer', 'Game Designer', 'Unity Developer', 'Unreal Developer',
  'Blockchain Developer', 'Smart Contract Engineer', 'Web3 Developer',
  'Embedded Systems Engineer', 'Firmware Engineer', 'Hardware Engineer',
  'Network Engineer', 'Database Administrator', 'Systems Administrator',
  'Salesforce Developer', 'SAP Consultant', 'ERP Consultant',
  'Supply Chain Analyst', 'Operations Analyst', 'Strategy Consultant',
  'Executive Assistant', 'Office Manager', 'Administrative Assistant',
  'Content Creator', 'Copywriter', 'Video Producer', 'Photographer',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function useDebounce<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function formatTzLabel(tz: string): string {
  try {
    const now = new Date()
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
    const parts = fmt.formatToParts(now)
    const offset = parts.find(p => p.type === 'timeZoneName')?.value ?? ''
    return `${tz.replace(/_/g, ' ')} (${offset})`
  } catch {
    return tz
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface AutocompleteInputProps {
  value: string
  onChange: (v: string) => void
  placeholder: string
  suggestions: string[]
  loading?: boolean
  onSelect: (v: string) => void
  style?: React.CSSProperties
  icon?: React.ReactNode
}

function AutocompleteInput({
  value, onChange, placeholder, suggestions, loading, onSelect, style, icon,
}: AutocompleteInputProps) {
  const [open, setOpen] = useState(false)
  const [focusIdx, setFocusIdx] = useState(-1)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => { setFocusIdx(-1) }, [suggestions])

  const handleKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' && value.trim()) {
        e.preventDefault()
        onSelect(value.trim())
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusIdx(i => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (focusIdx >= 0 && focusIdx < suggestions.length) {
        onSelect(suggestions[focusIdx])
        setOpen(false)
      } else if (value.trim()) {
        onSelect(value.trim())
        setOpen(false)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', ...style }}>
      <div style={{ position: 'relative' }}>
        {icon && (
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none', display: 'flex' }}>
            {icon}
          </span>
        )}
        <input
          type="text"
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => { if (value.length > 0 && suggestions.length > 0) setOpen(true) }}
          onKeyDown={handleKey}
          placeholder={placeholder}
          style={{ ...inputStyle, ...(icon ? { paddingLeft: 34 } : {}) }}
        />
        {loading && (
          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', display: 'flex', animation: 'spin 0.8s linear infinite' }}>
            <Loader2 size={14} color="var(--text-tertiary)" />
          </span>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <div style={styles.dropdown}>
          {suggestions.map((s, i) => (
            <button
              key={s}
              onMouseDown={() => { onSelect(s); setOpen(false) }}
              style={{
                ...styles.dropdownItem,
                background: i === focusIdx ? 'var(--bg-elevated)' : 'transparent',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {open && value.length > 1 && suggestions.length === 0 && !loading && (
        <div style={styles.dropdown}>
          <div style={{ padding: '10px 12px', fontSize: 13, color: 'var(--text-tertiary)' }}>
            No results — press Enter to add custom
          </div>
        </div>
      )}
    </div>
  )
}

// Shared input style used by AutocompleteInput (avoids circular ref with styles object)
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  fontSize: 14,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  outline: 'none',
  transition: 'border-color 150ms ease, box-shadow 150ms ease',
  boxSizing: 'border-box',
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface OnboardingWizardProps {
  onComplete: () => void
  defaultEmail?: string
  defaultName?: string
}

export function OnboardingWizard({ onComplete, defaultEmail, defaultName }: OnboardingWizardProps) {
  // Step index
  const [step, setStep] = useState(0)
  // Animation direction for transitions
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [transitioning, setTransitioning] = useState(false)
  const totalSteps = 5

  // Step 0 — Welcome
  const [botAnimating, setBotAnimating] = useState(true)

  // Step 1 — Profile
  const [name, setName] = useState(defaultName ?? '')
  const [email, setEmail] = useState(defaultEmail ?? '')
  const [emailTouched, setEmailTouched] = useState(false)
  const [nameTouched, setNameTouched] = useState(false)
  // Auto-detect location from timezone
  const [locationAutoDetected, setLocationAutoDetected] = useState(false)
  const [location, setLocation] = useState(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      const city = TIMEZONE_TO_CITY[tz]
      if (city) return city
    } catch { /* ignore */ }
    return ''
  })
  const [locationQuery, setLocationQuery] = useState('')
  const [citySuggestions, setCitySuggestions] = useState<string[]>([])
  const [cityLoading, setCityLoading] = useState(false)
  const [selectedRoles, setSelectedRoles] = useState<string[]>([])
  const [roleQuery, setRoleQuery] = useState('')
  const [experience, setExperience] = useState('Mid')

  // Step 2 — Preferences
  const [remoteOnly, setRemoteOnly] = useState(false)
  const [salaryMin, setSalaryMin] = useState(50)
  const [timezone, setTimezone] = useState(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return '' }
  })
  const [showTzPicker, setShowTzPicker] = useState(false)
  const [tzQuery, setTzQuery] = useState('')
  const [excludedCompanies, setExcludedCompanies] = useState<string[]>([])

  // Step 3 — Gmail
  const [gmailUrl, setGmailUrl] = useState('')
  const [gmailTestStatus, setGmailTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [gmailTestMsg, setGmailTestMsg] = useState('')
  const [showGmailHelp, setShowGmailHelp] = useState(false)

  // Attempted to proceed (for validation display)
  const [attemptedNext, setAttemptedNext] = useState(false)

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const timer = setTimeout(() => setBotAnimating(false), 2000)
    return () => clearTimeout(timer)
  }, [])

  // Mark location as auto-detected if we got it from timezone
  useEffect(() => {
    if (location && !locationAutoDetected) {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
        if (TIMEZONE_TO_CITY[tz] && location === TIMEZONE_TO_CITY[tz]) {
          setLocationAutoDetected(true)
        }
      } catch { /* ignore */ }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Geolocation API as a secondary/bonus source
  useEffect(() => {
    if (!navigator.geolocation) return
    let cancelled = false
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (cancelled) return
        try {
          const { latitude, longitude } = pos.coords
          const res = await fetch(
            `https://geocode.maps.co/reverse?lat=${latitude}&lon=${longitude}`
          )
          if (cancelled) return
          const data = await res.json()
          const city = data?.address?.city || data?.address?.town || data?.address?.village
          const country = data?.address?.country
          if (city && country) {
            const geoCity = `${city}, ${country}`
            // Only override if no timezone-based detection or if user hasn't manually changed it
            setLocation((prev: string) => {
              // If we already have a timezone-detected city, geolocation is more precise
              if (prev && prev !== geoCity) {
                // Geolocation is more precise, use it
                setLocationAutoDetected(true)
                return geoCity
              }
              if (!prev) {
                setLocationAutoDetected(true)
                return geoCity
              }
              return prev
            })
          }
        } catch { /* geocoding failed, no big deal */ }
      },
      () => { /* user denied or unavailable, timezone fallback is fine */ },
      { timeout: 5000, maximumAge: 300000 }
    )
    return () => { cancelled = true }
  }, [])

  // City autocomplete via Teleport API + local fallback
  const debouncedLocationQuery = useDebounce(locationQuery, 300)

  const POPULAR_CITIES = [
    'Bangkok, Thailand', 'Singapore', 'Tokyo, Japan', 'Seoul, South Korea',
    'Dubai, UAE', 'Mumbai, India', 'Bangalore, India', 'Sydney, Australia',
    'Melbourne, Australia', 'Hong Kong', 'Berlin, Germany', 'London, UK',
    'Paris, France', 'Amsterdam, Netherlands', 'Barcelona, Spain',
    'New York, USA', 'San Francisco, USA', 'Toronto, Canada',
    'Remote', 'Hybrid',
  ]

  useEffect(() => {
    if (debouncedLocationQuery.length < 2) { setCitySuggestions([]); return }
    const q = debouncedLocationQuery.toLowerCase()
    // Local filter first (instant)
    const localMatches = POPULAR_CITIES.filter(c => c.toLowerCase().includes(q))
    if (localMatches.length >= 3) { setCitySuggestions(localMatches.slice(0, 6)); return }
    // API for longer queries
    let cancelled = false
    setCityLoading(true)
    fetch(`https://api.teleport.org/api/cities/?search=${encodeURIComponent(debouncedLocationQuery)}&limit=6`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        const embedded = data?._embedded?.['city:search-results'] ?? []
        const names: string[] = embedded.map((c: { matching_full_name: string }) => c.matching_full_name).filter(Boolean)
        // Merge local + API results, deduplicated
        const merged = [...new Set([...localMatches, ...names])].slice(0, 6)
        setCitySuggestions(merged)
      })
      .catch(() => { if (!cancelled) setCitySuggestions(localMatches.slice(0, 6)) })
      .finally(() => { if (!cancelled) setCityLoading(false) })
    return () => { cancelled = true }
  }, [debouncedLocationQuery])

  // Role autocomplete — filter inline list
  const roleSuggestions = useMemo(() => {
    if (roleQuery.length < 1) return []
    const q = roleQuery.toLowerCase()
    return JOB_TITLES
      .filter(t => t.toLowerCase().includes(q) && !selectedRoles.includes(t))
      .slice(0, 8)
  }, [roleQuery, selectedRoles])

  // Timezone list filtered
  const tzSuggestions = useMemo((): string[] => {
    if (!showTzPicker) return []
    let all: string[] = []
    try { all = (Intl as unknown as { supportedValuesOf: (key: string) => string[] }).supportedValuesOf('timeZone') } catch { /* fallback empty */ }
    if (tzQuery.length < 1) return all.slice(0, 15)
    const q = tzQuery.toLowerCase()
    return all.filter((tz: string) => tz.toLowerCase().includes(q)).slice(0, 15)
  }, [tzQuery, showTzPicker])

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  const nameError = nameTouched || attemptedNext ? (name.trim() ? '' : 'Name is required') : ''
  const emailError = (() => {
    if (!emailTouched && !attemptedNext) return ''
    if (!email.trim()) return 'Email is required'
    if (!isValidEmail(email)) return 'Invalid email format'
    return ''
  })()

  const canProceed = () => {
    if (step === 1) return name.trim().length > 0 && email.trim().length > 0 && isValidEmail(email)
    return true
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const animateStep = (newStep: number, dir: 'forward' | 'back') => {
    setDirection(dir)
    setTransitioning(true)
    setTimeout(() => {
      setStep(newStep)
      setAttemptedNext(false)
      setTimeout(() => setTransitioning(false), 20)
    }, 180)
  }

  const nextStep = () => {
    if (step === 1 && !canProceed()) {
      setAttemptedNext(true)
      setNameTouched(true)
      setEmailTouched(true)
      return
    }
    if (step < totalSteps - 1) animateStep(step + 1, 'forward')
  }

  const prevStep = () => {
    if (step > 0) animateStep(step - 1, 'back')
  }

  const addRole = useCallback((role: string) => {
    const trimmed = role.trim()
    if (trimmed && !selectedRoles.includes(trimmed)) {
      setSelectedRoles(prev => [...prev, trimmed])
    }
    setRoleQuery('')
  }, [selectedRoles])

  const removeRole = useCallback((role: string) => {
    setSelectedRoles(prev => prev.filter(r => r !== role))
  }, [])

  const testGmailConnection = useCallback(async () => {
    if (!gmailUrl.trim()) return
    setGmailTestStatus('loading')
    setGmailTestMsg('')
    try {
      const res = await fetch(gmailUrl.trim())
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data && (Array.isArray(data.rejections) || Array.isArray(data.events) || data.lastScan)) {
        setGmailTestStatus('success')
        setGmailTestMsg('Connected! Gmail sync is working.')
        localStorage.setItem(GMAIL_URL_KEY, gmailUrl.trim())
      } else {
        setGmailTestStatus('error')
        setGmailTestMsg('Response received but format unexpected. Check your script.')
      }
    } catch (err) {
      setGmailTestStatus('error')
      setGmailTestMsg(err instanceof Error ? err.message : 'Connection failed')
    }
  }, [gmailUrl])

  const handleComplete = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEY, 'true')

    const profile = {
      name,
      email,
      location,
      roles: selectedRoles,
      experience,
      remoteOnly,
      salaryMin,
      timezone,
      excludedCompanies: [...excludedCompanies],
    }
    localStorage.setItem('tracker_v2_user_profile', JSON.stringify(profile))

    if (gmailUrl.trim()) {
      localStorage.setItem(GMAIL_URL_KEY, gmailUrl.trim())
    }

    // Confetti
    const end = Date.now() + 1200
    const fire = () => {
      confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0, y: 0.7 }, colors: ['#34d399', '#60a5fa', '#f59e0b'] })
      confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1, y: 0.7 }, colors: ['#34d399', '#60a5fa', '#f59e0b'] })
      if (Date.now() < end) requestAnimationFrame(fire)
    }
    fire()
    setTimeout(onComplete, 1500)
  }, [name, email, location, selectedRoles, experience, remoteOnly, salaryMin, timezone, excludedCompanies, gmailUrl, onComplete])

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const stepContentStyle: React.CSSProperties = {
    ...styles.stepContent,
    opacity: transitioning ? 0 : 1,
    transform: transitioning
      ? `translateX(${direction === 'forward' ? '24px' : '-24px'})`
      : 'translateX(0)',
    transition: 'opacity 180ms ease, transform 180ms ease',
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        {/* Step indicators */}
        <div style={styles.stepRow}>
          {Array.from({ length: totalSteps }, (_, i) => (
            <div
              key={i}
              style={{
                ...styles.stepDot,
                background: i <= step ? 'var(--accent)' : 'var(--border)',
                width: i === step ? 24 : 8,
              }}
            />
          ))}
        </div>

        {/* ================================================================ */}
        {/* Step 0: Welcome                                                  */}
        {/* ================================================================ */}
        {step === 0 && (
          <div style={stepContentStyle}>
            <div style={{
              ...styles.botIcon,
              animation: botAnimating ? 'pulse 1s ease-in-out infinite' : 'none',
            }}>
              <Bot size={40} color="var(--accent)" />
            </div>
            <h1 style={styles.title}>Welcome to Job Tracker</h1>
            <p style={styles.subtitle}>
              Apply smarter, not harder. Let's set up your profile.
            </p>
            <button onClick={nextStep} style={styles.primaryBtn}>
              Get Started
              <ArrowRight size={16} />
            </button>
          </div>
        )}

        {/* ================================================================ */}
        {/* Step 1: Profile                                                  */}
        {/* ================================================================ */}
        {step === 1 && (
          <div style={stepContentStyle}>
            <h2 style={styles.stepTitle}>Your Profile</h2>
            <p style={styles.stepDesc}>Tell us a bit about yourself</p>
            <div style={styles.formGrid}>
              {/* Name */}
              <div style={styles.field}>
                <label style={styles.label}>Name <span style={{ color: 'var(--accent)' }}>*</span></label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onBlur={() => setNameTouched(true)}
                  placeholder="Your full name"
                  style={{ ...styles.input, ...(nameError ? styles.inputError : {}) }}
                />
                {nameError && <span style={styles.errorText}>{nameError}</span>}
              </div>

              {/* Email */}
              <div style={styles.field}>
                <label style={styles.label}>Email <span style={{ color: 'var(--accent)' }}>*</span></label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onBlur={() => setEmailTouched(true)}
                  placeholder="your@email.com"
                  style={{ ...styles.input, ...(emailError ? styles.inputError : {}) }}
                />
                {emailError && <span style={styles.errorText}>{emailError}</span>}
              </div>

              {/* Location (Autocomplete) */}
              <div style={styles.field}>
                <label style={styles.label}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <MapPin size={14} />
                    Current Location
                  </span>
                  {locationAutoDetected && location && (
                    <span style={{ fontSize: 11, color: 'var(--accent)', padding: '2px 6px', borderRadius: 4, background: 'rgba(52,211,153,0.1)' }}>
                      Auto-detected
                    </span>
                  )}
                </label>
                <AutocompleteInput
                  value={locationQuery || location}
                  onChange={v => { setLocationQuery(v); setLocation(v); setLocationAutoDetected(false) }}
                  placeholder="Start typing a city..."
                  suggestions={citySuggestions}
                  loading={cityLoading}
                  onSelect={v => { setLocation(v); setLocationQuery(''); setLocationAutoDetected(false) }}
                  icon={<Globe size={14} />}
                />
              </div>

              {/* Experience */}
              <div style={styles.field}>
                <label style={styles.label}>Experience Level</label>
                <div style={styles.chipRow}>
                  {EXPERIENCE_LEVELS.map(level => (
                    <button
                      key={level}
                      onClick={() => setExperience(level)}
                      style={{
                        ...styles.chip,
                        ...(experience === level ? styles.chipActive : {}),
                      }}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              {/* Target Roles (Autocomplete + Chips) */}
              <div style={styles.field}>
                <label style={styles.label}>Target Roles</label>
                <AutocompleteInput
                  value={roleQuery}
                  onChange={setRoleQuery}
                  placeholder="Search or type a role..."
                  suggestions={roleSuggestions}
                  onSelect={addRole}
                  icon={<Search size={14} />}
                />
                {selectedRoles.length > 0 && (
                  <div style={{ ...styles.chipRow, marginTop: 8 }}>
                    {selectedRoles.map(role => (
                      <span key={role} style={{ ...styles.chip, ...styles.chipActive }}>
                        {role}
                        <button
                          onClick={() => removeRole(role)}
                          style={{ display: 'flex', alignItems: 'center', marginLeft: 2, color: 'inherit', padding: 0, background: 'none', border: 'none', cursor: 'pointer' }}
                          aria-label={`Remove ${role}`}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <span style={styles.hint}>
                  Search from 100+ titles or type your own and press Enter
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* Step 2: Search Preferences                                       */}
        {/* ================================================================ */}
        {step === 2 && (
          <div style={stepContentStyle}>
            <h2 style={styles.stepTitle}>Search Preferences</h2>
            <p style={styles.stepDesc}>Configure how the bot searches for you</p>
            <div style={styles.formGrid}>
              {/* Remote toggle */}
              <div style={styles.field}>
                <label style={styles.label}>
                  <span>Remote Only</span>
                  <button
                    onClick={() => setRemoteOnly(!remoteOnly)}
                    style={{
                      ...styles.toggle,
                      background: remoteOnly ? 'var(--accent)' : 'var(--bg-elevated)',
                    }}
                  >
                    <span style={{
                      ...styles.toggleThumb,
                      transform: remoteOnly ? 'translateX(16px)' : 'translateX(2px)',
                    }} />
                  </button>
                </label>
              </div>

              {/* Salary */}
              <div style={styles.field}>
                <label style={styles.label}>
                  Minimum Salary: {salaryMin}k EUR/year
                </label>
                <input
                  type="range"
                  min={30}
                  max={200}
                  step={5}
                  value={salaryMin}
                  onChange={e => setSalaryMin(Number(e.target.value))}
                  style={styles.range}
                />
                <div style={styles.rangeLabels}>
                  <span>30k</span>
                  <span>200k</span>
                </div>
              </div>

              {/* Timezone */}
              <div style={styles.field}>
                <label style={styles.label}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Globe size={14} />
                    Timezone
                  </span>
                </label>
                {!showTzPicker ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      ...styles.input,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flex: 1,
                      cursor: 'default',
                    }}>
                      <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                        {timezone ? formatTzLabel(timezone) : 'Not detected'}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--accent)', padding: '2px 6px', borderRadius: 4, background: 'rgba(52,211,153,0.1)' }}>
                        Auto-detected
                      </span>
                    </div>
                    <button
                      onClick={() => setShowTzPicker(true)}
                      style={{
                        fontSize: 12,
                        color: 'var(--text-tertiary)',
                        padding: '6px 10px',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border)',
                        background: 'var(--bg-elevated)',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      value={tzQuery}
                      onChange={e => setTzQuery(e.target.value)}
                      placeholder="Search timezone..."
                      style={styles.input}
                      autoFocus
                    />
                    {tzSuggestions.length > 0 && (
                      <div style={{ ...styles.dropdown, maxHeight: 200 }}>
                        {tzSuggestions.map((tz: string) => (
                          <button
                            key={tz}
                            onMouseDown={() => {
                              setTimezone(tz)
                              setShowTzPicker(false)
                              setTzQuery('')
                            }}
                            style={styles.dropdownItem}
                          >
                            {formatTzLabel(tz)}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => { setShowTzPicker(false); setTzQuery('') }}
                      style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', display: 'flex', cursor: 'pointer', background: 'none', border: 'none' }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>

              {/* Excluded companies */}
              <div style={styles.field}>
                <label style={styles.label}>Excluded Companies</label>
                <CompanyChipInput
                  chips={excludedCompanies}
                  onAdd={(val) => setExcludedCompanies((prev) => [...prev, val])}
                  onRemove={(idx) => setExcludedCompanies((prev) => prev.filter((_, i) => i !== idx))}
                  placeholder="Search companies..."
                />
                <span style={styles.hint}>Search or type a name and press Enter</span>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* Step 3: Gmail Sync                                               */}
        {/* ================================================================ */}
        {step === 3 && (
          <div style={stepContentStyle}>
            <div style={styles.gmailIcon}>
              <Mail size={28} color="var(--accent)" />
            </div>
            <h2 style={styles.stepTitle}>Track your applications automatically</h2>
            <p style={{ ...styles.stepDesc, maxWidth: 380 }}>
              Connect your Gmail to automatically detect application confirmations, rejections, and interview invites.
              We only read email subjects and senders — no email content is stored.
            </p>

            {/* Privacy badges */}
            <div style={styles.privacyRow}>
              <span style={styles.privacyBadge}>
                <Lock size={12} /> Read-only access
              </span>
              <span style={styles.privacyBadge}>
                <Shield size={12} /> No emails stored
              </span>
              <span style={styles.privacyBadge}>
                <Unplug size={12} /> Disconnect anytime
              </span>
            </div>

            {/* URL Input */}
            <div style={{ width: '100%' }}>
              <div style={styles.field}>
                <label style={styles.label}>Apps Script URL</label>
                <input
                  type="url"
                  value={gmailUrl}
                  onChange={e => { setGmailUrl(e.target.value); setGmailTestStatus('idle') }}
                  placeholder="Paste your Google Apps Script URL"
                  style={styles.input}
                />
              </div>

              {/* Test result */}
              {gmailTestStatus !== 'idle' && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 8,
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 13,
                  background: gmailTestStatus === 'success'
                    ? 'rgba(52, 211, 153, 0.1)'
                    : gmailTestStatus === 'error'
                      ? 'rgba(239, 68, 68, 0.1)'
                      : 'var(--bg-elevated)',
                  color: gmailTestStatus === 'success'
                    ? '#34d399'
                    : gmailTestStatus === 'error'
                      ? '#ef4444'
                      : 'var(--text-secondary)',
                }}>
                  {gmailTestStatus === 'loading' && <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} />}
                  {gmailTestStatus === 'success' && <Check size={14} />}
                  {gmailTestStatus === 'error' && <AlertCircle size={14} />}
                  <span>{gmailTestStatus === 'loading' ? 'Testing connection...' : gmailTestMsg}</span>
                </div>
              )}

              {/* Test button */}
              <button
                onClick={testGmailConnection}
                disabled={!gmailUrl.trim() || gmailTestStatus === 'loading'}
                style={{
                  ...styles.outlineBtn,
                  marginTop: 10,
                  opacity: gmailUrl.trim() ? 1 : 0.4,
                  pointerEvents: gmailUrl.trim() ? 'auto' : 'none',
                }}
              >
                {gmailTestStatus === 'loading' ? (
                  <><Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> Testing...</>
                ) : (
                  <><Zap size={14} /> Test Connection</>
                )}
              </button>

              {/* Help accordion */}
              <button
                onClick={() => setShowGmailHelp(!showGmailHelp)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  color: 'var(--text-tertiary)',
                  marginTop: 12,
                  cursor: 'pointer',
                  padding: 0,
                  background: 'none',
                  border: 'none',
                }}
              >
                <HelpCircle size={14} />
                How to set this up
                <ChevronDown
                  size={14}
                  style={{
                    transform: showGmailHelp ? 'rotate(180deg)' : 'rotate(0)',
                    transition: 'transform 200ms ease',
                  }}
                />
              </button>
              {showGmailHelp && (
                <div style={styles.helpBox}>
                  <div style={styles.helpStep}>
                    <span style={styles.helpNum}>1</span>
                    <span>Open <strong>Google Apps Script</strong> at script.google.com</span>
                  </div>
                  <div style={styles.helpStep}>
                    <span style={styles.helpNum}>2</span>
                    <span>Copy our template script (handles Gmail label scanning)</span>
                  </div>
                  <div style={styles.helpStep}>
                    <span style={styles.helpNum}>3</span>
                    <span>
                      Click <strong>Deploy &gt; New deployment</strong>, choose "Web app", then paste the URL here
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Skip */}
            <button onClick={nextStep} style={styles.ghostBtn}>
              Skip for now
              <ArrowRight size={14} />
            </button>
          </div>
        )}

        {/* ================================================================ */}
        {/* Step 4: Ready                                                    */}
        {/* ================================================================ */}
        {step === 4 && (
          <div style={stepContentStyle}>
            <div style={styles.readyIcon}>
              <Sparkles size={32} color="var(--accent)" />
            </div>
            <h2 style={styles.stepTitle}>You're All Set!</h2>
            <p style={styles.stepDesc}>Here's what the bot can do for you:</p>
            <div style={styles.featureList}>
              <div style={styles.featureItem}>
                <div style={styles.featureIcon}>
                  <Zap size={20} color="#f59e0b" />
                </div>
                <div>
                  <h4 style={styles.featureName}>Auto-Apply</h4>
                  <p style={styles.featureDesc}>
                    Automatically fill and submit applications to matching jobs
                  </p>
                </div>
              </div>
              <div style={styles.featureItem}>
                <div style={styles.featureIcon}>
                  <Brain size={20} color="#60a5fa" />
                </div>
                <div>
                  <h4 style={styles.featureName}>Smart Learning</h4>
                  <p style={styles.featureDesc}>
                    Thompson Sampling optimizes your application strategy over time
                  </p>
                </div>
              </div>
              <div style={styles.featureItem}>
                <div style={styles.featureIcon}>
                  <Shield size={20} color="#34d399" />
                </div>
                <div>
                  <h4 style={styles.featureName}>Full Control</h4>
                  <p style={styles.featureDesc}>
                    Every action requires your approval. You're always in the driver's seat.
                  </p>
                </div>
              </div>
            </div>
            <button onClick={handleComplete} style={styles.primaryBtn}>
              Go to Dashboard
              <ArrowRight size={16} />
            </button>
          </div>
        )}

        {/* ================================================================ */}
        {/* Navigation                                                       */}
        {/* ================================================================ */}
        {step > 0 && step < 4 && (
          <div style={styles.navRow}>
            <button onClick={prevStep} style={styles.backBtn}>
              <ArrowLeft size={14} />
              Back
            </button>
            <button
              onClick={nextStep}
              style={{
                ...styles.primaryBtn,
                opacity: (step !== 1 || canProceed()) ? 1 : 0.4,
              }}
            >
              {step === 3 ? 'Continue' : 'Next'}
              <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Inline keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.85)',
    backdropFilter: 'blur(12px)',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90vh',
    overflowY: 'auto',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    padding: '32px 36px',
    position: 'relative',
  },
  stepRow: {
    display: 'flex',
    gap: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
  },
  stepDot: {
    height: 4,
    borderRadius: 2,
    transition: 'all 300ms ease',
  },
  stepContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: 12,
  },
  botIcon: {
    width: 80,
    height: 80,
    borderRadius: '50%',
    background: 'rgba(52, 211, 153, 0.1)',
    border: '2px solid rgba(52, 211, 153, 0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: 700,
    color: 'var(--text-primary)',
    letterSpacing: '-0.02em',
  },
  subtitle: {
    fontSize: 15,
    color: 'var(--text-secondary)',
    maxWidth: 320,
    lineHeight: 1.5,
    marginBottom: 8,
  },
  stepTitle: {
    fontSize: 20,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  stepDesc: {
    fontSize: 14,
    color: 'var(--text-tertiary)',
    marginBottom: 8,
  },
  formGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    width: '100%',
    textAlign: 'left',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  input: {
    ...inputStyle,
  },
  inputError: {
    borderColor: '#ef4444',
    boxShadow: '0 0 0 2px rgba(239, 68, 68, 0.15)',
  },
  errorText: {
    fontSize: 12,
    color: '#ef4444',
    marginTop: -2,
  },
  hint: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 20,
    border: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    transition: 'all 150ms ease',
  },
  chipActive: {
    background: 'rgba(52, 211, 153, 0.12)',
    borderColor: 'rgba(52, 211, 153, 0.4)',
    color: 'var(--accent)',
  },
  toggle: {
    width: 36,
    height: 20,
    borderRadius: 10,
    border: '1px solid var(--border)',
    position: 'relative' as const,
    cursor: 'pointer',
    transition: 'background 200ms ease',
    flexShrink: 0,
  },
  toggleThumb: {
    display: 'block',
    width: 14,
    height: 14,
    borderRadius: '50%',
    background: '#fff',
    position: 'absolute' as const,
    top: 2,
    transition: 'transform 200ms ease',
  },
  range: {
    width: '100%',
    accentColor: 'var(--accent)',
    cursor: 'pointer',
    background: 'transparent',
    border: 'none',
    padding: 0,
  },
  rangeLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    color: 'var(--text-tertiary)',
  },
  // Dropdown for autocomplete
  dropdown: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    maxHeight: 220,
    overflowY: 'auto' as const,
    zIndex: 100,
    boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
  },
  dropdownItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left' as const,
    padding: '8px 12px',
    fontSize: 13,
    color: 'var(--text-primary)',
    border: 'none',
    cursor: 'pointer',
    transition: 'background 100ms ease',
    background: 'transparent',
  },
  // Gmail step
  gmailIcon: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: 'rgba(52, 211, 153, 0.1)',
    border: '2px solid rgba(52, 211, 153, 0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  privacyRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 8,
    justifyContent: 'center',
    marginBottom: 8,
  },
  privacyBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 11,
    fontWeight: 500,
    color: 'var(--text-tertiary)',
    padding: '4px 10px',
    borderRadius: 20,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid var(--border)',
  },
  outlineBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: '100%',
    padding: '9px 16px',
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--accent)',
    background: 'transparent',
    border: '1px solid rgba(52, 211, 153, 0.3)',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    transition: 'all 150ms ease',
  },
  helpBox: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
    padding: '12px 14px',
    marginTop: 8,
    background: 'var(--bg-elevated)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)',
    textAlign: 'left' as const,
    fontSize: 13,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
  },
  helpStep: {
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
  },
  helpNum: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    borderRadius: '50%',
    background: 'rgba(52, 211, 153, 0.12)',
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 600,
    flexShrink: 0,
  },
  ghostBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: 'var(--text-tertiary)',
    padding: '8px 16px',
    borderRadius: 'var(--radius-md)',
    transition: 'color 150ms ease',
    marginTop: 8,
    cursor: 'pointer',
    background: 'none',
    border: 'none',
  },
  featureList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16,
    width: '100%',
    textAlign: 'left' as const,
    marginTop: 8,
    marginBottom: 8,
  },
  featureItem: {
    display: 'flex',
    gap: 14,
    alignItems: 'flex-start',
    padding: '12px 14px',
    background: 'var(--bg-elevated)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--border)',
  },
  featureIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    background: 'rgba(255,255,255,0.04)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  featureName: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary)',
    marginBottom: 2,
  },
  featureDesc: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    lineHeight: 1.4,
  },
  readyIcon: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: 'rgba(52, 211, 153, 0.1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  primaryBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '11px 24px',
    fontSize: 14,
    fontWeight: 600,
    color: '#000',
    background: 'var(--accent)',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    transition: 'opacity 150ms ease',
    marginTop: 8,
    border: 'none',
  },
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: 'var(--text-secondary)',
    padding: '8px 12px',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    transition: 'color 150ms ease',
    background: 'none',
    border: 'none',
  },
  navRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
    paddingTop: 16,
    borderTop: '1px solid var(--border)',
  },
}
