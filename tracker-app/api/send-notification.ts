import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// ─── Types ─────────────────────────────────────────────────────────────

type NotificationType =
  | 'application_submitted'
  | 'rejection_detected'
  | 'interview_scheduled'
  | 'bot_error'
  | 'weekly_digest'

interface NotificationPrefs {
  applicationsSubmitted: boolean
  rejectionsReceived: boolean
  interviewsScheduled: boolean
  weeklyDigest: boolean
  botErrors: boolean
}

/** Maps notification type to the preference key */
const TYPE_TO_PREF: Record<NotificationType, keyof NotificationPrefs> = {
  application_submitted: 'applicationsSubmitted',
  rejection_detected: 'rejectionsReceived',
  interview_scheduled: 'interviewsScheduled',
  bot_error: 'botErrors',
  weekly_digest: 'weeklyDigest',
}

const DEFAULT_PREFS: NotificationPrefs = {
  applicationsSubmitted: true,
  rejectionsReceived: true,
  interviewsScheduled: true,
  weeklyDigest: true,
  botErrors: true,
}

const VALID_TYPES: NotificationType[] = [
  'application_submitted',
  'rejection_detected',
  'interview_scheduled',
  'bot_error',
  'weekly_digest',
]

// ─── Email template builders (inlined to avoid importing from src/) ────

// We dynamically import templates at build time via a helper.
// Since Vercel API routes can't import from src/ (different module context),
// we duplicate the minimal template logic here.

