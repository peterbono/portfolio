import React, { useState, useCallback, Suspense } from 'react'
import { SupabaseProvider, useSupabase } from './context/SupabaseContext'
import { JobsProvider } from './context/JobsContext'
import { UIProvider } from './context/UIContext'
import { CoachProvider } from './context/CoachContext'
import { AuthWallProvider } from './context/AuthWallContext'
import { AppShell } from './layout/AppShell'
import { GmailSyncBridge } from './components/GmailSyncBridge'
import { AuthWall } from './components/AuthWall'
import { AuthView } from './views/AuthView'
import { OnboardingWizard } from './components/OnboardingWizard'

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
      return <AuthView onBack={() => setShowAuthModal(false)} />
    }
    return <Suspense fallback={<div style={{ width: '100vw', height: '100vh', background: '#09090b' }} />}><LandingView onGetStarted={handleGetStarted} onSignIn={handleSignIn} /></Suspense>
  }

  // Authenticated but onboarding not done: show wizard over dashboard
  const showOnboarding = session && !onboardingDone

  return (
    <UIProvider>
      <JobsProvider>
        <CoachProvider>
          <AuthWallProvider>
            <GmailSyncBridge />
            {showOnboarding && (
              <OnboardingWizard
                onComplete={handleOnboardingComplete}
                defaultEmail={user?.email ?? undefined}
                defaultName={user?.user_metadata?.full_name ?? undefined}
              />
            )}
            <AppShell onBackToLanding={!session ? handleBackToLanding : undefined} />
            {/* Global auth wall modal (rendered when triggered) */}
            <AuthWall />
          </AuthWallProvider>
        </CoachProvider>
      </JobsProvider>
    </UIProvider>
  )
}

export default function App() {
  return (
    <SupabaseProvider>
      <AppContent />
    </SupabaseProvider>
  )
}
