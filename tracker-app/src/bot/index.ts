/**
 * Bot module barrel file.
 *
 * Usage in a Trigger.dev worker or standalone script:
 *
 *   import { runPipeline, runPipelineForUser } from './bot'
 *
 *   const result = await runPipelineForUser(userId, browser, { dryRun: true })
 *
 * Apply is handled separately by the apply-jobs.ts trigger task
 * using adapters from './bot/adapters'.
 */

// Orchestrator — main entry points (scout + qualify only)
export { runPipeline, runPipelineForUser } from './orchestrator'
export type { PipelineConfig, PipelineResult } from './orchestrator'

// Scout
export { scoutJobs } from './scout'
export type { DiscoveredJob, ScoutResult } from './scout'

// Qualifier (orchestrator wrappers + re-exported shared core)
export { qualifyJob, qualifyJobsBatch, clearQualificationCache } from './qualifier'
export type { QualificationResult, QualifierConfig } from './qualifier'

// Qualifier core — shared logic (prompt builder, API call, parsing)
export { buildSystemPrompt, buildUserMessage, callHaikuQualifier, buildErrorFallback } from './qualifier-core'

// Supabase server helpers
export {
  supabaseServer,
  createBotRun,
  updateBotRun,
  logBotActivity,
  getExistingApplications,
  createApplicationFromBot,
  getActiveSearchProfile,
} from './supabase-server'
export type { ActivityLogEntry } from './supabase-server'

// ATS Adapters
export { adapters, detectAdapter, greenhouse, lever, linkedInEasyApply, generic } from './adapters'

// Helpers
export {
  humanDelay,
  downloadCV,
  uploadFile,
  uploadFileViaDataTransfer,
  waitAndClick,
  fillInput,
  typeSlowly,
  takeScreenshot,
  answerScreeningQuestion,
  extractCompanyName,
  extractRoleTitle,
  checkForConfirmation,
  scrollToElement,
} from './helpers'

// Types
export type { ApplicantProfile, ApplyResult, ATSAdapter } from './types'
export { APPLICANT } from './types'