interface EmailResult {
  subject: string
  html: string
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildEmail(type: NotificationType, data: Record<string, unknown>): EmailResult {
  // Import templates inline — Vercel API routes bundle independently
  // We use a simplified approach that mirrors the full templates
  switch (type) {
    case 'application_submitted': {
      const company = String(data.company ?? 'Unknown')
      const role = String(data.role ?? 'Unknown Role')
      const count = Number(data.count ?? 1)
      return {
        subject: count > 1
          ? `${count} applications submitted — including ${company}`
          : `Application submitted to ${company}`,
        html: wrapLayout(
          'Applications Submitted',
          count > 1
            ? `<p style="${pStyle}">The bot just submitted <strong>${count} applications</strong>, including <strong>${escapeHtml(company)}</strong> for <strong>${escapeHtml(role)}</strong>.</p>`
            : `<p style="${pStyle}">Your application to <strong>${escapeHtml(company)}</strong> for <strong>${escapeHtml(role)}</strong> was submitted successfully.</p>`,
        ),
      }
    }
    case 'rejection_detected': {
      const company = String(data.company ?? 'Unknown')
      const role = String(data.role ?? 'Unknown Role')
      return {
        subject: `Rejection detected from ${company}`,
        html: wrapLayout(
          'Rejection Detected',
          `<p style="${pStyle}">We detected a rejection email from <strong>${escapeHtml(company)}</strong> for the <strong>${escapeHtml(role)}</strong> position.</p>
           <div style="margin:16px 0;"><span style="display:inline-block;padding:4px 12px;border-radius:9999px;background-color:#ef444420;color:#ef4444;font-size:13px;font-weight:600;">Rejected</span></div>
           <p style="${pStyle}">The status has been updated in your tracker. Keep going.</p>`,
        ),
      }
    }
    case 'interview_scheduled': {
      const company = String(data.company ?? 'Unknown')
      const role = String(data.role ?? 'Unknown Role')
      const date = data.date ? String(data.date) : null
      return {
        subject: `Interview opportunity at ${company}`,
        html: wrapLayout(
          'Interview Opportunity!',
          `<div style="margin:0 0 16px 0;"><span style="display:inline-block;padding:4px 12px;border-radius:9999px;background-color:#a78bfa20;color:#a78bfa;font-size:13px;font-weight:600;">Interview</span></div>
           <p style="${pStyle}">An interview invitation was detected from <strong>${escapeHtml(company)}</strong> for <strong>${escapeHtml(role)}</strong>.</p>
           ${date ? `<p style="${pStyle}"><strong>Date:</strong> ${escapeHtml(date)}</p>` : ''}
           <p style="${pStyle}">Review the original email for details and prepare accordingly.</p>`,
        ),
      }
    }
    case 'bot_error': {
      const errorMessage = String(data.errorMessage ?? 'Unknown error')
      const runId = String(data.runId ?? 'N/A')
      return {
        subject: 'Bot run failed — action required',
        html: wrapLayout(
          'Bot Run Failed',
          `<div style="margin:0 0 16px 0;"><span style="display:inline-block;padding:4px 12px;border-radius:9999px;background-color:#ef444420;color:#ef4444;font-size:13px;font-weight:600;">Error</span></div>
           <p style="${pStyle}">The auto-apply bot encountered an error during its latest run.</p>
           <div style="margin:16px 0;padding:16px;background-color:#1f2937;border-radius:8px;border:1px solid #374151;">
             <p style="margin:0 0 8px 0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Error Details</p>
             <p style="margin:0;font-size:14px;color:#fca5a5;font-family:monospace;word-break:break-all;">${escapeHtml(errorMessage)}</p>
             <p style="margin:8px 0 0 0;font-size:12px;color:#6b7280;">Run ID: ${escapeHtml(runId)}</p>
           </div>`,
        ),
      }
    }
    case 'weekly_digest': {
      const applied = Number(data.applied ?? 0)
      const rejected = Number(data.rejected ?? 0)
      const interviews = Number(data.interviews ?? 0)
      const pending = Number(data.pending ?? 0)
      return {
        subject: `Weekly digest — ${applied} applied, ${interviews} interview${interviews !== 1 ? 's' : ''}`,
        html: wrapLayout(
          'Your Weekly Job Search Summary',
          `<p style="${pStyle}">Here's how your job search performed this week.</p>
           <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background-color:#1f2937;border-radius:8px;border:1px solid #374151;">
             <tr>
               ${statCell('Applied', applied)}
               ${statCell('Interviews', interviews)}
               ${statCell('Rejected', rejected)}
               ${statCell('Pending', pending)}
             </tr>
           </table>
           ${interviews > 0 ? `<p style="${pStyle}"><span style="color:#a78bfa;font-weight:600;">You have ${interviews} interview${interviews !== 1 ? 's' : ''} to prepare for!</span></p>` : ''}`,
        ),
      }
    }
  }
}

const pStyle = 'margin:0 0 12px 0;font-size:15px;color:#d1d5db;line-height:1.6;'

function statCell(label: string, value: number): string {
  return `<td align="center" style="padding:12px 8px;">
    <div style="font-size:28px;font-weight:700;color:#f9fafb;line-height:1;">${value}</div>
    <div style="font-size:12px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:0.5px;">${label}</div>
  </td>`
}

function wrapLayout(title: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background-color:#0b0f1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b0f1a;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#111827;border-radius:12px;border:1px solid #1f2937;">
        <tr><td style="padding:24px 32px 16px 32px;border-bottom:1px solid #1f2937;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td><span style="font-size:20px;font-weight:700;color:#34d399;letter-spacing:-0.5px;">JobTracker</span></td>
              <td align="right"><span style="font-size:12px;color:#6b7280;">Auto-Apply SaaS</span></td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:24px 32px 32px 32px;">
          <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#f9fafb;line-height:1.3;">${escapeHtml(title)}</h1>
          ${bodyContent}
        </td></tr>
        <tr><td style="padding:16px 32px 24px 32px;border-top:1px solid #1f2937;">
          <p style="margin:0;font-size:12px;color:#4b5563;line-height:1.5;">
            You received this because of your notification preferences.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// ─── Auth helpers ──────────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/**
 * Validate the request. Accepts either:
 * 1. Service role key in x-service-role-key header (for server-to-server / Trigger tasks)
 * 2. User JWT in Authorization: Bearer <token> header (for client-side calls)
 *
 * Returns the userId to send the notification to.
 */
async function authenticateRequest(
  req: VercelRequest,
  bodyUserId: string | undefined,
): Promise<{ userId: string; error?: never } | { error: string; userId?: never }> {
  // Option 1: Service role key (server-to-server)
  const serviceKey = req.headers['x-service-role-key'] as string | undefined
  if (serviceKey && serviceKey === process.env.SUPABASE_SERVICE_ROLE_KEY) {
    if (!bodyUserId) {
      return { error: 'userId required when using service role key auth' }
    }
    return { userId: bodyUserId }
  }

  // Option 2: User JWT
  const authHeader = req.headers['authorization'] as string | undefined
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const supabase = getSupabase()
    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) {
      return { error: 'Invalid or expired JWT' }
    }
    // User can only send notifications to themselves
    return { userId: user.id }
  }

