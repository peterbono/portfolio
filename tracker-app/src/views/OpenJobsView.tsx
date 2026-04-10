import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { Briefcase, MapPin, Clock, Search, X, ChevronDown, Check, SlidersHorizontal, Info, Plus, RefreshCw, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useScout } from '../context/ScoutContext'
import { ScoutProgressBanner } from '../components/ScoutProgressBanner'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface OpenJob {
  id: string
  role: string
  company: string
  location: string | null
  salary: string | null
  tags: string[]
  postedAt: string // ISO date
  link: string | null
  jdKeywords?: string[]
  qualificationScore?: number | null
}

/* ------------------------------------------------------------------ */
/*  Sample data (fallback when Supabase returns empty)                 */
/* ------------------------------------------------------------------ */
const SAMPLE_JOBS: OpenJob[] = [
  { id: '1', role: 'Senior Product Designer', company: 'Scout Motors', location: 'Remote', salary: '$120k-$145k', tags: ['Remote', 'Senior', 'Design Systems'], postedAt: new Date(Date.now() - 1 * 3600_000).toISOString(), link: null },
  { id: '2', role: 'Staff Product Designer', company: 'Stripe', location: 'Singapore', salary: '$150k-$180k', tags: ['Hybrid', 'Staff', 'Fintech'], postedAt: new Date(Date.now() - 3 * 3600_000).toISOString(), link: null },
  { id: '3', role: 'Product Designer', company: 'Grab', location: 'Bangkok', salary: '$80k-$100k', tags: ['On-site', 'Mid-Senior', 'Super App'], postedAt: new Date(Date.now() - 5 * 3600_000).toISOString(), link: null },
  { id: '4', role: 'UX Designer', company: 'Agoda', location: 'Bangkok', salary: '$70k-$90k', tags: ['Hybrid', 'Senior', 'Travel'], postedAt: new Date(Date.now() - 8 * 3600_000).toISOString(), link: null },
  { id: '5', role: 'Lead Product Designer', company: 'Wise', location: 'Remote (APAC)', salary: '$130k-$160k', tags: ['Remote', 'Lead', 'Fintech'], postedAt: new Date(Date.now() - 12 * 3600_000).toISOString(), link: null },
  { id: '6', role: 'Senior UX/UI Designer', company: 'Shopee', location: 'Singapore', salary: '$90k-$120k', tags: ['On-site', 'Senior', 'E-commerce'], postedAt: new Date(Date.now() - 24 * 3600_000).toISOString(), link: null },
  { id: '7', role: 'Principal Product Designer', company: 'Canva', location: 'Remote', salary: '$170k-$200k', tags: ['Remote', 'Principal', 'Creative Tools'], postedAt: new Date(Date.now() - 2 * 86400_000).toISOString(), link: null },
  { id: '8', role: 'Product Designer', company: 'Delivery Hero', location: 'Singapore', salary: '$85k-$110k', tags: ['Hybrid', 'Mid-Senior', 'Logistics'], postedAt: new Date(Date.now() - 3 * 86400_000).toISOString(), link: null },
  { id: '9', role: 'Senior Product Designer', company: 'Revolut', location: 'Remote (APAC)', salary: '$110k-$140k', tags: ['Remote', 'Senior', 'Fintech'], postedAt: new Date(Date.now() - 4 * 86400_000).toISOString(), link: null },
]

/* ------------------------------------------------------------------ */
/*  Filter constants                                                   */
/* ------------------------------------------------------------------ */
type DateKey = '24h' | '3d' | '7d' | 'month' | 'all'

const DATE_OPTIONS: { key: DateKey; label: string; ms: number }[] = [
  { key: '24h', label: 'Past 24 Hours', ms: 24 * 3600_000 },
  { key: '3d', label: 'Past 3 Days', ms: 3 * 86400_000 },
  { key: '7d', label: 'Past 7 Days', ms: 7 * 86400_000 },
  { key: 'month', label: 'Past Month', ms: 30 * 86400_000 },
  { key: 'all', label: 'All Time', ms: Infinity },
]

const EXP_OPTIONS = [
  { key: 'intern', label: 'Intern' },
  { key: 'entry', label: 'Entry (1-2 years)' },
  { key: 'mid', label: 'Mid (3-5 years)' },
  { key: 'senior', label: 'Senior (5+ years)' },
  { key: 'other', label: 'Other' },
]

const WORK_MODE_OPTIONS = [
  { key: 'remote', label: 'Remote' },
  { key: 'hybrid', label: 'Hybrid' },
  { key: 'inoffice', label: 'In office' },
]

