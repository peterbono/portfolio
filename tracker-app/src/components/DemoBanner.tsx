import { Bot, ArrowRight, Eye } from 'lucide-react'
import { useAuthWallContext } from '../context/AuthWallContext'

interface DemoBannerProps {
  onClearDemo: () => void
}

export function DemoBanner({ onClearDemo }: DemoBannerProps) {
  const { showAuthWall } = useAuthWallContext()

  const handleStartBot = () => {
    showAuthWall('start_bot', () => {})
  }

  return (
    <div style={styles.banner}>
      <div style={styles.left}>
        <Bot size={16} color="var(--accent)" style={{ flexShrink: 0 }} />
        <span style={styles.text}>
          This is what the bot does for you — Ready to start?
        </span>
      </div>
      <div style={styles.actions}>
        <button style={styles.startBtn} onClick={handleStartBot}>
          <ArrowRight size={13} />
          Start My Bot
        </button>
        <button style={styles.exploreBtn} onClick={onClearDemo}>
          <Eye size={12} />
          Or explore the dashboard first
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
    padding: '10px 16px',
    background: 'rgba(52, 211, 153, 0.06)',
    border: '1px solid rgba(52, 211, 153, 0.2)',
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
    fontWeight: 500,
    color: 'var(--text-primary)',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  startBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 600,
    color: '#000',
    background: 'var(--accent)',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  exploreBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '5px 10px',
    fontSize: 11,
    fontWeight: 500,
    color: 'var(--text-tertiary)',
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 6,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
}
