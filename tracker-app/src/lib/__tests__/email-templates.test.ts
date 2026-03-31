import { describe, it, expect } from 'vitest'
import {
  applicationSubmittedEmail,
  rejectionDetectedEmail,
  interviewScheduledEmail,
  botErrorEmail,
  weeklyDigestEmail,
} from '../email-templates'
import type {
  ApplicationSubmittedData,
  RejectionDetectedData,
  InterviewScheduledData,
  BotErrorData,
  WeeklyDigestData,
} from '../email-templates'

// ═══════════════════════════════════════════════════════════════════════
//  Shared helpers
// ═══════════════════════════════════════════════════════════════════════

function expectValidEmail(result: { subject: string; html: string }) {
  expect(result).toHaveProperty('subject')
  expect(result).toHaveProperty('html')
  expect(typeof result.subject).toBe('string')
  expect(typeof result.html).toBe('string')
  expect(result.subject.length).toBeGreaterThan(0)
  expect(result.html).toContain('<!DOCTYPE html>')
  expect(result.html).toContain('</html>')
  expect(result.html).toContain('JobTracker')
}

// ═══════════════════════════════════════════════════════════════════════
//  applicationSubmittedEmail
// ═══════════════════════════════════════════════════════════════════════

describe('applicationSubmittedEmail', () => {
  it('returns valid { subject, html } for a single application', () => {
    const result = applicationSubmittedEmail({ company: 'Stripe', role: 'Product Designer', count: 1 })
    expectValidEmail(result)
  })

  it('subject contains company name for single application', () => {
    const result = applicationSubmittedEmail({ company: 'Figma', role: 'UX Designer', count: 1 })
    expect(result.subject).toContain('Figma')
    expect(result.subject).toContain('Application submitted to')
  })

  it('subject contains count and company for multiple applications', () => {
    const result = applicationSubmittedEmail({ company: 'Notion', role: 'Lead Designer', count: 5 })
    expect(result.subject).toContain('5')
    expect(result.subject).toContain('Notion')
    expect(result.subject).toContain('applications submitted')
  })

  it('html body contains company and role', () => {
    const result = applicationSubmittedEmail({ company: 'Linear', role: 'Staff Designer', count: 1 })
    expect(result.html).toContain('Linear')
    expect(result.html).toContain('Staff Designer')
  })

  it('html contains Submitted badge', () => {
    const result = applicationSubmittedEmail({ company: 'Acme', role: 'Designer', count: 1 })
    expect(result.html).toContain('Submitted')
    expect(result.html).toContain('#34d399')
  })

  it('handles special characters in company and role names (XSS prevention)', () => {
    const result = applicationSubmittedEmail({
      company: '<script>alert("xss")</script>',
      role: 'Designer & "Creative" Lead',
      count: 1,
    })
    expectValidEmail(result)
    // HTML should be escaped in the body
    expect(result.html).not.toContain('<script>')
    expect(result.html).toContain('&lt;script&gt;')
    expect(result.html).toContain('&amp;')
    expect(result.html).toContain('&quot;')
  })

  it('handles empty strings for company and role', () => {
    const result = applicationSubmittedEmail({ company: '', role: '', count: 1 })
    expectValidEmail(result)
    // Should not throw, should produce valid email
    expect(result.subject).toBeTruthy()
  })

  it('handles very long company/role names', () => {
    const longName = 'A'.repeat(500)
    const result = applicationSubmittedEmail({ company: longName, role: longName, count: 1 })
    expectValidEmail(result)
    expect(result.html).toContain(longName)
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  rejectionDetectedEmail
// ═══════════════════════════════════════════════════════════════════════

describe('rejectionDetectedEmail', () => {
  it('returns valid { subject, html }', () => {
    const result = rejectionDetectedEmail({ company: 'Google', role: 'Product Designer' })
    expectValidEmail(result)
  })

  it('subject contains company name', () => {
    const result = rejectionDetectedEmail({ company: 'Meta', role: 'UX Designer' })
    expect(result.subject).toContain('Meta')
    expect(result.subject).toContain('Rejection detected')
  })

  it('html body contains company and role', () => {
    const result = rejectionDetectedEmail({ company: 'Apple', role: 'Design Lead' })
    expect(result.html).toContain('Apple')
    expect(result.html).toContain('Design Lead')
  })

  it('html contains Rejected badge with red color', () => {
    const result = rejectionDetectedEmail({ company: 'X', role: 'Designer' })
    expect(result.html).toContain('Rejected')
    expect(result.html).toContain('#ef4444')
  })

  it('escapes HTML in company/role', () => {
    const result = rejectionDetectedEmail({
      company: 'O\'Reilly & "Sons"',
      role: '<b>Bold</b>',
    })
    expect(result.html).not.toContain('<b>Bold</b>')
    expect(result.html).toContain('&lt;b&gt;')
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  interviewScheduledEmail
// ═══════════════════════════════════════════════════════════════════════

describe('interviewScheduledEmail', () => {
  it('returns valid { subject, html }', () => {
    const result = interviewScheduledEmail({ company: 'Spotify', role: 'Product Designer' })
    expectValidEmail(result)
  })

  it('subject contains company name', () => {
    const result = interviewScheduledEmail({ company: 'Netflix', role: 'UX Lead' })
    expect(result.subject).toContain('Netflix')
    expect(result.subject).toContain('Interview opportunity')
  })

  it('html contains Interview badge with purple color', () => {
    const result = interviewScheduledEmail({ company: 'Slack', role: 'Designer' })
    expect(result.html).toContain('Interview')
    expect(result.html).toContain('#a78bfa')
  })

  it('includes date when provided', () => {
    const result = interviewScheduledEmail({ company: 'Vercel', role: 'Designer', date: 'April 5, 2026 at 10:00 AM' })
    expect(result.html).toContain('April 5, 2026 at 10:00 AM')
  })

  it('omits date section when date is undefined', () => {
    const result = interviewScheduledEmail({ company: 'Vercel', role: 'Designer' })
    // The html should not contain a "Date:" label since no date was given
    expect(result.html).not.toContain('<strong>Date:</strong>')
  })

  it('escapes date with special characters', () => {
    const result = interviewScheduledEmail({ company: 'Co', role: 'D', date: '<script>alert(1)</script>' })
    expect(result.html).not.toContain('<script>')
    expect(result.html).toContain('&lt;script&gt;')
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  botErrorEmail
// ═══════════════════════════════════════════════════════════════════════

describe('botErrorEmail', () => {
  it('returns valid { subject, html }', () => {
    const result = botErrorEmail({ errorMessage: 'Timeout after 30s', runId: 'run-123' })
    expectValidEmail(result)
  })

  it('subject is static and descriptive', () => {
    const result = botErrorEmail({ errorMessage: 'err', runId: 'r1' })
    expect(result.subject).toBe('Bot run failed — action required')
  })

  it('html contains error message and run ID', () => {
    const result = botErrorEmail({ errorMessage: 'Navigation failed', runId: 'run-abc-456' })
    expect(result.html).toContain('Navigation failed')
    expect(result.html).toContain('run-abc-456')
  })

  it('html contains Error badge', () => {
    const result = botErrorEmail({ errorMessage: 'err', runId: 'r1' })
    expect(result.html).toContain('Error')
    expect(result.html).toContain('#ef4444')
  })

  it('escapes HTML in error messages', () => {
    const result = botErrorEmail({
      errorMessage: 'Error: <div class="bad">XSS</div>',
      runId: 'run-<script>',
    })
    expect(result.html).not.toContain('<div class="bad">')
    expect(result.html).toContain('&lt;div')
    expect(result.html).toContain('&lt;script&gt;')
  })

  it('handles very long error messages', () => {
    const longError = 'E'.repeat(2000)
    const result = botErrorEmail({ errorMessage: longError, runId: 'run-1' })
    expectValidEmail(result)
    expect(result.html).toContain(longError)
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  weeklyDigestEmail
// ═══════════════════════════════════════════════════════════════════════

describe('weeklyDigestEmail', () => {
  it('returns valid { subject, html }', () => {
    const result = weeklyDigestEmail({ applied: 10, rejected: 3, interviews: 2, pending: 5 })
    expectValidEmail(result)
  })

  it('subject contains applied count and interview count', () => {
    const result = weeklyDigestEmail({ applied: 15, rejected: 5, interviews: 3, pending: 7 })
    expect(result.subject).toContain('15')
    expect(result.subject).toContain('3')
    expect(result.subject).toContain('interviews')
  })

  it('uses singular "interview" when count is 1', () => {
    const result = weeklyDigestEmail({ applied: 5, rejected: 1, interviews: 1, pending: 3 })
    // Subject ends with "1 interview" (no trailing 's')
    expect(result.subject).toMatch(/1 interview$/)
    expect(result.subject).not.toContain('interviews')
  })

  it('uses plural "interviews" when count is not 1', () => {
    const result = weeklyDigestEmail({ applied: 5, rejected: 1, interviews: 0, pending: 3 })
    expect(result.subject).toContain('interviews')
    const r2 = weeklyDigestEmail({ applied: 5, rejected: 1, interviews: 2, pending: 3 })
    expect(r2.subject).toContain('interviews')
  })

  it('html contains stat boxes for all four metrics', () => {
    const result = weeklyDigestEmail({ applied: 12, rejected: 4, interviews: 2, pending: 6 })
    expect(result.html).toContain('>12<')
    expect(result.html).toContain('>4<')
    expect(result.html).toContain('>2<')
    expect(result.html).toContain('>6<')
    expect(result.html).toContain('Applied')
    expect(result.html).toContain('Interviews')
    expect(result.html).toContain('Rejected')
    expect(result.html).toContain('Pending')
  })

  it('handles zero activity week', () => {
    const result = weeklyDigestEmail({ applied: 0, rejected: 0, interviews: 0, pending: 0 })
    expectValidEmail(result)
    expect(result.html).toContain('No activity this week')
  })

  it('shows total activity when there is activity', () => {
    const result = weeklyDigestEmail({ applied: 5, rejected: 2, interviews: 1, pending: 3 })
    expect(result.html).toContain('11')
    expect(result.html).toContain('Total activity')
  })

  it('shows interview prep notice when interviews > 0', () => {
    const result = weeklyDigestEmail({ applied: 10, rejected: 2, interviews: 3, pending: 5 })
    expect(result.html).toContain('prepare for')
    expect(result.html).toContain('#a78bfa')
  })

  it('does not show interview prep notice when interviews = 0', () => {
    const result = weeklyDigestEmail({ applied: 10, rejected: 2, interviews: 0, pending: 5 })
    expect(result.html).not.toContain('prepare for')
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  Cross-cutting: Layout & structure
// ═══════════════════════════════════════════════════════════════════════

describe('email layout structure', () => {
  it('all templates include the brand header', () => {
    const templates = [
      applicationSubmittedEmail({ company: 'A', role: 'B', count: 1 }),
      rejectionDetectedEmail({ company: 'A', role: 'B' }),
      interviewScheduledEmail({ company: 'A', role: 'B' }),
      botErrorEmail({ errorMessage: 'err', runId: 'r' }),
      weeklyDigestEmail({ applied: 0, rejected: 0, interviews: 0, pending: 0 }),
    ]
    for (const t of templates) {
      expect(t.html).toContain('JobTracker')
      expect(t.html).toContain('Auto-Apply SaaS')
    }
  })

  it('all templates include footer with preferences link', () => {
    const templates = [
      applicationSubmittedEmail({ company: 'A', role: 'B', count: 1 }),
      rejectionDetectedEmail({ company: 'A', role: 'B' }),
      interviewScheduledEmail({ company: 'A', role: 'B' }),
      botErrorEmail({ errorMessage: 'err', runId: 'r' }),
      weeklyDigestEmail({ applied: 0, rejected: 0, interviews: 0, pending: 0 }),
    ]
    for (const t of templates) {
      expect(t.html).toContain('notification preferences')
      expect(t.html).toContain('settings')
    }
  })

  it('all templates use dark theme background color', () => {
    const templates = [
      applicationSubmittedEmail({ company: 'A', role: 'B', count: 1 }),
      rejectionDetectedEmail({ company: 'A', role: 'B' }),
    ]
    for (const t of templates) {
      expect(t.html).toContain('#0b0f1a')
      expect(t.html).toContain('#111827')
    }
  })
})
