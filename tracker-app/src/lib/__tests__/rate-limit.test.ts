import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

const mockFrom = vi.fn()
const mockRpc = vi.fn()
const mockAuth = { getUser: vi.fn() }

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: mockAuth,
  }),
}))

// ---------------------------------------------------------------------------
// Module under test — rate-limit logic extracted from qualify-batch.ts
// Since rate-limit.ts doesn't exist yet, we test the rate-limiting logic
// as it currently lives inside qualify-batch.ts by importing the handler
// and exercising the rate-limit paths end-to-end.
// ---------------------------------------------------------------------------

import handler from '../../../api/qualify-batch'
import type { VercelRequest, VercelResponse } from '@vercel/node'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'POST',
    headers: {
      authorization: 'Bearer valid-token',
      'content-type': 'application/json',
    },
    body: {
      jobs: [
        {
          id: 'job-1',
          title: 'Product Designer',
          company: 'Acme Corp',
          location: 'Remote',
          description: 'We are looking for a senior product designer to join our team.',
        },
      ],
      profile: { firstName: 'Florian', lastName: 'Gouloubi' },
      searchContext: { keywords: ['Product Designer'] },
    },
    ...overrides,
  } as unknown as VercelRequest
}

function createMockRes(): VercelResponse & {
  _status: number
  _json: unknown
  _headers: Record<string, string>
  _ended: boolean
} {
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
  return res as unknown as VercelResponse & {
    _status: number
    _json: unknown
    _headers: Record<string, string>
    _ended: boolean
  }
}

// Mock qualifier-core to avoid real Anthropic calls
vi.mock('../../../src/bot/qualifier-core', () => ({
  buildSystemPrompt: vi.fn().mockReturnValue('system prompt'),
  buildUserMessage: vi.fn().mockReturnValue('user message'),
  callHaikuQualifier: vi.fn().mockResolvedValue({
    score: 78,
    dimensions: { roleRelevance: 80, seniorityFit: 75, locationFit: 80, salaryFit: 70, skillsOverlap: 85 },
    archetype: 'product-design' as const,
    jdKeywords: ['figma', 'design system'],
    isDesignRole: true,
    seniorityMatch: true,
    locationCompatible: true,
    salaryInRange: true,
    skillsMatch: true,
    reasoning: 'Good fit for product designer role.',
    coverLetterSnippet: 'I am excited to apply...',
  }),
}))

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()

  // Set required env vars
  process.env.VITE_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'

  // Default: authenticated user
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: 'user-rate-123' } },
    error: null,
  })
})

afterEach(() => {
  delete process.env.VITE_SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  delete process.env.ANTHROPIC_API_KEY
})

// ═══════════════════════════════════════════════════════════════════════════
//  Daily Qualification Limits per Plan Tier
// ═══════════════════════════════════════════════════════════════════════════

