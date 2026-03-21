import {
  Bot,
  ArrowRight,
  Zap,
  Brain,
  Ghost,
  Search,
  Cpu,
  BarChart3,
  Check,
  Github,
  CreditCard,
  Sparkles,
  Shield,
  LayoutDashboard,
} from 'lucide-react'

interface LandingViewProps {
  onGetStarted: () => void
  onSignIn: () => void
}

export function LandingView({ onGetStarted, onSignIn }: LandingViewProps) {
  return (
    <div style={styles.page}>
      {/* Nav */}
      <nav style={styles.nav}>
        <div style={styles.navInner}>
          <div style={styles.logoRow}>
            <div style={styles.logoCircle}>
              <Bot size={20} color="var(--accent)" />
            </div>
            <span style={styles.logoText}>Job Tracker</span>
          </div>
          <div style={styles.navLinks}>
            <a href="#features" style={styles.navLink}>Features</a>
            <a href="#how-it-works" style={styles.navLink}>How It Works</a>
            <a href="#pricing" style={styles.navLink}>Pricing</a>
            <button onClick={onSignIn} style={styles.signInBtn}>Sign In</button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section style={styles.hero}>
        <div style={styles.heroBadge}>
          <Sparkles size={14} color="var(--accent)" />
          <span>AI-Powered Job Application Bot</span>
        </div>
        <h1 style={styles.heroTitle}>
          Apply Smarter,<br />Not Harder
        </h1>
        <p style={styles.heroSubtitle}>
          AI-powered job application bot that learns from your results.
          Set your criteria, and let it work while you sleep.
        </p>
        <div style={styles.heroCTAs}>
          <button onClick={onGetStarted} style={styles.ctaPrimary}>
            Get Started Free
            <ArrowRight size={16} />
          </button>
          <a href="#how-it-works" style={styles.ctaSecondary}>
            See How It Works
          </a>
        </div>

        {/* Hero illustration: stylized dashboard mockup */}
        <div style={styles.heroMockup}>
          <div style={styles.mockupHeader}>
            <div style={styles.mockupDots}>
              <span style={{ ...styles.dot, background: '#f43f5e' }} />
              <span style={{ ...styles.dot, background: '#fbbf24' }} />
              <span style={{ ...styles.dot, background: '#34d399' }} />
            </div>
            <span style={styles.mockupUrl}>app.jobtracker.ai</span>
          </div>
          <div style={styles.mockupBody}>
            <div style={styles.mockupSidebar}>
              {['Table', 'Pipeline', 'Analytics', 'Coach', 'Autopilot'].map((item, i) => (
                <div key={item} style={{
                  ...styles.mockupNavItem,
                  background: i === 4 ? 'rgba(52, 211, 153, 0.1)' : 'transparent',
                  color: i === 4 ? 'var(--accent)' : 'var(--text-tertiary)',
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: 'currentColor', opacity: 0.4 }} />
                  <span style={{ fontSize: 9 }}>{item}</span>
                </div>
              ))}
            </div>
            <div style={styles.mockupContent}>
              {/* Mini stat cards */}
              <div style={styles.mockupStats}>
                {[
                  { label: 'Applied', value: '207', color: '#34d399' },
                  { label: 'Pending', value: '299', color: '#60a5fa' },
                  { label: 'Interviews', value: '12', color: '#f59e0b' },
                ].map(stat => (
                  <div key={stat.label} style={styles.mockupStatCard}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: stat.color }}>{stat.value}</span>
                    <span style={{ fontSize: 8, color: 'var(--text-tertiary)' }}>{stat.label}</span>
                  </div>
                ))}
              </div>
              {/* Mini activity lines */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 12px' }}>
                {[90, 70, 85, 50, 65].map((w, i) => (
                  <div key={i} style={{
                    height: 6,
                    width: `${w}%`,
                    borderRadius: 3,
                    background: i === 0 ? 'rgba(52, 211, 153, 0.2)' : 'var(--border)',
                  }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" style={styles.section}>
        <div style={styles.sectionInner}>
          <h2 style={styles.sectionTitle}>Everything You Need</h2>
          <p style={styles.sectionSubtitle}>
            Stop wasting hours on repetitive applications. Let the bot handle the grind.
          </p>
          <div style={styles.featureGrid}>
            <FeatureCard
              Icon={Zap}
              iconColor="#f59e0b"
              title="Auto-Apply Bot"
              description="Set your criteria, the bot applies while you sleep. Supports Greenhouse, Lever, Workable, and more."
            />
            <FeatureCard
              Icon={Brain}
              iconColor="#60a5fa"
              title="Learns & Adapts"
              description="Thompson Sampling optimizes which platforms and approaches work best for your profile."
            />
            <FeatureCard
              Icon={Ghost}
              iconColor="#a78bfa"
              title="Ghost Detection"
              description="Know which companies are ghosting you before wasting more time. Smart timeout tracking."
            />
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" style={styles.howSection}>
        <div style={styles.sectionInner}>
          <h2 style={styles.sectionTitle}>How It Works</h2>
          <p style={styles.sectionSubtitle}>Three steps to automate your job search</p>
          <div style={styles.stepsGrid}>
            <StepCard
              number={1}
              Icon={Search}
              title="Set your search profile"
              description="Define your target roles, salary range, location preferences, and excluded companies."
            />
            <StepCard
              number={2}
              Icon={Cpu}
              title="Bot scouts & applies"
              description="AI qualifies jobs against your criteria, fills ATS forms, and submits applications."
            />
            <StepCard
              number={3}
              Icon={BarChart3}
              title="Review & optimize"
              description="See what's working, track responses, and the bot gets smarter with every cycle."
            />
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section style={styles.proofSection}>
        <div style={styles.proofGrid}>
          <ProofStat value="672+" label="Applications managed" />
          <ProofStat value="4" label="ATS platforms supported" />
          <ProofStat value="AI" label="Powered feedback loop" />
        </div>
      </section>

      {/* Pricing Preview */}
      <section id="pricing" style={styles.section}>
        <div style={styles.sectionInner}>
          <h2 style={styles.sectionTitle}>Simple Pricing</h2>
          <p style={styles.sectionSubtitle}>Start free, upgrade when you need more power</p>
          <div style={styles.pricingGrid}>
            <PricingCard
              name="Free"
              price="0"
              features={['50 tracked jobs', 'Manual applications', 'Basic analytics']}
            />
            <PricingCard
              name="Starter"
              price="9"
              features={['200 tracked jobs', '10 auto-applies/mo', 'Coach insights']}
            />
            <PricingCard
              name="Pro"
              price="29"
              featured
              features={['Unlimited jobs', '100 auto-applies/mo', 'Thompson Sampling AI', 'Ghost detection']}
            />
            <PricingCard
              name="Premium"
              price="79"
              features={['Everything in Pro', 'Unlimited auto-applies', 'Priority support', 'Custom integrations']}
            />
          </div>
          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <button onClick={onGetStarted} style={styles.ctaPrimary}>
              Start Free
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={styles.footer}>
        <div style={styles.footerInner}>
          <div style={styles.footerLeft}>
            <div style={styles.logoRow}>
              <div style={{ ...styles.logoCircle, width: 28, height: 28 }}>
                <Bot size={14} color="var(--accent)" />
              </div>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                Job Tracker
              </span>
            </div>
            <p style={styles.footerTag}>Built by a designer, for designers</p>
          </div>
          <div style={styles.footerLinks}>
            <a href="#features" style={styles.footerLink}>Features</a>
            <a href="#pricing" style={styles.footerLink}>Pricing</a>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              style={styles.footerLink}
            >
              <Github size={14} />
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

function FeatureCard({
  Icon,
  iconColor,
  title,
  description,
}: {
  Icon: typeof Zap
  iconColor: string
  title: string
  description: string
}) {
  return (
    <div style={styles.featureCard}>
      <div style={{
        ...styles.featureIcon,
        background: `${iconColor}15`,
      }}>
        <Icon size={24} color={iconColor} />
      </div>
      <h3 style={styles.featureTitle}>{title}</h3>
      <p style={styles.featureDesc}>{description}</p>
    </div>
  )
}

function StepCard({
  number,
  Icon,
  title,
  description,
}: {
  number: number
  Icon: typeof Search
  title: string
  description: string
}) {
  return (
    <div style={styles.stepCard}>
      <div style={styles.stepNumber}>{number}</div>
      <div style={styles.stepIconWrap}>
        <Icon size={24} color="var(--accent)" />
      </div>
      <h3 style={styles.stepTitle}>{title}</h3>
      <p style={styles.stepDesc}>{description}</p>
    </div>
  )
}

function ProofStat({ value, label }: { value: string; label: string }) {
  return (
    <div style={styles.proofStat}>
      <span style={styles.proofValue}>{value}</span>
      <span style={styles.proofLabel}>{label}</span>
    </div>
  )
}

function PricingCard({
  name,
  price,
  features,
  featured = false,
}: {
  name: string
  price: string
  features: string[]
  featured?: boolean
}) {
  return (
    <div style={{
      ...styles.pricingCard,
      ...(featured ? styles.pricingCardFeatured : {}),
    }}>
      {featured && (
        <div style={styles.pricingBadge}>Most Popular</div>
      )}
      <h3 style={styles.pricingName}>{name}</h3>
      <div style={styles.pricingPrice}>
        <span style={styles.pricingCurrency}>$</span>
        <span style={styles.pricingAmount}>{price}</span>
        <span style={styles.pricingPeriod}>/mo</span>
      </div>
      <ul style={styles.pricingFeatures}>
        {features.map((f, i) => (
          <li key={i} style={styles.pricingFeatureItem}>
            <Check size={14} color="var(--accent)" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Styles                                                              */
/* ------------------------------------------------------------------ */

const styles: Record<string, React.CSSProperties> = {
  page: {
    width: '100vw',
    minHeight: '100vh',
    background: 'var(--bg-base)',
    overflowX: 'hidden',
    overflowY: 'auto',
  },

  /* Nav */
  nav: {
    position: 'sticky',
    top: 0,
    zIndex: 100,
    borderBottom: '1px solid var(--border)',
    background: 'rgba(9, 9, 11, 0.85)',
    backdropFilter: 'blur(12px)',
  },
  navInner: {
    maxWidth: 1120,
    margin: '0 auto',
    padding: '0 24px',
    height: 56,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  logoCircle: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: 'rgba(52, 211, 153, 0.12)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  navLinks: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
  },
  navLink: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    textDecoration: 'none',
    transition: 'color 150ms ease',
  },
  signInBtn: {
    padding: '6px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    transition: 'all 150ms ease',
  },

  /* Hero */
  hero: {
    maxWidth: 1120,
    margin: '0 auto',
    padding: '80px 24px 60px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
  },
  heroBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 14px',
    borderRadius: 20,
    background: 'rgba(52, 211, 153, 0.08)',
    border: '1px solid rgba(52, 211, 153, 0.15)',
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--accent)',
    marginBottom: 24,
  },
  heroTitle: {
    fontSize: 'clamp(36px, 6vw, 64px)',
    fontWeight: 800,
    color: 'var(--text-primary)',
    lineHeight: 1.1,
    letterSpacing: '-0.03em',
    marginBottom: 20,
    background: 'linear-gradient(135deg, var(--text-primary) 0%, var(--accent) 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  heroSubtitle: {
    fontSize: 'clamp(16px, 2vw, 18px)',
    color: 'var(--text-secondary)',
    maxWidth: 540,
    lineHeight: 1.6,
    marginBottom: 32,
  },
  heroCTAs: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 60,
  },
  ctaPrimary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 28px',
    fontSize: 15,
    fontWeight: 600,
    color: '#000',
    background: 'var(--accent)',
    borderRadius: 'var(--radius-lg)',
    cursor: 'pointer',
    transition: 'opacity 150ms ease, transform 150ms ease',
    textDecoration: 'none',
    border: 'none',
  },
  ctaSecondary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 24px',
    fontSize: 15,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    cursor: 'pointer',
    transition: 'all 150ms ease',
    textDecoration: 'none',
  },

  /* Hero Mockup */
  heroMockup: {
    width: '100%',
    maxWidth: 720,
    borderRadius: 12,
    border: '1px solid var(--border)',
    overflow: 'hidden',
    background: 'var(--bg-surface)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(52, 211, 153, 0.05)',
  },
  mockupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
  },
  mockupDots: {
    display: 'flex',
    gap: 5,
  },
  dot: {
    display: 'block',
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
  mockupUrl: {
    fontSize: 10,
    color: 'var(--text-tertiary)',
    flex: 1,
    textAlign: 'center',
  },
  mockupBody: {
    display: 'flex',
    minHeight: 200,
  },
  mockupSidebar: {
    width: 90,
    borderRight: '1px solid var(--border)',
    padding: '10px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  mockupNavItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 10px',
    fontSize: 9,
    color: 'var(--text-tertiary)',
  },
  mockupContent: {
    flex: 1,
    padding: '14px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  mockupStats: {
    display: 'flex',
    gap: 8,
    padding: '0 12px',
  },
  mockupStatCard: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    padding: '10px 8px',
    background: 'var(--bg-elevated)',
    borderRadius: 6,
    border: '1px solid var(--border)',
  },

  /* Sections */
  section: {
    padding: '80px 24px',
  },
  sectionInner: {
    maxWidth: 1120,
    margin: '0 auto',
  },
  sectionTitle: {
    fontSize: 'clamp(24px, 4vw, 36px)',
    fontWeight: 700,
    color: 'var(--text-primary)',
    textAlign: 'center',
    letterSpacing: '-0.02em',
    marginBottom: 12,
  },
  sectionSubtitle: {
    fontSize: 16,
    color: 'var(--text-secondary)',
    textAlign: 'center',
    maxWidth: 500,
    margin: '0 auto 48px',
    lineHeight: 1.5,
  },

  /* Features */
  featureGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 20,
  },
  featureCard: {
    padding: '28px 24px',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-xl)',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    transition: 'border-color 200ms ease, transform 200ms ease',
  },
  featureIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: {
    fontSize: 17,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  featureDesc: {
    fontSize: 14,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
  },

  /* How It Works */
  howSection: {
    padding: '80px 24px',
    background: 'var(--bg-surface)',
    borderTop: '1px solid var(--border)',
    borderBottom: '1px solid var(--border)',
  },
  stepsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 24,
  },
  stepCard: {
    padding: '28px 24px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-xl)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: 14,
    position: 'relative',
  },
  stepNumber: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 24,
    height: 24,
    borderRadius: '50%',
    background: 'rgba(52, 211, 153, 0.1)',
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIconWrap: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: 'rgba(52, 211, 153, 0.08)',
    border: '1px solid rgba(52, 211, 153, 0.15)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  stepDesc: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
  },

  /* Social Proof */
  proofSection: {
    padding: '48px 24px',
    background: 'linear-gradient(135deg, rgba(52, 211, 153, 0.05) 0%, rgba(96, 165, 250, 0.05) 100%)',
    borderBottom: '1px solid var(--border)',
  },
  proofGrid: {
    maxWidth: 800,
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 20,
    textAlign: 'center',
  },
  proofStat: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  proofValue: {
    fontSize: 36,
    fontWeight: 800,
    color: 'var(--accent)',
    letterSpacing: '-0.02em',
  },
  proofLabel: {
    fontSize: 13,
    color: 'var(--text-secondary)',
  },

  /* Pricing */
  pricingGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 16,
  },
  pricingCard: {
    padding: '24px 20px',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-xl)',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    position: 'relative',
  },
  pricingCardFeatured: {
    border: '1px solid rgba(52, 211, 153, 0.4)',
    boxShadow: '0 0 24px rgba(52, 211, 153, 0.08)',
  },
  pricingBadge: {
    position: 'absolute',
    top: -10,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '3px 12px',
    borderRadius: 20,
    background: 'var(--accent)',
    color: '#000',
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    whiteSpace: 'nowrap',
  },
  pricingName: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  pricingPrice: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 2,
  },
  pricingCurrency: {
    fontSize: 16,
    fontWeight: 500,
    color: 'var(--text-secondary)',
  },
  pricingAmount: {
    fontSize: 36,
    fontWeight: 800,
    color: 'var(--text-primary)',
    letterSpacing: '-0.02em',
  },
  pricingPeriod: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
  },
  pricingFeatures: {
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    margin: 0,
    padding: 0,
  },
  pricingFeatureItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    color: 'var(--text-secondary)',
  },

  /* Footer */
  footer: {
    borderTop: '1px solid var(--border)',
    padding: '32px 24px',
    background: 'var(--bg-surface)',
  },
  footerInner: {
    maxWidth: 1120,
    margin: '0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 16,
  },
  footerLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  footerTag: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    fontStyle: 'italic',
  },
  footerLinks: {
    display: 'flex',
    gap: 20,
    alignItems: 'center',
  },
  footerLink: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 13,
    color: 'var(--text-secondary)',
    textDecoration: 'none',
    transition: 'color 150ms ease',
  },
}
