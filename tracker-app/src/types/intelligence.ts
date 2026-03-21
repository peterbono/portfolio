import type { Area } from './job'

// --- Ghost Detection ---

export interface GhostResult {
  jobId: string
  company: string
  role: string
  daysSinceApply: number
  /** 0-1 probability that the application has been ghosted */
  ghostProbability: number
}

// --- ATS Performance ---

export interface ATSStats {
  ats: string
  totalApplied: number
  gotResponse: number
  responseRate: number
  avgDaysToResponse: number
  ghostRate: number
}

// --- Intelligence Summary ---

export interface WeeklyTrendPoint {
  weekStart: string
  applied: number
  responses: number
  responseRate: number
}

export interface IntelligenceSummary {
  totalGhosts: number
  ghostRate: number
  bestATS: ATSStats | null
  worstATS: ATSStats | null
  avgQualityScore: number
  responseRateByArea: Record<string, { applied: number; responses: number; rate: number }>
  responseRateBySource: Record<string, { applied: number; responses: number; rate: number }>
  weeklyTrend: WeeklyTrendPoint[]
  topInsights: string[]
}

// --- Thompson Sampling ---

export interface BetaDistribution {
  alpha: number
  beta: number
}

export interface ArmStats {
  id: string
  label: string
  dist: BetaDistribution
  sampleSize: number
}
