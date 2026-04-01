import type { ATSAdapter } from '../types'
import { greenhouse } from './greenhouse'
import { lever } from './lever'
import { ashby } from './ashby'
import { linkedInEasyApply } from './linkedin-easy-apply'
import { jobBoardRedirect } from './job-board-redirect'
import { generic } from './generic'

/**
 * Registry of all ATS adapters.
 * Order matters: first match wins. The generic adapter is always last as fallback.
 * Ashby goes before jobBoardRedirect — it must be caught early and skipped
 * (CSP blocks headless browsers, causing 30s+ timeouts).
 * Job board redirect adapter goes before generic — catches RemoteOK, Himalayas, etc.
 * and re-dispatches to the correct ATS adapter after resolving the external apply URL.
 */
export const adapters: ATSAdapter[] = [
  greenhouse,
  lever,
  ashby,
  linkedInEasyApply,
  jobBoardRedirect,
  generic,
]

/**
 * Detect the appropriate adapter for a given job URL.
 * Returns the first adapter whose detect() returns true.
 * Falls back to the generic adapter if no specific match.
 */
export function detectAdapter(url: string): ATSAdapter {
  return adapters.find((a) => a.detect(url)) || generic
}

export { greenhouse, lever, ashby, linkedInEasyApply, jobBoardRedirect, generic }
