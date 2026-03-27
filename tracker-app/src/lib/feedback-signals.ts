// ---------------------------------------------------------------------------
// Phase 2: Feedback Signal Collection + Rubric Calibration
// ---------------------------------------------------------------------------
// Stores approve/skip signals from the review queue in localStorage.
// After 20+ signals, calibrateRubric() returns adjusted dimension weights
// so the qualifier prompt can adapt to user preferences over time.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export interface FeedbackSignal {
  jobId: string
  company: string
  role: string
  matchScore: number
  matchReasons: string[]
  action: 'approved' | 'skipped'
  timestamp: string
}

/** Weight multipliers for each scoring rubric dimension (0.5 – 2.0) */
export interface RubricWeights {
  role_fit: number
  industry: number
  skills: number
  location: number
  compensation: number
  growth: number
}

export interface CalibrationResult {
  weights: RubricWeights
  effectiveThreshold: number
  signalCount: number
  approvalRate: number
  adjustments: string[] // human-readable list of what changed
}

// ---------------------------------------------------------------------------
//  Constants
// ---------------------------------------------------------------------------

const LS_KEY = 'tracker_v2_feedback_signals'
const LS_CALIBRATION_KEY = 'tracker_v2_rubric_calibration'
const MIN_SIGNALS_FOR_CALIBRATION = 20
const WEIGHT_STEP_UP = 1.05
const WEIGHT_STEP_DOWN = 0.95
const WEIGHT_MIN = 0.5
const WEIGHT_MAX = 2.0
const DEFAULT_THRESHOLD = 40

const DEFAULT_WEIGHTS: RubricWeights = {
  role_fit: 1.0,
  industry: 1.0,
  skills: 1.0,
  location: 1.0,
  compensation: 1.0,
  growth: 1.0,
}

// ---------------------------------------------------------------------------
//  Storage helpers
// ---------------------------------------------------------------------------

function loadSignals(): FeedbackSignal[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveSignals(signals: FeedbackSignal[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(signals))
  } catch {
    /* quota exceeded — silently drop oldest signals */
    try {
      const trimmed = signals.slice(-500)
      localStorage.setItem(LS_KEY, JSON.stringify(trimmed))
    } catch {
      /* give up */
    }
  }
}

