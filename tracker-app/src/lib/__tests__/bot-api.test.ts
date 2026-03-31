import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

// Mock supabase module so getCurrentUserId() can be controlled
const mockGetSession = vi.fn()
vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
    },
  },
}))

// Import after mocks are set up
import {
  triggerBotRun,
  triggerQualifyJobs,
  triggerApplyJobs,
  triggerEnrichProfile,
} from '../bot-api'
import type {
  DiscoveredJobInput,
  ApprovedJobInput,
  TriggerBotResponse,
} from '../bot-api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockLocalStorage(store: Record<string, string>) {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(
    (key: string) => store[key] ?? null,
  )
}

function mockAuthenticated(userId = 'user-abc-123') {
  mockGetSession.mockResolvedValue({
    data: { session: { user: { id: userId } } },
  })
}

function mockUnauthenticated() {
  mockGetSession.mockResolvedValue({
    data: { session: null },
  })
}

function mockFetchOk(responseBody: Record<string, unknown> = { id: 'run-1' }) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(responseBody),
    text: () => Promise.resolve(JSON.stringify(responseBody)),
  } as Response)
}

function mockFetchError(status: number, body = 'Server error') {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  } as Response)
}

const VALID_SEARCH_CONFIG = JSON.stringify({
  keywords: ['Product Designer', 'UX Designer'],
  locations: ['Remote'],
  minSalary: 80000,
})

const VALID_USER_PROFILE = JSON.stringify({
  name: 'Florian Gouloubi',
  email: 'florian.gouloubi@gmail.com',
  cvUrl: 'https://example.com/cv.pdf',
})

const VALID_ENRICHED_PROFILE = JSON.stringify({
  skills: ['Figma', 'Design Systems'],
  yearsExperience: 7,
})

const SAMPLE_DISCOVERED_JOBS: DiscoveredJobInput[] = [
  {
    title: 'Senior Product Designer',
    company: 'Acme Corp',
    location: 'Remote',
    url: 'https://linkedin.com/jobs/123',
    isEasyApply: true,
  },
  {
    title: 'UX Designer',
    company: 'Beta Inc',
    location: 'Singapore',
    url: 'https://linkedin.com/jobs/456',
    isEasyApply: false,
  },
]

const SAMPLE_APPROVED_JOBS: ApprovedJobInput[] = [
  {
    url: 'https://linkedin.com/jobs/123',
    company: 'Acme Corp',
    role: 'Senior Product Designer',
    coverLetterSnippet: 'I am excited to apply...',
    matchScore: 85,
  },
]

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks()
  mockAuthenticated()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════════
//  getSearchConfig (tested indirectly through triggerBotRun)
// ═══════════════════════════════════════════════════════════════════════════

