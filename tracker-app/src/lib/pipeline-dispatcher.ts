/**
 * Pipeline dispatcher — simplified routing (extension pipeline removed).
 *
 * All phases now have fixed backends:
 * - scout:   server  (Trigger.dev cloud)
 * - qualify: server  (Haiku scoring, always server-side)
 * - apply:   headless (Stagehand cloud)
 */

export type PipelineBackend = 'server' | 'headless'

export interface PipelineDecision {
  /** Which backend runs the scout phase (job discovery) */
  scout: PipelineBackend
  /** Which backend runs the qualify phase (always 'server' — AI scoring) */
  qualify: PipelineBackend
  /** Which backend runs the apply phase (form submission) */
  apply: PipelineBackend
  /** Human-readable explanation of the routing decision */
  reason: string
}

/** Fixed pipeline routing — no extension, no mode preference, no tier gating. */
export const PIPELINE_DECISION: PipelineDecision = {
  scout: 'server',
  qualify: 'server',
  apply: 'headless',
  reason: 'Server scout + qualify, headless apply (extension pipeline removed)',
} as const

/**
 * Returns the fixed pipeline decision.
 * Kept as a function for call-site compatibility, but always returns the same result.
 */
export function decidePipeline(): PipelineDecision {
  return PIPELINE_DECISION
}
