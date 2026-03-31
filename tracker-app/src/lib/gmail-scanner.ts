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
  'application was sent',
  'you applied to',
  'thank you for applying',
  'we received your application',
  'thanks for your interest',
  'application has been received',
  'successfully submitted',
  'we have received your',
  'thanks for applying',
]

// Subjects matching these patterns should NOT be classified (false positives)
const IGNORE_SUBJECT_PATTERNS = [
  'security code',
  'verification code',
  'verify your email',
  'don\'t forget to complete',
  'complete your application',
  'finish your application',
  'reminder to apply',
  'password reset',
  'confirm your email',
  'activate your account',
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
  const subjectLower = subject.toLowerCase()

  // Skip false positives: security codes, reminders, account emails
  if (IGNORE_SUBJECT_PATTERNS.some((p) => subjectLower.includes(p))) return null

  // Order matters — check rejection first (most common), then offer (most specific)
  if (OFFER_KEYWORDS.some((kw) => text.includes(kw))) return 'offer'
  if (INTERVIEW_KEYWORDS.some((kw) => text.includes(kw))) return 'interview'
  if (REJECTION_KEYWORDS.some((kw) => text.includes(kw))) return 'rejection'
  if (CONFIRMATION_KEYWORDS.some((kw) => text.includes(kw))) return 'confirmation'

  return null
}

/**
 * Detect likely person names: 2-3 capitalized words with no company indicators.
 * e.g. "Rachel Hernandez" → true, "Netflix" → false, "Deel Inc" → false
 */