describe('Rate Limit — daily qualification caps per plan tier', () => {
  function setupPlanAndUsage(planTier: string, todayCount: number) {
    // Mock profiles table query
    const profileChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { plan_tier: planTier, created_at: '2025-01-01T00:00:00Z' },
        error: null,
      }),
    }

    // Mock qualification_usage table query
    const usageChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { count: todayCount },
        error: null,
      }),
    }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return profileChain
      if (table === 'qualification_usage') return usageChain
      return profileChain
    })

    // Mock usage increment (best-effort, don't fail)
    mockRpc.mockResolvedValue({ error: null })
  }

  // ─── Free tier (limit: 0) ──────────────────────────────────────────

  it('blocks free tier users (limit = 0)', async () => {
    setupPlanAndUsage('free', 0)

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(429)
    const json = res._json as Record<string, unknown>
    expect(json.error).toContain('Daily qualification limit reached')
    expect(json.limit).toBe(0)
    expect(json.plan).toBe('free')
  })

  // ─── Trial tier (limit: 50) ────────────────────────────────────────

  it('allows trial tier users within limit (used 10/50)', async () => {
    // Trial is inferred from free plan + recent account creation
    const profileChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          plan_tier: 'free',
          created_at: new Date().toISOString(), // Created today = trial active
        },
        error: null,
      }),
    }

    const usageChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { count: 10 },
        error: null,
      }),
    }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return profileChain
      if (table === 'qualification_usage') return usageChain
      return profileChain
    })
    mockRpc.mockResolvedValue({ error: null })

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    const json = res._json as Record<string, unknown>
    const meta = json.meta as Record<string, unknown>
    expect(meta.plan).toBe('trial')
  })

  it('blocks trial tier when limit reached (used 50/50)', async () => {
    const profileChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          plan_tier: 'free',
          created_at: new Date().toISOString(), // trial active
        },
        error: null,
      }),
    }

    const usageChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { count: 50 },
        error: null,
      }),
    }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return profileChain
      if (table === 'qualification_usage') return usageChain
      return profileChain
    })

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(429)
    const json = res._json as Record<string, unknown>
    expect(json.limit).toBe(50)
    expect(json.plan).toBe('trial')
  })

  // ─── Starter tier (limit: 100) ────────────────────────────────────

  it('allows starter tier within limit (used 50/100)', async () => {
    setupPlanAndUsage('starter', 50)

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    const json = res._json as Record<string, unknown>
    const meta = json.meta as Record<string, unknown>
    expect(meta.plan).toBe('starter')
    expect(meta.dailyLimit).toBe(100)
  })

  it('blocks starter tier when limit reached (used 100/100)', async () => {
    setupPlanAndUsage('starter', 100)

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(429)
    const json = res._json as Record<string, unknown>
    expect(json.limit).toBe(100)
    expect(json.plan).toBe('starter')
  })

  // ─── Pro tier (limit: 300) ────────────────────────────────────────

  it('allows pro tier within limit (used 200/300)', async () => {
    setupPlanAndUsage('pro', 200)

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    const json = res._json as Record<string, unknown>
    const meta = json.meta as Record<string, unknown>
    expect(meta.plan).toBe('pro')
    expect(meta.dailyLimit).toBe(300)
  })

  it('blocks pro tier when limit reached (used 300/300)', async () => {
    setupPlanAndUsage('pro', 300)

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(429)
    const json = res._json as Record<string, unknown>
    expect(json.limit).toBe(300)
  })

  // ─── Boost tier (limit: 1000) ──────────────────────────────────────

  it('allows boost tier within limit (used 999/1000)', async () => {
    setupPlanAndUsage('boost', 999)

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    const json = res._json as Record<string, unknown>
    const meta = json.meta as Record<string, unknown>
    expect(meta.plan).toBe('boost')
    expect(meta.dailyLimit).toBe(1000)
  })

  it('blocks boost tier when limit reached (used 1000/1000)', async () => {
    setupPlanAndUsage('boost', 1000)

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(429)
    const json = res._json as Record<string, unknown>
    expect(json.limit).toBe(1000)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//  Usage Increment
// ═══════════════════════════════════════════════════════════════════════════

describe('Rate Limit — usage increment after successful qualification', () => {
  function setupSuccessPath(planTier: string, todayCount: number) {
    const profileChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { plan_tier: planTier, created_at: '2025-01-01T00:00:00Z' },
        error: null,
      }),
    }

    const usageChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { count: todayCount },
        error: null,
      }),
    }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return profileChain
      if (table === 'qualification_usage') return usageChain
      return profileChain
    })

    mockRpc.mockResolvedValue({ error: null })
  }

  it('calls RPC to increment usage after successful qualification', async () => {
    setupSuccessPath('pro', 10)

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    // RPC should be called with increment_qualification_usage
    expect(mockRpc).toHaveBeenCalledWith('increment_qualification_usage', {
      p_user_id: 'user-rate-123',
      p_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      p_count: 1, // 1 job in request
    })
  })

  it('increments usage by the number of successfully qualified jobs', async () => {
    setupSuccessPath('pro', 10)

    const req = createMockReq({
      body: {
        jobs: [
          { id: 'j1', title: 'Designer', company: 'A', location: 'Remote', description: 'Design stuff' },
          { id: 'j2', title: 'UX Lead', company: 'B', location: 'Remote', description: 'Lead UX team' },
          { id: 'j3', title: 'Staff Designer', company: 'C', location: 'Remote', description: 'Staff design' },
        ],
        profile: {},
        searchContext: {},
      },
    } as Partial<VercelRequest>)
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    expect(mockRpc).toHaveBeenCalledWith('increment_qualification_usage', {
      p_user_id: 'user-rate-123',
      p_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      p_count: 3,
    })
  })

  it('does not fail the response when usage tracking RPC errors', async () => {
    setupSuccessPath('pro', 10)

    // RPC fails — should not affect the 200 response
    mockRpc.mockResolvedValue({ error: { message: 'RPC not found' } })

    // Also need to mock the upsert fallback
    const upsertChain = {
      upsert: vi.fn().mockResolvedValue({ error: { message: 'table not found' } }),
    }
    const originalMockFrom = mockFrom.getMockImplementation()
    mockFrom.mockImplementation((table: string) => {
      if (table === 'qualification_usage' && !mockFrom.mock.calls.some(c => c[0] === 'profiles')) {
        return upsertChain
      }
      return originalMockFrom?.(table) || { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    // Should still succeed — usage tracking is best-effort
    expect(res._status).toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//  Rate Limit — jobs capping when near limit
// ═══════════════════════════════════════════════════════════════════════════

describe('Rate Limit — caps jobs when near daily limit', () => {
  it('processes only remaining quota when batch exceeds limit', async () => {
    // Starter plan: 100 limit, already used 98 → only 2 remaining
    const profileChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { plan_tier: 'starter', created_at: '2025-01-01T00:00:00Z' },
        error: null,
      }),
    }

    const usageChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { count: 98 },
        error: null,
      }),
    }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return profileChain
      if (table === 'qualification_usage') return usageChain
      return profileChain
    })
    mockRpc.mockResolvedValue({ error: null })

    const req = createMockReq({
      body: {
        jobs: [
          { id: 'j1', title: 'Designer', company: 'A', location: 'Remote', description: 'Design stuff' },
          { id: 'j2', title: 'UX Lead', company: 'B', location: 'Remote', description: 'Lead UX' },
          { id: 'j3', title: 'Staff', company: 'C', location: 'Remote', description: 'Staff design' },
          { id: 'j4', title: 'Lead', company: 'D', location: 'Remote', description: 'Lead design' },
          { id: 'j5', title: 'Principal', company: 'E', location: 'Remote', description: 'Principal design' },
        ],
        profile: {},
        searchContext: {},
      },
    } as Partial<VercelRequest>)
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    const json = res._json as Record<string, unknown>
    const meta = json.meta as Record<string, unknown>
    expect(meta.total).toBe(5) // 5 requested
    expect(meta.processed).toBe(2) // only 2 remaining quota
    expect(meta.capped).toBe(true)
  })

  it('returns capped: false when all jobs fit within quota', async () => {
    const profileChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { plan_tier: 'pro', created_at: '2025-01-01T00:00:00Z' },
        error: null,
      }),
    }

    const usageChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { count: 10 },
        error: null,
      }),
    }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return profileChain
      if (table === 'qualification_usage') return usageChain
      return profileChain
    })
    mockRpc.mockResolvedValue({ error: null })

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    const json = res._json as Record<string, unknown>
    const meta = json.meta as Record<string, unknown>
    expect(meta.capped).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//  Rate Limit — unknown plan tier fallback
