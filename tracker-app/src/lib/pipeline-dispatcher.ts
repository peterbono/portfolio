/**
 * Pipeline dispatcher — tier-aware routing for the hybrid headless system.
 *
 * Routes each pipeline phase (scout, qualify, apply) to the right backend
 * based on the user's plan tier, mode preference, and available infrastructure.
 *
 * Routing matrix:
 * - Free/Trial:  extension only (scout + apply in browser), qualify on server
 * - Starter:     extension primary, headless fallback for failed applies (30/month)
 * - Pro/Boost:   full headless autopilot (scout on server, qualify on server, apply via Stagehand)
 */

import type { PlanTier } from './billing'
import { canUseFeature } from './billing'
import type { PipelineModePreference } from './bot-api'

export type PipelineBackend = 'extension' | 'server' | 'headless'

export interface PipelineDecision {
  /** Which backend runs the scout phase (job discovery) */
  scout: PipelineBackend
  /** Which backend runs the qualify phase (always 'server' — AI scoring) */
  qualify: PipelineBackend
  /** Which backend runs the apply phase (form submission) */
  apply: PipelineBackend
  /** Optional fallback for applies that fail on the primary backend */
  fallbackApply?: PipelineBackend
  /** Human-readable explanation of the routing decision */
  reason: string
}

/**
 * Decide which backend handles each pipeline phase.
 *
 * @param tier                - User's effective plan tier
 * @param modePref            - User's preference ('auto', 'extension', 'server', 'headless')
 * @param extensionAvailable  - Whether the Chrome extension is installed and responding
 * @param headlessAvailable   - Whether headless infra is configured (BROWSERBASE_API_KEY or Stagehand)
 * @returns A PipelineDecision describing the backend for each phase
 *
 * Logic:
 * 1. If modePref is explicit ('extension', 'server', 'headless'), respect it (with tier gate)
 * 2. If 'auto': use the routing matrix
 * 3. qualify is always 'server' (Haiku scoring runs server-side, no browser needed)
 * 4. For Starter + auto: apply='extension', fallbackApply='headless' (if headless available)
 * 5. For Pro/Boost + auto: apply='headless' (true autopilot, no browser needed)
 * 6. For Free + auto: extension-only pipeline
 */
export function decidePipeline(
  tier: PlanTier,
  modePref: PipelineModePreference,
  extensionAvailable: boolean,
  headlessAvailable: boolean,
): PipelineDecision {
  const hasHeadlessAccess = canUseFeature(tier, 'headless')
  const hasAutopilotAccess = canUseFeature(tier, 'autopilot')

  // ── Explicit mode overrides ────────────────────────────────────────

  if (modePref === 'headless') {
    if (!hasHeadlessAccess) {
      // Tier doesn't allow headless — downgrade to extension or server
      return extensionAvailable
        ? {
            scout: 'extension',
            qualify: 'server',
            apply: 'extension',
            reason: `Headless mode requires Starter+ plan — falling back to extension`,
          }
        : {
            scout: 'server',
            qualify: 'server',
            apply: 'server',
            reason: `Headless mode requires Starter+ plan — falling back to cloud`,
          }
    }
    if (!headlessAvailable) {
      return extensionAvailable
        ? {
            scout: 'extension',
            qualify: 'server',
            apply: 'extension',
            reason: `Headless infra not configured — falling back to extension`,
          }
        : {
            scout: 'server',
            qualify: 'server',
            apply: 'server',
            reason: `Headless infra not configured — falling back to cloud`,
          }
    }
    return {
      scout: hasAutopilotAccess ? 'headless' : 'extension',
      qualify: 'server',
      apply: 'headless',
      reason: `Headless mode selected (${tier} plan)`,
    }
  }

  if (modePref === 'extension') {
    if (!extensionAvailable) {
      return {
        scout: 'server',
        qualify: 'server',
        apply: 'server',
        reason: 'Extension mode selected but extension not detected — falling back to cloud',
      }
    }
    return {
      scout: 'extension',
      qualify: 'server',
      apply: 'extension',
      fallbackApply: hasHeadlessAccess && headlessAvailable ? 'headless' : undefined,
      reason: 'Extension mode selected',
    }
  }

  if (modePref === 'server') {
    return {
      scout: 'server',
      qualify: 'server',
      apply: 'server',
      reason: 'Cloud mode selected — all phases run server-side via Trigger.dev',
    }
  }

  // ── Auto mode: tier-aware routing ──────────────────────────────────

  // Pro/Boost + headless available → full autopilot
  if (hasAutopilotAccess && headlessAvailable) {
    return {
      scout: 'headless',
      qualify: 'server',
      apply: 'headless',
      reason: `${tier} plan — Cloud Autopilot (Stagehand)`,
    }
  }

  // Pro/Boost but headless not available → extension with headless fallback intent
  if (hasAutopilotAccess && !headlessAvailable && extensionAvailable) {
    return {
      scout: 'extension',
      qualify: 'server',
      apply: 'extension',
      reason: `${tier} plan — Extension (headless infra unavailable)`,
    }
  }

  // Starter + extension available → extension primary, headless fallback for failures
  if (hasHeadlessAccess && extensionAvailable) {
    return {
      scout: 'extension',
      qualify: 'server',
      apply: 'extension',
      fallbackApply: headlessAvailable ? 'headless' : undefined,
      reason: `${tier} plan — Extension with headless fallback`,
    }
  }

  // Starter without extension → headless if available, else server
  if (hasHeadlessAccess && !extensionAvailable) {
    return headlessAvailable
      ? {
          scout: 'server',
          qualify: 'server',
          apply: 'headless',
          reason: `${tier} plan — Headless applies (no extension detected)`,
        }
      : {
          scout: 'server',
          qualify: 'server',
          apply: 'server',
          reason: `${tier} plan — Cloud pipeline (no extension, no headless)`,
        }
  }

  // Free/Trial + extension available → extension only
  if (extensionAvailable) {
    return {
      scout: 'extension',
      qualify: 'server',
      apply: 'extension',
      reason: `${tier} plan — Extension pipeline`,
    }
  }

  // Free/Trial, no extension → server-only (Trigger.dev cloud)
  return {
    scout: 'server',
    qualify: 'server',
    apply: 'server',
    reason: `${tier} plan — Cloud pipeline (no extension detected)`,
  }
}
