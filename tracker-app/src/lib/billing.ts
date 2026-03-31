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

/**
 * Initialize trial start date.
 *
 * Priority order (tamper-proof):
 * 1. `userCreatedAt` from Supabase `session.user.created_at` (immutable, server-side)
 * 2. Existing localStorage value (offline fallback / cache)
 * 3. Current timestamp (anonymous / no session)
 *
 * localStorage is always synced as a cache for offline mode.
 */
export function initTrial(userCreatedAt?: string | null): string {
  // Server-side source of truth: user.created_at
  if (userCreatedAt) {
    try {
      localStorage.setItem(TRIAL_STORAGE_KEY, userCreatedAt)
    } catch { /* offline or storage full */ }
    return userCreatedAt
  }

  // Fallback: existing localStorage (offline mode)
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

/**
 * Get the trial start date.
 *
 * Uses Supabase `user.created_at` as source of truth when available.
 * Falls back to localStorage for offline mode.
 */
export function getTrialStartDate(userCreatedAt?: string | null): string | null {
  // Server-side source of truth
  if (userCreatedAt) {
    // Sync to localStorage as cache
    try {
      localStorage.setItem(TRIAL_STORAGE_KEY, userCreatedAt)
    } catch { /* ignore */ }
    return userCreatedAt
  }

  // Offline fallback
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
// Architecture: Server-side Stripe Checkout Sessions via Vercel API route.
//
// Flow:
// 1. User clicks "Subscribe" on PricingView
// 2. Client calls POST /api/create-checkout with { planTier, interval }
// 3. API route verifies auth, creates/retrieves Stripe Customer, creates Checkout Session
// 4. Client redirects to session.url (Stripe hosted checkout)
// 5. On success, Stripe redirects to /settings?checkout=success&plan=X
// 6. Webhook confirms the subscription and updates Supabase profiles

export type BillingInterval = 'weekly' | 'monthly'

/** Returns true if Stripe is configured (publishable key is set) */
export function isStripeConfigured(): boolean {
  return !!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
}

/** Returns true if a plan can be purchased (always true for paid plans when Stripe is configured) */
export function hasPriceIds(plan: PlanTier): boolean {
  if (plan === 'free') return false
  // Price IDs are resolved server-side from env vars.
  // We assume Stripe is configured if the publishable key exists.
  return isStripeConfigured()
}

/**
 * Get the Supabase access token for the current session.
 * Returns null if not authenticated.
 */
async function getAccessToken(): Promise<string | null> {
  try {
    // Dynamic import to avoid circular deps with supabase.ts
    const { supabase } = await import('./supabase')
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  } catch {
    return null
  }
}

/**
 * Creates a Stripe Checkout Session via the API route and redirects to it.
 *
 * Flow:
 * 1. User clicks "Subscribe" on PricingView
 * 2. This function POSTs to /api/create-checkout
 * 3. API route creates a Checkout Session with Stripe
 * 4. This function redirects to the Stripe Checkout URL
 * 5. On success, Stripe redirects to /settings?checkout=success&plan=X
 * 6. handleCheckoutSuccess() picks up the plan from URL params
 */
export async function redirectToCheckout(
  plan: PlanTier,
  interval: BillingInterval = 'weekly',
): Promise<void> {
  if (plan === 'free') {
    console.log('[billing] Free plan — no checkout needed')
    return
  }

  const token = await getAccessToken()
  if (!token) {
    throw new Error('You must be signed in to subscribe. Please log in first.')
  }

  const effectiveInterval: BillingInterval = plan === 'boost' ? 'weekly' : interval

  const response = await fetch('/api/create-checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      planTier: plan,
      interval: effectiveInterval,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(errorData.error || `Checkout failed (${response.status})`)
  }

  const { sessionUrl } = await response.json()
  if (!sessionUrl) {
    throw new Error('No checkout URL returned from server')
  }

  // Redirect to Stripe Checkout
  window.location.href = sessionUrl
}

/**
 * Creates a Stripe Checkout Session and returns the URL.
 * Convenience wrapper around redirectToCheckout for programmatic use.
 */
export async function createCheckoutSession(
  plan: PlanTier,
  interval: BillingInterval = 'weekly',
): Promise<string> {
  if (plan === 'free') {
    return '/pricing'
  }

  const token = await getAccessToken()
  if (!token) {
    throw new Error('You must be signed in to subscribe. Please log in first.')
  }

  const effectiveInterval: BillingInterval = plan === 'boost' ? 'weekly' : interval

  const response = await fetch('/api/create-checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      planTier: plan,
      interval: effectiveInterval,
    }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(errorData.error || `Checkout failed (${response.status})`)
  }

  const { sessionUrl } = await response.json()
  return sessionUrl || '/pricing?checkout=error'
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

/** Usage response from /api/usage */
export interface UsageResponse {
  applies: number
  coverLetters: number
  periodStart?: string
  periodEnd?: string
}

// ─── Usage cache (5-minute TTL) ─────────────────────────────────────────
const USAGE_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
let _usageCache: UsageResponse | null = null
let _usageCacheTimestamp = 0

/** Invalidate the usage cache (e.g. after a bot run completes) */
export function invalidateUsageCache(): void {
  _usageCache = null
  _usageCacheTimestamp = 0
}

/** Gets current month usage from backend, cached for 5 minutes */
export async function getCurrentUsage(): Promise<UsageResponse> {
  const now = Date.now()

  // Return cached value if still fresh
  if (_usageCache && (now - _usageCacheTimestamp) < USAGE_CACHE_TTL_MS) {
    return _usageCache
  }

  try {
    const token = await getAccessToken()
    if (!token) {
      // Not authenticated — return zeros without caching
      return { applies: 0, coverLetters: 0 }
    }

    const response = await fetch('/api/usage', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      console.warn(`[billing] Usage API returned ${response.status}`)
      return _usageCache ?? { applies: 0, coverLetters: 0 }
    }

    const data: UsageResponse = await response.json()
    _usageCache = data
    _usageCacheTimestamp = Date.now()
    return data
  } catch (err) {
    console.warn('[billing] Failed to fetch usage:', err)
    // Return stale cache if available, otherwise zeros
    return _usageCache ?? { applies: 0, coverLetters: 0 }
  }
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
