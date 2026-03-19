import { Search, ChevronDown } from 'lucide-react'

interface SearchBarProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  areaFilter: string
  onAreaChange: (area: string) => void
  companyFilter: string
  onCompanyChange: (company: string) => void
  companies: string[]
}

export function SearchBar({
  searchQuery,
  onSearchChange,
  areaFilter,
  onAreaChange,
  companyFilter,
  onCompanyChange,
  companies,
}: SearchBarProps) {
  return (
    <div style={styles.row}>
      {/* Search input */}
      <div style={styles.searchWrapper}>
        <Search size={14} color="var(--text-tertiary)" style={styles.searchIcon} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by company, role, ATS..."
          style={styles.searchInput}
        />
      </div>

      {/* Area dropdown */}
      <div style={styles.selectWrapper}>
        <select
          value={areaFilter}
          onChange={(e) => onAreaChange(e.target.value)}
          style={styles.select}
        >
          <option value="">All areas</option>
          <option value="apac">APAC</option>
          <option value="emea">EMEA</option>
          <option value="americas">Americas</option>
        </select>
        <ChevronDown size={12} color="var(--text-tertiary)" style={styles.chevron} />
      </div>

      {/* Company dropdown */}
      <div style={styles.selectWrapper}>
        <select
          value={companyFilter}
          onChange={(e) => onCompanyChange(e.target.value)}
          style={styles.select}
        >
          <option value="">All companies</option>
          {companies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <ChevronDown size={12} color="var(--text-tertiary)" style={styles.chevron} />
      </div>
    </div>
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
  chevron: {
    position: 'absolute',
    right: 8,
    top: '50%',
    transform: 'translateY(-50%)',
    pointerEvents: 'none',
  },
}
