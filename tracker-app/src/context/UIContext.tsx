import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react'

export type ActiveView = 'table' | 'pipeline' | 'analytics' | 'village' | 'settings'

interface UIContextValue {
  activeView: ActiveView
  sidebarCollapsed: boolean
  selectedJobId: string | null
  drawerOpen: boolean
  setActiveView: (view: ActiveView) => void
  toggleSidebar: () => void
  selectJob: (id: string) => void
  closeDrawer: () => void
}

const UIContext = createContext<UIContextValue | null>(null)

export function UIProvider({ children }: { children: ReactNode }) {
  const [activeView, setActiveView] = useState<ActiveView>('table')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev)
  }, [])

  const selectJob = useCallback((id: string) => {
    setSelectedJobId(id)
    setDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    setSelectedJobId(null)
  }, [])

  return (
    <UIContext.Provider
      value={{
        activeView,
        sidebarCollapsed,
        selectedJobId,
        drawerOpen,
        setActiveView,
        toggleSidebar,
        selectJob,
        closeDrawer,
      }}
    >
      {children}
    </UIContext.Provider>
  )
}

export function useUI() {
  const ctx = useContext(UIContext)
  if (!ctx) throw new Error('useUI must be used within UIProvider')
  return ctx
}
