// ─── Plan & Billing Utilities ────────────────────────────────────────
// Stub layer — ready for Stripe integration. All gating logic is real.

export type PlanTier = 'free' | 'starter' | 'pro' | 'boost'

export interface PlanLimits {
  botAppliesPerMonth: number // 0, 25, 100, Infinity
  atsAdapters: string[] // which adapters available
  coverLettersPerMonth: number // 0, 0, 50, Infinity
  hasAICoach: boolean
  aiCoachLevel: 'none' | 'basic' | 'full'
  hasFeedbackLoop: boolean
  hasGhostDetection: boolean
  hasFullAnalytics: boolean
  hasPrioritySupport: boolean
  hasPhoneSupport: boolean
  hasPriorityATS: boolean
}

export interface PlanConfig {
  name: string
  tier: PlanTier
  priceMonthly: number // in USD, 0 for free
  priceWeekly: number // in USD, 0 for free
  weeklyOnly?: boolean // true for Boost (no monthly option)
  features: PlanFeature[]
  limits: PlanLimits
}

export interface PlanFeature {
  label: string
  included: boolean
  detail?: string // e.g. "50/month", "Basic"
}

const ALL_ATS = [
  'Greenhouse', 'Lever', 'Workable', 'Teamtailor', 'Recruitee',
  'Breezy HR', 'Manatal', 'Oracle HCM', 'SmartRecruiters', 'Ashby',
]

const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    botAppliesPerMonth: 25,
    atsAdapters: ['Greenhouse', 'Lever'],
    coverLettersPerMonth: 10,
    hasAICoach: true,
    aiCoachLevel: 'basic',
    hasFeedbackLoop: false,
    hasGhostDetection: true,
    hasFullAnalytics: false,
    hasPrioritySupport: false,
    hasPhoneSupport: false,
    hasPriorityATS: false,
  },
  starter: {
    botAppliesPerMonth: 100,
    atsAdapters: ['Greenhouse', 'Lever', 'Workable', 'Teamtailor'],
    coverLettersPerMonth: 20,
    hasAICoach: true,
    aiCoachLevel: 'basic',
    hasFeedbackLoop: false,
    hasGhostDetection: true,
    hasFullAnalytics: true,
    hasPrioritySupport: false,
    hasPhoneSupport: false,
    hasPriorityATS: false,
  },
  pro: {
    botAppliesPerMonth: Infinity,
    atsAdapters: [...ALL_ATS],
    coverLettersPerMonth: Infinity,
    hasAICoach: true,
    aiCoachLevel: 'full',
    hasFeedbackLoop: true,
    hasGhostDetection: true,
    hasFullAnalytics: true,
    hasPrioritySupport: false,
    hasPhoneSupport: false,
    hasPriorityATS: false,
  },
  boost: {
    botAppliesPerMonth: Infinity,
    atsAdapters: [...ALL_ATS],
    coverLettersPerMonth: Infinity,
    hasAICoach: true,
    aiCoachLevel: 'full',
    hasFeedbackLoop: true,
    hasGhostDetection: true,
    hasFullAnalytics: true,
    hasPrioritySupport: true,
    hasPhoneSupport: true,
    hasPriorityATS: true,
  },
}

