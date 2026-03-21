import type { ATSStats, ArmStats, BetaDistribution } from '../types/intelligence'

/**
 * Initialize Thompson Sampling arms from ATS performance stats.
 * Each ATS platform becomes a "bandit arm" with a Beta distribution
 * seeded from its observed response rate.
 *
 * Alpha = number of successes (responses) + 1 (prior)
 * Beta  = number of failures (no response) + 1 (prior)
 */
export function initializeArms(atsStats: ATSStats[]): ArmStats[] {
  return atsStats.map((stats) => {
    const successes = stats.gotResponse
    const failures = stats.totalApplied - stats.gotResponse

    return {
      id: stats.ats,
      label: stats.ats,
      dist: {
        alpha: successes + 1, // +1 uniform prior
        beta: failures + 1,
      },
      sampleSize: stats.totalApplied,
    }
  })
}

/**
 * Draw a sample from each arm's Beta distribution and return the arm
 * with the highest sampled value. This is the core Thompson Sampling step:
 * arms with higher observed success rates AND higher uncertainty get explored.
 */
export function thompsonSample(arms: ArmStats[]): ArmStats {
  if (arms.length === 0) {
    throw new Error('Cannot sample from empty arms array')
  }

  let bestArm = arms[0]
  let bestSample = -1

  for (const arm of arms) {
    const sample = sampleBeta(arm.dist.alpha, arm.dist.beta)
    if (sample > bestSample) {
      bestSample = sample
      bestArm = arm
    }
  }

  return bestArm
}

/**
 * Update an arm after observing an outcome.
 * Success (got response) increments alpha. Failure increments beta.
 * Returns a new ArmStats (immutable update).
 */
export function updateArm(arm: ArmStats, success: boolean): ArmStats {
  return {
    ...arm,
    dist: {
      alpha: arm.dist.alpha + (success ? 1 : 0),
      beta: arm.dist.beta + (success ? 0 : 1),
    },
    sampleSize: arm.sampleSize + 1,
  }
}

/**
 * Confidence level based on sample size.
 * More data = narrower Beta distribution = more reliable estimate.
 */
export function getConfidence(arm: ArmStats): 'high' | 'medium' | 'low' {
  if (arm.sampleSize > 100) return 'high'
  if (arm.sampleSize >= 30) return 'medium'
  return 'low'
}

/**
 * Compute the mean of the Beta distribution: alpha / (alpha + beta).
 * Useful for displaying the current estimate alongside the arm.
 */
export function getExpectedValue(arm: ArmStats): number {
  const total = arm.dist.alpha + arm.dist.beta
  return total > 0 ? arm.dist.alpha / total : 0.5
}

/**
 * Rank all arms by their expected value (mean of Beta distribution).
 * Returns a new sorted array, best first.
 */
export function rankArms(arms: ArmStats[]): ArmStats[] {
  return [...arms].sort((a, b) => getExpectedValue(b) - getExpectedValue(a))
}

// --- Internal: Beta distribution sampling ---

/**
 * Sample from Beta(alpha, beta) using the Joehnk method for small parameters
 * and the Gamma-derived method for larger parameters.
 *
 * For alpha,beta >= 1 (our use case with priors), we use:
 *   X ~ Gamma(alpha), Y ~ Gamma(beta), then X/(X+Y) ~ Beta(alpha, beta)
 */
function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha)
  const y = sampleGamma(beta)
  if (x + y === 0) return 0.5
  return x / (x + y)
}

/**
 * Sample from Gamma(shape, 1) using Marsaglia and Tsang's method.
 * For shape >= 1: direct method.
 * For shape < 1: use the relation Gamma(a) = Gamma(a+1) * U^(1/a).
 */
function sampleGamma(shape: number): number {
  if (shape < 1) {
    const u = Math.random()
    return sampleGamma(shape + 1) * Math.pow(u, 1 / shape)
  }

  // Marsaglia and Tsang's method for shape >= 1
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let x: number
    let v: number

    do {
      x = randn()
      v = 1 + c * x
    } while (v <= 0)

    v = v * v * v
    const u = Math.random()

    // Squeeze step
    if (u < 1 - 0.0331 * (x * x) * (x * x)) {
      return d * v
    }

    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v
    }
  }
}

/**
 * Standard normal sample via Box-Muller transform.
 */
function randn(): number {
  const u1 = Math.random()
  const u2 = Math.random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}
