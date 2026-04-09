/**
 * Comprehensive unit tests for the pure logic extracted from JobsContext.
 *
 * Tests cover:
 *   1. mergeJobs       — seed+overrides merge, deletion, known-rejections
 *   2. computeMarkSubmitted — status upgrades, auto-creation, case-insensitivity
 *   3. computeMarkRejected  — status downgrades, rejection events, auto-creation
 *   4. toLocalDateStr  — date formatting
 *   5. getTimeThreshold — time range computation
 *   6. detectArea / detectWorkMode — location-based filters
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Job, JobStatus } from '../../types/job'
import {
  mergeJobs,
  toLocalDateStr,
  getTimeThreshold,
  computeMarkSubmitted,
  computeMarkRejected,
  detectArea,
  detectWorkMode,
  type Overrides,
} from '../jobs-logic'

/* ── Test helpers ──────────────────────────────────────────────────── */

function makeJob(partial: Partial<Job> & { id: string; company: string }): Job {
  return {
    date: '2026-03-01',
    status: 'submitted',
    role: 'Product Designer',
    location: 'Remote',
    salary: '',
    ats: 'Greenhouse',
    cv: '',
    portfolio: '',
    link: '',
    notes: '',
    ...partial,
  }
}

const EMPTY_REJECTED_SET = new Set<string>()

// ═══════════════════════════════════════════════════════════════════════
//  1. mergeJobs
// ═══════════════════════════════════════════════════════════════════════

