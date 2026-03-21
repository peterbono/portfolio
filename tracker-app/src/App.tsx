import { SupabaseProvider, useSupabase } from './context/SupabaseContext'
import { JobsProvider } from './context/JobsContext'
import { UIProvider } from './context/UIContext'
import { CoachProvider } from './context/CoachContext'
import { AppShell } from './layout/AppShell'
import { GmailSyncBridge } from './components/GmailSyncBridge'
import { AuthView } from './views/AuthView'

const AUTH_REQUIRED = import.meta.env.VITE_AUTH_REQUIRED === 'true'

function AuthGate() {
  const { session, authLoading } = useSupabase()

  // If auth is not required, skip the gate entirely
  if (!AUTH_REQUIRED) {
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

  // No session -> show auth
  if (!session) {
    return <AuthView />
  }

  // Authenticated -> show app
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
