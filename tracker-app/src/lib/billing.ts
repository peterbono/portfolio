// ─── Plan & Billing Utilities ────────────────────────────────────────
// Stripe-integrated billing via Payment Links. All gating logic is real.

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
  hasStealth: boolean
}

// ─── Platform-Based Apply Limits ────────────────────────────────────
export interface PlatformLimits {
  linkedInPerDay: number
  atsPerDay: number
}

/** Platform limits per plan tier (+ trial) */
export const PLATFORM_LIMITS: Record<PlanTier | 'trial', PlatformLimits> = {
  trial:   { linkedInPerDay: 5,   atsPerDay: 15  },
  free:    { linkedInPerDay: 0,   atsPerDay: 0   },
  starter: { linkedInPerDay: 10,  atsPerDay: 999 },
  pro:     { linkedInPerDay: 20,  atsPerDay: 999 },
  boost:   { linkedInPerDay: 999, atsPerDay: 999 },
}

export function getPlatformLimits(plan: PlanTier, isTrialActive: boolean): PlatformLimits {
  if (isTrialActive && plan === 'free') return PLATFORM_LIMITS.trial
  return PLATFORM_LIMITS[plan]
}

// ─── Trial System ───────────────────────────────────────────────────
export const TRIAL_STORAGE_KEY = 'tracker_v2_trial_start'
export const TRIAL_DURATION_DAYS = 14

/** Initialize trial if not already set. Call on first auth / signup. */
export function initTrial(): string {
  try {
    const existing = localStorage.getItem(TRIAL_STORAGE_KEY)
    if (existing) return existing
    const now = new Date().toISOString()
    localStorage.setItem(TRIAL_STORAGE_KEY, now)
    return now
  } catch {
    return new Date().toISOString()
  }
}

/** Read stored trial start date */
export function getTrialStartDate(): string | null {
  try {
    return localStorage.getItem(TRIAL_STORAGE_KEY)
  } catch {
    return null
  }
}

/** Calculate days remaining in trial (0 if expired) */
export function getTrialDaysLeft(startDate: string | null): number {
  if (!startDate) return 0
  const start = new Date(startDate).getTime()
  if (isNaN(start)) return 0
  const now = Date.now()
  const elapsed = now - start
  const remaining = TRIAL_DURATION_DAYS - elapsed / (1000 * 60 * 60 * 24)
  return Math.max(0, Math.ceil(remaining))
}

/** Is the trial still active? */
export function isTrialActive(startDate: string | null): boolean {
  return getTrialDaysLeft(startDate) > 0
}

/** Is the trial expired (was started but has run out)? */
export function isTrialExpired(startDate: string | null): boolean {
  if (!startDate) return false
  return getTrialDaysLeft(startDate) <= 0
}

/**
 * Returns the effective plan: 'pro' during trial (if base plan is free),
 * otherwise the actual plan.
 */
export function getEffectivePlan(basePlan: PlanTier, trialStartDate: string | null): PlanTier {
  if (basePlan !== 'free') return basePlan
  if (isTrialActive(trialStartDate)) return 'pro'
  return 'free'
}

