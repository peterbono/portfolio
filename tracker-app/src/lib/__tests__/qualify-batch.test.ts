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

// Mock qualifier-core (avoid real Anthropic API calls)
const mockBuildSystemPrompt = vi.fn().mockReturnValue('system prompt')
const mockBuildUserMessage = vi.fn().mockReturnValue('user message')
const mockCallHaikuQualifier = vi.fn()

vi.mock('../../../src/bot/qualifier-core', () => ({
  buildSystemPrompt: (...args: unknown[]) => mockBuildSystemPrompt(...args),
  buildUserMessage: (...args: unknown[]) => mockBuildUserMessage(...args),
  callHaikuQualifier: (...args: unknown[]) => mockCallHaikuQualifier(...args),
}))

// ---------------------------------------------------------------------------
// Import handler after mocks
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
          description: 'We need a senior product designer with Figma expertise.',
        },
      ],
      profile: { firstName: 'Florian', lastName: 'Gouloubi', yearsExperience: 7 },
      searchContext: { keywords: ['Product Designer'], remoteOnly: true },
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

const SUCCESSFUL_QUALIFY_RESULT = {
  score: 82,
  dimensions: { roleRelevance: 90, seniorityFit: 80, locationFit: 85, salaryFit: 70, skillsOverlap: 85 },
  archetype: 'product-design',
  jdKeywords: ['figma', 'design system', 'prototyping'],
  isDesignRole: true,
  seniorityMatch: true,
  locationCompatible: true,
  salaryInRange: true,
  skillsMatch: true,
  reasoning: 'Strong match for senior product designer role.',
  coverLetterSnippet: 'With 7+ years of experience in product design...',
}

function setupDefaultMocks(planTier = 'pro', todayCount = 0) {
  // Auth
  mockAuth.getUser.mockResolvedValue({
    data: { user: { id: 'user-test-123' } },
    error: null,
  })

  // Supabase queries
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

  // Qualifier success
  mockCallHaikuQualifier.mockResolvedValue(SUCCESSFUL_QUALIFY_RESULT)
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  process.env.VITE_SUPABASE_URL = 'https://test.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
  setupDefaultMocks()
})

afterEach(() => {
  delete process.env.VITE_SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  delete process.env.ANTHROPIC_API_KEY
})

// ═══════════════════════════════════════════════════════════════════════════
//  HTTP Method Handling
// ═══════════════════════════════════════════════════════════════════════════

