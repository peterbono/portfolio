import { useState, useEffect, useRef, useMemo } from 'react'
import { Search, X } from 'lucide-react'

interface SearchBarProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  companyFilter: string
  onCompanyChange: (company: string) => void
  companies: string[]
}

export function SearchBar({
  searchQuery,
  onSearchChange,
  companyFilter,
  onCompanyChange,
  companies,
}: SearchBarProps) {
  const [localSearch, setLocalSearch] = useState(searchQuery)
  const timerRef = useRef<number | undefined>(undefined)

  const [companyInput, setCompanyInput] = useState(companyFilter)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const suggestRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => onSearchChange(localSearch), 300)
    return () => clearTimeout(timerRef.current)
  }, [localSearch]) // eslint-disable-line

  const suggestions = useMemo(() => {
    if (!companyInput.trim()) return []
    const q = companyInput.toLowerCase().trim()
    return companies.filter((c) => c.toLowerCase().includes(q)).slice(0, 8)
  }, [companyInput, companies])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (suggestRef.current && !suggestRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => { setCompanyInput(companyFilter) }, [companyFilter])

  const selectCompany = (company: string) => {
    setCompanyInput(company)
    onCompanyChange(company)
    setShowSuggestions(false)
  }

  const clearCompany = () => {
    setCompanyInput('')
    onCompanyChange('')
    setShowSuggestions(false)
  }

  return (
    <div style={styles.row}>
      {/* Search input */}
      <div style={styles.searchWrapper}>
        <Search size={14} color="var(--text-tertiary)" style={styles.searchIcon} />
        <input
          type="text"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder="Search by company, role, ATS..."
          style={styles.searchInput}
        />
      </div>

      {/* Company autocomplete */}
      <div style={{ ...styles.selectWrapper, position: 'relative' }} ref={suggestRef}>
        <input
          ref={inputRef}
          type="text"
          value={companyInput}
          onChange={(e) => {
            setCompanyInput(e.target.value)
            setShowSuggestions(true)
            if (!e.target.value.trim()) onCompanyChange('')
          }}
          onFocus={() => companyInput.trim() && setShowSuggestions(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setShowSuggestions(false); inputRef.current?.blur() }
            if (e.key === 'Enter' && suggestions.length) { selectCompany(suggestions[0]); e.preventDefault() }
          }}
          placeholder="Filter company..."
          style={{ ...styles.select, paddingRight: companyFilter ? 28 : 10, minWidth: 160 }}
        />
        {companyFilter && (
          <button onClick={clearCompany} style={styles.clearBtn} title="Clear company filter">
            <X size={12} />
          </button>
        )}
        {showSuggestions && suggestions.length > 0 && (
          <div style={styles.dropdown}>
            {suggestions.map((c) => (
              <div key={c} style={styles.suggestion} onMouseDown={() => selectCompany(c)}>
                {highlightMatch(c, companyInput)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function highlightMatch(text: string, query: string) {
  if (!query.trim()) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase().trim())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <strong style={{ color: 'var(--accent)' }}>{text.slice(idx, idx + query.trim().length)}</strong>
      {text.slice(idx + query.trim().length)}
    </>
  )
}

const styles: Record<string, React.CSSProperties> = {
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  searchWrapper: {
    position: 'relative',
    flex: '1 1 240px',
    minWidth: 200,
  },
  searchIcon: {
    position: 'absolute',
    left: 10,
    top: '50%',
    transform: 'translateY(-50%)',
    pointerEvents: 'none',
  },
  searchInput: {
    width: '100%',
    padding: '8px 10px 8px 32px',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-primary)',
    fontSize: 13,
    outline: 'none',
  },
  selectWrapper: {
    position: 'relative',
    flex: '0 0 auto',
  },
  select: {
    appearance: 'none',
    padding: '8px 28px 8px 10px',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-primary)',
    fontSize: 13,
    cursor: 'pointer',
    minWidth: 120,
  },
  clearBtn: {
    position: 'absolute',
    right: 6,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    color: 'var(--text-tertiary)',
    cursor: 'pointer',
    padding: 2,
    display: 'flex',
    alignItems: 'center',
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
    maxHeight: 240,
    overflowY: 'auto',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  suggestion: {
    padding: '8px 12px',
    fontSize: 13,
    color: 'var(--text-primary)',
    cursor: 'pointer',
    borderBottom: '1px solid var(--border)',
  },
}
