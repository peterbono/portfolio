import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  type PlanTier,
  type PlanLimits,
  type PlatformLimits,
  getPlanLimits,
  canUseFeature,
  getRemainingQuota,
  getCurrentUsage,
  getMinimumPlan,
  handleCheckoutSuccess,
  getTrialStartDate,
  getTrialDaysLeft,
  isTrialActive as checkTrialActive,
  isTrialExpired as checkTrialExpired,
  getEffectivePlan,
  canUseBotCheck,
  initTrial,
  getPlatformLimits,
  TRIAL_STORAGE_KEY,
} from '../lib/billing'
import { useSupabase } from '../context/SupabaseContext'

const PLAN_STORAGE_KEY = 'tracker_user_plan'
const DAILY_USAGE_KEY = 'tracker_v2_daily_usage'

interface DailyUsage {
  date: string // YYYY-MM-DD
  linkedIn: number
  ats: number
}

function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function getDailyUsage(): DailyUsage {
  try {
    const raw = localStorage.getItem(DAILY_USAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DailyUsage
      if (parsed.date === getTodayStr()) return parsed
    }
  } catch { /* ignore */ }
  return { date: getTodayStr(), linkedIn: 0, ats: 0 }
}

function saveDailyUsage(usage: DailyUsage): void {
  try {
    localStorage.setItem(DAILY_USAGE_KEY, JSON.stringify(usage))
  } catch { /* ignore */ }
}

type GatableFeature =
  | 'bot-apply'
  | 'bot_apply'
  | 'ai-coach'
  | 'full-analytics'
  | 'feedback-loop'
  | 'ghost-detection'
  | 'cover-letter'
  | 'priority-support'
  | 'stealth'
  | 'linkedin-access'
  | 'headless'
  | 'autopilot'

interface UsePlanReturn {
  /** Base plan tier stored in localStorage / from Stripe */
  plan: PlanTier
  /** Effective plan (pro during trial, actual plan otherwise) */
  effectivePlan: PlanTier
  /** Limits for the effective plan */
  limits: PlanLimits
  /** Platform limits (LinkedIn/ATS per day) */
  platformLimits: PlatformLimits
  /** Check if a feature is available (uses effectivePlan) */
  canUse: (feature: GatableFeature) => boolean
  /** Whether user can use the auto-apply bot (trial active OR paid plan) */
  canUseBot: boolean
  /** Get remaining quota for a usage-limited feature */
  remaining: (feature: 'bot-apply' | 'cover-letter') => number
  /** Get the minimum plan needed for a feature */
  minimumPlanFor: (feature: GatableFeature) => PlanTier
  /** Current usage counts */
  usage: { applies: number; coverLetters: number }
  /** Whether we're loading usage data */
  loading: boolean
  /** Override plan locally (for dev/testing) */
  setPlanOverride: (plan: PlanTier) => void

  // ─── Trial state ──────────────────────────────────────
  /** ISO date when trial started, or null if never started */
  trialStartDate: string | null
  /** Days remaining in trial (0 if expired or never started) */
  trialDaysLeft: number
  /** Whether the 14-day trial is currently active */
  isTrialActive: boolean
  /** Whether trial was started but has expired */
  isTrialExpired: boolean

  // ─── Daily platform usage ─────────────────────────────
  /** Today's LinkedIn applies used */
  linkedInUsedToday: number
  /** Today's ATS applies used */
  atsUsedToday: number
  /** Remaining LinkedIn applies today */
  linkedInRemainingToday: number
  /** Remaining ATS applies today */
  atsRemainingToday: number
  /** Increment LinkedIn daily counter */
  incrementLinkedIn: () => void
  /** Increment ATS daily counter */
  incrementAts: () => void
}

/**
 * Hook providing current user's plan, feature gating, trial state, and quota tracking.
 * Reads plan from localStorage (defaults to 'free').
 * On mount, checks URL params for Stripe checkout success callback.
 * Initializes trial on first auth if not already set.
 */
