import type { ATSAdapter } from '../types'
import { greenhouse } from './greenhouse'
import { lever } from './lever'
import { linkedInEasyApply } from './linkedin-easy-apply'
import { generic } from './generic'

/**
 * Registry of all ATS adapters.
 * Order matters: first match wins. The generic adapter is always last as fallback.
 */
export const adapters: ATSAdapter[] = [
  greenhouse,
  lever,
  linkedInEasyApply,
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

export { greenhouse, lever, linkedInEasyApply, generic }
