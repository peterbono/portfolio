import { describe, it, expect } from 'vitest'
import { format, subDays } from 'date-fns'
import {
  detectGhosts,
  computeATSStats,
  computeQualityScore,
  computeIntelligenceSummary,
} from '../intelligence'
import { MOCK_JOBS, makeJob } from '../../test/mock-jobs'
import type { Job } from '../../types/job'

function daysAgo(n: number): string {
  return format(subDays(new Date(), n), 'yyyy-MM-dd')
}

// ═══════════════════════════════════════════════════════════════════════
//  detectGhosts
// ═══════════════════════════════════════════════════════════════════════

describe('detectGhosts', () => {
  it('detects submitted jobs older than 21 days with no events', () => {
    const ghosts = detectGhosts(MOCK_JOBS)
    const ghostIds = ghosts.map((g) => g.jobId)

    // job-001 (30 days), job-002 (50 days), job-013 (65 days), job-015 (22 days), job-020 (21 days)
    expect(ghostIds).toContain('job-001')
    expect(ghostIds).toContain('job-002')
    expect(ghostIds).toContain('job-013')
    expect(ghostIds).toContain('job-015')
    expect(ghostIds).toContain('job-020')
  })

  it('does NOT detect jobs younger than 21 days', () => {
    const ghosts = detectGhosts(MOCK_JOBS)
    const ghostIds = ghosts.map((g) => g.jobId)

    // job-003 is only 10 days old
    expect(ghostIds).not.toContain('job-003')
    // job-018 is only 8 days old
    expect(ghostIds).not.toContain('job-018')
    // job-019 is only 2 days old
    expect(ghostIds).not.toContain('job-019')
  })

  it('does NOT detect jobs with events even if old', () => {
    const ghosts = detectGhosts(MOCK_JOBS)
    const ghostIds = ghosts.map((g) => g.jobId)

    // job-004 is 25 days old but has events
    expect(ghostIds).not.toContain('job-004')
  })

  it('does NOT detect non-submitted statuses (screening, rejected, etc.)', () => {
    const ghosts = detectGhosts(MOCK_JOBS)
    const ghostIds = ghosts.map((g) => g.jobId)

    // job-005 screening, job-007 rejected, job-008 offer, job-012 ghosted
    expect(ghostIds).not.toContain('job-005')
    expect(ghostIds).not.toContain('job-007')
    expect(ghostIds).not.toContain('job-008')
    expect(ghostIds).not.toContain('job-012')
  })

  it('does NOT detect recently submitted or expired statuses', () => {
    const ghosts = detectGhosts(MOCK_JOBS)
    const ghostIds = ghosts.map((g) => g.jobId)

    // job-009 (submitted, 5 days ago) and job-010 (submitted, 3 days ago) are too recent
    expect(ghostIds).not.toContain('job-009')
    expect(ghostIds).not.toContain('job-010')
    // job-011 (expired) is not a ghost candidate
    expect(ghostIds).not.toContain('job-011')
  })

  it('returns empty array for empty input', () => {
    expect(detectGhosts([])).toEqual([])
  })

  it('ghostProbability is 0.5 at exactly 21 days', () => {
    const job = makeJob({ date: daysAgo(21), status: 'submitted', events: undefined })
    const ghosts = detectGhosts([job])
    expect(ghosts).toHaveLength(1)
    expect(ghosts[0].ghostProbability).toBe(0.5)
  })

  it('ghostProbability caps at 1.0 for very old applications (60+ days)', () => {
    const job = makeJob({ date: daysAgo(90), status: 'submitted', events: undefined })
    const ghosts = detectGhosts([job])
    expect(ghosts).toHaveLength(1)
    expect(ghosts[0].ghostProbability).toBe(1.0)
  })

  it('ghostProbability ramps linearly between 21 and 60 days', () => {
    const job40 = makeJob({ id: 'g40', date: daysAgo(40), status: 'submitted', events: undefined })
    const ghosts = detectGhosts([job40])
    expect(ghosts).toHaveLength(1)
    // At 40 days: 0.5 + ((40 - 21) / (60 - 21)) * 0.5 = 0.5 + (19/39)*0.5 ≈ 0.74
    const expected = 0.5 + ((40 - 21) / (60 - 21)) * 0.5
    expect(ghosts[0].ghostProbability).toBeCloseTo(Math.round(expected * 100) / 100, 2)
  })

  it('sorts results by ghostProbability descending', () => {
    const ghosts = detectGhosts(MOCK_JOBS)
    for (let i = 1; i < ghosts.length; i++) {
      expect(ghosts[i - 1].ghostProbability).toBeGreaterThanOrEqual(ghosts[i].ghostProbability)
    }
  })

  it('does not detect jobs with no date', () => {
    const job = makeJob({ date: '', status: 'submitted', events: undefined })
    const ghosts = detectGhosts([job])
    expect(ghosts).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  computeATSStats
// ═══════════════════════════════════════════════════════════════════════

describe('computeATSStats', () => {
  it('computes stats grouped by ATS (case-insensitive)', () => {
    const stats = computeATSStats(MOCK_JOBS)
    const atsNames = stats.map((s) => s.ats)

    expect(atsNames).toContain('greenhouse')
    expect(atsNames).toContain('lever')
    expect(atsNames).toContain('workable')
  })

  it('includes all jobs with ATS regardless of status', () => {
    const stats = computeATSStats(MOCK_JOBS)
    // Teamtailor has job-009 (submitted) so it should appear
    const teamtailor = stats.find((s) => s.ats === 'teamtailor')
    expect(teamtailor).toBeDefined()
    expect(teamtailor!.totalApplied).toBe(1)
  })

  it('sorts by responseRate descending', () => {
    const stats = computeATSStats(MOCK_JOBS)
    for (let i = 1; i < stats.length; i++) {
      expect(stats[i - 1].responseRate).toBeGreaterThanOrEqual(stats[i].responseRate)
    }
  })

  it('returns empty array for empty input', () => {
    expect(computeATSStats([])).toEqual([])
  })

  it('returns empty array when all jobs have empty ATS', () => {
    const jobs = [
      makeJob({ status: 'submitted', ats: '' }),
      makeJob({ status: 'rejected', ats: '' }),
      makeJob({ status: 'rejected', ats: '' }),
    ]
    expect(computeATSStats(jobs)).toEqual([])
  })

  it('correctly counts responses for screening/interviewing/rejected statuses', () => {
    const jobs: Job[] = [
      makeJob({ status: 'submitted', ats: 'TestATS' }),
      makeJob({ status: 'interviewing', ats: 'TestATS' }),
      makeJob({ status: 'rejected', ats: 'TestATS' }),
      makeJob({ status: 'submitted', ats: 'TestATS' }),
    ]
    const stats = computeATSStats(jobs)
    const testAts = stats.find((s) => s.ats === 'testate')

    // Should find "testate" (lowercased "TestATS" -> "testate")
    // Actually "TestATS".trim().toLowerCase() = "testate"
    // Wait: "TestATS" lowercased is "testate"? No: "TestATS" -> "testats"
    const found = stats.find((s) => s.ats === 'testats')
    expect(found).toBeDefined()
    expect(found!.totalApplied).toBe(4)
    expect(found!.gotResponse).toBe(2) // screening + rejected
    expect(found!.responseRate).toBe(0.5)
  })

  it('handles jobs with empty ATS string gracefully', () => {
    const jobs = [makeJob({ status: 'submitted', ats: '' })]
    const stats = computeATSStats(jobs)
    // Empty ATS key should be skipped
    expect(stats).toHaveLength(0)
  })

  it('computes ghost rate for old submitted jobs without events', () => {
    const jobs: Job[] = [
      makeJob({ status: 'submitted', ats: 'GhostATS', date: daysAgo(30), events: undefined }),
      makeJob({ status: 'submitted', ats: 'GhostATS', date: daysAgo(5), events: [] }),
      makeJob({ status: 'interviewing', ats: 'GhostATS', date: daysAgo(15) }),
    ]
    const stats = computeATSStats(jobs)
    const ghostAts = stats.find((s) => s.ats === 'ghostats')
    expect(ghostAts).toBeDefined()
    // 1 ghost out of 3 total applied
    expect(ghostAts!.ghostRate).toBeCloseTo(0.333, 2)
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  computeQualityScore
// ═══════════════════════════════════════════════════════════════════════

describe('computeQualityScore', () => {
  it('returns maximum score (100) for fully filled job', () => {
    const job = makeJob({
      cv: 'cvflo.pdf',
      portfolio: 'https://floriangouloubi.com',
      notes: 'Applied with cover letter and details',
      salary: '100k',
      link: 'https://example.com/job',
    })
    expect(computeQualityScore(job)).toBe(100)
  })

  it('returns 0 for completely empty job', () => {
    const job = makeJob({
      cv: '',
      portfolio: '',
      notes: '',
      salary: '',
      link: '',
    })
    expect(computeQualityScore(job)).toBe(0)
  })

  it('awards 30 points for CV uploaded', () => {
    const job = makeJob({ cv: 'myfile.pdf' })
    expect(computeQualityScore(job)).toBe(30)
  })

  it('does NOT award CV points when cv is "no"', () => {
    const job = makeJob({ cv: 'no' })
    expect(computeQualityScore(job)).toBe(0)
  })

  it('awards 25 points for portfolio included', () => {
    const job = makeJob({ portfolio: 'https://portfolio.com' })
    expect(computeQualityScore(job)).toBe(25)
  })

  it('does NOT award portfolio points when portfolio is "no"', () => {
    const job = makeJob({ portfolio: 'No' })
    expect(computeQualityScore(job)).toBe(0)
  })

  it('awards 15 points for cover letter mentioned in notes', () => {
    const job = makeJob({ notes: 'Sent cover letter with application' })
    // 15 (cover letter) + 10 (notes filled) = 25
    expect(computeQualityScore(job)).toBe(25)
  })

  it('detects French "lettre de motivation" keyword', () => {
    const job = makeJob({ notes: 'Lettre de motivation envoyée' })
    // 15 (motivation keyword) + 10 (notes filled) = 25
    expect(computeQualityScore(job)).toBe(25)
  })

  it('awards 10 points for salary filled', () => {
    const job = makeJob({ salary: '80k' })
    expect(computeQualityScore(job)).toBe(10)
  })

  it('awards 10 points for link present', () => {
    const job = makeJob({ link: 'https://example.com/job' })
    expect(computeQualityScore(job)).toBe(10)
  })

  it('awards 10 points for notes filled (without cover letter keyword)', () => {
    const job = makeJob({ notes: 'Great opportunity' })
    expect(computeQualityScore(job)).toBe(10)
  })

  it('handles whitespace-only fields as empty', () => {
    const job = makeJob({ cv: '   ', portfolio: '  ', salary: ' ', link: ' ', notes: '  ' })
    expect(computeQualityScore(job)).toBe(0)
  })

  it('correctly scores MOCK_JOBS job-001 (all fields filled + cover letter)', () => {
    const score = computeQualityScore(MOCK_JOBS[0])
    // cv=30, portfolio=25, notes has "cover letter motivation"=15, salary=10, link=10, notes=10 = 100
    expect(score).toBe(100)
  })

  it('correctly scores MOCK_JOBS job-018 (minimal data)', () => {
    const score = computeQualityScore(MOCK_JOBS.find((j) => j.id === 'job-018')!)
    expect(score).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  computeIntelligenceSummary
// ═══════════════════════════════════════════════════════════════════════

describe('computeIntelligenceSummary', () => {
  it('returns a complete summary with all fields', () => {
    const summary = computeIntelligenceSummary(MOCK_JOBS)

    expect(summary).toHaveProperty('totalGhosts')
    expect(summary).toHaveProperty('ghostRate')
    expect(summary).toHaveProperty('bestATS')
    expect(summary).toHaveProperty('worstATS')
    expect(summary).toHaveProperty('avgQualityScore')
    expect(summary).toHaveProperty('responseRateByArea')
    expect(summary).toHaveProperty('responseRateBySource')
    expect(summary).toHaveProperty('weeklyTrend')
    expect(summary).toHaveProperty('topInsights')
  })

  it('totalGhosts matches detectGhosts count', () => {
    const summary = computeIntelligenceSummary(MOCK_JOBS)
    const ghosts = detectGhosts(MOCK_JOBS)
    expect(summary.totalGhosts).toBe(ghosts.length)
  })

  it('ghostRate is between 0 and 1', () => {
    const summary = computeIntelligenceSummary(MOCK_JOBS)
    expect(summary.ghostRate).toBeGreaterThanOrEqual(0)
    expect(summary.ghostRate).toBeLessThanOrEqual(1)
  })

  it('avgQualityScore is between 0 and 100', () => {
    const summary = computeIntelligenceSummary(MOCK_JOBS)
    expect(summary.avgQualityScore).toBeGreaterThanOrEqual(0)
    expect(summary.avgQualityScore).toBeLessThanOrEqual(100)
  })

  it('weeklyTrend has 12 entries', () => {
    const summary = computeIntelligenceSummary(MOCK_JOBS)
    expect(summary.weeklyTrend).toHaveLength(12)
  })

  it('topInsights is an array of strings', () => {
    const summary = computeIntelligenceSummary(MOCK_JOBS)
    expect(Array.isArray(summary.topInsights)).toBe(true)
    for (const insight of summary.topInsights) {
      expect(typeof insight).toBe('string')
    }
  })

  it('handles empty job array gracefully', () => {
    const summary = computeIntelligenceSummary([])
    expect(summary.totalGhosts).toBe(0)
    expect(summary.ghostRate).toBe(0)
    expect(summary.bestATS).toBeNull()
    expect(summary.worstATS).toBeNull()
    expect(summary.avgQualityScore).toBe(0)
    expect(summary.weeklyTrend).toHaveLength(12)
  })

  it('responseRateByArea includes expected area keys', () => {
    const summary = computeIntelligenceSummary(MOCK_JOBS)
    // MOCK_JOBS have apac, emea, and some with empty area
    expect(summary.responseRateByArea).toHaveProperty('apac')
  })

  it('bestATS and worstATS are null when no ATS has 5+ applications', () => {
    const fewJobs = [
      makeJob({ status: 'submitted', ats: 'ATS1' }),
      makeJob({ status: 'submitted', ats: 'ATS2' }),
    ]
    const summary = computeIntelligenceSummary(fewJobs)
    expect(summary.bestATS).toBeNull()
    expect(summary.worstATS).toBeNull()
  })
})
