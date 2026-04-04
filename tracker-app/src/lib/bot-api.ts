/**
 * Client-side API for triggering bot runs via Vercel proxy (avoids CORS).
 * The proxy at /api/trigger-task forwards requests to Trigger.dev server-side.
 */

const PROXY_TASK_URL = '/api/trigger-task'

async function getCurrentUserId(): Promise<string> {
  const { supabase } = await import('./supabase')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user?.id) {
    throw new Error('Not authenticated. Please sign in first.')
  }
  return session.user.id
}

/** Load search config from localStorage */
function getSearchConfig(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem('tracker_v2_search_config')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

/** Load user profile from localStorage */
function getUserProfile(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem('tracker_v2_user_profile')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

/** Load LinkedIn cookie from localStorage (set by Chrome extension) */
function getLinkedInCookie(): string | null {
  try {
    return localStorage.getItem('tracker_v2_linkedin_cookie')
  } catch { return null }
}

/** Load enriched profile from localStorage (set by enrich-profile task) */
function getEnrichedProfile(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem('tracker_v2_enriched_profile')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export interface TriggerBotResponse {
  runId: string
}

// Batch apply progress event detail
export interface BatchApplyProgress {
  current: number
  total: number
  job: ApprovedJobInput
  result?: { success: boolean; status: string; reason?: string }
  phase: 'starting' | 'applying' | 'completed' | 'batch_done'
}

/** Generate a unique request ID for matching extension results */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Trigger a full bot run (scout -> qualify -> apply).
 * Sends search config + user profile inline so the worker doesn't need Supabase lookup.
 */
export async function triggerBotRun(
  _searchProfileId: string,
  options?: { maxApplications?: number },
): Promise<TriggerBotResponse> {
  const userId = await getCurrentUserId()
  const searchConfig = getSearchConfig()
  const userProfile = getUserProfile()
  const linkedInCookie = getLinkedInCookie()

  if (!searchConfig || !searchConfig.keywords || (searchConfig.keywords as string[]).length === 0) {
    throw new Error('No search criteria configured. Set up your keywords first.')
  }

  const enrichedProfile = getEnrichedProfile()

  const payload: Record<string, unknown> = {
    userId,
    maxApplications: options?.maxApplications ?? 20,
    dryRun: false,
    // Pass config inline — worker uses this instead of Supabase lookup
    searchConfig,
    userProfile,
    // Include enriched profile data (from CV/portfolio analysis) if available
    enrichedProfile,
  }

  // Include LinkedIn session cookie if available (from Chrome extension)
  if (linkedInCookie) {
    payload.linkedInCookie = linkedInCookie
  }

  const response = await fetch(PROXY_TASK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: 'apply-job-pipeline', payload }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Failed to start job search: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  return { runId: data.id }
}

// ---------------------------------------------------------------------------
// Phase 2: Qualify discovered jobs (standalone task)
// ---------------------------------------------------------------------------

export interface DiscoveredJobInput {
  title: string
  company: string
  location: string
  url: string
  isEasyApply: boolean
}

/**
 * Trigger Phase 2 (Qualify) as a standalone task.
 * Takes discovered jobs from Phase 1 (Scout) and qualifies them with Haiku.
 * Returns a runId that can be polled for results.
 * Cost: ~$0.003/job x 15 = ~$0.045 per run.
 */
export async function triggerQualifyJobs(
  jobs: DiscoveredJobInput[],
): Promise<TriggerBotResponse> {
  if (jobs.length === 0) {
    throw new Error('No jobs provided for qualification.')
  }

  const userId = await getCurrentUserId()
  const searchConfig = getSearchConfig()
  const userProfile = getUserProfile()
  const enrichedProfile = getEnrichedProfile()

  if (!searchConfig) {
    throw new Error('No search criteria configured. Set up your keywords first.')
  }

  const payload = {
    userId,
    jobs,
    searchConfig,
    userProfile: userProfile || {},
    // Include enriched profile data (from CV/portfolio analysis) if available
    enrichedProfile: enrichedProfile || undefined,
  }

  const response = await fetch(PROXY_TASK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: 'qualify-jobs', payload }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Failed to start job qualification: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  return { runId: data.id }
}

// ---------------------------------------------------------------------------
// Phase 3: Apply to qualified/approved jobs (standalone task)
// ---------------------------------------------------------------------------

export interface ApprovedJobInput {
  url: string
  company: string
  role: string
  coverLetterSnippet: string
  matchScore: number
}

// ─── Extension detection ────────────────────────────────────────────────────
// The Chrome extension content script runs in an isolated world — its window
// vars are invisible to page JS. Detection uses the JOBTRACKER_EXTENSION_INSTALLED
// postMessage the content script sends on load, plus localStorage cookie sync.
let _extensionDetected = false

if (typeof window !== 'undefined') {
  // Listen for extension install announcement (content script sends this on load)
  window.addEventListener('message', (event) => {
    if (event.source === window && event.data?.type === 'JOBTRACKER_EXTENSION_INSTALLED') {
      _extensionDetected = true
      console.log(`[bot-api] Chrome extension detected (v${event.data.version})`)
    }
  })
  // Also check if extension has synced a cookie recently (fallback detection)
  if (localStorage.getItem('tracker_v2_linkedin_cookie')) {
    _extensionDetected = true
  }
}

/**
 * Check if the JobTracker Chrome extension is installed and available.
 */
function isExtensionInstalled(): boolean {
  return _extensionDetected
}

/**
 * Sync user profile to the Chrome extension before ATS applies.
 * Reads user profile + enriched profile from localStorage, merges into
 * the shape expected by ats-apply.js, and sends via postMessage.
 */
function syncProfileToExtension(): void {
  const userProfile = getUserProfile() || {}
  const enrichedProfile = getEnrichedProfile() || {}

  const profileData = {
    firstName: userProfile.firstName || enrichedProfile.firstName || '',
    lastName: userProfile.lastName || enrichedProfile.lastName || '',
    email: userProfile.email || enrichedProfile.email || '',
    phone: userProfile.phone || enrichedProfile.phone || '',
    linkedin: userProfile.linkedin || enrichedProfile.linkedin || '',
    portfolio: userProfile.portfolio || enrichedProfile.portfolio || '',
    city: userProfile.city || enrichedProfile.city || '',
    country: userProfile.country || enrichedProfile.country || '',
    yearsExperience: userProfile.yearsExperience || enrichedProfile.yearsExperience || '',
    cvUrl: userProfile.cvUrl || enrichedProfile.cvUrl || '',
    salary: userProfile.salary || enrichedProfile.salary || '',
    coverLetter: userProfile.coverLetter || enrichedProfile.coverLetter || '',
    github: userProfile.github || enrichedProfile.github || '',
    website: userProfile.website || enrichedProfile.website || '',
  }

  console.log('[bot-api] Syncing profile to Chrome extension for ATS applies')
  window.postMessage({ type: 'JOBTRACKER_SYNC_PROFILE', profileData }, '*')
}

/**
 * Apply a single LinkedIn job via the Chrome extension.
 * Returns a promise that resolves when the extension reports a result.
 * Uses unique requestId for reliable result matching (no company name collisions).
 * Timeout after 3 minutes per job (Easy Apply forms can be multi-step).
 */
function applyOneViaExtension(job: ApprovedJobInput): Promise<{
  success: boolean
  status: string
  reason?: string
  company: string
  role: string
}> {
  const requestId = generateRequestId()

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler)
      resolve({
        success: false,
        status: 'timeout',
        reason: `Extension apply timed out after 3 minutes (${requestId})`,
        company: job.company,
        role: job.role,
      })
    }, 180_000)

    function handler(event: MessageEvent) {
      if (event.source !== window) return
      if (event.data?.type !== 'JOBTRACKER_APPLY_RESULT') return

      // Match by requestId (primary) or company name (fallback for older extension versions)
      const matchesRequestId = event.data.requestId && event.data.requestId === requestId
      const matchesCompany = event.data.company === job.company
      if (!matchesRequestId && !matchesCompany) return

      clearTimeout(timeout)
      window.removeEventListener('message', handler)
      resolve({
        success: event.data.success || false,
        status: event.data.status || (event.data.success ? 'applied' : 'failed'),
        reason: event.data.reason,
        company: job.company,
        role: job.role,
      })
    }

    window.addEventListener('message', handler)

    // Send to extension via content script bridge
    window.postMessage({
      type: 'JOBTRACKER_APPLY_VIA_EXTENSION',
      requestId,
      jobData: {
        url: job.url,
        company: job.company,
        role: job.role,
        coverLetterSnippet: job.coverLetterSnippet,
      },
    }, '*')
  })
}

