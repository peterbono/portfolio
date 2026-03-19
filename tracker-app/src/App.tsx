import { JobsProvider } from './context/JobsContext'
import { UIProvider } from './context/UIContext'
import { AppShell } from './layout/AppShell'

export default function App() {
  return (
    <JobsProvider>
      <UIProvider>
        <AppShell />
      </UIProvider>
    </JobsProvider>
  )
}
