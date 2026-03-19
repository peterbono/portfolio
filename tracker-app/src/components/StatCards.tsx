import type { JobStatus } from '../types/job'
import { STATUS_CONFIG } from '../types/job'
import type { StatusFilterValue } from '../hooks/useFilters'

interface StatCardItem {
  key: StatusFilterValue
  label: string
  icon: string
  color: string
  bg: string
  border: string
  count: number
}

interface StatCardsProps {
  counts: Record<JobStatus, number>
  totalJobs: number
  activeFilter: StatusFilterValue
  onFilterChange: (filter: StatusFilterValue) => void
}

const CARD_ORDER: Array<{ key: StatusFilterValue; label?: string; icon?: string; color?: string; bg?: string; border?: string }> = [
  { key: 'all', label: 'All', icon: '◉', color: '#e0e0e0', bg: '#1a1a1f', border: '#2a2a35' },
  { key: 'submitted' },
  { key: 'manual' },
  { key: 'a_soumettre' },
  { key: 'screening' },
  { key: 'interviewing' },
  { key: 'challenge' },
  { key: 'offer' },
  { key: 'rejected' },
  { key: 'skipped' },
  { key: 'ghosted' },
  { key: 'withdrawn' },
]

export function StatCards({ counts, totalJobs, activeFilter, onFilterChange }: StatCardsProps) {
  const cards: StatCardItem[] = CARD_ORDER.map((entry) => {
    if (entry.key === 'all') {
      return {
        key: 'all',
        label: entry.label!,
        icon: entry.icon!,
        color: entry.color!,
        bg: entry.bg!,
        border: entry.border!,
        count: totalJobs,
      }
    }
    const config = STATUS_CONFIG[entry.key as JobStatus]
    return {
      key: entry.key,
      label: config.label,
      icon: config.icon,
      color: config.color,
      bg: config.bg,
      border: config.border,
      count: counts[entry.key as JobStatus] ?? 0,
    }
  })

  return (
    <div style={styles.grid}>
      {cards.map((card) => {
        const isActive = activeFilter === card.key
        return (
          <button
            key={card.key}
            onClick={() => onFilterChange(card.key)}
            style={{
              ...styles.card,
              background: isActive ? card.bg : 'var(--bg-surface)',
              borderColor: isActive ? card.color : 'var(--border)',
              boxShadow: isActive ? `0 0 12px ${card.color}20` : 'none',
            }}
          >
            <div style={styles.cardTop}>
              <span style={{ fontSize: 14 }}>{card.icon}</span>
              <span
                style={{
                  ...styles.count,
                  color: card.color,
                }}
              >
                {card.count}
              </span>
            </div>
            <span style={styles.label}>{card.label}</span>
          </button>
        )
      })}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  grid: {
    display: 'flex',
    gap: 6,
    overflowX: 'auto',
    flexShrink: 0,
    paddingBottom: 4,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '8px 12px',
    borderRadius: 10,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    transition: 'all 150ms ease',
    textAlign: 'left',
    flexShrink: 0,
    minWidth: 80,
  },
  cardTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  count: {
    fontSize: 20,
    fontWeight: 700,
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
  },
  label: {
    fontSize: 11,
    fontWeight: 500,
    color: 'var(--text-tertiary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
}
