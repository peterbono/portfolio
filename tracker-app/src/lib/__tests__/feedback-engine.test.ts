import { describe, it, expect } from 'vitest'
import { format, subDays } from 'date-fns'
import {
  generateFeedbackInsights,
  detectGhostCompanies,
  analyzeTimingPatterns,
  analyzeQualityImpact,
  computeBotIQ,
  computeWeeklyReport,
  updateATSArms,
  getATSRecommendations,
} from '../feedback-engine'
import { MOCK_JOBS, makeJob } from '../../test/mock-jobs'
import type { Job } from '../../types/job'
import type { ArmStats } from '../../types/intelligence'

function daysAgo(n: number): string {
  return format(subDays(new Date(), n), 'yyyy-MM-dd')
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
//  generateFeedbackInsights
// ═══════════════════════════════════════════════════════════════════════

describe('generateFeedbackInsights', () => {
  it('returns an array of FeedbackInsight objects', () => {
    const insights = generateFeedbackInsights(MOCK_JOBS)
    expect(Array.isArray(insights)).toBe(true)
    for (const insight of insights) {
      expect(insight).toHaveProperty('id')
      expect(insight).toHaveProperty('type')
      expect(insight).toHaveProperty('title')
      expect(insight).toHaveProperty('description')
      expect(insight).toHaveProperty('confidence')
      expect(insight).toHaveProperty('impact')
      expect(insight).toHaveProperty('createdAt')
    }
  })

  it('returns empty array for empty jobs', () => {
    const insights = generateFeedbackInsights([])
    expect(insights).toEqual([])
  })

  it('includes ghost alert when high-probability ghosts exist', () => {
    // Create jobs that will definitely be ghosts with high probability
    const jobs: Job[] = [
      makeJob({ id: 'g1', date: daysAgo(70), status: 'submitted', company: 'Ghost1', ats: 'ATS1' }),
      makeJob({ id: 'g2', date: daysAgo(80), status: 'submitted', company: 'Ghost2', ats: 'ATS1' }),
    ]
    const insights = generateFeedbackInsights(jobs)
    const ghostAlert = insights.find((i) => i.type === 'ghost_alert')
    expect(ghostAlert).toBeDefined()
    expect(ghostAlert!.id).toBe('ghost-alert')
  })

  it('insight types are valid', () => {
    const insights = generateFeedbackInsights(MOCK_JOBS)
    const validTypes = ['ats_recommendation', 'timing_insight', 'quality_tip', 'ghost_alert', 'ab_result']
    for (const insight of insights) {
      expect(validTypes).toContain(insight.type)
    }
  })

  it('confidence values are valid', () => {
    const insights = generateFeedbackInsights(MOCK_JOBS)
    const validConfidence = ['high', 'medium', 'low']
    for (const insight of insights) {
      expect(validConfidence).toContain(insight.confidence)
    }
  })

  it('impact values are valid', () => {
    const insights = generateFeedbackInsights(MOCK_JOBS)
    const validImpact = ['high', 'medium', 'low']
    for (const insight of insights) {
      expect(validImpact).toContain(insight.impact)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  detectGhostCompanies
// ═══════════════════════════════════════════════════════════════════════

describe('detectGhostCompanies', () => {
  it('returns GhostCompany objects', () => {
    const ghostCompanies = detectGhostCompanies(MOCK_JOBS)
    for (const gc of ghostCompanies) {
      expect(gc).toHaveProperty('company')
      expect(gc).toHaveProperty('ghostRate')
      expect(gc).toHaveProperty('totalApps')
      expect(gc).toHaveProperty('daysSinceApply')
      expect(gc).toHaveProperty('jobId')
    }
  })

  it('aggregates multiple ghost jobs by company', () => {
    const ghostCompanies = detectGhostCompanies(MOCK_JOBS)
    // GhostCorp has 2 ghost applications (job-001 at 30d, job-002 at 50d)
    const ghostCorp = ghostCompanies.find((gc) => gc.company === 'GhostCorp')
    expect(ghostCorp).toBeDefined()
    expect(ghostCorp!.ghostRate).toBe(100) // Both are ghosts
  })

  it('returns empty array for empty input', () => {
    expect(detectGhostCompanies([])).toEqual([])
  })

  it('returns empty array when no ghosts detected', () => {
    const jobs: Job[] = [
      makeJob({ status: 'screening', date: daysAgo(30) }),
      makeJob({ status: 'rejected', date: daysAgo(40) }),
    ]
    expect(detectGhostCompanies(jobs)).toEqual([])
  })

  it('sorts by daysSinceApply descending', () => {
    const ghostCompanies = detectGhostCompanies(MOCK_JOBS)
    for (let i = 1; i < ghostCompanies.length; i++) {
      expect(ghostCompanies[i - 1].daysSinceApply).toBeGreaterThanOrEqual(ghostCompanies[i].daysSinceApply)
    }
  })

  it('ghostRate is a percentage (0-100)', () => {
    const ghostCompanies = detectGhostCompanies(MOCK_JOBS)
    for (const gc of ghostCompanies) {
      expect(gc.ghostRate).toBeGreaterThanOrEqual(0)
      expect(gc.ghostRate).toBeLessThanOrEqual(100)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  analyzeTimingPatterns
// ═══════════════════════════════════════════════════════════════════════

describe('analyzeTimingPatterns', () => {
  it('returns bestDay, bestTime, and data fields', () => {
    const timing = analyzeTimingPatterns(MOCK_JOBS)
    expect(timing).toHaveProperty('bestDay')
    expect(timing).toHaveProperty('bestTime')
    expect(timing).toHaveProperty('data')
    expect(Array.isArray(timing.data)).toBe(true)
  })

  it('data entries have day, count, responses, and rate fields', () => {
    const timing = analyzeTimingPatterns(MOCK_JOBS)
    for (const entry of timing.data) {
      expect(entry).toHaveProperty('day')
      expect(entry).toHaveProperty('count')
      expect(entry).toHaveProperty('responses')
      expect(entry).toHaveProperty('rate')
    }
  })

  it('day names are valid', () => {
    const validDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const timing = analyzeTimingPatterns(MOCK_JOBS)
    for (const entry of timing.data) {
      expect(validDays).toContain(entry.day)
    }
  })

  it('bestDay is a valid day name or N/A', () => {
    const validDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'N/A']
    const timing = analyzeTimingPatterns(MOCK_JOBS)
    expect(validDays).toContain(timing.bestDay)
  })

  it('bestTime matches HH:00 format or N/A', () => {
    const timing = analyzeTimingPatterns(MOCK_JOBS)
    expect(timing.bestTime).toMatch(/^(\d{2}:00|N\/A)$/)
  })

  it('returns N/A values for empty input', () => {
    const timing = analyzeTimingPatterns([])
    expect(timing.data).toHaveLength(0)
  })

  it('excludes non-submitted statuses (manual, saved, skipped)', () => {
    const jobs: Job[] = [
      makeJob({ status: 'manual', date: daysAgo(5) }),
      makeJob({ status: 'saved', date: daysAgo(3) }),
      makeJob({ status: 'skipped', date: daysAgo(1) }),
    ]
    const timing = analyzeTimingPatterns(jobs)
    expect(timing.data).toHaveLength(0)
  })

  it('rate is a percentage (0-100 scale)', () => {
    const timing = analyzeTimingPatterns(MOCK_JOBS)
    for (const entry of timing.data) {
      expect(entry.rate).toBeGreaterThanOrEqual(0)
      expect(entry.rate).toBeLessThanOrEqual(100)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  analyzeQualityImpact
// ═══════════════════════════════════════════════════════════════════════

describe('analyzeQualityImpact', () => {
  it('returns QualityFactor objects for each factor', () => {
    const factors = analyzeQualityImpact(MOCK_JOBS)
    expect(factors.length).toBeGreaterThan(0)
    for (const factor of factors) {
      expect(factor).toHaveProperty('factor')
      expect(factor).toHaveProperty('label')
      expect(factor).toHaveProperty('withFactor')
      expect(factor).toHaveProperty('withoutFactor')
      expect(factor).toHaveProperty('multiplier')
    }
  })

  it('includes cv, portfolio, cover_letter, and salary factors', () => {
    const factors = analyzeQualityImpact(MOCK_JOBS)
    const factorNames = factors.map((f) => f.factor)
    expect(factorNames).toContain('cv')
    expect(factorNames).toContain('portfolio')
    expect(factorNames).toContain('cover_letter')
    expect(factorNames).toContain('salary')
  })

  it('returns empty array for empty input', () => {
    expect(analyzeQualityImpact([])).toEqual([])
  })

  it('returns empty array when all jobs are non-submitted statuses', () => {
    const jobs = [
      makeJob({ status: 'manual' }),
      makeJob({ status: 'saved' }),
      makeJob({ status: 'skipped' }),
    ]
    expect(analyzeQualityImpact(jobs)).toEqual([])
  })

  it('sorts by multiplier descending', () => {
    const factors = analyzeQualityImpact(MOCK_JOBS)
    for (let i = 1; i < factors.length; i++) {
      expect(factors[i - 1].multiplier).toBeGreaterThanOrEqual(factors[i].multiplier)
    }
  })

  it('rates are non-negative', () => {
    const factors = analyzeQualityImpact(MOCK_JOBS)
    for (const factor of factors) {
      expect(factor.withFactor).toBeGreaterThanOrEqual(0)
      expect(factor.withoutFactor).toBeGreaterThanOrEqual(0)
    }
  })

  it('multiplier is 0 when withoutFactor rate is 0', () => {
    // All jobs have CV, none without -> withoutRate = 0 -> multiplier = 0
    const jobs: Job[] = [
      makeJob({ status: 'submitted', cv: 'file.pdf' }),
      makeJob({ status: 'submitted', cv: 'file.pdf' }),
    ]
    const factors = analyzeQualityImpact(jobs)
    const cvFactor = factors.find((f) => f.factor === 'cv')
    // If all have cv, withoutFactor = 0, multiplier = 0
    expect(cvFactor).toBeDefined()
    expect(cvFactor!.multiplier).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  computeBotIQ
// ═══════════════════════════════════════════════════════════════════════

describe('computeBotIQ', () => {
  it('returns a number between 0 and 100', () => {
    const arms = [
      makeArm({ sampleSize: 50 }),
      makeArm({ sampleSize: 30 }),
    ]
    const score = computeBotIQ(MOCK_JOBS, arms)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('returns 0 for empty jobs and empty arms', () => {
    expect(computeBotIQ([], [])).toBe(0)
  })

  it('higher sample sizes increase score (Factor 1)', () => {
    const lowArms = [makeArm({ sampleSize: 5 })]
    const highArms = [makeArm({ sampleSize: 200 })]

    const lowScore = computeBotIQ([], lowArms)
    const highScore = computeBotIQ([], highArms)
    expect(highScore).toBeGreaterThan(lowScore)
  })

  it('more diverse ATS arms increase score (Factor 2)', () => {
    const fewArms = [makeArm({ id: 'a', sampleSize: 0 })]
    const manyArms = Array.from({ length: 8 }, (_, i) =>
      makeArm({ id: `arm-${i}`, sampleSize: 0 }),
    )

    const fewScore = computeBotIQ([], fewArms)
    const manyScore = computeBotIQ([], manyArms)
    expect(manyScore).toBeGreaterThan(fewScore)
  })

  it('more resolved outcomes increase score (Factor 3)', () => {
    const unresolvedJobs: Job[] = Array.from({ length: 10 }, () =>
      makeJob({ status: 'submitted' }),
    )
    const resolvedJobs: Job[] = Array.from({ length: 10 }, () =>
      makeJob({ status: 'rejected' }),
    )

    const unresolvedScore = computeBotIQ(unresolvedJobs, [])
    const resolvedScore = computeBotIQ(resolvedJobs, [])
    expect(resolvedScore).toBeGreaterThan(unresolvedScore)
  })

  it('recent applications increase score (Factor 4)', () => {
    const oldJobs: Job[] = Array.from({ length: 5 }, () =>
      makeJob({ status: 'submitted', date: daysAgo(30) }),
    )
    const recentJobs: Job[] = Array.from({ length: 5 }, () =>
      makeJob({ status: 'submitted', date: daysAgo(2) }),
    )

    const oldScore = computeBotIQ(oldJobs, [])
    const recentScore = computeBotIQ(recentJobs, [])
    expect(recentScore).toBeGreaterThan(oldScore)
  })

  it('jobs with events increase score (Factor 5)', () => {
    const noEventJobs: Job[] = Array.from({ length: 10 }, () =>
      makeJob({ status: 'submitted', events: [] }),
    )
    const withEventJobs: Job[] = Array.from({ length: 10 }, () =>
      makeJob({
        status: 'submitted',
        events: [
          {
            id: 'e1',
            date: daysAgo(1),
            type: 'email',
            person: 'HR',
            notes: 'Follow up',
            outcome: 'aligned',
            createdAt: daysAgo(1),
          },
        ],
      }),
    )

    const noEventScore = computeBotIQ(noEventJobs, [])
    const withEventScore = computeBotIQ(withEventJobs, [])
    expect(withEventScore).toBeGreaterThan(noEventScore)
  })

  it('caps at 100 even with extreme data', () => {
    const manyArms = Array.from({ length: 20 }, (_, i) =>
      makeArm({ id: `arm-${i}`, sampleSize: 500 }),
    )
    const manyJobs: Job[] = Array.from({ length: 50 }, () =>
      makeJob({
        status: 'rejected',
        date: daysAgo(1),
        events: [
          {
            id: 'e',
            date: daysAgo(1),
            type: 'email',
            person: 'HR',
            notes: '',
            outcome: 'aligned',
            createdAt: daysAgo(1),
          },
        ],
      }),
    )
    expect(computeBotIQ(manyJobs, manyArms)).toBeLessThanOrEqual(100)
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  computeWeeklyReport
// ═══════════════════════════════════════════════════════════════════════

describe('computeWeeklyReport', () => {
  it('returns all required fields', () => {
    const report = computeWeeklyReport(MOCK_JOBS)
    expect(report).toHaveProperty('sent')
    expect(report).toHaveProperty('responses')
    expect(report).toHaveProperty('interviews')
    expect(report).toHaveProperty('sentDelta')
    expect(report).toHaveProperty('responsesDelta')
    expect(report).toHaveProperty('interviewsDelta')
  })

  it('all counts are non-negative', () => {
    const report = computeWeeklyReport(MOCK_JOBS)
    expect(report.sent).toBeGreaterThanOrEqual(0)
    expect(report.responses).toBeGreaterThanOrEqual(0)
    expect(report.interviews).toBeGreaterThanOrEqual(0)
  })

  it('returns zeros for empty input', () => {
    const report = computeWeeklyReport([])
    expect(report.sent).toBe(0)
    expect(report.responses).toBe(0)
    expect(report.interviews).toBe(0)
    expect(report.sentDelta).toBe(0)
    expect(report.responsesDelta).toBe(0)
    expect(report.interviewsDelta).toBe(0)
  })

  it('deltas can be negative (fewer this week vs last)', () => {
    // 5 jobs last week, 0 this week
    const jobs: Job[] = Array.from({ length: 5 }, () =>
      makeJob({ status: 'submitted', date: daysAgo(10) }),
    )
    const report = computeWeeklyReport(jobs)
    expect(report.sentDelta).toBeLessThanOrEqual(0)
  })

  it('counts interviews correctly (interviewing, challenge, offer, negotiation)', () => {
    const jobs: Job[] = [
      makeJob({ status: 'interviewing', date: daysAgo(3) }),
      makeJob({ status: 'challenge', date: daysAgo(2) }),
      makeJob({ status: 'offer', date: daysAgo(1) }),
      makeJob({ status: 'negotiation', date: daysAgo(1) }),
      makeJob({ status: 'submitted', date: daysAgo(2) }),
    ]
    const report = computeWeeklyReport(jobs)
    expect(report.interviews).toBe(4) // all except submitted
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  updateATSArms
// ═══════════════════════════════════════════════════════════════════════

describe('updateATSArms', () => {
  it('returns ArmStats array', () => {
    const arms = updateATSArms(MOCK_JOBS)
    expect(Array.isArray(arms)).toBe(true)
    for (const arm of arms) {
      expect(arm).toHaveProperty('id')
      expect(arm).toHaveProperty('label')
      expect(arm).toHaveProperty('dist')
      expect(arm).toHaveProperty('sampleSize')
    }
  })

  it('returns empty array for empty input', () => {
    expect(updateATSArms([])).toEqual([])
  })

  it('returns empty array when no submitted jobs have ATS', () => {
    const jobs = [makeJob({ status: 'manual', ats: 'Greenhouse' })]
    expect(updateATSArms(jobs)).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  getATSRecommendations
// ═══════════════════════════════════════════════════════════════════════

describe('getATSRecommendations', () => {
  it('returns ATSRecommendation array', () => {
    const arms = [
      makeArm({ id: 'greenhouse', label: 'Greenhouse', dist: { alpha: 10, beta: 5 } }),
      makeArm({ id: 'lever', label: 'Lever', dist: { alpha: 3, beta: 10 } }),
    ]
    const recs = getATSRecommendations(arms)
    expect(recs).toHaveLength(2)
    for (const rec of recs) {
      expect(rec).toHaveProperty('ats')
      expect(rec).toHaveProperty('score')
      expect(rec).toHaveProperty('confidence')
    }
  })

  it('returns empty array for empty arms', () => {
    expect(getATSRecommendations([])).toEqual([])
  })

  it('sorts by expected value (best first)', () => {
    const arms = [
      makeArm({ id: 'low', label: 'Low', dist: { alpha: 2, beta: 8 } }),
      makeArm({ id: 'high', label: 'High', dist: { alpha: 8, beta: 2 } }),
    ]
    const recs = getATSRecommendations(arms)
    expect(recs[0].ats).toBe('High')
    expect(recs[1].ats).toBe('Low')
  })

  it('score is a reasonable percentage', () => {
    const arms = [makeArm({ dist: { alpha: 6, beta: 4 }, sampleSize: 10 })]
    const recs = getATSRecommendations(arms)
    // Expected value = 6/10 = 0.6 -> score = 60.0
    expect(recs[0].score).toBeCloseTo(60.0, 0)
  })

  it('confidence reflects sample size', () => {
    const lowConfArms = [makeArm({ sampleSize: 5 })]
    const highConfArms = [makeArm({ sampleSize: 200 })]

    expect(getATSRecommendations(lowConfArms)[0].confidence).toBe('low')
    expect(getATSRecommendations(highConfArms)[0].confidence).toBe('high')
  })
})
