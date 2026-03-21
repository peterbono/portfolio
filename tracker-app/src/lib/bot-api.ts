/**
 * Client-side API for triggering bot runs via Trigger.dev REST API.
 *
 * This module is imported by the frontend (Vite SPA). It calls the
 * Trigger.dev REST API directly — no server routes needed.
 */

const TRIGGER_API_URL = 'https://api.trigger.dev/api/v1/tasks/apply-job-pipeline/trigger'

// Florian's user ID (single-tenant for now)
const USER_ID = '3b6384c8-8f81-4cb5-9a6e-76d6f25cf19b'

function getTriggerKey(): string {
  return import.meta.env.VITE_TRIGGER_PUBLIC_KEY || ''
}

export interface TriggerBotResponse {
  runId: string
}

/**
 * Trigger a full bot run (scout -> qualify -> apply).
 */
export async function triggerBotRun(
  searchProfileId: string,
  options?: { maxApplications?: number },
): Promise<TriggerBotResponse> {
  const key = getTriggerKey()
  if (!key) {
    throw new Error('VITE_TRIGGER_PUBLIC_KEY is not configured')
  }

  const response = await fetch(TRIGGER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      payload: {
        userId: USER_ID,
        searchProfileId,
        maxApplications: options?.maxApplications ?? 20,
        dryRun: false,
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Failed to trigger bot run: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  return { runId: data.id }
}

/**
 * Trigger a dry run (scout -> qualify -> simulate apply, no real submissions).
 */
export async function triggerDryRun(
  searchProfileId: string,
  options?: { maxApplications?: number },
): Promise<TriggerBotResponse> {
  const key = getTriggerKey()
  if (!key) {
    throw new Error('VITE_TRIGGER_PUBLIC_KEY is not configured')
  }

  const response = await fetch(TRIGGER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      payload: {
        userId: USER_ID,
        searchProfileId,
        maxApplications: options?.maxApplications ?? 20,
        dryRun: true,
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Failed to trigger dry run: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  return { runId: data.id }
}
