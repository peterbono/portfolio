/**
 * Client-side API for triggering bot runs via Trigger.dev REST API.
 */

const TRIGGER_API_URL = 'https://api.trigger.dev/api/v1/tasks/apply-job-pipeline/trigger'

function getTriggerKey(): string {
  return import.meta.env.VITE_TRIGGER_PUBLIC_KEY || ''
}

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
  const key = getTriggerKey()
  if (!key) {
    throw new Error('Bot is not configured. Please contact support.')
  }

  const userId = await getCurrentUserId()
  const searchConfig = getSearchConfig()
  const userProfile = getUserProfile()
  const linkedInCookie = getLinkedInCookie()

  if (!searchConfig || !searchConfig.keywords || (searchConfig.keywords as string[]).length === 0) {
    throw new Error('No search criteria configured. Set up your keywords first.')
  }

  const payload: Record<string, unknown> = {
    userId,
    maxApplications: options?.maxApplications ?? 20,
    dryRun: false,
    // Pass config inline — worker uses this instead of Supabase lookup
    searchConfig,
    userProfile,
  }

  // Include LinkedIn session cookie if available (from Chrome extension)
  if (linkedInCookie) {
    payload.linkedInCookie = linkedInCookie
  }

  const response = await fetch(TRIGGER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ payload }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Failed to start job search: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  return { runId: data.id }
}
