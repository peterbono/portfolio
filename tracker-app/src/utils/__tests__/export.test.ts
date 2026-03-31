import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Job } from '../../types/job'

// ═══════════════════════════════════════════════════════════════════════
//  Mock DOM APIs (jsdom doesn't fully support URL.createObjectURL)
// ═══════════════════════════════════════════════════════════════════════

let capturedContents: string[] = []
let capturedTypes: string[] = []
let capturedFilename: string | null = null

beforeEach(() => {
  capturedContents = []
  capturedTypes = []
  capturedFilename = null

  // Mock URL.createObjectURL to intercept the Blob content
  // jsdom Blob doesn't support .text(), so we capture the raw parts passed to constructor
  const OriginalBlob = globalThis.Blob
  vi.stubGlobal('Blob', class MockBlob extends OriginalBlob {
    constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
      super(parts, options)
      // Capture the string content directly from the parts
      const content = (parts ?? []).map(p => typeof p === 'string' ? p : '').join('')
      capturedContents.push(content)
      capturedTypes.push(options?.type ?? '')
    }
  })

  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-url')
  globalThis.URL.revokeObjectURL = vi.fn()

  // Mock document.createElement to capture the download anchor
  const originalCreateElement = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
    const el = originalCreateElement(tag, options)
    if (tag === 'a') {
      // Spy on click rather than redefining it (click is non-configurable in jsdom)
      vi.spyOn(el, 'click').mockImplementation(() => {
        capturedFilename = (el as HTMLAnchorElement).download
      })
    }
    return el
  })

  vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => node)
  vi.spyOn(document.body, 'removeChild').mockImplementation((node: Node) => node)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'j1',
    date: '2026-03-28',
    status: 'submitted',
    role: 'Product Designer',
    company: 'Stripe',
    location: 'Remote',
    salary: '120k',
    ats: 'greenhouse',
    cv: 'uploaded',
    portfolio: 'linked',
    link: 'https://example.com/job',
    notes: '',
    source: 'auto',
    ...overrides,
  }
}

function getLastContent(): string {
  return capturedContents[capturedContents.length - 1]
}

function getLastType(): string {
  return capturedTypes[capturedTypes.length - 1]
}

// ═══════════════════════════════════════════════════════════════════════
//  Import module under test
// ═══════════════════════════════════════════════════════════════════════

import { exportAsCSV, exportAsJSON } from '../export'

// ═══════════════════════════════════════════════════════════════════════
//  CSV Export
// ═══════════════════════════════════════════════════════════════════════

