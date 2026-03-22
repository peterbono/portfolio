import type { LucideIcon } from 'lucide-react'
import { ArrowRight } from 'lucide-react'
import { useUI } from '../context/UIContext'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  ctaLabel?: string
}

export function EmptyState({ icon: Icon, title, description, ctaLabel = 'Go to Autopilot' }: EmptyStateProps) {
  const { setActiveView } = useUI()

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        <div style={styles.iconWrap}>
          <Icon size={28} color="var(--accent)" />
        </div>
        <h3 style={styles.title}>{title}</h3>
        <p style={styles.desc}>{description}</p>
        <button
          onClick={() => setActiveView('autopilot')}
          style={styles.cta}
          onMouseEnter={e => {
            e.currentTarget.style.background = '#2dd4a0'
            e.currentTarget.style.transform = 'translateY(-1px)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'var(--accent)'
            e.currentTarget.style.transform = 'translateY(0)'
          }}
        >
          {ctaLabel}
          <ArrowRight size={15} />
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '60vh',
    padding: 24,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    maxWidth: '90vw',
    width: 400,
    padding: '48px 32px',
    borderRadius: 16,
    border: '1px solid var(--border)',
    background: 'rgba(17, 17, 19, 0.85)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 14,
    background: 'rgba(52, 211, 153, 0.1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text-primary)',
    margin: '0 0 8px',
  },
  desc: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    lineHeight: 1.6,
    margin: '0 0 24px',
  },
  cta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 20px',
    borderRadius: 10,
    border: 'none',
    background: 'var(--accent)',
    color: '#000',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 150ms ease',
  },
}
