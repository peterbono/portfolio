// ─── Plan & Billing Utilities ────────────────────────────────────────
// Stub layer — ready for Stripe integration. All gating logic is real.

export type PlanTier = 'free' | 'starter' | 'pro' | 'premium'

export interface PlanLimits {
  botAppliesPerMonth: number // 0, 50, 200, Infinity
  atsAdapters: string[] // which adapters available
  coverLettersPerMonth: number // 0, 0, 50, Infinity
  hasAICoach: boolean
  aiCoachLevel: 'none' | 'basic' | 'full'
  hasFeedbackLoop: boolean
  hasGhostDetection: boolean
  hasFullAnalytics: boolean
  hasPrioritySupport: boolean
}

export interface PlanConfig {
  name: string
  tier: PlanTier
  priceMonthly: number // in USD, 0 for free
  priceAnnual: number // in USD, 0 for free
  limits: PlanLimits
  features: PlanFeature[]
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
    botAppliesPerMonth: 0,
    atsAdapters: [],
    coverLettersPerMonth: 0,
    hasAICoach: false,
    aiCoachLevel: 'none',
    hasFeedbackLoop: false,
    hasGhostDetection: false,
    hasFullAnalytics: false,
    hasPrioritySupport: false,
  },
  starter: {
    botAppliesPerMonth: 50,
    atsAdapters: ['Greenhouse', 'Lever'],
    coverLettersPerMonth: 0,
    hasAICoach: true,
    aiCoachLevel: 'basic',
    hasFeedbackLoop: false,
    hasGhostDetection: false,
    hasFullAnalytics: true,
    hasPrioritySupport: false,
  },
  pro: {
    botAppliesPerMonth: 200,
    atsAdapters: [...ALL_ATS],
    coverLettersPerMonth: 50,
    hasAICoach: true,
    aiCoachLevel: 'full',
    hasFeedbackLoop: true,
    hasGhostDetection: true,
    hasFullAnalytics: true,
    hasPrioritySupport: false,
  },
  premium: {
    botAppliesPerMonth: Infinity,
    atsAdapters: [...ALL_ATS],
    coverLettersPerMonth: Infinity,
    hasAICoach: true,
    aiCoachLevel: 'full',
    hasFeedbackLoop: true,
    hasGhostDetection: true,
    hasFullAnalytics: true,
    hasPrioritySupport: true,
  },
}

export const PLAN_CONFIGS: PlanConfig[] = [
  {
    name: 'Free',
    tier: 'free',
    priceMonthly: 0,
    priceAnnual: 0,
    limits: PLAN_LIMITS.free,
    features: [
      { label: 'Unlimited job tracking', included: true },
      { label: 'Manual applications', included: true },
      { label: 'Basic analytics', included: true },
      { label: 'AI Coach', included: false },
      { label: 'Bot auto-apply', included: false },
      { label: 'ATS adapters', included: false },
      { label: 'Feedback loop', included: false },
      { label: 'Ghost detection', included: false },
      { label: 'Cover letter AI', included: false },
      { label: 'Priority support', included: false },
    ],
  },
  {
    name: 'Starter',
    tier: 'starter',
    priceMonthly: 19,
    priceAnnual: Math.round(19 * 12 * 0.8),
    limits: PLAN_LIMITS.starter,
    features: [
      { label: 'Unlimited job tracking', included: true },
      { label: 'Manual applications', included: true },
      { label: 'Full analytics', included: true },
      { label: 'AI Coach', included: true, detail: 'Basic' },
      { label: 'Bot auto-apply', included: true, detail: '50/month' },
      { label: 'ATS adapters', included: true, detail: '2 (Greenhouse, Lever)' },
      { label: 'Feedback loop', included: false },
      { label: 'Ghost detection', included: false },
      { label: 'Cover letter AI', included: false },
      { label: 'Priority support', included: false },
    ],
  },
  {
    name: 'Pro',
    tier: 'pro',
    priceMonthly: 39,
    priceAnnual: Math.round(39 * 12 * 0.8),
    limits: PLAN_LIMITS.pro,
    features: [
      { label: 'Unlimited job tracking', included: true },
      { label: 'Manual applications', included: true },
      { label: 'Full analytics', included: true },
      { label: 'AI Coach', included: true, detail: 'Full' },
      { label: 'Bot auto-apply', included: true, detail: '200/month' },
      { label: 'ATS adapters', included: true, detail: 'All' },
      { label: 'Feedback loop', included: true },
      { label: 'Ghost detection', included: true },
      { label: 'Cover letter AI', included: true, detail: '50/month' },
      { label: 'Priority support', included: false },
    ],
  },
  {
    name: 'Premium',
    tier: 'premium',
    priceMonthly: 79,
    priceAnnual: Math.round(79 * 12 * 0.8),
    limits: PLAN_LIMITS.premium,
    features: [
      { label: 'Unlimited job tracking', included: true },
      { label: 'Manual applications', included: true },
      { label: 'Full analytics', included: true },
      { label: 'AI Coach', included: true, detail: 'Full' },
      { label: 'Bot auto-apply', included: true, detail: 'Unlimited' },
      { label: 'ATS adapters', included: true, detail: 'All + priority' },
      { label: 'Feedback loop', included: true },
      { label: 'Ghost detection', included: true },
      { label: 'Cover letter AI', included: true, detail: 'Unlimited' },
      { label: 'Priority support', included: true },
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
  const tiers: PlanTier[] = ['free', 'starter', 'pro', 'premium']
  for (const tier of tiers) {
    if (canUseFeature(tier, feature)) return tier
  }
  return 'premium'
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
