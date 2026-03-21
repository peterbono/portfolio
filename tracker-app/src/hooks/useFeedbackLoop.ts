import { useMemo } from 'react'
import { useJobs } from '../context/JobsContext'
import {
  updateATSArms,
  getATSRecommendations,
  detectGhostCompanies,
  analyzeTimingPatterns,
  analyzeQualityImpact,
  computeWeeklyReport,
  computeBotIQ,
  generateFeedbackInsights,
  type FeedbackInsight,
  type ATSRecommendation,
  type GhostCompany,
  type TimingPattern,
  type QualityFactor,
  type WeeklyReport,
} from '../lib/feedback-engine'
import type { ArmStats } from '../types/intelligence'

export interface FeedbackLoopData {
  insights: FeedbackInsight[]
  atsArms: ArmStats[]
  recommendations: ATSRecommendation[]
  ghostCompanies: GhostCompany[]
  timingPatterns: TimingPattern
  qualityImpact: QualityFactor[]
  weeklyReport: WeeklyReport
  botIQ: number
  lastUpdated: string
}

export function useFeedbackLoop(): FeedbackLoopData {
  const { allJobs } = useJobs()

  const atsArms = useMemo(() => updateATSArms(allJobs), [allJobs])

  const recommendations = useMemo(() => getATSRecommendations(atsArms), [atsArms])

  const ghostCompanies = useMemo(() => detectGhostCompanies(allJobs), [allJobs])

  const timingPatterns = useMemo(() => analyzeTimingPatterns(allJobs), [allJobs])

  const qualityImpact = useMemo(() => analyzeQualityImpact(allJobs), [allJobs])

  const weeklyReport = useMemo(() => computeWeeklyReport(allJobs), [allJobs])

  const botIQ = useMemo(() => computeBotIQ(allJobs, atsArms), [allJobs, atsArms])

  const insights = useMemo(() => generateFeedbackInsights(allJobs), [allJobs])

  const lastUpdated = useMemo(() => new Date().toISOString(), [allJobs])

  return {
    insights,
    atsArms,
    recommendations,
    ghostCompanies,
    timingPatterns,
    qualityImpact,
    weeklyReport,
    botIQ,
    lastUpdated,
  }
}
