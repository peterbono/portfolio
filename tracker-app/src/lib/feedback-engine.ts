import { differenceInDays, parseISO, format, getDay, getHours } from 'date-fns'
import type { Job } from '../types/job'
import type { ArmStats, ATSStats } from '../types/intelligence'
import {
  initializeArms,
  getExpectedValue,
  getConfidence,
  rankArms,
} from '../utils/thompson-sampling'
import { computeATSStats, computeQualityScore, detectGhosts } from '../utils/intelligence'

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export interface FeedbackInsight {
  id: string
  type: 'ats_recommendation' | 'timing_insight' | 'quality_tip' | 'ghost_alert' | 'ab_result'
  title: string
  description: string
  confidence: 'high' | 'medium' | 'low'
  impact: 'high' | 'medium' | 'low'
  action?: string
  data?: Record<string, unknown>
  createdAt: string
}

export interface ATSRecommendation {
  ats: string
  score: number
  confidence: 'high' | 'medium' | 'low'
}

export interface GhostCompany {
  company: string
  ghostRate: number
  totalApps: number
  daysSinceApply: number
  jobId: string
}

export interface TimingPattern {
  bestDay: string
  bestTime: string
  data: { day: string; count: number; responses: number; rate: number }[]
}

export interface QualityFactor {
  factor: string
  label: string
  withFactor: number
  withoutFactor: number
  multiplier: number
}

export interface WeeklyReport {
  sent: number
  responses: number
  interviews: number
  sentDelta: number
  responsesDelta: number
  interviewsDelta: number
}

// ---------------------------------------------------------------------------
//  Statuses
// ---------------------------------------------------------------------------

const RESPONSE_STATUSES = new Set([
  'screening', 'interviewing', 'challenge', 'offer', 'rejected',
])

const INTERVIEW_STATUSES = new Set(['interviewing', 'challenge', 'offer'])

const SUBMITTED_ACTIVE = new Set([
  'submitted', 'screening', 'interviewing', 'challenge', 'offer',
  'rejected', 'ghosted',
])

// ---------------------------------------------------------------------------
//  1. Update Thompson Sampling arms based on latest outcomes
// ---------------------------------------------------------------------------

export function updateATSArms(jobs: Job[]): ArmStats[] {
  const atsStats = computeATSStats(jobs)
  if (atsStats.length === 0) return []
  return initializeArms(atsStats)
}

// ---------------------------------------------------------------------------
//  2. Get recommended ATS platforms
// ---------------------------------------------------------------------------

export function getATSRecommendations(arms: ArmStats[]): ATSRecommendation[] {
  if (arms.length === 0) return []
  const ranked = rankArms(arms)
  return ranked.map((arm) => ({
    ats: arm.label,
    score: Math.round(getExpectedValue(arm) * 1000) / 10,
    confidence: getConfidence(arm),
  }))
}

// ---------------------------------------------------------------------------
//  3. Detect ghost companies
// ---------------------------------------------------------------------------

export function detectGhostCompanies(jobs: Job[]): GhostCompany[] {
  const ghosts = detectGhosts(jobs)
  // Group by company and compute aggregate ghost rate
  const companyMap = new Map<string, { totalApps: number; ghosted: number; maxDays: number; jobId: string }>()

  for (const g of ghosts) {
    const key = g.company.toLowerCase()
    const existing = companyMap.get(key) ?? { totalApps: 0, ghosted: 0, maxDays: 0, jobId: g.jobId }
    existing.ghosted++
    existing.totalApps++
    existing.maxDays = Math.max(existing.maxDays, g.daysSinceApply)
    companyMap.set(key, existing)
  }

  // Add non-ghost submitted apps for the same companies to get true total
  const submittedByCompany = new Map<string, number>()
  for (const job of jobs) {
    if (SUBMITTED_ACTIVE.has(job.status)) {
      const key = job.company.toLowerCase()
      submittedByCompany.set(key, (submittedByCompany.get(key) ?? 0) + 1)
    }
  }

  return Array.from(companyMap.entries())
    .map(([company, data]) => ({
      company: ghosts.find((g) => g.company.toLowerCase() === company)?.company ?? company,
      ghostRate: Math.round((data.ghosted / Math.max(data.totalApps, 1)) * 100),
      totalApps: submittedByCompany.get(company) ?? data.totalApps,
      daysSinceApply: data.maxDays,
      jobId: data.jobId,
    }))
    .sort((a, b) => b.daysSinceApply - a.daysSinceApply)
}

