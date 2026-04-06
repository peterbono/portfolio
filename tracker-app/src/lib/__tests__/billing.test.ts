import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getPlanLimits,
  getPlanConfig,
  canUseFeature,
  getMinimumPlan,
  getRemainingQuota,
  canRunBot,
  PLAN_CONFIGS,
  PLATFORM_LIMITS,
  redirectToCheckout,
  handleCheckoutSuccess,
} from '../billing'
import type { PlanTier, BillingInterval } from '../billing'

// ─── Global mock for supabase (used by redirectToCheckout via dynamic import) ─
const mockGetSession = vi.fn()
vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}))

// ═══════════════════════════════════════════════════════════════════════
//  getPlanLimits
// ═══════════════════════════════════════════════════════════════════════

describe('getPlanLimits', () => {
  it('returns correct limits for free tier', () => {
    const limits = getPlanLimits('free')
    expect(limits.botAppliesPerMonth).toBe(0)
    expect(limits.coverLettersPerMonth).toBe(0)
    expect(limits.hasGhostDetection).toBe(true)
    expect(limits.hasAICoach).toBe(true)
    expect(limits.aiCoachLevel).toBe('basic')
    expect(limits.hasFeedbackLoop).toBe(false)
    expect(limits.hasFullAnalytics).toBe(false)
    expect(limits.hasPrioritySupport).toBe(false)
    expect(limits.atsAdapters).toEqual([])
  })

  it('returns correct limits for starter tier', () => {
    const limits = getPlanLimits('starter')
    expect(limits.botAppliesPerMonth).toBe(150)
    expect(limits.coverLettersPerMonth).toBe(20)
    expect(limits.hasGhostDetection).toBe(true)
    expect(limits.hasFullAnalytics).toBe(true)
    expect(limits.hasFeedbackLoop).toBe(false)
    expect(limits.hasPrioritySupport).toBe(false)
    expect(limits.atsAdapters).toHaveLength(4)
  })

  it('returns correct limits for pro tier', () => {
    const limits = getPlanLimits('pro')
    expect(limits.botAppliesPerMonth).toBe(500)
    expect(limits.coverLettersPerMonth).toBe(Infinity)
    expect(limits.hasGhostDetection).toBe(true)
    expect(limits.hasFeedbackLoop).toBe(true)
    expect(limits.hasFullAnalytics).toBe(true)
    expect(limits.aiCoachLevel).toBe('full')
    expect(limits.hasPrioritySupport).toBe(false)
    expect(limits.atsAdapters).toHaveLength(10)
  })

  it('returns correct limits for boost tier', () => {
    const limits = getPlanLimits('boost')
    expect(limits.botAppliesPerMonth).toBe(1500)
    expect(limits.coverLettersPerMonth).toBe(Infinity)
    expect(limits.hasGhostDetection).toBe(true)
    expect(limits.hasFeedbackLoop).toBe(true)
    expect(limits.hasFullAnalytics).toBe(true)
    expect(limits.hasPrioritySupport).toBe(true)
    expect(limits.hasPhoneSupport).toBe(true)
    expect(limits.hasPriorityATS).toBe(true)
    expect(limits.aiCoachLevel).toBe('full')
    expect(limits.atsAdapters).toHaveLength(10)
  })

  it('falls back to free tier for unknown plan', () => {
    const limits = getPlanLimits('nonexistent' as PlanTier)
    expect(limits.botAppliesPerMonth).toBe(0)
  })

  it('all four tiers have hasAICoach = true', () => {
    const tiers: PlanTier[] = ['free', 'starter', 'pro', 'boost']
    for (const tier of tiers) {
      expect(getPlanLimits(tier).hasAICoach).toBe(true)
    }
  })

  it('pro and boost have all 10 ATS adapters', () => {
    expect(getPlanLimits('pro').atsAdapters).toHaveLength(10)
    expect(getPlanLimits('boost').atsAdapters).toHaveLength(10)
  })

  it('free has 0 ATS adapters, starter has 4', () => {
    expect(getPlanLimits('free').atsAdapters).toHaveLength(0)
    expect(getPlanLimits('starter').atsAdapters).toHaveLength(4)
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  getPlanConfig
// ═══════════════════════════════════════════════════════════════════════

describe('getPlanConfig', () => {
  it('returns config for each tier', () => {
    expect(getPlanConfig('free').name).toBe('Free')
    expect(getPlanConfig('starter').name).toBe('Starter')
    expect(getPlanConfig('pro').name).toBe('Pro')
    expect(getPlanConfig('boost').name).toBe('Boost')
  })

  it('free tier has price 0 for both weekly and monthly', () => {
    const config = getPlanConfig('free')
    expect(config.priceMonthly).toBe(0)
    expect(config.priceWeekly).toBe(0)
  })

  it('starter: $9/wk, $29/mo', () => {
    const starter = getPlanConfig('starter')
    expect(starter.priceWeekly).toBe(9)
    expect(starter.priceMonthly).toBe(29)
  })

  it('pro: $15/wk, $49/mo', () => {
    const pro = getPlanConfig('pro')
    expect(pro.priceWeekly).toBe(15)
    expect(pro.priceMonthly).toBe(49)
  })

  it('boost: $25/wk, weekly only', () => {
    const boost = getPlanConfig('boost')
    expect(boost.priceWeekly).toBe(25)
    expect(boost.weeklyOnly).toBe(true)
  })

  it('each config has features array', () => {
    const tiers: PlanTier[] = ['free', 'starter', 'pro', 'boost']
    for (const tier of tiers) {
      const config = getPlanConfig(tier)
      expect(Array.isArray(config.features)).toBe(true)
      expect(config.features.length).toBeGreaterThan(0)
    }
  })

  it('falls back to free config for unknown plan', () => {
    const config = getPlanConfig('unknown' as PlanTier)
    expect(config.name).toBe('Free')
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  canUseFeature
// ═══════════════════════════════════════════════════════════════════════

describe('canUseFeature', () => {
  // bot-apply: free has 0 applies, paid tiers have > 0
  it('bot-apply is NOT on free, but IS on starter+', () => {
    expect(canUseFeature('free', 'bot-apply')).toBe(false)
    expect(canUseFeature('starter', 'bot-apply')).toBe(true)
    expect(canUseFeature('pro', 'bot-apply')).toBe(true)
    expect(canUseFeature('boost', 'bot-apply')).toBe(true)
  })

  // ai-coach: all tiers have it
  it('ai-coach is available on all tiers', () => {
    expect(canUseFeature('free', 'ai-coach')).toBe(true)
    expect(canUseFeature('starter', 'ai-coach')).toBe(true)
    expect(canUseFeature('pro', 'ai-coach')).toBe(true)
    expect(canUseFeature('boost', 'ai-coach')).toBe(true)
  })

  // full-analytics: not free, yes starter+
  it('full-analytics is NOT on free, but IS on starter+', () => {
    expect(canUseFeature('free', 'full-analytics')).toBe(false)
    expect(canUseFeature('starter', 'full-analytics')).toBe(true)
    expect(canUseFeature('pro', 'full-analytics')).toBe(true)
    expect(canUseFeature('boost', 'full-analytics')).toBe(true)
  })

  // feedback-loop: pro and boost only
  it('feedback-loop is only on pro and boost', () => {
    expect(canUseFeature('free', 'feedback-loop')).toBe(false)
    expect(canUseFeature('starter', 'feedback-loop')).toBe(false)
    expect(canUseFeature('pro', 'feedback-loop')).toBe(true)
    expect(canUseFeature('boost', 'feedback-loop')).toBe(true)
  })

  // ghost-detection: all tiers now have it
  it('ghost-detection is available on all tiers', () => {
    expect(canUseFeature('free', 'ghost-detection')).toBe(true)
    expect(canUseFeature('starter', 'ghost-detection')).toBe(true)
    expect(canUseFeature('pro', 'ghost-detection')).toBe(true)
    expect(canUseFeature('boost', 'ghost-detection')).toBe(true)
  })

  // cover-letter: free has 0, paid tiers have > 0
  it('cover-letter is NOT on free, but IS on starter+', () => {
    expect(canUseFeature('free', 'cover-letter')).toBe(false)
    expect(canUseFeature('starter', 'cover-letter')).toBe(true)
    expect(canUseFeature('pro', 'cover-letter')).toBe(true)
    expect(canUseFeature('boost', 'cover-letter')).toBe(true)
  })

  // priority-support: boost only
  it('priority-support is boost only', () => {
    expect(canUseFeature('free', 'priority-support')).toBe(false)
    expect(canUseFeature('starter', 'priority-support')).toBe(false)
    expect(canUseFeature('pro', 'priority-support')).toBe(false)
    expect(canUseFeature('boost', 'priority-support')).toBe(true)
  })

  it('returns false for unknown feature', () => {
    expect(canUseFeature('boost', 'nonexistent' as any)).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  getMinimumPlan
// ═══════════════════════════════════════════════════════════════════════

describe('getMinimumPlan', () => {
  it('bot-apply minimum is starter', () => {
    expect(getMinimumPlan('bot-apply')).toBe('starter')
  })

  it('ai-coach minimum is free', () => {
    expect(getMinimumPlan('ai-coach')).toBe('free')
  })

  it('full-analytics minimum is starter', () => {
    expect(getMinimumPlan('full-analytics')).toBe('starter')
  })

  it('feedback-loop minimum is pro', () => {
    expect(getMinimumPlan('feedback-loop')).toBe('pro')
  })

  it('ghost-detection minimum is free', () => {
    expect(getMinimumPlan('ghost-detection')).toBe('free')
  })

  it('cover-letter minimum is starter', () => {
    expect(getMinimumPlan('cover-letter')).toBe('starter')
  })

  it('priority-support minimum is boost', () => {
    expect(getMinimumPlan('priority-support')).toBe('boost')
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  getRemainingQuota
// ═══════════════════════════════════════════════════════════════════════

describe('getRemainingQuota', () => {
  it('bot-apply: free tier has 0 total, any used = 0 remaining', () => {
    expect(getRemainingQuota('free', 0, 'bot-apply')).toBe(0)
  })

  it('bot-apply: free tier, 10 used = 0 remaining', () => {
    expect(getRemainingQuota('free', 10, 'bot-apply')).toBe(0)
  })

  it('bot-apply: free tier, 30 used = 0 remaining (clamped)', () => {
    expect(getRemainingQuota('free', 30, 'bot-apply')).toBe(0)
  })

  it('bot-apply: starter tier has 150 total', () => {
    expect(getRemainingQuota('starter', 20, 'bot-apply')).toBe(130)
  })

  it('bot-apply: pro tier has 500 total', () => {
    expect(getRemainingQuota('pro', 150, 'bot-apply')).toBe(350)
  })

  it('bot-apply: boost tier has 1500 total', () => {
    expect(getRemainingQuota('boost', 1500, 'bot-apply')).toBe(0)
  })

  it('cover-letter: free tier has 0 total', () => {
    expect(getRemainingQuota('free', 5, 'cover-letter')).toBe(0)
  })

  it('cover-letter: starter tier has 20 total', () => {
    expect(getRemainingQuota('starter', 10, 'cover-letter')).toBe(10)
  })

  it('cover-letter: pro tier returns Infinity', () => {
    expect(getRemainingQuota('pro', 10, 'cover-letter')).toBe(Infinity)
  })

  it('cover-letter: boost tier returns Infinity', () => {
    expect(getRemainingQuota('boost', 500, 'cover-letter')).toBe(Infinity)
  })

  it('0 used returns full quota', () => {
    expect(getRemainingQuota('free', 0, 'bot-apply')).toBe(0)
    expect(getRemainingQuota('free', 0, 'cover-letter')).toBe(0)
    expect(getRemainingQuota('starter', 0, 'bot-apply')).toBe(150)
    expect(getRemainingQuota('starter', 0, 'cover-letter')).toBe(20)
  })

  it('returns 0 for unknown feature', () => {
    expect(getRemainingQuota('boost', 0, 'nonexistent' as any)).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  PLAN_CONFIGS structure
// ═══════════════════════════════════════════════════════════════════════

describe('PLAN_CONFIGS', () => {
  it('has exactly 4 plans', () => {
    expect(PLAN_CONFIGS).toHaveLength(4)
  })

  it('plans are in order: free, starter, pro, boost', () => {
    expect(PLAN_CONFIGS[0].tier).toBe('free')
    expect(PLAN_CONFIGS[1].tier).toBe('starter')
    expect(PLAN_CONFIGS[2].tier).toBe('pro')
    expect(PLAN_CONFIGS[3].tier).toBe('boost')
  })

  it('each plan config has a non-empty name', () => {
    for (const config of PLAN_CONFIGS) {
      expect(config.name.length).toBeGreaterThan(0)
    }
  })

  it('weekly prices increase from free to boost', () => {
    for (let i = 1; i < PLAN_CONFIGS.length; i++) {
      expect(PLAN_CONFIGS[i].priceWeekly).toBeGreaterThanOrEqual(PLAN_CONFIGS[i - 1].priceWeekly)
    }
  })

  it('each plan has at least 5 features listed', () => {
    for (const config of PLAN_CONFIGS) {
      expect(config.features.length).toBeGreaterThanOrEqual(5)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  PLAN_CONFIGS price validation
// ═══════════════════════════════════════════════════════════════════════

describe('PLAN_CONFIGS price validation', () => {
  it('Starter weekly = $9, monthly = $29', () => {
    const starter = PLAN_CONFIGS.find(c => c.tier === 'starter')!
    expect(starter.priceWeekly).toBe(9)
    expect(starter.priceMonthly).toBe(29)
  })

  it('Pro weekly = $15, monthly = $49', () => {
    const pro = PLAN_CONFIGS.find(c => c.tier === 'pro')!
    expect(pro.priceWeekly).toBe(15)
    expect(pro.priceMonthly).toBe(49)
  })

  it('Boost weekly = $25, no monthly (weeklyOnly = true)', () => {
    const boost = PLAN_CONFIGS.find(c => c.tier === 'boost')!
    expect(boost.priceWeekly).toBe(25)
    expect(boost.weeklyOnly).toBe(true)
    // Boost has priceMonthly = 0 because it is weekly-only
    expect(boost.priceMonthly).toBe(0)
  })

  it('Free has $0 for both intervals', () => {
    const free = PLAN_CONFIGS.find(c => c.tier === 'free')!
    expect(free.priceWeekly).toBe(0)
    expect(free.priceMonthly).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  Plan feature limits
// ═══════════════════════════════════════════════════════════════════════

describe('Plan feature limits', () => {
  it('Free: 0 applies, 0 cover letters', () => {
    const limits = getPlanLimits('free')
    expect(limits.botAppliesPerMonth).toBe(0)
    expect(limits.coverLettersPerMonth).toBe(0)
  })

  it('Starter: 150 applies, 20 cover letters', () => {
    const limits = getPlanLimits('starter')
    expect(limits.botAppliesPerMonth).toBe(150)
    expect(limits.coverLettersPerMonth).toBe(20)
  })

  it('Pro: 500 applies, Infinity cover letters', () => {
    const limits = getPlanLimits('pro')
    expect(limits.botAppliesPerMonth).toBe(500)
    expect(limits.coverLettersPerMonth).toBe(Infinity)
  })

  it('Boost: 1500 applies, Infinity cover letters', () => {
    const limits = getPlanLimits('boost')
    expect(limits.botAppliesPerMonth).toBe(1500)
    expect(limits.coverLettersPerMonth).toBe(Infinity)
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  redirectToCheckout
// ═══════════════════════════════════════════════════════════════════════

describe('redirectToCheckout', () => {
  let originalFetch: typeof globalThis.fetch
  let originalLocation: PropertyDescriptor | undefined

  beforeEach(() => {
    originalFetch = globalThis.fetch
    originalLocation = Object.getOwnPropertyDescriptor(window, 'location')
    mockGetSession.mockReset()

    // Mock window.location.href as writable
    Object.defineProperty(window, 'location', {
      value: { href: 'http://localhost/', search: '', pathname: '/' },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalLocation) {
      Object.defineProperty(window, 'location', originalLocation)
    }
  })

  it('returns early for free plan without calling fetch', async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy
    await redirectToCheckout('free')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('throws if not authenticated (no access token)', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })

    await expect(redirectToCheckout('starter')).rejects.toThrow(
      'You must be signed in to subscribe'
    )
  })

  it('calls fetch with correct planTier and interval when authenticated', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'test-token-123' } },
    })

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sessionUrl: 'https://checkout.stripe.com/test' }),
    })
    globalThis.fetch = fetchSpy

    await redirectToCheckout('starter', 'monthly')

    expect(fetchSpy).toHaveBeenCalledWith('/api/create-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token-123',
      },
      body: JSON.stringify({ planTier: 'starter', interval: 'monthly' }),
    })
  })

  it('forces weekly interval for boost plan regardless of input', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'test-token-123' } },
    })

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sessionUrl: 'https://checkout.stripe.com/test' }),
    })
    globalThis.fetch = fetchSpy

    await redirectToCheckout('boost', 'monthly')

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.interval).toBe('weekly')
  })

  it('handles fetch error gracefully (non-ok response)', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'test-token-123' } },
    })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Server error' }),
    })

    await expect(redirectToCheckout('pro')).rejects.toThrow('Server error')
  })

  it('handles fetch error when response JSON fails to parse', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'test-token-123' } },
    })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error('not json')),
    })

    await expect(redirectToCheckout('pro')).rejects.toThrow('Unknown error')
  })

  it('handles missing sessionUrl in response', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'test-token-123' } },
    })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sessionUrl: null }),
    })

    await expect(redirectToCheckout('starter')).rejects.toThrow(
      'No checkout URL returned from server'
    )
  })

  it('redirects to sessionUrl on success', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'test-token-123' } },
    })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sessionUrl: 'https://checkout.stripe.com/session_abc' }),
    })

    await redirectToCheckout('pro', 'weekly')

    expect(window.location.href).toBe('https://checkout.stripe.com/session_abc')
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  handleCheckoutSuccess
// ═══════════════════════════════════════════════════════════════════════

