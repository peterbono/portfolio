import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Bot,
  ArrowRight,
  Zap,
  Brain,
  Ghost,
  Cpu,
  BarChart3,
  Check,
  Github,
  Sparkles,
  Shield,
  ChevronRight,
  Play,
  Star,
  TrendingUp,
  Target,
  ChevronDown,
  ShieldCheck,
  Eye,
  HandHelping,
  Crosshair,
} from 'lucide-react'

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

interface LandingViewProps {
  onGetStarted: () => void
  onSignIn: () => void
}

/* ------------------------------------------------------------------ */
/*  Scroll animation hook                                               */
/* ------------------------------------------------------------------ */

function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Respect reduced motion
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) {
      setIsVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.unobserve(el)
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { ref, isVisible }
}

/* ------------------------------------------------------------------ */
/*  Animated counter hook                                               */
/* ------------------------------------------------------------------ */

function useCountUp(target: number, isVisible: boolean, duration = 1800) {
  const [count, setCount] = useState(0)
  const hasAnimated = useRef(false)

  useEffect(() => {
    if (!isVisible || hasAnimated.current) return
    hasAnimated.current = true

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) {
      setCount(target)
      return
    }

    const start = performance.now()
    const animate = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      // ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setCount(Math.floor(eased * target))
      if (progress < 1) requestAnimationFrame(animate)
    }
    requestAnimationFrame(animate)
  }, [isVisible, target, duration])

  return count
}

/* ------------------------------------------------------------------ */
/*  CSS keyframes injection (once)                                      */
/* ------------------------------------------------------------------ */

const KEYFRAMES_ID = 'landing-keyframes'

function injectKeyframes() {
  if (document.getElementById(KEYFRAMES_ID)) return
  const style = document.createElement('style')
  style.id = KEYFRAMES_ID
  style.textContent = `
    @keyframes landing-fadeUp {
      from { opacity: 0; transform: translateY(24px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes landing-fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes landing-pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }
    @keyframes landing-slideRight {
      from { transform: translateX(-100%); }
      to { transform: translateX(100%); }
    }
    @keyframes landing-float {
      0%, 100% { transform: translateY(0px); }
      50% { transform: translateY(-6px); }
    }
    @keyframes landing-typing {
      from { width: 0; }
      to { width: 100%; }
    }
    @keyframes landing-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
    @keyframes landing-shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    @keyframes landing-dot1 {
      0%, 20% { opacity: 0.3; }
      10% { opacity: 1; }
    }
    @keyframes landing-dot2 {
      0%, 20% { opacity: 0.3; }
      10% { opacity: 1; }
    }
    @keyframes landing-gradientMove {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
    @keyframes landing-scaleIn {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }
    @keyframes landing-activitySlide {
      0% { transform: translateX(-10px); opacity: 0; }
      10% { transform: translateX(0); opacity: 1; }
      90% { transform: translateX(0); opacity: 1; }
      100% { transform: translateX(10px); opacity: 0; }
    }
    @keyframes landing-statusGlow {
      0%, 100% { box-shadow: 0 0 4px rgba(52, 211, 153, 0.6); }
      50% { box-shadow: 0 0 8px rgba(52, 211, 153, 0.9), 0 0 16px rgba(52, 211, 153, 0.3); }
    }
    @keyframes landing-ripple {
      0% { transform: translate(-50%, -50%) scale(0); opacity: 0.45; }
      100% { transform: translate(-50%, -50%) scale(2.5); opacity: 0; }
    }
    @keyframes landing-energyFlow {
      0% { background-position: 0% 50%; }
      100% { background-position: 200% 50%; }
    }
    @keyframes landing-spark {
      0%, 100% { opacity: 0.15; transform: translateY(0) scale(0.8); }
      25% { opacity: 1; transform: translateY(-2px) scale(1.2); }
      50% { opacity: 0.3; transform: translateY(1px) scale(0.9); }
      75% { opacity: 0.9; transform: translateY(-1px) scale(1.1); }
    }
    @keyframes landing-pulseEdge {
      0%, 100% { opacity: 0.4; transform: translateX(-50%) scaleX(0.8); }
      50% { opacity: 1; transform: translateX(-50%) scaleX(1.2); }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }
  `
  document.head.appendChild(style)
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export function LandingView({ onGetStarted, onSignIn }: LandingViewProps) {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    injectKeyframes()
  }, [])

  const scrollTo = useCallback((id: string) => {
    setMobileMenuOpen(false)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  return (
    <div data-landing-page="" style={s.page}>
      {/* ============================================================ */}
      {/*  PARTICLE CANVAS — interactive neural constellation            */}
      {/* ============================================================ */}
      <ParticleCanvas />

      {/* ============================================================ */}
      {/*  NAV                                                          */}
      {/* ============================================================ */}
      <nav style={s.nav}>
        <div style={s.navInner}>
          <div style={s.logoRow}>
            <div style={s.logoMark}>
              <Bot size={18} color="#000" />
            </div>
            <span style={s.logoText}>JobTracker</span>
          </div>

          {/* Desktop nav */}
          <div data-landing-nav-center="" style={s.navCenter}>
            <button onClick={() => scrollTo('features')} style={s.navLink}>Features</button>
            <button onClick={() => scrollTo('how-it-works')} style={s.navLink}>How It Works</button>
            <button onClick={() => scrollTo('pricing')} style={s.navLink}>Pricing</button>
          </div>

          <div data-landing-nav-right="" style={s.navRight}>
            <button onClick={onSignIn} style={s.navSignIn}>Log in</button>
            <button onClick={onGetStarted} style={s.navCTA}>
              Get Started
              <ArrowRight size={14} />
            </button>
          </div>

          {/* Mobile hamburger */}
          <button
            data-landing-hamburger=""
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            style={s.hamburger}
            aria-label="Toggle menu"
          >
            <span style={{
              ...s.hamburgerLine,
              transform: mobileMenuOpen ? 'rotate(45deg) translateY(6px)' : 'none',
            }} />
            <span style={{
              ...s.hamburgerLine,
              opacity: mobileMenuOpen ? 0 : 1,
            }} />
            <span style={{
              ...s.hamburgerLine,
              transform: mobileMenuOpen ? 'rotate(-45deg) translateY(-6px)' : 'none',
            }} />
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div style={s.mobileMenu}>
            <button onClick={() => scrollTo('features')} style={s.mobileMenuLink}>Features</button>
            <button onClick={() => scrollTo('how-it-works')} style={s.mobileMenuLink}>How It Works</button>
            <button onClick={() => scrollTo('pricing')} style={s.mobileMenuLink}>Pricing</button>
            <div style={s.mobileMenuDivider} />
            <button onClick={onSignIn} style={s.mobileMenuLink}>Log in</button>
            <button onClick={onGetStarted} style={s.mobileMenuCTA}>
              Get Started Free
              <ArrowRight size={14} />
            </button>
          </div>
        )}
      </nav>

      {/* ============================================================ */}
      {/*  HERO                                                         */}
      {/* ============================================================ */}
      <section style={s.hero}>
        {/* Background glow */}
        <div style={s.heroGlow} />

        <div style={s.heroContent}>
          {/* Badge */}
          <div style={s.heroBadge}>
            <div style={s.heroBadgeDot} />
            <span>AI-powered auto-apply is live</span>
            <ChevronRight size={12} color="var(--accent)" />
          </div>

          {/* Headline */}
          <h1 style={s.heroTitle}>
            Land your next role<br />on autopilot
          </h1>

          {/* Subheadline */}
          <p style={s.heroSub}>
            The AI job application bot that learns what works, applies while you sleep,
            and tells you who's ghosting you.
          </p>

          {/* CTA group */}
          <div style={s.heroCTARow}>
            <button onClick={onGetStarted} style={s.btnPrimary}>
              Start for free
              <ArrowRight size={16} />
            </button>
            <button onClick={() => scrollTo('how-it-works')} style={s.btnGhost}>
              <Play size={14} />
              See how it works
            </button>
          </div>

          {/* Micro-copy */}
          <p style={s.heroMicro}>
            No credit card required &middot; Free forever &middot; Setup in 2 minutes
          </p>
        </div>

        {/* Hero product mockup */}
        <HeroMockup />

        {/* Scroll indicator */}
        <div style={s.scrollIndicator}>
          <div style={s.scrollIndicatorMouse}>
            <div style={s.scrollIndicatorDot} />
          </div>
          <ChevronDown size={14} color="var(--text-tertiary)" style={{ animation: 'landing-scroll-bounce 2s ease infinite 0.5s' }} />
        </div>
      </section>

      {/* ============================================================ */}
      {/*  LOGO STRIP (Social Proof)                                    */}
      {/* ============================================================ */}
      <LogoStrip />

      {/* Divider */}
      <div data-landing-section-divider="" />

      {/* ============================================================ */}
      {/*  FEATURES                                                     */}
      {/* ============================================================ */}
      <section id="features" style={s.sectionDark}>
        <div style={s.container}>
          <SectionHeader
            label="Features"
            title="Everything you need to job-search smarter"
            subtitle="Stop spending hours on repetitive applications. Let the bot handle the grind while you focus on what matters."
          />

          <FeatureRow
            reverse={false}
            icon={<Zap size={20} color="#f59e0b" />}
            iconBg="rgba(245, 158, 11, 0.1)"
            label="Automation"
            title="Auto-apply while you sleep"
            description="Set your criteria once. The bot scouts jobs across Greenhouse, Lever, Workable, and more, then fills and submits applications for you. Wake up to a full pipeline."
            mockup={<AutoApplyMockup />}
          />

          <FeatureRow
            reverse={true}
            icon={<Brain size={20} color="#60a5fa" />}
            iconBg="rgba(96, 165, 250, 0.1)"
            label="Intelligence"
            title="Learns what works for you"
            description="Thompson Sampling AI optimizes which platforms, job titles, and application styles get the best response rates for your specific profile."
            mockup={<InsightsMockup />}
          />

          <FeatureRow
            reverse={false}
            icon={<Ghost size={20} color="#a78bfa" />}
            iconBg="rgba(167, 139, 250, 0.1)"
            label="Detection"
            title="Know who's ghosting you"
            description="Smart timeout tracking identifies companies that go silent. Stop wasting energy following up on dead ends and focus on real opportunities."
            mockup={<GhostMockup />}
          />

          <FeatureRow
            reverse={true}
            icon={<BarChart3 size={20} color="#34d399" />}
            iconBg="rgba(52, 211, 153, 0.1)"
            label="Analytics"
            title="Real data, real insights"
            description="Response rates, time-to-reply, platform performance, and weekly trends. See exactly where your job search stands at a glance."
            mockup={<AnalyticsMockup />}
          />
        </div>
      </section>

      {/* Divider */}
      <div data-landing-section-divider="" />

      {/* ============================================================ */}
      {/*  OUR PROMISE — honest coverage section                        */}
      {/* ============================================================ */}
      <PromiseSection />

      {/* Divider */}
      <div data-landing-section-divider="" />

      {/* ============================================================ */}
      {/*  HOW IT WORKS                                                 */}
      {/* ============================================================ */}
      <section id="how-it-works" style={s.sectionAlt}>
        <div style={s.container}>
          <SectionHeader
            label="How it works"
            title="Three steps to autopilot"
            subtitle="From setup to submitted applications in under five minutes."
          />
          <HowItWorksSteps />
        </div>
      </section>

      {/* ============================================================ */}
      {/*  STATS                                                        */}
      {/* ============================================================ */}
      <StatsSection />

      {/* ============================================================ */}
      {/*  TESTIMONIAL                                                  */}
      {/* ============================================================ */}
      <TestimonialSection />

      {/* Divider */}
      <div data-landing-section-divider="" />

      {/* ============================================================ */}
      {/*  PRICING                                                      */}
      {/* ============================================================ */}
      <section id="pricing" style={s.sectionDark}>
        <div style={s.container}>
          <SectionHeader
            label="Pricing"
            title="Start free, scale when ready"
            subtitle="No hidden fees. No surprise charges. Cancel anytime."
          />

          {/* Billing toggle */}
          <div style={s.billingToggle}>
            <button
              onClick={() => setBillingCycle('monthly')}
              style={{
                ...s.billingBtn,
                ...(billingCycle === 'monthly' ? s.billingBtnActive : {}),
              }}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle('annual')}
              style={{
                ...s.billingBtn,
                ...(billingCycle === 'annual' ? s.billingBtnActive : {}),
              }}
            >
              Annual
              <span style={s.saveBadge}>-20%</span>
            </button>
          </div>

          <div data-landing-pricing-grid="" style={s.pricingGrid}>
            <PricingCard
              name="Free"
              price={0}
              period={billingCycle}
              description="For getting started"
              features={[
                '50 tracked jobs',
                'Manual applications',
                'Basic analytics',
                'Email support',
              ]}
              cta="Get started"
              onCta={onGetStarted}
            />
            <PricingCard
              name="Starter"
              price={billingCycle === 'monthly' ? 9 : 7}
              period={billingCycle}
              description="For active job seekers"
              features={[
                '200 tracked jobs',
                '10 auto-applies/month',
                'Coach insights',
                'Platform analytics',
                'Priority support',
              ]}
              cta="Start free trial"
              onCta={onGetStarted}
            />
            <PricingCard
              name="Pro"
              price={billingCycle === 'monthly' ? 29 : 23}
              period={billingCycle}
              description="For serious applicants"
              features={[
                'Unlimited jobs',
                '100 auto-applies/month',
                'Thompson Sampling AI',
                'Ghost detection',
                'Advanced analytics',
                'Custom integrations',
              ]}
              featured
              cta="Start free trial"
              onCta={onGetStarted}
            />
            <PricingCard
              name="Premium"
              price={billingCycle === 'monthly' ? 79 : 63}
              period={billingCycle}
              description="For power users"
              features={[
                'Everything in Pro',
                'Unlimited auto-applies',
                'Priority AI processing',
                'Custom ATS integrations',
                'Dedicated support',
                'API access',
              ]}
              cta="Contact us"
              onCta={onGetStarted}
            />
          </div>
        </div>
      </section>

      {/* Divider */}
      <div data-landing-section-divider="" />

      {/* ============================================================ */}
      {/*  FINAL CTA                                                    */}
      {/* ============================================================ */}
      <section style={s.finalCTA}>
        <div style={s.finalCTAGlow} />
        {/* Ambient orbs for CTA section */}
        <div style={s.ctaOrb1} aria-hidden="true" />
        <div style={s.ctaOrb2} aria-hidden="true" />
        <div style={s.container}>
          <FinalCTAContent onGetStarted={onGetStarted} />
        </div>
      </section>

      {/* ============================================================ */}
      {/*  FOOTER                                                       */}
      {/* ============================================================ */}
      <footer style={s.footer}>
        <div style={s.footerInner}>
          <div style={s.footerLeft}>
            <div style={s.logoRow}>
              <div style={{ ...s.logoMark, width: 28, height: 28 }}>
                <Bot size={14} color="#000" />
              </div>
              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                JobTracker
              </span>
            </div>
            <p style={s.footerTagline}>AI-powered job search automation.<br />Apply smarter, not harder.</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <a href="https://github.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-tertiary)', transition: 'color 150ms ease' }}>
                <Github size={16} />
              </a>
            </div>
          </div>
          <div data-landing-footer-columns="" style={s.footerColumns}>
            <div style={s.footerCol}>
              <span style={s.footerColTitle}>Product</span>
              <button onClick={() => scrollTo('features')} style={s.footerLink}>Features</button>
              <button onClick={() => scrollTo('pricing')} style={s.footerLink}>Pricing</button>
              <button onClick={() => scrollTo('how-it-works')} style={s.footerLink}>How It Works</button>
            </div>
            <div style={s.footerCol}>
              <span style={s.footerColTitle}>Company</span>
              <a href="#" style={s.footerLink}>Terms</a>
              <a href="#" style={s.footerLink}>Privacy</a>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...s.footerLink, display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <Github size={12} /> GitHub
              </a>
            </div>
          </div>
        </div>
        <div style={s.footerBottom}>
          <div style={s.footerBottomInner}>
            <span style={s.footerCopyright}>&copy; {new Date().getFullYear()} JobTracker. All rights reserved.</span>
            <div style={s.footerBadge}>
              <Sparkles size={10} color="var(--accent)" />
              <span>Built with AI</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

