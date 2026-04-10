import React, { useState, useCallback, Suspense, Component, type ReactNode } from 'react'
import { SupabaseProvider, useSupabase } from './context/SupabaseContext'
import { JobsProvider } from './context/JobsContext'
import { UIProvider } from './context/UIContext'
import { ScoutProvider } from './context/ScoutContext'
// CoachProvider removed — Coach section deleted from dashboard
import { AuthWallProvider } from './context/AuthWallContext'
import { AppShell } from './layout/AppShell'
import { GmailSyncBridge } from './components/GmailSyncBridge'
import { BotRealtimeBridge } from './components/BotRealtimeBridge'
const AuthWall = React.lazy(() => import('./components/AuthWall').then(m => ({ default: m.AuthWall })))
const AuthView = React.lazy(() => import('./views/AuthView').then(m => ({ default: m.AuthView })))
const OnboardingWizard = React.lazy(() => import('./components/OnboardingWizard').then(m => ({ default: m.OnboardingWizard })))

/* ── App-level error boundary (EDGE-03) ── */
interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      const isNetwork = this.state.error?.message?.toLowerCase().includes('fetch') ||
        this.state.error?.message?.toLowerCase().includes('network') ||
        this.state.error?.message?.toLowerCase().includes('supabase')
      return (
        <div
          style={{
            width: '100vw',
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#09090b',
            color: '#e0e0e0',
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: 420, padding: 32 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                background: 'rgba(244, 63, 94, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
                fontSize: 24,
              }}
            >
              {isNetwork ? '\u{1F50C}' : '\u{26A0}\u{FE0F}'}
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
              {isNetwork ? 'Connection lost' : 'Something went wrong'}
            </h1>
            <p style={{ fontSize: 13, color: '#8a8a94', lineHeight: 1.6, marginBottom: 24 }}>
              {isNetwork
                ? 'Unable to reach the server. Check your internet connection and try again.'
                : 'An unexpected error occurred. Try refreshing the page.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '10px 24px',
                borderRadius: 10,
                border: 'none',
                background: '#34d399',
                color: '#000',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Refresh page
            </button>
            {this.state.error && (
              <pre
                style={{
                  marginTop: 20,
                  padding: 12,
                  background: '#111113',
                  border: '1px solid #1e1e24',
                  borderRadius: 8,
                  fontSize: 10,
                  color: '#8a8a94',
                  textAlign: 'left',
                  overflow: 'auto',
                  maxHeight: 100,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {this.state.error.message}
              </pre>
            )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

const LandingView = React.lazy(() => import('./views/LandingView').then(m => ({ default: m.LandingView })))

const ONBOARDING_KEY = 'tracker_v2_onboarding_done'
const VISITED_KEY = 'tracker_v2_visited'

function AppContent() {
  const { session, user, authLoading } = useSupabase()

  const [hasVisited, setHasVisited] = useState(
    () => localStorage.getItem(VISITED_KEY) === 'true'
  )
  const [onboardingDone, setOnboardingDone] = useState(
    () => localStorage.getItem(ONBOARDING_KEY) === 'true'
  )
  const [showAuthModal, setShowAuthModal] = useState(false)

  const handleGetStarted = useCallback(() => {
    localStorage.setItem(VISITED_KEY, 'true')
    setHasVisited(true)
  }, [])

  const handleBackToLanding = useCallback(() => {
    localStorage.removeItem(VISITED_KEY)
    setHasVisited(false)
  }, [])

  const handleSignIn = useCallback(() => {
    setShowAuthModal(true)
  }, [])

  const handleOnboardingComplete = useCallback(() => {
    setOnboardingDone(true)
  }, [])

  // Show a minimal loading state while checking session
  if (authLoading) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-base)',
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderWidth: 2,
            borderStyle: 'solid',
            borderColor: 'var(--border)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      </div>
    )
  }

  // First visit and not authenticated: show landing or auth
  if (!hasVisited && !session) {
    if (showAuthModal) {
      return <Suspense fallback={<div style={{ width: '100vw', height: '100vh', background: '#09090b' }} />}><AuthView onBack={() => setShowAuthModal(false)} /></Suspense>
    }
    return <Suspense fallback={<div style={{ width: '100vw', height: '100vh', background: '#09090b' }} />}><LandingView onGetStarted={handleGetStarted} onSignIn={handleSignIn} /></Suspense>
  }

  // Authenticated but onboarding not done: show wizard over dashboard
  const showOnboarding = session && !onboardingDone

  return (
    <UIProvider>
      <JobsProvider>
        <ScoutProvider>
          <AuthWallProvider>
            <GmailSyncBridge />
            <BotRealtimeBridge />
            {showOnboarding && (
              <Suspense fallback={null}>
                <OnboardingWizard
                  onComplete={handleOnboardingComplete}
                  defaultEmail={user?.email ?? undefined}
                  defaultName={user?.user_metadata?.full_name ?? undefined}
                />
              </Suspense>
            )}
            <AppShell onBackToLanding={!session ? handleBackToLanding : undefined} />
            <Suspense fallback={null}><AuthWall /></Suspense>
          </AuthWallProvider>
        </ScoutProvider>
      </JobsProvider>
    </UIProvider>
  )
}

export default function App() {
  return (
    <AppErrorBoundary>
      <SupabaseProvider>
        <AppContent />
      </SupabaseProvider>
    </AppErrorBoundary>
  )
}