/**
 * Apply a single ATS job (Greenhouse/Lever/Workable/etc.) via the Chrome extension.
 * Same pattern as applyOneViaExtension but sends JOBTRACKER_APPLY_ATS_VIA_EXTENSION.
 * Listens for JOBTRACKER_APPLY_RESULT response (same as LinkedIn).
 * Timeout after 3 minutes per ATS job (forms can be multi-step with file uploads).
 */
function applyOneAtsViaExtension(job: ApprovedJobInput): Promise<{
  success: boolean
  status: string
  reason?: string
  company: string
  role: string
}> {
  const requestId = generateRequestId()

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler)
      resolve({
        success: false,
        status: 'timeout',
        reason: `Extension ATS apply timed out after 3 minutes (${requestId})`,
        company: job.company,
        role: job.role,
      })
    }, 180_000)

    function handler(event: MessageEvent) {
      if (event.source !== window) return
      if (event.data?.type !== 'JOBTRACKER_APPLY_RESULT') return

      // Match by requestId (primary) or company name (fallback for older extension versions)
      const matchesRequestId = event.data.requestId && event.data.requestId === requestId
      const matchesCompany = event.data.company === job.company
      if (!matchesRequestId && !matchesCompany) return

      clearTimeout(timeout)
      window.removeEventListener('message', handler)
      resolve({
        success: event.data.success || false,
        status: event.data.status || (event.data.success ? 'applied' : 'failed'),
        reason: event.data.reason,
        company: job.company,
        role: job.role,
      })
    }

    window.addEventListener('message', handler)

    // Send to extension via content script bridge — ATS-specific message type
    window.postMessage({
      type: 'JOBTRACKER_APPLY_ATS_VIA_EXTENSION',
      requestId,
      jobData: {
        url: job.url,
        company: job.company,
        role: job.role,
        coverLetterSnippet: job.coverLetterSnippet,
      },
    }, '*')
  })
}