const DEFAULT_COUNTRY = 'Thailand'
const MAX_LOCATIONS = 3

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function OpenJobsView() {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [detailJob, setDetailJob] = useState<OpenJob | null>(null)
  const firstName = 'Florian'

  // Supabase data
  const [jobs, setJobs] = useState<OpenJob[]>([])
  const [loading, setLoading] = useState(true)
  const [isSampleData, setIsSampleData] = useState(false)

  // Filter state
  const [dateFilter, setDateFilter] = useState<DateKey>('7d')
  const [expFilters, setExpFilters] = useState<Set<string>>(() => new Set(['mid', 'senior']))
  const [locSearch, setLocSearch] = useState('')
  const [workMode, setWorkMode] = useState<Set<string>>(() => new Set(['remote']))
  const [openPopover, setOpenPopover] = useState<'date' | 'exp' | 'loc' | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // Advanced filter state
  const [includeWords, setIncludeWords] = useState<string[]>([])
  const [excludeWords, setExcludeWords] = useState<string[]>([])
  const [includeIndustries, setIncludeIndustries] = useState<string[]>([])
  const [excludeIndustries, setExcludeIndustries] = useState<string[]>([])
  const [minSalary, setMinSalary] = useState('')
  const [visaSponsor, setVisaSponsor] = useState<'only' | 'all'>('all')

  // Advanced chip input drafts
  const [includeWordDraft, setIncludeWordDraft] = useState('')
  const [excludeWordDraft, setExcludeWordDraft] = useState('')
  const [includeIndustryDraft, setIncludeIndustryDraft] = useState('')
  const [excludeIndustryDraft, setExcludeIndustryDraft] = useState('')

  // Toast state — kept for filter validation errors only. Scout state lives
  // in the global ScoutContext + ScoutProgressBanner above the grid.
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)

  // Global scout state — drives the banner + the "Find new jobs" button label
  const scout = useScout()

  const [hasKeywords, setHasKeywords] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem('tracker_v2_search_config')
      const cfg = raw ? JSON.parse(raw) : null
      return Array.isArray(cfg?.keywords) && cfg.keywords.length > 0
    } catch { return false }
  })

  // Refs for click-outside
  const popoverRef = useRef<HTMLDivElement>(null)

  // Fetch jobs from Supabase (reusable: initial load + "Scan now" refresh)
  const fetchJobs = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setJobs(SAMPLE_JOBS)
        setIsSampleData(true)
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('job_listings')
        .select('id, user_id, company, role, title, location, salary, salary_range, ats, link, work_arrangement, qualification_score, qualification_result, created_at, posted_at')
        .eq('user_id', user.id)
        .not('qualification_score', 'is', null)
        .gte('qualification_score', 50)
        .order('created_at', { ascending: false })
        .limit(50)

      if (!error && data && data.length > 0) {
        setJobs(data.map((row: Record<string, unknown>) => {
          const qr = row.qualification_result as Record<string, unknown> | null
          const jdKeywords = (qr?.jdKeywords as string[] | undefined)
            ?? (qr?.jd_keywords as string[] | undefined)
            ?? []
          return {
            id: row.id as string,
            role: (row.role as string) || (row.title as string) || 'Unknown Role',
            company: (row.company as string) || 'Unknown',
            location: row.location as string | null,
            salary: (row.salary as string | null) || (row.salary_range as string | null),
            tags: [row.location, row.ats, row.work_arrangement].filter(Boolean) as string[],
            postedAt: (row.posted_at as string) || (row.created_at as string),
            link: row.link as string | null,
            jdKeywords,
            qualificationScore: row.qualification_score as number | null,
          }
        }))
        setIsSampleData(false)
      } else {
        setJobs(SAMPLE_JOBS)
        setIsSampleData(true)
      }
    } catch {
      setJobs(SAMPLE_JOBS)
      setIsSampleData(true)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  // Refresh when AutopilotView (or self) fires a scout-complete event
  useEffect(() => {
    const handler = () => { fetchJobs() }
    window.addEventListener('tracker:jobs-refresh', handler)
    return () => window.removeEventListener('tracker:jobs-refresh', handler)
  }, [fetchJobs])

  // "Scan now" handler — triggers Scout-only, polls bot_runs, refreshes on done
  /**
   * Find new jobs handler — fires a scout and lets the global ScoutContext
   * track progress. The ScoutProgressBanner above the grid renders the
   * stage label, percent, counters, and counter updates as the run advances.
   * When scout.stage transitions to 'done', the useEffect below auto-refreshes
   * the grid via fetchJobs().
   */
  const handleScanNow = useCallback(async () => {
    if (scout.isRunning || !hasKeywords) return
    try {
      const { triggerScout } = await import('../lib/bot-api')
      const { runId } = await triggerScout()
      scout.startScout(runId)
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Failed to start scout',
        type: 'error',
      })
      setTimeout(() => setToast(null), 5000)
    }
  }, [scout, hasKeywords])

  // Auto-dismiss toast after 5s. (Scout progress is in the banner, not the toast.)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  // When the global scout transitions to 'done', re-fetch the grid so the
  // user immediately sees the new qualified jobs without a manual refresh.
  useEffect(() => {
    if (scout.stage === 'done') {
      fetchJobs()
    }
  }, [scout.stage, fetchJobs])

  // Keep hasKeywords in sync with localStorage updates from AutopilotView
  useEffect(() => {
    const refresh = () => {
      try {
        const raw = localStorage.getItem('tracker_v2_search_config')
        const cfg = raw ? JSON.parse(raw) : null
        setHasKeywords(Array.isArray(cfg?.keywords) && cfg.keywords.length > 0)
      } catch { /* ignore */ }
    }
    window.addEventListener('storage', refresh)
    window.addEventListener('tracker:jobs-refresh', refresh)
    return () => {
      window.removeEventListener('storage', refresh)
      window.removeEventListener('tracker:jobs-refresh', refresh)
    }
  }, [])

  // Click outside to close popover
  useEffect(() => {
    if (!openPopover) return
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpenPopover(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [openPopover])

  // Close modal on Escape
  useEffect(() => {
    if (!advancedOpen) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setAdvancedOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [advancedOpen])

  // Toggle popover
  const togglePopover = (key: 'date' | 'exp' | 'loc') => {
    setOpenPopover(prev => prev === key ? null : key)
  }

  // Advanced chip helpers
  const addChip = (setter: React.Dispatch<React.SetStateAction<string[]>>, draftSetter: React.Dispatch<React.SetStateAction<string>>, value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    setter(prev => (prev.includes(trimmed) ? prev : [...prev, trimmed]))
    draftSetter('')
  }
  const removeChip = (setter: React.Dispatch<React.SetStateAction<string[]>>, value: string) => {
    setter(prev => prev.filter(v => v !== value))
  }
  const resetAdvanced = () => {
    setIncludeWords([]); setExcludeWords([]); setIncludeIndustries([]); setExcludeIndustries([])
    setMinSalary(''); setVisaSponsor('all')
  }

  // Toggle experience multi-select
  const toggleExp = (key: string) => {
    setExpFilters(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Toggle work mode multi-select
  const toggleWorkMode = (key: string) => {
    setWorkMode(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Apply for me handler
  const handleApply = useCallback(async (jobIds: Set<string>) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setToast({ message: 'Please sign in to apply', type: 'error' })
        return
      }

      // Fetch user profile
      const { data: profileData, error: profileErr } = await supabase
        .from('profiles' as never)
        .select('*')
        .eq('id', user.id)
        .maybeSingle()

      const profileRow = profileData as Record<string, unknown> | null
      if (profileErr || !profileRow) {
        setToast({ message: 'Set up your profile before applying', type: 'error' })
        return
      }

      // Filter out jobs without real URLs
      const candidates = jobs.filter(j => jobIds.has(j.id))
      const applyable = candidates.filter(j => j.link && j.link.trim().length > 0)

      if (applyable.length === 0) {
        setToast({
          message: "These sample jobs don't have real URLs — run Autopilot to discover real jobs",
          type: 'error',
        })
        return
      }

      const selectedJobs = applyable.map(j => ({
        url: j.link as string,
        company: j.company,
        role: j.role,
        coverLetterSnippet: '',
        matchScore: j.qualificationScore ?? 75,
        jdKeywords: j.jdKeywords ?? [],
      }))

      const userProfile = {
        name: (profileRow.name as string | undefined)
          ?? (profileRow.full_name as string | undefined)
          ?? '',
        email: (profileRow.email as string | undefined) ?? user.email ?? '',
        phone: (profileRow.phone as string | undefined) ?? '',
        linkedin: (profileRow.linkedin as string | undefined) ?? '',
        portfolio: (profileRow.portfolio as string | undefined) ?? '',
        cvUrl: (profileRow.cvUrl as string | undefined)
          ?? (profileRow.cv_url as string | undefined)
          ?? '',
      }

      const res = await fetch('/api/queue-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobs: selectedJobs,
          userId: user.id,
          userProfile,
        }),
      })

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`
        try {
          const body = await res.json()
          if (body?.error) errMsg = String(body.error)
        } catch { /* ignore JSON parse */ }
        setToast({ message: errMsg, type: 'error' })
        return
      }

      const skipped = candidates.length - applyable.length
      const baseMsg = `${selectedJobs.length} job${selectedJobs.length > 1 ? 's' : ''} queued for cloud apply`
      const msg = skipped > 0 ? `${baseMsg} (${skipped} sample skipped)` : baseMsg
      setToast({ message: msg, type: 'success' })
      setSelected(new Set())
      setDetailJob(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to queue jobs. Try again.'
      setToast({ message: msg, type: 'error' })
    }
  }, [jobs])

  // Filter jobs
  const filtered = useMemo(() => {
    let list = jobs

    // Date filter
    if (dateFilter !== 'all') {
      const opt = DATE_OPTIONS.find(o => o.key === dateFilter)
      if (opt) {
        const cutoff = Date.now() - opt.ms
        list = list.filter(j => new Date(j.postedAt).getTime() >= cutoff)
      }
    }

    // Experience filter (tag/title heuristic)
    if (expFilters.size > 0) {
      list = list.filter(j => {
        const hay = (j.role + ' ' + j.tags.join(' ')).toLowerCase()
        if (expFilters.has('intern') && hay.includes('intern')) return true
        if (expFilters.has('entry') && (hay.includes('junior') || hay.includes('entry') || hay.includes('associate'))) return true
        if (expFilters.has('mid') && (hay.includes('mid') || hay.includes('product designer') || hay.includes('ux designer'))) return true
        if (expFilters.has('senior') && (hay.includes('senior') || hay.includes('staff') || hay.includes('principal') || hay.includes('lead'))) return true
        if (expFilters.has('other') && !hay.match(/intern|junior|entry|mid|senior|staff|principal|lead/)) return true
        return false
      })
    }

    // Location text search
    if (locSearch.trim()) {
      const q = locSearch.toLowerCase()
      list = list.filter(j => j.location?.toLowerCase().includes(q) || j.tags.some(t => t.toLowerCase().includes(q)))
    }

    // Work mode filter
    if (workMode.size > 0) {
      list = list.filter(j => {
        const loc = (j.location || '').toLowerCase()
        const tagStr = j.tags.join(' ').toLowerCase()
        if (workMode.has('remote') && (loc.includes('remote') || tagStr.includes('remote'))) return true
        if (workMode.has('hybrid') && (loc.includes('hybrid') || tagStr.includes('hybrid'))) return true
        if (workMode.has('inoffice') && (loc.includes('on-site') || loc.includes('office') || tagStr.includes('on-site') || tagStr.includes('office'))) return true
        return false
      })
    }

    // Advanced: include words (title must contain at least one)
    if (includeWords.length > 0) {
      list = list.filter(j => {
        const title = j.role.toLowerCase()
        return includeWords.some(w => title.includes(w.toLowerCase()))
      })
    }

    // Advanced: exclude words (title must not contain any)
    if (excludeWords.length > 0) {
      list = list.filter(j => {
        const title = j.role.toLowerCase()
        return !excludeWords.some(w => title.includes(w.toLowerCase()))
      })
    }

    // Advanced: include industries (tags must contain at least one)
    if (includeIndustries.length > 0) {
      list = list.filter(j => {
        const hay = j.tags.join(' ').toLowerCase()
        return includeIndustries.some(w => hay.includes(w.toLowerCase()))
      })
    }

    // Advanced: exclude industries
    if (excludeIndustries.length > 0) {
      list = list.filter(j => {
        const hay = j.tags.join(' ').toLowerCase()
        return !excludeIndustries.some(w => hay.includes(w.toLowerCase()))
      })
    }

    // Advanced: minimum salary (parse "$120k" etc)
    if (minSalary.trim()) {
      const minNum = parseInt(minSalary.replace(/[^0-9]/g, ''), 10)
      if (!isNaN(minNum) && minNum > 0) {
        list = list.filter(j => {
          if (!j.salary) return true // show roles without salary info
          const nums = j.salary.match(/\d+/g)
          if (!nums) return true
          const parsed = nums.map(n => parseInt(n, 10))
          const top = Math.max(...parsed)
          const scaled = j.salary.toLowerCase().includes('k') ? top * 1000 : top
          return scaled >= minNum
        })
      }
    }

    // Advanced: visa sponsor
    if (visaSponsor === 'only') {
      list = list.filter(j => {
        const hay = (j.role + ' ' + j.tags.join(' ')).toLowerCase()
        return hay.includes('visa') || hay.includes('sponsor')
      })
    }

    // Search bar
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(j =>
        j.role.toLowerCase().includes(q) ||
        j.company.toLowerCase().includes(q) ||
        j.location?.toLowerCase().includes(q) ||
        j.tags.some(t => t.toLowerCase().includes(q))
      )
    }
    return list
  }, [jobs, dateFilter, expFilters, locSearch, workMode, includeWords, excludeWords, includeIndustries, excludeIndustries, minSalary, visaSponsor, search])

  const allSelected = filtered.length > 0 && filtered.every(j => selected.has(j.id))

  const toggleAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(filtered.map(j => j.id)))
  }

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Badge counts — show counts only when filter is active (non-default)
  const dateCount = dateFilter !== '7d' ? 1 : 0
  const expCount = expFilters.size
  const locCount = (locSearch.trim() ? 1 : 0) + workMode.size
  const advancedCount =
    includeWords.length +
    excludeWords.length +
    includeIndustries.length +
    excludeIndustries.length +
    (minSalary.trim() ? 1 : 0) +
    (visaSponsor !== 'all' ? 1 : 0)

  if (loading) {
    return (
      <div style={{ ...s.root, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>Loading jobs...</div>
      </div>
    )
  }

  return (
    <div style={s.root}>
      {/* ---- Toast ---- */}
      {toast ? (
        <div style={{
          ...s.toast,
          background:
            toast.type === 'success' ? 'rgba(52, 211, 153, 0.15)' :
            toast.type === 'error' ? 'rgba(239, 68, 68, 0.15)' :
            'rgba(52, 211, 153, 0.12)',
          borderColor: toast.type === 'error' ? '#ef4444' : '#34d399',
          color: toast.type === 'error' ? '#ef4444' : '#34d399',
        }}>
          {toast.type === 'info' ? (
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
          ) : null}
          <span>{toast.message}</span>
          {toast.type === 'success' ? <span>{'\u2713'}</span> : null}
          {toast.type !== 'info' ? (
            <button onClick={() => setToast(null)} style={s.toastClose}><X size={14} /></button>
          ) : null}
        </div>
      ) : null}

      {/* ---- Sample data banner ---- */}
      {isSampleData && (
        <div style={s.sampleBanner}>
          Sample jobs shown — run Autopilot to find real matches
        </div>
      )}

      {/* ---- Header ---- */}
      <div style={s.header} data-open-jobs-header>
        <div>
          <h1 style={s.greeting}>Hi {firstName}</h1>
          <p style={s.subtitle}>{filtered.length} jobs available</p>
        </div>
        <label style={s.selectAllLabel}>
          <input type="checkbox" checked={allSelected} onChange={toggleAll} style={s.checkbox} />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Select all</span>
        </label>
      </div>

      {/* ---- Search ---- */}
      <div style={s.filters} data-open-jobs-filters>
        <div style={s.searchWrap}>
          <Search size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search roles, companies..."
            style={s.searchInput}
          />
          {search && (
            <button onClick={() => setSearch('')} style={s.clearBtn}><X size={12} /></button>
          )}
        </div>

        {/* ---- Scout progress banner (visible only when a scout is in flight or just completed) ---- */}
        <ScoutProgressBanner />

        {/* ---- Other filters ---- */}
        <div style={s.otherFiltersHeader}>
          <div style={s.otherFiltersLabel}>Other filters</div>
          <button
            type="button"
            onClick={handleScanNow}
            disabled={scout.isRunning || !hasKeywords}
            title={
              !hasKeywords
                ? 'Set up keywords in Autopilot first'
                : scout.isRunning
                  ? `Scout is running · ${scout.percent}%`
                  : 'Scan all job boards for fresh matches now'
            }
            style={{
              ...s.scanBtn,
              opacity: (scout.isRunning || !hasKeywords) ? 0.6 : 1,
              cursor: (scout.isRunning || !hasKeywords) ? 'not-allowed' : 'pointer',
            }}
          >
            {scout.isRunning ? (
              <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <RefreshCw size={13} />
            )}
            <span>
              {scout.isRunning
                ? scout.jobsFound > 0
                  ? `Scouting · ${scout.jobsFound} found`
                  : 'Scouting...'
                : 'Find new jobs'}
            </span>
          </button>
        </div>
        <div style={s.filterRow} ref={popoverRef}>
          {/* Date Posted */}
          <div style={s.filterBtnWrap}>
            <button style={{ ...s.filterBtn, ...(dateCount > 0 ? s.filterBtnActive : {}) }} onClick={() => togglePopover('date')}>
              Date Posted
              {dateCount > 0 && <span style={s.badge}>{dateCount}</span>}
              <ChevronDown size={14} style={{ opacity: 0.5 }} />
            </button>
            {openPopover === 'date' && (
              <div style={s.popover}>
                <div style={s.popoverHeader}>
                  <div style={s.popoverTitleLg}>Date Posted</div>
                  <button style={s.popoverClose} onClick={() => setOpenPopover(null)} aria-label="Close"><X size={14} /></button>
                </div>
                <div style={s.popoverPills}>
                  {DATE_OPTIONS.map(opt => {
                    const active = dateFilter === opt.key
                    return (
                      <button key={opt.key} onClick={() => setDateFilter(opt.key)} style={{ ...s.pill, ...(active ? s.pillActive : {}) }}>
                        {active ? <Check size={12} style={{ marginRight: 4 }} /> : <Plus size={12} style={{ marginRight: 4, opacity: 0.6 }} />}
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Experience */}
          <div style={s.filterBtnWrap}>
            <button style={{ ...s.filterBtn, ...(expCount > 0 ? s.filterBtnActive : {}) }} onClick={() => togglePopover('exp')}>
              Experience
              {expCount > 0 && <span style={s.badge}>{expCount}</span>}
              <ChevronDown size={14} style={{ opacity: 0.5 }} />
            </button>
            {openPopover === 'exp' && (
              <div style={s.popover}>
                <div style={s.popoverHeader}>
                  <div style={s.popoverTitleLg}>Experience</div>
                  <button style={s.popoverClose} onClick={() => setOpenPopover(null)} aria-label="Close"><X size={14} /></button>
                </div>
                <div style={s.popoverPills}>
                  {EXP_OPTIONS.map(opt => {
                    const active = expFilters.has(opt.key)
                    return (
                      <button key={opt.key} onClick={() => toggleExp(opt.key)} style={{ ...s.pill, ...(active ? s.pillActive : {}) }}>
                        {active ? <Check size={12} style={{ marginRight: 4 }} /> : <Plus size={12} style={{ marginRight: 4, opacity: 0.6 }} />}
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Locations */}
          <div style={s.filterBtnWrap}>
            <button style={{ ...s.filterBtn, ...(locCount > 0 ? s.filterBtnActive : {}) }} onClick={() => togglePopover('loc')}>
              Locations
              {locCount > 0 && <span style={s.badge}>{locCount}</span>}
              <ChevronDown size={14} style={{ opacity: 0.5 }} />
            </button>
            {openPopover === 'loc' && (
              <div style={{ ...s.popover, minWidth: 300 }}>
                <div style={s.popoverHeader}>
                  <div style={s.popoverTitleLg}>
                    Locations <Info size={12} style={{ opacity: 0.5, marginLeft: 4, verticalAlign: 'middle' }} />
                  </div>
                  <button style={s.popoverClose} onClick={() => setOpenPopover(null)} aria-label="Close"><X size={14} /></button>
                </div>
                <div style={s.popoverSubtitle}>Choose up to {MAX_LOCATIONS} locations.</div>
                <input type="text" value={locSearch} onChange={e => setLocSearch(e.target.value)} placeholder="Enter a city, state, or country" style={s.locInput} />
                <div style={s.locCountryBox}>
                  <div style={s.locCountryTitle}>{DEFAULT_COUNTRY}</div>
                  <div style={s.locCheckRow}>
                    {WORK_MODE_OPTIONS.map(opt => (
                      <label key={opt.key} style={s.checkLabel}>
                        <input type="checkbox" checked={workMode.has(opt.key)} onChange={() => toggleWorkMode(opt.key)} style={s.checkbox} />
                        <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Advanced */}
          <div style={s.filterBtnWrap}>
            <button style={{ ...s.filterBtn, ...(advancedCount > 0 ? s.filterBtnActive : {}) }} onClick={() => { setOpenPopover(null); setAdvancedOpen(true) }}>
              <SlidersHorizontal size={13} style={{ marginRight: 2 }} />
              Advanced
              {advancedCount > 0 && <span style={s.badge}>{advancedCount}</span>}
            </button>
          </div>
        </div>
      </div>

      {/* ---- Grid ---- */}
      <div style={s.grid} data-open-jobs-grid>
        {filtered.map(job => {
          const isSelected = selected.has(job.id)
          return (
            <div
              key={job.id}
              style={{ ...s.card, ...(isSelected ? s.cardSelected : {}) }}
              onClick={() => setDetailJob(job)}
            >
              <div style={s.cardCheckbox} onClick={e => { e.stopPropagation(); toggleOne(job.id) }}>
                <input type="checkbox" checked={isSelected} onChange={() => toggleOne(job.id)} style={s.checkbox} />
              </div>
              <div style={s.cardBody}>
                <h3 style={s.role}>{job.role}</h3>
                <p style={s.company}>{job.company}</p>
                <div style={s.tags}>
                  {job.location && <span style={s.tag}><MapPin size={10} /> {job.location}</span>}
                  {job.tags.filter(t => t !== job.location).slice(0, 2).map(t => (
                    <span key={t} style={s.tag}>{t}</span>
                  ))}
                  {job.salary && <span style={s.tagSalary}>{job.salary}</span>}
                  {!job.link && <span style={s.tagSample} title="Sample job — run Autopilot to discover real jobs">Sample</span>}
                </div>
                <div style={s.time}><Clock size={11} /><span>Posted {timeAgo(job.postedAt)}</span></div>
              </div>
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div style={s.empty}>
            <Briefcase size={32} style={{ color: 'var(--text-tertiary)' }} />
            <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>No jobs match your filters</p>
          </div>
        )}
      </div>

      {/* ---- Selection bottom bar ---- */}
      {selected.size > 0 && !detailJob && (() => {
        const selectedJobs = jobs.filter(j => selected.has(j.id))
        const applyableCount = selectedJobs.filter(j => !!j.link).length
        const allSample = applyableCount === 0
        return (
          <div style={s.selectionBar} data-open-jobs-bar>
            <span style={s.selectionText}>{selected.size} job{selected.size > 1 ? 's' : ''} selected</span>
            <button
              style={{ ...s.selectionCta, ...(allSample ? s.selectionCtaDisabled : {}) }}
              onClick={() => handleApply(selected)}
              disabled={allSample}
              title={allSample ? 'Sample job — run Autopilot to discover real jobs' : undefined}
            >
              Apply to All Selected
            </button>
            <button style={s.selectionClose} onClick={() => setSelected(new Set())}>
              <X size={16} />
            </button>
          </div>
        )
      })()}

      {/* ---- Job Detail Panel ---- */}
      {detailJob && (
        <div style={s.panelOverlay} onClick={() => setDetailJob(null)}>
          <div style={s.panel} onClick={e => e.stopPropagation()}>
            <button style={s.panelClose} onClick={() => setDetailJob(null)}><X size={20} /></button>
            <h2 style={s.panelTitle}>{detailJob.company} | {detailJob.role}</h2>
            <div style={{ ...s.tags, marginBottom: 20 }}>
              {detailJob.location && <span style={s.tag}><MapPin size={10} /> {detailJob.location}</span>}
              {detailJob.tags.map(t => <span key={t} style={s.tag}>{t}</span>)}
              {detailJob.salary && <span style={s.tagSalary}>{detailJob.salary}</span>}
              {detailJob.link && (
                <a href={detailJob.link} target="_blank" rel="noopener noreferrer" style={s.tag}>View on Employer Site</a>
              )}
            </div>
            <div style={s.panelBody}>
              <h3 style={s.panelSection}>About the role</h3>
              <p style={s.panelText}>
                This is a {detailJob.role} position at {detailJob.company}.
                Full job description will be loaded from Supabase when connected to real data.
              </p>
              <h3 style={s.panelSection}>Responsibilities</h3>
              <ul style={s.panelList}>
                <li>Lead end-to-end product design for key features</li>
                <li>Collaborate with product managers and engineers</li>
                <li>Contribute to and evolve the design system</li>
                <li>Conduct user research and usability testing</li>
                <li>Present design decisions to stakeholders</li>
              </ul>
              <h3 style={s.panelSection}>Qualifications</h3>
              <ul style={s.panelList}>
                <li>5+ years of product design experience</li>
                <li>Strong portfolio demonstrating end-to-end design process</li>
                <li>Proficiency in Figma and prototyping tools</li>
                <li>Experience with design systems at scale</li>
              </ul>
            </div>
            <div style={s.panelCta}>
              <button
                style={{ ...s.ctaButton, ...(!detailJob.link ? s.ctaButtonDisabled : {}) }}
                data-open-jobs-cta
                onClick={() => handleApply(new Set([detailJob.id]))}
                disabled={!detailJob.link}
                title={!detailJob.link ? 'Sample job — run Autopilot to discover real jobs' : undefined}
              >
                {detailJob.link ? 'Apply for me' : 'Sample job — Apply disabled'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Advanced Modal ---- */}
      {advancedOpen && (
        <div style={s.modalOverlay} onClick={() => setAdvancedOpen(false)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h2 style={s.modalTitle}>Advanced</h2>
              <button style={s.modalClose} onClick={() => setAdvancedOpen(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <p style={s.modalSubtitle}>Use these filters to narrow your job results by title. Only change them if you want to be very specific.</p>

            <div style={s.modalBody}>
              <section style={s.modalSection}>
                <h3 style={s.modalSectionTitle}>Job Title Keywords</h3>
                <label style={s.modalLabel}>Include jobs with these words in the title</label>
                <ChipInput chips={includeWords} draft={includeWordDraft} setDraft={setIncludeWordDraft} onAdd={() => addChip(setIncludeWords, setIncludeWordDraft, includeWordDraft)} onRemove={v => removeChip(setIncludeWords, v)} placeholder="Add words to include..." />
                <p style={s.modalHelp}>Jack will show jobs with these words in the title.</p>
                <label style={{ ...s.modalLabel, marginTop: 16 }}>Exclude jobs with these words in the title</label>
                <ChipInput chips={excludeWords} draft={excludeWordDraft} setDraft={setExcludeWordDraft} onAdd={() => addChip(setExcludeWords, setExcludeWordDraft, excludeWordDraft)} onRemove={v => removeChip(setExcludeWords, v)} placeholder="Add words to exclude..." />
                <p style={s.modalHelp}>Jack will skip jobs with these words in the title.</p>
              </section>

              <section style={s.modalSection}>
                <h3 style={s.modalSectionTitle}>Industry</h3>
                <p style={s.modalHelp}>Choose which industries you want to include or exclude from your job results.</p>
                <label style={{ ...s.modalLabel, marginTop: 12 }}>Include jobs in these industries</label>
                <ChipInput chips={includeIndustries} draft={includeIndustryDraft} setDraft={setIncludeIndustryDraft} onAdd={() => addChip(setIncludeIndustries, setIncludeIndustryDraft, includeIndustryDraft)} onRemove={v => removeChip(setIncludeIndustries, v)} placeholder="Search industries to include..." />
                <label style={{ ...s.modalLabel, marginTop: 16 }}>Exclude jobs in these industries</label>
                <ChipInput chips={excludeIndustries} draft={excludeIndustryDraft} setDraft={setExcludeIndustryDraft} onAdd={() => addChip(setExcludeIndustries, setExcludeIndustryDraft, excludeIndustryDraft)} onRemove={v => removeChip(setExcludeIndustries, v)} placeholder="Search industries to exclude..." />
              </section>

              <section style={s.modalSection}>
                <h3 style={s.modalSectionTitle}>Salary</h3>
                <p style={s.modalHelp}>Filter by your preferred salary range. Roles without salary information will still be shown.</p>
                <label style={{ ...s.modalLabel, marginTop: 12 }}>Minimum</label>
                <div style={s.salaryInputWrap}>
                  <span style={s.salaryPrefix}>$</span>
                  <input type="text" inputMode="numeric" value={minSalary} onChange={e => setMinSalary(e.target.value)} placeholder="100,000" style={s.salaryInput} />
                </div>
              </section>

              <section style={s.modalSection}>
                <h3 style={s.modalSectionTitle}>Visa</h3>
                <p style={s.modalHelp}>Filter for roles that may offer visa sponsorship.</p>
                <label style={{ ...s.modalLabel, marginTop: 12 }}>Select one</label>
                <div style={s.radioGroup}>
                  <label style={s.radioLabel}>
                    <input type="radio" name="visa" checked={visaSponsor === 'only'} onChange={() => setVisaSponsor('only')} style={s.radio} />
                    <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>Only jobs that sponsor visas</span>
                  </label>
                  <label style={s.radioLabel}>
                    <input type="radio" name="visa" checked={visaSponsor === 'all'} onChange={() => setVisaSponsor('all')} style={s.radio} />
                    <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>All jobs</span>
                  </label>
                </div>
              </section>
            </div>

            <div style={s.modalFooter}>
              <button style={s.resetBtn} onClick={resetAdvanced}>Reset</button>
              <button style={s.showResultsBtn} onClick={() => setAdvancedOpen(false)}>Show Results</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Chip input (hoisted — avoids re-creation per render)               */
/* ------------------------------------------------------------------ */
interface ChipInputProps {
  chips: string[]
  draft: string
  setDraft: (v: string) => void
  onAdd: () => void
  onRemove: (v: string) => void
  placeholder: string
}

function ChipInput({ chips, draft, setDraft, onAdd, onRemove, placeholder }: ChipInputProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); onAdd() }
    else if (e.key === 'Backspace' && !draft && chips.length > 0) onRemove(chips[chips.length - 1])
  }
  return (
    <div style={s.chipInputWrap}>
      {chips.map(chip => (
        <span key={chip} style={s.chipItem}>
          {chip}
          <button type="button" onClick={() => onRemove(chip)} style={s.chipRemove} aria-label={`Remove ${chip}`}><X size={10} /></button>
        </span>
      ))}
      <input type="text" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={handleKeyDown} onBlur={onAdd} placeholder={chips.length === 0 ? placeholder : ''} style={s.chipInput} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */
const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', overflow: 'hidden' },
  toast: { position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', padding: '10px 20px', borderRadius: 10, border: '1px solid', fontSize: 14, fontWeight: 600, zIndex: 200, display: 'flex', alignItems: 'center', gap: 8 },
  toastClose: { display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, marginLeft: 4 },
  sampleBanner: { padding: '8px 24px', background: 'rgba(52, 211, 153, 0.1)', color: '#34d399', fontSize: 12, fontWeight: 600, textAlign: 'center', flexShrink: 0 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px 24px 0', flexShrink: 0 },
  greeting: { fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 },
  subtitle: { fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 },
  selectAllLabel: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' },
  checkbox: { width: 16, height: 16, accentColor: '#34d399', cursor: 'pointer' },
  filters: { padding: '16px 24px 0', display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0 },
  searchWrap: { display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px' },
  searchInput: { flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 13 },
  clearBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 10, background: 'var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', border: 'none', flexShrink: 0 },
  filterRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  filterBtnWrap: { position: 'relative' },
  filterBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 22, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s', whiteSpace: 'nowrap' },
  filterBtnActive: { borderColor: '#34d399', color: 'var(--text-primary)', background: 'rgba(52, 211, 153, 0.08)' },
  otherFiltersLabel: { fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' },
  otherFiltersHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 4 },
  scanBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, border: '1px solid rgba(52, 211, 153, 0.4)', background: 'rgba(52, 211, 153, 0.1)', color: '#34d399', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', transition: 'all 0.15s', whiteSpace: 'nowrap' },
  badge: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, borderRadius: 9, background: '#34d399', color: '#000', fontSize: 10, fontWeight: 700, padding: '0 5px' },
  popover: { position: 'absolute', top: 'calc(100% + 8px)', left: 0, minWidth: 260, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.4)', zIndex: 60 },
  popoverTitle: { fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 },
  popoverHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  popoverTitleLg: { fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' },
  popoverClose: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 11, border: 'none', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', cursor: 'pointer', padding: 0 },
  popoverSubtitle: { fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 10 },
  locCountryBox: { marginTop: 12, padding: 12, borderRadius: 10, background: 'rgba(52, 211, 153, 0.08)', border: '1px solid rgba(52, 211, 153, 0.25)' },
  locCountryTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 },
  locCheckRow: { display: 'flex', flexDirection: 'column', gap: 8 },
  popoverPills: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  pill: { display: 'inline-flex', alignItems: 'center', padding: '6px 14px', borderRadius: 20, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s', whiteSpace: 'nowrap' },
  pillActive: { background: '#34d399', color: '#000', borderColor: '#34d399', fontWeight: 600 },
  locInput: { width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' },
  checkLabel: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, padding: '20px 24px 100px', overflowY: 'auto', flex: 1 },
  card: { position: 'relative', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 20px 16px', cursor: 'pointer', transition: 'border-color 0.15s, box-shadow 0.15s' },
  cardSelected: { borderColor: '#34d399', boxShadow: '0 0 0 1px rgba(52, 211, 153, 0.25)' },
  cardCheckbox: { position: 'absolute', top: 16, right: 16, zIndex: 1 },
  cardBody: { display: 'flex', flexDirection: 'column', gap: 6 },
  role: { fontSize: 15, fontWeight: 650, color: 'var(--text-primary)', margin: 0, paddingRight: 28, lineHeight: 1.3 },
  company: { fontSize: 13, color: 'var(--text-tertiary)', margin: 0 },
  tags: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  tag: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, background: 'var(--bg-elevated)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap' },
  tagSalary: { display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 20, background: 'rgba(52, 211, 153, 0.1)', color: '#34d399', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' },
  tagSample: { display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 20, background: 'rgba(255,255,255,0.06)', color: 'var(--text-tertiary)', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', border: '1px dashed var(--border)', cursor: 'help' },
  time: { display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 11, color: 'var(--text-tertiary)' },
  empty: { gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '60px 0' },
  selectionBar: { position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px 14px 24px', background: '#1c1c1e', borderRadius: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.5)', zIndex: 50 },
  selectionText: { color: '#fff', fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap' },
  selectionCta: { padding: '10px 24px', borderRadius: 12, border: 'none', background: '#34d399', color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' },
  selectionCtaDisabled: { background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.4)', cursor: 'not-allowed' },
  selectionClose: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 14, border: 'none', background: 'rgba(255,255,255,0.1)', color: '#999', cursor: 'pointer', flexShrink: 0 },
  panelOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', justifyContent: 'center', overflowY: 'auto', padding: '40px 20px' },
  panel: { position: 'relative', width: '100%', maxWidth: 800, background: 'var(--bg-surface)', borderRadius: 16, padding: '32px 40px 100px', alignSelf: 'flex-start', minHeight: 400 },
  panelClose: { position: 'absolute', top: 16, left: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 16, border: 'none', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', cursor: 'pointer' },
  panelTitle: { fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 16px', paddingTop: 8 },
  panelBody: { color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.7 },
  panelSection: { fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '24px 0 8px' },
  panelText: { margin: '0 0 8px' },
  panelList: { margin: '0 0 8px', paddingLeft: 20 },
  panelCta: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: '20px 40px', display: 'flex', justifyContent: 'flex-end', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', borderRadius: '0 0 16px 16px' },
  ctaButton: { padding: '14px 32px', borderRadius: 14, border: 'none', background: '#34d399', color: '#000', fontSize: 15, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 24px rgba(52, 211, 153, 0.3)', transition: 'transform 0.1s, box-shadow 0.15s', fontFamily: 'inherit' },
  ctaButtonDisabled: { background: 'rgba(255,255,255,0.08)', color: 'var(--text-tertiary)', boxShadow: 'none', cursor: 'not-allowed' },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 150, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', overflowY: 'auto', padding: '40px 20px' },
  modal: { position: 'relative', width: '100%', maxWidth: 720, background: 'var(--bg-surface)', borderRadius: 18, padding: '28px 32px 100px', border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' },
  modalHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  modalTitle: { fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 },
  modalClose: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 16, border: 'none', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', cursor: 'pointer' },
  modalSubtitle: { fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.5, margin: '0 0 24px' },
  modalBody: { display: 'flex', flexDirection: 'column', gap: 28 },
  modalSection: { display: 'flex', flexDirection: 'column' },
  modalSectionTitle: { fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 10px' },
  modalLabel: { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 },
  modalHelp: { fontSize: 12, color: 'var(--text-tertiary)', margin: '6px 0 0', lineHeight: 1.5 },
  chipInputWrap: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '8px 10px', minHeight: 40, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-elevated)' },
  chipItem: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 4px 4px 10px', borderRadius: 16, background: '#34d399', color: '#000', fontSize: 12, fontWeight: 600 },
  chipRemove: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: 8, border: 'none', background: 'rgba(0,0,0,0.2)', color: '#000', cursor: 'pointer', padding: 0 },
  chipInput: { flex: 1, minWidth: 120, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit', padding: '4px 2px' },
  salaryInputWrap: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-elevated)', maxWidth: 240 },
  salaryPrefix: { color: 'var(--text-tertiary)', fontSize: 14, fontWeight: 600 },
  salaryInput: { flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit' },
  radioGroup: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 },
  radioLabel: { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' },
  radio: { width: 16, height: 16, accentColor: '#34d399', cursor: 'pointer' },
  modalFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: '16px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', borderRadius: '0 0 18px 18px' },
  resetBtn: { padding: '10px 20px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  showResultsBtn: { padding: '12px 28px', borderRadius: 10, border: 'none', background: '#000', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' },
}

/* ---- Responsive CSS injected once ---- */
if (typeof document !== 'undefined') {
  const id = 'open-jobs-responsive'
  if (!document.getElementById(id)) {
    const style = document.createElement('style')
    style.id = id
    style.textContent = `
      [data-open-jobs-grid] > div:hover {
        border-color: var(--border-hover) !important;
      }
      [data-open-jobs-cta]:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 32px rgba(52, 211, 153, 0.4) !important;
      }
      @media (max-width: 1024px) {
        [data-open-jobs-grid] {
          grid-template-columns: repeat(2, 1fr) !important;
        }
      }
      @media (max-width: 640px) {
        [data-open-jobs-grid] {
          grid-template-columns: 1fr !important;
          padding: 16px 16px 100px !important;
        }
        [data-open-jobs-header] {
          padding: 16px 16px 0 !important;
        }
        [data-open-jobs-filters] {
          padding: 12px 16px 0 !important;
        }
      }
    `
    document.head.appendChild(style)
  }
}
