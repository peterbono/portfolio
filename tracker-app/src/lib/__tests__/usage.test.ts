import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks (must be declared before imports) ─────────────────────────
const mockGetSession = vi.fn()
vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}))

import {
  getCurrentUsage,
  invalidateUsageCache,
} from '../billing'
import type { UsageResponse } from '../billing'

// ═══════════════════════════════════════════════════════════════════════
//  getCurrentUsage — client-side function
// ═══════════════════════════════════════════════════════════════════════

describe('getCurrentUsage', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockGetSession.mockReset()
    invalidateUsageCache()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns zeros when not authenticated (no session)', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } })

    const result = await getCurrentUsage()
    expect(result).toEqual({ applies: 0, coverLetters: 0 })
  })

  it('fetches from /api/usage with auth token', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'test-token-abc' } },
    })

    const mockResponse: UsageResponse = {
      applies: 12,
      coverLetters: 3,
      periodStart: '2026-03-01T00:00:00.000Z',
      periodEnd: '2026-04-01T00:00:00.000Z',
    }

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    })
    globalThis.fetch = fetchSpy

    const result = await getCurrentUsage()

    expect(fetchSpy).toHaveBeenCalledWith('/api/usage', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer test-token-abc',
      },
    })
    expect(result.applies).toBe(12)
    expect(result.coverLetters).toBe(3)
    expect(result.periodStart).toBe('2026-03-01T00:00:00.000Z')
  })

  it('returns fallback zeros on API error (non-ok response)', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
    })

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal server error' }),
    })

    const result = await getCurrentUsage()
    expect(result).toEqual({ applies: 0, coverLetters: 0 })
  })

  it('returns fallback zeros on network error', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
    })

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const result = await getCurrentUsage()
    expect(result).toEqual({ applies: 0, coverLetters: 0 })
  })

  it('caches result and does not re-fetch within 5 minutes', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
    })

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ applies: 5, coverLetters: 2 }),
    })
    globalThis.fetch = fetchSpy

    // First call — fetches from API
    const result1 = await getCurrentUsage()
    expect(result1.applies).toBe(5)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Second call — should use cache
    const result2 = await getCurrentUsage()
    expect(result2.applies).toBe(5)
    expect(fetchSpy).toHaveBeenCalledTimes(1) // Still 1, not 2
  })

  it('re-fetches after cache invalidation', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
    })

    let callCount = 0
    const fetchSpy = vi.fn().mockImplementation(() => {
      callCount++
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          applies: callCount === 1 ? 5 : 10,
          coverLetters: callCount === 1 ? 2 : 4,
        }),
      })
    })
    globalThis.fetch = fetchSpy

    // First call
    const result1 = await getCurrentUsage()
    expect(result1.applies).toBe(5)

    // Invalidate and re-fetch
    invalidateUsageCache()
    const result2 = await getCurrentUsage()
    expect(result2.applies).toBe(10)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('returns stale cache on API error after successful fetch', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
    })

    // First call succeeds
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ applies: 7, coverLetters: 1 }),
    })
    const result1 = await getCurrentUsage()
    expect(result1.applies).toBe(7)

    // Invalidate cache, then API fails
    invalidateUsageCache()
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))
    const result2 = await getCurrentUsage()
    // Should return zeros because cache was invalidated (no stale cache)
    expect(result2).toEqual({ applies: 0, coverLetters: 0 })
  })

  it('returns stale cache on non-ok response when stale cache exists', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
    })

    // First call succeeds and populates cache
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ applies: 15, coverLetters: 5 }),
    })
    await getCurrentUsage()

    // Invalidate cache so it re-fetches, but this time the API returns error
    invalidateUsageCache()
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    })
    const result = await getCurrentUsage()
    // After invalidation, _usageCache is null, so fallback is zeros
    expect(result).toEqual({ applies: 0, coverLetters: 0 })
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  /api/usage handler — server-side
// ═══════════════════════════════════════════════════════════════════════

// Mock Supabase createClient for the API route
const mockFrom = vi.fn()
const mockAuth = { getUser: vi.fn() }
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (...args: unknown[]) => mockFrom(...args),
    auth: mockAuth,
  }),
}))

// Import handler after mocks
import handler from '../../../api/usage'
import type { VercelRequest, VercelResponse } from '@vercel/node'

function createMockReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'GET',
    headers: {
      authorization: 'Bearer valid-token',
    },
    ...overrides,
  } as unknown as VercelRequest
}

function createMockRes(): VercelResponse & { _status: number; _json: unknown; _headers: Record<string, string> } {
  const res = {
    _status: 0,
    _json: null as unknown,
    _headers: {} as Record<string, string>,
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
      return res
    },
  }
  return res as unknown as VercelResponse & { _status: number; _json: unknown; _headers: Record<string, string> }
}

describe('/api/usage handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set env vars
    process.env.VITE_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
  })

  afterEach(() => {
    delete process.env.VITE_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  it('returns 405 for non-GET methods', async () => {
    const req = createMockReq({ method: 'POST' })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(405)
    expect(res._json).toEqual({ error: 'Method not allowed' })
  })

  it('returns 200 for OPTIONS (CORS preflight)', async () => {
    const req = createMockReq({ method: 'OPTIONS' })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
  })

  it('returns 401 when no auth header is provided', async () => {
    mockAuth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } })

    const req = createMockReq({ headers: {} as Record<string, string> })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(401)
  })

  it('returns 401 when auth token is invalid', async () => {
    mockAuth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid token' } })

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(401)
  })

  it('returns usage counts from bot_runs + applications tables', async () => {
    mockAuth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@test.com' } },
      error: null,
    })

    // Mock bot_runs query chain
    const botRunsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockResolvedValue({
        data: [
          { jobs_applied: 5, created_at: '2026-03-15T00:00:00Z' },
          { jobs_applied: 3, created_at: '2026-03-20T00:00:00Z' },
        ],
        error: null,
      }),
    }

    // Mock applications query chain (for cover letters)
    const applicationsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockResolvedValue({
        count: 4,
        error: null,
      }),
    }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bot_runs') return botRunsChain
      if (table === 'applications') return applicationsChain
      return botRunsChain
    })

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    const json = res._json as UsageResponse
    expect(json.applies).toBe(8) // 5 + 3
    expect(json.coverLetters).toBe(4)
    expect(json.periodStart).toBeDefined()
    expect(json.periodEnd).toBeDefined()
  })

  it('falls back to applications table when bot_runs query fails', async () => {
    mockAuth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@test.com' } },
      error: null,
    })

    // bot_runs fails
    const botRunsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'relation "bot_runs" does not exist' },
      }),
    }

    // applications succeeds
    let applicationsCallCount = 0
    const applicationsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lt: vi.fn().mockImplementation(() => {
        applicationsCallCount++
        // First call = applies (not applied_at is null), second = cover letters
        return Promise.resolve({
          count: applicationsCallCount === 1 ? 10 : 6,
          error: null,
        })
      }),
    }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bot_runs') return botRunsChain
      return applicationsChain
    })

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    const json = res._json as UsageResponse
    expect(json.applies).toBe(10)
    expect(json.coverLetters).toBe(6)
  })

  it('returns 500 when Supabase env vars are not set', async () => {
    delete process.env.VITE_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(500)
    expect(res._json).toEqual({ error: 'Server configuration error' })
  })
})