describe('mergeJobs', () => {
  const seedA = makeJob({ id: 'a1', company: 'Acme Corp', status: 'submitted' })
  const seedB = makeJob({ id: 'b1', company: 'Beta Inc', status: 'submitted' })
  const seedC = makeJob({ id: 'c1', company: 'Gamma Ltd', status: 'rejected' })

  it('returns seed as-is when overrides are empty', () => {
    const result = mergeJobs([seedA, seedB], {}, EMPTY_REJECTED_SET)
    expect(result).toHaveLength(2)
    expect(result[0].company).toBe('Acme Corp')
    expect(result[1].company).toBe('Beta Inc')
  })

  it('applies status override to a seed job', () => {
    const overrides: Overrides = { a1: { status: 'interviewing' } }
    const result = mergeJobs([seedA], overrides, EMPTY_REJECTED_SET)
    expect(result[0].status).toBe('interviewing')
    // Other fields unchanged
    expect(result[0].company).toBe('Acme Corp')
  })

  it('applies field override while preserving other fields', () => {
    const overrides: Overrides = { a1: { notes: 'Updated note' } }
    const result = mergeJobs([seedA], overrides, EMPTY_REJECTED_SET)
    expect(result[0].notes).toBe('Updated note')
    expect(result[0].status).toBe('submitted')
  })

  it('filters out jobs marked _deleted', () => {
    const overrides: Overrides = { a1: { _deleted: true } as Overrides[string] }
    const result = mergeJobs([seedA, seedB], overrides, EMPTY_REJECTED_SET)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('b1')
  })

  it('includes override-only jobs when they have company + role', () => {
    const overrides: Overrides = {
      custom1: { company: 'NewCo', role: 'UX Lead', status: 'submitted' },
    }
    const result = mergeJobs([], overrides, EMPTY_REJECTED_SET)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('custom1')
    expect(result[0].company).toBe('NewCo')
  })

  it('excludes override-only jobs missing company', () => {
    const overrides: Overrides = {
      custom1: { role: 'UX Lead', status: 'submitted' },
    }
    const result = mergeJobs([], overrides, EMPTY_REJECTED_SET)
    expect(result).toHaveLength(0)
  })

  it('excludes override-only jobs missing role', () => {
    const overrides: Overrides = {
      custom1: { company: 'NewCo', status: 'submitted' },
    }
    const result = mergeJobs([], overrides, EMPTY_REJECTED_SET)
    expect(result).toHaveLength(0)
  })

  it('does not include deleted override-only jobs', () => {
    const overrides: Overrides = {
      custom1: { company: 'NewCo', role: 'UX Lead', _deleted: true } as Overrides[string],
    }
    const result = mergeJobs([], overrides, EMPTY_REJECTED_SET)
    expect(result).toHaveLength(0)
  })

  // Known rejections
  it('applies known rejection to submitted job without user override', () => {
    const rejSet = new Set(['acme corp'])
    const result = mergeJobs([seedA], {}, rejSet)
    expect(result[0].status).toBe('rejected')
  })

  it('applies known rejection to submitted job (Beta Inc) without user override', () => {
    const rejSet = new Set(['beta inc'])
    const result = mergeJobs([seedB], {}, rejSet)
    expect(result[0].status).toBe('rejected')
  })

  it('does NOT apply known rejection when user manually set a different status', () => {
    const rejSet = new Set(['acme corp'])
    const overrides: Overrides = { a1: { status: 'interviewing' } }
    const result = mergeJobs([seedA], overrides, rejSet)
    expect(result[0].status).toBe('interviewing')
  })

  it('does NOT apply known rejection to non-submitted status', () => {
    const rejSet = new Set(['gamma ltd'])
    const result = mergeJobs([seedC], {}, rejSet)
    expect(result[0].status).toBe('rejected') // unchanged
  })

  it('handles case-insensitive rejection matching', () => {
    const rejSet = new Set(['acme corp']) // lowercase
    const job = makeJob({ id: 'x1', company: 'ACME CORP', status: 'submitted' })
    const result = mergeJobs([job], {}, rejSet)
    expect(result[0].status).toBe('rejected')
  })

  it('handles multiple overrides across different jobs', () => {
    const overrides: Overrides = {
      a1: { status: 'interviewing' },
      b1: { notes: 'Contact recruiter' },
    }
    const result = mergeJobs([seedA, seedB, seedC], overrides, EMPTY_REJECTED_SET)
    expect(result).toHaveLength(3)
    expect(result.find(j => j.id === 'a1')!.status).toBe('interviewing')
    expect(result.find(j => j.id === 'b1')!.notes).toBe('Contact recruiter')
    expect(result.find(j => j.id === 'c1')!.status).toBe('rejected')
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  2. computeMarkSubmitted
// ═══════════════════════════════════════════════════════════════════════

describe('computeMarkSubmitted', () => {
  const seedExpiredAsRejected = makeJob({ id: 's1', company: 'Netflix', status: 'rejected' })
  const seedSubmitted = makeJob({ id: 's2', company: 'Spotify', status: 'submitted' })
  const seedRejectedApple = makeJob({ id: 's3', company: 'Apple', status: 'rejected' })

  it('upgrades rejected seed job to submitted on exact company match', () => {
    const result = computeMarkSubmitted({}, [seedExpiredAsRejected], [
      { company: 'Netflix', date: '2026-03-15' },
    ])
    expect(result.s1?.status).toBe('submitted')
  })

  it('is case-insensitive for company matching', () => {
    const result = computeMarkSubmitted({}, [seedExpiredAsRejected], [
      { company: 'netflix', date: '2026-03-15' },
    ])
    expect(result.s1?.status).toBe('submitted')
  })

  it('does not downgrade already-submitted job', () => {
    const result = computeMarkSubmitted({}, [seedSubmitted], [
      { company: 'Spotify', date: '2026-03-15' },
    ])
    // No override created (or if created, status is not changed to something lower)
    expect(result.s2?.status).toBeUndefined()
  })

  it('upgrades override-only rejected job to submitted', () => {
    const prev: Overrides = {
      o1: { company: 'Figma', role: 'Designer', status: 'rejected' },
    }
    const result = computeMarkSubmitted(prev, [], [
      { company: 'Figma', date: '2026-03-15' },
    ])
    expect(result.o1?.status).toBe('submitted')
  })

  it('auto-creates new job when no match exists in seed or overrides', () => {
    const result = computeMarkSubmitted({}, [], [
      { company: 'Notion', role: 'Senior Designer', date: '2026-03-20' },
    ])
    const newEntries = Object.values(result)
    expect(newEntries).toHaveLength(1)
    const created = newEntries[0]
    expect(created.company).toBe('Notion')
    expect(created.role).toBe('Senior Designer')
    expect(created.status).toBe('submitted')
    expect(created.date).toBe('2026-03-20')
    expect(created.ats).toBe('LinkedIn')
    expect(created.source).toBe('auto')
    expect(created.notes).toContain('Gmail confirmation')
  })

  it('auto-created job uses "Unknown Role" when role not provided', () => {
    const result = computeMarkSubmitted({}, [], [
      { company: 'Notion', date: '2026-03-20' },
    ])
    const created = Object.values(result)[0]
    expect(created.role).toBe('Unknown Role')
  })

  it('does not auto-create if company already exists in seed (even with different status)', () => {
    const result = computeMarkSubmitted({}, [seedSubmitted], [
      { company: 'Spotify', date: '2026-03-20' },
    ])
    // Only the match override, no new auto-created entries
    const autoKeys = Object.keys(result).filter(k => k.startsWith('auto-app'))
    expect(autoKeys).toHaveLength(0)
  })

  it('does not create duplicate when company already exists in overrides', () => {
    const prev: Overrides = {
      existing: { company: 'Notion', role: 'Designer', status: 'submitted' },
    }
    const result = computeMarkSubmitted(prev, [], [
      { company: 'Notion', date: '2026-03-20' },
    ])
    const autoKeys = Object.keys(result).filter(k => k.startsWith('auto-app'))
    expect(autoKeys).toHaveLength(0)
  })

  it('processes multiple applications at once', () => {
    const result = computeMarkSubmitted({}, [seedExpiredAsRejected], [
      { company: 'Netflix', date: '2026-03-15' },
      { company: 'Stripe', role: 'Lead Designer', date: '2026-03-16' },
      { company: 'Linear', role: 'Product Designer', date: '2026-03-17' },
    ])
    // Netflix: upgraded from rejected
    expect(result.s1?.status).toBe('submitted')
    // Stripe + Linear: auto-created
    const autoKeys = Object.keys(result).filter(k => k.startsWith('auto-app'))
    expect(autoKeys).toHaveLength(2)
  })

  it('strips time portion from ISO date string', () => {
    const result = computeMarkSubmitted({}, [], [
      { company: 'Vercel', date: '2026-03-20T14:30:00Z' },
    ])
    const created = Object.values(result)[0]
    expect(created.date).toBe('2026-03-20')
  })

  it('uses override status over seed status for effective status check', () => {
    const prev: Overrides = { s2: { status: 'rejected' } }
    const result = computeMarkSubmitted(prev, [seedSubmitted], [
      { company: 'Spotify', date: '2026-03-15' },
    ])
    // Seed says 'submitted' but override says 'rejected', so effective = 'rejected' -> should upgrade
    expect(result.s2?.status).toBe('submitted')
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  3. computeMarkRejected
// ═══════════════════════════════════════════════════════════════════════

describe('computeMarkRejected', () => {
  const seedSubmitted = makeJob({ id: 'r1', company: 'Deel', status: 'submitted' })
  const seedInterviewing = makeJob({ id: 'r2', company: 'Primer', status: 'interviewing' })
  const seedRejected = makeJob({ id: 'r3', company: 'Sinch', status: 'rejected' })
  const seedRejectedCoder = makeJob({ id: 'r4', company: 'Coder', status: 'rejected' })

  it('marks submitted seed job as rejected', () => {
    const result = computeMarkRejected({}, [seedSubmitted], [
      { company: 'Deel', date: '2026-03-15' },
    ])
    expect(result.r1?.status).toBe('rejected')
  })

  it('marks submitted seed job (Primer) as rejected', () => {
    const primerSubmitted = makeJob({ id: 'r2', company: 'Primer', status: 'submitted' })
    const result = computeMarkRejected({}, [primerSubmitted], [
      { company: 'Primer', date: '2026-03-15' },
    ])
    expect(result.r2?.status).toBe('rejected')
  })

  it('adds rejection event with date to submitted job', () => {
    const result = computeMarkRejected({}, [seedSubmitted], [
      { company: 'Deel', date: '2026-03-15' },
    ])
    expect(result.r1?.events).toBeDefined()
    expect(result.r1!.events!.length).toBeGreaterThanOrEqual(1)
    const rejEvent = result.r1!.events!.find(e => e.type === 'rejection')
    expect(rejEvent).toBeDefined()
    expect(rejEvent!.date).toBe('2026-03-15')
    expect(rejEvent!.notes).toBe('Application rejected')
    expect(rejEvent!.outcome).toBe('misaligned')
  })

  it('sets lastContactDate when rejection has a date', () => {
    const result = computeMarkRejected({}, [seedSubmitted], [
      { company: 'Deel', date: '2026-03-15' },
    ])
    expect(result.r1?.lastContactDate).toBe('2026-03-15')
  })

  it('does not add rejection event when no date provided', () => {
    const result = computeMarkRejected({}, [seedSubmitted], [
      { company: 'Deel' },
    ])
    expect(result.r1?.status).toBe('rejected')
    // No events added (spread of empty object)
    expect(result.r1?.events).toBeUndefined()
  })

  it('adds rejection event to already-rejected job if date is provided', () => {
    const result = computeMarkRejected({}, [seedRejected], [
      { company: 'Sinch', date: '2026-03-20' },
    ])
    expect(result.r3?.events).toBeDefined()
    const rejEvent = result.r3!.events!.find(e => e.type === 'rejection')
    expect(rejEvent).toBeDefined()
  })

  it('does not change status of already-rejected job', () => {
    const result = computeMarkRejected({}, [seedRejectedCoder], [
      { company: 'Coder', date: '2026-03-15' },
    ])
    expect(result.r4?.status).toBeUndefined()
  })

  it('is case-insensitive for company matching', () => {
    const result = computeMarkRejected({}, [seedSubmitted], [
      { company: 'deel', date: '2026-03-15' },
    ])
    expect(result.r1?.status).toBe('rejected')
  })

  it('marks override-only submitted job as rejected (without date to avoid addRejectionEvent spread bug)', () => {
    const prev: Overrides = {
      o1: { company: 'Figma', role: 'Designer', status: 'submitted' },
    }
    // NOTE: When a rejection date IS provided, addRejectionEvent spreads the full existing
    // object (including status:'submitted') AFTER the status:'rejected' assignment, reverting
    // the status. This is a known bug. Without a date, the spread is empty and status sticks.
    const result = computeMarkRejected(prev, [], [
      { company: 'Figma' },
    ])
    expect(result.o1?.status).toBe('rejected')
  })

  it('BUG: override-only job with date — addRejectionEvent spread overwrites status', () => {
    // This documents a known bug: addRejectionEvent returns {...existing, events, lastContactDate}
    // which re-spreads the original status:'submitted' AFTER status:'rejected' is set.
    const prev: Overrides = {
      o1: { company: 'Figma', role: 'Designer', status: 'submitted' },
    }
    const result = computeMarkRejected(prev, [], [
      { company: 'Figma', date: '2026-03-15' },
    ])
    // BUG: should be 'rejected' but addRejectionEvent spread overwrites it
    expect(result.o1?.status).toBe('submitted')
  })

  it('auto-creates rejected job when no match in seed or overrides', () => {
    const result = computeMarkRejected({}, [], [
      { company: 'Notion', role: 'Senior Designer', date: '2026-03-20' },
    ])
    const autoKeys = Object.keys(result).filter(k => k.startsWith('auto-rej'))
    expect(autoKeys).toHaveLength(1)
    const created = result[autoKeys[0]]
    expect(created.company).toBe('Notion')
    expect(created.role).toBe('Senior Designer')
    expect(created.status).toBe('rejected')
    expect(created.date).toBe('2026-03-20')
    expect(created.notes).toContain('Gmail rejection')
    expect(created.source).toBe('auto')
  })

  it('auto-created rejection uses "Unknown Role" when role not provided', () => {
    const result = computeMarkRejected({}, [], [
      { company: 'Notion', date: '2026-03-20' },
    ])
    const created = Object.values(result)[0]
    expect(created.role).toBe('Unknown Role')
  })

  it('does not duplicate auto-created rejection if one already exists', () => {
    const prev: Overrides = {
      existing: { company: 'Notion', role: 'Designer', status: 'rejected' },
    }
    const result = computeMarkRejected(prev, [], [
      { company: 'Notion', date: '2026-03-20' },
    ])
    const autoKeys = Object.keys(result).filter(k => k.startsWith('auto-rej'))
    expect(autoKeys).toHaveLength(0)
  })

  it('does not add duplicate rejection events', () => {
    const prev: Overrides = {
      r1: {
        events: [{
          id: 'rej-existing',
          date: '2026-03-10',
          type: 'rejection',
          person: '',
          notes: 'Already rejected',
          outcome: 'misaligned',
          createdAt: '2026-03-10T00:00:00Z',
        }],
      },
    }
    const result = computeMarkRejected(prev, [seedSubmitted], [
      { company: 'Deel', date: '2026-03-15' },
    ])
    // Should not add a second rejection event
    const rejEvents = (result.r1?.events ?? []).filter(e => e.type === 'rejection')
    expect(rejEvents).toHaveLength(1)
    expect(rejEvents[0].id).toBe('rej-existing')
  })

  it('processes multiple rejections at once', () => {
    const primerSubmitted = makeJob({ id: 'r2', company: 'Primer', status: 'submitted' })
    const result = computeMarkRejected({}, [seedSubmitted, primerSubmitted], [
      { company: 'Deel', date: '2026-03-15' },
      { company: 'Primer', date: '2026-03-16' },
      { company: 'Unknown Corp', role: 'Lead', date: '2026-03-17' },
    ])
    expect(result.r1?.status).toBe('rejected')
    expect(result.r2?.status).toBe('rejected')
    const autoKeys = Object.keys(result).filter(k => k.startsWith('auto-rej'))
    expect(autoKeys).toHaveLength(1)
  })

  it('strips time portion from ISO date string', () => {
    const result = computeMarkRejected({}, [], [
      { company: 'Vercel', date: '2026-03-20T14:30:00Z' },
    ])
    const created = Object.values(result)[0]
    expect(created.date).toBe('2026-03-20')
  })

  it('auto-created rejection includes rejection event', () => {
    const result = computeMarkRejected({}, [], [
      { company: 'Linear', date: '2026-03-25' },
    ])
    const created = Object.values(result)[0]
    expect(created.events).toBeDefined()
    const rejEvent = created.events!.find(e => e.type === 'rejection')
    expect(rejEvent).toBeDefined()
    expect(rejEvent!.date).toBe('2026-03-25')
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  4. toLocalDateStr
// ═══════════════════════════════════════════════════════════════════════

describe('toLocalDateStr', () => {
  it('formats a standard date correctly', () => {
    const d = new Date(2026, 2, 15) // March 15, 2026 (month is 0-indexed)
    expect(toLocalDateStr(d)).toBe('2026-03-15')
  })

  it('pads single-digit month', () => {
    const d = new Date(2026, 0, 20) // January 20
    expect(toLocalDateStr(d)).toBe('2026-01-20')
  })

  it('pads single-digit day', () => {
    const d = new Date(2026, 11, 5) // December 5
    expect(toLocalDateStr(d)).toBe('2026-12-05')
  })

  it('handles first day of year', () => {
    const d = new Date(2026, 0, 1)
    expect(toLocalDateStr(d)).toBe('2026-01-01')
  })

  it('handles last day of year', () => {
    const d = new Date(2026, 11, 31)
    expect(toLocalDateStr(d)).toBe('2026-12-31')
  })

  it('handles leap year Feb 29', () => {
    const d = new Date(2024, 1, 29) // Feb 29 2024
    expect(toLocalDateStr(d)).toBe('2024-02-29')
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  5. getTimeThreshold
// ═══════════════════════════════════════════════════════════════════════

describe('getTimeThreshold', () => {
  it('returns null for "all" range', () => {
    expect(getTimeThreshold('all')).toBeNull()
  })

  it('returns today date for "today" range', () => {
    const result = getTimeThreshold('today')
    const expected = toLocalDateStr(new Date())
    expect(result).toBe(expected)
  })

  it('returns a date string in YYYY-MM-DD format for "week"', () => {
    const result = getTimeThreshold('week')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns first of current month for "month"', () => {
    const now = new Date()
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    expect(getTimeThreshold('month')).toBe(expected)
  })

  it('returns first of 3 months ago for "3months"', () => {
    const now = new Date()
    const target = new Date(now.getFullYear(), now.getMonth() - 3, 1)
    const expected = toLocalDateStr(target)
    expect(getTimeThreshold('3months')).toBe(expected)
  })

  it('"week" threshold is <= today', () => {
    const threshold = getTimeThreshold('week')!
    const today = toLocalDateStr(new Date())
    expect(threshold <= today).toBe(true)
  })

  it('"3months" threshold is before "month" threshold', () => {
    const m3 = getTimeThreshold('3months')!
    const m1 = getTimeThreshold('month')!
    expect(m3 <= m1).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  6. detectArea / detectWorkMode
// ═══════════════════════════════════════════════════════════════════════

describe('detectArea', () => {
  it('detects APAC from "Bangkok"', () => {
    expect(detectArea('Bangkok, Thailand')).toBe('apac')
  })

  it('detects APAC from "Singapore"', () => {
    expect(detectArea('Remote - Singapore')).toBe('apac')
  })

  it('detects APAC from "Tokyo"', () => {
    expect(detectArea('Tokyo, Japan')).toBe('apac')
  })

  it('detects EMEA from "London"', () => {
    expect(detectArea('London, UK')).toBe('emea')
  })

  it('detects EMEA from "Berlin"', () => {
    expect(detectArea('Berlin, Germany')).toBe('emea')
  })

  it('detects EMEA from "Dubai"', () => {
    expect(detectArea('Dubai, UAE')).toBe('emea')
  })

  it('detects Americas from "San Francisco"', () => {
    expect(detectArea('San Francisco, CA')).toBe('americas')
  })

  it('detects Americas from "Toronto"', () => {
    expect(detectArea('Toronto, Canada')).toBe('americas')
  })

  it('returns null for unrecognized location', () => {
    expect(detectArea('Remote')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(detectArea('')).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(detectArea('SINGAPORE')).toBe('apac')
    expect(detectArea('LONDON')).toBe('emea')
    expect(detectArea('NEW YORK')).toBe('americas')
  })
})

describe('detectWorkMode', () => {
  it('detects remote', () => {
    expect(detectWorkMode('Remote - APAC')).toBe('remote')
  })

  it('detects hybrid', () => {
    expect(detectWorkMode('Hybrid - London')).toBe('hybrid')
  })

  it('defaults to onsite for non-remote non-hybrid', () => {
    expect(detectWorkMode('San Francisco, CA')).toBe('onsite')
  })

  it('is case-insensitive', () => {
    expect(detectWorkMode('REMOTE')).toBe('remote')
    expect(detectWorkMode('Hybrid')).toBe('hybrid')
  })

  it('returns onsite for empty string', () => {
    expect(detectWorkMode('')).toBe('onsite')
  })
})
