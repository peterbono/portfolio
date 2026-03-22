import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react'

export type ActiveView = 'table' | 'pipeline' | 'analytics' | 'coach' | 'insights' | 'autopilot' | 'settings' | 'pricing'
export type TimeRange = 'all' | 'today' | 'week' | 'month' | '3months'
export type AreaFilter = 'all' | 'apac' | 'emea' | 'americas'
export type WorkMode = 'all' | 'remote' | 'onsite' | 'hybrid'
interface UIContextValue {
  activeView: ActiveView
  sidebarCollapsed: boolean
  selectedJobId: string | null
  drawerOpen: boolean
  timeRange: TimeRange
  areaFilter: AreaFilter
  workMode: WorkMode
  setActiveView: (view: ActiveView) => void
  toggleSidebar: () => void
  selectJob: (id: string) => void
  closeDrawer: () => void
  setTimeRange: (range: TimeRange) => void
  setAreaFilter: (area: AreaFilter) => void
  setWorkMode: (mode: WorkMode) => void
}

const UIContext = createContext<UIContextValue | null>(null)

export function UIProvider({ children }: { children: ReactNode }) {
  // Default to 'autopilot' for new/anonymous users (core value = auto-apply)
  // Authenticated users who have previously used the app may override via navigation
  const [activeView, setActiveView] = useState<ActiveView>(() => {
    try {
      const saved = sessionStorage.getItem('tracker_v2_last_view')
      if (saved && ['table', 'pipeline', 'analytics', 'coach', 'insights', 'autopilot', 'settings', 'pricing'].includes(saved)) {
        return saved as ActiveView
      }
    } catch { /* ignore */ }
    return 'autopilot'
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [timeRange, setTimeRange] = useState<TimeRange>('all')
  const [areaFilter, setAreaFilter] = useState<AreaFilter>('all')
  const [workMode, setWorkMode] = useState<WorkMode>('all')

  // Persist active view so refreshes within the session keep user's choice
  useEffect(() => {
    try {
      sessionStorage.setItem('tracker_v2_last_view', activeView)
    } catch { /* ignore */ }
  }, [activeView])

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
        timeRange,
        areaFilter,
        workMode,
        setActiveView,
        toggleSidebar,
        selectJob,
        closeDrawer,
        setTimeRange,
        setAreaFilter,
        setWorkMode,
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
