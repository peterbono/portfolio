import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * Tests for api/queue-apply.ts — producer endpoint for the Vercel Queues
 * apply pipeline. These tests exist to guard the front→queue contract and
 * would have caught regressions like:
 *   - POST body with job missing `url`         (current bug)
 *   - POST body with `url: null`               (current bug)
 *   - Missing `userId`                         (400)
 *   - Empty `jobs[]`                           (400)
 *   - Ashby URLs counted in `queued`           (should be excluded)
 *   - Over-large batches (>50) accepted        (400)
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the handler
// ---------------------------------------------------------------------------

const mockSend = vi.fn()
vi.mock('@vercel/queue', () => ({
  send: (...args: unknown[]) => mockSend(...args),
}))

const mockCreateBotRun = vi.fn()
const mockLogBotActivity = vi.fn().mockResolvedValue(undefined)
const mockCreateApplicationFromBot = vi.fn().mockResolvedValue(undefined)
vi.mock('../../src/bot/supabase-server', () => ({
  createBotRun: (...args: unknown[]) => mockCreateBotRun(...args),
  logBotActivity: (...args: unknown[]) => mockLogBotActivity(...args),
  createApplicationFromBot: (...args: unknown[]) =>
    mockCreateApplicationFromBot(...args),
}))

// ---------------------------------------------------------------------------
// Import handler after mocks
// ---------------------------------------------------------------------------

import handler from '../queue-apply'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockReq(body: unknown, method = 'POST'): VercelRequest {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body,
  } as unknown as VercelRequest
}

interface MockRes extends VercelResponse {
  _status: number
  _json: unknown
  _headers: Record<string, string>
  _ended: boolean
}

function createMockRes(): MockRes {
  const res = {
    _status: 0,
    _json: null as unknown,
    _headers: {} as Record<string, string>,
    _ended: false,
    setHeader(key: string, value: string) {
      res._headers[key] = value
      return res
    },
    status(code: number) {
      res._status = code
      return res
    },
    json(data: unknown) {
      res._json = data
      return res
    },
    end() {
      res._ended = true
      return res
    },
  }
  return res as unknown as MockRes
}

