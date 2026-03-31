/**
 * Client-side notification helper.
 *
 * Sends a POST to /api/send-notification, which validates auth,
 * checks the user's notification preferences, and dispatches
 * the email via Resend.
 *
 * Usage:
 *   import { sendNotification } from '../lib/notifications'
 *
 *   // From GmailSyncBridge when a rejection is detected:
 *   await sendNotification('rejection_detected', { company: 'Acme', role: 'Designer' })
 *
 *   // From BotRealtimeBridge when applications are submitted:
 *   await sendNotification('application_submitted', { company: 'Stripe', role: 'Product Designer', count: 3 })
 */

import type {
  ApplicationSubmittedData,
  RejectionDetectedData,
  InterviewScheduledData,
  BotErrorData,
  WeeklyDigestData,
} from './email-templates'

// ─── Types ─────────────────────────────────────────────────────────────

export type NotificationType =
  | 'application_submitted'
  | 'rejection_detected'
  | 'interview_scheduled'
  | 'bot_error'
  | 'weekly_digest'

/** Maps each notification type to its expected data shape */
export interface NotificationDataMap {
  application_submitted: ApplicationSubmittedData
  rejection_detected: RejectionDetectedData
  interview_scheduled: InterviewScheduledData
  bot_error: BotErrorData
  weekly_digest: WeeklyDigestData
}

export interface SendNotificationResult {
  sent: boolean
  emailId?: string
  reason?: string
  error?: string
}

// ─── Auth helper ───────────────────────────────────────────────────────

async function getAuthToken(): Promise<string | null> {
  try {
    const { supabase } = await import('./supabase')
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  } catch {
    return null
  }
}

// ─── Main function ─────────────────────────────────────────────────────

/**
 * Send a notification email to the currently authenticated user.
 *
 * This is a fire-and-forget-safe function: it catches all errors
 * and returns a result object instead of throwing.
 *
 * @param type - The notification type
 * @param data - Type-specific payload data
 * @returns Result indicating whether the email was sent
 */
export async function sendNotification<T extends NotificationType>(
  type: T,
  data: NotificationDataMap[T],
): Promise<SendNotificationResult> {
  try {
    const token = await getAuthToken()
    if (!token) {
      console.warn('[notifications] Cannot send notification: user not authenticated')
      return { sent: false, reason: 'User not authenticated' }
    }

    const response = await fetch('/api/send-notification', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ type, data }),
    })

    const result = await response.json() as SendNotificationResult

    if (!response.ok) {
      console.error(`[notifications] API error (${response.status}):`, result)
      return {
        sent: false,
        error: result.error ?? `HTTP ${response.status}`,
      }
    }

    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[notifications] Failed to send ${type} notification:`, message)
    return { sent: false, error: message }
  }
}

// ─── Convenience wrappers ──────────────────────────────────────────────

/** Notify that applications were submitted by the bot */
export function notifyApplicationsSubmitted(data: ApplicationSubmittedData) {
  return sendNotification('application_submitted', data)
}

/** Notify that a rejection email was detected */
export function notifyRejectionDetected(data: RejectionDetectedData) {
  return sendNotification('rejection_detected', data)
}

/** Notify that an interview invitation was detected */
export function notifyInterviewScheduled(data: InterviewScheduledData) {
  return sendNotification('interview_scheduled', data)
}

/** Notify that the bot encountered an error */
export function notifyBotError(data: BotErrorData) {
  return sendNotification('bot_error', data)
}

/** Send the weekly digest summary */
export function notifyWeeklyDigest(data: WeeklyDigestData) {
  return sendNotification('weekly_digest', data)
}