describe('/api/qualify-batch — HTTP methods', () => {
  it('returns 200 for OPTIONS (CORS preflight)', async () => {
    const req = createMockReq({ method: 'OPTIONS' })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    expect(res._ended).toBe(true)
  })

  it('returns 405 for GET requests', async () => {
    const req = createMockReq({ method: 'GET' })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(405)
    expect(res._json).toEqual({ error: 'POST only' })
  })

  it('returns 405 for PUT requests', async () => {
    const req = createMockReq({ method: 'PUT' })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(405)
  })

  it('sets CORS headers on POST responses', async () => {
    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._headers['Access-Control-Allow-Origin']).toBe('*')
    expect(res._headers['Access-Control-Allow-Methods']).toBe('POST, OPTIONS')
    expect(res._headers['Access-Control-Allow-Headers']).toBe('Content-Type, Authorization')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//  Authentication
// ═══════════════════════════════════════════════════════════════════════════

describe('/api/qualify-batch — authentication', () => {
  it('returns 401 when no Authorization header is provided', async () => {
    mockAuth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'missing token' } })

    const req = createMockReq({ headers: { 'content-type': 'application/json' } as Record<string, string> })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(401)
    const json = res._json as Record<string, unknown>
    expect(json.error).toContain('Unauthorized')
  })

  it('returns 401 when token is invalid', async () => {
    mockAuth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid token' } })

    const req = createMockReq({
      headers: { authorization: 'Bearer invalid-token', 'content-type': 'application/json' } as Record<string, string>,
    })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(401)
  })

  it('returns 401 when Authorization header has wrong format', async () => {
    const req = createMockReq({
      headers: { authorization: 'Basic dXNlcjpwYXNz', 'content-type': 'application/json' } as Record<string, string>,
    })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(401)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//  Server Configuration
// ═══════════════════════════════════════════════════════════════════════════

describe('/api/qualify-batch — server configuration', () => {
  it('returns 500 when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(500)
    const json = res._json as Record<string, unknown>
    expect(json.error).toContain('not configured')
  })

  it('returns 500 when Supabase env vars are not set', async () => {
    delete process.env.VITE_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(500)
    const json = res._json as Record<string, unknown>
    expect(json.error).toContain('not configured')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//  Request Validation
// ═══════════════════════════════════════════════════════════════════════════

describe('/api/qualify-batch — request validation', () => {
  it('returns 400 when body is empty', async () => {
    const req = createMockReq({ body: null } as Partial<VercelRequest>)
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    const json = res._json as Record<string, unknown>
    expect(json.error).toContain('body required')
  })

  it('returns 400 when jobs array is missing', async () => {
    const req = createMockReq({ body: { profile: {} } } as Partial<VercelRequest>)
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    const json = res._json as Record<string, unknown>
    expect(json.error).toContain('jobs array required')
  })

  it('returns 400 when jobs array is empty', async () => {
    const req = createMockReq({
      body: { jobs: [], profile: {} },
    } as Partial<VercelRequest>)
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    const json = res._json as Record<string, unknown>
    expect(json.error).toContain('must not be empty')
  })

  it('returns 400 when too many jobs (>10)', async () => {
    const tooManyJobs = Array.from({ length: 11 }, (_, i) => ({
      id: `job-${i}`,
      title: 'Designer',
      company: 'Corp',
      location: 'Remote',
      description: 'Design work',
    }))

    const req = createMockReq({
      body: { jobs: tooManyJobs, profile: {} },
    } as Partial<VercelRequest>)
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    const json = res._json as Record<string, unknown>
    expect(json.error).toContain('Too many jobs')
    expect(json.error).toContain('max 10')
  })

  it('returns 400 when job is missing id', async () => {
    const req = createMockReq({
      body: {
        jobs: [{ title: 'Designer', company: 'Corp', description: 'Work' }],
        profile: {},
      },
    } as Partial<VercelRequest>)
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    const json = res._json as Record<string, unknown>
    expect(json.error).toContain('jobs[0].id')
  })

  it('returns 400 when job description is empty', async () => {
    const req = createMockReq({
      body: {
        jobs: [{ id: 'j1', title: 'Designer', company: 'Corp', description: '' }],
        profile: {},
      },
    } as Partial<VercelRequest>)
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    const json = res._json as Record<string, unknown>
    expect(json.error).toContain('description')
  })

  it('accepts request with 10 valid jobs (max batch size)', async () => {
    const maxJobs = Array.from({ length: 10 }, (_, i) => ({
      id: `job-${i}`,
      title: 'Product Designer',
      company: `Corp ${i}`,
      location: 'Remote',
      description: 'Design systems and product interfaces.',
    }))

    const req = createMockReq({
      body: { jobs: maxJobs, profile: {}, searchContext: {} },
    } as Partial<VercelRequest>)
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    const json = res._json as Record<string, unknown>
    const meta = json.meta as Record<string, unknown>
    expect(meta.processed).toBe(10)
  })

  it('truncates job descriptions exceeding 8000 chars', async () => {
    const longDescription = 'x'.repeat(10000)

    const req = createMockReq({
      body: {
        jobs: [{ id: 'j1', title: 'Designer', company: 'Corp', location: 'Remote', description: longDescription }],
        profile: {},
      },
    } as Partial<VercelRequest>)
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    // Verify the user message was built (which means description was processed, not rejected)
    expect(mockBuildUserMessage).toHaveBeenCalled()
  })

  it('accepts request with optional profile and searchContext', async () => {
    const req = createMockReq({
      body: {
        jobs: [{ id: 'j1', title: 'Designer', company: 'Corp', location: 'Remote', description: 'Work' }],
        // No profile or searchContext
      },
    } as Partial<VercelRequest>)
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//  Rate Limit Enforcement
// ═══════════════════════════════════════════════════════════════════════════

describe('/api/qualify-batch — rate limiting', () => {
  it('returns 429 when daily limit is reached', async () => {
    setupDefaultMocks('starter', 100) // starter limit = 100, used = 100

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(429)
    const json = res._json as Record<string, unknown>
    expect(json.error).toContain('Daily qualification limit reached')
    expect(json.limit).toBe(100)
    expect(json.used).toBe(100)
    expect(json.plan).toBe('starter')
  })

  it('returns 429 with correct info for free plan', async () => {
    setupDefaultMocks('free', 0) // free limit = 0

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(429)
    const json = res._json as Record<string, unknown>
    expect(json.limit).toBe(0)
    expect(json.plan).toBe('free')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//  Successful Qualification
// ═══════════════════════════════════════════════════════════════════════════

describe('/api/qualify-batch — successful qualification', () => {
  it('returns qualification results for a single job', async () => {
    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    const json = res._json as Record<string, unknown>
    const results = json.results as Array<Record<string, unknown>>
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('job-1')
    expect(results[0].score).toBe(82)
    expect(results[0].isDesignRole).toBe(true)
    expect(results[0].reasoning).toContain('Strong match')
    expect(results[0].coverLetterSnippet).toContain('7+ years')
    expect(results[0].error).toBeUndefined()
  })

  it('qualifies multiple jobs in parallel', async () => {
    const jobs = [
      { id: 'j1', title: 'Product Designer', company: 'A', location: 'Remote', description: 'Design work' },
      { id: 'j2', title: 'UX Designer', company: 'B', location: 'Singapore', description: 'UX work' },
      { id: 'j3', title: 'Design Lead', company: 'C', location: 'Bangkok', description: 'Lead design' },
    ]

    const req = createMockReq({
      body: { jobs, profile: {}, searchContext: {} },
    } as Partial<VercelRequest>)
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    // callHaikuQualifier should be called for each job
    expect(mockCallHaikuQualifier).toHaveBeenCalledTimes(3)

    const json = res._json as Record<string, unknown>
    const results = json.results as Array<Record<string, unknown>>
    expect(results).toHaveLength(3)
    expect(results.map(r => r.id)).toEqual(['j1', 'j2', 'j3'])
  })

  it('passes profile to buildSystemPrompt', async () => {
    const req = createMockReq({
      body: {
        jobs: [{ id: 'j1', title: 'Designer', company: 'A', location: 'Remote', description: 'Work' }],
        profile: { firstName: 'Florian', yearsExperience: 7 },
      },
    } as Partial<VercelRequest>)
    const res = createMockRes()

    await handler(req, res)

    expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Florian', yearsExperience: 7 }),
    )
  })

  it('passes searchContext to buildUserMessage', async () => {
    const req = createMockReq({
      body: {
        jobs: [{ id: 'j1', title: 'Designer', company: 'A', location: 'Remote', description: 'Work' }],
        profile: {},
        searchContext: { keywords: ['UX Designer'], remoteOnly: true, minSalary: 80000 },
      },
    } as Partial<VercelRequest>)
    const res = createMockRes()

    await handler(req, res)

    expect(mockBuildUserMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        keywords: ['UX Designer'],
        remoteOnly: true,
        minSalary: 80000,
      }),
    )
  })

  it('response meta contains latency, averages, and plan info', async () => {
    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    const json = res._json as Record<string, unknown>
    const meta = json.meta as Record<string, unknown>

    expect(meta.processed).toBe(1)
    expect(meta.total).toBe(1)
    expect(meta.succeeded).toBe(1)
    expect(meta.failed).toBe(0)
    expect(meta.avgScore).toBe(82)
    expect(meta.latencyMs).toBeGreaterThanOrEqual(0)
    expect(meta.plan).toBe('pro')
    expect(meta.dailyLimit).toBe(300)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//  Partial Batch Failure Handling
// ═══════════════════════════════════════════════════════════════════════════

describe('/api/qualify-batch — partial batch failures', () => {
  it('returns partial results when some jobs fail', async () => {
    let callIdx = 0
    mockCallHaikuQualifier.mockImplementation(() => {
      callIdx++
      if (callIdx === 2) {
        // Second job fails
        return Promise.reject(new Error('Anthropic API timeout'))
      }
      return Promise.resolve(SUCCESSFUL_QUALIFY_RESULT)
    })

    const jobs = [
      { id: 'j1', title: 'Designer', company: 'A', location: 'Remote', description: 'Work A' },
      { id: 'j2', title: 'UX Lead', company: 'B', location: 'Remote', description: 'Work B' },
      { id: 'j3', title: 'Staff', company: 'C', location: 'Remote', description: 'Work C' },
    ]

    const req = createMockReq({
      body: { jobs, profile: {}, searchContext: {} },
    } as Partial<VercelRequest>)
    const res = createMockRes()

    await handler(req, res)

    // Should still return 200 (partial success)
    expect(res._status).toBe(200)

    const json = res._json as Record<string, unknown>
    const results = json.results as Array<Record<string, unknown>>
    expect(results).toHaveLength(3)

    // First and third should succeed
    expect(results[0].score).toBe(82)
    expect(results[0].error).toBeUndefined()

    // Second should have error fallback
    expect(results[1].error).toContain('Anthropic API timeout')
    expect(results[1].score).toBe(35) // conservative fallback score
    expect(results[1].reasoning).toContain('Qualification failed')

    // Third should succeed
    expect(results[2].score).toBe(82)
    expect(results[2].error).toBeUndefined()

    // Meta should reflect partial failure
    const meta = json.meta as Record<string, unknown>
    expect(meta.succeeded).toBe(2)
    expect(meta.failed).toBe(1)
  })

  it('returns all-error results when all jobs fail', async () => {
    mockCallHaikuQualifier.mockRejectedValue(new Error('Service unavailable'))

    const jobs = [
      { id: 'j1', title: 'Designer', company: 'A', location: 'Remote', description: 'Work' },
      { id: 'j2', title: 'UX Lead', company: 'B', location: 'Remote', description: 'Work' },
    ]

    const req = createMockReq({
      body: { jobs, profile: {}, searchContext: {} },
    } as Partial<VercelRequest>)
    const res = createMockRes()

    await handler(req, res)

    // Still returns 200 — errors are per-job, not request-level
    expect(res._status).toBe(200)

    const json = res._json as Record<string, unknown>
    const results = json.results as Array<Record<string, unknown>>
    expect(results).toHaveLength(2)
    expect(results[0].error).toContain('Service unavailable')
    expect(results[1].error).toContain('Service unavailable')
    expect(results[0].score).toBe(35) // conservative fallback
    expect(results[1].score).toBe(35)

    const meta = json.meta as Record<string, unknown>
    expect(meta.succeeded).toBe(0)
    expect(meta.failed).toBe(2)
    expect(meta.avgScore).toBe(0) // no successes = avg 0
  })

  it('does not increment usage when all jobs fail', async () => {
    mockCallHaikuQualifier.mockRejectedValue(new Error('All fail'))

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    // RPC should NOT be called because successCount = 0
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('only increments usage for successfully qualified jobs', async () => {
    let callIdx = 0
    mockCallHaikuQualifier.mockImplementation(() => {
      callIdx++
      if (callIdx === 2) {
        return Promise.reject(new Error('timeout'))
      }
      return Promise.resolve(SUCCESSFUL_QUALIFY_RESULT)
    })

    const jobs = [
      { id: 'j1', title: 'Designer', company: 'A', location: 'Remote', description: 'Work A' },
      { id: 'j2', title: 'UX Lead', company: 'B', location: 'Remote', description: 'Work B' },
      { id: 'j3', title: 'Staff', company: 'C', location: 'Remote', description: 'Work C' },
    ]

    const req = createMockReq({
      body: { jobs, profile: {}, searchContext: {} },
    } as Partial<VercelRequest>)
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    // Should only count 2 successes (j1 and j3), not the failed j2
    expect(mockRpc).toHaveBeenCalledWith('increment_qualification_usage', {
      p_user_id: 'user-test-123',
      p_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      p_count: 2, // 2 out of 3 succeeded
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//  Error fallback shape
// ═══════════════════════════════════════════════════════════════════════════

describe('/api/qualify-batch — error fallback result shape', () => {
  it('failed jobs have consistent shape with isDesignRole=true fallback', async () => {
    mockCallHaikuQualifier.mockRejectedValue(new Error('API error'))

    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    const json = res._json as Record<string, unknown>
    const results = json.results as Array<Record<string, unknown>>
    const failedResult = results[0]

    expect(failedResult.id).toBe('job-1')
    expect(failedResult.score).toBe(35)
    expect(failedResult.isDesignRole).toBe(true)
    expect(failedResult.seniorityMatch).toBe(false)
    expect(failedResult.locationCompatible).toBe(false)
    expect(failedResult.salaryInRange).toBe(true)
    expect(failedResult.skillsMatch).toBe(false)
    expect(failedResult.reasoning).toContain('Qualification failed')
    expect(failedResult.coverLetterSnippet).toBe('')
    expect(failedResult.error).toContain('API error')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//  callHaikuQualifier integration
// ═══════════════════════════════════════════════════════════════════════════

describe('/api/qualify-batch — qualifier configuration', () => {
  it('calls callHaikuQualifier with 8s timeout and no retry', async () => {
    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    expect(mockCallHaikuQualifier).toHaveBeenCalledWith(
      'system prompt',
      'user message',
      {
        timeoutMs: 8_000,
        retryOn500: false,
        maxTokens: 800,
      },
    )
  })

  it('builds user message with company/role context header', async () => {
    const req = createMockReq()
    const res = createMockRes()

    await handler(req, res)

    const userMsgArg = mockBuildUserMessage.mock.calls[0][0] as string
    expect(userMsgArg).toContain('Company: Acme Corp')
    expect(userMsgArg).toContain('Role: Product Designer')
    expect(userMsgArg).toContain('Location: Remote')
    expect(userMsgArg).toContain('Figma expertise')
  })
})
