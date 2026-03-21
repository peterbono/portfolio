/**
 * Bot module barrel file.
 *
 * Usage in a Trigger.dev worker or standalone script:
 *
 *   import { runPipeline, runPipelineForUser, registerAdapter } from './bot'
 *   import { greenhouse } from './bot/adapters/greenhouse'
 *   import { lever } from './bot/adapters/lever'
 *
 *   registerAdapter(greenhouse)
 *   registerAdapter(lever)
 *
 *   const result = await runPipelineForUser(userId, browser, { dryRun: true })
 */

// Orchestrator — main entry points
export { runPipeline, runPipelineForUser, registerAdapter } from './orchestrator'
export type { PipelineConfig, PipelineResult } from './orchestrator'

// Scout
export { scoutJobs } from './scout'
export type { DiscoveredJob, ScoutResult } from './scout'

// Qualifier
export { qualifyJob, qualifyJobsBatch, clearQualificationCache } from './qualifier'
export type { QualificationResult } from './qualifier'

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