function loadCalibration(): CalibrationResult | null {
  try {
    const raw = localStorage.getItem(LS_CALIBRATION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveCalibration(result: CalibrationResult): void {
  try {
    localStorage.setItem(LS_CALIBRATION_KEY, JSON.stringify(result))
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
//  Public API
// ---------------------------------------------------------------------------

/**
 * Record a feedback signal when the user approves or skips a job.
 * Returns the total signal count (useful for triggering calibration toasts).
 */
export function recordSignal(signal: FeedbackSignal): number {
  const signals = loadSignals()
  signals.push(signal)
  saveSignals(signals)
  return signals.length
}

/** Get all stored feedback signals. */
export function getSignals(): FeedbackSignal[] {
  return loadSignals()
}

/** Get the total number of signals collected. */
export function getSignalCount(): number {
  return loadSignals().length
}

/**
 * Overall approval rate: approved / (approved + skipped).
 * Returns 0 if no signals.
 */
export function getApprovalRate(): number {
  const signals = loadSignals()
  if (signals.length === 0) return 0
  const approved = signals.filter(s => s.action === 'approved').length
  return Math.round((approved / signals.length) * 100) / 100
}

/**
 * Approval rate broken down by score range buckets.
 * Useful for detecting if the threshold is miscalibrated
 * (e.g. user approves 90% of jobs scoring 40-60 => threshold is too strict).
 */
export function getApprovalRateByScoreRange(): { range: string; rate: number; count: number }[] {
  const signals = loadSignals()
  const buckets: { min: number; max: number; label: string }[] = [
    { min: 0, max: 29, label: '0-29' },
    { min: 30, max: 49, label: '30-49' },
    { min: 50, max: 69, label: '50-69' },
    { min: 70, max: 89, label: '70-89' },
    { min: 90, max: 100, label: '90-100' },
  ]

  return buckets.map(bucket => {
    const inRange = signals.filter(
      s => s.matchScore >= bucket.min && s.matchScore <= bucket.max,
    )
    if (inRange.length === 0) return { range: bucket.label, rate: 0, count: 0 }
    const approved = inRange.filter(s => s.action === 'approved').length
    return {
      range: bucket.label,
      rate: Math.round((approved / inRange.length) * 100) / 100,
      count: inRange.length,
    }
  })
}

/**
 * Top reasons from skipped jobs — what matchReasons appear most often
 * in jobs the user chose to skip. Helps identify which rubric dimensions
 * the user disagrees with.
 */
export function getTopSkipReasons(): { reason: string; count: number }[] {
  const signals = loadSignals().filter(s => s.action === 'skipped')
  const counts = new Map<string, number>()

  for (const signal of signals) {
    for (const reason of signal.matchReasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1)
    }
  }

  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
}

// ---------------------------------------------------------------------------
//  Rubric Weight Calibration
// ---------------------------------------------------------------------------

/**
 * Dimension keywords that map matchReasons (free-text) to rubric dimensions.
 * A reason like "Remote APAC timezone" maps to "location".
 */
const DIMENSION_KEYWORDS: Record<keyof RubricWeights, string[]> = {
  role_fit: [
    'role', 'product design', 'design system', 'design ops', 'ux', 'ui',
    'senior', 'lead', 'staff', 'principal', 'title', 'seniority',
  ],
  industry: [
    'industry', 'saas', 'b2b', 'igaming', 'fintech', 'regulated', 'sector',
    'healthcare', 'edtech', 'ecommerce', 'crypto', 'gaming',
  ],
  skills: [
    'skill', 'figma', 'storybook', 'zeroheight', 'design token',
    'component', 'prototype', 'research', 'accessibility',
  ],
  location: [
    'remote', 'location', 'timezone', 'apac', 'emea', 'hybrid', 'on-site',
    'async', 'gmt', 'utc',
  ],
  compensation: [
    'salary', 'compensation', 'pay', 'eur', 'usd', 'equity', 'benefits',
  ],
  growth: [
    'growth', 'leadership', 'complex', 'regulated', 'design system lead',
    'opportunity', 'career', 'impact',
  ],
}

/**
 * Classify a reason string into a rubric dimension based on keyword matching.
 * Returns null if no dimension is a clear match.
 */
function classifyReason(reason: string): keyof RubricWeights | null {
  const lower = reason.toLowerCase()
  let bestDim: keyof RubricWeights | null = null
  let bestCount = 0

  for (const [dim, keywords] of Object.entries(DIMENSION_KEYWORDS)) {
    const hits = keywords.filter(kw => lower.includes(kw)).length
    if (hits > bestCount) {
      bestCount = hits
      bestDim = dim as keyof RubricWeights
    }
  }

  return bestCount > 0 ? bestDim : null
}

/**
 * Calibrate rubric weights based on approve/skip signal history.
 *
 * Algorithm (from the plan):
 * For each dimension:
 *   approved_avg = mean(how often this dimension appears in reasons for approved jobs)
 *   skipped_avg  = mean(how often this dimension appears in reasons for skipped jobs)
 *   If approved_avg > skipped_avg → boost weight (user values this more)
 *   If skipped_avg > approved_avg → reduce weight (user values this less)
 *   Clamp all multipliers to [0.5, 2.0]
 *
 * Also adjusts the effective threshold based on the score distribution
 * of approved vs. skipped jobs.
 *
 * Returns null if fewer than MIN_SIGNALS_FOR_CALIBRATION signals collected.
 */
export function calibrateRubric(): CalibrationResult | null {
  const signals = loadSignals()
  if (signals.length < MIN_SIGNALS_FOR_CALIBRATION) return null

  // Load existing calibration (or start from defaults)
  const existing = loadCalibration()
  const weights: RubricWeights = existing?.weights
    ? { ...existing.weights }
    : { ...DEFAULT_WEIGHTS }

  const approved = signals.filter(s => s.action === 'approved')
  const skipped = signals.filter(s => s.action === 'skipped')

  if (approved.length === 0 || skipped.length === 0) {
    // Need both signal types to calibrate
    return null
  }

  const adjustments: string[] = []

  // --- Weight calibration per dimension ---
  for (const dim of Object.keys(DEFAULT_WEIGHTS) as (keyof RubricWeights)[]) {
    // Count how many approved/skipped signals have reasons matching this dimension
    const approvedHits = approved.filter(s =>
      s.matchReasons.some(r => classifyReason(r) === dim),
    ).length
    const skippedHits = skipped.filter(s =>
      s.matchReasons.some(r => classifyReason(r) === dim),
    ).length

    const approvedRate = approvedHits / approved.length
    const skippedRate = skippedHits / skipped.length

    const oldWeight = weights[dim]
    if (approvedRate > skippedRate) {
      weights[dim] = Math.min(WEIGHT_MAX, weights[dim] * WEIGHT_STEP_UP)
    } else if (skippedRate > approvedRate) {
      weights[dim] = Math.max(WEIGHT_MIN, weights[dim] * WEIGHT_STEP_DOWN)
    }
    // else: equal rates, no change

    if (weights[dim] !== oldWeight) {
      const direction = weights[dim] > oldWeight ? 'boosted' : 'reduced'
      adjustments.push(
        `${dim.replace('_', ' ')}: ${direction} to ${weights[dim].toFixed(2)} (was ${oldWeight.toFixed(2)})`,
      )
    }
  }

  // --- Threshold calibration ---
  // If user approves 80%+ of jobs below the current threshold, it is too strict.
  // If user skips 80%+ of jobs above the threshold, it is too loose.
  const currentThreshold = existing?.effectiveThreshold ?? DEFAULT_THRESHOLD

  const belowThresholdSignals = signals.filter(s => s.matchScore < currentThreshold)
  const aboveThresholdSignals = signals.filter(s => s.matchScore >= currentThreshold)

  let effectiveThreshold = currentThreshold

  if (belowThresholdSignals.length >= 5) {
    const belowApprovalRate = belowThresholdSignals.filter(s => s.action === 'approved').length / belowThresholdSignals.length
    if (belowApprovalRate >= 0.8) {
      // User is rescuing too many below-threshold jobs => lower the threshold
      effectiveThreshold = Math.max(20, effectiveThreshold - 5)
      adjustments.push(`Threshold lowered to ${effectiveThreshold} (you approved ${Math.round(belowApprovalRate * 100)}% of below-threshold jobs)`)
    }
  }

  if (aboveThresholdSignals.length >= 5) {
    const aboveSkipRate = aboveThresholdSignals.filter(s => s.action === 'skipped').length / aboveThresholdSignals.length
    if (aboveSkipRate >= 0.8) {
      // User is skipping too many above-threshold jobs => raise the threshold
      effectiveThreshold = Math.min(80, effectiveThreshold + 5)
      adjustments.push(`Threshold raised to ${effectiveThreshold} (you skipped ${Math.round(aboveSkipRate * 100)}% of above-threshold jobs)`)
    }
  }

  const approvalRate = Math.round((approved.length / signals.length) * 100) / 100

  const result: CalibrationResult = {
    weights,
    effectiveThreshold,
    signalCount: signals.length,
    approvalRate,
    adjustments,
  }

  saveCalibration(result)
  return result
}

/**
 * Get the current calibration state without recalculating.
 * Returns null if no calibration has been performed yet.
 */
export function getCurrentCalibration(): CalibrationResult | null {
  return loadCalibration()
}

/**
 * Get a human-readable summary of the current bot learning state.
 * Used for the "Bot Learning" indicator in the UI.
 */
export function getLearningStatus(): {
  signalCount: number
  calibrated: boolean
  approvalRate: number
  thresholdAdjusted: boolean
  effectiveThreshold: number
  summary: string
} {
  const signalCount = getSignalCount()
  const calibration = loadCalibration()
  const approvalRate = getApprovalRate()

  if (signalCount === 0) {
    return {
      signalCount: 0,
      calibrated: false,
      approvalRate: 0,
      thresholdAdjusted: false,
      effectiveThreshold: DEFAULT_THRESHOLD,
      summary: 'No signals yet — approve or skip jobs to teach the bot',
    }
  }

  if (signalCount < MIN_SIGNALS_FOR_CALIBRATION) {
    return {
      signalCount,
      calibrated: false,
      approvalRate,
      thresholdAdjusted: false,
      effectiveThreshold: DEFAULT_THRESHOLD,
      summary: `${signalCount} signals collected (${MIN_SIGNALS_FOR_CALIBRATION - signalCount} more needed for calibration)`,
    }
  }

  if (!calibration) {
    return {
      signalCount,
      calibrated: false,
      approvalRate,
      thresholdAdjusted: false,
      effectiveThreshold: DEFAULT_THRESHOLD,
      summary: `${signalCount} signals collected — calibration pending`,
    }
  }

  const thresholdAdjusted = calibration.effectiveThreshold !== DEFAULT_THRESHOLD

  return {
    signalCount,
    calibrated: true,
    approvalRate: calibration.approvalRate,
    thresholdAdjusted,
    effectiveThreshold: calibration.effectiveThreshold,
    summary: thresholdAdjusted
      ? `Calibrated from ${signalCount} signals — threshold adjusted to ${calibration.effectiveThreshold}`
      : `Calibrated from ${signalCount} signals — ${Math.round(calibration.approvalRate * 100)}% approval rate`,
  }
}
