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

/**
 * Trigger Phase 3 (Apply) as a standalone task.
 * Takes qualified/approved jobs and submits applications via ATS adapters.
 * Max 5 applications per run (daily cap). 2-minute gap between submissions.
 * Returns a runId that can be polled for results.
 *
 * For LinkedIn Easy Apply: requires a LinkedIn session cookie (li_at).
 * For ATS (Greenhouse/Lever/Generic): uses Bright Data Scraping Browser.
 */
export async function triggerApplyJobs(
  jobs: ApprovedJobInput[],
): Promise<TriggerBotResponse> {
  if (jobs.length === 0) {
    throw new Error('No approved jobs provided for application.')
  }

  const userId = await getCurrentUserId()
  const userProfile = getUserProfile()
  const linkedInCookie = getLinkedInCookie()
  const enrichedProfile = getEnrichedProfile()

  const payload: Record<string, unknown> = {
    userId,
    jobs,
    userProfile: userProfile || {},
    // Include enriched profile data (from CV/portfolio analysis) if available
    enrichedProfile: enrichedProfile || undefined,
  }

  // Include LinkedIn session cookie if available (needed for Easy Apply)
  if (linkedInCookie) {
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
