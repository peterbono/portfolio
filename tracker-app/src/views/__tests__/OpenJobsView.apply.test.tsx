import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// Mark jsdom as a valid React act() environment
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Tests for OpenJobsView.handleApply — the frontend side of the apply flow.
 *
 * Guards the contract sent to POST /api/queue-apply:
 *   { jobs: [{ url, company, role, coverLetterSnippet, matchScore, jdKeywords }],
 *     userId, userProfile: {...} }
 *
 * Would have caught regressions like:
 *   - Sample jobs (link=null) sent to queue as `url: null`
 *   - Missing `userProfile` (profiles row not fetched)
 *   - Missing `jdKeywords` (qualification_result not unpacked)
 *
 * NOTE: This file intentionally does NOT use @testing-library/react because
 * @testing-library/dom is not installed in this project. We use ReactDOM
 * createRoot + vanilla DOM queries instead, which keeps the test self-contained.
 */

// ---------------------------------------------------------------------------
// Mocks — supabase client
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

interface SupabaseState {
  user: { id: string; email: string } | null
  jobListingsData: Row[]
  profileData: Row | null
  profileError: unknown
}

const state: SupabaseState = {
  user: null,
  jobListingsData: [],
  profileData: null,
  profileError: null,
}

// Build a chainable query object that resolves to { data, error } at the end.
function jobListingsChain() {
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
    },
    from: vi.fn((table: string) => {
      if (table === 'job_listings') return jobListingsChain()
      if (table === 'profiles') return profilesChain()
      return { select: () => ({ data: [], error: null }) }
    }),
  },
}))

// ---------------------------------------------------------------------------
// Import component AFTER mocks
// ---------------------------------------------------------------------------

