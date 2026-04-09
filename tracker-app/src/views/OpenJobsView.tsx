import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { Briefcase, MapPin, Clock, Search, X, ChevronDown, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'

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
const DATE_OPTIONS: { key: string; label: string; ms: number }[] = [
  { key: 'past24h', label: 'Past 24 Hours', ms: 24 * 3600_000 },
  { key: 'past3d', label: 'Past 3 Days', ms: 3 * 86400_000 },
  { key: 'past7d', label: 'Past 7 Days', ms: 7 * 86400_000 },
  { key: 'pastMonth', label: 'Past Month', ms: 30 * 86400_000 },
  { key: 'all', label: 'All Time', ms: Infinity },
]

const EXP_OPTIONS = [
  { key: 'entry', label: 'Entry (1-2 years)' },
  { key: 'mid', label: 'Mid (3-5 years)' },
  { key: 'senior', label: 'Senior (5+ years)' },
]

const WORK_MODE_OPTIONS = [
  { key: 'remote', label: 'Remote' },
  { key: 'hybrid', label: 'Hybrid' },
  { key: 'inoffice', label: 'In office' },
]

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
  const [dateFilter, setDateFilter] = useState<string>('all')
  const [expFilters, setExpFilters] = useState<Set<string>>(new Set())
  const [locSearch, setLocSearch] = useState('')
  const [workMode, setWorkMode] = useState<Set<string>>(new Set(['remote']))
  const [openPopover, setOpenPopover] = useState<string | null>(null)

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Refs for click-outside
  const popoverRef = useRef<HTMLDivElement>(null)

  // Fetch jobs from Supabase
  useEffect(() => {
    async function fetchJobs() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setJobs(SAMPLE_JOBS)
          setIsSampleData(true)
          setLoading(false)
          return
        }

        const { data } = await supabase
          .from('job_listings')
          .select('*')
          .eq('user_id', user.id)
          .gte('qualification_score', 50)
          .order('created_at', { ascending: false })
          .limit(50)

        if (data && data.length > 0) {
          setJobs(data.map((row: Record<string, unknown>) => ({
            id: row.id as string,
            role: (row.title as string) || 'Unknown Role',
            company: (row.company as string) || 'Unknown',
            location: row.location as string | null,
            salary: row.salary_range as string | null,
            tags: [row.location, row.ats, row.work_arrangement].filter(Boolean) as string[],
            postedAt: row.created_at as string,
            link: row.link as string | null,
          })))
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
    }
    fetchJobs()
  }, [])

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  // Click outside to close popover
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (openPopover && popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpenPopover(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [openPopover])

  // Toggle popover
  const togglePopover = (key: string) => {
    setOpenPopover(prev => prev === key ? null : key)
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

      const selectedJobs = jobs
        .filter(j => jobIds.has(j.id))
        .map(j => ({
          url: j.link,
          company: j.company,
          role: j.role,
          coverLetterSnippet: '',
          matchScore: 75,
        }))

      const res = await fetch('/api/queue-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobs: selectedJobs, userId: user.id }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      setToast({ message: `${selectedJobs.length} job${selectedJobs.length > 1 ? 's' : ''} queued for cloud apply`, type: 'success' })
      setSelected(new Set())
      setDetailJob(null)
    } catch {
      setToast({ message: 'Failed to queue jobs. Try again.', type: 'error' })
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
        return workMode.size === 0
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
  }, [jobs, dateFilter, locSearch, workMode, search])

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

  // Badge counts
  const dateCount = dateFilter !== 'all' ? 1 : 0
  const expCount = expFilters.size
  const locCount = (locSearch.trim() ? 1 : 0) + (workMode.size > 0 ? workMode.size : 0)

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
      {toast && (
        <div style={{
          ...s.toast,
          background: toast.type === 'success' ? 'rgba(52, 211, 153, 0.15)' : 'rgba(239, 68, 68, 0.15)',
          borderColor: toast.type === 'success' ? '#34d399' : '#ef4444',
          color: toast.type === 'success' ? '#34d399' : '#ef4444',
        }}>
          {toast.message} {toast.type === 'success' && '\u2713'}
          <button onClick={() => setToast(null)} style={s.toastClose}><X size={14} /></button>
        </div>
      )}

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

        {/* ---- Filter dropdowns row ---- */}
        <div style={s.filterRow} ref={popoverRef}>
          {/* Date Posted */}
          <div style={s.filterBtnWrap}>
            <button style={s.filterBtn} onClick={() => togglePopover('date')}>
              Date Posted
              {dateCount > 0 && <span style={s.badge}>{dateCount}</span>}
              <ChevronDown size={14} style={{ opacity: 0.5 }} />
            </button>
            {openPopover === 'date' && (
              <div style={s.popover}>
                <div style={s.popoverTitle}>Date Posted</div>
                <div style={s.popoverPills}>
                  {DATE_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => setDateFilter(opt.key)}
                      style={{
                        ...s.pill,
                        ...(dateFilter === opt.key ? s.pillActive : {}),
                      }}
                    >
                      {dateFilter === opt.key && <Check size={12} style={{ marginRight: 4 }} />}
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Experience */}
          <div style={s.filterBtnWrap}>
            <button style={s.filterBtn} onClick={() => togglePopover('exp')}>
              Experience
              {expCount > 0 && <span style={s.badge}>{expCount}</span>}
              <ChevronDown size={14} style={{ opacity: 0.5 }} />
            </button>
            {openPopover === 'exp' && (
              <div style={s.popover}>
                <div style={s.popoverTitle}>Experience Level</div>
                <div style={s.popoverPills}>
                  {EXP_OPTIONS.map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => toggleExp(opt.key)}
                      style={{
                        ...s.pill,
                        ...(expFilters.has(opt.key) ? s.pillActive : {}),
                      }}
                    >
                      {expFilters.has(opt.key) && <Check size={12} style={{ marginRight: 4 }} />}
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Locations */}
          <div style={s.filterBtnWrap}>
            <button style={s.filterBtn} onClick={() => togglePopover('loc')}>
              Locations
              {locCount > 0 && <span style={s.badge}>{locCount}</span>}
              <ChevronDown size={14} style={{ opacity: 0.5 }} />
            </button>
            {openPopover === 'loc' && (
              <div style={{ ...s.popover, minWidth: 260 }}>
                <div style={s.popoverTitle}>Location</div>
                <input
                  type="text"
                  value={locSearch}
                  onChange={e => setLocSearch(e.target.value)}
                  placeholder="Enter a city, state, or country"
                  style={s.locInput}
                  autoFocus
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                  {WORK_MODE_OPTIONS.map(opt => (
                    <label key={opt.key} style={s.checkLabel}>
                      <input
                        type="checkbox"
                        checked={workMode.has(opt.key)}
                        onChange={() => toggleWorkMode(opt.key)}
                        style={s.checkbox}
                      />
                      <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
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
      {selected.size > 0 && !detailJob && (
        <div style={s.selectionBar} data-open-jobs-bar>
          <span style={s.selectionText}>{selected.size} job{selected.size > 1 ? 's' : ''} selected</span>
          <button style={s.selectionCta} onClick={() => handleApply(selected)}>
            Apply to All Selected
          </button>
          <button style={s.selectionClose} onClick={() => setSelected(new Set())}>
            <X size={16} />
          </button>
        </div>
      )}

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
                style={s.ctaButton}
                data-open-jobs-cta
                onClick={() => handleApply(new Set([detailJob.id]))}
              >
                Apply for me
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */
const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  toast: {
    position: 'fixed',
    top: 16,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '10px 20px',
    borderRadius: 10,
    border: '1px solid',
    fontSize: 14,
    fontWeight: 600,
    zIndex: 200,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  toastClose: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    color: 'inherit',
    cursor: 'pointer',
    padding: 0,
    marginLeft: 4,
  },
  sampleBanner: {
    padding: '8px 24px',
    background: 'rgba(245, 197, 24, 0.1)',
    color: '#F5C518',
    fontSize: 12,
    fontWeight: 600,
    textAlign: 'center',
    flexShrink: 0,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '24px 24px 0',
    flexShrink: 0,
  },
  greeting: {
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--text-primary)',
    margin: 0,
  },
  subtitle: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
    marginTop: 2,
  },
  selectAllLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
  },
  checkbox: {
    width: 16,
    height: 16,
    accentColor: '#F5C518',
    cursor: 'pointer',
  },
  filters: {
    padding: '16px 24px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    flexShrink: 0,
  },
  searchWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '8px 12px',
  },
  searchInput: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'var(--text-primary)',
    fontSize: 13,
  },
  clearBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    borderRadius: 10,
    background: 'var(--border)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    border: 'none',
    flexShrink: 0,
  },
  filterRow: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
  },
  filterBtnWrap: {
    position: 'relative',
  },
  filterBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 14px',
    borderRadius: 20,
    border: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    color: 'var(--text-secondary)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    background: '#34d399',
    color: '#000',
    fontSize: 10,
    fontWeight: 700,
    padding: '0 5px',
  },
  popover: {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    left: 0,
    minWidth: 220,
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 16,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    zIndex: 60,
  },
  popoverTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-tertiary)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: 10,
  },
  popoverPills: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '5px 14px',
    borderRadius: 20,
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  },
  pillActive: {
    background: '#F5C518',
    color: '#000',
    borderColor: '#F5C518',
    fontWeight: 600,
  },
  locInput: {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 16,
    padding: '20px 24px 100px',
    overflowY: 'auto',
    flex: 1,
  },
  card: {
    position: 'relative',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    padding: '20px 20px 16px',
    cursor: 'pointer',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  },
  cardSelected: {
    borderColor: '#F5C518',
    boxShadow: '0 0 0 1px rgba(245, 197, 24, 0.25)',
  },
  cardCheckbox: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 1,
  },
  cardBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  role: {
    fontSize: 15,
    fontWeight: 650,
    color: 'var(--text-primary)',
    margin: 0,
    paddingRight: 28,
    lineHeight: 1.3,
  },
  company: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
    margin: 0,
  },
  tags: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  tag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 10px',
    borderRadius: 20,
    background: 'var(--bg-elevated)',
    color: 'var(--text-secondary)',
    fontSize: 11,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  tagSalary: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 10px',
    borderRadius: 20,
    background: 'rgba(52, 211, 153, 0.1)',
    color: '#34d399',
    fontSize: 11,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  time: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    fontSize: 11,
    color: 'var(--text-tertiary)',
  },
  empty: {
    gridColumn: '1 / -1',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: '60px 0',
  },
  selectionBar: {
    position: 'absolute',
    bottom: 24,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '14px 20px 14px 24px',
    background: '#1c1c1e',
    borderRadius: 16,
    boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
    zIndex: 50,
  },
  selectionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  selectionCta: {
    padding: '10px 24px',
    borderRadius: 12,
    border: 'none',
    background: '#F5C518',
    color: '#000',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  selectionClose: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: 14,
    border: 'none',
    background: 'rgba(255,255,255,0.1)',
    color: '#999',
    cursor: 'pointer',
    flexShrink: 0,
  },
  panelOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    zIndex: 100,
    display: 'flex',
    justifyContent: 'center',
    overflowY: 'auto',
    padding: '40px 20px',
  },
  panel: {
    position: 'relative',
    width: '100%',
    maxWidth: 800,
    background: 'var(--bg-surface)',
    borderRadius: 16,
    padding: '32px 40px 100px',
    alignSelf: 'flex-start',
    minHeight: 400,
  },
  panelClose: {
    position: 'absolute',
    top: 16,
    left: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 16,
    border: 'none',
    background: 'var(--bg-elevated)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
  },
  panelTitle: {
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--text-primary)',
    margin: '0 0 16px',
    paddingTop: 8,
  },
  panelBody: {
    color: 'var(--text-secondary)',
    fontSize: 14,
    lineHeight: 1.7,
  },
  panelSection: {
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--text-primary)',
    margin: '24px 0 8px',
  },
  panelText: {
    margin: '0 0 8px',
  },
  panelList: {
    margin: '0 0 8px',
    paddingLeft: 20,
  },
  panelCta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: '20px 40px',
    display: 'flex',
    justifyContent: 'flex-end',
    background: 'var(--bg-surface)',
    borderTop: '1px solid var(--border)',
    borderRadius: '0 0 16px 16px',
  },
  ctaButton: {
    padding: '14px 32px',
    borderRadius: 14,
    border: 'none',
    background: '#F5C518',
    color: '#000',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 4px 24px rgba(245, 197, 24, 0.3)',
    transition: 'transform 0.1s, box-shadow 0.15s',
    fontFamily: 'inherit',
  },
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
        box-shadow: 0 6px 32px rgba(245, 197, 24, 0.4) !important;
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
