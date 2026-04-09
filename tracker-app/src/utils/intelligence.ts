import { differenceInDays, parseISO, startOfWeek, format } from 'date-fns'
import type { Job } from '../types/job'
import type { GhostResult, ATSStats, IntelligenceSummary, WeeklyTrendPoint } from '../types/intelligence'

// Statuses that indicate the company responded in some way
const RESPONSE_STATUSES = new Set([
  'interviewing', 'challenge', 'offer', 'rejected',
])

// Statuses where ghost detection is relevant (still waiting)
const GHOST_CANDIDATE_STATUSES = new Set(['submitted'])

const GHOST_THRESHOLD_DAYS = 21

/**
 * Detect applications likely ghosted: submitted >21 days ago, no events, status still "submitted".
 * Ghost probability ramps linearly from 0.5 at 21 days to 1.0 at 60+ days.
 */
export function detectGhosts(jobs: Job[]): GhostResult[] {
  const now = new Date()
  const results: GhostResult[] = []

  for (const job of jobs) {
    if (!GHOST_CANDIDATE_STATUSES.has(job.status)) continue
    if (!job.date) continue

    const hasEvents = job.events && job.events.length > 0
    if (hasEvents) continue

    const daysSinceApply = differenceInDays(now, parseISO(job.date))
    if (daysSinceApply < GHOST_THRESHOLD_DAYS) continue

    // Linear ramp: 0.5 at 21d, 1.0 at 60d
    const ghostProbability = Math.min(
      1,
      0.5 + ((daysSinceApply - GHOST_THRESHOLD_DAYS) / (60 - GHOST_THRESHOLD_DAYS)) * 0.5,
    )

    results.push({
      jobId: job.id,
      company: job.company,
      role: job.role,
      daysSinceApply,
      ghostProbability: Math.round(ghostProbability * 100) / 100,
    })
  }

  return results.sort((a, b) => b.ghostProbability - a.ghostProbability)
}

/**
 * Compute response rate, ghost rate, and avg response time per ATS platform.
 * Only considers jobs that were actually submitted.
 */
export function computeATSStats(jobs: Job[]): ATSStats[] {
  const submitted = jobs.filter(
    (j) => j.ats,
  )

  const grouped = new Map<string, Job[]>()
  for (const job of submitted) {
    const key = job.ats.trim().toLowerCase()
    if (!key) continue
    const list = grouped.get(key) ?? []
    list.push(job)
    grouped.set(key, list)
  }

  const stats: ATSStats[] = []
  const now = new Date()

  for (const [ats, atsJobs] of grouped) {
    const totalApplied = atsJobs.length

    let gotResponse = 0
    let totalDaysToResponse = 0
    let responseWithDateCount = 0
    let ghostCount = 0

    for (const job of atsJobs) {
      if (RESPONSE_STATUSES.has(job.status)) {
        gotResponse++
        // Estimate response time from first event date or lastContactDate
        const responseDate = getFirstResponseDate(job)
        if (responseDate && job.date) {
          const days = differenceInDays(responseDate, parseISO(job.date))
          if (days >= 0) {
            totalDaysToResponse += days
            responseWithDateCount++
          }
        }
      } else if (job.status === 'submitted' && job.date) {
        const daysSince = differenceInDays(now, parseISO(job.date))
        if (daysSince > GHOST_THRESHOLD_DAYS && (!job.events || job.events.length === 0)) {
          ghostCount++
        }
      }
    }

    stats.push({
      ats,
      totalApplied,
      gotResponse,
      responseRate: totalApplied > 0 ? Math.round((gotResponse / totalApplied) * 1000) / 1000 : 0,
      avgDaysToResponse: responseWithDateCount > 0
        ? Math.round(totalDaysToResponse / responseWithDateCount)
        : 0,
      ghostRate: totalApplied > 0 ? Math.round((ghostCount / totalApplied) * 1000) / 1000 : 0,
    })
  }

  return stats.sort((a, b) => b.responseRate - a.responseRate)
}

/**
 * Quality score (0-100) for a single application.
 * CV uploaded (+30), portfolio included (+25), cover letter in notes (+15),
 * salary filled (+10), link present (+10), notes filled (+10).
 */
export function computeQualityScore(job: Job): number {
  let score = 0

  // CV uploaded: +30
  if (job.cv && job.cv.trim().length > 0 && job.cv.toLowerCase() !== 'no') {
    score += 30
  }

  // Portfolio included: +25
  if (job.portfolio && job.portfolio.trim().length > 0 && job.portfolio.toLowerCase() !== 'no') {
    score += 25
  }

  // Cover letter mentioned in notes: +15
  if (job.notes && /cover\s*letter|lettre|motivation/i.test(job.notes)) {
    score += 15
  }

  // Salary filled: +10
  if (job.salary && job.salary.trim().length > 0) {
    score += 10
  }

  // Link present: +10
  if (job.link && job.link.trim().length > 0) {
    score += 10
  }

  // Notes filled: +10
  if (job.notes && job.notes.trim().length > 0) {
    score += 10
  }

  return score
}

/**
 * Aggregate intelligence summary across all jobs.
 */