/**
 * Apply ATS jobs (Greenhouse/Lever/Workable/etc.) sequentially via Chrome extension.
 * Same pattern as applyLinkedInJobsViaExtension but with 10s inter-job delay
 * (ATS sites are less aggressive on rate limiting but form fills take longer).
 *
 * Dispatches the same progress events for dashboard compatibility:
 *   - 'jobtracker:extension-apply-progress' — per-job progress (current/total)
 *   - 'jobtracker:extension-apply-result' — per-job result
 *   - 'jobtracker:extension-batch-complete' — batch summary
 */
async function applyAtsJobsViaExtension(jobs: ApprovedJobInput[]): Promise<{
  total: number
  applied: number
  failed: number
  results: Array<{ company: string; role: string; status: string; reason?: string }>
}> {
  const total = jobs.length
  let applied = 0
  let failed = 0
  const results: Array<{ company: string; role: string; status: string; reason?: string }> = []

  console.log(`[bot-api] Batch apply: ${total} ATS jobs via Chrome extension`)

  // Emit batch start
  window.dispatchEvent(new CustomEvent<BatchApplyProgress>('jobtracker:extension-apply-progress', {
    detail: { current: 0, total, job: jobs[0], phase: 'starting' },
  }))

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]

    // Emit progress: starting this job
    window.dispatchEvent(new CustomEvent<BatchApplyProgress>('jobtracker:extension-apply-progress', {
      detail: { current: i + 1, total, job, phase: 'applying' },
    }))

    try {
      console.log(`[bot-api] [${i + 1}/${total}] ATS Applying: ${job.company} — ${job.role}`)
      const result = await applyOneAtsViaExtension(job)
      console.log(`[bot-api] [${i + 1}/${total}] ATS Result: ${result.status} — ${result.reason || 'OK'}`)

      if (result.success || result.status === 'applied' || result.status === 'applied_external') {
        applied++
      } else {
        failed++
      }

      const resultEntry = {
        company: job.company,
        role: job.role,
        status: result.status,
        reason: result.reason,
      }
      results.push(resultEntry)

      // Dispatch per-job result for UI
      window.dispatchEvent(new CustomEvent('jobtracker:extension-apply-result', {
        detail: { ...result, url: job.url },
      }))

      // Emit progress: completed this job
      window.dispatchEvent(new CustomEvent<BatchApplyProgress>('jobtracker:extension-apply-progress', {
        detail: { current: i + 1, total, job, result, phase: 'completed' },
      }))
    } catch (err) {
      failed++
      const reason = err instanceof Error ? err.message : String(err)
      console.error(`[bot-api] [${i + 1}/${total}] ATS Error for ${job.company}:`, err)

      results.push({ company: job.company, role: job.role, status: 'error', reason })

      window.dispatchEvent(new CustomEvent('jobtracker:extension-apply-result', {
        detail: {
          success: false,
          status: 'error',
          reason,
          company: job.company,
          role: job.role,
          url: job.url,
        },
      }))
    }

    // Inter-job delay: 10s between ATS applications
    // Longer than LinkedIn (8s) because ATS form fills involve more page loads
    // Skip delay after the last job
    if (i < jobs.length - 1) {
      console.log(`[bot-api] Waiting 10s before next ATS job...`)
      await new Promise(r => setTimeout(r, 10_000))
    }
  }

  const summary = { total, applied, failed, results }
  console.log(`[bot-api] ATS Batch complete: ${applied} applied, ${failed} failed out of ${total}`)

  // Emit batch complete event with summary
  window.dispatchEvent(new CustomEvent('jobtracker:extension-batch-complete', {
    detail: summary,
  }))

  // Also emit final progress event
  window.dispatchEvent(new CustomEvent<BatchApplyProgress>('jobtracker:extension-apply-progress', {
    detail: { current: total, total, job: jobs[jobs.length - 1], phase: 'batch_done' },
  }))

  return summary
}

