import { SupabaseProvider } from './context/SupabaseContext'
import { JobsProvider } from './context/JobsContext'
import { UIProvider } from './context/UIContext'
import { CoachProvider } from './context/CoachContext'
import { AppShell } from './layout/AppShell'
import { GmailSyncBridge } from './components/GmailSyncBridge'

export default function App() {
  return (
    <SupabaseProvider>
      <UIProvider>
        <JobsProvider>
          <CoachProvider>
            <GmailSyncBridge />
            <AppShell />
          </CoachProvider>
        </JobsProvider>
      </UIProvider>
    </SupabaseProvider>
  )
}
