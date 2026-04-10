import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Tests for src/lib/bot-api.ts — triggerScout() and pollBotRunStatus().
 *
 * Guards the client-side half of the scout chain:
 *   UI → triggerScout() → POST /api/trigger-scout → { runId, status }
 *   UI → pollBotRunStatus(runId) → supabase.from('bot_runs').select(...)
 *
 * Would have caught regressions like:
 *   - triggerScout sending the wrong URL or HTTP method
 *   - triggerScout throwing silently when no auth session
 *   - triggerScout sending empty keywords (backend returns 400)
 *   - pollBotRunStatus querying the wrong table or wrong column names
 *   - pollBotRunStatus returning undefined instead of sensible defaults
 */

// ---------------------------------------------------------------------------
// Mocks — declared BEFORE imports so the module under test picks them up
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn()
const mockMaybeSingle = vi.fn()
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      // pollBotRunStatus may use getUser in some variants — mock both
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    },
    from: mockFrom,
  },
}))

// Import AFTER mocks are set up
import { triggerScout, pollBotRunStatus } from '../bot-api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockLocalStorage(store: Record<string, string>) {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(
    (key: string) => store[key] ?? null,
  )
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined)
}

function mockAuthenticated(userId = '11111111-2222-3333-4444-555555555555') {
  mockGetSession.mockResolvedValue({
    data: { session: { user: { id: userId } } },
  })
}

function mockUnauthenticated() {
  mockGetSession.mockResolvedValue({ data: { session: null } })
}

function mockFetchOk(responseBody: Record<string, unknown>) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(responseBody),
    text: () => Promise.resolve(JSON.stringify(responseBody)),
  } as Response)
}

function mockFetchError(status: number, body = 'Server error') {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve({ error: body }),
  } as Response)
}

const VALID_SEARCH_CONFIG = JSON.stringify({
  keywords: ['Senior Product Designer'],
  locationRules: [
    { type: 'zone', value: 'Americas', workArrangement: 'remote' },
  ],
})

const VALID_USER_PROFILE = JSON.stringify({
  name: 'Florian Gouloubi',
  email: 'florian.gouloubi@gmail.com',
})

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks()
  mockGetSession.mockReset()
  mockFrom.mockClear()
  mockSelect.mockClear()
  mockEq.mockClear()
  mockMaybeSingle.mockReset()

  mockAuthenticated()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// triggerScout
// ---------------------------------------------------------------------------

describe('bot-api.triggerScout', () => {
  it('sends POST /api/trigger-scout with { userId, searchConfig, userProfile }', async () => {
    mockLocalStorage({
      tracker_v2_search_config: VALID_SEARCH_CONFIG,
      tracker_v2_user_profile: VALID_USER_PROFILE,
    })
    mockFetchOk({ runId: 'run-scout-abc', status: 'running' })

    await triggerScout()

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [string, RequestInit]

    expect(url).toBe('/api/trigger-scout')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    )

    const body = JSON.parse(init.body as string) as {
      userId: string
      searchConfig: { keywords: string[] }
      userProfile: { email: string }
    }
    expect(body.userId).toBe('11111111-2222-3333-4444-555555555555')
    expect(body.searchConfig.keywords).toEqual(['Senior Product Designer'])
    expect(body.userProfile.email).toBe('florian.gouloubi@gmail.com')
  })

  it('throws when no searchConfig is present in localStorage', async () => {
    mockLocalStorage({}) // no config
    mockFetchOk({ runId: 'never-called', status: 'running' })

    await expect(triggerScout()).rejects.toThrow(/search criteria|keywords/i)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('throws when searchConfig has empty keywords array', async () => {
    mockLocalStorage({
      tracker_v2_search_config: JSON.stringify({
        keywords: [],
        locationRules: [],
      }),
    })
    mockFetchOk({ runId: 'never-called', status: 'running' })

    await expect(triggerScout()).rejects.toThrow(/search criteria|keywords/i)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('throws when the user is not authenticated', async () => {
    mockUnauthenticated()
    mockLocalStorage({
      tracker_v2_search_config: VALID_SEARCH_CONFIG,
      tracker_v2_user_profile: VALID_USER_PROFILE,
    })
    mockFetchOk({ runId: 'never-called', status: 'running' })

    await expect(triggerScout()).rejects.toThrow(/not authenticated|sign in/i)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('returns { runId, status } on 200 OK', async () => {
    mockLocalStorage({
      tracker_v2_search_config: VALID_SEARCH_CONFIG,
      tracker_v2_user_profile: VALID_USER_PROFILE,
    })
    mockFetchOk({ runId: 'run-scout-xyz', status: 'running' })

    const result = await triggerScout()
    expect(result.runId).toBe('run-scout-xyz')
    expect(result.status).toBe('running')
  })

  it('throws when the API returns a non-2xx status', async () => {
    mockLocalStorage({
      tracker_v2_search_config: VALID_SEARCH_CONFIG,
      tracker_v2_user_profile: VALID_USER_PROFILE,
    })
    mockFetchError(500, 'Internal Server Error')

    await expect(triggerScout()).rejects.toThrow(/500|scout|failed/i)
  })
})

// ---------------------------------------------------------------------------
// pollBotRunStatus
// ---------------------------------------------------------------------------

describe('bot-api.pollBotRunStatus', () => {
  it("queries supabase.from('bot_runs') with the given runId", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        status: 'running',
        jobs_found: 3,
        jobs_qualified: 1,
      },
      error: null,
    })

    await pollBotRunStatus('run-scout-abc')

    expect(mockFrom).toHaveBeenCalledWith('bot_runs')
    expect(mockSelect).toHaveBeenCalledTimes(1)
    const selectCols = mockSelect.mock.calls[0]?.[0] as string | undefined
    // The select should include the columns the caller reads
    expect(selectCols).toBeTruthy()
    expect(selectCols).toMatch(/status/)
    expect(selectCols).toMatch(/jobs_found/)
    expect(selectCols).toMatch(/jobs_qualified/)

    expect(mockEq).toHaveBeenCalledWith('id', 'run-scout-abc')
    expect(mockMaybeSingle).toHaveBeenCalledTimes(1)
  })

  it('returns the row values when the query succeeds', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: {
        status: 'completed',
        jobs_found: 42,
        jobs_qualified: 11,
      },
      error: null,
    })

    const result = await pollBotRunStatus('run-complete-1')
    expect(result.status).toBe('completed')
    expect(result.jobsFound).toBe(42)
    expect(result.jobsQualified).toBe(11)
  })

  it('returns default values when no row is found (RLS lag / not-yet-replicated)', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })

    const result = await pollBotRunStatus('run-missing')
    // Caller should see sensible defaults, not undefined/null
    expect(result.status).toBe('unknown')
    expect(result.jobsFound).toBe(0)
    expect(result.jobsQualified).toBe(0)
  })
})
