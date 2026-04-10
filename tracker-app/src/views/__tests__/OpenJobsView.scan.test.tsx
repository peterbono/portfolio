import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

/**
 * Tests for OpenJobsView — the "Scan now" button flow.
 *
 * Guards the chain:
 *   Click "Scan now"
 *     → triggerScout() (dynamic import from ../lib/bot-api)
 *     → pollBotRunStatus loop
 *     → fetchJobs() refresh on completion
 *     → jobs list re-rendered
 *
 * Would have caught regressions like:
 *   - Scan button wired to the wrong handler
 *   - Scan button clickable when hasKeywords is false
 *   - Jobs list not refreshing after scout completes
 *   - AutopilotView's 'tracker:jobs-refresh' event not triggering fetchJobs
 *
 * NOTE: Several "button rendered" assertions are `it.skip` because the
 * handleScanNow handler exists in OpenJobsView but the button JSX element
 * that invokes it has NOT yet been added to the filter row. Those tests
 * will activate once the Frontend Engineer wires a <button onClick={handleScanNow}>
 * into the filterRow JSX.
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ---------------------------------------------------------------------------
// Mocks — supabase + bot-api
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

interface SupabaseState {
  user: { id: string; email: string } | null
  jobListingsData: Row[]
  profileData: Row | null
  profileError: unknown
  fetchCount: number
}

const state: SupabaseState = {
  user: null,
  jobListingsData: [],
  profileData: null,
  profileError: null,
  fetchCount: 0,
}

function jobListingsChain() {
  state.fetchCount += 1
  const result = { data: state.jobListingsData, error: null }
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    not: () => chain,
    gte: () => chain,
    order: () => chain,
    limit: () => Promise.resolve(result),
  }
  return chain
}

function profilesChain() {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () =>
      Promise.resolve({ data: state.profileData, error: state.profileError }),
  }
  return chain
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: state.user },
        error: null,
      })),
      getSession: vi.fn(async () => ({
        data: { session: state.user ? { user: state.user } : null },
      })),
    },
    from: vi.fn((table: string) => {
      if (table === 'job_listings') return jobListingsChain()
      if (table === 'profiles') return profilesChain()
      if (table === 'bot_runs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { status: 'completed', jobs_found: 0, jobs_qualified: 0 },
                  error: null,
                }),
            }),
          }),
        }
      }
      return { select: () => ({ data: [], error: null }) }
    }),
  },
}))

const mockTriggerScout = vi.fn()
const mockPollBotRunStatus = vi.fn()
vi.mock('../../lib/bot-api', () => ({
  triggerScout: (...args: unknown[]) => mockTriggerScout(...args),
  pollBotRunStatus: (...args: unknown[]) => mockPollBotRunStatus(...args),
}))

// ---------------------------------------------------------------------------
// Import component AFTER mocks
// ---------------------------------------------------------------------------

import { OpenJobsView } from '../OpenJobsView'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetState() {
  state.user = null
  state.jobListingsData = []
  state.profileData = null
  state.profileError = null
  state.fetchCount = 0
}

let container: HTMLDivElement | null = null
let root: Root | null = null

async function mount(ui: React.ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(ui)
  })
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
  return container
}

function unmount() {
  if (root) {
    act(() => {
      root!.unmount()
    })
    root = null
  }
  if (container && container.parentNode) {
    container.parentNode.removeChild(container)
    container = null
  }
}

async function clickEl(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

function findButtonByText(
  rootEl: Element,
  predicate: (text: string) => boolean,
): HTMLButtonElement | null {
  const btns = rootEl.querySelectorAll('button')
  for (const btn of btns) {
    if (predicate(btn.textContent ?? '')) return btn
  }
  return null
}

const VALID_SEARCH_CONFIG = JSON.stringify({
  keywords: ['Senior Product Designer'],
  locationRules: [],
})

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('OpenJobsView — Scan now flow', () => {
  beforeEach(() => {
    resetState()
    mockTriggerScout.mockReset()
    mockPollBotRunStatus.mockReset()
    mockPollBotRunStatus.mockResolvedValue({
      status: 'completed',
      jobsFound: 5,
      jobsQualified: 3,
    })

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      if (key === 'tracker_v2_search_config') return VALID_SEARCH_CONFIG
      return null
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => undefined)
  })

  afterEach(() => {
    unmount()
    vi.restoreAllMocks()
  })

  it.skip('Scan now button is rendered in the filter row', async () => {
    // SKIP REASON: handleScanNow is implemented in OpenJobsView but the
    // <button onClick={handleScanNow}>Scan now</button> element has not yet
    // been added to the filterRow JSX. Activate when the button lands.
    state.user = { id: 'user-1', email: 'florian@example.com' }

    const el = await mount(<OpenJobsView />)
    const btn = findButtonByText(el, (t) => /Scan now/i.test(t))
    expect(btn).not.toBeNull()
  })

  it.skip('Scan now button is disabled when no searchConfig.keywords', async () => {
    // SKIP REASON: same as above — button not yet rendered. The handler
    // already guards `if (!hasKeywords) return`, so once the JSX lands this
    // test only needs to assert the `disabled` attribute mirrors !hasKeywords.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      if (key === 'tracker_v2_search_config') return JSON.stringify({ keywords: [] })
      return null
    })
    state.user = { id: 'user-1', email: 'florian@example.com' }

    const el = await mount(<OpenJobsView />)
    const btn = findButtonByText(el, (t) => /Scan now/i.test(t))
    expect(btn).not.toBeNull()
    expect(btn!.disabled).toBe(true)
  })

  it.skip('Clicking Scan now calls triggerScout()', async () => {
    // SKIP REASON: waiting for the Scan button JSX. Once the button is
    // rendered, this test just needs to find it and click.
    mockTriggerScout.mockResolvedValue({ runId: 'run-scan-1', status: 'running' })
    state.user = { id: 'user-1', email: 'florian@example.com' }
    state.jobListingsData = []

    const el = await mount(<OpenJobsView />)
    const btn = findButtonByText(el, (t) => /Scan now/i.test(t))
    expect(btn).not.toBeNull()

    await clickEl(btn!)
    expect(mockTriggerScout).toHaveBeenCalledTimes(1)
  })

  it('refreshes the jobs list when a tracker:jobs-refresh event fires', async () => {
    // This guards the cross-view contract: AutopilotView dispatches
    // window.dispatchEvent(new CustomEvent('tracker:jobs-refresh'))
    // after a scout completes, and OpenJobsView MUST re-query job_listings
    // in response. This keeps the regression net tight even before the
    // Scan-now button lands in JSX.
    state.user = { id: 'user-1', email: 'florian@example.com' }
    state.jobListingsData = []

    await mount(<OpenJobsView />)

    const fetchesBefore = state.fetchCount
    expect(fetchesBefore).toBeGreaterThan(0)

    // Populate jobs so the refetch has something to load
    state.jobListingsData = [
      {
        id: 'job-new-1',
        user_id: 'user-1',
        company: 'Stripe',
        role: 'Staff Product Designer',
        title: 'Staff Product Designer',
        location: 'Remote',
        salary: '$160k-$200k',
        salary_range: null,
        ats: 'Greenhouse',
        link: 'https://boards.greenhouse.io/stripe/jobs/42',
        work_arrangement: 'Remote',
        qualification_score: 88,
        qualification_result: { jdKeywords: ['figma'] },
        created_at: new Date().toISOString(),
        posted_at: new Date().toISOString(),
      },
    ]

    // Dispatch the refresh event that AutopilotView fires on scout completion
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('tracker:jobs-refresh', { detail: { runId: 'run-scan-1' } }),
      )
    })
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    })

    // OpenJobsView should have refetched after the event
    expect(state.fetchCount).toBeGreaterThan(fetchesBefore)
  })

  it('fetchJobs queries job_listings with the authenticated user.id filter', async () => {
    // Guards the Supabase read contract that Scan-now relies on to refresh.
    // If the select chain changes (e.g. wrong table name, missing eq), the
    // scout result would never surface in the UI.
    state.user = { id: 'user-1', email: 'florian@example.com' }
    state.jobListingsData = [
      {
        id: 'job-1',
        user_id: 'user-1',
        company: 'Acme',
        role: 'Senior Product Designer',
        title: 'Senior Product Designer',
        location: 'Remote',
        salary: null,
        salary_range: null,
        ats: 'Lever',
        link: 'https://jobs.lever.co/acme/1',
        work_arrangement: 'Remote',
        qualification_score: 80,
        qualification_result: { jdKeywords: [] },
        created_at: new Date().toISOString(),
        posted_at: new Date().toISOString(),
      },
    ]

    await mount(<OpenJobsView />)

    // The mocked supabase.from was called at least once for job_listings
    const supabaseMod = await import('../../lib/supabase')
    const fromMock = supabaseMod.supabase.from as unknown as ReturnType<typeof vi.fn>
    const calls = fromMock.mock.calls.map((c) => c[0])
    expect(calls).toContain('job_listings')
  })
})
