/**
 * Stagehand-based adapter registry (v2).
 *
 * Each adapter uses Stagehand's AI-powered act()/observe()/extract() instead
 * of brittle CSS selectors. The registry mirrors the v1 adapter pattern
 * (detect → apply) but operates on Stagehand instances instead of raw
 * Playwright Pages.
 *
 * Adapter priority (first match wins):
 *   1. Greenhouse (boards.greenhouse.io)
 *   2. Generic fallback (any URL)
 */

import type { Stagehand } from '@browserbasehq/stagehand'
import type { ApplicantProfile } from '../types'
import type { ApplyJobResult } from '../../trigger/apply-jobs'

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface StagehandAdapter {
  /** Human-readable adapter name for logging */
  name: string

  /** Return true if this adapter should handle the given URL */
  detect(url: string): boolean

  /**
   * Apply to a job using Stagehand AI automation.
   *
   * @param stagehand - Initialized Stagehand instance (owns the browser page)
   * @param jobUrl    - Direct URL to the job application page
   * @param profile   - Applicant profile with all personal data
   * @param coverLetter - Per-job AI-generated cover letter snippet
   * @returns ApplyJobResult with status and metadata
   */
  apply(
    stagehand: Stagehand,
    jobUrl: string,
    profile: ApplicantProfile,
    coverLetter: string,
  ): Promise<ApplyJobResult>
}

// ---------------------------------------------------------------------------
// Adapter imports
// ---------------------------------------------------------------------------

import { greenhouseV2 } from './greenhouse-v2'
import { genericV2 } from './generic-v2'

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Ordered list of v2 adapters. First match wins.
 * Generic is always last as the universal fallback.
 */
export const adaptersV2: StagehandAdapter[] = [
  greenhouseV2,
  genericV2,
]

/**
 * Detect the appropriate Stagehand adapter for a given job URL.
 * Returns the first adapter whose detect() returns true.
 * Falls back to the generic adapter if no specific match.
 */
export function detectAdapterV2(url: string): StagehandAdapter {
  return adaptersV2.find((a) => a.detect(url)) || genericV2
}

// Re-export individual adapters for direct use
export { greenhouseV2, genericV2 }
