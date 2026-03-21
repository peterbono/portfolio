import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react'

export type ActiveView = 'table' | 'pipeline' | 'analytics' | 'coach' | 'settings'
export type TimeRange = 'all' | 'today' | 'week' | 'month' | '3months'
export type AreaFilter = 'all' | 'apac' | 'emea' | 'americas'
export type WorkMode = 'all' | 'remote' | 'onsite' | 'hybrid'
export type DateMode = 'applied' | 'activity'

interface UIContextValue {
  activeView: ActiveView
  sidebarCollapsed: boolean
  selectedJobId: string | null
  drawerOpen: boolean
  timeRange: TimeRange
  areaFilter: AreaFilter
  workMode: WorkMode
  dateMode: DateMode
  setActiveView: (view: ActiveView) => void
  toggleSidebar: () => void
  selectJob: (id: string) => void
  closeDrawer: () => void
  setTimeRange: (range: TimeRange) => void
  setAreaFilter: (area: AreaFilter) => void
  setWorkMode: (mode: WorkMode) => void
  setDateMode: (mode: DateMode) => void
}

const UIContext = createContext<UIContextValue | null>(null)

export function UIProvider({ children }: { children: ReactNode }) {
  const [activeView, setActiveView] = useState<ActiveView>('table')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [timeRange, setTimeRange] = useState<TimeRange>('all')
  const [areaFilter, setAreaFilter] = useState<AreaFilter>('all')
  const [workMode, setWorkMode] = useState<WorkMode>('all')
  const [dateMode, setDateMode] = useState<DateMode>('applied')

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
        dateMode,
        setActiveView,
        toggleSidebar,
        selectJob,
        closeDrawer,
        setTimeRange,
        setAreaFilter,
        setWorkMode,
        setDateMode,
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
