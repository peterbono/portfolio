import type { Area } from './job.js'

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

// --- Cover Letter Variants (Phase 3 A/B Testing) ---

export type CoverLetterVariant =
  | 'metric-heavy'
  | 'storytelling'
  | 'concise'
  | 'portfolio-focused'
  | 'design-system-specific'

export const COVER_LETTER_VARIANTS: CoverLetterVariant[] = [
  'metric-heavy',
  'storytelling',
  'concise',
  'portfolio-focused',
  'design-system-specific',
]

export const VARIANT_LABELS: Record<CoverLetterVariant, string> = {
  'metric-heavy': 'Metric-Heavy',
  'storytelling': 'Storytelling',
  'concise': 'Concise',
  'portfolio-focused': 'Portfolio-Focused',
  'design-system-specific': 'Design System Expert',
}

export const VARIANT_PROMPTS: Record<CoverLetterVariant, string> = {
  'metric-heavy': 'Focus on quantifiable achievements and metrics. Lead with numbers: team sizes managed, percentage improvements, system adoption rates, components shipped. Data-driven and impressive.',
  'storytelling': 'Tell a mini-story connecting a past challenge to this role. Use narrative arc: situation → action → result. Warm and memorable, makes the reader feel the impact.',
  'concise': 'Maximum 2 sentences. Razor-sharp precision — one specific skill match, one unique value proposition. No filler words. Busy hiring managers love brevity.',
  'portfolio-focused': 'Reference the portfolio directly. Mention specific case studies or projects visible at the portfolio URL. Create curiosity to click the link.',
  'design-system-specific': 'Deep-dive on design systems expertise: token architecture, component governance, Figma→code pipelines, Storybook documentation, cross-team adoption. Speak the language of a design systems team.',
}