function isLikelyPersonName(name: string): boolean {
  const words = name.split(/\s+/)
  // Single word that's a common first name → likely person (catches "Florian", "Rachel", etc.)
  if (words.length === 1) {
    const commonFirstNames = [
      'florian', 'rachel', 'sarah', 'david', 'michael', 'john', 'james',
      'robert', 'maria', 'jennifer', 'jessica', 'daniel', 'matthew', 'andrew',
      'mark', 'paul', 'steven', 'thomas', 'chris', 'christopher', 'brian',
      'kevin', 'jason', 'jeff', 'jeffrey', 'eric', 'patrick', 'adam',
      'alex', 'alexander', 'benjamin', 'samuel', 'joseph', 'william', 'emma',
      'olivia', 'sophia', 'isabella', 'charlotte', 'emily', 'elizabeth',
      'laura', 'anna', 'marie', 'julie', 'nicolas', 'pierre', 'jean',
      'ahmed', 'mohamed', 'ali', 'omar', 'hassan', 'fatima', 'aisha',
      'senka', 'maya', 'nina', 'nadia', 'sonia', 'tanya', 'natasha',
    ]
    return commonFirstNames.includes(words[0].toLowerCase())
  }
  if (words.length > 3) return false
  // Company indicators that person names don't have
  const companyIndicators =
    /\b(Inc|LLC|Ltd|GmbH|Corp|SA|SAS|BV|Pty|Co|Group|Labs|Studio|Studios|Digital|Tech|Technologies|Software|Media|Games|Health|AI|IO)\b/i
  if (companyIndicators.test(name)) return false
  // All words must start with uppercase and contain only letters (+ hyphens/apostrophes)
  return words.every((w) => /^[A-Z][a-z'-]+$/.test(w))
}

/**
 * Clean up a raw company name: strip legal suffixes, career prefixes/suffixes,
 * and normalize whitespace.
 */
function cleanCompanyName(name: string): string {
  return name
    .replace(/[\s,.]+\b(Inc|LLC|Ltd|Limited|GmbH|Corp|Corporation|SA|SAS|BV|Pty|Co|PLC|AG|SE|NV)\b\.?\s*$/i, '')
    .replace(/^(Careers|Jobs|Hiring|Recruiting|Recruitment)\s+(at\s+)?/i, '')
    .replace(/\s+(Careers|Jobs|Hiring|Talent|Recruiting|Recruitment|Team)\s*$/i, '')
    .replace(/\s+(was|has been)\s+\w+$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract company name from an email sender address or subject line.
 *
 * Tries these strategies in order:
 * 1. Sender display name (skipping person names and "via LinkedIn" patterns)
 * 2. Subject line patterns (LinkedIn "at COMPANY", "COMPANY sent you", etc.)
 * 3. Email domain second-level (e.g. "acme" from "no-reply@acme.com")
 */
export function extractCompanyFromEmail(
  from: string,
  subject: string,
): string {
  // --- Step 1: Try sender display name ---
  const displayNameMatch = from.match(/^"?(.+?)"?\s*</)
  if (displayNameMatch) {
    let name = displayNameMatch[1].trim()

    // Detect "Person via LinkedIn/Greenhouse/Lever" → skip to subject parsing
    const viaMatch = name.match(
      /^.+?\s+via\s+(LinkedIn|Greenhouse|Lever|Workable|Indeed|Glassdoor|Ashby)/i,
    )
    if (!viaMatch) {
      // Detect "Person Name - Company" or "Person Name | Company" pattern
      // e.g. "Senka Muslibegovic - WorkFlex" → "WorkFlex"
      const personDashCompany = name.match(/^(.+?)\s*[-–—|]\s*(.+)$/)
      if (personDashCompany) {
        const leftPart = personDashCompany[1].trim()
        const rightPart = personDashCompany[2].trim()
        if (isLikelyPersonName(leftPart) && rightPart.length > 1) {
          return cleanCompanyName(rightPart)
        }
        // Also handle "Company - Person Name" (less common but possible)
        if (isLikelyPersonName(rightPart) && leftPart.length > 1) {
          return cleanCompanyName(leftPart)
        }
      }

      // Strip suffixes: "X Hiring Team", "X Talent Acquisition", etc.
      name = name
        .replace(
          /\s*(Hiring\s*Team|Talent\s*Team|Talent\s*Acquisition|HR\s*Team|Recruiting|Recruitment|Human\s*Resources)\s*$/i,
          '',
        )
        .trim()
      // Strip prefixes: "Careers Netflix" → "Netflix"
      name = name.replace(/^(Careers|Jobs|Hiring|Recruiting|Recruitment)\s+(at\s+)?/i, '').trim()
      // Strip suffixes: "Netflix Careers", "Deel Jobs", etc.
      name = name.replace(/\s+(Careers|Jobs|Hiring|Talent|Recruiting)\s*$/i, '').trim()

      // Expanded generic sender blocklist
      const generic = [
        'noreply', 'no-reply', 'notifications', 'apply', 'donotreply',
        'linkedin', 'linkedin job alerts', 'linkedin jobs',
        'talent acquisition', 'recruiter', 'hiring manager', 'human resources',
        'reply', 'info', 'contact', 'team', 'hr', 'admin', 'support',
        'jobs', 'careers', 'hiring', 'talent', 'recruiting',
        'mailer-daemon', 'postmaster',
        'greenhouse', 'lever', 'workable', 'ashby', 'indeed', 'glassdoor',
      ]
      const isGeneric = generic.includes(name.toLowerCase())
      const isPerson = isLikelyPersonName(name)

      if (!isGeneric && !isPerson && name.length > 1) {
        return cleanCompanyName(name)
      }
      // Otherwise fall through to subject parsing
    }
  }

  // --- Step 2: Extract company from subject line ---
  // LinkedIn: "Your application to [ROLE] at [COMPANY] was sent"
  const linkedinSent = subject.match(
    /\bat\s+([A-Za-z][A-Za-z0-9\s&.\-]+?)\s+was\s+(?:sent|viewed|received)/i,
  )
  if (linkedinSent) return cleanCompanyName(linkedinSent[1])

  // LinkedIn: "Your application to [ROLE] at [COMPANY]" (end of subject)
  const linkedinAt = subject.match(/\bat\s+([A-Za-z][A-Za-z0-9\s&.\-]+?)\s*$/i)
  if (linkedinAt) return cleanCompanyName(linkedinAt[1])

  // "[COMPANY] sent you a message" or "[COMPANY] viewed your application"
  const companySent = subject.match(
    /^([A-Za-z][A-Za-z0-9\s&.\-]+?)\s+(?:sent|viewed|reviewed|received|posted|is\s+interested)/i,
  )
  if (companySent && !isLikelyPersonName(companySent[1])) {
    return cleanCompanyName(companySent[1])
  }

  // "at/to/chez/@ Company"
  const atMatch = subject.match(/(?:\bat\b|\bto\b|\bchez\b|@)\s+([A-Za-z][A-Za-z0-9\s&.]+)/i)
  if (atMatch) return cleanCompanyName(atMatch[1])

  // "application ... at/to Company"
  const appAt = subject.match(/application.*?(?:at|to)\s+([A-Za-z][A-Za-z0-9\s&.]+)/i)
  if (appAt) return cleanCompanyName(appAt[1])

  // --- Step 3: Fallback to email domain ---
  const emailMatch = from.match(/<?\s*[\w.+-]+@([\w.-]+)\s*>?/)
  if (emailMatch) {
    const domain = emailMatch[1]
    const parts = domain.split('.')
    const sld = parts.length >= 2 ? parts[parts.length - 2] : domain
    const genericDomains = [
      'gmail', 'yahoo', 'outlook', 'hotmail', 'icloud', 'protonmail', 'googlemail',
      'greenhouse', 'lever', 'workable', 'ashby', 'ashbyhq',
      'recruitee', 'hire', 'pinpoint', 'breezy-mail', 'smartrecruiters',
      'teamtailor-mail', 'recruiting', 'reply', 'peopleforce', 'crossover',
      'indeed', 'glassdoor', 'linkedin', 'manatal', 'dover',
      'notifications', 'noreply', 'mailer-daemon',
    ]
    if (!genericDomains.includes(sld.toLowerCase())) {
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