describe('exportAsCSV', () => {
  it('generates CSV with correct MIME type', () => {
    exportAsCSV([])
    expect(getLastType()).toBe('text/csv;charset=utf-8')
  })

  it('CSV header contains all expected columns', () => {
    exportAsCSV([makeJob()])
    expect(getLastContent()).toContain('Date,Status,Company,Role,Location,Salary,Link,Source,Notes')
  })

  it('includes BOM for Excel UTF-8 compatibility', () => {
    exportAsCSV([makeJob()])
    expect(getLastContent().charCodeAt(0)).toBe(0xFEFF)
  })

  it('generates correct row data', () => {
    exportAsCSV([makeJob({ date: '2026-03-28', company: 'Stripe', role: 'Designer', location: 'Remote' })])
    const lines = getLastContent().split('\r\n')
    // line 0 = BOM + header, line 1 = data row
    expect(lines[1]).toContain('2026-03-28')
    expect(lines[1]).toContain('Submitted') // status label from STATUS_CONFIG
    expect(lines[1]).toContain('Stripe')
    expect(lines[1]).toContain('Designer')
    expect(lines[1]).toContain('Remote')
  })

  it('properly escapes commas in values', () => {
    exportAsCSV([makeJob({ company: 'Acme, Inc.' })])
    expect(getLastContent()).toContain('"Acme, Inc."')
  })

  it('properly escapes double quotes in values', () => {
    exportAsCSV([makeJob({ notes: 'Said "hello" to recruiter' })])
    expect(getLastContent()).toContain('"Said ""hello"" to recruiter"')
  })

  it('properly escapes newlines in values', () => {
    exportAsCSV([makeJob({ notes: 'Line 1\nLine 2' })])
    expect(getLastContent()).toContain('"Line 1\nLine 2"')
  })

  it('handles empty array producing header only', () => {
    exportAsCSV([])
    const lines = getLastContent().split('\r\n').filter(Boolean)
    expect(lines.length).toBe(1) // just header
    expect(lines[0]).toContain('Date')
  })

  it('uses provided filename', () => {
    exportAsCSV([makeJob()], 'custom-export.csv')
    expect(capturedFilename).toBe('custom-export.csv')
  })

  it('generates default filename with date stamp', () => {
    exportAsCSV([makeJob()])
    expect(capturedFilename).toMatch(/^jobs-export-\d{4}-\d{2}-\d{2}\.csv$/)
  })

  it('handles multiple jobs', () => {
    const jobs = [
      makeJob({ id: 'j1', company: 'Alpha' }),
      makeJob({ id: 'j2', company: 'Beta' }),
      makeJob({ id: 'j3', company: 'Gamma' }),
    ]
    exportAsCSV(jobs)
    const lines = getLastContent().split('\r\n').filter(Boolean)
    expect(lines.length).toBe(4) // header + 3 rows
  })

  it('handles jobs with empty/undefined optional fields', () => {
    const job = makeJob({ salary: '', notes: '', source: undefined })
    exportAsCSV([job])
    expect(getLastContent()).toContain('Date')
  })

  it('handles carriage return in values', () => {
    exportAsCSV([makeJob({ notes: 'Line 1\r\nLine 2' })])
    expect(getLastContent()).toContain('"Line 1\r\nLine 2"')
  })

  it('cleans up object URL after download', () => {
    exportAsCSV([makeJob()])
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  JSON Export
// ═══════════════════════════════════════════════════════════════════════

describe('exportAsJSON', () => {
  it('generates valid JSON', () => {
    exportAsJSON([makeJob()])
    expect(() => JSON.parse(getLastContent())).not.toThrow()
  })

  it('JSON contains all job data', () => {
    exportAsJSON([makeJob({ company: 'TestCo', role: 'Designer' })])
    const parsed = JSON.parse(getLastContent())
    expect(parsed).toHaveLength(1)
    expect(parsed[0].company).toBe('TestCo')
    expect(parsed[0].role).toBe('Designer')
  })

  it('JSON output is pretty-printed (indented)', () => {
    exportAsJSON([makeJob()])
    const text = getLastContent()
    expect(text).toContain('\n')
    expect(text).toContain('  ')
  })

  it('handles empty array', () => {
    exportAsJSON([])
    const parsed = JSON.parse(getLastContent())
    expect(parsed).toEqual([])
  })

  it('uses application/json MIME type', () => {
    exportAsJSON([makeJob()])
    expect(getLastType()).toBe('application/json')
  })

  it('uses provided filename', () => {
    exportAsJSON([makeJob()], 'my-jobs.json')
    expect(capturedFilename).toBe('my-jobs.json')
  })

  it('generates default filename with date stamp', () => {
    exportAsJSON([makeJob()])
    expect(capturedFilename).toMatch(/^jobs-export-\d{4}-\d{2}-\d{2}\.json$/)
  })

  it('preserves special characters in JSON', () => {
    const jobs = [makeJob({ company: 'O\'Reilly & "Sons"', notes: 'Line 1\nLine 2' })]
    exportAsJSON(jobs)
    const parsed = JSON.parse(getLastContent())
    expect(parsed[0].company).toBe('O\'Reilly & "Sons"')
    expect(parsed[0].notes).toBe('Line 1\nLine 2')
  })
})