/** Whether the user can use the auto-apply bot */
export function canUseBotCheck(basePlan: PlanTier, trialStartDate: string | null): boolean {
  if (basePlan !== 'free') return true
  return isTrialActive(trialStartDate)
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
    botAppliesPerMonth: 0,
    atsAdapters: [],
    coverLettersPerMonth: 0,
    hasAICoach: true,
    aiCoachLevel: 'basic',
    hasFeedbackLoop: false,
    hasGhostDetection: true,
    hasFullAnalytics: false,
    hasPrioritySupport: false,
    hasPhoneSupport: false,
    hasPriorityATS: false,
    hasStealth: false,
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
    hasStealth: true,
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
    hasStealth: true,
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
    hasStealth: true,
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
      { label: '14-day full access trial', included: true },
      { label: 'Unlimited job tracking', included: true, detail: 'Forever' },
      { label: 'Analytics & insights', included: true, detail: 'Forever' },
      { label: 'AI Coach', included: true, detail: 'Forever' },
      { label: 'Gmail sync', included: true, detail: 'Forever' },
      { label: 'Auto-apply bot', included: false, detail: 'Trial only' },
      { label: 'Stealth Mode', included: false, detail: 'Paid only' },
      { label: 'LinkedIn access', included: false, detail: 'Paid only' },
    ],
  },
  {
    name: 'Starter',
    tier: 'starter',
    priceMonthly: 29,
    priceWeekly: 9,
    limits: PLAN_LIMITS.starter,
    features: [
      { label: '10 LinkedIn applies/day', included: true },
      { label: 'Unlimited ATS applies', included: true },
      { label: 'Unlimited job tracking', included: true },
      { label: 'Full analytics', included: true },
      { label: 'AI Coach', included: true, detail: 'Basic' },
      { label: 'Stealth Mode', included: true },
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
      { label: '20 LinkedIn applies/day', included: true },
      { label: 'Unlimited ATS applies', included: true },
      { label: 'Unlimited job tracking', included: true },
      { label: 'Full analytics', included: true },
      { label: 'AI Coach', included: true, detail: 'Full' },
      { label: 'Stealth Mode', included: true },
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
      { label: 'Unlimited LinkedIn applies', included: true },
      { label: 'Unlimited ATS applies', included: true },
      { label: 'Everything in Pro', included: true },
      { label: 'Priority Stealth Mode', included: true, detail: 'Priority queue' },
      { label: 'Priority ATS submission', included: true },
      { label: 'AI cover letters', included: true, detail: 'Unlimited' },
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
  | 'bot_apply'
  | 'ai-coach'
  | 'full-analytics'
  | 'feedback-loop'
  | 'ghost-detection'
  | 'cover-letter'
  | 'priority-support'
  | 'stealth'
  | 'linkedin-access'

/** Check if a feature is available on the given plan */
export function canUseFeature(plan: PlanTier, feature: GatableFeature): boolean {
  const limits = getPlanLimits(plan)
  switch (feature) {
    case 'bot-apply':
    case 'bot_apply':
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
    case 'stealth':
      return limits.hasStealth
    case 'linkedin-access':
      return limits.hasStealth // same gating as stealth — requires paid plan
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

// ─── Stripe Integration ─────────────────────────────────────────────
//
// Architecture: Client-only via Stripe Payment Links.
//
// Stripe.js v8 removed client-side `redirectToCheckout`.
// For an SPA without a backend, the simplest approach is Payment Links:
// - Create Payment Links in Stripe Dashboard (one per plan/interval)
// - Paste the URLs below
// - On click, redirect to the Payment Link
// - Stripe handles checkout, then redirects back to our success URL
//
// When you add a backend (Vercel API routes / Supabase Edge Functions),
// upgrade to server-side Checkout Sessions for more control.

/**
 * Stripe Payment Link lookup table.
 *
 * Create Payment Links in Stripe Dashboard:
 *   Products → create product → create price → Payment Links → + New
 *
 * For each link, configure "After payment" to redirect to your success URL.
 * Payment Link URLs (buy.stripe.com/...) are public checkout URLs, not secrets.
 */
export const STRIPE_PAYMENT_LINKS: Record<string, { weekly?: string; monthly?: string }> = {
  starter: {
    weekly:  'https://buy.stripe.com/fZufZhdLX8oFgRvat53VC01',
    monthly: 'https://buy.stripe.com/7sY14n4bn48p0Sx6cP3VC02',
  },
  pro: {
    weekly:  'https://buy.stripe.com/aFa3cvgY96gx30F9p13VC03',
    monthly: 'https://buy.stripe.com/4gMfZh9vHeN36cR58L3VC04',
  },
  boost: {
    weekly:  'https://buy.stripe.com/dRmbJ1eQ120h6cR8kX3VC00',
  },
}

/** Returns true if at least one plan has payment links configured */
export function isStripeConfigured(): boolean {
  return Object.values(STRIPE_PAYMENT_LINKS).some(
    links => !!(links.weekly || links.monthly)
  )
}

/** Returns true if a specific plan has at least one payment link */
export function hasPriceIds(plan: PlanTier): boolean {
  const links = STRIPE_PAYMENT_LINKS[plan]
  if (!links) return false
  return !!(links.weekly || links.monthly)
}

export type BillingInterval = 'weekly' | 'monthly'

/**
 * Redirects the user to Stripe Checkout via a Payment Link.
 *
 * Flow:
 * 1. User clicks "Subscribe" on PricingView
 * 2. This function navigates to the Stripe Payment Link
 * 3. Stripe handles the entire checkout (hosted page)
 * 4. On success, Stripe redirects to /settings?checkout=success&plan=X
 * 5. handleCheckoutSuccess() picks up the plan from URL params
 */
export async function redirectToCheckout(
  plan: PlanTier,
  interval: BillingInterval = 'weekly',
): Promise<void> {
  if (plan === 'free') {
    console.log('[billing] Free plan — no checkout needed')
    return
  }

  const links = STRIPE_PAYMENT_LINKS[plan]
  if (!links) {
    throw new Error(`[billing] No Payment Links configured for plan: ${plan}`)
  }

  const effectiveInterval = plan === 'boost' ? 'weekly' : interval
  const paymentLink = effectiveInterval === 'weekly' ? links.weekly : links.monthly

  if (!paymentLink) {
    throw new Error(
      `[billing] No ${effectiveInterval} Payment Link for plan: ${plan}. ` +
      `Create one in Stripe Dashboard and paste it in STRIPE_PAYMENT_LINKS.`
    )
  }

  // Redirect to Stripe Payment Link
  window.location.href = paymentLink
}

/**
 * Legacy alias — kept for backward compatibility.
 */
export async function createCheckoutSession(
  plan: PlanTier,
  interval: BillingInterval = 'weekly',
): Promise<string> {
  if (!hasPriceIds(plan)) {
    console.warn(`[billing] Stripe not configured for ${plan} — returning stub URL`)
    return `/pricing?checkout=pending&plan=${plan}`
  }
  await redirectToCheckout(plan, interval)
  return ''
}

/**
 * Opens the Stripe Customer Portal for managing subscriptions.
 *
 * Customer Portal requires a server-side call to create a session.
 * For MVP, this calls a backend endpoint (Supabase Edge Function or
 * Vercel API route) that runs stripe.billingPortal.sessions.create().
 */
export async function createPortalSession(): Promise<string> {
  const portalEndpoint = import.meta.env.VITE_STRIPE_PORTAL_URL
  if (portalEndpoint) {
    try {
      const res = await fetch(portalEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
      if (res.ok) {
        const { url } = await res.json()
        return url
      }
      console.error('[billing] Portal session creation failed:', res.status)
    } catch (err) {
      console.error('[billing] Portal session error:', err)
    }
  }
  console.warn('[billing] No VITE_STRIPE_PORTAL_URL configured')
  return '/settings?portal=unavailable'
}

/** Gets current month usage from backend */
export async function getCurrentUsage(): Promise<{ applies: number; coverLetters: number }> {
  // TODO: Fetch from Supabase or /api/usage when usage tracking is implemented
  return { applies: 0, coverLetters: 0 }
}

/**
 * Parse the checkout success callback and update the local plan.
 * Call this on any page load after Stripe redirects back.
 *
 * Payment Links redirect to the "After payment" URL you configure.
 * Set that to: https://your-app.vercel.app/settings?checkout=success&plan={PLAN}
 */
export function handleCheckoutSuccess(): { plan: PlanTier; sessionId: string } | null {
  const params = new URLSearchParams(window.location.search)
  const checkout = params.get('checkout')
  const plan = params.get('plan') as PlanTier | null
  const sessionId = params.get('session_id') || 'payment-link'

  if (checkout === 'success' && plan && ['starter', 'pro', 'boost'].includes(plan)) {
    // Store plan locally — webhook/backend confirms later
    try {
      localStorage.setItem('tracker_user_plan', plan)
    } catch { /* ignore */ }

    // Clean up the URL
    const url = new URL(window.location.href)
    url.searchParams.delete('checkout')
    url.searchParams.delete('plan')
    url.searchParams.delete('session_id')
    window.history.replaceState({}, '', url.toString())

    return { plan, sessionId }
  }
  return null
}