describe('handleCheckoutSuccess', () => {
  let originalLocation: PropertyDescriptor | undefined

  beforeEach(() => {
    originalLocation = Object.getOwnPropertyDescriptor(window, 'location')
    localStorage.clear()
  })

  afterEach(() => {
    if (originalLocation) {
      Object.defineProperty(window, 'location', originalLocation)
    }
    localStorage.clear()
  })

  function setWindowLocation(url: string) {
    const parsedUrl = new URL(url)
    Object.defineProperty(window, 'location', {
      value: {
        href: url,
        search: parsedUrl.search,
        pathname: parsedUrl.pathname,
        origin: parsedUrl.origin,
      },
      writable: true,
      configurable: true,
    })
    // handleCheckoutSuccess uses window.location.search (for URLSearchParams)
    // and window.location.href (for new URL()), plus window.history.replaceState
    window.history.replaceState = vi.fn()
  }

  it('parses URL params correctly (checkout=success, plan=starter)', () => {
    setWindowLocation('https://app.example.com/settings?checkout=success&plan=starter')
    const result = handleCheckoutSuccess()
    expect(result).not.toBeNull()
    expect(result!.plan).toBe('starter')
    expect(result!.sessionId).toBe('payment-link') // default when no session_id param
  })

  it('parses URL params with session_id', () => {
    setWindowLocation('https://app.example.com/settings?checkout=success&plan=pro&session_id=cs_test_abc')
    const result = handleCheckoutSuccess()
    expect(result).not.toBeNull()
    expect(result!.plan).toBe('pro')
    expect(result!.sessionId).toBe('cs_test_abc')
  })

  it('updates localStorage with correct plan', () => {
    setWindowLocation('https://app.example.com/settings?checkout=success&plan=starter')
    handleCheckoutSuccess()
    expect(localStorage.getItem('tracker_user_plan')).toBe('starter')
  })

  it('updates localStorage for boost plan', () => {
    setWindowLocation('https://app.example.com/settings?checkout=success&plan=boost')
    handleCheckoutSuccess()
    expect(localStorage.getItem('tracker_user_plan')).toBe('boost')
  })

  it('cleans up URL params via history.replaceState', () => {
    setWindowLocation('https://app.example.com/settings?checkout=success&plan=pro&session_id=cs_test')
    handleCheckoutSuccess()
    expect(window.history.replaceState).toHaveBeenCalled()
  })

  it('returns null when checkout param is missing', () => {
    setWindowLocation('https://app.example.com/settings?plan=starter')
    const result = handleCheckoutSuccess()
    expect(result).toBeNull()
    expect(localStorage.getItem('tracker_user_plan')).toBeNull()
  })

  it('returns null when checkout param is not "success"', () => {
    setWindowLocation('https://app.example.com/settings?checkout=cancelled&plan=starter')
    const result = handleCheckoutSuccess()
    expect(result).toBeNull()
  })

  it('returns null when plan param is missing', () => {
    setWindowLocation('https://app.example.com/settings?checkout=success')
    const result = handleCheckoutSuccess()
    expect(result).toBeNull()
  })

  it('returns null when plan is "free" (not a valid checkout plan)', () => {
    setWindowLocation('https://app.example.com/settings?checkout=success&plan=free')
    const result = handleCheckoutSuccess()
    expect(result).toBeNull()
  })

  it('returns null when plan is an invalid value', () => {
    setWindowLocation('https://app.example.com/settings?checkout=success&plan=enterprise')
    const result = handleCheckoutSuccess()
    expect(result).toBeNull()
  })

  it('does nothing to localStorage when checkout param is missing', () => {
    localStorage.setItem('tracker_user_plan', 'free')
    setWindowLocation('https://app.example.com/settings')
    handleCheckoutSuccess()
    // Should remain unchanged
    expect(localStorage.getItem('tracker_user_plan')).toBe('free')
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  PLATFORM_LIMITS — runsPerDay
// ═══════════════════════════════════════════════════════════════════════

describe('PLATFORM_LIMITS runsPerDay', () => {
  it('trial allows 1 run/day', () => {
    expect(PLATFORM_LIMITS.trial.runsPerDay).toBe(1)
  })

  it('free allows 0 runs/day', () => {
    expect(PLATFORM_LIMITS.free.runsPerDay).toBe(0)
  })

  it('starter allows 1 run/day', () => {
    expect(PLATFORM_LIMITS.starter.runsPerDay).toBe(1)
  })

  it('pro allows 2 runs/day', () => {
    expect(PLATFORM_LIMITS.pro.runsPerDay).toBe(2)
  })

  it('boost allows 3 runs/day', () => {
    expect(PLATFORM_LIMITS.boost.runsPerDay).toBe(3)
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  canRunBot
// ═══════════════════════════════════════════════════════════════════════

describe('canRunBot', () => {
  it('allows first run on starter (0 runs today)', () => {
    const result = canRunBot('starter', 0)
    expect(result.allowed).toBe(true)
    expect(result.limit).toBe(1)
    expect(result.reason).toBeUndefined()
  })

  it('blocks second run on starter (1 run today)', () => {
    const result = canRunBot('starter', 1)
    expect(result.allowed).toBe(false)
    expect(result.limit).toBe(1)
    expect(result.reason).toContain('Daily run limit reached')
  })

  it('allows first two runs on pro', () => {
    expect(canRunBot('pro', 0).allowed).toBe(true)
    expect(canRunBot('pro', 1).allowed).toBe(true)
  })

  it('blocks third run on pro', () => {
    const result = canRunBot('pro', 2)
    expect(result.allowed).toBe(false)
    expect(result.limit).toBe(2)
  })

  it('allows up to 3 runs on boost', () => {
    expect(canRunBot('boost', 0).allowed).toBe(true)
    expect(canRunBot('boost', 1).allowed).toBe(true)
    expect(canRunBot('boost', 2).allowed).toBe(true)
  })

  it('blocks fourth run on boost', () => {
    const result = canRunBot('boost', 3)
    expect(result.allowed).toBe(false)
    expect(result.limit).toBe(3)
  })

  it('always blocks free plan', () => {
    const result = canRunBot('free', 0)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('does not include bot runs')
    expect(result.limit).toBe(0)
  })

  it('allows trial users 1 run/day', () => {
    expect(canRunBot('trial', 0).allowed).toBe(true)
    expect(canRunBot('trial', 1).allowed).toBe(false)
  })
})