export function computeIntelligenceSummary(jobs: Job[]): IntelligenceSummary {
  const ghosts = detectGhosts(jobs)
  const atsStats = computeATSStats(jobs)

  // Only consider submitted/active jobs for ghost rate denominator
  const submittedJobs = jobs

  const ghostRate = submittedJobs.length > 0
    ? Math.round((ghosts.length / submittedJobs.length) * 1000) / 1000
    : 0

  // Best/worst ATS (need at least 5 applications to qualify)
  const qualifiedATS = atsStats.filter((s) => s.totalApplied >= 5)
  const bestATS = qualifiedATS.length > 0 ? qualifiedATS[0] : null
  const worstATS = qualifiedATS.length > 0 ? qualifiedATS[qualifiedATS.length - 1] : null

  // Average quality score
  const allScores = jobs.map(computeQualityScore)
  const avgQualityScore = allScores.length > 0
    ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
    : 0

  // Response rate by area
  const responseRateByArea = computeGroupedResponseRate(submittedJobs, (j) => j.area || 'unknown')

  // Response rate by source
  const responseRateBySource = computeGroupedResponseRate(submittedJobs, (j) => j.source || 'unknown')

  // Weekly trend (last 12 weeks)
  const weeklyTrend = computeWeeklyTrend(jobs, 12)

  // Top insights (human-readable strings)
  const topInsights = generateInsights(ghosts, atsStats, avgQualityScore, submittedJobs, weeklyTrend)

  return {
    totalGhosts: ghosts.length,
    ghostRate,
    bestATS,
    worstATS,
    avgQualityScore,
    responseRateByArea,
    responseRateBySource,
    weeklyTrend,
    topInsights,
  }
}

// --- Internal helpers ---

function getFirstResponseDate(job: Job): Date | null {
  if (job.lastContactDate) {
    return parseISO(job.lastContactDate)
  }
  if (job.events && job.events.length > 0) {
    const sorted = [...job.events].sort(
      (a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime(),
    )
    return parseISO(sorted[0].date)
  }
  return null
}

function computeGroupedResponseRate(
  jobs: Job[],
  keyFn: (j: Job) => string,
): Record<string, { applied: number; responses: number; rate: number }> {
  const groups = new Map<string, { applied: number; responses: number }>()

  for (const job of jobs) {
    const key = keyFn(job)
    const entry = groups.get(key) ?? { applied: 0, responses: 0 }
    entry.applied++
    if (RESPONSE_STATUSES.has(job.status)) {
      entry.responses++
    }
    groups.set(key, entry)
  }

  const result: Record<string, { applied: number; responses: number; rate: number }> = {}
  for (const [key, val] of groups) {
    result[key] = {
      ...val,
      rate: val.applied > 0 ? Math.round((val.responses / val.applied) * 1000) / 1000 : 0,
    }
  }
  return result
}

function computeWeeklyTrend(jobs: Job[], weeks: number): WeeklyTrendPoint[] {
  const now = new Date()
  const points: WeeklyTrendPoint[] = []

  for (let i = weeks - 1; i >= 0; i--) {
    const weekStartDate = startOfWeek(
      new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000),
      { weekStartsOn: 1 },
    )
    const weekEndDate = new Date(weekStartDate.getTime() + 7 * 24 * 60 * 60 * 1000)

    const weekJobs = jobs.filter((j) => {
      if (!j.date) return false
      const d = parseISO(j.date)
      return d >= weekStartDate && d < weekEndDate
    })

    const applied = weekJobs.length

    const responses = weekJobs.filter((j) => RESPONSE_STATUSES.has(j.status)).length

    points.push({
      weekStart: format(weekStartDate, 'yyyy-MM-dd'),
      applied,
      responses,
      responseRate: applied > 0 ? Math.round((responses / applied) * 1000) / 1000 : 0,
    })
  }

  return points
}

function generateInsights(
  ghosts: GhostResult[],
  atsStats: ATSStats[],
  avgQuality: number,
  submittedJobs: Job[],
  weeklyTrend: WeeklyTrendPoint[],
): string[] {
  const insights: string[] = []

  // Ghost insight
  if (ghosts.length > 0) {
    const highProbGhosts = ghosts.filter((g) => g.ghostProbability >= 0.8)
    if (highProbGhosts.length > 0) {
      insights.push(
        `${highProbGhosts.length} application${highProbGhosts.length > 1 ? 's' : ''} likely ghosted (>80% probability). Consider following up or marking as ghosted.`,
      )
    }
  }

  // Best ATS insight
  const qualified = atsStats.filter((s) => s.totalApplied >= 5)
  if (qualified.length >= 2) {
    const best = qualified[0]
    const worst = qualified[qualified.length - 1]
    if (best.responseRate > worst.responseRate) {
      insights.push(
        `${best.ats} has the best response rate (${(best.responseRate * 100).toFixed(1)}%) vs ${worst.ats} (${(worst.responseRate * 100).toFixed(1)}%). Prioritize ${best.ats} platforms.`,
      )
    }
  }

  // Quality insight
  if (avgQuality < 50) {
    insights.push(
      `Average application quality is ${avgQuality}/100. Adding CVs, portfolios, and cover letters can significantly improve outcomes.`,
    )
  } else if (avgQuality >= 75) {
    insights.push(
      `Application quality is strong at ${avgQuality}/100. Keep including CVs, portfolios, and cover letters.`,
    )
  }

  // Volume trend
  if (weeklyTrend.length >= 2) {
    const recent = weeklyTrend[weeklyTrend.length - 1]
    const prior = weeklyTrend[weeklyTrend.length - 2]
    if (recent.applied > prior.applied * 1.5 && prior.applied > 0) {
      insights.push('Application volume increased significantly this week. Maintain momentum.')
    } else if (recent.applied < prior.applied * 0.5 && prior.applied > 0) {
      insights.push('Application volume dropped this week. Consider ramping up submissions.')
    }
  }

  // Total volume context
  if (submittedJobs.length > 0) {
    const totalResponses = submittedJobs.filter((j) => RESPONSE_STATUSES.has(j.status)).length
    const overallRate = ((totalResponses / submittedJobs.length) * 100).toFixed(1)
    insights.push(
      `Overall response rate: ${overallRate}% (${totalResponses} responses from ${submittedJobs.length} applications).`,
    )
  }

  return insights
}
