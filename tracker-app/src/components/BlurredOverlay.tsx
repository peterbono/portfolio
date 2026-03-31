import { useRef, useEffect, useState, type ReactNode } from 'react'
import { Lock, ArrowRight, Shield } from 'lucide-react'
import { useSupabase } from '../context/SupabaseContext'
import { useAuthWallContext } from '../context/AuthWallContext'

/* ------------------------------------------------------------------ */
/*  Feature config — maps feature key to display content               */
/* ------------------------------------------------------------------ */

const FEATURE_CONTENT: Record<
  string,
  { title: string; valueProp: string }
> = {
  table: {
    title: 'Application Tracker',
    valueProp: 'Track all your applications in one place',
  },
  pipeline: {
    title: 'Application Pipeline',
    valueProp: 'Visualize your application pipeline',
  },
  applications: {
    title: 'Applications',
    valueProp: 'Track and visualize your application pipeline',
  },
  analytics: {
    title: 'Intelligence',
    valueProp: 'See what\u2019s working with data-driven insights and analytics',
  },
  coach: {
    title: 'Career Coach',
    valueProp: 'Get AI-powered career coaching',
  },
  insights: {
    title: 'Insights',
    valueProp: 'Learn from every application with Thompson Sampling',
  },
}

/* ------------------------------------------------------------------ */
/*  BlurredOverlay component                                           */
/* ------------------------------------------------------------------ */

interface BlurredOverlayProps {
  children: ReactNode
  feature: string // "applications" | "insights" | "coach" | "table" | "pipeline"
  previewRows?: number // How many rows/items to show before blur (default: 3)
}

export function BlurredOverlay({
  children,
  feature,
  previewRows = 3,
}: BlurredOverlayProps) {
  const { session } = useSupabase()
  const { showAuthWall } = useAuthWallContext()
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  // Fade-in on mount for non-authenticated users
  useEffect(() => {
    if (!session) {
      // Small delay so the content renders first, then blur fades in
      const t = setTimeout(() => setVisible(true), 50)
      return () => clearTimeout(t)
    }
  }, [session])

  // Smooth fade-out when user signs in
  useEffect(() => {
    if (session) {
      setVisible(false)
    }
  }, [session])

  // Authenticated user — render children directly
  if (session) {
    return <>{children}</>
  }

  const content = FEATURE_CONTENT[feature] ?? {
    title: 'This Feature',
    valueProp: 'Sign up to unlock full access',
  }

  const handleCTA = () => {
    showAuthWall('start_bot', () => {
      // After auth, the blur will fade away via the session effect
    })
  }

  // Calculate the preview height based on previewRows
  // Each "row" is roughly 52px for tables, 120px for cards
  const rowHeight = feature === 'pipeline' ? 140 : feature === 'analytics' ? 180 : feature === 'applications' ? 52 : 52
  const previewHeight = previewRows * rowHeight

  return (
    <div ref={containerRef} style={styles.wrapper}>
      {/* Content layer — fully rendered but partially masked */}
      <div style={styles.contentLayer}>
        {children}
      </div>

      {/* Blur overlay — positioned over the content below the preview area */}
      <div
        style={{
          ...styles.blurLayer,
          top: previewHeight,
          opacity: visible ? 1 : 0,
        }}
      >
        {/* Gradient fade from transparent to blurred */}
        <div style={styles.gradientFade} />

        {/* Solid blur zone */}
        <div style={styles.solidBlur} />
      </div>

      {/* CTA card — centered over the blurred area */}
      <div
        style={{
          ...styles.ctaContainer,
          top: Math.max(previewHeight + 40, 200),
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(12px)',
        }}
      >
        <div style={styles.ctaCard}>
          {/* Lock icon */}
          <div style={styles.lockCircle}>
            <Lock size={20} color="var(--accent)" />
          </div>

          {/* Title */}
          <h3 style={styles.ctaTitle}>
            Sign up to unlock {content.title}
          </h3>

          {/* Value prop */}
          <p style={styles.ctaSubtitle}>
            {content.valueProp}
          </p>

          {/* CTA button */}
          <button
            onClick={handleCTA}
            style={styles.ctaButton}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#2dd4a0'
              e.currentTarget.style.transform = 'translateY(-1px)'
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(52, 211, 153, 0.25)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--accent)'
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 4px 16px rgba(52, 211, 153, 0.15)'
            }}
          >
            Start for free
            <ArrowRight size={16} />
          </button>

          {/* Trust line */}
          <p style={styles.trustLine}>
            <Shield size={11} color="var(--text-tertiary)" />
            No credit card required
          </p>
        </div>
      </div>

      {/* Pointer-events blocker over blurred content (but not the CTA) */}
      <div
        style={{
          ...styles.interactionBlocker,
          top: previewHeight,
          opacity: visible ? 1 : 0,
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: 'relative',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },

  contentLayer: {
    position: 'relative',
    minHeight: '100%',
  },

  blurLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    pointerEvents: 'none',
    transition: 'opacity 0.6s ease',
  },

  gradientFade: {
    height: 80,
    background: 'linear-gradient(to bottom, transparent, rgba(9, 9, 11, 0.6))',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    // Gradient mask for smooth fade
    maskImage: 'linear-gradient(to bottom, transparent, black)',
    WebkitMaskImage: 'linear-gradient(to bottom, transparent, black)',
  },

  solidBlur: {
    position: 'absolute',
    top: 80,
    left: 0,
    right: 0,
    bottom: 0,
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    background: 'rgba(9, 9, 11, 0.45)',
  },

  ctaContainer: {
    position: 'absolute',
    left: '50%',
    zIndex: 20,
    transition: 'opacity 0.5s ease 0.15s, transform 0.5s ease 0.15s',
  },

  ctaCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    padding: '28px 36px 24px',
    background: 'rgba(17, 17, 19, 0.92)',
    border: '1px solid rgba(52, 211, 153, 0.12)',
    borderRadius: 16,
    boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.03)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    textAlign: 'center',
    minWidth: 320,
    maxWidth: 400,
  },

  lockCircle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    background: 'rgba(52, 211, 153, 0.1)',
    border: '1px solid rgba(52, 211, 153, 0.15)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },

  ctaTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-primary)',
    lineHeight: 1.4,
    margin: 0,
  },

  ctaSubtitle: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
    margin: 0,
    maxWidth: 280,
  },

  ctaButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '10px 28px',
    fontSize: 14,
    fontWeight: 600,
    color: '#000',
    background: 'var(--accent)',
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: '0 4px 16px rgba(52, 211, 153, 0.15)',
    marginTop: 4,
    fontFamily: 'inherit',
  },

  trustLine: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    color: 'var(--text-tertiary)',
    margin: 0,
  },

  interactionBlocker: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 15,
    pointerEvents: 'auto',
    transition: 'opacity 0.6s ease',
    // Transparent click blocker — prevents interaction with blurred content
    // but the CTA card (z-index 20) sits above this
  },
}
