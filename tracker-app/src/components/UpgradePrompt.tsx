import { useState } from 'react'
import { Sparkles, X, ArrowRight } from 'lucide-react'
import { useUI } from '../context/UIContext'
import { type PlanTier, getPlanConfig } from '../lib/billing'

interface UpgradePromptProps {
  /** The feature name to display */
  feature: string
  /** The minimum plan required to unlock this feature */
  requiredPlan: PlanTier
  /** Optional callback when dismissed */
  onDismiss?: () => void
  /** Inline variant (smaller, no background) vs banner (default) */
  variant?: 'banner' | 'inline'
}

export function UpgradePrompt({
  feature,
  requiredPlan,
  onDismiss,
  variant = 'banner',
}: UpgradePromptProps) {
  const [dismissed, setDismissed] = useState(false)
  const { setActiveView } = useUI()
  const planConfig = getPlanConfig(requiredPlan)

  if (dismissed) return null

  const handleDismiss = () => {
    setDismissed(true)
    onDismiss?.()
  }

  const handleViewPlans = () => {
    setActiveView('pricing')
  }

  if (variant === 'inline') {
    return (
      <div style={styles.inline}>
        <Sparkles size={14} color="var(--accent)" />
        <span style={styles.inlineText}>
          <strong>{planConfig.name}</strong> plan required for {feature}.
        </span>
        <button onClick={handleViewPlans} style={styles.inlineLink}>
          Upgrade <ArrowRight size={12} />
        </button>
      </div>
    )
  }

  return (
    <div style={styles.banner}>
      <div style={styles.bannerContent}>
        <div style={styles.iconWrap}>
          <Sparkles size={20} color="#09090b" />
        </div>
        <div style={styles.bannerText}>
          <p style={styles.bannerTitle}>
            Upgrade to {planConfig.name} to unlock {feature}
          </p>
          <p style={styles.bannerDesc}>
            {requiredPlan === 'starter' && 'Get 50 auto-applies/month, 2 ATS adapters, and basic AI coaching.'}
            {requiredPlan === 'pro' && 'Get 200 auto-applies/month, all ATS adapters, ghost detection, and AI cover letters.'}
            {requiredPlan === 'premium' && 'Unlimited everything with priority support and early access to new features.'}
          </p>
        </div>
        <button onClick={handleViewPlans} style={styles.bannerBtn}>
          View Plans <ArrowRight size={14} />
        </button>
      </div>
      <button onClick={handleDismiss} style={styles.dismissBtn} title="Dismiss">
        <X size={14} />
      </button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    position: 'relative',
    background: 'linear-gradient(135deg, rgba(52, 211, 153, 0.12) 0%, rgba(52, 211, 153, 0.04) 100%)',
    border: '1px solid rgba(52, 211, 153, 0.2)',
    borderRadius: 'var(--radius-lg)',
    padding: '16px 20px',
    marginBottom: 16,
  },
  bannerContent: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    background: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bannerText: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary)',
    marginBottom: 2,
  },
  bannerDesc: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
  },
  bannerBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'var(--accent)',
    color: '#09090b',
    fontWeight: 600,
    fontSize: 13,
    padding: '8px 16px',
    borderRadius: 'var(--radius-md)',
    border: 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  },
  dismissBtn: {
    position: 'absolute' as const,
    top: 8,
    right: 8,
    padding: 4,
    color: 'var(--text-tertiary)',
    cursor: 'pointer',
    borderRadius: 'var(--radius-sm)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inline: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    background: 'rgba(52, 211, 153, 0.06)',
    border: '1px solid rgba(52, 211, 153, 0.15)',
    borderRadius: 'var(--radius-md)',
    fontSize: 12,
  },
  inlineText: {
    color: 'var(--text-secondary)',
    flex: 1,
  },
  inlineLink: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    color: 'var(--accent)',
    fontWeight: 600,
    fontSize: 12,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
}