describe('getSearchConfig (via triggerBotRun)', () => {
  it('parses valid JSON from localStorage', async () => {
    mockLocalStorage({
      tracker_v2_search_config: VALID_SEARCH_CONFIG,
      tracker_v2_user_profile: VALID_USER_PROFILE,
    })
    mockFetchOk()

    const result = await triggerBotRun('profile-1')
    expect(result.runId).toBe('run-1')

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]
    const body = JSON.parse(fetchCall[1]!.body as string)
    expect(body.payload.searchConfig.keywords).toEqual([
      'Product Designer',
      'UX Designer',
    ])
  })

  it('throws when search config is missing from localStorage', async () => {
    mockLocalStorage({})
    mockFetchOk()

    await expect(triggerBotRun('profile-1')).rejects.toThrow(
      'No search criteria configured',
    )
  })

  it('throws when search config has empty keywords array', async () => {
    mockLocalStorage({
      tracker_v2_search_config: JSON.stringify({ keywords: [] }),
    })
    mockFetchOk()

    await expect(triggerBotRun('profile-1')).rejects.toThrow(
      'No search criteria configured',
    )
  })

  it('throws when search config has no keywords field', async () => {
    mockLocalStorage({
      tracker_v2_search_config: JSON.stringify({ locations: ['Remote'] }),
    })
    mockFetchOk()

    await expect(triggerBotRun('profile-1')).rejects.toThrow(
      'No search criteria configured',
    )
  })

  it('returns null (throws) when localStorage has invalid JSON', async () => {
    mockLocalStorage({
      tracker_v2_search_config: '{not valid json!!!',
    })
    mockFetchOk()

    await expect(triggerBotRun('profile-1')).rejects.toThrow(
      'No search criteria configured',
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//  getUserProfile (tested indirectly through triggerBotRun)
// ═══════════════════════════════════════════════════════════════════════════

describe('getUserProfile (via triggerBotRun)', () => {
  it('includes valid profile in payload', async () => {
    mockLocalStorage({
      tracker_v2_search_config: VALID_SEARCH_CONFIG,
      tracker_v2_user_profile: VALID_USER_PROFILE,
    })
    mockFetchOk()

    await triggerBotRun('profile-1')

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]
    const body = JSON.parse(fetchCall[1]!.body as string)
    expect(body.payload.userProfile.name).toBe('Florian Gouloubi')
    expect(body.payload.userProfile.email).toBe('florian.gouloubi@gmail.com')
  })

  it('sends null userProfile when missing from localStorage', async () => {
    mockLocalStorage({
      tracker_v2_search_config: VALID_SEARCH_CONFIG,
    })
    mockFetchOk()

    await triggerBotRun('profile-1')

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]
    const body = JSON.parse(fetchCall[1]!.body as string)
    expect(body.payload.userProfile).toBeNull()
  })

  it('sends null userProfile when localStorage has invalid JSON', async () => {
    mockLocalStorage({
      tracker_v2_search_config: VALID_SEARCH_CONFIG,
      tracker_v2_user_profile: 'broken{json',
    })
    mockFetchOk()

    await triggerBotRun('profile-1')

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]
    const body = JSON.parse(fetchCall[1]!.body as string)
    expect(body.payload.userProfile).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//  getLinkedInCookie (tested indirectly through triggerBotRun)
// ═══════════════════════════════════════════════════════════════════════════

describe('getLinkedInCookie (via triggerBotRun)', () => {
  it('includes LinkedIn cookie in payload when present', async () => {
    mockLocalStorage({
      tracker_v2_search_config: VALID_SEARCH_CONFIG,
      tracker_v2_linkedin_cookie: 'AQEDAxxxxxxx',
    })
    mockFetchOk()

    await triggerBotRun('profile-1')

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]
    const body = JSON.parse(fetchCall[1]!.body as string)
    expect(body.payload.linkedInCookie).toBe('AQEDAxxxxxxx')
  })

  it('omits linkedInCookie from payload when absent', async () => {
    mockLocalStorage({
      tracker_v2_search_config: VALID_SEARCH_CONFIG,
    })
    mockFetchOk()

    await triggerBotRun('profile-1')

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]
    const body = JSON.parse(fetchCall[1]!.body as string)
    expect(body.payload.linkedInCookie).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//  getCurrentUserId (via authentication checks)
// ═══════════════════════════════════════════════════════════════════════════

describe('getCurrentUserId (auth)', () => {
  it('uses authenticated user ID in payload', async () => {
    mockAuthenticated('user-xyz-789')
    mockLocalStorage({ tracker_v2_search_config: VALID_SEARCH_CONFIG })
    mockFetchOk()

    await triggerBotRun('profile-1')

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]
    const body = JSON.parse(fetchCall[1]!.body as string)
    expect(body.payload.userId).toBe('user-xyz-789')
  })

  it('throws when not authenticated', async () => {
    mockUnauthenticated()
    mockLocalStorage({ tracker_v2_search_config: VALID_SEARCH_CONFIG })
    mockFetchOk()

    await expect(triggerBotRun('profile-1')).rejects.toThrow(
      'Not authenticated',
    )
  })

  it('throws when session exists but user is missing', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: null } },
    })
    mockLocalStorage({ tracker_v2_search_config: VALID_SEARCH_CONFIG })
    mockFetchOk()

    await expect(triggerBotRun('profile-1')).rejects.toThrow(
      'Not authenticated',
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//  triggerBotRun
// ═══════════════════════════════════════════════════════════════════════════

describe('triggerBotRun', () => {
  beforeEach(() => {
    mockLocalStorage({
      tracker_v2_search_config: VALID_SEARCH_CONFIG,
      tracker_v2_user_profile: VALID_USER_PROFILE,
      tracker_v2_enriched_profile: VALID_ENRICHED_PROFILE,
    })
  })

  it('sends POST to /api/trigger-task with correct taskId', async () => {
    mockFetchOk()

    await triggerBotRun('profile-1')

    expect(globalThis.fetch).toHaveBeenCalledOnce()
    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toBe('/api/trigger-task')
    expect(options!.method).toBe('POST')
    expect(options!.headers).toEqual({ 'Content-Type': 'application/json' })

    const body = JSON.parse(options!.body as string)
    expect(body.taskId).toBe('apply-job-pipeline')
  })

  it('defaults maxApplications to 20', async () => {
    mockFetchOk()

    await triggerBotRun('profile-1')

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string,
    )
    expect(body.payload.maxApplications).toBe(20)
  })

  it('respects custom maxApplications', async () => {
    mockFetchOk()

    await triggerBotRun('profile-1', { maxApplications: 5 })

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string,
    )
    expect(body.payload.maxApplications).toBe(5)
  })

  it('sets dryRun to false', async () => {
    mockFetchOk()

    await triggerBotRun('profile-1')

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string,
    )
    expect(body.payload.dryRun).toBe(false)
  })

  it('includes enriched profile when available', async () => {
    mockFetchOk()

    await triggerBotRun('profile-1')

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string,
    )
    expect(body.payload.enrichedProfile).toEqual({
      skills: ['Figma', 'Design Systems'],
      yearsExperience: 7,
    })
  })

  it('sends null enrichedProfile when not in localStorage', async () => {
    mockLocalStorage({
      tracker_v2_search_config: VALID_SEARCH_CONFIG,
      tracker_v2_user_profile: VALID_USER_PROFILE,
    })
    mockFetchOk()

    await triggerBotRun('profile-1')

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string,
    )
    expect(body.payload.enrichedProfile).toBeNull()
  })

  it('returns runId from response', async () => {
    mockFetchOk({ id: 'run-42' })

    const result = await triggerBotRun('profile-1')
    expect(result).toEqual({ runId: 'run-42' })
  })

  it('throws on HTTP 401 with error message', async () => {
    mockFetchError(401, 'Unauthorized')

    await expect(triggerBotRun('profile-1')).rejects.toThrow(
      'Failed to start job search: 401 Unauthorized',
    )
  })

  it('throws on HTTP 500 with error message', async () => {
    mockFetchError(500, 'Internal Server Error')

    await expect(triggerBotRun('profile-1')).rejects.toThrow(
      'Failed to start job search: 500 Internal Server Error',
    )
  })

  it('throws on fetch network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('Network request failed'),
    )

    await expect(triggerBotRun('profile-1')).rejects.toThrow(
      'Network request failed',
    )
  })

  it('handles response.text() failure gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.reject(new Error('read failed')),
    } as Response)

    await expect(triggerBotRun('profile-1')).rejects.toThrow(
      'Failed to start job search: 502 Unknown error',
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//  triggerQualifyJobs
// ═══════════════════════════════════════════════════════════════════════════

describe('triggerQualifyJobs', () => {
  beforeEach(() => {
    mockLocalStorage({
      tracker_v2_search_config: VALID_SEARCH_CONFIG,
      tracker_v2_user_profile: VALID_USER_PROFILE,
      tracker_v2_enriched_profile: VALID_ENRICHED_PROFILE,
    })
  })

  it('sends POST with taskId qualify-jobs', async () => {
    mockFetchOk()

    await triggerQualifyJobs(SAMPLE_DISCOVERED_JOBS)

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string,
    )
    expect(body.taskId).toBe('qualify-jobs')
  })

  it('includes all jobs in payload', async () => {
    mockFetchOk()

    await triggerQualifyJobs(SAMPLE_DISCOVERED_JOBS)

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string,
    )
    expect(body.payload.jobs).toHaveLength(2)
    expect(body.payload.jobs[0].company).toBe('Acme Corp')
    expect(body.payload.jobs[1].company).toBe('Beta Inc')
  })

  it('throws when jobs array is empty', async () => {
    mockFetchOk()

    await expect(triggerQualifyJobs([])).rejects.toThrow(
      'No jobs provided for qualification',
    )
  })

  it('throws when search config is missing', async () => {
    mockLocalStorage({})
    mockFetchOk()

    await expect(
      triggerQualifyJobs(SAMPLE_DISCOVERED_JOBS),
    ).rejects.toThrow('No search criteria configured')
  })

  it('uses empty object for missing userProfile', async () => {
    mockLocalStorage({
      tracker_v2_search_config: VALID_SEARCH_CONFIG,
    })
    mockFetchOk()

    await triggerQualifyJobs(SAMPLE_DISCOVERED_JOBS)

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string,
    )
    expect(body.payload.userProfile).toEqual({})
  })

  it('includes enrichedProfile when available', async () => {
    mockFetchOk()

    await triggerQualifyJobs(SAMPLE_DISCOVERED_JOBS)

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string,
    )
    expect(body.payload.enrichedProfile).toEqual({
      skills: ['Figma', 'Design Systems'],
      yearsExperience: 7,
    })
  })

  it('sets enrichedProfile to undefined when not available', async () => {
    mockLocalStorage({
      tracker_v2_search_config: VALID_SEARCH_CONFIG,
      tracker_v2_user_profile: VALID_USER_PROFILE,
    })
    mockFetchOk()

    await triggerQualifyJobs(SAMPLE_DISCOVERED_JOBS)

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string,
    )
    // undefined is stripped during JSON.stringify
    expect(body.payload.enrichedProfile).toBeUndefined()
  })

  it('returns runId from response', async () => {
    mockFetchOk({ id: 'qual-run-7' })

    const result = await triggerQualifyJobs(SAMPLE_DISCOVERED_JOBS)
    expect(result).toEqual({ runId: 'qual-run-7' })
  })

  it('throws on HTTP error', async () => {
    mockFetchError(403, 'Forbidden')

    await expect(
      triggerQualifyJobs(SAMPLE_DISCOVERED_JOBS),
    ).rejects.toThrow('Failed to start job qualification: 403 Forbidden')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//  triggerApplyJobs
// ═══════════════════════════════════════════════════════════════════════════

describe('triggerApplyJobs', () => {
  beforeEach(() => {
    mockLocalStorage({
      tracker_v2_search_config: VALID_SEARCH_CONFIG,
      tracker_v2_user_profile: VALID_USER_PROFILE,
      tracker_v2_linkedin_cookie: 'AQEDAxxxxxxx',
      tracker_v2_enriched_profile: VALID_ENRICHED_PROFILE,
    })
  })

  it('sends POST with taskId apply-jobs', async () => {
    mockFetchOk()

    await triggerApplyJobs(SAMPLE_APPROVED_JOBS)

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string,
    )
    expect(body.taskId).toBe('apply-jobs')
  })

  it('includes approved jobs in payload', async () => {
    mockFetchOk()

    await triggerApplyJobs(SAMPLE_APPROVED_JOBS)

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string,
    )
    expect(body.payload.jobs).toHaveLength(1)
    expect(body.payload.jobs[0].company).toBe('Acme Corp')
    expect(body.payload.jobs[0].matchScore).toBe(85)
  })

  it('throws when jobs array is empty', async () => {
    mockFetchOk()

    await expect(triggerApplyJobs([])).rejects.toThrow(
      'No approved jobs provided for application',
    )
  })

  it('includes LinkedIn cookie when available', async () => {
    mockFetchOk()

    await triggerApplyJobs(SAMPLE_APPROVED_JOBS)

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string,
    )
    expect(body.payload.linkedInCookie).toBe('AQEDAxxxxxxx')
  })

  it('omits LinkedIn cookie when not in localStorage', async () => {
    mockLocalStorage({
      tracker_v2_user_profile: VALID_USER_PROFILE,
    })
    mockFetchOk()

    await triggerApplyJobs(SAMPLE_APPROVED_JOBS)

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string,
    )
    expect(body.payload.linkedInCookie).toBeUndefined()
  })

  it('uses empty object for missing userProfile', async () => {
    mockLocalStorage({
      tracker_v2_linkedin_cookie: 'AQEDAxxxxxxx',
    })
    mockFetchOk()

    await triggerApplyJobs(SAMPLE_APPROVED_JOBS)

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string,
    )
    expect(body.payload.userProfile).toEqual({})
  })

  it('includes enrichedProfile when available', async () => {
    mockFetchOk()

    await triggerApplyJobs(SAMPLE_APPROVED_JOBS)

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string,
    )
    expect(body.payload.enrichedProfile).toEqual({
      skills: ['Figma', 'Design Systems'],
      yearsExperience: 7,
    })
  })

  it('returns runId from response', async () => {
    mockFetchOk({ id: 'apply-run-3' })

    const result = await triggerApplyJobs(SAMPLE_APPROVED_JOBS)
    expect(result).toEqual({ runId: 'apply-run-3' })
  })

  it('throws on HTTP error', async () => {
    mockFetchError(500, 'Internal error')

    await expect(
      triggerApplyJobs(SAMPLE_APPROVED_JOBS),
    ).rejects.toThrow('Failed to start job applications: 500 Internal error')
  })

  it('handles response.text() failure on error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 504,
      text: () => Promise.reject(new Error('timeout')),
    } as Response)

    await expect(
      triggerApplyJobs(SAMPLE_APPROVED_JOBS),
    ).rejects.toThrow('Failed to start job applications: 504 Unknown error')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