export function usePlan(): UsePlanReturn {
  const { user } = useSupabase()

  // Server-side trial start: user.created_at is immutable (can't be reset by clearing localStorage)
  const userCreatedAt = user?.created_at ?? null

  const [plan, setPlan] = useState<PlanTier>(() => {
    try {
      const stored = localStorage.getItem(PLAN_STORAGE_KEY)
      if (stored && ['free', 'starter', 'pro', 'boost'].includes(stored)) {
        return stored as PlanTier
      }
    } catch { /* ignore */ }
    return 'free'
  })

  const [usage, setUsage] = useState({ applies: 0, coverLetters: 0 })
  const [loading, setLoading] = useState(false)
  const [dailyUsage, setDailyUsage] = useState<DailyUsage>(getDailyUsage)

  // ─── Trial state ────────────────────────────────────────
  // Source of truth: user.created_at (server-side, tamper-proof)
  // Fallback: localStorage (offline mode only)
  const [trialStartDate, setTrialStartDate] = useState<string | null>(() => getTrialStartDate(userCreatedAt))

  const trialDaysLeft = useMemo(() => getTrialDaysLeft(trialStartDate), [trialStartDate])
  const trialActive = useMemo(() => checkTrialActive(trialStartDate), [trialStartDate])
  const trialExpired = useMemo(() => checkTrialExpired(trialStartDate), [trialStartDate])
  const effectivePlan = useMemo(() => getEffectivePlan(plan, trialStartDate), [plan, trialStartDate])
  const canUseBot = useMemo(() => canUseBotCheck(plan, trialStartDate), [plan, trialStartDate])

  // Sync trial start date from server-side user.created_at when session loads
  useEffect(() => {
    if (userCreatedAt) {
      // Server-side source of truth — always overwrite localStorage cache
      const start = initTrial(userCreatedAt)
      setTrialStartDate(start)
      return
    }

    // Offline fallback: initialize trial if user has auth tokens but no session yet
    if (!trialStartDate) {
      let hasAuth = false
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key && (key.startsWith('sb-') && key.endsWith('-auth-token'))) {
            hasAuth = true
            break
          }
        }
        if (!hasAuth) {
          hasAuth = !!localStorage.getItem('supabase.auth.token')
        }
      } catch { /* ignore */ }
      if (!hasAuth) {
        hasAuth = !!localStorage.getItem(PLAN_STORAGE_KEY)
      }
      if (hasAuth) {
        const start = initTrial()
        setTrialStartDate(start)
      }
    }
  }, [userCreatedAt, trialStartDate])

  // Check for Stripe checkout success on mount
  useEffect(() => {
    const result = handleCheckoutSuccess()
    if (result) {
      console.log(`[usePlan] Checkout success — plan upgraded to ${result.plan} (session: ${result.sessionId})`)
      setPlan(result.plan)
    }
  }, [])

  // Fetch usage on mount and when plan changes
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getCurrentUsage()
      .then(data => {
        if (!cancelled) setUsage(data)
      })
      .catch(() => { /* stub won't fail */ })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [plan])

  const limits = useMemo(() => getPlanLimits(effectivePlan), [effectivePlan])
  const platformLimits = useMemo(() => getPlatformLimits(plan, trialActive), [plan, trialActive])

  const canUse = useCallback(
    (feature: GatableFeature) =>
      canUseFeature(effectivePlan, feature),
    [effectivePlan]
  )

  const remaining = useCallback(
    (feature: 'bot-apply' | 'cover-letter') => {
      const used = feature === 'bot-apply' ? usage.applies : usage.coverLetters
      return getRemainingQuota(effectivePlan, used, feature)
    },
    [effectivePlan, usage]
  )

  const minimumPlanFor = useCallback(
    (feature: GatableFeature) =>
      getMinimumPlan(feature as Parameters<typeof getMinimumPlan>[0]),
    []
  )

  const setPlanOverride = useCallback((newPlan: PlanTier) => {
    try {
      localStorage.setItem(PLAN_STORAGE_KEY, newPlan)
    } catch { /* ignore */ }
    setPlan(newPlan)
  }, [])

  // ─── Daily platform usage ─────────────────────────────
  const linkedInUsedToday = dailyUsage.linkedIn
  const atsUsedToday = dailyUsage.ats
  const linkedInRemainingToday = Math.max(0, platformLimits.linkedInPerDay - linkedInUsedToday)
  const atsRemainingToday = Math.max(0, platformLimits.atsPerDay - atsUsedToday)

  const incrementLinkedIn = useCallback(() => {
    setDailyUsage(prev => {
      const today = getTodayStr()
      const updated: DailyUsage = prev.date === today
        ? { ...prev, linkedIn: prev.linkedIn + 1 }
        : { date: today, linkedIn: 1, ats: 0 }
      saveDailyUsage(updated)
      return updated
    })
  }, [])

  const incrementAts = useCallback(() => {
    setDailyUsage(prev => {
      const today = getTodayStr()
      const updated: DailyUsage = prev.date === today
        ? { ...prev, ats: prev.ats + 1 }
        : { date: today, linkedIn: 0, ats: 1 }
      saveDailyUsage(updated)
      return updated
    })
  }, [])

  /** Also initialize trial when setPlanOverride is called (simulates signup) */
  const setPlanOverrideWithTrial = useCallback((newPlan: PlanTier) => {
    setPlanOverride(newPlan)
    if (!trialStartDate) {
      const start = initTrial(userCreatedAt)
      setTrialStartDate(start)
    }
  }, [setPlanOverride, trialStartDate, userCreatedAt])

  return {
    plan,
    effectivePlan,
    limits,
    platformLimits,
    canUse,
    canUseBot,
    remaining,
    minimumPlanFor,
    usage,
    loading,
    setPlanOverride: setPlanOverrideWithTrial,
    trialStartDate,
    trialDaysLeft,
    isTrialActive: trialActive,
    isTrialExpired: trialExpired,
    linkedInUsedToday,
    atsUsedToday,
    linkedInRemainingToday,
    atsRemainingToday,
    incrementLinkedIn,
    incrementAts,
  }
}
