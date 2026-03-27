import { useState, useCallback, useEffect, useRef } from 'react'
import { X, Loader2 } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ClearbitCompany {
  name: string
  domain: string
  logo: string
}

// ---------------------------------------------------------------------------
// Clearbit autocomplete hook (free, no key needed) — with localStorage cache
// ---------------------------------------------------------------------------

const CLEARBIT_CACHE_KEY = 'tracker_v2_clearbit_cache'
const CLEARBIT_CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

function getCachedClearbit(query: string): ClearbitCompany[] | null {
  try {
    const raw = localStorage.getItem(CLEARBIT_CACHE_KEY)
    if (!raw) return null
    const cache: Record<string, { data: ClearbitCompany[]; ts: number }> = JSON.parse(raw)
    const entry = cache[query.toLowerCase()]
    if (entry && Date.now() - entry.ts < CLEARBIT_CACHE_TTL) return entry.data
    return null
  } catch { return null }
}

function setCachedClearbit(query: string, data: ClearbitCompany[]): void {
  try {
    const raw = localStorage.getItem(CLEARBIT_CACHE_KEY)
    const cache: Record<string, { data: ClearbitCompany[]; ts: number }> = raw ? JSON.parse(raw) : {}
    cache[query.toLowerCase()] = { data, ts: Date.now() }
    // Prune to max 200 entries
    const keys = Object.keys(cache)
    if (keys.length > 200) {
      const sorted = keys.sort((a, b) => cache[a].ts - cache[b].ts)
      for (let i = 0; i < keys.length - 200; i++) delete cache[sorted[i]]
    }
    localStorage.setItem(CLEARBIT_CACHE_KEY, JSON.stringify(cache))
  } catch { /* ignore */ }
}

function useClearbitAutocomplete() {
  const [results, setResults] = useState<ClearbitCompany[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [noResults, setNoResults] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const search = useCallback((query: string) => {
    // Clear previous
    if (timerRef.current) clearTimeout(timerRef.current)
    if (abortRef.current) abortRef.current.abort()

    if (query.length < 2) {
      setResults([])
      setIsLoading(false)
      setNoResults(false)
      return
    }

    // Check cache first
    const cached = getCachedClearbit(query)
    if (cached) {
      setResults(cached)
      setNoResults(cached.length === 0)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setNoResults(false)

    // Debounce 300ms
    timerRef.current = setTimeout(async () => {
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const res = await fetch(
          `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        )
        if (!res.ok) throw new Error('API error')
        const data: ClearbitCompany[] = await res.json()
        const sliced = data.slice(0, 6)
        setCachedClearbit(query, sliced)
        setResults(sliced)
        setNoResults(sliced.length === 0)
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        // On any error, allow free-form entry
        setResults([])
        setNoResults(false)
      } finally {
        setIsLoading(false)
      }
    }, 300)
  }, [])

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (abortRef.current) abortRef.current.abort()
    setResults([])
    setIsLoading(false)
    setNoResults(false)
  }, [])

  return { results, isLoading, noResults, search, clear }
}

// ---------------------------------------------------------------------------
// CompanyChipInput component
// ---------------------------------------------------------------------------
export default function CompanyChipInput({
  chips,
  onAdd,
  onRemove,
  placeholder = 'Type company name...',
}: {
  chips: string[]
  onAdd: (value: string) => void
  onRemove: (index: number) => void
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { results, isLoading, noResults, search, clear } = useClearbitAutocomplete()

  // Filter out already-added companies
  const filtered = results.filter((c) => !chips.includes(c.name))

  const addChip = useCallback(
    (value: string) => {
      const trimmed = value.trim()
      if (trimmed && !chips.includes(trimmed)) {
        onAdd(trimmed)
      }
      setQuery('')
      setShowDropdown(false)
      setHighlightIdx(-1)
      clear()
    },
    [chips, onAdd, clear]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (highlightIdx >= 0 && filtered[highlightIdx]) {
          addChip(filtered[highlightIdx].name)
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
      setHighlightIdx(-1)
      if (val.length >= 2) {
        setShowDropdown(true)
        search(val)
      } else {
        setShowDropdown(false)
        clear()
      }
    },
    [addChip, search, clear]
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
    <div ref={wrapperRef} style={ccStyles.wrapper}>
      <div
        style={ccStyles.inputArea}
        onClick={() => inputRef.current?.focus()}
      >
        {chips.map((chip, i) => (
          <span key={`${chip}-${i}`} style={ccStyles.chip}>
            <span style={ccStyles.chipText}>{chip}</span>
            <button
              type="button"
              style={ccStyles.chipRemove}
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
        <div style={ccStyles.inputWrap}>
          <input
            ref={inputRef}
            style={ccStyles.chipInput}
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (query.length >= 2) setShowDropdown(true)
            }}
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
        <div style={ccStyles.dropdown}>
          {isLoading && filtered.length === 0 && (
            <div style={ccStyles.dropdownLoading}>
              <Loader2
                size={12}
                color="var(--text-tertiary)"
                style={{ animation: 'spin 1s linear infinite' }}
              />
              <span>Searching...</span>
            </div>
          )}
          {noResults && !isLoading && filtered.length === 0 && (
            <div style={ccStyles.dropdownEmpty}>
              No results — press Enter to add custom
            </div>
          )}
          {filtered.map((company, idx) => (
            <div
              key={company.domain}
              style={{
                ...ccStyles.dropdownItem,
                ...(idx === highlightIdx ? ccStyles.dropdownItemHighlight : {}),
              }}
              onMouseEnter={() => setHighlightIdx(idx)}
              onMouseDown={(e) => {
                e.preventDefault()
                addChip(company.name)
              }}
            >
              <img
                src={company.logo}
                alt=""
                width={16}
                height={16}
                style={ccStyles.companyLogo}
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = 'none'
                }}
              />
              <span style={ccStyles.companyName}>{company.name}</span>
              <span style={ccStyles.companyDomain}>{company.domain}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles — matches existing dark theme
// ---------------------------------------------------------------------------
const ccStyles: Record<string, React.CSSProperties> = {
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
    borderRadius: 'var(--radius-md, 8px)',
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
    borderRadius: 'var(--radius-md, 8px)',
    zIndex: 50,
    maxHeight: 240,
    overflowY: 'auto',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  dropdownItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
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
    fontStyle: 'italic',
  },
  companyLogo: {
    borderRadius: 3,
    flexShrink: 0,
    objectFit: 'contain',
  },
  companyName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  companyDomain: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
    flexShrink: 0,
  },
}