import { OpenJobsView } from '../OpenJobsView'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function resetState() {
  state.user = null
  state.jobListingsData = []
  state.profileData = null
  state.profileError = null
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
  // Let pending effects / promises resolve (supabase fetch → setState)
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
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

/** Click a DOM element inside an act() block. */
async function clickEl(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  // Flush microtasks from async handler
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** Find the first element whose textContent matches the predicate. */
function findByText(
  root: Element,
  predicate: (text: string) => boolean,
): Element | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  let node: Node | null = walker.currentNode
  while (node) {
    if (node instanceof Element) {
      // Use direct text (not descendant sum) to avoid parent matches
      const direct = Array.from(node.childNodes)
        .filter((c) => c.nodeType === Node.TEXT_NODE)
        .map((c) => c.textContent ?? '')
        .join('')
      if (predicate(direct)) return node
    }
    node = walker.nextNode()
  }
  return null
}

function findButtonByText(
  root: Element,
  predicate: (text: string) => boolean,
): HTMLButtonElement | null {
  const btns = root.querySelectorAll('button')
  for (const btn of btns) {
    if (predicate(btn.textContent ?? '')) return btn
  }
  return null
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('OpenJobsView — handleApply flow', () => {
  beforeEach(() => {
    resetState()
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ runId: 'run-1', queued: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as typeof fetch
  })

  afterEach(() => {
    unmount()
    vi.restoreAllMocks()
  })

  it('clicking Apply on a sample job (link=null) does NOT call /api/queue-apply', async () => {
    // Signed-in user, but job_listings returns empty -> fallback to SAMPLE_JOBS.
    state.user = { id: 'user-1', email: 'florian@example.com' }
    state.jobListingsData = []
    state.profileData = { id: 'user-1', name: 'Florian', email: 'florian@example.com' }

    const el = await mount(<OpenJobsView />)

    // Sample jobs render a "Sample" badge
    const sampleBadge = findByText(el, (t) => t.trim() === 'Sample')
    expect(sampleBadge).not.toBeNull()

    // Click the first job card (a div whose descendants include an h3.role)
    const firstH3 = el.querySelector('h3')
    expect(firstH3).not.toBeNull()
    // Walk up to the outer card element (has onClick binding on a div)
    let cardEl: Element | null = firstH3!
    while (cardEl && cardEl.parentElement && cardEl.tagName !== 'DIV') {
      cardEl = cardEl.parentElement
    }
    // Use h3 itself — bubbling will reach the card's onClick handler
    await clickEl(firstH3!)

    // The detail panel CTA reads "Sample job — Apply disabled" for link=null
    const cta = findButtonByText(el, (t) => /Sample job/i.test(t) && /disabled/i.test(t))
    expect(cta).not.toBeNull()
    expect(cta!.disabled).toBe(true)

    // Click the disabled button — should NOT dispatch fetch
    await clickEl(cta!)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('clicking Apply on a real job calls /api/queue-apply with the correct payload', async () => {
    state.user = { id: 'user-1', email: 'florian@example.com' }
    state.jobListingsData = [
      {
        id: 'job-real-1',
        user_id: 'user-1',
        company: 'Acme',
        role: 'Senior Product Designer',
        title: 'Senior Product Designer',
        location: 'Remote',
        salary: '$120k-$145k',
        salary_range: null,
        ats: 'Lever',
        link: 'https://jobs.lever.co/acme/abc-123',
        work_arrangement: 'Remote',
        qualification_score: 82,
        qualification_result: {
          jdKeywords: ['figma', 'design system', 'prototyping'],
        },
        created_at: new Date().toISOString(),
        posted_at: new Date().toISOString(),
      },
    ]
    state.profileData = {
      id: 'user-1',
      name: 'Florian Gouloubi',
      email: 'florian@example.com',
      phone: '+66618156481',
      linkedin: 'https://www.linkedin.com/in/floriangouloubi/',
      portfolio: 'https://www.floriangouloubi.com',
      cvUrl: 'https://example.com/cv.pdf',
    }

    const el = await mount(<OpenJobsView />)

    // The Acme card should be in the DOM
    const acmeEl = findByText(el, (t) => t.trim() === 'Acme')
    expect(acmeEl).not.toBeNull()

    // Click the card (h3 role inside it bubbles up to the card click handler)
    const h3 = el.querySelector('h3')
    await clickEl(h3!)

    // The "Apply for me" button is enabled for real jobs
    const cta = findButtonByText(el, (t) => /Apply for me/i.test(t))
    expect(cta).not.toBeNull()
    expect(cta!.disabled).toBe(false)

    await clickEl(cta!)

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)

    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/queue-apply')
    expect(init.method).toBe('POST')

    const payload = JSON.parse(init.body as string) as {
      jobs: Array<{
        url: string
        company: string
        role: string
        matchScore: number
        jdKeywords: string[]
      }>
      userId: string
      userProfile: Record<string, string>
    }

    // Job payload shape
    expect(payload.jobs).toHaveLength(1)
    expect(payload.jobs[0].url).toBe('https://jobs.lever.co/acme/abc-123')
    expect(payload.jobs[0].company).toBe('Acme')
    expect(payload.jobs[0].role).toBe('Senior Product Designer')
    expect(payload.jobs[0].matchScore).toBe(82)
    expect(payload.jobs[0].jdKeywords).toEqual(['figma', 'design system', 'prototyping'])

    // userId from supabase.auth.getUser()
    expect(payload.userId).toBe('user-1')

    // userProfile from profiles row
    expect(payload.userProfile).toEqual(
      expect.objectContaining({
        name: 'Florian Gouloubi',
        email: 'florian@example.com',
        phone: '+66618156481',
        linkedin: 'https://www.linkedin.com/in/floriangouloubi/',
        portfolio: 'https://www.floriangouloubi.com',
        cvUrl: 'https://example.com/cv.pdf',
      }),
    )
  })

  it('payload includes jdKeywords fetched from qualification_result (snake_case variant)', async () => {
    state.user = { id: 'user-1', email: 'florian@example.com' }
    state.jobListingsData = [
      {
        id: 'job-2',
        user_id: 'user-1',
        company: 'Canva',
        role: 'Staff Product Designer',
        title: 'Staff Product Designer',
        location: 'Remote',
        salary: null,
        salary_range: null,
        ats: 'Greenhouse',
        link: 'https://boards.greenhouse.io/canva/jobs/456',
        work_arrangement: 'Remote',
        qualification_score: 90,
        qualification_result: {
          // snake_case variant (component handles both)
          jd_keywords: ['storybook', 'tokens', 'accessibility'],
        },
        created_at: new Date().toISOString(),
        posted_at: new Date().toISOString(),
      },
    ]
    state.profileData = { id: 'user-1', name: 'Florian', email: 'florian@example.com' }

    const el = await mount(<OpenJobsView />)
    const h3 = el.querySelector('h3')
    await clickEl(h3!)

    const cta = findButtonByText(el, (t) => /Apply for me/i.test(t))
    expect(cta).not.toBeNull()
    await clickEl(cta!)

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const [, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string) as {
      jobs: Array<{ jdKeywords: string[] }>
    }
    expect(payload.jobs[0].jdKeywords).toEqual(['storybook', 'tokens', 'accessibility'])
  })

  it('shows an error and does NOT call fetch when the user has no profile row', async () => {
    state.user = { id: 'user-1', email: 'florian@example.com' }
    state.jobListingsData = [
      {
        id: 'job-3',
        user_id: 'user-1',
        company: 'Stripe',
        role: 'Senior Product Designer',
        title: 'Senior Product Designer',
        location: 'Remote',
        salary: null,
        salary_range: null,
        ats: 'Greenhouse',
        link: 'https://boards.greenhouse.io/stripe/jobs/789',
        work_arrangement: 'Remote',
        qualification_score: 88,
        qualification_result: { jdKeywords: [] },
        created_at: new Date().toISOString(),
        posted_at: new Date().toISOString(),
      },
    ]
    state.profileData = null // no profile row

    const el = await mount(<OpenJobsView />)
    const h3 = el.querySelector('h3')
    await clickEl(h3!)

    const cta = findButtonByText(el, (t) => /Apply for me/i.test(t))
    expect(cta).not.toBeNull()
    await clickEl(cta!)

    // Toast "Set up your profile before applying" should render
    const toast = findByText(el, (t) => /Set up your profile before applying/i.test(t))
    expect(toast).not.toBeNull()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
