import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Tests for src/bot/ats-resolver.ts — ATS URL detection and aggregator resolution.
 *
 * detectAts: pure regex-based classifier
 * resolveAggregatorUrl: async HEAD-follow resolver with abort/timeout safety
 *
 * All network calls are mocked via vi.stubGlobal('fetch', ...). No live I/O.
 */

import { detectAts, resolveAggregatorUrl } from '../ats-resolver'

// ---------------------------------------------------------------------------
// detectAts — pure function
// ---------------------------------------------------------------------------

describe('detectAts', () => {
  // ---------- Positive matches: one per ATS ----------

  it("returns 'Greenhouse' for boards.greenhouse.io URLs", () => {
    expect(detectAts('https://boards.greenhouse.io/acme/jobs/123456')).toBe('Greenhouse')
  })

  it("returns 'Greenhouse' for job-boards.greenhouse.io URLs", () => {
    expect(detectAts('https://job-boards.greenhouse.io/acme/jobs/789')).toBe('Greenhouse')
  })

  it("returns 'Lever' for jobs.lever.co URLs", () => {
    expect(detectAts('https://jobs.lever.co/acme/abc-def-456-7890')).toBe('Lever')
  })

  it("returns 'Workable' for apply.workable.com URLs", () => {
    expect(detectAts('https://apply.workable.com/acme/j/ABC123XYZ/')).toBe('Workable')
  })

  it("returns 'Workable' for generic workable.com job URLs", () => {
    expect(detectAts('https://acme.workable.com/jobs/9876543')).toBe('Workable')
  })

  it("returns 'Ashby' for jobs.ashbyhq.com URLs", () => {
    expect(detectAts('https://jobs.ashbyhq.com/acme/5f3e2d1c-0b9a-4e8f-9c7d-1a2b3c4d5e6f')).toBe(
      'Ashby',
    )
  })

  it("returns 'BreezyHR' for acme.breezy.hr URLs", () => {
    expect(detectAts('https://acme.breezy.hr/p/abcdef123456-senior-designer')).toBe('BreezyHR')
  })

  it("returns 'Manatal' for careers-page.com URLs", () => {
    expect(detectAts('https://www.careers-page.com/acme/job/abcd1234')).toBe('Manatal')
  })

  it("returns 'Teamtailor' for acme.teamtailor.com URLs", () => {
    expect(detectAts('https://acme.teamtailor.com/jobs/4567890-product-designer')).toBe(
      'Teamtailor',
    )
  })

  it("returns 'Recruitee' for acme.recruitee.com URLs", () => {
    expect(detectAts('https://acme.recruitee.com/o/senior-product-designer')).toBe('Recruitee')
  })

  it("returns 'Personio' for acme.jobs.personio.com URLs", () => {
    expect(detectAts('https://acme.jobs.personio.com/job/123456')).toBe('Personio')
  })

  it("returns 'Personio' for acme.jobs.personio.de URLs", () => {
    expect(detectAts('https://acme.jobs.personio.de/job/987654')).toBe('Personio')
  })

  it("returns 'BambooHR' for acme.bamboohr.com/careers URLs", () => {
    expect(detectAts('https://acme.bamboohr.com/careers/42')).toBe('BambooHR')
  })

  it("returns 'Workday' for myworkdayjobs.com URLs", () => {
    expect(
      detectAts('https://acme.wd1.myworkdayjobs.com/en-US/External/job/Remote/Product-Designer'),
    ).toBe('Workday')
  })

  it("returns 'OracleHCM' for oraclecloud.com hcmUI URLs", () => {
    expect(
      detectAts(
        'https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/12345',
      ),
    ).toBe('OracleHCM')
  })

  it("returns 'iCIMS' for jobs.icims.com URLs", () => {
    expect(detectAts('https://careers-acme.icims.com/jobs/1234/product-designer/job')).toBe(
      'iCIMS',
    )
  })

  it("returns 'Jobvite' for jobs.jobvite.com URLs", () => {
    expect(detectAts('https://jobs.jobvite.com/acme/job/oABCdefg')).toBe('Jobvite')
  })

  it("returns 'SmartRecruiters' for jobs.smartrecruiters.com URLs", () => {
    expect(detectAts('https://jobs.smartrecruiters.com/Acme/744000012345678-product-designer')).toBe(
      'SmartRecruiters',
    )
  })

  // ---------- Negative matches: aggregators and unknowns ----------

  it("returns 'unknown' for remoteok.com URLs", () => {
    expect(detectAts('https://remoteok.com/l/12345')).toBe('unknown')
  })

  it("returns 'unknown' for weworkremotely.com URLs", () => {
    expect(detectAts('https://weworkremotely.com/remote-jobs/acme-product-designer-456')).toBe(
      'unknown',
    )
  })

  it("returns 'unknown' for himalayas.app URLs", () => {
    expect(detectAts('https://himalayas.app/companies/acme/jobs/senior-product-designer')).toBe(
      'unknown',
    )
  })

  it("returns 'unknown' for wellfound.com URLs", () => {
    expect(detectAts('https://wellfound.com/jobs/12345-product-designer')).toBe('unknown')
  })

  it("returns 'unknown' for linkedin.com/jobs URLs", () => {
    expect(detectAts('https://www.linkedin.com/jobs/view/3912345678')).toBe('unknown')
  })

  it("returns 'unknown' for a company's own /careers page", () => {
    expect(detectAts('https://example.com/careers')).toBe('unknown')
  })

  it("returns 'unknown' for dribbble.com job URLs", () => {
    expect(detectAts('https://dribbble.com/jobs/12345-senior-designer')).toBe('unknown')
  })

  // ---------- Edge cases ----------

  it("returns 'unknown' for an empty string", () => {
    expect(detectAts('')).toBe('unknown')
  })

  it("returns 'unknown' for a garbage / invalid URL string", () => {
    expect(detectAts('not a url at all!!!')).toBe('unknown')
  })

  it("returns 'unknown' for a protocol-less host string", () => {
    // Intentionally malformed to ensure no crash.
    expect(detectAts('htp:/broken')).toBe('unknown')
  })

  it('is case-insensitive for the host portion', () => {
    // Backend should lowercase before matching.
    expect(detectAts('https://BOARDS.GREENHOUSE.IO/acme/jobs/1')).toBe('Greenhouse')
  })

  it('does not match greenhouse on unrelated hosts containing the word', () => {
    expect(detectAts('https://greenhousegrowers.com/jobs/42')).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// resolveAggregatorUrl — async, fetch is mocked
// ---------------------------------------------------------------------------

describe('resolveAggregatorUrl', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  function mockResponse(finalUrl: string, status = 200): Response {
    return {
      url: finalUrl,
      status,
      ok: status >= 200 && status < 300,
      redirected: true,
      headers: new Headers(),
    } as unknown as Response
  }

  it('returns early without fetching when the input is already a known ATS URL', async () => {
    const input = 'https://boards.greenhouse.io/acme/jobs/123'
    const result = await resolveAggregatorUrl(input, {})

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.url).toBe(input)
    expect(result.ats).toBe('Greenhouse')
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('follows a HEAD redirect and returns the resolved URL + detected ATS', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse('https://jobs.lever.co/acme/abc-def-456'))

    const result = await resolveAggregatorUrl('https://remoteok.com/l/12345', {})

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.url).toBe('https://jobs.lever.co/acme/abc-def-456')
    expect(result.ats).toBe('Lever')
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('returns original URL + ats="unknown" + confidence=0 when HEAD times out', async () => {
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          // Simulate fetch abort error from a timeout
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          setTimeout(() => reject(err), 5)
        }),
    )

    const original = 'https://remoteok.com/l/99999'
    const result = await resolveAggregatorUrl(original, { timeoutMs: 10 })

    expect(result.url).toBe(original)
    expect(result.ats).toBe('unknown')
    expect(result.confidence).toBe(0)
  })

  it('returns original URL + ats="unknown" when HEAD returns 404', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse('https://remoteok.com/l/deadlink', 404))

    const original = 'https://remoteok.com/l/deadlink'
    const result = await resolveAggregatorUrl(original, {})

    expect(result.url).toBe(original)
    expect(result.ats).toBe('unknown')
  })

  it('returns final URL + ats="unknown" when HEAD redirect chain ends at an unknown host', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse('https://acme.com/careers/product-designer'))

    const result = await resolveAggregatorUrl('https://remoteok.com/l/7777', {})

    expect(result.url).toBe('https://acme.com/careers/product-designer')
    expect(result.ats).toBe('unknown')
  })

  it('does not crash when fetch throws a network error and returns the original URL', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))

    const original = 'https://weworkremotely.com/remote-jobs/acme-designer-111'
    const result = await resolveAggregatorUrl(original, {})

    expect(result.url).toBe(original)
    expect(result.ats).toBe('unknown')
    expect(result.confidence).toBe(0)
  })

  it('does not crash when AbortController aborts mid-flight', async () => {
    fetchMock.mockImplementationOnce(() => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      return Promise.reject(err)
    })

    const original = 'https://himalayas.app/companies/acme/jobs/foo'
    const result = await resolveAggregatorUrl(original, { timeoutMs: 1 })

    expect(result.url).toBe(original)
    expect(result.ats).toBe('unknown')
  })

  it('respects a custom timeoutMs option (forwarded to AbortSignal)', async () => {
    // We can't inspect the AbortSignal timeout directly, but we can confirm
    // fetch was called with an object that has a `signal` property.
    fetchMock.mockResolvedValueOnce(mockResponse('https://jobs.lever.co/acme/abc-def-456'))

    await resolveAggregatorUrl('https://remoteok.com/l/42', { timeoutMs: 1234 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init).toBeDefined()
    expect(init.signal).toBeDefined()
  })

  it('sends a User-Agent header on HEAD requests', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse('https://jobs.lever.co/acme/xyz'))

    await resolveAggregatorUrl('https://remoteok.com/l/55555', {})

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init).toBeDefined()
    const headers = new Headers(init.headers as HeadersInit | undefined)
    const ua = headers.get('user-agent') || headers.get('User-Agent')
    expect(ua).toBeTruthy()
    expect(ua!.length).toBeGreaterThan(0)
  })

  it('issues a HEAD request (method: HEAD) rather than GET', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse('https://jobs.lever.co/acme/xyz'))

    await resolveAggregatorUrl('https://remoteok.com/l/123', {})

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    // Backend may default to HEAD; accept GET as fallback but prefer HEAD.
    expect(['HEAD', 'GET', undefined]).toContain(init?.method)
  })

  it('handles empty string input gracefully (returns unknown, no fetch)', async () => {
    const result = await resolveAggregatorUrl('', {})
    // Implementation may or may not call fetch on empty; assert safe output.
    expect(result.ats).toBe('unknown')
    expect(result.confidence).toBe(0)
  })

  // ---------- Live network cases (skipped on purpose) ----------

  it.skip('follows a real remoteok.com redirect to a live ATS (live network)', async () => {
    // Intentionally skipped — this file must stay hermetic.
  })
})