//  triggerEnrichProfile
// ═══════════════════════════════════════════════════════════════════════════

describe('triggerEnrichProfile', () => {
  it('sends POST with taskId enrich-profile', async () => {
    mockFetchOk()

    await triggerEnrichProfile('https://example.com/cv.pdf')

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string,
    )
    expect(body.taskId).toBe('enrich-profile')
  })

  it('includes cvUrl and portfolioUrl in payload', async () => {
    mockFetchOk()

    await triggerEnrichProfile(
      'https://example.com/cv.pdf',
      'https://example.com/portfolio.pdf',
    )

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string,
    )
    expect(body.payload.cvUrl).toBe('https://example.com/cv.pdf')
    expect(body.payload.portfolioUrl).toBe(
      'https://example.com/portfolio.pdf',
    )
  })

  it('omits portfolioUrl when not provided', async () => {
    mockFetchOk()

    await triggerEnrichProfile('https://example.com/cv.pdf')

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string,
    )
    expect(body.payload.cvUrl).toBe('https://example.com/cv.pdf')
    // undefined is stripped during JSON.stringify
    expect(body.payload.portfolioUrl).toBeUndefined()
  })

  it('throws when cvUrl is empty string', async () => {
    mockFetchOk()

    await expect(triggerEnrichProfile('')).rejects.toThrow(
      'CV URL is required for profile enrichment',
    )
  })

  it('includes userId in payload', async () => {
    mockAuthenticated('enrich-user-5')
    mockFetchOk()

    await triggerEnrichProfile('https://example.com/cv.pdf')

    const body = JSON.parse(
      vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string,
    )
    expect(body.payload.userId).toBe('enrich-user-5')
  })

  it('returns runId from response', async () => {
    mockFetchOk({ id: 'enrich-run-1' })

    const result = await triggerEnrichProfile('https://example.com/cv.pdf')
    expect(result).toEqual({ runId: 'enrich-run-1' })
  })

  it('throws on HTTP error', async () => {
    mockFetchError(429, 'Rate limited')

    await expect(
      triggerEnrichProfile('https://example.com/cv.pdf'),
    ).rejects.toThrow('Failed to start profile enrichment: 429 Rate limited')
  })

  it('throws when not authenticated', async () => {
    mockUnauthenticated()
    mockFetchOk()

    await expect(
      triggerEnrichProfile('https://example.com/cv.pdf'),
    ).rejects.toThrow('Not authenticated')
  })
})