const VALID_JOB = {
  url: 'https://jobs.lever.co/acme/abc-123',
  company: 'Acme',
  role: 'Senior Product Designer',
  matchScore: 82,
  jdKeywords: ['figma', 'design system'],
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('api/queue-apply', () => {
  beforeEach(() => {
    mockSend.mockReset()
    mockCreateBotRun.mockReset()
    mockLogBotActivity.mockClear()
    mockCreateApplicationFromBot.mockClear()

    // Default: each send() resolves with a fake messageId
    mockSend.mockImplementation(async () => ({
      messageId: `msg-${Math.random().toString(36).slice(2, 10)}`,
    }))
    // Default: createBotRun returns a fake runId
    mockCreateBotRun.mockResolvedValue('run-fake-uuid-0001')
  })

  it('returns 200 with { runId, queued } for a valid request', async () => {
    const req = createMockReq({
      jobs: [VALID_JOB],
      userId: 'user-abc-123',
    })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    const body = res._json as { runId: string; queued: number }
    expect(body.runId).toBe('run-fake-uuid-0001')
    expect(body.queued).toBe(1)

    expect(mockCreateBotRun).toHaveBeenCalledTimes(1)
    expect(mockCreateBotRun).toHaveBeenCalledWith(
      'user-abc-123',
      expect.any(String),
    )
    expect(mockSend).toHaveBeenCalledTimes(1)
    const [topic, message] = mockSend.mock.calls[0] as [string, Record<string, unknown>]
    expect(topic).toBe('apply-jobs')
    expect(message.jobUrl).toBe(VALID_JOB.url)
    expect(message.company).toBe('Acme')
    expect(message.role).toBe('Senior Product Designer')
    expect(message.runId).toBe('run-fake-uuid-0001')
  })

  it('returns 400 when userId is missing', async () => {
    const req = createMockReq({ jobs: [VALID_JOB] })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    const body = res._json as { error: string }
    expect(body.error).toMatch(/userId/i)
    expect(mockCreateBotRun).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns 400 when jobs array is empty', async () => {
    const req = createMockReq({ jobs: [], userId: 'user-abc-123' })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    const body = res._json as { error: string }
    expect(body.error).toMatch(/empty/i)
    expect(mockCreateBotRun).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns 400 when a job is missing url (regression: sample job with link=null)', async () => {
    const req = createMockReq({
      jobs: [{ company: 'Acme', role: 'Designer' }], // no url
      userId: 'user-abc-123',
    })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    const body = res._json as { error: string }
    expect(body.error).toMatch(/url/i)
    expect(mockCreateBotRun).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns 400 when a job has url: null (regression: sample job with link=null)', async () => {
    const req = createMockReq({
      jobs: [{ url: null, company: 'Acme', role: 'Designer' }],
      userId: 'user-abc-123',
    })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    const body = res._json as { error: string }
    expect(body.error).toMatch(/url/i)
    expect(mockCreateBotRun).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('excludes Ashby URLs from the queue count', async () => {
    const req = createMockReq({
      jobs: [
        VALID_JOB,
        {
          url: 'https://jobs.ashbyhq.com/widgetco/xyz-789',
          company: 'WidgetCo',
          role: 'Product Designer',
        },
      ],
      userId: 'user-abc-123',
    })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    const body = res._json as {
      runId: string
      queued: number
      skippedAshby: number
      total: number
    }
    expect(body.queued).toBe(1)
    expect(body.skippedAshby).toBe(1)
    expect(body.total).toBe(2)

    // send() was only invoked for the non-Ashby job
    expect(mockSend).toHaveBeenCalledTimes(1)
    const sentMessage = (mockSend.mock.calls[0] as [string, Record<string, unknown>])[1]
    expect(sentMessage.jobUrl).toBe(VALID_JOB.url)

    // Ashby jobs are logged as needs_manual
    expect(mockLogBotActivity).toHaveBeenCalled()
    expect(mockCreateApplicationFromBot).toHaveBeenCalled()
  })

  it('returns 400 when more than 50 jobs are submitted', async () => {
    const jobs = Array.from({ length: 51 }, (_, i) => ({
      url: `https://jobs.lever.co/acme/${i}`,
      company: `Co${i}`,
      role: 'Designer',
    }))
    const req = createMockReq({ jobs, userId: 'user-abc-123' })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    const body = res._json as { error: string }
    expect(body.error).toMatch(/too many|max/i)
    expect(mockCreateBotRun).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns 405 for non-POST methods', async () => {
    const req = createMockReq({}, 'GET')
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(405)
    expect(mockCreateBotRun).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('returns 400 when body is not an object', async () => {
    const req = createMockReq(null)
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    expect(mockCreateBotRun).not.toHaveBeenCalled()
  })

  it('returns 400 when a job has an empty-string url', async () => {
    const req = createMockReq({
      jobs: [{ url: '', company: 'Acme', role: 'Designer' }],
      userId: 'user-abc-123',
    })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    const body = res._json as { error: string }
    expect(body.error).toMatch(/url/i)
  })

  it('forwards jdKeywords and matchScore into the queue message', async () => {
    const req = createMockReq({
      jobs: [VALID_JOB],
      userId: 'user-abc-123',
      userProfile: { name: 'Florian', email: 'florian@example.com' },
    })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    const [, message] = mockSend.mock.calls[0] as [string, Record<string, unknown>]
    expect(message.matchScore).toBe(82)
    expect(message.jdKeywords).toEqual(['figma', 'design system'])
    expect(message.userProfile).toEqual({
      name: 'Florian',
      email: 'florian@example.com',
    })
  })
})
