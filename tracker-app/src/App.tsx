import { useState, useCallback } from 'react'
import { SupabaseProvider, useSupabase } from './context/SupabaseContext'
import { JobsProvider } from './context/JobsContext'
import { UIProvider } from './context/UIContext'
import { CoachProvider } from './context/CoachContext'
import { AppShell } from './layout/AppShell'
import { GmailSyncBridge } from './components/GmailSyncBridge'
import { AuthView } from './views/AuthView'
import { LandingView } from './views/LandingView'
import { OnboardingWizard } from './components/OnboardingWizard'

const AUTH_REQUIRED = import.meta.env.VITE_AUTH_REQUIRED === 'true'
const ONBOARDING_KEY = 'tracker_v2_onboarding_done'

function AuthGate() {
  const { session, user, authLoading } = useSupabase()
  const [showAuth, setShowAuth] = useState(false)
  const [onboardingDone, setOnboardingDone] = useState(
    () => localStorage.getItem(ONBOARDING_KEY) === 'true'
  )

  const handleGetStarted = useCallback(() => setShowAuth(true), [])
  const handleSignIn = useCallback(() => setShowAuth(true), [])
  const handleBackToLanding = useCallback(() => setShowAuth(false), [])
  const handleOnboardingComplete = useCallback(() => setOnboardingDone(true), [])

  // If auth is not required, skip the gate entirely
  if (!AUTH_REQUIRED) {
    return (
      <UIProvider>
        <JobsProvider>
          <CoachProvider>
            <GmailSyncBridge />
            {!onboardingDone ? (
              <OnboardingWizard onComplete={handleOnboardingComplete} />
            ) : null}
            <AppShell />
          </CoachProvider>
        </JobsProvider>
      </UIProvider>
    )
  }

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
            border: '2px solid var(--border)',
            borderTopColor: 'var(--accent)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      </div>
    )
  }

  // No session -> show landing page or auth view
  if (!session) {
    if (showAuth) {
      return (
        <div style={{ position: 'relative' }}>
          <AuthView />
          <button
            onClick={handleBackToLanding}
            style={{
              position: 'fixed',
              top: 20,
              left: 20,
              padding: '6px 14px',
              fontSize: 13,
              color: 'var(--text-secondary)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              zIndex: 10,
              fontFamily: 'inherit',
            }}
          >
            &larr; Back
          </button>
        </div>
      )
    }
    return <LandingView onGetStarted={handleGetStarted} onSignIn={handleSignIn} />
  }

  // Authenticated but onboarding not done -> show wizard
  if (!onboardingDone) {
    return (
      <UIProvider>
        <JobsProvider>
          <CoachProvider>
            <GmailSyncBridge />
            <OnboardingWizard
              onComplete={handleOnboardingComplete}
              defaultEmail={user?.email ?? undefined}
              defaultName={user?.user_metadata?.full_name ?? undefined}
            />
            <AppShell />
          </CoachProvider>
        </JobsProvider>
      </UIProvider>
    )
  }

  // Authenticated and onboarded -> show app
  return (
    <UIProvider>
      <JobsProvider>
        <CoachProvider>
          <GmailSyncBridge />
          <AppShell />
        </CoachProvider>
      </JobsProvider>
    </UIProvider>
  )
}

export default function App() {
  return (
    <SupabaseProvider>
      <AuthGate />
    </SupabaseProvider>
  )
}
