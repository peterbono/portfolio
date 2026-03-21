import { Eye, Plus, Trash2 } from 'lucide-react'

interface DemoBannerProps {
  onAddJob: () => void
  onClearDemo: () => void
}

export function DemoBanner({ onAddJob, onClearDemo }: DemoBannerProps) {
  return (
    <div style={styles.banner}>
      <div style={styles.left}>
        <Eye size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
        <span style={styles.text}>
          You're viewing demo data — add your own jobs to get started
        </span>
      </div>
      <div style={styles.actions}>
        <button style={styles.addBtn} onClick={onAddJob}>
          <Plus size={13} />
          Add a job
        </button>
        <button style={styles.clearBtn} onClick={onClearDemo}>
          <Trash2 size={12} />
          Clear demo data
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '8px 16px',
    background: 'rgba(52, 211, 153, 0.06)',
    border: '1px solid rgba(52, 211, 153, 0.15)',
    borderRadius: 8,
    flexWrap: 'wrap',
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    fontSize: 13,
    color: 'var(--text-secondary)',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  addBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 600,
    color: '#000',
    background: 'var(--accent)',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  clearBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '5px 10px',
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-tertiary)',
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 6,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
}
