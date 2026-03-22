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
    expect(limits.botAppliesPerMonth).toBe(100)
    expect(limits.coverLettersPerMonth).toBe(20)
    expect(limits.hasGhostDetection).toBe(true)
    expect(limits.hasFullAnalytics).toBe(true)
    expect(limits.hasFeedbackLoop).toBe(false)
    expect(limits.hasPrioritySupport).toBe(false)
    expect(limits.atsAdapters).toHaveLength(4)
  })

  it('returns correct limits for pro tier', () => {
    const limits = getPlanLimits('pro')
    expect(limits.botAppliesPerMonth).toBe(Infinity)
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
    expect(limits.botAppliesPerMonth).toBe(Infinity)
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
    expect(limits.botAppliesPerMonth).toBe(25)
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

  it('free has 2 ATS adapters, starter has 4', () => {
    expect(getPlanLimits('free').atsAdapters).toHaveLength(2)
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
  // bot-apply: all tiers have > 0 applies
  it('bot-apply is available on all tiers', () => {
    expect(canUseFeature('free', 'bot-apply')).toBe(true)
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

  // cover-letter: all tiers now have > 0
  it('cover-letter is available on all tiers', () => {
    expect(canUseFeature('free', 'cover-letter')).toBe(true)
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

  it('priority-support minimum is boost', () => {
    expect(getMinimumPlan('priority-support')).toBe('boost')
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

  it('bot-apply: starter tier has 100 total', () => {
    expect(getRemainingQuota('starter', 20, 'bot-apply')).toBe(80)
  })

  it('bot-apply: pro tier returns Infinity', () => {
    expect(getRemainingQuota('pro', 150, 'bot-apply')).toBe(Infinity)
  })

  it('bot-apply: boost tier returns Infinity', () => {
    expect(getRemainingQuota('boost', 9999, 'bot-apply')).toBe(Infinity)
  })

  it('cover-letter: free tier has 10 total', () => {
    expect(getRemainingQuota('free', 5, 'cover-letter')).toBe(5)
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
    expect(getRemainingQuota('free', 0, 'bot-apply')).toBe(25)
    expect(getRemainingQuota('free', 0, 'cover-letter')).toBe(10)
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
