import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from 'react'
import { useJobs } from './JobsContext'
import type { Job } from '../types/job'

/* ── Types ── */
export type GoalMode = 'light' | 'standard' | 'sprint'
export type PersonalRank = 'bronze' | 'silver' | 'gold' | 'diamond'

export interface DayLog {
  date: string // YYYY-MM-DD
  actions: number
  mood?: 1 | 2 | 3 | 4 | 5
}

export interface Milestone {
  id: string
  label: string
  icon: string
  achieved: boolean
  achievedDate?: string
}

interface StreakData {
  current: number
  best: number
  lastActiveDate: string | null
  freezesAvailable: number
  freezeUsedToday: boolean
}

export interface MoodEntry {
  date: string // YYYY-MM-DD
  mood: 1 | 2 | 3 | 4 | 5
  actions: number // actions that day for correlation
}

interface FocusDoneState {
  date: string // YYYY-MM-DD — auto-resets when day changes
  doneIds: string[]
}

interface FocusDismissedState {
  date: string // YYYY-MM-DD — auto-resets when day changes
  dismissedIds: string[]
}

interface CoachState {
  streak: StreakData
  goalMode: GoalMode
  dayLogs: DayLog[]
  weeklyMood: number | null
  moodHistory: MoodEntry[]
  focusDone: FocusDoneState
  focusDismissed: FocusDismissedState
}

interface CoachContextValue {
  // Streak
  streak: StreakData
  checkInToday: () => void
  useStreakFreeze: () => void

  // Daily Goal
  goalMode: GoalMode
  setGoalMode: (mode: GoalMode) => void
  dailyTarget: number
  todayActions: number
  dailyProgress: number // 0-1
  isDailyGoalMet: boolean

  // Weekly
  weekActions: number
  weeklyTarget: number
  weekProgress: number
  personalRank: PersonalRank
  bestWeek: { weekLabel: string; actions: number } | null

  // Milestones
  milestones: Milestone[]

  // Pacing
  pacingAlert: 'overwork' | 'inactive' | null
  daysSinceLastAction: number

  // Mood
  weeklyMood: number | null
  setWeeklyMood: (mood: number) => void
  moodHistory: MoodEntry[]
  moodTrend: 'improving' | 'declining' | 'stable' | null
  moodCorrelation: { highMoodAvgActions: number; lowMoodAvgActions: number } | null
  consecutiveLowMoodDays: number
  moodSuggestedMode: GoalMode | null

  // Day logs
  dayLogs: DayLog[]

  // Insights
  insights: string[]

  // Focus tasks
  focusTasks: FocusTask[]
  focusDoneIds: Set<string>
  toggleFocusTask: (id: string) => void
  dismissFocusTask: (id: string) => void
}

export interface FocusTask {
  id: string
  label: string
  type: 'follow-up' | 'apply' | 'prep' | 'network' | 'general'
  done: boolean
}

const COACH_STORAGE_KEY = 'tracker_v2_coach'
const CoachContext = createContext<CoachContextValue | null>(null)

function today(): string {
  return new Date().toISOString().split('T')[0]
}

function daysAgo(dateStr: string): number {
  const d = new Date(dateStr)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  return Math.floor((now.getTime() - d.getTime()) / 86400000)
}

function getWeekStart(d: Date = new Date()): string {
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Monday start
  const monday = new Date(d)
  monday.setDate(diff)
  monday.setHours(0, 0, 0, 0)
  return monday.toISOString().split('T')[0]
}

function getWeekLabel(dateStr: string): string {
  const d = new Date(dateStr)
  const weekNum = Math.ceil((d.getDate() + new Date(d.getFullYear(), d.getMonth(), 1).getDay()) / 7)
  return `${d.toLocaleString('en', { month: 'short' })} W${weekNum}`
}

const GOAL_TARGETS: Record<GoalMode, number> = { light: 2, standard: 4, sprint: 6 }
const WEEKLY_MULTIPLIER = 5 // 5 working days

