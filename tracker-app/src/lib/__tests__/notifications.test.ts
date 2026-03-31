import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════
//  Mock supabase (must be before importing the module under test)
// ═══════════════════════════════════════════════════════════════════════

const mockGetSession = vi.fn()

vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
    },
  },
}))

// ═══════════════════════════════════════════════════════════════════════
//  Mock global fetch
// ═══════════════════════════════════════════════════════════════════════

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockGetSession.mockReset()
  mockFetch.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════
//  Import module under test (after mocks)
// ═══════════════════════════════════════════════════════════════════════

import {
  sendNotification,
  notifyApplicationsSubmitted,
  notifyRejectionDetected,
  notifyInterviewScheduled,
  notifyBotError,
  notifyWeeklyDigest,
} from '../notifications'

// ═══════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════

function mockAuth(token = 'mock-jwt-token') {
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: token } },
  })
}

function mockAuthFailure() {
  mockGetSession.mockResolvedValue({
    data: { session: null },
  })
}

function mockFetchSuccess(data: Record<string, unknown> = { sent: true, emailId: 'email-123' }) {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  })
}

function mockFetchError(status = 500, data: Record<string, unknown> = { error: 'Internal error' }) {
  mockFetch.mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(data),
  })
}

function mockFetchNetworkError() {
  mockFetch.mockRejectedValue(new Error('Network request failed'))
}

// ═══════════════════════════════════════════════════════════════════════
//  sendNotification
// ═══════════════════════════════════════════════════════════════════════

describe('sendNotification', () => {
  it('sends correct payload for application_submitted', async () => {
    mockAuth()
    mockFetchSuccess()

    const result = await sendNotification('application_submitted', {
      company: 'Stripe',
      role: 'Product Designer',
      count: 3,
    })

    expect(result.sent).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(1)

    const [url, options] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/send-notification')
    expect(options.method).toBe('POST')
    expect(options.headers['Authorization']).toBe('Bearer mock-jwt-token')
    expect(options.headers['Content-Type']).toBe('application/json')

    const body = JSON.parse(options.body)
    expect(body.type).toBe('application_submitted')
    expect(body.data.company).toBe('Stripe')
    expect(body.data.role).toBe('Product Designer')
    expect(body.data.count).toBe(3)
  })

  it('sends correct payload for rejection_detected', async () => {
    mockAuth()
    mockFetchSuccess()

    await sendNotification('rejection_detected', {
      company: 'Google',
      role: 'UX Designer',
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.type).toBe('rejection_detected')
    expect(body.data.company).toBe('Google')
    expect(body.data.role).toBe('UX Designer')
  })

  it('sends correct payload for interview_scheduled', async () => {
    mockAuth()
    mockFetchSuccess()

    await sendNotification('interview_scheduled', {
      company: 'Meta',
      role: 'Lead Designer',
      date: 'April 10, 2026',
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.type).toBe('interview_scheduled')
    expect(body.data.company).toBe('Meta')
    expect(body.data.date).toBe('April 10, 2026')
  })

  it('sends correct payload for bot_error', async () => {
    mockAuth()
    mockFetchSuccess()

    await sendNotification('bot_error', {
      errorMessage: 'Timeout after 30s',
      runId: 'run-123',
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.type).toBe('bot_error')
    expect(body.data.errorMessage).toBe('Timeout after 30s')
    expect(body.data.runId).toBe('run-123')
  })

  it('sends correct payload for weekly_digest', async () => {
    mockAuth()
    mockFetchSuccess()

    await sendNotification('weekly_digest', {
      applied: 15,
      rejected: 3,
      interviews: 2,
      pending: 10,
    })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.type).toBe('weekly_digest')
    expect(body.data.applied).toBe(15)
    expect(body.data.interviews).toBe(2)
  })

  it('returns { sent: false } when user is not authenticated', async () => {
    mockAuthFailure()

    const result = await sendNotification('application_submitted', {
      company: 'A',
      role: 'B',
      count: 1,
    })

    expect(result.sent).toBe(false)
    expect(result.reason).toContain('not authenticated')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns error info on API error response', async () => {
    mockAuth()
    mockFetchError(401, { error: 'Invalid JWT' })

    const result = await sendNotification('rejection_detected', {
      company: 'X',
      role: 'Y',
    })

    expect(result.sent).toBe(false)
    expect(result.error).toContain('Invalid JWT')
  })

  it('returns error info on network failure', async () => {
    mockAuth()
    mockFetchNetworkError()

    const result = await sendNotification('bot_error', {
      errorMessage: 'err',
      runId: 'r1',
    })

    expect(result.sent).toBe(false)
    expect(result.error).toContain('Network request failed')
  })

  it('does not throw on any failure (fire-and-forget safe)', async () => {
    mockAuth()
    mockFetchNetworkError()

    // Should not throw
    const result = await sendNotification('application_submitted', {
      company: 'A',
      role: 'B',
      count: 1,
    })
    expect(result).toHaveProperty('sent')
    expect(result.sent).toBe(false)
  })

  it('returns emailId on success', async () => {
    mockAuth()
    mockFetchSuccess({ sent: true, emailId: 'resend-email-xyz' })

    const result = await sendNotification('application_submitted', {
      company: 'Acme',
      role: 'Designer',
      count: 1,
    })

    expect(result.sent).toBe(true)
    expect(result.emailId).toBe('resend-email-xyz')
  })

  it('handles auth module import error gracefully', async () => {
    // Simulate getSession throwing — the catch in getAuthToken returns null,
    // which means sendNotification treats it as "not authenticated"
    mockGetSession.mockRejectedValue(new Error('Module load failed'))

    const result = await sendNotification('bot_error', {
      errorMessage: 'err',
      runId: 'r1',
    })

    // Should not throw, should return sent: false with a reason
    expect(result.sent).toBe(false)
    expect(result.reason ?? result.error).toBeTruthy()
    // fetch should NOT have been called since auth failed
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  Convenience wrappers
// ═══════════════════════════════════════════════════════════════════════

describe('notifyApplicationsSubmitted', () => {
  it('calls sendNotification with application_submitted type', async () => {
    mockAuth()
    mockFetchSuccess()

    await notifyApplicationsSubmitted({ company: 'Co', role: 'R', count: 1 })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.type).toBe('application_submitted')
  })
})

describe('notifyRejectionDetected', () => {
  it('calls sendNotification with rejection_detected type', async () => {
    mockAuth()
    mockFetchSuccess()

    await notifyRejectionDetected({ company: 'Co', role: 'R' })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.type).toBe('rejection_detected')
  })
})

describe('notifyInterviewScheduled', () => {
  it('calls sendNotification with interview_scheduled type', async () => {
    mockAuth()
    mockFetchSuccess()

    await notifyInterviewScheduled({ company: 'Co', role: 'R' })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.type).toBe('interview_scheduled')
  })
})

describe('notifyBotError', () => {
  it('calls sendNotification with bot_error type', async () => {
    mockAuth()
    mockFetchSuccess()

    await notifyBotError({ errorMessage: 'err', runId: 'r1' })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.type).toBe('bot_error')
  })
})

describe('notifyWeeklyDigest', () => {
  it('calls sendNotification with weekly_digest type', async () => {
    mockAuth()
    mockFetchSuccess()

    await notifyWeeklyDigest({ applied: 1, rejected: 0, interviews: 0, pending: 0 })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.type).toBe('weekly_digest')
  })
})