export const PLAN_CONFIGS: PlanConfig[] = [
  {
    name: 'Free',
    tier: 'free',
    priceMonthly: 0,
    priceWeekly: 0,
    limits: PLAN_LIMITS.free,
    features: [
      { label: 'Unlimited job tracking', included: true },
      { label: 'Manual applications', included: true },
      { label: 'Basic analytics', included: true },
      { label: 'AI Coach', included: true, detail: 'Basic' },
      { label: 'Bot auto-apply', included: true, detail: '25/month' },
      { label: 'ATS adapters', included: true, detail: '2 (Greenhouse, Lever)' },
      { label: 'Ghost detection', included: true },
      { label: 'Cover letter AI', included: true, detail: '10/month' },
      { label: 'Feedback loop', included: false },
      { label: 'Priority support', included: false },
    ],
  },
  {
    name: 'Starter',
    tier: 'starter',
    priceMonthly: 29,
    priceWeekly: 9,
    limits: PLAN_LIMITS.starter,
    features: [
      { label: 'Unlimited job tracking', included: true },
      { label: 'Manual applications', included: true },
      { label: 'Full analytics', included: true },
      { label: 'AI Coach', included: true, detail: 'Basic' },
      { label: 'Bot auto-apply', included: true, detail: '100/month' },
      { label: 'ATS adapters', included: true, detail: '4 adapters' },
      { label: 'Ghost detection', included: true },
      { label: 'Cover letter AI', included: true, detail: '20/month' },
      { label: 'Feedback loop', included: false },
      { label: 'Priority support', included: false },
    ],
  },
  {
    name: 'Pro',
    tier: 'pro',
    priceMonthly: 49,
    priceWeekly: 15,
    limits: PLAN_LIMITS.pro,
    features: [
      { label: 'Unlimited job tracking', included: true },
      { label: 'Manual applications', included: true },
      { label: 'Full analytics', included: true },
      { label: 'AI Coach', included: true, detail: 'Full' },
      { label: 'Bot auto-apply', included: true, detail: 'Unlimited' },
      { label: 'ATS adapters', included: true, detail: 'All 10' },
      { label: 'Ghost detection', included: true },
      { label: 'Cover letter AI', included: true, detail: 'Unlimited' },
      { label: 'Feedback loop', included: true },
      { label: 'AI insights & recommendations', included: true },
      { label: 'Priority support', included: false },
    ],
  },
  {
    name: 'Boost',
    tier: 'boost',
    priceMonthly: 0, // weekly only
    priceWeekly: 25,
    weeklyOnly: true,
    limits: PLAN_LIMITS.boost,
    features: [
      { label: 'Everything in Pro', included: true },
      { label: 'Bot auto-apply', included: true, detail: 'Unlimited' },
      { label: 'Priority ATS submission', included: true },
      { label: 'AI cover letters', included: true, detail: 'Unlimited' },
      { label: 'Feedback loop', included: true },
      { label: 'AI insights & recommendations', included: true },
      { label: 'Phone support', included: true },
      { label: 'Priority queue', included: true, detail: 'Your apps processed first' },
    ],
  },
]

// ─── Public API ──────────────────────────────────────────────────────

export function getPlanLimits(plan: PlanTier): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free
}

export function getPlanConfig(plan: PlanTier): PlanConfig {
  return PLAN_CONFIGS.find(c => c.tier === plan) ?? PLAN_CONFIGS[0]
}

type GatableFeature =
  | 'bot-apply'
  | 'ai-coach'
  | 'full-analytics'
  | 'feedback-loop'
  | 'ghost-detection'
  | 'cover-letter'
  | 'priority-support'

/** Check if a feature is available on the given plan */
export function canUseFeature(plan: PlanTier, feature: GatableFeature): boolean {
  const limits = getPlanLimits(plan)
  switch (feature) {
    case 'bot-apply':
      return limits.botAppliesPerMonth > 0
    case 'ai-coach':
      return limits.hasAICoach
    case 'full-analytics':
      return limits.hasFullAnalytics
    case 'feedback-loop':
      return limits.hasFeedbackLoop
    case 'ghost-detection':
      return limits.hasGhostDetection
    case 'cover-letter':
      return limits.coverLettersPerMonth > 0
    case 'priority-support':
      return limits.hasPrioritySupport
    default:
      return false
  }
}

/** Returns the minimum plan required to use a feature */
export function getMinimumPlan(feature: GatableFeature): PlanTier {
  const tiers: PlanTier[] = ['free', 'starter', 'pro', 'boost']
  for (const tier of tiers) {
    if (canUseFeature(tier, feature)) return tier
  }
  return 'boost'
}

type QuotaFeature = 'bot-apply' | 'cover-letter'

/** Get remaining quota for usage-limited features */
export function getRemainingQuota(plan: PlanTier, used: number, feature: QuotaFeature): number {
  const limits = getPlanLimits(plan)
  let max: number
  switch (feature) {
    case 'bot-apply':
      max = limits.botAppliesPerMonth
      break
    case 'cover-letter':
      max = limits.coverLettersPerMonth
      break
    default:
      max = 0
  }
  if (max === Infinity) return Infinity
  return Math.max(0, max - used)
}

// ─── Stripe Stubs (to be implemented when Stripe is set up) ─────────

/** Creates a Stripe Checkout session — returns redirect URL */
export async function createCheckoutSession(plan: PlanTier): Promise<string> {
  // TODO: Call /api/stripe/checkout with plan tier
  console.log(`[billing] createCheckoutSession called for plan: ${plan}`)
  return `/pricing?checkout=pending&plan=${plan}`
}

/** Creates a Stripe Customer Portal session — returns redirect URL */
export async function createPortalSession(): Promise<string> {
  // TODO: Call /api/stripe/portal
  console.log('[billing] createPortalSession called')
  return '/pricing?portal=pending'
}

/** Gets current month usage from backend */
export async function getCurrentUsage(): Promise<{ applies: number; coverLetters: number }> {
  // TODO: Fetch from /api/usage
  return { applies: 0, coverLetters: 0 }
}
