import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  type PlanTier,
  type PlanLimits,
  getPlanLimits,
  canUseFeature,
  getRemainingQuota,
  getCurrentUsage,
  getMinimumPlan,
} from '../lib/billing'

const PLAN_STORAGE_KEY = 'tracker_user_plan'

interface UsePlanReturn {
  /** Current plan tier */
  plan: PlanTier
  /** Limits for the current plan */
  limits: PlanLimits
  /** Check if a feature is available */
  canUse: (feature: 'bot-apply' | 'ai-coach' | 'full-analytics' | 'feedback-loop' | 'ghost-detection' | 'cover-letter' | 'priority-support') => boolean
  /** Get remaining quota for a usage-limited feature */
  remaining: (feature: 'bot-apply' | 'cover-letter') => number
  /** Get the minimum plan needed for a feature */
  minimumPlanFor: (feature: 'bot-apply' | 'ai-coach' | 'full-analytics' | 'feedback-loop' | 'ghost-detection' | 'cover-letter' | 'priority-support') => PlanTier
  /** Current usage counts */
  usage: { applies: number; coverLetters: number }
  /** Whether we're loading usage data */
  loading: boolean
  /** Override plan locally (for dev/testing) */
  setPlanOverride: (plan: PlanTier) => void
}

/**
 * Hook providing current user's plan, feature gating, and quota tracking.
 * For MVP: reads plan from localStorage (defaults to 'free').
 * When Supabase auth is wired, will read from profiles.plan column.
 */
export function usePlan(): UsePlanReturn {
  const [plan, setPlan] = useState<PlanTier>(() => {
    try {
      const stored = localStorage.getItem(PLAN_STORAGE_KEY)
      if (stored && ['free', 'starter', 'pro', 'premium'].includes(stored)) {
        return stored as PlanTier
      }
    } catch { /* ignore */ }
    return 'free'
  })

  const [usage, setUsage] = useState({ applies: 0, coverLetters: 0 })
  const [loading, setLoading] = useState(false)

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

  const limits = useMemo(() => getPlanLimits(plan), [plan])

  const canUse = useCallback(
    (feature: 'bot-apply' | 'ai-coach' | 'full-analytics' | 'feedback-loop' | 'ghost-detection' | 'cover-letter' | 'priority-support') =>
      canUseFeature(plan, feature),
    [plan]
  )

  const remaining = useCallback(
    (feature: 'bot-apply' | 'cover-letter') => {
      const used = feature === 'bot-apply' ? usage.applies : usage.coverLetters
      return getRemainingQuota(plan, used, feature)
    },
    [plan, usage]
  )

  const minimumPlanFor = useCallback(
    (feature: 'bot-apply' | 'ai-coach' | 'full-analytics' | 'feedback-loop' | 'ghost-detection' | 'cover-letter' | 'priority-support') =>
      getMinimumPlan(feature),
    []
  )

  const setPlanOverride = useCallback((newPlan: PlanTier) => {
    try {
      localStorage.setItem(PLAN_STORAGE_KEY, newPlan)
    } catch { /* ignore */ }
    setPlan(newPlan)
  }, [])

  return { plan, limits, canUse, remaining, minimumPlanFor, usage, loading, setPlanOverride }
}
