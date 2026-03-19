import { JobsProvider } from './context/JobsContext'
import { UIProvider } from './context/UIContext'
import { AppShell } from './layout/AppShell'
import { GmailSyncBridge } from './components/GmailSyncBridge'

export default function App() {
  return (
    <JobsProvider>
      <UIProvider>
        <GmailSyncBridge />
        <AppShell />
      </UIProvider>
    </JobsProvider>
  )
}
