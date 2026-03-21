import { describe, it, expect } from 'vitest'
import {
  initializeArms,
  thompsonSample,
  updateArm,
  getConfidence,
  getExpectedValue,
  rankArms,
} from '../thompson-sampling'
import type { ATSStats, ArmStats } from '../../types/intelligence'

// ═══════════════════════════════════════════════════════════════════════
//  Helper: create ATSStats fixtures
// ═══════════════════════════════════════════════════════════════════════

function makeATSStats(overrides: Partial<ATSStats> = {}): ATSStats {
  return {
    ats: 'TestATS',
    totalApplied: 10,
    gotResponse: 3,
    responseRate: 0.3,
    avgDaysToResponse: 7,
    ghostRate: 0.1,
    ...overrides,
  }
}

function makeArm(overrides: Partial<ArmStats> = {}): ArmStats {
  return {
    id: 'test-arm',
    label: 'Test ATS',
    dist: { alpha: 5, beta: 5 },
    sampleSize: 10,
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  initializeArms
// ═══════════════════════════════════════════════════════════════════════

describe('initializeArms', () => {
  it('creates one arm per ATS stat entry', () => {
    const stats = [
      makeATSStats({ ats: 'Greenhouse', totalApplied: 20, gotResponse: 8 }),
      makeATSStats({ ats: 'Lever', totalApplied: 15, gotResponse: 5 }),
    ]
    const arms = initializeArms(stats)
    expect(arms).toHaveLength(2)
    expect(arms[0].id).toBe('Greenhouse')
    expect(arms[1].id).toBe('Lever')
  })

  it('sets alpha = successes + 1 (uniform prior)', () => {
    const stats = [makeATSStats({ ats: 'ATS1', totalApplied: 10, gotResponse: 3 })]
    const arms = initializeArms(stats)
    expect(arms[0].dist.alpha).toBe(4) // 3 + 1
  })

  it('sets beta = failures + 1 (uniform prior)', () => {
    const stats = [makeATSStats({ ats: 'ATS1', totalApplied: 10, gotResponse: 3 })]
    const arms = initializeArms(stats)
    expect(arms[0].dist.beta).toBe(8) // (10 - 3) + 1
  })

  it('sets sampleSize to totalApplied', () => {
    const stats = [makeATSStats({ ats: 'ATS1', totalApplied: 42, gotResponse: 10 })]
    const arms = initializeArms(stats)
    expect(arms[0].sampleSize).toBe(42)
  })

  it('returns empty array for empty input', () => {
    expect(initializeArms([])).toEqual([])
  })

  it('handles zero responses correctly', () => {
    const stats = [makeATSStats({ ats: 'NoResponse', totalApplied: 20, gotResponse: 0 })]
    const arms = initializeArms(stats)
    expect(arms[0].dist.alpha).toBe(1)  // 0 + 1
    expect(arms[0].dist.beta).toBe(21)  // 20 + 1
  })

  it('handles all responses correctly', () => {
    const stats = [makeATSStats({ ats: 'AllResponse', totalApplied: 10, gotResponse: 10 })]
    const arms = initializeArms(stats)
    expect(arms[0].dist.alpha).toBe(11) // 10 + 1
    expect(arms[0].dist.beta).toBe(1)   // 0 + 1
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  thompsonSample
// ═══════════════════════════════════════════════════════════════════════

describe('thompsonSample', () => {
  it('throws on empty arms array', () => {
    expect(() => thompsonSample([])).toThrow('Cannot sample from empty arms array')
  })

  it('returns the only arm when given a single arm', () => {
    const arm = makeArm({ id: 'only-one' })
    expect(thompsonSample([arm]).id).toBe('only-one')
  })

  it('over 1000 iterations, arm with much higher success rate wins majority', () => {
    const highArm = makeArm({
      id: 'high',
      dist: { alpha: 50, beta: 5 }, // ~91% success rate
      sampleSize: 55,
    })
    const lowArm = makeArm({
      id: 'low',
      dist: { alpha: 5, beta: 50 }, // ~9% success rate
      sampleSize: 55,
    })

    let highWins = 0
    for (let i = 0; i < 1000; i++) {
      const winner = thompsonSample([highArm, lowArm])
      if (winner.id === 'high') highWins++
    }

    // High arm should win the vast majority of the time
    expect(highWins).toBeGreaterThan(900)
  })

  it('with equal arms, distribution is roughly balanced', () => {
    const arm1 = makeArm({ id: 'arm-1', dist: { alpha: 10, beta: 10 } })
    const arm2 = makeArm({ id: 'arm-2', dist: { alpha: 10, beta: 10 } })

    let arm1Wins = 0
    for (let i = 0; i < 1000; i++) {
      const winner = thompsonSample([arm1, arm2])
      if (winner.id === 'arm-1') arm1Wins++
    }

    // Each arm should win roughly 50% of the time (allow wide margin for randomness)
    expect(arm1Wins).toBeGreaterThan(300)
    expect(arm1Wins).toBeLessThan(700)
  })

  it('returns a valid arm reference from the input array', () => {
    const arms = [
      makeArm({ id: 'a' }),
      makeArm({ id: 'b' }),
      makeArm({ id: 'c' }),
    ]
    const result = thompsonSample(arms)
    expect(arms.some((a) => a.id === result.id)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  updateArm
// ═══════════════════════════════════════════════════════════════════════

describe('updateArm', () => {
  it('increments alpha on success', () => {
    const arm = makeArm({ dist: { alpha: 5, beta: 5 }, sampleSize: 10 })
    const updated = updateArm(arm, true)
    expect(updated.dist.alpha).toBe(6)
    expect(updated.dist.beta).toBe(5)
  })

  it('increments beta on failure', () => {
    const arm = makeArm({ dist: { alpha: 5, beta: 5 }, sampleSize: 10 })
    const updated = updateArm(arm, false)
    expect(updated.dist.alpha).toBe(5)
    expect(updated.dist.beta).toBe(6)
  })

  it('increments sampleSize by 1', () => {
    const arm = makeArm({ sampleSize: 42 })
    expect(updateArm(arm, true).sampleSize).toBe(43)
    expect(updateArm(arm, false).sampleSize).toBe(43)
  })

  it('returns a new object (immutable update)', () => {
    const arm = makeArm()
    const updated = updateArm(arm, true)
    expect(updated).not.toBe(arm)
    expect(updated.dist).not.toBe(arm.dist)
  })

  it('preserves id and label', () => {
    const arm = makeArm({ id: 'preserve-me', label: 'My Label' })
    const updated = updateArm(arm, true)
    expect(updated.id).toBe('preserve-me')
    expect(updated.label).toBe('My Label')
  })

  it('multiple updates accumulate correctly', () => {
    let arm = makeArm({ dist: { alpha: 1, beta: 1 }, sampleSize: 0 })
    arm = updateArm(arm, true)  // alpha=2, beta=1, size=1
    arm = updateArm(arm, true)  // alpha=3, beta=1, size=2
    arm = updateArm(arm, false) // alpha=3, beta=2, size=3
    expect(arm.dist.alpha).toBe(3)
    expect(arm.dist.beta).toBe(2)
    expect(arm.sampleSize).toBe(3)
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  getConfidence
// ═══════════════════════════════════════════════════════════════════════

describe('getConfidence', () => {
  it('returns "high" for sampleSize > 100', () => {
    expect(getConfidence(makeArm({ sampleSize: 101 }))).toBe('high')
    expect(getConfidence(makeArm({ sampleSize: 500 }))).toBe('high')
  })

  it('returns "medium" for sampleSize 30-100', () => {
    expect(getConfidence(makeArm({ sampleSize: 30 }))).toBe('medium')
    expect(getConfidence(makeArm({ sampleSize: 50 }))).toBe('medium')
    expect(getConfidence(makeArm({ sampleSize: 100 }))).toBe('medium')
  })

  it('returns "low" for sampleSize < 30', () => {
    expect(getConfidence(makeArm({ sampleSize: 0 }))).toBe('low')
    expect(getConfidence(makeArm({ sampleSize: 1 }))).toBe('low')
    expect(getConfidence(makeArm({ sampleSize: 29 }))).toBe('low')
  })

  it('boundary: exactly 100 is medium, 101 is high', () => {
    expect(getConfidence(makeArm({ sampleSize: 100 }))).toBe('medium')
    expect(getConfidence(makeArm({ sampleSize: 101 }))).toBe('high')
  })

  it('boundary: exactly 29 is low, 30 is medium', () => {
    expect(getConfidence(makeArm({ sampleSize: 29 }))).toBe('low')
    expect(getConfidence(makeArm({ sampleSize: 30 }))).toBe('medium')
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  getExpectedValue
// ═══════════════════════════════════════════════════════════════════════

describe('getExpectedValue', () => {
  it('returns alpha / (alpha + beta)', () => {
    const arm = makeArm({ dist: { alpha: 6, beta: 4 } })
    expect(getExpectedValue(arm)).toBeCloseTo(0.6, 5)
  })

  it('returns 0.5 for uniform prior (alpha=1, beta=1)', () => {
    const arm = makeArm({ dist: { alpha: 1, beta: 1 } })
    expect(getExpectedValue(arm)).toBeCloseTo(0.5, 5)
  })

  it('returns near 1 for very high alpha', () => {
    const arm = makeArm({ dist: { alpha: 999, beta: 1 } })
    expect(getExpectedValue(arm)).toBeGreaterThan(0.99)
  })

  it('returns near 0 for very high beta', () => {
    const arm = makeArm({ dist: { alpha: 1, beta: 999 } })
    expect(getExpectedValue(arm)).toBeLessThan(0.01)
  })

  it('returns 0.5 when both alpha and beta are 0', () => {
    const arm = makeArm({ dist: { alpha: 0, beta: 0 } })
    expect(getExpectedValue(arm)).toBe(0.5)
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  rankArms
// ═══════════════════════════════════════════════════════════════════════

describe('rankArms', () => {
  it('sorts arms by expected value descending', () => {
    const arms = [
      makeArm({ id: 'low', dist: { alpha: 2, beta: 8 } }),    // EV = 0.2
      makeArm({ id: 'high', dist: { alpha: 8, beta: 2 } }),   // EV = 0.8
      makeArm({ id: 'mid', dist: { alpha: 5, beta: 5 } }),    // EV = 0.5
    ]
    const ranked = rankArms(arms)
    expect(ranked[0].id).toBe('high')
    expect(ranked[1].id).toBe('mid')
    expect(ranked[2].id).toBe('low')
  })

  it('does not mutate the original array', () => {
    const arms = [
      makeArm({ id: 'b', dist: { alpha: 2, beta: 8 } }),
      makeArm({ id: 'a', dist: { alpha: 8, beta: 2 } }),
    ]
    const originalOrder = arms.map((a) => a.id)
    rankArms(arms)
    expect(arms.map((a) => a.id)).toEqual(originalOrder)
  })

  it('returns empty array for empty input', () => {
    expect(rankArms([])).toEqual([])
  })

  it('handles single arm', () => {
    const arms = [makeArm({ id: 'solo' })]
    expect(rankArms(arms)).toHaveLength(1)
    expect(rankArms(arms)[0].id).toBe('solo')
  })
})