/**
 * Apply LinkedIn jobs sequentially via Chrome extension.
 * Dispatches progress events for UI consumption:
 *   - 'jobtracker:extension-apply-progress' — per-job progress (current/total)
 *   - 'jobtracker:extension-apply-result' — per-job result
 *   - 'jobtracker:extension-batch-complete' — batch summary
 *
 * Includes inter-job delay (8s) to avoid LinkedIn rate limiting.
 * Sequential is correct for LinkedIn — parallel sessions get flagged.
 */
async function applyLinkedInJobsViaExtension(jobs: ApprovedJobInput[]): Promise<{
  total: number
  applied: number
  failed: number
  results: Array<{ company: string; role: string; status: string; reason?: string }>
}> {
  const total = jobs.length
  let applied = 0
  let failed = 0
  const results: Array<{ company: string; role: string; status: string; reason?: string }> = []

  console.log(`[bot-api] Batch apply: ${total} LinkedIn jobs via Chrome extension`)

  // Emit batch start
  window.dispatchEvent(new CustomEvent<BatchApplyProgress>('jobtracker:extension-apply-progress', {
    detail: { current: 0, total, job: jobs[0], phase: 'starting' },
  }))

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]

    // Emit progress: starting this job
    window.dispatchEvent(new CustomEvent<BatchApplyProgress>('jobtracker:extension-apply-progress', {
      detail: { current: i + 1, total, job, phase: 'applying' },
    }))

    try {
      console.log(`[bot-api] [${i + 1}/${total}] Applying: ${job.company} — ${job.role}`)
      const result = await applyOneViaExtension(job)
      console.log(`[bot-api] [${i + 1}/${total}] Result: ${result.status} — ${result.reason || 'OK'}`)

      if (result.success || result.status === 'applied' || result.status === 'applied_external') {
        applied++
      } else {
        failed++
      }

      const resultEntry = {
        company: job.company,
        role: job.role,
        status: result.status,
        reason: result.reason,
      }
      results.push(resultEntry)

      // Dispatch per-job result for UI
      window.dispatchEvent(new CustomEvent('jobtracker:extension-apply-result', {
        detail: { ...result, url: job.url },
      }))

      // Emit progress: completed this job
      window.dispatchEvent(new CustomEvent<BatchApplyProgress>('jobtracker:extension-apply-progress', {
        detail: { current: i + 1, total, job, result, phase: 'completed' },
      }))
    } catch (err) {
      failed++
      const reason = err instanceof Error ? err.message : String(err)
      console.error(`[bot-api] [${i + 1}/${total}] Error for ${job.company}:`, err)

      results.push({ company: job.company, role: job.role, status: 'error', reason })

      window.dispatchEvent(new CustomEvent('jobtracker:extension-apply-result', {
        detail: {
          success: false,
          status: 'error',
          reason,
          company: job.company,
          role: job.role,
          url: job.url,
        },
      }))
    }

    // Inter-job delay: 8s between applications to avoid LinkedIn rate limiting
    // Skip delay after the last job
    if (i < jobs.length - 1) {
      console.log(`[bot-api] Waiting 8s before next job (rate limit protection)...`)
      await new Promise(r => setTimeout(r, 8000))
    }
  }

  const summary = { total, applied, failed, results }
  console.log(`[bot-api] Batch complete: ${applied} applied, ${failed} failed out of ${total}`)

  // Emit batch complete event with summary
  window.dispatchEvent(new CustomEvent('jobtracker:extension-batch-complete', {
    detail: summary,
  }))

  // Also emit final progress event
  window.dispatchEvent(new CustomEvent<BatchApplyProgress>('jobtracker:extension-apply-progress', {
    detail: { current: total, total, job: jobs[jobs.length - 1], phase: 'batch_done' },
  }))

  return summary
}