// ---------------------------------------------------------------------------
//  4. Timing analysis
// ---------------------------------------------------------------------------

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function analyzeTimingPatterns(jobs: Job[]): TimingPattern {
  const submitted = jobs.filter((j) => j.date && SUBMITTED_ACTIVE.has(j.status))

  const dayStats = new Map<number, { count: number; responses: number }>()
  const hourStats = new Map<number, { count: number; responses: number }>()

  for (const job of submitted) {
    const d = parseISO(job.date)
    const day = getDay(d)
    const hour = getHours(d)
    const gotResponse = RESPONSE_STATUSES.has(job.status)

    const ds = dayStats.get(day) ?? { count: 0, responses: 0 }
    ds.count++
    if (gotResponse) ds.responses++
    dayStats.set(day, ds)

    const hs = hourStats.get(hour) ?? { count: 0, responses: 0 }
    hs.count++
    if (gotResponse) hs.responses++
    hourStats.set(hour, hs)
  }

  const dayData = Array.from(dayStats.entries())
    .map(([day, stats]) => ({
      day: DAY_NAMES[day],
      count: stats.count,
      responses: stats.responses,
      rate: stats.count > 0 ? Math.round((stats.responses / stats.count) * 1000) / 10 : 0,
    }))
    .sort((a, b) => DAY_NAMES.indexOf(a.day) - DAY_NAMES.indexOf(b.day))

  // Best day by response rate (require at least 5 apps for significance)
  const qualifiedDays = dayData.filter((d) => d.count >= 5)
  const bestDayEntry = qualifiedDays.length > 0
    ? qualifiedDays.reduce((a, b) => (a.rate > b.rate ? a : b))
    : dayData[0] ?? { day: 'N/A', rate: 0 }

  // Best hour by response rate
  const hourEntries = Array.from(hourStats.entries())
    .filter(([, s]) => s.count >= 3)
    .map(([h, s]) => ({
      hour: h,
      rate: s.count > 0 ? s.responses / s.count : 0,
    }))
  const bestHour = hourEntries.length > 0
    ? hourEntries.reduce((a, b) => (a.rate > b.rate ? a : b))
    : null

  const bestTimeStr = bestHour
    ? `${bestHour.hour.toString().padStart(2, '0')}:00`
    : 'N/A'

  return {
    bestDay: bestDayEntry?.day ?? 'N/A',
    bestTime: bestTimeStr,
    data: dayData,
  }
}

// ---------------------------------------------------------------------------
//  5. Quality impact analysis
// ---------------------------------------------------------------------------