// ═══════════════════════════════════════════════════════════════════════════

describe('Rate Limit — unknown plan tier defaults to free limits', () => {
  it('blocks requests when plan tier is unrecognized (defaults to free = 0)', async () => {
    const profileChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { plan_tier: 'enterprise_custom', created_at: '2025-01-01T00:00:00Z' },
        error: null,
      }),
    }

    const usageChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { count: 0 },
        error: null,
      }),
    }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return profileChain
      if (table === 'qualification_usage') return usageChain
      return profileChain
    })

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(429)
    const json = res._json as Record<string, unknown>
    expect(json.limit).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//  Rate Limit — qualification_usage table missing (graceful fallback)
// ═══════════════════════════════════════════════════════════════════════════

describe('Rate Limit — graceful fallback when usage table missing', () => {
  it('returns count 0 when qualification_usage table does not exist', async () => {
    const profileChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { plan_tier: 'pro', created_at: '2025-01-01T00:00:00Z' },
        error: null,
      }),
    }

    // Table does not exist — error on query
    const usageChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'relation "qualification_usage" does not exist' },
      }),
    }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return profileChain
      if (table === 'qualification_usage') return usageChain
      return profileChain
    })
    mockRpc.mockResolvedValue({ error: null })

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    // Should still succeed — table missing means count = 0 (no rate limiting)
    expect(res._status).toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//  Rate Limit response meta includes usage info
// ═══════════════════════════════════════════════════════════════════════════

describe('Rate Limit — response meta includes usage tracking', () => {
  it('includes dailyUsed, dailyLimit, dailyRemaining in response meta', async () => {
    const profileChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { plan_tier: 'pro', created_at: '2025-01-01T00:00:00Z' },
        error: null,
      }),
    }

    const usageChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { count: 42 },
        error: null,
      }),
    }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return profileChain
      if (table === 'qualification_usage') return usageChain
      return profileChain
    })
    mockRpc.mockResolvedValue({ error: null })

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    const json = res._json as Record<string, unknown>
    const meta = json.meta as Record<string, unknown>
    expect(meta.dailyLimit).toBe(300) // pro plan
    expect(meta.dailyUsed).toBe(43) // 42 + 1 job processed
    expect(meta.dailyRemaining).toBe(257) // 300 - 43
    expect(meta.plan).toBe('pro')
  })
})