  return { error: 'Missing authentication. Provide Authorization header or x-service-role-key.' }
}

// ─── Resend API ───────────────────────────────────────────────────────

interface ResendPayload {
  from: string
  to: string[]
  subject: string
  html: string
}

async function sendViaResend(payload: ResendPayload): Promise<{ id: string } | { error: string }> {
  const RESEND_API_KEY = process.env.RESEND_API_KEY
  if (!RESEND_API_KEY) {
    return { error: 'RESEND_API_KEY not configured' }
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    console.error(`[send-notification] Resend API error ${response.status}: ${body}`)
    return { error: `Resend API error: ${response.status}` }
  }

  const result = await response.json() as { id: string }
  return result
}

// ─── Main Handler ─────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-service-role-key')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ─── Validate env vars ───────────────────────────────────────────
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[send-notification] Supabase env vars not configured')
    return res.status(500).json({ error: 'Server configuration error' })
  }
  if (!process.env.RESEND_API_KEY) {
    console.error('[send-notification] RESEND_API_KEY not configured')
    return res.status(500).json({ error: 'Server configuration error: email provider not configured' })
  }

  // ─── Parse body ──────────────────────────────────────────────────
  const { userId, type, data } = req.body as {
    userId?: string
    type?: string
    data?: Record<string, unknown>
  }

  if (!type || !VALID_TYPES.includes(type as NotificationType)) {
    return res.status(400).json({
      error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`,
    })
  }

  const notifType = type as NotificationType

  // ─── Authenticate ────────────────────────────────────────────────
  const authResult = await authenticateRequest(req, userId)
  if (authResult.error) {
    return res.status(401).json({ error: authResult.error })
  }
  const resolvedUserId = authResult.userId

  // ─── Look up user email and notification prefs ───────────────────
  const supabase = getSupabase()
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('email, notification_prefs')
    .eq('id', resolvedUserId)
    .maybeSingle()

  if (profileError) {
    console.error(`[send-notification] Profile lookup failed for ${resolvedUserId}:`, profileError)
    return res.status(500).json({ error: 'Failed to look up user profile' })
  }

  if (!profile) {
    return res.status(404).json({ error: 'User profile not found' })
  }

  if (!profile.email) {
    return res.status(400).json({ error: 'User has no email address configured' })
  }

  // ─── Check notification preferences ──────────────────────────────
  const prefs: NotificationPrefs = {
    ...DEFAULT_PREFS,
    ...(profile.notification_prefs as Partial<NotificationPrefs> | null),
  }

  const prefKey = TYPE_TO_PREF[notifType]
  if (!prefs[prefKey]) {
    return res.status(200).json({
      sent: false,
      reason: `User has disabled ${prefKey} notifications`,
    })
  }

  // ─── Build email ─────────────────────────────────────────────────
  const email = buildEmail(notifType, data ?? {})

  // ─── Send via Resend ─────────────────────────────────────────────
  const fromAddress = process.env.RESEND_FROM_EMAIL ?? 'JobTracker <notifications@jobtracker.app>'

  const result = await sendViaResend({
    from: fromAddress,
    to: [profile.email],
    subject: email.subject,
    html: email.html,
  })

  if ('error' in result) {
    console.error(`[send-notification] Failed to send ${notifType} to ${resolvedUserId}: ${result.error}`)
    return res.status(502).json({ error: 'Failed to send email', detail: result.error })
  }

  console.log(`[send-notification] Sent ${notifType} to ${profile.email} (resend id: ${result.id})`)

  return res.status(200).json({
    sent: true,
    emailId: result.id,
    type: notifType,
  })
}
