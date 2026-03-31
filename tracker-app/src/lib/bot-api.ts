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
 * Apply a single LinkedIn job via the Chrome extension.
 * Returns a promise that resolves when the extension reports a result.
 * Timeout after 3 minutes per job (Easy Apply forms can be multi-step).
 */
function applyOneViaExtension(job: ApprovedJobInput): Promise<{
  success: boolean
  status: string
  reason?: string
  company: string
  role: string
}> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler)
      resolve({
        success: false,
        status: 'failed',
        reason: 'Extension apply timed out after 3 minutes',
        company: job.company,
        role: job.role,
      })
    }, 180_000)

    function handler(event: MessageEvent) {
      if (event.source !== window) return
      if (event.data?.type !== 'JOBTRACKER_APPLY_RESULT') return
      // Match by company (extension echoes it back)
      if (event.data.company !== job.company) return

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
 * Apply LinkedIn jobs sequentially via Chrome extension.
 * Fire-and-forget from the caller's perspective — results are dispatched
 * as custom events on window for the UI to consume.
 */
async function applyLinkedInJobsViaExtension(jobs: ApprovedJobInput[]): Promise<void> {
  console.log(`[bot-api] Applying ${jobs.length} LinkedIn jobs via Chrome extension`)

  for (const job of jobs) {
    try {
      console.log(`[bot-api] Extension applying: ${job.company} — ${job.role}`)
      const result = await applyOneViaExtension(job)
      console.log(`[bot-api] Extension result: ${result.status} — ${result.reason || 'OK'}`)

      // Dispatch result as custom event for UI consumption
      window.dispatchEvent(new CustomEvent('jobtracker:extension-apply-result', {
        detail: { ...result, url: job.url },
      }))
    } catch (err) {
      console.error(`[bot-api] Extension apply error for ${job.company}:`, err)
      window.dispatchEvent(new CustomEvent('jobtracker:extension-apply-result', {
        detail: {
          success: false,
          status: 'failed',
          reason: err instanceof Error ? err.message : String(err),
          company: job.company,
          role: job.role,
          url: job.url,
        },
      }))
    }
  }

  console.log(`[bot-api] Extension apply batch complete`)
}

/**
 * Trigger Phase 3 (Apply) as a standalone task.
 * Takes qualified/approved jobs and submits applications via ATS adapters.
 * Max 5 applications per run (daily cap). 2-minute gap between submissions.
 *
 * LinkedIn Easy Apply jobs are routed to the Chrome extension (user's browser)
 * when available. ATS jobs (Greenhouse/Lever/etc.) go to Trigger.dev cloud.
 * If extension is not available, LinkedIn jobs go to cloud too (marked needs_manual).
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

  // Route LinkedIn jobs to Chrome extension if available
  if (linkedInJobs.length > 0 && extensionAvailable) {
    // Fire-and-forget: extension applies in user's browser
    // Results come back via 'jobtracker:extension-apply-result' events
    applyLinkedInJobsViaExtension(linkedInJobs)
  }

  // Determine what to send to Trigger.dev cloud
  const cloudJobs = extensionAvailable ? atsJobs : jobs

  if (cloudJobs.length === 0) {
    // All jobs routed to extension — no cloud task needed
    return { runId: `extension-${Date.now()}` }
  }

  const userId = await getCurrentUserId()
  const userProfile = getUserProfile()
  const linkedInCookie = getLinkedInCookie()
  const enrichedProfile = getEnrichedProfile()

  const payload: Record<string, unknown> = {
    userId,
    jobs: cloudJobs,
    userProfile: userProfile || {},
    enrichedProfile: enrichedProfile || undefined,
  }

  // Include LinkedIn cookie for any LinkedIn jobs going to cloud (fallback)
  if (linkedInCookie && cloudJobs.some(j => /linkedin\.com\/jobs/i.test(j.url))) {
    payload.linkedInCookie = linkedInCookie
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