/* ================================================================== */
/*  SUB-COMPONENTS                                                      */
/* ================================================================== */

/* ---------- Section Header ---------- */

function SectionHeader({
  label,
  title,
  subtitle,
}: {
  label: string
  title: string
  subtitle: string
}) {
  const { ref, isVisible } = useScrollReveal()
  return (
    <div
      ref={ref}
      style={{
        textAlign: 'center',
        marginBottom: 64,
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(24px)',
        transition: 'opacity 0.6s ease, transform 0.6s ease',
      }}
    >
      <div style={s.sectionLabel}>
        <span>{label}</span>
      </div>
      <h2 style={s.sectionTitle}>{title}</h2>
      <p style={s.sectionSubtitle}>{subtitle}</p>
    </div>
  )
}

/* ---------- Hero Mockup (animated) ---------- */

function HeroMockup() {
  const { ref, isVisible } = useScrollReveal()

  const activities = [
    { company: 'Stripe', role: 'Senior Product Designer', status: 'Applied', color: '#34d399' },
    { company: 'Figma', role: 'Design Systems Lead', status: 'Applied', color: '#34d399' },
    { company: 'Linear', role: 'Staff Designer', status: 'Screening', color: '#60a5fa' },
    { company: 'Vercel', role: 'UX Designer', status: 'Applied', color: '#34d399' },
    { company: 'Notion', role: 'Product Designer', status: 'Interview', color: '#f59e0b' },
  ]

  return (
    <div
      ref={ref}
      style={{
        ...s.heroMockupWrap,
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0) scale(1)' : 'translateY(32px) scale(0.97)',
        transition: 'opacity 0.8s ease 0.2s, transform 0.8s ease 0.2s',
      }}
    >
      {/* Glow behind mockup */}
      <div style={s.mockupGlow} />

      <div style={s.mockupFrame}>
        {/* Browser chrome */}
        <div style={s.mockupChrome}>
          <div style={s.chromeDots}>
            <span style={{ ...s.chromeDot, background: '#f43f5e' }} />
            <span style={{ ...s.chromeDot, background: '#fbbf24' }} />
            <span style={{ ...s.chromeDot, background: '#34d399' }} />
          </div>
          <div style={s.chromeUrlBar}>
            <Shield size={10} color="var(--text-tertiary)" />
            <span>app.jobtracker.ai</span>
          </div>
          <div style={{ width: 48 }} />
        </div>

        {/* Dashboard body */}
        <div style={s.mockupDash}>
          {/* Sidebar mini */}
          <div data-landing-mockup-sidebar="" style={s.mockupSidebar}>
            {['Dashboard', 'Pipeline', 'Autopilot', 'Analytics', 'Coach'].map((item, i) => (
              <div
                key={item}
                style={{
                  ...s.mockupSideItem,
                  background: i === 2 ? 'rgba(52, 211, 153, 0.12)' : 'transparent',
                  color: i === 2 ? 'var(--accent)' : 'var(--text-tertiary)',
                  fontWeight: i === 2 ? 600 : 400,
                }}
              >
                <div style={{
                  width: 6,
                  height: 6,
                  borderRadius: 2,
                  background: 'currentColor',
                  opacity: i === 2 ? 1 : 0.4,
                }} />
                <span>{item}</span>
              </div>
            ))}
          </div>

          {/* Main content */}
          <div style={s.mockupMain}>
            {/* Stat row */}
            <div style={s.mockupStatRow}>
              {[
                { label: 'Applied', val: '207', col: '#34d399', delta: '+12 today' },
                { label: 'In Review', val: '38', col: '#60a5fa', delta: '+3 today' },
                { label: 'Interviews', val: '12', col: '#f59e0b', delta: '+1 today' },
              ].map((st) => (
                <div key={st.label} style={s.mockupStatCard}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 8, color: 'var(--text-tertiary)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{st.label}</span>
                    <span style={{ fontSize: 7, color: st.col }}>{st.delta}</span>
                  </div>
                  <span style={{ fontSize: 18, fontWeight: 700, color: st.col, letterSpacing: '-0.02em' }}>{st.val}</span>
                </div>
              ))}
            </div>

            {/* Activity feed with animation */}
            <div style={s.mockupFeed}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px', marginBottom: 6 }}>
                <span style={{ fontSize: 8, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Live Activity</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={s.liveDot} />
                  <span style={{ fontSize: 7, color: 'var(--accent)' }}>Bot Active</span>
                </div>
              </div>
              {activities.map((a, i) => (
                <div
                  key={a.company}
                  style={{
                    ...s.activityRow,
                    animation: `landing-activitySlide 4s ease ${i * 0.8}s infinite`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                    <div style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      background: `${a.color}15`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <span style={{ fontSize: 7, fontWeight: 700, color: a.color }}>
                        {a.company[0]}
                      </span>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 8, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.company}</div>
                      <div style={{ fontSize: 7, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.role}</div>
                    </div>
                  </div>
                  <span style={{
                    fontSize: 7,
                    fontWeight: 600,
                    color: a.color,
                    padding: '1px 6px',
                    borderRadius: 3,
                    background: `${a.color}12`,
                    flexShrink: 0,
                  }}>
                    {a.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- Logo Strip ---------- */

function LogoStrip() {
  const { ref, isVisible } = useScrollReveal()
  const tools = ['Claude AI', 'Supabase', 'Playwright', 'Vercel', 'React', 'TypeScript']

  return (
    <section
      ref={ref}
      style={{
        ...s.logoSection,
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(16px)',
        transition: 'opacity 0.6s ease, transform 0.6s ease',
      }}
    >
      <p style={s.logoSectionLabel}>Powered by industry-leading tools</p>
      <div data-landing-logo-grid="" style={s.logoGrid}>
        {tools.map((name) => (
          <div key={name} style={s.logoItem}>
            <span style={s.logoName}>{name}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ---------- Feature Row (alternating) ---------- */

function FeatureRow({
  reverse,
  icon,
  iconBg,
  label,
  title,
  description,
  mockup,
}: {
  reverse: boolean
  icon: React.ReactNode
  iconBg: string
  label: string
  title: string
  description: string
  mockup: React.ReactNode
}) {
  const { ref, isVisible } = useScrollReveal()

  return (
    <div
      ref={ref}
      data-landing-feature-row=""
      style={{
        ...s.featureRow,
        flexDirection: reverse ? 'row-reverse' : 'row',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(32px)',
        transition: 'opacity 0.7s ease, transform 0.7s ease',
      }}
    >
      <div style={s.featureText}>
        <div style={{ ...s.featureIconBadge, background: iconBg }}>
          {icon}
        </div>
        <span style={s.featureLabel}>{label}</span>
        <h3 style={s.featureTitle}>{title}</h3>
        <p style={s.featureDesc}>{description}</p>
      </div>
      <div style={s.featureMockupWrap}>
        {mockup}
      </div>
    </div>
  )
}

/* ---------- Feature Mockups ---------- */

function AutoApplyMockup() {
  return (
    <div style={s.miniMockup}>
      <div style={s.miniHeader}>
        <Zap size={12} color="#f59e0b" />
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary)' }}>Autopilot Activity</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={s.liveDot} />
          <span style={{ fontSize: 8, color: 'var(--accent)' }}>Running</span>
        </div>
      </div>
      {[
        { name: 'Stripe — Sr Product Designer', time: '2m ago', status: 'Submitted' },
        { name: 'Figma — Design Lead', time: '5m ago', status: 'Submitted' },
        { name: 'Notion — UX Designer', time: '8m ago', status: 'Filling...' },
        { name: 'Linear — Staff Designer', time: '12m ago', status: 'Submitted' },
      ].map((item, i) => (
        <div key={i} style={s.miniRow}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</div>
            <div style={{ fontSize: 8, color: 'var(--text-tertiary)' }}>{item.time}</div>
          </div>
          <span style={{
            fontSize: 8,
            fontWeight: 600,
            color: item.status === 'Filling...' ? '#f59e0b' : '#34d399',
            padding: '2px 6px',
            borderRadius: 4,
            background: item.status === 'Filling...' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(52, 211, 153, 0.1)',
          }}>
            {item.status}
          </span>
        </div>
      ))}
    </div>
  )
}

function InsightsMockup() {
  const bars = [65, 82, 45, 90, 70, 55, 88]
  return (
    <div style={s.miniMockup}>
      <div style={s.miniHeader}>
        <Brain size={12} color="#60a5fa" />
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary)' }}>AI Insights</span>
      </div>
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 50 }}>
          {bars.map((h, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${h}%`,
                borderRadius: 2,
                background: i === 3 ? '#60a5fa' : 'rgba(96, 165, 250, 0.2)',
                transition: 'height 0.3s ease',
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 8, color: 'var(--text-tertiary)', textAlign: 'center' as const }}>
          Response Rate by Platform
        </div>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#60a5fa' }}>23%</div>
            <div style={{ fontSize: 8, color: 'var(--text-tertiary)' }}>Avg Response</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#34d399' }}>+8%</div>
            <div style={{ fontSize: 8, color: 'var(--text-tertiary)' }}>vs Last Week</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function GhostMockup() {
  return (
    <div style={s.miniMockup}>
      <div style={s.miniHeader}>
        <Ghost size={12} color="#a78bfa" />
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary)' }}>Ghost Radar</span>
      </div>
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[
          { name: 'AcmeCorp', days: 21, risk: 'High' },
          { name: 'TechVenture', days: 14, risk: 'Medium' },
          { name: 'StartupXYZ', days: 8, risk: 'Low' },
        ].map((g) => (
          <div key={g.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, background: 'var(--bg-base)' }}>
            <Ghost size={10} color={g.risk === 'High' ? '#f43f5e' : g.risk === 'Medium' ? '#f59e0b' : '#34d399'} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-primary)' }}>{g.name}</div>
              <div style={{ fontSize: 7, color: 'var(--text-tertiary)' }}>No reply in {g.days} days</div>
            </div>
            <span style={{
              fontSize: 7,
              fontWeight: 600,
              padding: '2px 5px',
              borderRadius: 3,
              color: g.risk === 'High' ? '#f43f5e' : g.risk === 'Medium' ? '#f59e0b' : '#34d399',
              background: g.risk === 'High' ? 'rgba(244, 63, 94, 0.1)' : g.risk === 'Medium' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(52, 211, 153, 0.1)',
            }}>
              {g.risk}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function AnalyticsMockup() {
  return (
    <div style={s.miniMockup}>
      <div style={s.miniHeader}>
        <BarChart3 size={12} color="#34d399" />
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary)' }}>Weekly Overview</span>
      </div>
      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Mini chart */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 40 }}>
          {[30, 45, 35, 60, 80, 55, 72].map((h, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <div style={{
                height: `${h}%`,
                borderRadius: 2,
                background: `rgba(52, 211, 153, ${0.3 + (h / 100) * 0.7})`,
              }} />
            </div>
          ))}
        </div>
        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          {[
            { label: 'Applied', val: '47', color: '#34d399' },
            { label: 'Response', val: '23%', color: '#60a5fa' },
            { label: 'Interviews', val: '5', color: '#f59e0b' },
          ].map((item) => (
            <div key={item.label} style={{ textAlign: 'center' as const }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: item.color }}>{item.val}</div>
              <div style={{ fontSize: 7, color: 'var(--text-tertiary)' }}>{item.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ---------- How It Works Steps ---------- */

function HowItWorksSteps() {
  const { ref, isVisible } = useScrollReveal()

  const steps = [
    {
      num: 1,
      icon: <Target size={24} color="var(--accent)" />,
      title: 'Define your criteria',
      desc: 'Set target roles, salary, location, and excluded companies. Takes 2 minutes.',
    },
    {
      num: 2,
      icon: <Cpu size={24} color="var(--accent)" />,
      title: 'Bot scouts & applies',
      desc: 'AI qualifies jobs, fills ATS forms, and submits. Runs on autopilot 24/7.',
    },
    {
      num: 3,
      icon: <TrendingUp size={24} color="var(--accent)" />,
      title: 'Track & optimize',
      desc: 'Review results, see what works, and the bot gets smarter every cycle.',
    },
  ]

  return (
    <div
      ref={ref}
      data-landing-steps-row=""
      style={{
        ...s.stepsRow,
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(24px)',
        transition: 'opacity 0.7s ease, transform 0.7s ease',
      }}
    >
      {steps.map((step, i) => (
        <div key={step.num} style={s.stepItem}>
          {/* Connector line */}
          {i < steps.length - 1 && <div data-landing-step-connector="" style={s.stepConnector} />}

          <div style={s.stepNumCircle}>
            <span style={s.stepNum}>{step.num}</span>
          </div>
          <div style={s.stepIconWrap}>{step.icon}</div>
          <h3 style={s.stepTitle}>{step.title}</h3>
          <p style={s.stepDesc}>{step.desc}</p>
        </div>
      ))}
    </div>
  )
}

/* ---------- Promise / Honest Coverage Section ---------- */

function PromiseSection() {
  const { ref, isVisible } = useScrollReveal()
  const barRef = useRef<HTMLDivElement>(null)
  const [barAnimated, setBarAnimated] = useState(false)
  const [countVal, setCountVal] = useState(0)

  useEffect(() => {
    if (isVisible && !barAnimated) {
      // Small delay so the section fades in first, then the bar fills
      const t = setTimeout(() => setBarAnimated(true), 400)
      return () => clearTimeout(t)
    }
  }, [isVisible, barAnimated])

  // Count-up animation for the percentage label
  useEffect(() => {
    if (!barAnimated) return
    const duration = 1800 // ms, matches bar fill roughly
    const steps = 60
    const increment = 100 / steps
    const interval = duration / steps
    let current = 0
    const timer = setInterval(() => {
      current += increment
      if (current >= 100) {
        current = 100
        clearInterval(timer)
      }
      setCountVal(Math.round(current))
    }, interval)
    return () => clearInterval(timer)
  }, [barAnimated])

  // Spark positions along the bar (percentages from left)
  const sparks = [
    { left: '15%', delay: '0s' },
    { left: '38%', delay: '0.7s' },
    { left: '55%', delay: '1.4s' },
    { left: '72%', delay: '0.3s' },
  ]

  return (
    <section id="our-promise" style={s.sectionAlt}>
      <div style={s.container}>
        <div
          ref={ref}
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? 'translateY(0)' : 'translateY(24px)',
            transition: 'opacity 0.6s ease, transform 0.6s ease',
          }}
        >
          {/* Section Header */}
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <div style={s.sectionLabel}>
              <span>Our Promise</span>
            </div>
            <h2 style={s.sectionTitle}>Nothing slips through</h2>
            <p style={s.sectionSubtitle}>
              Other tools auto-apply everywhere and fail silently.
              We apply where we can, and prep you where we can't.
              Every job gets handled.
            </p>
          </div>

          {/* Coverage Bar Visual */}
          <div style={ps.coverageCard}>
            {/* Subtle glow behind card */}
            <div style={ps.coverageGlow} />

            {/* The bar */}
            <div style={ps.barLabel}>
              <span style={ps.barLabelText}>Application coverage</span>
              <span style={{
                ...ps.barLabelValue,
                fontVariantNumeric: 'tabular-nums',
              }}>{countVal}%</span>
            </div>
            <div ref={barRef} style={ps.barTrack}>
              {/* Green auto-applied portion with energy flow */}
              <div
                style={{
                  ...ps.barFillAuto,
                  width: barAnimated ? '78%' : '0%',
                  background: barAnimated
                    ? 'linear-gradient(90deg, #059669, #34d399, #6ee7b7, #34d399, #059669)'
                    : 'linear-gradient(90deg, #34d399 0%, #2dd4a8 100%)',
                  backgroundSize: '200% 100%',
                  animation: barAnimated ? 'landing-energyFlow 2s linear infinite' : 'none',
                  boxShadow: barAnimated
                    ? '0 0 20px rgba(52, 211, 153, 0.4), 0 0 40px rgba(52, 211, 153, 0.15)'
                    : 'none',
                }}
              />
              {/* Blue assisted portion with blue glow */}
              <div
                style={{
                  ...ps.barFillAssisted,
                  width: barAnimated ? '22%' : '0%',
                  background: barAnimated
                    ? 'linear-gradient(90deg, #2563eb, #3b82f6, #60a5fa, #3b82f6, #2563eb)'
                    : 'linear-gradient(90deg, #3b82f6 0%, #60a5fa 100%)',
                  backgroundSize: '200% 100%',
                  animation: barAnimated ? 'landing-energyFlow 2.5s linear infinite' : 'none',
                  boxShadow: barAnimated
                    ? '0 0 20px rgba(59, 130, 246, 0.35), 0 0 40px rgba(59, 130, 246, 0.12)'
                    : 'none',
                }}
              />
              {/* Pulse edge at green/blue junction */}
              {barAnimated && (
                <div
                  style={{
                    position: 'absolute',
                    left: '78%',
                    top: 0,
                    width: 6,
                    height: '100%',
                    background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.9) 0%, rgba(52,211,153,0.6) 40%, transparent 70%)',
                    animation: 'landing-pulseEdge 1.5s ease-in-out infinite',
                    zIndex: 3,
                    pointerEvents: 'none',
                    filter: 'blur(1px)',
                  }}
                />
              )}
              {/* Electric sparks */}
              {barAnimated && sparks.map((sp, i) => (
                <span
                  key={i}
                  style={{
                    position: 'absolute',
                    left: sp.left,
                    top: '50%',
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    background: '#fff',
                    boxShadow: '0 0 6px 2px rgba(255,255,255,0.8), 0 0 12px 4px rgba(52,211,153,0.5)',
                    animation: `landing-spark 1.2s ease-in-out infinite`,
                    animationDelay: sp.delay,
                    zIndex: 4,
                    pointerEvents: 'none',
                    transform: 'translate(-50%, -50%)',
                  }}
                />
              ))}
            </div>
            <div data-landing-promise-legend="" style={ps.barLegend}>
              <div style={ps.legendItem}>
                <div style={{ ...ps.legendDot, background: '#34d399', boxShadow: '0 0 6px rgba(52,211,153,0.5)' }} />
                <span style={ps.legendLabel}>Bot auto-applied</span>
                <span style={ps.legendPercent}>~80%</span>
              </div>
              <div style={ps.legendItem}>
                <div style={{ ...ps.legendDot, background: '#60a5fa', boxShadow: '0 0 6px rgba(96,165,250,0.5)' }} />
                <span style={ps.legendLabel}>You, assisted by bot</span>
                <span style={ps.legendPercent}>~20%</span>
              </div>
            </div>
          </div>

          {/* Three pillars */}
          <div data-landing-promise-grid="" style={ps.pillarsGrid}>
            <div style={ps.pillar}>
              <div style={{ ...ps.pillarIcon, background: 'rgba(52, 211, 153, 0.08)', border: '1px solid rgba(52, 211, 153, 0.12)' }}>
                <Zap size={20} color="#34d399" />
              </div>
              <h3 style={ps.pillarTitle}>Auto-applied</h3>
              <p style={ps.pillarDesc}>
                Standard ATS forms (Greenhouse, Lever, Workable) get filled and submitted automatically. You wake up to confirmations.
              </p>
            </div>

            <div style={ps.pillar}>
              <div style={{ ...ps.pillarIcon, background: 'rgba(96, 165, 250, 0.08)', border: '1px solid rgba(96, 165, 250, 0.12)' }}>
                <HandHelping size={20} color="#60a5fa" />
              </div>
              <h3 style={ps.pillarTitle}>Assisted apply</h3>
              <p style={ps.pillarDesc}>
                CAPTCHAs, custom portals, or tricky forms? The bot preps everything -- your answers, your CV, your cover letter. You just hit submit.
              </p>
            </div>

            <div style={ps.pillar}>
              <div style={{ ...ps.pillarIcon, background: 'rgba(167, 139, 250, 0.08)', border: '1px solid rgba(167, 139, 250, 0.12)' }}>
                <Eye size={20} color="#a78bfa" />
              </div>
              <h3 style={ps.pillarTitle}>Nothing missed</h3>
              <p style={ps.pillarDesc}>
                Every matched job is accounted for. No silent failures, no black holes. Your tracker shows exactly what happened with each one.
              </p>
            </div>
          </div>

          {/* Competitor contrast */}
          <div data-landing-promise-compare="" style={ps.compareRow}>
            <div style={ps.compareCard}>
              <div style={ps.compareHeader}>
                <Crosshair size={16} color="var(--text-tertiary)" />
                <span style={ps.compareLabel}>Other tools</span>
              </div>
              <div style={ps.compareMetric}>
                <span style={ps.compareNum}>Spray & pray</span>
              </div>
              <p style={ps.compareDesc}>
                Mass-apply everywhere, fail silently on half, get flagged as spam. 2% response rate.
              </p>
              <div style={ps.compareStar}>
                <Star size={12} color="#f59e0b" />
                <Star size={12} color="#f59e0b" />
                <Star size={12} color="rgba(255,255,255,0.15)" />
                <Star size={12} color="rgba(255,255,255,0.15)" />
                <Star size={12} color="rgba(255,255,255,0.15)" />
                <span style={ps.compareStarText}>1.9 avg rating</span>
              </div>
            </div>
            <div style={{ ...ps.compareCard, ...ps.compareCardUs }}>
              <div style={ps.compareHeader}>
                <ShieldCheck size={16} color="#34d399" />
                <span style={{ ...ps.compareLabel, color: '#34d399' }}>JobTracker</span>
              </div>
              <div style={ps.compareMetric}>
                <span style={{ ...ps.compareNum, color: '#fff' }}>Smart & complete</span>
              </div>
              <p style={ps.compareDesc}>
                Targeted applications with full coverage. Nothing lost, nothing spammed. Real results.
              </p>
              <div style={ps.compareStar}>
                <Star size={12} color="#34d399" />
                <Star size={12} color="#34d399" />
                <Star size={12} color="#34d399" />
                <Star size={12} color="#34d399" />
                <Star size={12} color="#34d399" />
                <span style={{ ...ps.compareStarText, color: 'var(--text-secondary)' }}>Honest by design</span>
              </div>
            </div>
          </div>

          {/* Trust micro-copy */}
          <p style={ps.trustLine}>
            <ShieldCheck size={14} color="#34d399" />
            We never let a good job slip through. That's the promise.
          </p>
        </div>
      </div>
    </section>
  )
}

/* ---------- Promise section styles ---------- */

const ps: Record<string, React.CSSProperties> = {
  coverageCard: {
    position: 'relative',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: '32px 36px',
    marginBottom: 64,
    overflow: 'hidden',
  },
  coverageGlow: {
    position: 'absolute',
    top: '-50%',
    left: '10%',
    width: '80%',
    height: '200%',
    background: 'radial-gradient(ellipse at center, rgba(52,211,153,0.06) 0%, transparent 60%)',
    pointerEvents: 'none',
  },
  barLabel: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    position: 'relative',
    zIndex: 1,
  },
  barLabelText: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    letterSpacing: '0.01em',
  },
  barLabelValue: {
    fontSize: 24,
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '-0.02em',
    textShadow: '0 0 20px rgba(52, 211, 153, 0.5)',
    minWidth: 60,
    textAlign: 'right' as const,
  },
  barTrack: {
    display: 'flex',
    width: '100%',
    height: 32,
    borderRadius: 10,
    background: 'rgba(255,255,255,0.04)',
    overflow: 'visible',
    position: 'relative',
    zIndex: 1,
  },
  barFillAuto: {
    height: '100%',
    background: 'linear-gradient(90deg, #34d399 0%, #2dd4a8 100%)',
    borderRadius: '10px 0 0 10px',
    transition: 'width 1.4s cubic-bezier(0.16, 1, 0.3, 1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
    color: '#000',
    letterSpacing: '0.02em',
    position: 'relative',
    zIndex: 1,
  },
  barFillAssisted: {
    height: '100%',
    background: 'linear-gradient(90deg, #3b82f6 0%, #60a5fa 100%)',
    borderRadius: '0 10px 10px 0',
    transition: 'width 1.2s cubic-bezier(0.16, 1, 0.3, 1) 0.4s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
    color: '#000',
    letterSpacing: '0.02em',
    position: 'relative',
    zIndex: 2,
  },
  barLegend: {
    display: 'flex',
    gap: 32,
    marginTop: 16,
    position: 'relative',
    zIndex: 1,
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
    flexShrink: 0,
  },
  legendLabel: {
    fontSize: 13,
    color: 'var(--text-secondary)',
  },
  legendPercent: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },

  /* Pillars grid */
  pillarsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 24,
    marginBottom: 64,
  },
  pillar: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: '28px 24px',
    transition: 'border-color 200ms ease, box-shadow 200ms ease',
  },
  pillarIcon: {
    width: 42,
    height: 42,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  pillarTitle: {
    fontSize: 16,
    fontWeight: 650,
    color: '#fff',
    marginBottom: 8,
    letterSpacing: '-0.01em',
  },
  pillarDesc: {
    fontSize: 14,
    color: 'var(--text-secondary)',
    lineHeight: 1.6,
    margin: 0,
  },

  /* Competitor comparison */
  compareRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 20,
    marginBottom: 48,
  },
  compareCard: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: '24px 28px',
  },
  compareCardUs: {
    background: 'rgba(52, 211, 153, 0.03)',
    border: '1px solid rgba(52, 211, 153, 0.12)',
  },
  compareHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  compareLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-tertiary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
  compareMetric: {
    marginBottom: 8,
  },
  compareNum: {
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--text-secondary)',
    letterSpacing: '-0.02em',
  },
  compareDesc: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
    lineHeight: 1.55,
    margin: 0,
    marginBottom: 12,
  },
  compareStar: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
  },
  compareStarText: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    marginLeft: 6,
  },

  /* Trust line */
  trustLine: {
    textAlign: 'center' as const,
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    margin: 0,
  },
}

/* ---------- Stats Section ---------- */

function StatsSection() {
  const { ref, isVisible } = useScrollReveal()
  const applies = useCountUp(25, isVisible)
  const ats = useCountUp(4, isVisible, 1200)
  const uptime = useCountUp(99, isVisible, 1600)

  return (
    <section ref={ref} style={s.statsSection}>
      <div style={s.container}>
        <div style={{
          ...s.statsGrid,
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? 'translateY(0)' : 'translateY(24px)',
          transition: 'opacity 0.6s ease, transform 0.6s ease',
        }}>
          <div style={s.statItem}>
            <span style={s.statValue}>{applies}+</span>
            <span style={s.statLabel}>Auto-applies per month free</span>
          </div>
          <div data-landing-stats-divider="" style={s.statDivider} />
          <div style={s.statItem}>
            <span style={s.statValue}>{ats}</span>
            <span style={s.statLabel}>ATS platforms supported</span>
          </div>
          <div data-landing-stats-divider="" style={s.statDivider} />
          <div style={s.statItem}>
            <span style={s.statValue}>{uptime}%</span>
            <span style={s.statLabel}>Uptime reliability</span>
          </div>
          <div data-landing-stats-divider="" style={s.statDivider} />
          <div style={s.statItem}>
            <span style={{ ...s.statValue, fontSize: 'clamp(28px, 4vw, 44px)' }}>AI</span>
            <span style={s.statLabel}>Powered learning loop</span>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ---------- Testimonial Section ---------- */

function TestimonialSection() {
  const { ref, isVisible } = useScrollReveal()

  return (
    <section
      ref={ref}
      style={{
        ...s.testimonialSection,
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(24px)',
        transition: 'opacity 0.7s ease, transform 0.7s ease',
      }}
    >
      <div style={s.container}>
        <div style={s.testimonialCard}>
          <div style={s.quoteMarks}>&ldquo;</div>
          <p style={s.quoteText}>
            I went from spending 3 hours a day on applications to waking up with 10 new submissions. The ghost detection alone saved me weeks of wasted follow-ups.
          </p>
          <div style={s.quoteAuthor}>
            <div style={s.quoteAvatar}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#000' }}>SK</span>
            </div>
            <div>
              <div style={s.quoteName}>Sarah K.</div>
              <div style={s.quoteRole}>Senior UX Designer, landed role at Shopify</div>
            </div>
          </div>
          <div style={s.quoteStars}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Star key={i} size={14} fill="#f59e0b" color="#f59e0b" />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

/* ---------- Pricing Card ---------- */

function PricingCard({
  name,
  price,
  period,
  description,
  features,
  featured = false,
  cta,
  onCta,
}: {
  name: string
  price: number
  period: 'monthly' | 'annual'
  description: string
  features: string[]
  featured?: boolean
  cta: string
  onCta: () => void
}) {
  const { ref, isVisible } = useScrollReveal()

  return (
    <div
      ref={ref}
      {...(featured ? { 'data-landing-pricing-featured': '' } : {})}
      style={{
        ...s.pricingCard,
        ...(featured ? s.pricingCardFeatured : {}),
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0) scale(1)' : 'translateY(16px) scale(0.98)',
        transition: 'opacity 0.5s ease, transform 0.5s ease',
      }}
    >
      {featured && (
        <div style={s.pricingRecommended}>Recommended</div>
      )}
      <div>
        <h3 style={s.pricingName}>{name}</h3>
        <p style={s.pricingDescription}>{description}</p>
      </div>
      <div style={s.pricingPriceRow}>
        <span style={s.pricingCurrency}>$</span>
        <span style={s.pricingAmount}>{price}</span>
        <span style={s.pricingPeriod}>/{period === 'monthly' ? 'mo' : 'mo'}</span>
      </div>
      <button
        onClick={onCta}
        style={featured ? s.pricingCTAFeatured : s.pricingCTA}
      >
        {cta}
        <ArrowRight size={14} />
      </button>
      <ul style={s.pricingFeatures}>
        {features.map((f, i) => (
          <li key={i} style={s.pricingFeatureItem}>
            <Check size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- Final CTA Content ---------- */

function FinalCTAContent({ onGetStarted }: { onGetStarted: () => void }) {
  const { ref, isVisible } = useScrollReveal()
  const btnRef = useRef<HTMLButtonElement>(null)

  const handleRipple = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const btn = btnRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const size = Math.max(rect.width, rect.height) * 2

    const ripple = document.createElement('span')
    ripple.style.cssText = `
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(255,255,255,0.25) 0%, rgba(52,211,153,0.18) 40%, transparent 70%);
      pointer-events: none;
      animation: landing-ripple 0.7s ease-out forwards;
    `
    btn.appendChild(ripple)
    ripple.addEventListener('animationend', () => ripple.remove())
  }, [])

  return (
    <div
      ref={ref}
      style={{
        ...s.finalCTAInner,
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(24px)',
        transition: 'opacity 0.7s ease, transform 0.7s ease',
      }}
    >
      <h2 style={s.finalTitle}>Ready to apply smarter?</h2>
      <p style={s.finalSub}>
        Join hundreds of job seekers automating their search. Start free today.
      </p>
      <button
        ref={btnRef}
        onClick={onGetStarted}
        onMouseEnter={handleRipple}
        style={{ ...s.btnPrimaryLarge, position: 'relative' as const, overflow: 'hidden' as const }}
      >
        Get started for free
        <ArrowRight size={18} />
      </button>
      <p style={s.heroMicro}>
        No credit card required &middot; Free forever &middot; Cancel anytime
      </p>
    </div>
  )
}

/* ---------- Ambient Background ---------- */

/* ------------------------------------------------------------------ */
/*  Interactive Particle Canvas — Neural Network Constellation          */
/* ------------------------------------------------------------------ */

/* ---- Boid particle (fish-like flocking) ---- */
interface Boid {
  x: number
  y: number
  vx: number
  vy: number
  size: number        // 1.2 - 4  (simulates depth)
  depth: number       // 0-1 where 0 = far / dim, 1 = near / bright
  hue: number         // individual color offset within green-cyan palette
  trail: { x: number; y: number }[] // last N positions for trail rendering
}

/* palette constants */
const BOID_COUNT = 140
const TRAIL_LENGTH = 3
const GRID_CELL = 80          // spatial hash cell for neighbor lookup
const NEIGHBOR_RADIUS = 70    // boids within this are "neighbors"
const SEPARATION_DIST = 28    // too-close threshold
const MAX_SPEED_BASE = 1.6
const MAX_FORCE = 0.045

/* boid weights */
const W_SEPARATION = 1.8
const W_ALIGNMENT = 1.0
const W_COHESION = 0.9
const W_CURRENT = 0.35        // ocean current pull

/* mouse avoidance */
const MOUSE_AVOID_RADIUS = 180
const MOUSE_AVOID_STRENGTH = 3.5

function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useRef({ x: -9999, y: -9999 })
  const boidsRef = useRef<Boid[]>([])
  const animFrameRef = useRef(0)
  const currentAngleRef = useRef(Math.random() * Math.PI * 2)
  const currentTargetRef = useRef(Math.random() * Math.PI * 2)
  const currentChangeTimerRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) return

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1

    const resize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    /* --- helpers --- */
    const clampMag = (vx: number, vy: number, max: number) => {
      const mag = Math.sqrt(vx * vx + vy * vy)
      if (mag > max && mag > 0) {
        const s = max / mag
        return { x: vx * s, y: vy * s }
      }
      return { x: vx, y: vy }
    }

    /* --- init boids --- */
    const initBoids = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      const boids: Boid[] = []
      for (let i = 0; i < BOID_COUNT; i++) {
        const depth = Math.random()
        const angle = Math.random() * Math.PI * 2
        const speed = 0.3 + Math.random() * 0.7
        boids.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 1.2 + depth * 2.8,
          depth,
          hue: 155 + Math.random() * 40, // 155-195 = green to cyan range
          trail: [],
        })
      }
      boidsRef.current = boids
    }
    initBoids()

    /* --- mouse --- */
    const onMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX
      mouseRef.current.y = e.clientY
    }
    const onMouseLeave = () => {
      mouseRef.current.x = -9999
      mouseRef.current.y = -9999
    }
    window.addEventListener('mousemove', onMouseMove, { passive: true })
    document.addEventListener('mouseleave', onMouseLeave)

    /* --- resize --- */
    let resizeTimer = 0
    const onResize = () => {
      clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(resize, 150)
    }
    window.addEventListener('resize', onResize, { passive: true })

    /* --- spatial hash --- */
    const buildGrid = (boids: Boid[], cellSize: number) => {
      const grid: Map<string, number[]> = new Map()
      for (let i = 0; i < boids.length; i++) {
        const cx = Math.floor(boids[i].x / cellSize)
        const cy = Math.floor(boids[i].y / cellSize)
        const key = `${cx},${cy}`
        const cell = grid.get(key)
        if (cell) cell.push(i)
        else grid.set(key, [i])
      }
      return grid
    }

    /* --- animation --- */
    let lastTime = 0

    const animate = (timestamp: number) => {
      const dt = lastTime === 0 ? 16.67 : Math.min(timestamp - lastTime, 50)
      lastTime = timestamp
      const dtFactor = dt / 16.67 // normalize to ~60fps

      const w = window.innerWidth
      const h = window.innerHeight
      const t = timestamp * 0.001

      /* --- evolve ocean current direction --- */
      currentChangeTimerRef.current -= dt
      if (currentChangeTimerRef.current <= 0) {
        currentTargetRef.current = Math.random() * Math.PI * 2
        currentChangeTimerRef.current = 4000 + Math.random() * 6000 // change every 4-10s
      }
      // ease current angle toward target
      let angleDiff = currentTargetRef.current - currentAngleRef.current
      // normalize to -PI..PI
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2
      currentAngleRef.current += angleDiff * 0.005 * dtFactor
      const currentVX = Math.cos(currentAngleRef.current)
      const currentVY = Math.sin(currentAngleRef.current)

      /* --- fade previous frame (creates faint trail on canvas) --- */
      ctx.clearRect(0, 0, w, h)

      const boids = boidsRef.current
      const mx = mouseRef.current.x
      const my = mouseRef.current.y
      const mouseActive = mx > -999

      /* --- build spatial hash --- */
      const grid = buildGrid(boids, GRID_CELL)

      /* --- update each boid --- */
      for (let i = 0; i < boids.length; i++) {
        const b = boids[i]
        const maxSpeed = MAX_SPEED_BASE * (0.5 + b.depth * 0.8) // deeper = slower

        // save trail position BEFORE move
        b.trail.push({ x: b.x, y: b.y })
        if (b.trail.length > TRAIL_LENGTH) b.trail.shift()

        /* --- find neighbors via spatial hash --- */
        const cx = Math.floor(b.x / GRID_CELL)
        const cy = Math.floor(b.y / GRID_CELL)

        let sepX = 0, sepY = 0, sepCount = 0
        let aliX = 0, aliY = 0, aliCount = 0
        let cohX = 0, cohY = 0, cohCount = 0

        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const cell = grid.get(`${cx + dx},${cy + dy}`)
            if (!cell) continue
            for (const j of cell) {
              if (j === i) continue
              const other = boids[j]
              const ddx = b.x - other.x
              const ddy = b.y - other.y
              const d2 = ddx * ddx + ddy * ddy
              const dist = Math.sqrt(d2)

              if (dist < NEIGHBOR_RADIUS && dist > 0) {
                // Separation
                if (dist < SEPARATION_DIST) {
                  sepX += ddx / dist / dist * SEPARATION_DIST
                  sepY += ddy / dist / dist * SEPARATION_DIST
                  sepCount++
                }
                // Alignment
                aliX += other.vx
                aliY += other.vy
                aliCount++
                // Cohesion
                cohX += other.x
                cohY += other.y
                cohCount++
              }
            }
          }
        }

        let steerX = 0, steerY = 0

        // Separation force
        if (sepCount > 0) {
          sepX /= sepCount
          sepY /= sepCount
          const mag = Math.sqrt(sepX * sepX + sepY * sepY)
          if (mag > 0) {
            steerX += (sepX / mag * maxSpeed - b.vx) * W_SEPARATION
            steerY += (sepY / mag * maxSpeed - b.vy) * W_SEPARATION
          }
        }

        // Alignment force
        if (aliCount > 0) {
          aliX /= aliCount
          aliY /= aliCount
          const mag = Math.sqrt(aliX * aliX + aliY * aliY)
          if (mag > 0) {
            steerX += (aliX / mag * maxSpeed - b.vx) * W_ALIGNMENT
            steerY += (aliY / mag * maxSpeed - b.vy) * W_ALIGNMENT
          }
        }

        // Cohesion force
        if (cohCount > 0) {
          cohX = cohX / cohCount - b.x
          cohY = cohY / cohCount - b.y
          const mag = Math.sqrt(cohX * cohX + cohY * cohY)
          if (mag > 0) {
            steerX += (cohX / mag * maxSpeed - b.vx) * W_COHESION
            steerY += (cohY / mag * maxSpeed - b.vy) * W_COHESION
          }
        }

        // Ocean current force (with subtle per-particle variation)
        const currentNoise = Math.sin(t * 0.3 + i * 0.7) * 0.3
        steerX += (currentVX + currentNoise * 0.5) * W_CURRENT
        steerY += (currentVY + Math.cos(t * 0.2 + i * 0.5) * 0.3) * W_CURRENT

        // Mouse avoidance (scatter then flow around)
        if (mouseActive) {
          const dmx = b.x - mx
          const dmy = b.y - my
          const mDist = Math.sqrt(dmx * dmx + dmy * dmy)
          if (mDist < MOUSE_AVOID_RADIUS && mDist > 1) {
            const falloff = 1 - mDist / MOUSE_AVOID_RADIUS
            const avoidForce = falloff * falloff * MOUSE_AVOID_STRENGTH
            // Push away from cursor
            steerX += (dmx / mDist) * avoidForce
            steerY += (dmy / mDist) * avoidForce
            // Add a gentle tangential force so they flow around, not just bounce away
            steerX += (-dmy / mDist) * avoidForce * 0.35
            steerY += (dmx / mDist) * avoidForce * 0.35
          }
        }

        // Clamp steering force
        const clamped = clampMag(steerX, steerY, MAX_FORCE * dtFactor * 10)

        // Apply
        b.vx += clamped.x * dtFactor
        b.vy += clamped.y * dtFactor

        // Clamp velocity
        const vel = clampMag(b.vx, b.vy, maxSpeed)
        b.vx = vel.x
        b.vy = vel.y

        b.x += b.vx * dtFactor
        b.y += b.vy * dtFactor

        // Wrap edges with margin
        const margin = 30
        if (b.x < -margin) b.x += w + margin * 2
        else if (b.x > w + margin) b.x -= w + margin * 2
        if (b.y < -margin) b.y += h + margin * 2
        else if (b.y > h + margin) b.y -= h + margin * 2
      }

      /* --- draw trails --- */
      for (let i = 0; i < boids.length; i++) {
        const b = boids[i]
        if (b.trail.length < 2) continue

        const baseAlpha = 0.08 + b.depth * 0.12 // deeper = dimmer trails
        for (let t = 0; t < b.trail.length; t++) {
          const frac = t / b.trail.length
          const alpha = baseAlpha * frac * 0.5
          const r = b.size * frac * 0.6
          if (r < 0.3) continue
          ctx.beginPath()
          ctx.arc(b.trail[t].x, b.trail[t].y, r, 0, Math.PI * 2)
          ctx.fillStyle = `hsla(${b.hue}, 80%, 65%, ${alpha})`
          ctx.fill()
        }
      }

      /* --- draw subtle connection lines between close neighbors --- */
      const connDist = 55
      const connDist2 = connDist * connDist
      for (let i = 0; i < boids.length; i++) {
        const a = boids[i]
        const cx = Math.floor(a.x / GRID_CELL)
        const cy = Math.floor(a.y / GRID_CELL)
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const cell = grid.get(`${cx + dx},${cy + dy}`)
            if (!cell) continue
            for (const j of cell) {
              if (j <= i) continue
              const bb = boids[j]
              const ddx = a.x - bb.x
              const ddy = a.y - bb.y
              const d2 = ddx * ddx + ddy * ddy
              if (d2 > connDist2) continue

              const dist = Math.sqrt(d2)
              const alpha = (1 - dist / connDist) * 0.04 * Math.min(a.depth, bb.depth)
              if (alpha < 0.003) continue

              ctx.beginPath()
              ctx.moveTo(a.x, a.y)
              ctx.lineTo(bb.x, bb.y)
              ctx.strokeStyle = `hsla(170, 70%, 60%, ${alpha})`
              ctx.lineWidth = 0.4
              ctx.stroke()
            }
          }
        }
      }

      /* --- draw mouse glow (subtle avoidance halo) --- */
      if (mouseActive) {
        const grad = ctx.createRadialGradient(mx, my, 0, mx, my, MOUSE_AVOID_RADIUS * 0.7)
        grad.addColorStop(0, 'rgba(6, 182, 212, 0.04)')
        grad.addColorStop(1, 'rgba(6, 182, 212, 0)')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(mx, my, MOUSE_AVOID_RADIUS * 0.7, 0, Math.PI * 2)
        ctx.fill()
      }

      /* --- draw boids (particles) --- */
      for (let i = 0; i < boids.length; i++) {
        const b = boids[i]
        const alpha = 0.25 + b.depth * 0.55 // depth affects opacity
        const lightness = 55 + b.depth * 15  // brighter when closer

        ctx.save()
        ctx.shadowColor = `hsla(${b.hue}, 80%, ${lightness}%, ${alpha * 0.8})`
        ctx.shadowBlur = b.size * 2.5
        ctx.beginPath()
        ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2)
        ctx.fillStyle = `hsla(${b.hue}, 80%, ${lightness}%, ${alpha})`
        ctx.fill()
        ctx.restore()
      }

      animFrameRef.current = requestAnimationFrame(animate)
    }

    animFrameRef.current = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      window.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseleave', onMouseLeave)
      window.removeEventListener('resize', onResize)
      clearTimeout(resizeTimer)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  )
}

/* ================================================================== */
/*  STYLES                                                              */
/* ================================================================== */

const s: Record<string, React.CSSProperties> = {
  /* ---------- Page ---------- */
  page: {
    width: '100vw',
    minHeight: '100vh',
    background: '#09090b',
    overflowX: 'hidden',
    position: 'relative',
  },

  /* ---------- (Ambient Background removed — replaced by ParticleCanvas) ---------- */

  container: {
    maxWidth: 1140,
    margin: '0 auto',
    padding: '0 24px',
  },

  /* ---------- Nav ---------- */
  nav: {
    position: 'sticky',
    top: 0,
    zIndex: 200,
    background: 'rgba(9, 9, 11, 0.85)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  navInner: {
    maxWidth: 1140,
    margin: '0 auto',
    padding: '0 24px',
    height: 60,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  logoMark: {
    width: 30,
    height: 30,
    borderRadius: 8,
    background: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 17,
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '-0.02em',
  },
  navCenter: {
    display: 'flex',
    alignItems: 'center',
    gap: 32,
  },
  navLink: {
    fontSize: 14,
    color: 'var(--text-secondary)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px 0',
    transition: 'color 150ms ease',
    fontFamily: 'inherit',
  },
  navRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  navSignIn: {
    fontSize: 14,
    color: 'var(--text-secondary)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '6px 12px',
    fontFamily: 'inherit',
    transition: 'color 150ms ease',
  },
  navCTA: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 18px',
    fontSize: 13,
    fontWeight: 600,
    color: '#000',
    background: 'var(--accent)',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    border: 'none',
    transition: 'opacity 150ms ease, transform 100ms ease',
  },
  hamburger: {
    display: 'none',
    flexDirection: 'column',
    gap: 4,
    padding: 8,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
  },
  hamburgerLine: {
    display: 'block',
    width: 18,
    height: 2,
    borderRadius: 1,
    background: 'var(--text-secondary)',
    transition: 'all 200ms ease',
  },
  mobileMenu: {
    display: 'flex',
    flexDirection: 'column',
    padding: '12px 24px 20px',
    gap: 4,
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  mobileMenuLink: {
    fontSize: 15,
    color: 'var(--text-secondary)',
    padding: '10px 0',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left' as const,
    fontFamily: 'inherit',
  },
  mobileMenuDivider: {
    height: 1,
    background: 'rgba(255,255,255,0.06)',
    margin: '4px 0',
  },
  mobileMenuCTA: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '12px 20px',
    fontSize: 15,
    fontWeight: 600,
    color: '#000',
    background: 'var(--accent)',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    border: 'none',
    marginTop: 8,
  },

  /* ---------- Hero ---------- */
  hero: {
    position: 'relative',
    zIndex: 1,
    maxWidth: 1140,
    margin: '0 auto',
    padding: '80px 24px 40px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    overflow: 'visible',
  },
  heroGlow: {
    position: 'absolute',
    top: -120,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 600,
    height: 400,
    borderRadius: '50%',
    background: 'radial-gradient(ellipse, rgba(52, 211, 153, 0.08) 0%, transparent 70%)',
    pointerEvents: 'none',
    zIndex: 0,
  },
  heroContent: {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  heroBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 16px 6px 12px',
    borderRadius: 24,
    background: 'rgba(52, 211, 153, 0.06)',
    border: '1px solid rgba(52, 211, 153, 0.12)',
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    marginBottom: 32,
    animation: 'landing-fadeUp 0.6s ease both',
  },
  heroBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'var(--accent)',
    animation: 'landing-pulse 2s ease infinite',
  },
  heroTitle: {
    fontSize: 'clamp(2.5rem, 5vw, 4.5rem)',
    fontWeight: 800,
    color: '#fff',
    lineHeight: 1.08,
    letterSpacing: '-0.04em',
    marginBottom: 24,
    background: 'linear-gradient(135deg, #ffffff 30%, var(--accent) 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    animation: 'landing-fadeUp 0.6s ease 0.1s both',
  },
  heroSub: {
    fontSize: 'clamp(16px, 2vw, 19px)',
    color: 'var(--text-secondary)',
    maxWidth: 560,
    lineHeight: 1.65,
    marginBottom: 36,
    animation: 'landing-fadeUp 0.6s ease 0.2s both',
  },
  heroCTARow: {
    display: 'flex',
    gap: 14,
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 16,
    animation: 'landing-fadeUp 0.6s ease 0.3s both',
  },
  heroMicro: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
    animation: 'landing-fadeUp 0.6s ease 0.4s both',
  },

  /* ---------- Scroll Indicator ---------- */
  scrollIndicator: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    marginTop: 40,
    animation: 'landing-fadeUp 0.6s ease 0.8s both',
    zIndex: 1,
  },
  scrollIndicatorMouse: {
    width: 20,
    height: 32,
    borderRadius: 10,
    border: '1.5px solid rgba(255,255,255,0.15)',
    display: 'flex',
    justifyContent: 'center',
    paddingTop: 6,
  },
  scrollIndicatorDot: {
    width: 3,
    height: 6,
    borderRadius: 2,
    background: 'var(--accent)',
    animation: 'landing-scroll-bounce 2s ease infinite',
  },

  /* ---------- Buttons ---------- */
  btnPrimary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '14px 32px',
    fontSize: 15,
    fontWeight: 600,
    color: '#000',
    background: 'var(--accent)',
    borderRadius: 10,
    cursor: 'pointer',
    border: 'none',
    fontFamily: 'inherit',
    transition: 'all 200ms ease',
    boxShadow: '0 0 20px rgba(52, 211, 153, 0.15), 0 0 60px rgba(52, 211, 153, 0.05)',
    animation: 'landing-cta-glow 3s ease infinite',
  },
  btnPrimaryLarge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    padding: '18px 40px',
    fontSize: 17,
    fontWeight: 600,
    color: '#000',
    background: 'var(--accent)',
    borderRadius: 12,
    cursor: 'pointer',
    border: 'none',
    fontFamily: 'inherit',
    transition: 'all 200ms ease',
    boxShadow: '0 0 20px rgba(52, 211, 153, 0.15), 0 0 60px rgba(52, 211, 153, 0.05)',
    animation: 'landing-cta-glow 3s ease infinite',
  },
  btnGhost: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '14px 28px',
    fontSize: 15,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 200ms ease',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
  },

  /* ---------- Hero Mockup ---------- */
  heroMockupWrap: {
    position: 'relative',
    width: '100%',
    maxWidth: 780,
    marginTop: 48,
    zIndex: 1,
  },
  mockupGlow: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '100%',
    height: '100%',
    borderRadius: 16,
    background: 'radial-gradient(ellipse, rgba(52, 211, 153, 0.06) 0%, transparent 60%)',
    pointerEvents: 'none',
    zIndex: 0,
  },
  mockupFrame: {
    position: 'relative',
    zIndex: 1,
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.08)',
    overflow: 'hidden',
    background: '#111113',
    boxShadow: '0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(52, 211, 153, 0.04)',
  },
  mockupChrome: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    background: '#0e0e10',
  },
  chromeDots: {
    display: 'flex',
    gap: 6,
  },
  chromeDot: {
    display: 'block',
    width: 10,
    height: 10,
    borderRadius: '50%',
  },
  chromeUrlBar: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    fontSize: 11,
    color: 'var(--text-tertiary)',
  },
  mockupDash: {
    display: 'flex',
    minHeight: 220,
  },
  mockupSidebar: {
    width: 100,
    borderRight: '1px solid rgba(255,255,255,0.06)',
    padding: '12px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  mockupSideItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    fontSize: 9,
    borderRadius: 0,
    transition: 'all 150ms ease',
  },
  mockupMain: {
    flex: 1,
    padding: '12px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  mockupStatRow: {
    display: 'flex',
    gap: 6,
    padding: '0 10px',
  },
  mockupStatCard: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '8px 10px',
    background: 'rgba(255,255,255,0.02)',
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.04)',
  },
  mockupFeed: {
    padding: '0 10px',
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: 'var(--accent)',
    animation: 'landing-pulse 2s ease infinite',
    boxShadow: '0 0 4px rgba(52, 211, 153, 0.6)',
  },
  activityRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '5px 10px',
    borderRadius: 5,
    marginBottom: 2,
    background: 'rgba(255,255,255,0.01)',
  },

  /* ---------- Logo Strip ---------- */
  logoSection: {
    position: 'relative',
    zIndex: 1,
    padding: '40px 24px',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    borderTop: '1px solid rgba(255,255,255,0.04)',
  },
  logoSectionLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-tertiary)',
    textAlign: 'center',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    marginBottom: 24,
  },
  logoGrid: {
    maxWidth: 900,
    margin: '0 auto',
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 32,
    alignItems: 'center',
  },
  logoItem: {
    display: 'flex',
    alignItems: 'center',
  },
  logoName: {
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--text-tertiary)',
    opacity: 0.5,
    letterSpacing: '-0.01em',
    transition: 'opacity 200ms ease',
  },

  /* ---------- Sections ---------- */
  sectionDark: {
    position: 'relative',
    zIndex: 1,
    padding: '100px 24px',
  },
  sectionAlt: {
    position: 'relative',
    zIndex: 1,
    padding: '100px 24px',
    background: 'rgba(255,255,255,0.015)',
    borderTop: '1px solid rgba(255,255,255,0.04)',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  sectionLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 14px',
    borderRadius: 20,
    background: 'rgba(52, 211, 153, 0.06)',
    border: '1px solid rgba(52, 211, 153, 0.1)',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--accent)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 'clamp(28px, 4vw, 42px)',
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '-0.03em',
    lineHeight: 1.15,
    marginBottom: 16,
  },
  sectionSubtitle: {
    fontSize: 'clamp(15px, 1.5vw, 17px)',
    color: 'var(--text-secondary)',
    maxWidth: 540,
    margin: '0 auto',
    lineHeight: 1.6,
  },

  /* ---------- Feature Rows ---------- */
  featureRow: {
    display: 'flex',
    gap: 48,
    alignItems: 'center',
    marginBottom: 80,
  },
  featureText: {
    flex: 1,
    minWidth: 280,
  },
  featureIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  featureLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-tertiary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    marginBottom: 8,
    display: 'block',
  },
  featureTitle: {
    fontSize: 'clamp(22px, 3vw, 28px)',
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '-0.02em',
    lineHeight: 1.2,
    marginBottom: 12,
  },
  featureDesc: {
    fontSize: 15,
    color: 'var(--text-secondary)',
    lineHeight: 1.7,
    maxWidth: 420,
  },
  featureMockupWrap: {
    flex: 1,
    minWidth: 280,
    display: 'flex',
    justifyContent: 'center',
  },

  /* ---------- Mini Mockups ---------- */
  miniMockup: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.06)',
    background: '#111113',
    overflow: 'hidden',
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
  },
  miniHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    background: '#0e0e10',
  },
  miniRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 14px',
    borderBottom: '1px solid rgba(255,255,255,0.03)',
  },

  /* ---------- How It Works Steps ---------- */
  stepsRow: {
    display: 'flex',
    gap: 24,
    justifyContent: 'center',
    position: 'relative',
  },
  stepItem: {
    flex: 1,
    maxWidth: 320,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    position: 'relative',
    padding: '0 16px',
  },
  stepConnector: {
    position: 'absolute',
    top: 24,
    right: -12,
    width: 24,
    height: 2,
    background: 'rgba(52, 211, 153, 0.2)',
    zIndex: 0,
  },
  stepNumCircle: {
    width: 48,
    height: 48,
    borderRadius: '50%',
    background: 'rgba(52, 211, 153, 0.1)',
    border: '1px solid rgba(52, 211, 153, 0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    position: 'relative',
    zIndex: 1,
  },
  stepNum: {
    fontSize: 18,
    fontWeight: 700,
    color: 'var(--accent)',
  },
  stepIconWrap: {
    marginBottom: 12,
  },
  stepTitle: {
    fontSize: 17,
    fontWeight: 600,
    color: '#fff',
    marginBottom: 8,
  },
  stepDesc: {
    fontSize: 14,
    color: 'var(--text-secondary)',
    lineHeight: 1.6,
  },

  /* ---------- Stats ---------- */
  statsSection: {
    position: 'relative',
    zIndex: 1,
    padding: '64px 24px',
    background: 'linear-gradient(135deg, rgba(52, 211, 153, 0.04) 0%, rgba(96, 165, 250, 0.04) 100%)',
    borderTop: '1px solid rgba(255,255,255,0.04)',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  statsGrid: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 40,
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    minWidth: 140,
  },
  statValue: {
    fontSize: 'clamp(32px, 4vw, 48px)',
    fontWeight: 800,
    color: 'var(--accent)',
    letterSpacing: '-0.03em',
    lineHeight: 1,
  },
  statLabel: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    textAlign: 'center',
  },
  statDivider: {
    width: 1,
    height: 48,
    background: 'rgba(255,255,255,0.06)',
  },

  /* ---------- Testimonial ---------- */
  testimonialSection: {
    position: 'relative',
    zIndex: 1,
    padding: '80px 24px',
  },
  testimonialCard: {
    maxWidth: 640,
    margin: '0 auto',
    textAlign: 'center',
    position: 'relative',
  },
  quoteMarks: {
    fontSize: 60,
    fontWeight: 700,
    color: 'rgba(52, 211, 153, 0.15)',
    lineHeight: 1,
    marginBottom: -8,
  },
  quoteText: {
    fontSize: 'clamp(17px, 2vw, 20px)',
    color: 'var(--text-primary)',
    lineHeight: 1.7,
    fontStyle: 'italic',
    marginBottom: 28,
  },
  quoteAuthor: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 16,
  },
  quoteAvatar: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    background: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quoteName: {
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
    textAlign: 'left',
  },
  quoteRole: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    textAlign: 'left',
  },
  quoteStars: {
    display: 'flex',
    justifyContent: 'center',
    gap: 2,
  },

  /* ---------- Pricing ---------- */
  billingToggle: {
    display: 'flex',
    justifyContent: 'center',
    gap: 4,
    padding: 4,
    borderRadius: 10,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    marginBottom: 48,
    width: 'fit-content',
    margin: '0 auto 48px',
  },
  billingBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 20px',
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    background: 'transparent',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 200ms ease',
  },
  billingBtnActive: {
    background: 'rgba(255,255,255,0.08)',
    color: '#fff',
    fontWeight: 600,
  },
  saveBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: '#000',
    background: 'var(--accent)',
    padding: '1px 6px',
    borderRadius: 4,
  },
  pricingGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 16,
    maxWidth: 1080,
    margin: '0 auto',
  },
  pricingCard: {
    padding: '28px 24px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    position: 'relative',
    transition: 'border-color 300ms ease, box-shadow 300ms ease',
  },
  pricingCardFeatured: {
    border: '1px solid rgba(52, 211, 153, 0.4)',
    background: 'linear-gradient(180deg, rgba(52, 211, 153, 0.06) 0%, rgba(52, 211, 153, 0.01) 100%)',
    boxShadow: '0 0 40px rgba(52, 211, 153, 0.08), 0 0 80px rgba(52, 211, 153, 0.03), inset 0 1px 0 rgba(52, 211, 153, 0.1)',
    transform: 'scale(1.02)',
  },
  pricingRecommended: {
    position: 'absolute',
    top: -11,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '4px 14px',
    borderRadius: 20,
    background: 'var(--accent)',
    color: '#000',
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
  },
  pricingName: {
    fontSize: 18,
    fontWeight: 600,
    color: '#fff',
  },
  pricingDescription: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
    marginTop: 2,
  },
  pricingPriceRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 2,
  },
  pricingCurrency: {
    fontSize: 18,
    fontWeight: 500,
    color: 'var(--text-secondary)',
  },
  pricingAmount: {
    fontSize: 40,
    fontWeight: 800,
    color: '#fff',
    letterSpacing: '-0.03em',
    lineHeight: 1,
  },
  pricingPeriod: {
    fontSize: 14,
    color: 'var(--text-tertiary)',
  },
  pricingCTA: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 150ms ease',
  },
  pricingCTAFeatured: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '10px 20px',
    fontSize: 14,
    fontWeight: 600,
    color: '#000',
    background: 'var(--accent)',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 150ms ease',
  },
  pricingFeatures: {
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    margin: 0,
    padding: 0,
  },
  pricingFeatureItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    fontSize: 13,
    color: 'var(--text-secondary)',
  },

  /* ---------- Final CTA ---------- */
  finalCTA: {
    position: 'relative',
    zIndex: 1,
    padding: '100px 24px',
    overflow: 'hidden',
    background: 'linear-gradient(180deg, #09090b 0%, #0a1a14 50%, #09090b 100%)',
  },
  finalCTAGlow: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 600,
    height: 400,
    borderRadius: '50%',
    background: 'radial-gradient(ellipse, rgba(52, 211, 153, 0.1) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  ctaOrb1: {
    position: 'absolute',
    top: '15%',
    left: '10%',
    width: 420,
    height: 420,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(52, 211, 153, 0.16) 0%, transparent 70%)',
    filter: 'blur(100px)',
    animation: 'landing-cta-orb1 28s cubic-bezier(0.4, 0, 0.2, 1) infinite',
    willChange: 'transform',
    opacity: 0.85,
    pointerEvents: 'none',
  },
  ctaOrb2: {
    position: 'absolute',
    bottom: '10%',
    right: '8%',
    width: 380,
    height: 380,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(6, 182, 212, 0.14) 0%, transparent 70%)',
    filter: 'blur(110px)',
    animation: 'landing-cta-orb2 33s cubic-bezier(0.4, 0, 0.2, 1) infinite',
    willChange: 'transform',
    opacity: 0.8,
    pointerEvents: 'none',
  },
  finalCTAInner: {
    position: 'relative',
    zIndex: 1,
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 20,
  },
  finalTitle: {
    fontSize: 'clamp(28px, 4vw, 44px)',
    fontWeight: 700,
    color: '#fff',
    letterSpacing: '-0.03em',
    lineHeight: 1.15,
  },
  finalSub: {
    fontSize: 17,
    color: 'var(--text-secondary)',
    maxWidth: 480,
    lineHeight: 1.6,
  },

  /* ---------- Footer ---------- */
  footer: {
    position: 'relative',
    zIndex: 1,
    borderTop: '1px solid rgba(255,255,255,0.06)',
    background: 'linear-gradient(180deg, #09090b 0%, #060608 100%)',
  },
  footerInner: {
    maxWidth: 1140,
    margin: '0 auto',
    padding: '64px 24px 48px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 40,
  },
  footerLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  footerTagline: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
    lineHeight: 1.6,
  },
  footerColumns: {
    display: 'flex',
    gap: 64,
  },
  footerCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  footerColTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    marginBottom: 4,
  },
  footerLink: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
    textDecoration: 'none',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    padding: 0,
    textAlign: 'left' as const,
    transition: 'color 150ms ease',
  },
  footerBottom: {
    borderTop: '1px solid rgba(255,255,255,0.04)',
    padding: '16px 24px',
  },
  footerBottomInner: {
    maxWidth: 1140,
    margin: '0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  footerCopyright: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
  },
  footerBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    color: 'var(--text-tertiary)',
  },
}

/* ================================================================== */
/*  RESPONSIVE OVERRIDES via CSS-in-JS media query style tag            */
/* ================================================================== */

// Inject responsive styles once
const RESPONSIVE_ID = 'landing-responsive'

if (typeof document !== 'undefined' && !document.getElementById(RESPONSIVE_ID)) {
  const style = document.createElement('style')
  style.id = RESPONSIVE_ID
  style.textContent = `
    /* ===== Hover effects ===== */

    /* Nav link hover */
    [data-landing-page] nav button:hover {
      color: #fff !important;
    }

    /* Primary CTA hover — scale + intensify glow */
    [data-landing-page] button[style*="var(--accent)"] {
      transition: all 200ms ease !important;
    }
    [data-landing-page] button[style*="var(--accent)"]:hover {
      transform: translateY(-1px) scale(1.02) !important;
      box-shadow: 0 0 30px rgba(52, 211, 153, 0.35), 0 0 80px rgba(52, 211, 153, 0.12) !important;
      color: #000 !important;
    }
    [data-landing-page] button[style*="var(--accent)"]:active {
      transform: translateY(0) scale(0.99) !important;
    }

    /* Ghost button hover */
    [data-landing-page] button[style*="rgba(255,255,255,0.1)"]:hover {
      border-color: rgba(255,255,255,0.2) !important;
      background: rgba(255,255,255,0.06) !important;
      color: #fff !important;
    }

    /* Footer link hover */
    [data-landing-page] footer button:hover,
    [data-landing-page] footer a:hover {
      color: var(--text-primary) !important;
      text-decoration: none !important;
    }

    /* Logo name hover */
    [data-landing-page] [data-landing-logo-grid] > div:hover span {
      opacity: 0.8 !important;
    }

    /* Pricing card hover */
    [data-landing-page] [data-landing-pricing-grid] > div:hover {
      border-color: rgba(255,255,255,0.12) !important;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3) !important;
    }

    /* Featured pricing card animated glow border */
    [data-landing-pricing-featured] {
      position: relative !important;
      overflow: visible !important;
    }
    [data-landing-pricing-featured]::before {
      content: '';
      position: absolute;
      inset: -1px;
      border-radius: 15px;
      padding: 1px;
      background: conic-gradient(
        from var(--landing-glow-angle, 0deg),
        rgba(52, 211, 153, 0.4),
        rgba(96, 165, 250, 0.3),
        rgba(167, 139, 250, 0.3),
        rgba(52, 211, 153, 0.4)
      );
      -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      pointer-events: none;
      opacity: 0.7;
    }

    /* Section gradient dividers */
    [data-landing-section-divider] {
      height: 1px;
      background: linear-gradient(90deg,
        transparent 0%,
        rgba(52, 211, 153, 0.15) 20%,
        rgba(96, 165, 250, 0.15) 50%,
        rgba(167, 139, 250, 0.15) 80%,
        transparent 100%
      );
      border: none;
      margin: 0;
      position: relative;
      z-index: 1;
    }

    /* Mockup frame hover shimmer */
    [data-landing-page] [style*="mockupFrame"]:hover {
      box-shadow: 0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(52, 211, 153, 0.08) !important;
    }

    /* ===== Responsive ===== */

    @media (max-width: 768px) {
      [data-landing-nav-center] { display: none !important; }
      [data-landing-nav-right] { display: none !important; }
      [data-landing-hamburger] { display: flex !important; }
      [data-landing-feature-row] {
        flex-direction: column !important;
        gap: 32px !important;
      }
      [data-landing-steps-row] {
        flex-direction: column !important;
        gap: 40px !important;
        align-items: center !important;
      }
      [data-landing-step-connector] {
        display: none !important;
      }
      [data-landing-pricing-grid] {
        grid-template-columns: 1fr !important;
        max-width: 400px !important;
        margin-left: auto !important;
        margin-right: auto !important;
      }
      [data-landing-stats-divider] {
        display: none !important;
      }
      [data-landing-mockup-sidebar] {
        display: none !important;
      }
      [data-landing-footer-columns] {
        flex-direction: row !important;
        gap: 40px !important;
      }
      [data-landing-promise-grid] {
        grid-template-columns: 1fr !important;
        max-width: 400px !important;
        margin-left: auto !important;
        margin-right: auto !important;
      }
      [data-landing-promise-compare] {
        grid-template-columns: 1fr !important;
        max-width: 400px !important;
        margin-left: auto !important;
        margin-right: auto !important;
      }
      [data-landing-promise-legend] {
        flex-direction: column !important;
        gap: 12px !important;
      }
    }
    @media (max-width: 480px) {
      [data-landing-logo-grid] {
        gap: 20px !important;
      }
    }

    /* Reduced motion */
    @media (prefers-reduced-motion: reduce) {
      [data-landing-page] [style*="animation"] {
        animation: none !important;
      }
    }
  `
  document.head.appendChild(style)

  // Animate the conic-gradient border on the featured pricing card
  if (typeof requestAnimationFrame !== 'undefined') {
    let angle = 0
    const animateBorder = () => {
      angle = (angle + 0.5) % 360
      document.documentElement.style.setProperty('--landing-glow-angle', angle + 'deg')
      requestAnimationFrame(animateBorder)
    }
    requestAnimationFrame(animateBorder)
  }
}
