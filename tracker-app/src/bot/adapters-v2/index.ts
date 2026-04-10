/**
 * Stagehand adapter — single universal AI-powered form filler.
 *
 * No per-ATS adapters. One adapter handles everything via Stagehand
 * act()/observe()/extract(). The AI sees the page like a human.
 */

import type { Stagehand } from '@browserbasehq/stagehand'
import type { ApplicantProfile, ApplyJobResult } from '../types'
import { genericV2 } from './generic-v2'

export interface StagehandAdapter {
  name: string
  detect(url: string): boolean
  apply(
    stagehand: Stagehand,
    jobUrl: string,
    profile: ApplicantProfile,
    coverLetter: string,
  ): Promise<ApplyJobResult>
}

/** Single universal adapter — works on any ATS */
export function detectAdapterV2(_url: string): StagehandAdapter {
  return genericV2
}

export { genericV2 }
