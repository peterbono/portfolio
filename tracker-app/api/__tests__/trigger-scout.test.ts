import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * Tests for api/trigger-scout.ts — the scout-only entry point for the
 * AutopilotView → OpenJobsView "Save & scout" flow.
 *
 * These tests guard the chain:
 *   AutopilotView.handleSave → triggerScout() → /api/trigger-scout
 *     → createBotRun → orchestrator.runPipelineFromInline({skipApply:true})
 *     → { runId, status }
 *
 * Would have caught regressions like:
 *   - Missing userId/keywords validation
 *   - Orchestrator called without skipApply:true (would trigger real applies)
 *   - createBotRun not called (no runId for client to poll)
 *   - Non-POST methods not rejected
 *   - Invalid UUID format accepted
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the handler
// ---------------------------------------------------------------------------

const mockCreateBotRun = vi.fn()
const mockUpdateBotRun = vi.fn().mockResolvedValue(undefined)
const mockLogBotActivity = vi.fn().mockResolvedValue(undefined)
vi.mock('../../src/bot/supabase-server', () => ({
  createBotRun: (...args: unknown[]) => mockCreateBotRun(...args),
  updateBotRun: (...args: unknown[]) => mockUpdateBotRun(...args),
  logBotActivity: (...args: unknown[]) => mockLogBotActivity(...args),
}))
// Also mock the .js specifier because trigger-scout.ts imports via
// '../src/bot/supabase-server.js' (for Node ESM resolution at runtime).
vi.mock('../../src/bot/supabase-server.js', () => ({
  createBotRun: (...args: unknown[]) => mockCreateBotRun(...args),
  updateBotRun: (...args: unknown[]) => mockUpdateBotRun(...args),
  logBotActivity: (...args: unknown[]) => mockLogBotActivity(...args),
}))

// Mock orchestrator — tests MUST NOT actually scrape anything.
const mockRunPipelineFromInline = vi.fn()
vi.mock('../../src/bot/orchestrator', () => ({
  runPipelineFromInline: (...args: unknown[]) => mockRunPipelineFromInline(...args),
}))
vi.mock('../../src/bot/orchestrator.js', () => ({
  runPipelineFromInline: (...args: unknown[]) => mockRunPipelineFromInline(...args),
}))

// Mock playwright so launchScoutBrowser() never actually launches Chromium.
const mockBrowserClose = vi.fn().mockResolvedValue(undefined)
const fakeBrowser = { close: mockBrowserClose } as unknown
vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(async () => fakeBrowser),
    connectOverCDP: vi.fn(async () => fakeBrowser),
  },
}))

// Mock @vercel/functions — the real waitUntil hands the promise off to the
// Vercel runtime (fire-and-forget from the handler's perspective). For tests,
// we want to AWAIT the promise so our assertions on runPipelineFromInline fire
// AFTER the background work completes. Store the latest registered promise
// and expose it for test helpers if needed.
let __waitUntilPending: Promise<unknown> | null = null
vi.mock('@vercel/functions', () => ({
  waitUntil: (promise: Promise<unknown>) => {
    __waitUntilPending = promise
    // Swallow rejections so the test runner doesn't flag unhandled rejections
    // from the background IIFE's .catch path.
    promise.catch(() => {})
  },
}))

/** Await the last waitUntil-registered promise so assertions can run after. */
async function flushWaitUntil() {
  if (__waitUntilPending) {
    try { await __waitUntilPending } catch { /* ignore — tests assert on DB state */ }
    __waitUntilPending = null
  }
}

// ---------------------------------------------------------------------------
// Import handler after mocks
// ---------------------------------------------------------------------------