export function analyzeQualityImpact(jobs: Job[]): QualityFactor[] {
  const submitted = jobs.filter((j) => SUBMITTED_ACTIVE.has(j.status))
  if (submitted.length === 0) return []

  function computeRate(predicate: (j: Job) => boolean): { withRate: number; withoutRate: number } {
    const withJobs = submitted.filter(predicate)
    const withoutJobs = submitted.filter((j) => !predicate(j))
    const withResponses = withJobs.filter((j) => RESPONSE_STATUSES.has(j.status)).length
    const withoutResponses = withoutJobs.filter((j) => RESPONSE_STATUSES.has(j.status)).length

    return {
      withRate: withJobs.length > 0 ? Math.round((withResponses / withJobs.length) * 1000) / 10 : 0,
      withoutRate: withoutJobs.length > 0 ? Math.round((withoutResponses / withoutJobs.length) * 1000) / 10 : 0,
    }
  }

  const factors: QualityFactor[] = []

  // CV uploaded
  const cv = computeRate((j) => !!(j.cv && j.cv.trim().length > 0 && j.cv.toLowerCase() !== 'no'))
  factors.push({
    factor: 'cv',
    label: 'CV Uploaded',
    withFactor: cv.withRate,
    withoutFactor: cv.withoutRate,
    multiplier: cv.withoutRate > 0 ? Math.round((cv.withRate / cv.withoutRate) * 10) / 10 : 0,
  })

  // Portfolio included
  const portfolio = computeRate(
    (j) => !!(j.portfolio && j.portfolio.trim().length > 0 && j.portfolio.toLowerCase() !== 'no'),
  )
  factors.push({
    factor: 'portfolio',
    label: 'Portfolio Included',
    withFactor: portfolio.withRate,
    withoutFactor: portfolio.withoutRate,
    multiplier: portfolio.withoutRate > 0
      ? Math.round((portfolio.withRate / portfolio.withoutRate) * 10) / 10
      : 0,
  })

  // Cover letter mentioned in notes
  const cover = computeRate(
    (j) => !!(j.notes && /cover\s*letter|lettre|motivation/i.test(j.notes)),
  )
  factors.push({
    factor: 'cover_letter',
    label: 'Cover Letter',
    withFactor: cover.withRate,
    withoutFactor: cover.withoutRate,
    multiplier: cover.withoutRate > 0
      ? Math.round((cover.withRate / cover.withoutRate) * 10) / 10
      : 0,
  })

  // Salary mentioned
  const salary = computeRate((j) => !!(j.salary && j.salary.trim().length > 0))
  factors.push({
    factor: 'salary',
    label: 'Salary Mentioned',
    withFactor: salary.withRate,
    withoutFactor: salary.withoutRate,
    multiplier: salary.withoutRate > 0
      ? Math.round((salary.withRate / salary.withoutRate) * 10) / 10
      : 0,
  })

  return factors.sort((a, b) => b.multiplier - a.multiplier)
}

// ---------------------------------------------------------------------------
//  6. Weekly report (last 7 days vs prior 7 days)
// ---------------------------------------------------------------------------

export function computeWeeklyReport(jobs: Job[]): WeeklyReport {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

  function countInRange(start: Date, end: Date) {
    const inRange = jobs.filter((j) => {
      if (!j.date) return false
      const d = parseISO(j.date)
      return d >= start && d < end
    })

    const sent = inRange.filter((j) => SUBMITTED_ACTIVE.has(j.status)).length
    const responses = inRange.filter((j) => RESPONSE_STATUSES.has(j.status)).length
    const interviews = inRange.filter((j) => INTERVIEW_STATUSES.has(j.status)).length

    return { sent, responses, interviews }
  }

  const thisWeek = countInRange(sevenDaysAgo, now)
  const lastWeek = countInRange(fourteenDaysAgo, sevenDaysAgo)

  return {
    sent: thisWeek.sent,
    responses: thisWeek.responses,
    interviews: thisWeek.interviews,
    sentDelta: thisWeek.sent - lastWeek.sent,
    responsesDelta: thisWeek.responses - lastWeek.responses,
    interviewsDelta: thisWeek.interviews - lastWeek.interviews,
  }
}

// ---------------------------------------------------------------------------
//  7. Bot IQ Score (0-100)
// ---------------------------------------------------------------------------

export function computeBotIQ(jobs: Job[], arms: ArmStats[]): number {
  let score = 0

  // Factor 1: Sample size across arms (max 30 points)
  // More data = smarter bot
  const totalSamples = arms.reduce((sum, a) => sum + a.sampleSize, 0)
  score += Math.min(30, Math.round((totalSamples / 200) * 30))

  // Factor 2: Diversity of ATS tested (max 20 points)
  const uniqueATS = arms.length
  score += Math.min(20, uniqueATS * 2)

  // Factor 3: Outcome tracking completeness (max 25 points)
  // What fraction of submitted apps have a resolved status?
  const submitted = jobs.filter((j) => SUBMITTED_ACTIVE.has(j.status))
  const resolved = jobs.filter(
    (j) => RESPONSE_STATUSES.has(j.status) || j.status === 'ghosted',
  )
  const completeness = submitted.length > 0 ? resolved.length / submitted.length : 0
  score += Math.round(completeness * 25)

  // Factor 4: Recency — active in last 7 days (max 15 points)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const recentApps = jobs.filter((j) => {
    if (!j.date) return false
    return parseISO(j.date) >= sevenDaysAgo
  }).length
  score += Math.min(15, recentApps * 3)

  // Factor 5: Event tracking (max 10 points)
  const withEvents = jobs.filter((j) => j.events && j.events.length > 0).length
  const eventRate = submitted.length > 0 ? withEvents / submitted.length : 0
  score += Math.round(eventRate * 10)

  return Math.min(100, score)
}

