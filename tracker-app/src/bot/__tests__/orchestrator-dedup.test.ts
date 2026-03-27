import { describe, it, expect } from 'vitest'

/**
 * Replicates the dedup logic from orchestrator.ts (lines 302-309):
 *
 *   const qualifySeenKeys = new Set<string>()
 *   const dedupedSurvivors = survivingJobs.filter(j => {
 *     const key = `${j.company.toLowerCase().trim()}|${j.title.toLowerCase().trim()}`
 *     if (qualifySeenKeys.has(key)) return false
 *     qualifySeenKeys.add(key)
 *     return true
 *   })
 */
interface JobLike {
  company: string
  title: string
  url?: string
}

function dedupJobs<T extends JobLike>(jobs: T[]): T[] {
  const seen = new Set<string>()
  return jobs.filter(j => {
    const key = `${j.company.toLowerCase().trim()}|${j.title.toLowerCase().trim()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

describe('orchestrator dedup logic', () => {
  it('removes duplicate company+title pairs', () => {
    const jobs: JobLike[] = [
      { company: 'Figma', title: 'Senior Designer', url: 'https://a.com' },
      { company: 'Figma', title: 'Senior Designer', url: 'https://b.com' },
      { company: 'Canva', title: 'Staff Designer', url: 'https://c.com' },
    ]
    const result = dedupJobs(jobs)
    expect(result).toHaveLength(2)
    expect(result[0].company).toBe('Figma')
    expect(result[1].company).toBe('Canva')
  })

  it('keeps the first occurrence when duplicates exist', () => {
    const jobs: JobLike[] = [
      { company: 'Grab', title: 'Product Designer', url: 'https://first.com' },
      { company: 'Grab', title: 'Product Designer', url: 'https://second.com' },
    ]
    const result = dedupJobs(jobs)
    expect(result).toHaveLength(1)
    expect(result[0].url).toBe('https://first.com')
  })

  it('is case-insensitive for company and title', () => {
    const jobs: JobLike[] = [
      { company: 'Figma', title: 'Senior Designer' },
      { company: 'FIGMA', title: 'senior designer' },
      { company: 'figma', title: 'SENIOR DESIGNER' },
    ]
    const result = dedupJobs(jobs)
    expect(result).toHaveLength(1)
  })

  it('trims whitespace when comparing', () => {
    const jobs: JobLike[] = [
      { company: '  Figma  ', title: '  Senior Designer  ' },
      { company: 'Figma', title: 'Senior Designer' },
    ]
    const result = dedupJobs(jobs)
    expect(result).toHaveLength(1)
  })

  it('does not remove jobs with same company but different title', () => {
    const jobs: JobLike[] = [
      { company: 'Figma', title: 'Senior Designer' },
      { company: 'Figma', title: 'Staff Designer' },
    ]
    const result = dedupJobs(jobs)
    expect(result).toHaveLength(2)
  })

  it('does not remove jobs with same title but different company', () => {
    const jobs: JobLike[] = [
      { company: 'Figma', title: 'Senior Designer' },
      { company: 'Canva', title: 'Senior Designer' },
    ]
    const result = dedupJobs(jobs)
    expect(result).toHaveLength(2)
  })

  it('returns empty array for empty input', () => {
    expect(dedupJobs([])).toHaveLength(0)
  })

  it('returns all items when there are no duplicates', () => {
    const jobs: JobLike[] = [
      { company: 'A', title: 'Role 1' },
      { company: 'B', title: 'Role 2' },
      { company: 'C', title: 'Role 3' },
    ]
    const result = dedupJobs(jobs)
    expect(result).toHaveLength(3)
  })
})