import handler from '../trigger-scout'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockReq(body: unknown, method = 'POST'): VercelRequest {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body,
    query: {},
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

const VALID_USER_ID = '11111111-2222-3333-4444-555555555555'
const VALID_SEARCH_CONFIG = {
  keywords: ['Senior Product Designer', 'Design Systems Lead'],
  locationRules: [
    { type: 'zone', value: 'Americas', workArrangement: 'remote' },
  ],
  excludedCompanies: [],
  dailyLimit: 20,
}
const VALID_USER_PROFILE = {
  name: 'Florian Gouloubi',
  email: 'florian.gouloubi@gmail.com',
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('api/trigger-scout', () => {
  beforeEach(() => {
    mockCreateBotRun.mockReset()
    mockUpdateBotRun.mockClear()
    mockLogBotActivity.mockClear()
    mockRunPipelineFromInline.mockReset()
    mockBrowserClose.mockClear()

    // Happy-path defaults
    mockCreateBotRun.mockResolvedValue('run-fake-uuid-0001')
    mockRunPipelineFromInline.mockResolvedValue({
      jobsFound: 12,
      jobsQualified: 5,
      duration: 18000,
    })
  })

  it('returns 200 with { runId, status } for a valid POST body', async () => {
    const req = createMockReq({
      userId: VALID_USER_ID,
      searchConfig: VALID_SEARCH_CONFIG,
      userProfile: VALID_USER_PROFILE,
    })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(200)
    const body = res._json as {
      runId: string
      status: string
      jobsFound?: number
      jobsQualified?: number
    }
    expect(body.runId).toBe('run-fake-uuid-0001')
    // status is 'running' before pipeline completes or 'completed' after —
    // whichever contract the handler returns, it should be one of these.
    expect(['running', 'completed']).toContain(body.status)
  })

  it('returns 400 when userId is missing', async () => {
    const req = createMockReq({ searchConfig: VALID_SEARCH_CONFIG })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    const body = res._json as { error: string }
    expect(body.error).toMatch(/userId/i)
    expect(mockCreateBotRun).not.toHaveBeenCalled()
    expect(mockRunPipelineFromInline).not.toHaveBeenCalled()
  })

  it('returns 400 when searchConfig.keywords is empty', async () => {
    const req = createMockReq({
      userId: VALID_USER_ID,
      searchConfig: { ...VALID_SEARCH_CONFIG, keywords: [] },
    })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    const body = res._json as { error: string }
    expect(body.error).toMatch(/keywords/i)
    expect(mockCreateBotRun).not.toHaveBeenCalled()
    expect(mockRunPipelineFromInline).not.toHaveBeenCalled()
  })

  it('returns 400 when userId is not a valid UUID', async () => {
    const req = createMockReq({
      userId: 'not-a-uuid',
      searchConfig: VALID_SEARCH_CONFIG,
    })
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    const body = res._json as { error: string }
    expect(body.error).toMatch(/userId|uuid/i)
    expect(mockCreateBotRun).not.toHaveBeenCalled()
    expect(mockRunPipelineFromInline).not.toHaveBeenCalled()
  })

  it('returns 405 for non-POST methods', async () => {
    const req = createMockReq(
      { userId: VALID_USER_ID, searchConfig: VALID_SEARCH_CONFIG },
      'GET',
    )
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(405)
    expect(mockCreateBotRun).not.toHaveBeenCalled()
    expect(mockRunPipelineFromInline).not.toHaveBeenCalled()
  })

  it('calls createBotRun with the userId before invoking the orchestrator', async () => {
    const req = createMockReq({
      userId: VALID_USER_ID,
      searchConfig: VALID_SEARCH_CONFIG,
      userProfile: VALID_USER_PROFILE,
    })
    const res = createMockRes()

    await handler(req, res)

    expect(mockCreateBotRun).toHaveBeenCalledTimes(1)
    const createArgs = mockCreateBotRun.mock.calls[0] as unknown[]
    // First arg is always userId; second is an optional label/source tag.
    expect(createArgs[0]).toBe(VALID_USER_ID)

    // And it must be called BEFORE the pipeline kicks off.
    if (mockRunPipelineFromInline.mock.invocationCallOrder.length > 0) {
      expect(mockCreateBotRun.mock.invocationCallOrder[0]).toBeLessThan(
        mockRunPipelineFromInline.mock.invocationCallOrder[0],
      )
    }
  })

  it('calls orchestrator.runPipeline with skipApply: true (no real applies)', async () => {
    const req = createMockReq({
      userId: VALID_USER_ID,
      searchConfig: VALID_SEARCH_CONFIG,
      userProfile: VALID_USER_PROFILE,
    })
    const res = createMockRes()

    await handler(req, res)
    // Pipeline now runs in a waitUntil-registered background IIFE — await it
    // so assertions fire after the orchestrator mock has been called.
    await flushWaitUntil()

    expect(mockRunPipelineFromInline).toHaveBeenCalledTimes(1)
    const pipelineArg = mockRunPipelineFromInline.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined
    expect(pipelineArg).toBeDefined()
    expect(pipelineArg!.skipApply).toBe(true)
    expect(pipelineArg!.userId).toBe(VALID_USER_ID)
    expect(pipelineArg!.runId).toBe('run-fake-uuid-0001')

    // searchConfig keywords must be forwarded verbatim
    const forwardedConfig = pipelineArg!.searchConfig as {
      keywords: string[]
    }
    expect(forwardedConfig.keywords).toEqual(VALID_SEARCH_CONFIG.keywords)
  })

  it('returns 200 running and records failure via updateBotRun when orchestrator throws', async () => {
    // Under the waitUntil refactor, the handler returns 200/running
    // immediately; orchestrator errors are persisted via updateBotRun
    // so client polling on bot_runs.status sees 'failed'.
    mockRunPipelineFromInline.mockRejectedValue(
      new Error('scout: linkedin blocked'),
    )

    const req = createMockReq({
      userId: VALID_USER_ID,
      searchConfig: VALID_SEARCH_CONFIG,
    })
    const res = createMockRes()

    await handler(req, res)
    // Let the background IIFE complete so updateBotRun(failed) fires
    await flushWaitUntil()

    expect(res._status).toBe(200)
    const body = res._json as { runId?: string; status?: string }
    expect(body.runId).toBe('run-fake-uuid-0001')
    expect(body.status).toBe('running')

    // The failure must have been recorded on the bot_run row so the
    // client polling bot_runs.status sees 'failed'
    const failedCalls = mockUpdateBotRun.mock.calls.filter(
      (args: unknown[]) => {
        const patch = args[1] as Record<string, unknown> | undefined
        return patch?.status === 'failed'
      },
    )
    expect(failedCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('returns 400 when body is null', async () => {
    const req = createMockReq(null)
    const res = createMockRes()

    await handler(req, res)

    expect(res._status).toBe(400)
    expect(mockCreateBotRun).not.toHaveBeenCalled()
    expect(mockRunPipelineFromInline).not.toHaveBeenCalled()
  })

  it('accepts empty userProfile (optional field)', async () => {
    const req = createMockReq({
      userId: VALID_USER_ID,
      searchConfig: VALID_SEARCH_CONFIG,
      // userProfile omitted
    })
    const res = createMockRes()

    await handler(req, res)
    await flushWaitUntil()

    expect(res._status).toBe(200)
    expect(mockRunPipelineFromInline).toHaveBeenCalledTimes(1)
  })
})