// ---------------------------------------------------------------------------
//  8. Generate all feedback insights
// ---------------------------------------------------------------------------

export function generateFeedbackInsights(jobs: Job[]): FeedbackInsight[] {
  const insights: FeedbackInsight[] = []
  const now = new Date().toISOString()

  const atsStats = computeATSStats(jobs)
  const arms = updateATSArms(jobs)
  const ghosts = detectGhosts(jobs)
  const qualityFactors = analyzeQualityImpact(jobs)
  const timing = analyzeTimingPatterns(jobs)

  // --- ATS Recommendations ---
  const qualified = atsStats.filter((s) => s.totalApplied >= 5)
  if (qualified.length >= 2) {
    const best = qualified[0]
    const worst = qualified[qualified.length - 1]
    insights.push({
      id: 'ats-best',
      type: 'ats_recommendation',
      title: `${best.ats} is your top performer`,
      description: `${best.ats} has a ${(best.responseRate * 100).toFixed(1)}% response rate vs ${worst.ats} at ${(worst.responseRate * 100).toFixed(1)}%. Thompson Sampling will prioritize it.`,
      confidence: best.totalApplied > 30 ? 'high' : 'medium',
      impact: 'high',
      action: `Prioritize ${best.ats} platforms when choosing where to apply.`,
      data: { bestATS: best.ats, bestRate: best.responseRate, worstATS: worst.ats, worstRate: worst.responseRate },
      createdAt: now,
    })
  }

  // --- Ghost Alerts ---
  const highProbGhosts = ghosts.filter((g) => g.ghostProbability >= 0.8)
  if (highProbGhosts.length > 0) {
    insights.push({
      id: 'ghost-alert',
      type: 'ghost_alert',
      title: `${highProbGhosts.length} applications likely ghosted`,
      description: `These companies haven't responded in over 3 weeks. Consider following up or marking them as ghosted to improve your pipeline accuracy.`,
      confidence: 'high',
      impact: 'medium',
      action: 'Review and mark ghosted applications',
      data: { count: highProbGhosts.length, companies: highProbGhosts.slice(0, 5).map((g) => g.company) },
      createdAt: now,
    })
  }

  // --- Quality Tips ---
  for (const factor of qualityFactors) {
    if (factor.multiplier >= 2 && factor.withFactor > factor.withoutFactor) {
      insights.push({
        id: `quality-${factor.factor}`,
        type: 'quality_tip',
        title: `${factor.label} boosts response rate ${factor.multiplier}x`,
        description: `Applications with ${factor.label.toLowerCase()} get a ${factor.withFactor}% response rate vs ${factor.withoutFactor}% without.`,
        confidence: 'medium',
        impact: factor.multiplier >= 3 ? 'high' : 'medium',
        action: `Always include ${factor.label.toLowerCase()} in your applications.`,
        data: { factor: factor.factor, multiplier: factor.multiplier },
        createdAt: now,
      })
    }
  }

  // --- Timing Insights ---
  if (timing.data.length > 0) {
    const bestDayData = timing.data.find((d) => d.day === timing.bestDay)
    if (bestDayData && bestDayData.rate > 0) {
      const avgRate = timing.data.reduce((sum, d) => sum + d.rate, 0) / timing.data.length
      if (bestDayData.rate > avgRate * 1.3) {
        insights.push({
          id: 'timing-day',
          type: 'timing_insight',
          title: `${timing.bestDay}s get the best responses`,
          description: `Applications sent on ${timing.bestDay}s have a ${bestDayData.rate}% response rate, above the ${avgRate.toFixed(1)}% average.`,
          confidence: bestDayData.count >= 20 ? 'high' : 'low',
          impact: 'medium',
          action: `Schedule bulk applications for ${timing.bestDay}s when possible.`,
          data: { bestDay: timing.bestDay, rate: bestDayData.rate, avgRate },
          createdAt: now,
        })
      }
    }
  }

  return insights
}
