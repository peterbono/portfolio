import { useState } from 'react'
import { Check, X, Zap, Flame, Shield, Clock } from 'lucide-react'
import {
  PLAN_CONFIGS,
  type PlanConfig,
  redirectToCheckout,
  isStripeConfigured,
  hasPriceIds,
} from '../lib/billing'
import { usePlan } from '../hooks/usePlan'

// ─── Responsive CSS injection ────────────────────────────────────────
const responsiveCSS = `
@media (max-width: 1100px) {
  .pricing-grid { grid-template-columns: repeat(2, 1fr) !important; }
}
@media (max-width: 640px) {
  .pricing-grid { grid-template-columns: 1fr !important; }
  .faq-grid { grid-template-columns: 1fr !important; }
}
`
if (typeof document !== 'undefined') {
  const id = 'pricing-responsive-styles'
  if (!document.getElementById(id)) {
    const style = document.createElement('style')
    style.id = id
    style.textContent = responsiveCSS
    document.head.appendChild(style)
  }
}

// ─── Main Component ──────────────────────────────────────────────────

export function PricingViewWithResponsive() {
  const [weekly, setWeekly] = useState(true)
  const { plan: currentPlan } = usePlan()

  return (
    <div style={styles.container}>
      <div style={styles.inner}>
        {/* Header */}
        <div style={styles.header}>
          <h1 style={styles.title}>Choose your plan</h1>
          <p style={styles.subtitle}>
            Job search takes 6-8 weeks, not a year. Pay only while you need it.
          </p>
        </div>

        {/* Social proof */}
        <div style={styles.socialProof}>
          <Clock size={14} color="var(--accent)" />
          <span>Average user finds a job in 47 days</span>
        </div>

        {/* Billing toggle */}
        <div style={styles.toggleWrap}>
          <span style={{ ...styles.toggleLabel, color: weekly ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
            Weekly
          </span>
          <button
            onClick={() => setWeekly(w => !w)}
            style={styles.toggleTrack}
            aria-label="Toggle billing period"
          >
            <div
              style={{
                ...styles.toggleThumb,
                transform: weekly ? 'translateX(2px)' : 'translateX(22px)',
              }}
            />
          </button>
          <span style={{ ...styles.toggleLabel, color: !weekly ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
            Monthly
          </span>
          {!weekly && (
            <span style={styles.saveBadge}>Save ~20%</span>
          )}
        </div>

        {/* Cards grid */}
        <div className="pricing-grid" style={styles.grid}>
          {PLAN_CONFIGS.map(config => (
            <PricingCard
              key={config.tier}
              config={config}
              weekly={weekly}
              isCurrentPlan={config.tier === currentPlan}
              isHighlighted={config.tier === 'pro'}
              isBoost={config.tier === 'boost'}
            />
          ))}
        </div>

        {/* Pause message */}
        <p style={styles.pauseMessage}>
          Pause anytime — resume when you need it
        </p>

        {/* FAQ section */}
        <div style={styles.faqSection}>
          <h2 style={styles.faqTitle}>Frequently asked questions</h2>
          <div className="faq-grid" style={styles.faqGrid}>
            <FaqItem
              q="Can I switch plans at any time?"
              a="Yes. Upgrade instantly, downgrade at the end of your billing cycle. No lock-in."
            />
            <FaqItem
              q="What happens when I hit my quota?"
              a="You'll get a notification and can upgrade for more. Existing applications are never interrupted."
            />
            <FaqItem
              q="How does pausing work?"
              a="Pause your subscription from Settings. Your data and progress stay safe. Resume anytime to pick up where you left off."
            />
            <FaqItem
              q="What is Boost?"
              a="A 2-week intensive sprint. Priority everything — your applications are processed first, with AI cover letters and phone support. Perfect when you need a job fast."
            />
          </div>
        </div>

        {/* Stripe badge */}
        <div style={styles.stripeBadge}>
          <Shield size={14} color="var(--text-tertiary)" />
          <span style={styles.stripeText}>Powered by Stripe. Secure payments.</span>
        </div>
      </div>
    </div>
  )
}

// ─── Pricing Card ────────────────────────────────────────────────────

function PricingCard({
  config,
  weekly,
  isCurrentPlan,
  isHighlighted,
  isBoost,
}: {
  config: PlanConfig
  weekly: boolean
  isCurrentPlan: boolean
  isHighlighted: boolean
  isBoost: boolean
}) {
  const [hovering, setHovering] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Boost is always weekly; for others, show weekly or monthly
  const showWeekly = weekly || config.weeklyOnly
  const price = showWeekly ? config.priceWeekly : config.priceMonthly
  const period = showWeekly ? '/wk' : '/mo'

  const stripeReady = isStripeConfigured() && hasPriceIds(config.tier)

  const handleUpgrade = async () => {
    if (isCurrentPlan || config.tier === 'free') return
    setError(null)
    setLoading(true)
    try {
      const interval = showWeekly ? 'weekly' as const : 'monthly' as const
      await redirectToCheckout(config.tier, interval)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Checkout failed'
      setError(msg)
      console.error('[pricing] checkout error:', err)
    } finally {
      setLoading(false)
    }
  }

  const tierIcon = isBoost
    ? <Flame size={18} color="#f59e0b" />
    : config.tier === 'pro'
      ? <Zap size={18} color="var(--accent)" />
      : null

  const cardStyle = {
    ...styles.card,
    ...(isHighlighted ? styles.cardHighlighted : {}),
    ...(isBoost ? styles.cardBoost : {}),
    ...(hovering && !isHighlighted && !isBoost ? styles.cardHover : {}),
  }

  const ctaText = isCurrentPlan
    ? 'Current Plan'
    : loading
      ? 'Redirecting...'
      : config.tier === 'free'
        ? 'Start free'
        : isBoost
          ? 'Start your sprint'
          : 'Start this week'

  const isDisabled = isCurrentPlan || loading || (config.tier !== 'free' && !stripeReady)

  return (
    <div
      style={cardStyle}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {isHighlighted && (
        <div style={styles.popularBadge}>Most Popular</div>
      )}
      {isBoost && (
        <div style={styles.boostBadge}>2-Week Sprint</div>
      )}

      <div style={styles.cardHeader}>
        <div style={styles.planNameRow}>
          {tierIcon}
          <h3 style={styles.planName}>{config.name}</h3>
        </div>

        <div style={styles.priceRow}>
          {config.priceWeekly === 0 && config.priceMonthly === 0 ? (
            <span style={styles.priceAmount}>Free</span>
          ) : (
            <>
              <span style={styles.priceCurrency}>$</span>
              <span style={styles.priceAmount}>{price}</span>
              <span style={styles.pricePeriod}>{period}</span>
            </>
          )}
        </div>

        {/* Weekly-only notice for Boost */}
        {isBoost && (
          <p style={styles.boostNote}>
            Weekly billing only — sprint for 2 weeks, cancel anytime
          </p>
        )}

        {/* Show monthly savings when on monthly view */}
        {!weekly && !config.weeklyOnly && config.priceMonthly > 0 && (
          <p style={styles.billedNote}>
            vs ${config.priceWeekly * 4}/mo billed weekly
          </p>
        )}
      </div>

      {/* CTA */}
      <button
        onClick={handleUpgrade}
        disabled={isDisabled}
        style={{
          ...styles.ctaBtn,
          ...(isHighlighted ? styles.ctaBtnHighlighted : {}),
          ...(isBoost ? styles.ctaBtnBoost : {}),
          ...(isDisabled ? styles.ctaBtnCurrent : {}),
        }}
      >
        {ctaText}
      </button>

      {/* Error message */}
      {error && (
        <p style={styles.errorText}>{error}</p>
      )}

      {/* Search duration estimate */}
      <p style={styles.durationEstimate}>
        Most users find a job in 6-8 weeks
      </p>

      {/* Feature list */}
      <div style={styles.featureList}>
        {config.features.map((feat, i) => (
          <div key={i} style={styles.featureRow}>
            {feat.included ? (
              <Check size={14} color={isBoost ? '#f59e0b' : 'var(--accent)'} style={{ flexShrink: 0 }} />
            ) : (
              <X size={14} color="var(--text-tertiary)" style={{ flexShrink: 0, opacity: 0.4 }} />
            )}
            <span
              style={{
                ...styles.featureLabel,
                color: feat.included ? 'var(--text-primary)' : 'var(--text-tertiary)',
              }}
            >
              {feat.label}
              {feat.detail && (
                <span style={styles.featureDetail}> ({feat.detail})</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── FAQ Item ────────────────────────────────────────────────────────

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div style={styles.faqItem}>
      <h3 style={styles.faqQ}>{q}</h3>
      <p style={styles.faqA}>{a}</p>
    </div>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    overflow: 'auto',
    padding: 24,
  },
  inner: {
    maxWidth: 1200,
    margin: '0 auto',
  },

  // Header
  header: {
    textAlign: 'center' as const,
    marginBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    color: 'var(--text-primary)',
    marginBottom: 8,
    letterSpacing: '-0.02em',
  },
  subtitle: {
    fontSize: 15,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
  },

  // Social proof
  socialProof: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--accent)',
  },

  // Toggle
  toggleWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 32,
  },
  toggleLabel: {
    fontSize: 13,
    fontWeight: 500,
    transition: 'color 0.15s',
  },
  toggleTrack: {
    position: 'relative' as const,
    width: 46,
    height: 24,
    borderRadius: 12,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    cursor: 'pointer',
    padding: 0,
  },
  toggleThumb: {
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: 'var(--accent)',
    transition: 'transform 0.2s ease',
    position: 'absolute' as const,
    top: 2,
  },
  saveBadge: {
    fontSize: 11,
    fontWeight: 700,
    color: '#09090b',
    background: 'var(--accent)',
    padding: '2px 8px',
    borderRadius: 10,
    letterSpacing: '0.02em',
  },

  // Grid
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 16,
    marginBottom: 16,
  },

  // Card
  card: {
    position: 'relative' as const,
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-xl)',
    padding: 24,
    display: 'flex',
    flexDirection: 'column' as const,
    transition: 'border-color 0.2s, transform 0.2s, box-shadow 0.2s',
  },
  cardHighlighted: {
    border: '2px solid var(--accent)',
    background: 'linear-gradient(180deg, rgba(52, 211, 153, 0.06) 0%, var(--bg-surface) 40%)',
    transform: 'scale(1.02)',
    boxShadow: '0 0 40px rgba(52, 211, 153, 0.08)',
  },
  cardBoost: {
    border: '2px solid #f59e0b',
    background: 'linear-gradient(180deg, rgba(245, 158, 11, 0.08) 0%, var(--bg-surface) 40%)',
    boxShadow: '0 0 40px rgba(245, 158, 11, 0.06)',
  },
  cardHover: {
    border: '1px solid var(--border-hover)',
    transform: 'translateY(-2px)',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
  },
  popularBadge: {
    position: 'absolute' as const,
    top: -12,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'var(--accent)',
    color: '#09090b',
    fontSize: 11,
    fontWeight: 700,
    padding: '4px 14px',
    borderRadius: 20,
    letterSpacing: '0.03em',
    whiteSpace: 'nowrap' as const,
    textTransform: 'uppercase' as const,
  },
  boostBadge: {
    position: 'absolute' as const,
    top: -12,
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#f59e0b',
    color: '#09090b',
    fontSize: 11,
    fontWeight: 700,
    padding: '4px 14px',
    borderRadius: 20,
    letterSpacing: '0.03em',
    whiteSpace: 'nowrap' as const,
    textTransform: 'uppercase' as const,
  },

  // Card header
  cardHeader: {
    marginBottom: 20,
  },
  planNameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  planName: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  priceRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 2,
  },
  priceCurrency: {
    fontSize: 18,
    fontWeight: 500,
    color: 'var(--text-secondary)',
  },
  priceAmount: {
    fontSize: 36,
    fontWeight: 700,
    color: 'var(--text-primary)',
    lineHeight: 1,
    letterSpacing: '-0.02em',
  },
  pricePeriod: {
    fontSize: 14,
    color: 'var(--text-tertiary)',
    marginLeft: 2,
  },
  billedNote: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
    marginTop: 4,
  },
  boostNote: {
    fontSize: 11,
    color: '#f59e0b',
    marginTop: 4,
    fontWeight: 500,
  },

  // CTA button
  ctaBtn: {
    width: '100%',
    padding: '10px 16px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s',
    marginBottom: 8,
  },
  ctaBtnHighlighted: {
    background: 'var(--accent)',
    color: '#09090b',
    border: '1px solid var(--accent)',
  },
  ctaBtnBoost: {
    background: '#f59e0b',
    color: '#09090b',
    border: '1px solid #f59e0b',
  },
  ctaBtnCurrent: {
    opacity: 0.5,
    cursor: 'default',
  },

  // Error
  errorText: {
    fontSize: 11,
    color: '#ef4444',
    textAlign: 'center' as const,
    marginBottom: 4,
    padding: '0 4px',
  },

  // Duration estimate
  durationEstimate: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
    textAlign: 'center' as const,
    marginBottom: 16,
    fontStyle: 'italic' as const,
  },

  // Pause message
  pauseMessage: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    textAlign: 'center' as const,
    marginBottom: 40,
    fontWeight: 500,
  },

  // Features
  featureList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
    flex: 1,
  },
  featureRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
  },
  featureLabel: {
    fontSize: 13,
    lineHeight: 1.4,
  },
  featureDetail: {
    color: 'var(--text-tertiary)',
    fontSize: 12,
  },

  // FAQ
  faqSection: {
    marginBottom: 32,
  },
  faqTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text-primary)',
    textAlign: 'center' as const,
    marginBottom: 20,
  },
  faqGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 16,
  },
  faqItem: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: 16,
  },
  faqQ: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
    marginBottom: 6,
  },
  faqA: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
  },

  // Stripe badge
  stripeBadge: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '16px 0 8px',
  },
  stripeText: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
  },
}