/**
 * Trigger Phase 3 (Apply) as a standalone task.
 * Takes qualified/approved jobs and submits applications via ATS adapters.
 * Max 5 applications per run (daily cap). 2-minute gap between submissions.
 *
 * ROUTING (v2 — extension-first):
 * When Chrome extension is available: ALL jobs go through the extension.
 *   1. Sync profile to extension
 *   2. LinkedIn batch via applyLinkedInJobsViaExtension (sequential, 8s delay)
 *   3. ATS batch via applyAtsJobsViaExtension (sequential, 10s delay)
 *
 * When extension is NOT available: ALL jobs fall back to Trigger.dev cloud.
 *   LinkedIn jobs go to cloud (marked needs_manual), ATS jobs use cloud adapters.
 */
export async function triggerApplyJobs(
  jobs: ApprovedJobInput[],
): Promise<TriggerBotResponse> {
  if (jobs.length === 0) {
    throw new Error('No approved jobs provided for application.')
  }

  // Split LinkedIn vs ATS jobs
  const linkedInJobs = jobs.filter(j => /linkedin\.com\/jobs/i.test(j.url))
  const atsJobs = jobs.filter(j => !/linkedin\.com\/jobs/i.test(j.url))
  const extensionAvailable = isExtensionInstalled()

  console.log(`[bot-api] Apply: ${linkedInJobs.length} LinkedIn, ${atsJobs.length} ATS, extension: ${extensionAvailable}`)

  // ── Extension path: route ALL jobs through the Chrome extension ──────────
  if (extensionAvailable) {
    // Step 1: Sync profile to extension so ATS form-filler has field data
    syncProfileToExtension()

    // Step 2: LinkedIn batch first (sequential — parallel sessions get flagged)
    if (linkedInJobs.length > 0) {
      console.log(`[bot-api] Extension path: applying ${linkedInJobs.length} LinkedIn jobs`)
      await applyLinkedInJobsViaExtension(linkedInJobs)
    }

    // Step 3: ATS batch second (sequential — 10s inter-job delay)
    if (atsJobs.length > 0) {
      console.log(`[bot-api] Extension path: applying ${atsJobs.length} ATS jobs`)
      await applyAtsJobsViaExtension(atsJobs)
    }

    // All jobs routed to extension — return synthetic runId
    // Caller can listen to 'jobtracker:extension-apply-progress' for updates
    return { runId: `extension-batch-${Date.now()}` }
  }

  // ── Cloud fallback: extension not available, send ALL jobs to Trigger.dev ─
  console.log(`[bot-api] Cloud fallback: sending all ${jobs.length} jobs to Trigger.dev`)

  const userId = await getCurrentUserId()
  const userProfile = getUserProfile()
  const linkedInCookie = getLinkedInCookie()
  const enrichedProfile = getEnrichedProfile()

  // Get Gmail access token for Greenhouse security code verification
  let gmailAccessToken: string | null = null
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    if (supabaseUrl && supabaseAnonKey) {
      const sb = createClient(supabaseUrl, supabaseAnonKey)
      const { data: { session } } = await sb.auth.getSession()
      gmailAccessToken = session?.provider_token ?? null
    }
  } catch {
    console.warn('[bot-api] Could not retrieve Gmail access token')
  }

  const payload: Record<string, unknown> = {
    userId,
    jobs,
    userProfile: userProfile || {},
    enrichedProfile: enrichedProfile || undefined,
  }

  // Include LinkedIn cookie for any LinkedIn jobs going to cloud (fallback)
  if (linkedInCookie && jobs.some(j => /linkedin\.com\/jobs/i.test(j.url))) {
    payload.linkedInCookie = linkedInCookie
  }

  // Include Gmail token for Greenhouse security code verification
  if (gmailAccessToken) {
    payload.gmailAccessToken = gmailAccessToken
  }

  const response = await fetch(PROXY_TASK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: 'apply-jobs', payload }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Failed to start job applications: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  return { runId: data.id }
}

// ---------------------------------------------------------------------------
// Profile Enrichment: Analyze CV + Portfolio with AI
// ---------------------------------------------------------------------------

/**
 * Trigger profile enrichment task.
 * Fetches CV and portfolio PDFs, extracts text, analyzes with Haiku.
 * Returns a runId — poll for results, then store in localStorage.
 * Cost: ~$0.008 per enrichment.
 */
export async function triggerEnrichProfile(
  cvUrl: string,
  portfolioUrl?: string,
): Promise<TriggerBotResponse> {
  if (!cvUrl) {
    throw new Error('CV URL is required for profile enrichment.')
  }

  const userId = await getCurrentUserId()

  const payload = {
    userId,
    cvUrl,
    portfolioUrl: portfolioUrl || undefined,
  }

  const response = await fetch(PROXY_TASK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: 'enrich-profile', payload }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Failed to start profile enrichment: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  return { runId: data.id }
}
