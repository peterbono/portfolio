/**
 * Email Templates for JobTracker SaaS notifications.
 *
 * Each function returns { subject, html } with inline-styled HTML
 * that renders correctly across all major email clients.
 *
 * Brand: dark theme (#111827 bg), #34d399 accent (emerald-400).
 */

// ─── Shared Layout ──────────────────────────────────────────────────────

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#0b0f1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b0f1a;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background-color:#111827;border-radius:12px;border:1px solid #1f2937;">
          <!-- Header -->
          <tr>
            <td style="padding:24px 32px 16px 32px;border-bottom:1px solid #1f2937;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="font-size:20px;font-weight:700;color:#34d399;letter-spacing:-0.5px;">JobTracker</span>
                  </td>
                  <td align="right">
                    <span style="font-size:12px;color:#6b7280;">Auto-Apply SaaS</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:24px 32px 32px 32px;">
              ${body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px 24px 32px;border-top:1px solid #1f2937;">
              <p style="margin:0;font-size:12px;color:#4b5563;line-height:1.5;">
                You received this email because of your notification preferences.
                <br />
                <a href="{{dashboardUrl}}/settings" style="color:#34d399;text-decoration:underline;">Manage preferences</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#f9fafb;line-height:1.3;">${text}</h1>`
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 12px 0;font-size:15px;color:#d1d5db;line-height:1.6;">${text}</p>`
}

function badge(text: string, color: string = '#34d399'): string {
  return `<span style="display:inline-block;padding:4px 12px;border-radius:9999px;background-color:${color}20;color:${color};font-size:13px;font-weight:600;">${escapeHtml(text)}</span>`
}

function statBox(label: string, value: string | number): string {
  return `<td align="center" style="padding:12px 8px;">
    <div style="font-size:28px;font-weight:700;color:#f9fafb;line-height:1;">${value}</div>
    <div style="font-size:12px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:0.5px;">${label}</div>
  </td>`
}

