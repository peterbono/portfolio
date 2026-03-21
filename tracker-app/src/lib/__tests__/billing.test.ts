import { describe, it, expect } from 'vitest'
import {
  getPlanLimits,
  getPlanConfig,
  canUseFeature,
  getMinimumPlan,
  getRemainingQuota,
  PLAN_CONFIGS,
} from '../billing'
import type { PlanTier } from '../billing'

// ═══════════════════════════════════════════════════════════════════════
//  getPlanLimits
// ═══════════════════════════════════════════════════════════════════════

describe('getPlanLimits', () => {
  it('returns correct limits for free tier', () => {
    const limits = getPlanLimits('free')
    expect(limits.botAppliesPerMonth).toBe(25)
    expect(limits.coverLettersPerMonth).toBe(10)
    expect(limits.hasGhostDetection).toBe(true)
    expect(limits.hasAICoach).toBe(true)
    expect(limits.aiCoachLevel).toBe('basic')
    expect(limits.hasFeedbackLoop).toBe(false)
    expect(limits.hasFullAnalytics).toBe(false)
    expect(limits.hasPrioritySupport).toBe(false)
    expect(limits.atsAdapters).toEqual(['Greenhouse', 'Lever'])
  })

  it('returns correct limits for starter tier', () => {
    const limits = getPlanLimits('starter')
    expect(limits.botAppliesPerMonth).toBe(50)
    expect(limits.coverLettersPerMonth).toBe(0)
    expect(limits.hasGhostDetection).toBe(false)
    expect(limits.hasFullAnalytics).toBe(true)
    expect(limits.hasFeedbackLoop).toBe(false)
    expect(limits.hasPrioritySupport).toBe(false)
    expect(limits.atsAdapters).toEqual(['Greenhouse', 'Lever'])
  })

  it('returns correct limits for pro tier', () => {
    const limits = getPlanLimits('pro')
    expect(limits.botAppliesPerMonth).toBe(200)
    expect(limits.coverLettersPerMonth).toBe(50)
    expect(limits.hasGhostDetection).toBe(true)
    expect(limits.hasFeedbackLoop).toBe(true)
    expect(limits.hasFullAnalytics).toBe(true)
    expect(limits.aiCoachLevel).toBe('full')
    expect(limits.hasPrioritySupport).toBe(false)
    expect(limits.atsAdapters).toHaveLength(10)
  })

  it('returns correct limits for premium tier', () => {
    const limits = getPlanLimits('premium')
    expect(limits.botAppliesPerMonth).toBe(Infinity)
    expect(limits.coverLettersPerMonth).toBe(Infinity)
    expect(limits.hasGhostDetection).toBe(true)
    expect(limits.hasFeedbackLoop).toBe(true)
    expect(limits.hasFullAnalytics).toBe(true)
    expect(limits.hasPrioritySupport).toBe(true)
    expect(limits.aiCoachLevel).toBe('full')
    expect(limits.atsAdapters).toHaveLength(10)
  })

  it('falls back to free tier for unknown plan', () => {
    const limits = getPlanLimits('nonexistent' as PlanTier)
    expect(limits.botAppliesPerMonth).toBe(25)
  })

  it('all four tiers have hasAICoach = true', () => {
    const tiers: PlanTier[] = ['free', 'starter', 'pro', 'premium']
    for (const tier of tiers) {
      expect(getPlanLimits(tier).hasAICoach).toBe(true)
    }
  })

  it('pro and premium have all 10 ATS adapters', () => {
    expect(getPlanLimits('pro').atsAdapters).toHaveLength(10)
    expect(getPlanLimits('premium').atsAdapters).toHaveLength(10)
  })

  it('free and starter have exactly 2 ATS adapters', () => {
    expect(getPlanLimits('free').atsAdapters).toHaveLength(2)
    expect(getPlanLimits('starter').atsAdapters).toHaveLength(2)
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
    expect(getPlanConfig('premium').name).toBe('Premium')
  })

  it('free tier has price 0', () => {
    const config = getPlanConfig('free')
    expect(config.priceMonthly).toBe(0)
    expect(config.priceAnnual).toBe(0)
  })

  it('annual price is 80% of monthly * 12', () => {
    const starter = getPlanConfig('starter')
    expect(starter.priceAnnual).toBe(Math.round(19 * 12 * 0.8))

    const pro = getPlanConfig('pro')
    expect(pro.priceAnnual).toBe(Math.round(39 * 12 * 0.8))

    const premium = getPlanConfig('premium')
    expect(premium.priceAnnual).toBe(Math.round(79 * 12 * 0.8))
  })

  it('each config has features array', () => {
    const tiers: PlanTier[] = ['free', 'starter', 'pro', 'premium']
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
  // bot-apply: all tiers have > 0 applies
  it('bot-apply is available on all tiers', () => {
    expect(canUseFeature('free', 'bot-apply')).toBe(true)
    expect(canUseFeature('starter', 'bot-apply')).toBe(true)
    expect(canUseFeature('pro', 'bot-apply')).toBe(true)
    expect(canUseFeature('premium', 'bot-apply')).toBe(true)
  })

  // ai-coach: all tiers have it
  it('ai-coach is available on all tiers', () => {
    expect(canUseFeature('free', 'ai-coach')).toBe(true)
    expect(canUseFeature('starter', 'ai-coach')).toBe(true)
    expect(canUseFeature('pro', 'ai-coach')).toBe(true)
    expect(canUseFeature('premium', 'ai-coach')).toBe(true)
  })

  // full-analytics: not free, yes starter+
  it('full-analytics is NOT on free, but IS on starter+', () => {
    expect(canUseFeature('free', 'full-analytics')).toBe(false)
    expect(canUseFeature('starter', 'full-analytics')).toBe(true)
    expect(canUseFeature('pro', 'full-analytics')).toBe(true)
    expect(canUseFeature('premium', 'full-analytics')).toBe(true)
  })

  // feedback-loop: pro and premium only
  it('feedback-loop is only on pro and premium', () => {
    expect(canUseFeature('free', 'feedback-loop')).toBe(false)
    expect(canUseFeature('starter', 'feedback-loop')).toBe(false)
    expect(canUseFeature('pro', 'feedback-loop')).toBe(true)
    expect(canUseFeature('premium', 'feedback-loop')).toBe(true)
  })

  // ghost-detection: free=yes, starter=no, pro=yes, premium=yes
  it('ghost-detection follows the correct tier pattern', () => {
    expect(canUseFeature('free', 'ghost-detection')).toBe(true)
    expect(canUseFeature('starter', 'ghost-detection')).toBe(false)
    expect(canUseFeature('pro', 'ghost-detection')).toBe(true)
    expect(canUseFeature('premium', 'ghost-detection')).toBe(true)
  })

  // cover-letter: free=10 (yes), starter=0 (no), pro=50 (yes), premium=Inf (yes)
  it('cover-letter: free yes, starter no, pro/premium yes', () => {
    expect(canUseFeature('free', 'cover-letter')).toBe(true)
    expect(canUseFeature('starter', 'cover-letter')).toBe(false)
    expect(canUseFeature('pro', 'cover-letter')).toBe(true)
    expect(canUseFeature('premium', 'cover-letter')).toBe(true)
  })

  // priority-support: premium only
  it('priority-support is premium only', () => {
    expect(canUseFeature('free', 'priority-support')).toBe(false)
    expect(canUseFeature('starter', 'priority-support')).toBe(false)
    expect(canUseFeature('pro', 'priority-support')).toBe(false)
    expect(canUseFeature('premium', 'priority-support')).toBe(true)
  })

  it('returns false for unknown feature', () => {
    expect(canUseFeature('premium', 'nonexistent' as any)).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  getMinimumPlan
// ═══════════════════════════════════════════════════════════════════════

describe('getMinimumPlan', () => {
  it('bot-apply minimum is free', () => {
    expect(getMinimumPlan('bot-apply')).toBe('free')
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

  it('cover-letter minimum is free', () => {
    expect(getMinimumPlan('cover-letter')).toBe('free')
  })

  it('priority-support minimum is premium', () => {
    expect(getMinimumPlan('priority-support')).toBe('premium')
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  getRemainingQuota
// ═══════════════════════════════════════════════════════════════════════

describe('getRemainingQuota', () => {
  it('bot-apply: free tier has 25 total, 10 used = 15 remaining', () => {
    expect(getRemainingQuota('free', 10, 'bot-apply')).toBe(15)
  })

  it('bot-apply: free tier, 25 used = 0 remaining', () => {
    expect(getRemainingQuota('free', 25, 'bot-apply')).toBe(0)
  })

  it('bot-apply: free tier, 30 used = 0 remaining (clamped)', () => {
    expect(getRemainingQuota('free', 30, 'bot-apply')).toBe(0)
  })

  it('bot-apply: starter tier has 50 total', () => {
    expect(getRemainingQuota('starter', 20, 'bot-apply')).toBe(30)
  })

  it('bot-apply: pro tier has 200 total', () => {
    expect(getRemainingQuota('pro', 150, 'bot-apply')).toBe(50)
  })

  it('bot-apply: premium tier returns Infinity', () => {
    expect(getRemainingQuota('premium', 9999, 'bot-apply')).toBe(Infinity)
  })

  it('cover-letter: free tier has 10 total', () => {
    expect(getRemainingQuota('free', 5, 'cover-letter')).toBe(5)
  })

  it('cover-letter: starter tier has 0 total = 0 remaining', () => {
    expect(getRemainingQuota('starter', 0, 'cover-letter')).toBe(0)
  })

  it('cover-letter: pro tier has 50 total', () => {
    expect(getRemainingQuota('pro', 10, 'cover-letter')).toBe(40)
  })

  it('cover-letter: premium tier returns Infinity', () => {
    expect(getRemainingQuota('premium', 500, 'cover-letter')).toBe(Infinity)
  })

  it('0 used returns full quota', () => {
    expect(getRemainingQuota('free', 0, 'bot-apply')).toBe(25)
    expect(getRemainingQuota('free', 0, 'cover-letter')).toBe(10)
  })

  it('returns 0 for unknown feature', () => {
    expect(getRemainingQuota('premium', 0, 'nonexistent' as any)).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  PLAN_CONFIGS structure
// ═══════════════════════════════════════════════════════════════════════

describe('PLAN_CONFIGS', () => {
  it('has exactly 4 plans', () => {
    expect(PLAN_CONFIGS).toHaveLength(4)
  })

  it('plans are in order: free, starter, pro, premium', () => {
    expect(PLAN_CONFIGS[0].tier).toBe('free')
    expect(PLAN_CONFIGS[1].tier).toBe('starter')
    expect(PLAN_CONFIGS[2].tier).toBe('pro')
    expect(PLAN_CONFIGS[3].tier).toBe('premium')
  })

  it('each plan config has a non-empty name', () => {
    for (const config of PLAN_CONFIGS) {
      expect(config.name.length).toBeGreaterThan(0)
    }
  })

  it('prices increase from free to premium', () => {
    for (let i = 1; i < PLAN_CONFIGS.length; i++) {
      expect(PLAN_CONFIGS[i].priceMonthly).toBeGreaterThanOrEqual(PLAN_CONFIGS[i - 1].priceMonthly)
    }
  })

  it('each plan has at least 5 features listed', () => {
    for (const config of PLAN_CONFIGS) {
      expect(config.features.length).toBeGreaterThanOrEqual(5)
    }
  })
})
