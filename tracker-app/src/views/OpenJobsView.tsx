import { useState, useMemo } from 'react'
import { Briefcase, MapPin, Clock, Search, X } from 'lucide-react'

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
/*  Sample data (replace with Supabase query later)                    */
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

const TITLE_CHIPS = ['All', 'Product Designer', 'UX Designer', 'Lead', 'Staff', 'Principal']

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export function OpenJobsView() {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [titleFilter, setTitleFilter] = useState('All')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const firstName = 'Florian'

  // Filter jobs
  const filtered = useMemo(() => {
    let list = SAMPLE_JOBS
    if (titleFilter !== 'All') {
      list = list.filter(j => j.role.toLowerCase().includes(titleFilter.toLowerCase()))
    }
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
  }, [titleFilter, search])

  const allSelected = filtered.length > 0 && filtered.every(j => selected.has(j.id))

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map(j => j.id)))
    }
  }

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div style={s.root}>
      {/* ---- Header ---- */}
      <div style={s.header} data-open-jobs-header>
        <div>
          <h1 style={s.greeting}>Hi {firstName}</h1>
          <p style={s.subtitle}>{filtered.length} jobs available</p>
        </div>
        <label style={s.selectAllLabel}>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            style={s.checkbox}
          />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Select all</span>
        </label>
      </div>

      {/* ---- Filters ---- */}
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
            <button onClick={() => setSearch('')} style={s.clearBtn}>
              <X size={12} />
            </button>
          )}
        </div>
        <div style={s.chips}>
          {TITLE_CHIPS.map(chip => (
            <button
              key={chip}
              onClick={() => setTitleFilter(chip)}
              style={{
                ...s.chip,
                ...(titleFilter === chip ? s.chipActive : {}),
              }}
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      {/* ---- Grid ---- */}
      <div style={s.grid} data-open-jobs-grid>
        {filtered.map(job => {
          const isSelected = selected.has(job.id)
          const isExpanded = expandedId === job.id
          return (
            <div
              key={job.id}
              style={{
                ...s.card,
                ...(isSelected ? s.cardSelected : {}),
              }}
              onClick={() => setExpandedId(isExpanded ? null : job.id)}
            >
              {/* Checkbox */}
              <div
                style={s.cardCheckbox}
                onClick={e => { e.stopPropagation(); toggleOne(job.id) }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleOne(job.id)}
                  style={s.checkbox}
                />
              </div>

              {/* Content */}
              <div style={s.cardBody}>
                <h3 style={s.role}>{job.role}</h3>
                <p style={s.company}>{job.company}</p>

                {/* Tags */}
                <div style={s.tags}>
                  {job.location && (
                    <span style={s.tag}>
                      <MapPin size={10} /> {job.location}
                    </span>
                  )}
                  {job.tags.filter(t => t !== job.location).slice(0, 2).map(t => (
                    <span key={t} style={s.tag}>{t}</span>
                  ))}
                  {job.salary && (
                    <span style={s.tagSalary}>{job.salary}</span>
                  )}
                </div>

                {/* Time */}
                <div style={s.time}>
                  <Clock size={11} />
                  <span>Posted {timeAgo(job.postedAt)}</span>
                </div>

                {/* Expanded area */}
                {isExpanded && (
                  <div style={s.expanded}>
                    <p style={s.expandedText}>
                      Full job description will load here from Supabase.
                      For now this is a placeholder showing the expanded card state.
                    </p>
                    {job.link && (
                      <a href={job.link} target="_blank" rel="noopener noreferrer" style={s.viewLink}>
                        View original posting
                      </a>
                    )}
                  </div>
                )}
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

      {/* ---- Sticky CTA ---- */}
      {selected.size > 0 && (
        <div style={s.stickyBar}>
          <button style={s.ctaButton} data-open-jobs-cta>
            Apply for me ({selected.size} selected)
          </button>
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
  chips: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
  },
  chip: {
    padding: '5px 14px',
    borderRadius: 20,
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s',
    fontFamily: 'inherit',
  },
  chipActive: {
    background: '#F5C518',
    color: '#000',
    borderColor: '#F5C518',
    fontWeight: 600,
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
  expanded: {
    marginTop: 12,
    paddingTop: 12,
    borderTop: '1px solid var(--border)',
  },
  expandedText: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    lineHeight: 1.6,
    margin: 0,
  },
  viewLink: {
    display: 'inline-block',
    marginTop: 8,
    fontSize: 12,
    color: '#F5C518',
    fontWeight: 500,
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
  stickyBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: '16px 24px',
    background: 'linear-gradient(transparent, var(--bg-base) 30%)',
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none',
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
    pointerEvents: 'auto',
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
      /* Card hover */
      [data-open-jobs-grid] > div:hover {
        border-color: var(--border-hover) !important;
      }
      /* CTA hover */
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