function ctaButton(text: string, url: string = '{{dashboardUrl}}'): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
    <tr>
      <td style="border-radius:8px;background-color:#34d399;">
        <a href="${url}" target="_blank" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#111827;text-decoration:none;border-radius:8px;">
          ${escapeHtml(text)}
        </a>
      </td>
    </tr>
  </table>`
}

// ─── Template: Applications Submitted ────────────────────────────────────

export interface ApplicationSubmittedData {
  company: string
  role: string
  count: number
}

export function applicationSubmittedEmail(data: ApplicationSubmittedData): { subject: string; html: string } {
  const subject = data.count > 1
    ? `${data.count} applications submitted — including ${data.company}`
    : `Application submitted to ${data.company}`

  const body = [
    heading('Applications Submitted'),
    data.count > 1
      ? paragraph(`The bot just submitted <strong>${data.count} applications</strong>, including <strong>${escapeHtml(data.company)}</strong> for <strong>${escapeHtml(data.role)}</strong>.`)
      : paragraph(`Your application to <strong>${escapeHtml(data.company)}</strong> for <strong>${escapeHtml(data.role)}</strong> was submitted successfully.`),
    `<div style="margin:16px 0;">${badge('Submitted', '#34d399')}</div>`,
    paragraph('Check your dashboard for the full list and status updates.'),
    ctaButton('View Applications'),
  ].join('\n')

  return { subject, html: layout(subject, body) }
}

// ─── Template: Rejection Detected ────────────────────────────────────────

export interface RejectionDetectedData {
  company: string
  role: string
}

export function rejectionDetectedEmail(data: RejectionDetectedData): { subject: string; html: string } {
  const subject = `Rejection detected from ${data.company}`

  const body = [
    heading('Rejection Detected'),
    paragraph(`We detected a rejection email from <strong>${escapeHtml(data.company)}</strong> for the <strong>${escapeHtml(data.role)}</strong> position.`),
    `<div style="margin:16px 0;">${badge('Rejected', '#ef4444')}</div>`,
    paragraph('The application status has been automatically updated in your tracker. Keep going — the right opportunity is out there.'),
    ctaButton('View Dashboard'),
  ].join('\n')

  return { subject, html: layout(subject, body) }
}

// ─── Template: Interview Scheduled ───────────────────────────────────────

export interface InterviewScheduledData {
  company: string
  role: string
  date?: string
}

export function interviewScheduledEmail(data: InterviewScheduledData): { subject: string; html: string } {
  const subject = `Interview opportunity at ${data.company}`

  const dateInfo = data.date
    ? paragraph(`<strong>Date:</strong> ${escapeHtml(data.date)}`)
    : ''

  const body = [
    heading('Interview Opportunity!'),
    `<div style="margin:0 0 16px 0;">${badge('Interview', '#a78bfa')}</div>`,
    paragraph(`Great news — an interview invitation was detected from <strong>${escapeHtml(data.company)}</strong> for the <strong>${escapeHtml(data.role)}</strong> position.`),
    dateInfo,
    paragraph('Make sure to review the original email for details and prepare accordingly.'),
    ctaButton('View Details'),
  ].join('\n')

  return { subject, html: layout(subject, body) }
}

// ─── Template: Bot Error ─────────────────────────────────────────────────

export interface BotErrorData {
  errorMessage: string
  runId: string
}

export function botErrorEmail(data: BotErrorData): { subject: string; html: string } {
  const subject = 'Bot run failed — action required'

  const body = [
    heading('Bot Run Failed'),
    `<div style="margin:0 0 16px 0;">${badge('Error', '#ef4444')}</div>`,
    paragraph('The auto-apply bot encountered an error during its latest run.'),
    `<div style="margin:16px 0;padding:16px;background-color:#1f2937;border-radius:8px;border:1px solid #374151;">
      <p style="margin:0 0 8px 0;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Error Details</p>
      <p style="margin:0;font-size:14px;color:#fca5a5;font-family:monospace;word-break:break-all;">${escapeHtml(data.errorMessage)}</p>
      <p style="margin:8px 0 0 0;font-size:12px;color:#6b7280;">Run ID: ${escapeHtml(data.runId)}</p>
    </div>`,
    paragraph('Please check the bot activity log for more context. You may need to adjust your search profile or restart the bot.'),
    ctaButton('View Bot Activity'),
  ].join('\n')

  return { subject, html: layout(subject, body) }
}

// ─── Template: Weekly Digest ─────────────────────────────────────────────

export interface WeeklyDigestData {
  applied: number
  rejected: number
  interviews: number
  pending: number
}

export function weeklyDigestEmail(data: WeeklyDigestData): { subject: string; html: string } {
  const total = data.applied + data.rejected + data.interviews + data.pending
  const subject = `Weekly digest — ${data.applied} applied, ${data.interviews} interview${data.interviews !== 1 ? 's' : ''}`

  const body = [
    heading('Your Weekly Job Search Summary'),
    paragraph(`Here's how your job search performed this week.`),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;background-color:#1f2937;border-radius:8px;border:1px solid #374151;">
      <tr>
        ${statBox('Applied', data.applied)}
        ${statBox('Interviews', data.interviews)}
        ${statBox('Rejected', data.rejected)}
        ${statBox('Pending', data.pending)}
      </tr>
    </table>`,
    total > 0
      ? paragraph(`Total activity: <strong>${total}</strong> applications tracked this week.`)
      : paragraph('No activity this week. Consider adjusting your search criteria or restarting the bot.'),
    data.interviews > 0
      ? paragraph(`<span style="color:#a78bfa;font-weight:600;">You have ${data.interviews} interview${data.interviews !== 1 ? 's' : ''} to prepare for!</span>`)
      : '',
    ctaButton('Open Dashboard'),
  ].join('\n')

  return { subject, html: layout(subject, body) }
}
