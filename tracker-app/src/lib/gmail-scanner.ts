/**
 * Gmail API Scanner — fetches and classifies job-related emails
 * using the Gmail REST API with an OAuth access token.
 *
 * All calls run from the browser (client-side). No backend needed.
 */

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GmailMessage {
  id: string
  subject: string
  from: string
  date: string
}

export type JobEventType = 'rejection' | 'confirmation' | 'interview' | 'offer'

export interface JobEvent {
  type: JobEventType
  company: string
  role?: string
  date: string
  subject: string
}

// ─── Keyword dictionaries ───────────────────────────────────────────────────

const REJECTION_KEYWORDS = [
  'unfortunately',
  'not moving forward',
  'other candidates',
  'not selected',
  'regret to inform',
  'position has been filled',
  'decided not to proceed',
  'will not be moving forward',
  'not the right fit',
  'we have decided to pursue',
  'decided to move forward with',
  'we went with another',
  'we chose another',
  'application was not successful',
  'unable to offer',
]

const CONFIRMATION_KEYWORDS = [
  'application received',
  'application submitted',
  'thank you for applying',
  'we received your application',
  'thanks for your interest',
  'application has been received',
  'successfully submitted',
  'we have received your',
]

const INTERVIEW_KEYWORDS = [
  'interview',
  'schedule a call',
  'phone screen',
  'next steps',
  'meet the team',
  'technical assessment',
  'design challenge',
  'take-home',
  'panel discussion',
  'video call',
  'would like to invite you',
  'set up a time',
  'availability for',
  'calendly',
]

const OFFER_KEYWORDS = [
  'offer letter',
  'job offer',
  'compensation',
  'start date',
  'we are pleased to offer',
  'formal offer',
  'congratulations',
  'welcome aboard',
]

// ─── Helpers ────────────────────────────────────────────────────────────────

async function gmailFetch(
  accessToken: string,
  path: string,
): Promise<Response> {
  const res = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 401) {
    throw new GmailAuthError('Gmail token expired or revoked')
  }
  if (!res.ok) {
    throw new Error(`Gmail API error: ${res.status} ${res.statusText}`)
  }
  return res
}

export class GmailAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GmailAuthError'
  }
}

function getHeader(
  headers: { name: string; value: string }[],
  name: string,
): string {
  const h = headers.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  )
  return h?.value ?? ''
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch recent emails matching a Gmail search query.
 * Returns message metadata (subject, from, date) only.
 */
export async function fetchRecentEmails(
  accessToken: string,
  query: string,
  maxResults = 50,
): Promise<GmailMessage[]> {
  const q = encodeURIComponent(query)
  const listRes = await gmailFetch(
    accessToken,
    `/messages?q=${q}&maxResults=${maxResults}`,
  )
  const listData = await listRes.json()
  const messageIds: { id: string }[] = listData.messages ?? []

  if (messageIds.length === 0) return []

  // Fetch metadata for each message (in parallel, batched)
  const messages: GmailMessage[] = []
  const batchSize = 10
  for (let i = 0; i < messageIds.length; i += batchSize) {
    const batch = messageIds.slice(i, i + batchSize)
    const results = await Promise.all(
      batch.map(async ({ id }) => {
        const msgRes = await gmailFetch(
          accessToken,
          `/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        )
        const msgData = await msgRes.json()
        const headers: { name: string; value: string }[] =
          msgData.payload?.headers ?? []
        return {
          id,
          subject: getHeader(headers, 'Subject'),
          from: getHeader(headers, 'From'),
          date: getHeader(headers, 'Date'),
        }
      }),
    )
    messages.push(...results)
  }
  return messages
}

/**
 * Classify a job email based on subject and sender.
 * Returns the event type or null if unclassifiable.
 */
export function classifyJobEmail(
  subject: string,
  from: string,
): JobEventType | null {
  const text = `${subject} ${from}`.toLowerCase()

  // Order matters — check rejection first (most common), then offer (most specific)
  if (OFFER_KEYWORDS.some((kw) => text.includes(kw))) return 'offer'
  if (INTERVIEW_KEYWORDS.some((kw) => text.includes(kw))) return 'interview'
  if (REJECTION_KEYWORDS.some((kw) => text.includes(kw))) return 'rejection'
  if (CONFIRMATION_KEYWORDS.some((kw) => text.includes(kw))) return 'confirmation'

  return null
}

/**
 * Extract company name from an email sender address or subject line.
 *
 * Tries these strategies in order:
 * 1. Sender display name (e.g. "Acme Inc" from "Acme Inc <no-reply@acme.com>")
 * 2. Email domain second-level (e.g. "acme" from "no-reply@acme.com")
 */
export function extractCompanyFromEmail(
  from: string,
  _subject: string,
): string {
  // Try display name first: "Company Name <email>"
  const displayNameMatch = from.match(/^"?(.+?)"?\s*</)
  if (displayNameMatch) {
    let name = displayNameMatch[1].trim()
    // Strip common suffixes like "Careers", "Recruiting", "Talent", "HR", "Team"
    name = name
      .replace(/\s+(Careers|Recruiting|Talent\s*Team|Talent|HR|Team|Jobs|Hiring)\s*$/i, '')
      .trim()
    // Skip generic senders
    if (name && !['noreply', 'no-reply', 'notifications', 'mailer-daemon'].includes(name.toLowerCase())) {
      return name
    }
  }

  // Fall back to domain
  const emailMatch = from.match(/<?\s*[\w.+-]+@([\w.-]+)\s*>?/)
  if (emailMatch) {
    const domain = emailMatch[1]
    // Get second-level domain, skip common email providers
    const parts = domain.split('.')
    const sld = parts.length >= 2 ? parts[parts.length - 2] : domain
    const genericDomains = ['gmail', 'yahoo', 'outlook', 'hotmail', 'icloud', 'protonmail', 'googlemail']
    if (!genericDomains.includes(sld.toLowerCase())) {
      // Capitalize first letter
      return sld.charAt(0).toUpperCase() + sld.slice(1)
    }
  }

  return 'Unknown'
}

/**
 * Orchestrates a full scan: fetches recent job-related emails,
 * classifies them, and returns structured events.
 */
export async function scanForJobEvents(
  accessToken: string,
): Promise<JobEvent[]> {
  // Gmail search query to find job-related emails from the last 30 days
  const query = [
    'newer_than:30d',
    '(',
    'subject:(application OR applied OR interview OR offer OR unfortunately OR "not moving forward" OR "thank you for applying" OR "we received your" OR "phone screen" OR "next steps" OR "regret to inform")',
    'OR',
    'from:(careers OR recruiting OR talent OR hire OR jobs OR greenhouse OR lever OR workable OR ashby)',
    ')',
  ].join(' ')

  const emails = await fetchRecentEmails(accessToken, query, 100)
  const events: JobEvent[] = []
  const seen = new Set<string>() // deduplicate by company+type

  for (const email of emails) {
    const type = classifyJobEmail(email.subject, email.from)
    if (!type) continue

    const company = extractCompanyFromEmail(email.from, email.subject)
    const key = `${company.toLowerCase()}:${type}`
    if (seen.has(key)) continue
    seen.add(key)

    // Parse date
    let dateStr: string
    try {
      dateStr = new Date(email.date).toISOString().split('T')[0]
    } catch {
      dateStr = new Date().toISOString().split('T')[0]
    }

    events.push({
      type,
      company,
      date: dateStr,
      subject: email.subject,
    })
  }

  return events
}