function loadCoachState(): CoachState {
  try {
    const raw = localStorage.getItem(COACH_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return {
    streak: { current: 0, best: 0, lastActiveDate: null, freezesAvailable: 1, freezeUsedToday: false },
    goalMode: 'standard',
    dayLogs: [],
    weeklyMood: null,
    moodHistory: [],
    focusDone: { date: '', doneIds: [] },
    focusDismissed: { date: '', dismissedIds: [] },
  }
}

function saveCoachState(state: CoachState) {
  localStorage.setItem(COACH_STORAGE_KEY, JSON.stringify(state))
}

/* ── Counting today's actions from jobs ── */
function countActionsForDate(jobs: Job[], date: string): number {
  let count = 0
  for (const job of jobs) {
    // Job applied/submitted today
    if (job.date === date && job.status === 'submitted') count++
    // Events today (screening, interview, follow-up, etc.)
    if (job.events) {
      for (const ev of job.events) {
        if (ev.date === date) count++
      }
    }
  }
  return count
}

/* ── Generate insights from data ── */
function generateInsights(allJobs: Job[]): string[] {
  const insights: string[] = []

  // ATS conversion
  const atsCounts: Record<string, { total: number; responded: number }> = {}
  for (const j of allJobs) {
    if (!j.ats || j.ats === '—') continue
    const ats = j.ats.toLowerCase().trim()
    // Filter non-ATS values
    const nonAts = ['soumise', 'à soumettre', 'submitted', 'manual', 'easy apply', 'email', 'direct', 'referral', 'unknown', 'custom', 'recruiter', '-', 'n/a', 'skip', 'trop long', 'external', 'various', 'aggregator']
    if (nonAts.includes(ats)) continue
    if (ats.includes(' hq') || ats.includes('skip') || ats.includes('trop') || ats.length < 3 || ats.length > 30) continue
    if (!atsCounts[ats]) atsCounts[ats] = { total: 0, responded: 0 }
    atsCounts[ats].total++
    if (['interviewing', 'challenge', 'offer', 'rejected'].includes(j.status)) {
      atsCounts[ats].responded++
    }
  }
  const atsEntries = Object.entries(atsCounts).filter(([, v]) => v.total >= 5).sort((a, b) => (b[1].responded / b[1].total) - (a[1].responded / a[1].total))
  if (atsEntries.length >= 2) {
    const best = atsEntries[0]
    const rate = Math.round((best[1].responded / best[1].total) * 100)
    insights.push(`${best[0].charAt(0).toUpperCase() + best[0].slice(1)} has your best response rate (${rate}%). Prioritize these.`)
  }

  // Follow-up detection
  const submittedNoResponse = allJobs.filter(j => j.status === 'submitted' && j.date && daysAgo(j.date) >= 7 && daysAgo(j.date) <= 21)
  if (submittedNoResponse.length > 0) {
    insights.push(`${submittedNoResponse.length} applications without response for 7+ days. Follow-ups could boost your rate.`)
  }

  // Area performance
  const areaStats: Record<string, { total: number; responded: number }> = {}
  for (const j of allJobs) {
    const loc = (j.location || '').toLowerCase()
    let area = 'unknown'
    if (['bangkok', 'singapore', 'india', 'tokyo', 'manila', 'philippines', 'thailand', 'apac'].some(k => loc.includes(k))) area = 'APAC'
    else if (['london', 'berlin', 'paris', 'amsterdam', 'europe', 'emea'].some(k => loc.includes(k))) area = 'EMEA'
    else if (['new york', 'usa', 'canada', 'americas'].some(k => loc.includes(k))) area = 'Americas'
    if (area === 'unknown') continue
    if (!areaStats[area]) areaStats[area] = { total: 0, responded: 0 }
    areaStats[area].total++
    if (['interviewing', 'challenge', 'offer'].includes(j.status)) {
      areaStats[area].responded++
    }
  }
  const areaEntries = Object.entries(areaStats).filter(([, v]) => v.total >= 10).sort((a, b) => (b[1].responded / b[1].total) - (a[1].responded / a[1].total))
  if (areaEntries.length >= 2) {
    const best = areaEntries[0]
    const rate = Math.round((best[1].responded / best[1].total) * 100)
    insights.push(`${best[0]} responds ${rate}% of the time — your strongest region.`)
  }

  // Weekly velocity
  const thisWeekStart = getWeekStart()
  const thisWeekJobs = allJobs.filter(j => j.date >= thisWeekStart && j.status === 'submitted')
  const lastWeekStart = getWeekStart(new Date(Date.now() - 7 * 86400000))
  const lastWeekJobs = allJobs.filter(j => j.date >= lastWeekStart && j.date < thisWeekStart && j.status === 'submitted')
  if (lastWeekJobs.length > 0) {
    const diff = thisWeekJobs.length - lastWeekJobs.length
    if (diff > 5) insights.push(`You're outpacing last week by ${diff} applications. Strong momentum.`)
    else if (diff < -5) insights.push(`${Math.abs(diff)} fewer applications than last week. Time to ramp up?`)
  }

  return insights.slice(0, 3) // max 3 insights
}

/* ── ATS response rate analysis ── */
function getAtsStats(allJobs: Job[]): { bestAts: string; bestRate: number; worstAts: string; worstRate: number } | null {
  const atsCounts: Record<string, { total: number; responded: number }> = {}
  const nonAts = ['soumise', 'à soumettre', 'submitted', 'manual', 'easy apply', 'email', 'direct', 'referral', 'unknown', 'custom', 'recruiter', '-', 'n/a', 'skip', 'trop long', 'external', 'various', 'aggregator', '—']
  for (const j of allJobs) {
    if (!j.ats) continue
    const ats = j.ats.toLowerCase().trim()
    if (nonAts.includes(ats) || ats.length < 3 || ats.length > 30) continue
    if (!atsCounts[ats]) atsCounts[ats] = { total: 0, responded: 0 }
    atsCounts[ats].total++
    if (['interviewing', 'challenge', 'offer', 'rejected'].includes(j.status)) {
      atsCounts[ats].responded++
    }
  }
  const entries = Object.entries(atsCounts).filter(([, v]) => v.total >= 5).sort((a, b) => (b[1].responded / b[1].total) - (a[1].responded / a[1].total))
  if (entries.length < 2) return null
  const best = entries[0]
  const worst = entries[entries.length - 1]
  return {
    bestAts: best[0].charAt(0).toUpperCase() + best[0].slice(1),
    bestRate: Math.round((best[1].responded / best[1].total) * 100),
    worstAts: worst[0].charAt(0).toUpperCase() + worst[0].slice(1),
    worstRate: Math.round((worst[1].responded / worst[1].total) * 100),
  }
}

/* ── Ghost detection for follow-ups ── */
function isLikelyGhoster(company: string, allJobs: Job[]): boolean {
  // If this company has ghosted before (submitted > 21 days, no events, no rejection), skip follow-up
  const companyJobs = allJobs.filter(j => j.company.toLowerCase() === company.toLowerCase() && j.id !== company)
  return companyJobs.some(j =>
    j.status === 'submitted' && j.date && daysAgo(j.date) > 21 && (!j.events || j.events.length === 0)
  )
}

/* ── Generate focus tasks ── */
function generateFocusTasks(allJobs: Job[], dismissedIds: Set<string> = new Set()): FocusTask[] {
  const pool: FocusTask[] = []
  const todayStr = today()
  const atsStats = getAtsStats(allJobs)

  // 1. Upcoming interviews/screenings (highest priority)
  const upcoming = allJobs.filter(j =>
    j.events?.some(e => e.date >= todayStr && e.date <= new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0])
  )
  for (const j of upcoming.slice(0, 3)) {
    const nextEvent = j.events?.find(e => e.date >= todayStr)
    if (nextEvent) {
      pool.push({
        id: `prep-${j.id}`,
        label: `Prepare ${nextEvent.type} with ${j.company}`,
        type: 'prep',
        done: false,
      })
    }
  }

  // 2. Smart follow-ups: prioritize by ATS response rate, skip likely ghosters
  const followUps = allJobs
    .filter(j => j.status === 'submitted' && j.date && daysAgo(j.date) >= 7 && daysAgo(j.date) <= 14)
    .filter(j => !isLikelyGhoster(j.company, allJobs))
    .sort((a, b) => {
      // Sort by ATS response rate (jobs on better ATS platforms first)
      if (!atsStats) return 0
      const aAts = (a.ats || '').toLowerCase()
      const bAts = (b.ats || '').toLowerCase()
      const bestAtsLower = atsStats.bestAts.toLowerCase()
      if (aAts === bestAtsLower && bAts !== bestAtsLower) return -1
      if (bAts === bestAtsLower && aAts !== bestAtsLower) return 1
      return 0
    })
    .slice(0, 5)
  for (const j of followUps) {
    const atsNote = atsStats && (j.ats || '').toLowerCase() === atsStats.bestAts.toLowerCase()
      ? ` (${atsStats.bestAts} — ${atsStats.bestRate}% response rate)`
      : ''
    pool.push({
      id: `followup-${j.id}`,
      label: `Follow up on ${j.company}${atsNote}`,
      type: 'follow-up',
      done: false,
    })
  }

  // 3. Apply more jobs
  pool.push({
    id: 'apply-batch',
    label: 'Apply to 3 new jobs today',
    type: 'apply',
    done: false,
  })

  // 4. Data-driven apply suggestions
  if (atsStats) {
    pool.push({
      id: 'apply-best-ats',
      label: `Target ${atsStats.bestAts} jobs today (${atsStats.bestRate}% response vs ${atsStats.worstAts} ${atsStats.worstRate}%)`,
      type: 'apply',
      done: false,
    })
  }

  // 5. General tasks as filler
  pool.push({
    id: 'apply-new',
    label: 'Apply to 2 new quality positions (APAC timezone)',
    type: 'apply',
    done: false,
  })
  pool.push({
    id: 'network-linkedin',
    label: 'Engage with 3 hiring managers on LinkedIn',
    type: 'network',
    done: false,
  })

  // Filter out dismissed tasks, then take top 4
  return pool.filter(t => !dismissedIds.has(t.id)).slice(0, 4)
}

/* ── Milestones ── */
function computeMilestones(allJobs: Job[], streak: StreakData): Milestone[] {
  const submitted = allJobs
  const screenings = allJobs.filter(j => ['interviewing', 'challenge', 'offer'].includes(j.status))
  const interviews = allJobs.filter(j => ['interviewing', 'challenge', 'offer'].includes(j.status))
  const offers = allJobs.filter(j => j.status === 'offer')

  return [
    { id: 'sub100', label: '100 applications', icon: '💯', achieved: submitted.length >= 100, achievedDate: submitted.length >= 100 ? submitted[99]?.date : undefined },
    { id: 'sub250', label: '250 applications', icon: '🚀', achieved: submitted.length >= 250 },
    { id: 'sub500', label: '500 applications', icon: '🏆', achieved: submitted.length >= 500 },
    { id: 'screen1', label: 'First screening', icon: '📞', achieved: screenings.length >= 1 },
    { id: 'screen5', label: '5 screenings', icon: '📞', achieved: screenings.length >= 5 },
    { id: 'interview1', label: 'First interview', icon: '🎤', achieved: interviews.length >= 1 },
    { id: 'interview5', label: '5 interviews', icon: '🎤', achieved: interviews.length >= 5 },
    { id: 'offer1', label: 'First offer', icon: '⭐', achieved: offers.length >= 1 },
    { id: 'streak7', label: '7-day streak', icon: '🔥', achieved: streak.best >= 7 },
    { id: 'streak30', label: '30-day streak', icon: '🔥', achieved: streak.best >= 30 },
    { id: 'streak60', label: '60-day streak', icon: '🔥', achieved: streak.best >= 60 },
  ]
}

/* ── Provider ── */
export function CoachProvider({ children }: { children: ReactNode }) {
  const { allJobs } = useJobs()
  const [state, setState] = useState<CoachState>(loadCoachState)

  // Persist on change
  useEffect(() => {
    saveCoachState(state)
  }, [state])

  // ── Streak ──
  const checkInToday = useCallback(() => {
    setState(prev => {
      const todayStr = today()
      if (prev.streak.lastActiveDate === todayStr) return prev // already checked in

      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString().split('T')[0]

      let newCurrent = prev.streak.current
      if (prev.streak.lastActiveDate === yesterdayStr) {
        newCurrent = prev.streak.current + 1
      } else if (prev.streak.lastActiveDate && prev.streak.lastActiveDate < yesterdayStr) {
        // Missed a day — check freeze
        if (prev.streak.freezeUsedToday || prev.streak.freezesAvailable <= 0) {
          newCurrent = 1 // streak broken
        } else {
          newCurrent = prev.streak.current + 1 // freeze saved it
        }
      } else {
        newCurrent = 1 // first day
      }

      return {
        ...prev,
        streak: {
          ...prev.streak,
          current: newCurrent,
          best: Math.max(prev.streak.best, newCurrent),
          lastActiveDate: todayStr,
          freezeUsedToday: false,
          // Award freeze at milestones
          freezesAvailable: newCurrent % 7 === 0 ? prev.streak.freezesAvailable + 1 : prev.streak.freezesAvailable,
        },
      }
    })
  }, [])

  const useStreakFreeze = useCallback(() => {
    setState(prev => {
      if (prev.streak.freezesAvailable <= 0) return prev
      return {
        ...prev,
        streak: {
          ...prev.streak,
          freezesAvailable: prev.streak.freezesAvailable - 1,
          freezeUsedToday: true,
        },
      }
    })
  }, [])

  // ── Goal Mode ──
  const setGoalMode = useCallback((mode: GoalMode) => {
    setState(prev => ({ ...prev, goalMode: mode }))
  }, [])

  // ── Mood ──
  const setWeeklyMood = useCallback((mood: number) => {
    setState(prev => {
      const todayStr = today()
      const todayActs = countActionsForDate(allJobs, todayStr)
      const existing = prev.moodHistory || []
      // Update today's entry or add new
      const filtered = existing.filter(m => m.date !== todayStr)
      const newEntry: MoodEntry = { date: todayStr, mood: mood as 1|2|3|4|5, actions: todayActs }
      const newHistory = [...filtered, newEntry].slice(-30) // keep last 30 days
      return { ...prev, weeklyMood: mood, moodHistory: newHistory }
    })
  }, [allJobs])

  // ── Derived values ──
  const todayStr = today()
  const todayActions = useMemo(() => countActionsForDate(allJobs, todayStr), [allJobs, todayStr])
  const dailyTarget = GOAL_TARGETS[state.goalMode]
  const dailyProgress = Math.min(todayActions / dailyTarget, 1)
  const isDailyGoalMet = todayActions >= dailyTarget

  // Auto check-in when actions > 0
  useEffect(() => {
    if (todayActions > 0 && state.streak.lastActiveDate !== todayStr) {
      checkInToday()
    }
  }, [todayActions, todayStr, state.streak.lastActiveDate, checkInToday])

  // Bootstrap streak from job data on first load
  useEffect(() => {
    if (state.streak.lastActiveDate) return // already initialized
    // Find the most recent active date from jobs
    let mostRecent = ''
    for (const j of allJobs) {
      if (j.date && j.date > mostRecent) {
        mostRecent = j.date
      }
    }
    if (mostRecent) {
      const daysDiff = daysAgo(mostRecent)
      // Count consecutive days with activity going backwards
      let streak = 0
      for (let i = daysDiff; i < daysDiff + 60; i++) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const dateStr = d.toISOString().split('T')[0]
        const actions = countActionsForDate(allJobs, dateStr)
        if (actions > 0) streak++
        else if (streak > 0) break // streak broken
        // skip if current day has 0 actions and it's today (hasn't started yet)
      }
      if (streak > 0) {
        setState(prev => ({
          ...prev,
          streak: {
            ...prev.streak,
            current: streak,
            best: streak,
            lastActiveDate: mostRecent,
          },
        }))
      }
    }
  }, [allJobs]) // eslint-disable-line react-hooks/exhaustive-deps

  // Weekly
  const weekStart = getWeekStart()
  const weekActions = useMemo(() => {
    let count = 0
    const now = new Date()
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + i)
      if (d > now) break
      count += countActionsForDate(allJobs, d.toISOString().split('T')[0])
    }
    return count
  }, [allJobs, weekStart])

  const weeklyTarget = dailyTarget * WEEKLY_MULTIPLIER
  const weekProgress = Math.min(weekActions / weeklyTarget, 1)

  // Personal rank based on weekly actions
  const personalRank: PersonalRank = useMemo(() => {
    if (weekActions >= 30) return 'diamond'
    if (weekActions >= 20) return 'gold'
    if (weekActions >= 10) return 'silver'
    return 'bronze'
  }, [weekActions])

  // Best week ever
  const bestWeek = useMemo(() => {
    const weekMap = new Map<string, number>()
    for (const j of allJobs) {
      if (!j.date) continue
      const d = new Date(j.date)
      const ws = getWeekStart(d)
      weekMap.set(ws, (weekMap.get(ws) || 0) + 1)
    }
    let best: { weekLabel: string; actions: number } | null = null
    for (const [ws, count] of weekMap) {
      if (!best || count > best.actions) {
        best = { weekLabel: getWeekLabel(ws), actions: count }
      }
    }
    return best
  }, [allJobs])

  // Milestones
  const milestones = useMemo(() => computeMilestones(allJobs, state.streak), [allJobs, state.streak])

  // Pacing — fallback to most recent job date if no coach state yet
  const daysSinceLastAction = useMemo(() => {
    if (state.streak.lastActiveDate) return daysAgo(state.streak.lastActiveDate)
    // Bootstrap: find most recent job date
    let mostRecent = ''
    for (const j of allJobs) {
      if (j.date && j.date > mostRecent) {
        mostRecent = j.date
      }
    }
    return mostRecent ? daysAgo(mostRecent) : 0
  }, [state.streak.lastActiveDate, allJobs])

  const pacingAlert = useMemo(() => {
    if (todayActions >= 10) return 'overwork' as const
    if (daysSinceLastAction >= 3) return 'inactive' as const
    return null
  }, [todayActions, daysSinceLastAction])

  // Insights
  const insights = useMemo(() => generateInsights(allJobs), [allJobs])

  // ── Focus task persistence ──
  const focusDone = state.focusDone || { date: '', doneIds: [] }
  const focusDismissed = state.focusDismissed || { date: '', dismissedIds: [] }

  const focusDoneIds = useMemo(() => {
    if (focusDone.date !== todayStr) return new Set<string>()
    return new Set(focusDone.doneIds)
  }, [focusDone, todayStr])

  const focusDismissedIds = useMemo(() => {
    if (focusDismissed.date !== todayStr) return new Set<string>()
    return new Set(focusDismissed.dismissedIds)
  }, [focusDismissed, todayStr])

  // Focus tasks — generated from jobs, filtered by dismissed
  const focusTasks = useMemo(() => generateFocusTasks(allJobs, focusDismissedIds), [allJobs, focusDismissedIds])

  // Clear stale focus state on day change
  useEffect(() => {
    const needsReset =
      (state.focusDone?.date && state.focusDone.date !== todayStr && state.focusDone.doneIds.length > 0) ||
      (state.focusDismissed?.date && state.focusDismissed.date !== todayStr && state.focusDismissed.dismissedIds.length > 0)
    if (needsReset) {
      setState(prev => ({
        ...prev,
        focusDone: { date: todayStr, doneIds: [] },
        focusDismissed: { date: todayStr, dismissedIds: [] },
      }))
    }
  }, [todayStr]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFocusTask = useCallback((id: string) => {
    setState(prev => {
      const current = prev.focusDone?.date === todayStr ? prev.focusDone.doneIds : []
      const isAlreadyDone = current.includes(id)
      const newDoneIds = isAlreadyDone ? current.filter(x => x !== id) : [...current, id]
      return { ...prev, focusDone: { date: todayStr, doneIds: newDoneIds } }
    })
  }, [todayStr])

  const dismissFocusTask = useCallback((id: string) => {
    setState(prev => {
      const current = prev.focusDismissed?.date === todayStr ? prev.focusDismissed.dismissedIds : []
      if (current.includes(id)) return prev
      // Also remove from done if it was checked
      const doneIds = prev.focusDone?.date === todayStr ? prev.focusDone.doneIds.filter(x => x !== id) : []
      return {
        ...prev,
        focusDismissed: { date: todayStr, dismissedIds: [...current, id] },
        focusDone: { date: todayStr, doneIds },
      }
    })
  }, [todayStr])

  // ── Mood analytics ──
  const moodHistory = state.moodHistory || []

  // Trend: compare last 3 entries
  const moodTrend = useMemo(() => {
    if (moodHistory.length < 3) return null
    const recent = moodHistory.slice(-3)
    const first = recent[0].mood
    const last = recent[recent.length - 1].mood
    if (last > first) return 'improving' as const
    if (last < first) return 'declining' as const
    return 'stable' as const
  }, [moodHistory])

  // Correlation: avg actions on high mood days vs low mood days
  const moodCorrelation = useMemo(() => {
    if (moodHistory.length < 3) return null
    const high = moodHistory.filter(m => m.mood >= 4)
    const low = moodHistory.filter(m => m.mood <= 2)
    if (high.length === 0 || low.length === 0) return null
    const highAvg = Math.round(high.reduce((s, m) => s + m.actions, 0) / high.length)
    const lowAvg = Math.round(low.reduce((s, m) => s + m.actions, 0) / low.length)
    return { highMoodAvgActions: highAvg, lowMoodAvgActions: lowAvg }
  }, [moodHistory])

  // Consecutive low mood days
  const consecutiveLowMoodDays = useMemo(() => {
    let count = 0
    for (let i = moodHistory.length - 1; i >= 0; i--) {
      if (moodHistory[i].mood <= 2) count++
      else break
    }
    return count
  }, [moodHistory])

  // Auto-suggest mode based on mood
  const moodSuggestedMode: GoalMode | null = useMemo(() => {
    if (!state.weeklyMood) return null
    if (state.weeklyMood <= 2) return 'light'
    if (state.weeklyMood >= 5) return 'sprint'
    return null
  }, [state.weeklyMood])

  // Auto-adjust goal mode when mood is low for 2+ days
  useEffect(() => {
    if (consecutiveLowMoodDays >= 2 && state.goalMode !== 'light') {
      setState(prev => ({ ...prev, goalMode: 'light' }))
    }
  }, [consecutiveLowMoodDays, state.goalMode])

  return (
    <CoachContext.Provider
      value={{
        streak: state.streak,
        checkInToday,
        useStreakFreeze,
        goalMode: state.goalMode,
        setGoalMode,
        dailyTarget,
        todayActions,
        dailyProgress,
        isDailyGoalMet,
        weekActions,
        weeklyTarget,
        weekProgress,
        personalRank,
        bestWeek,
        milestones,
        pacingAlert,
        daysSinceLastAction,
        weeklyMood: state.weeklyMood,
        setWeeklyMood,
        moodHistory,
        moodTrend,
        moodCorrelation,
        consecutiveLowMoodDays,
        moodSuggestedMode,
        dayLogs: state.dayLogs,
        insights,
        focusTasks,
        focusDoneIds,
        toggleFocusTask,
        dismissFocusTask,
      }}
    >
      {children}
    </CoachContext.Provider>
  )
}

export function useCoach() {
  const ctx = useContext(CoachContext)
  if (!ctx) throw new Error('useCoach must be used within CoachProvider')
  return ctx
}
