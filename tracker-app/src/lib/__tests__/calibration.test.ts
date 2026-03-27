import { describe, it, expect } from 'vitest'
import { CALIBRATION_JOBS } from '../../data/calibration-jobs'
import type { CalibrationJob } from '../../data/calibration-jobs'

describe('CALIBRATION_JOBS', () => {
  it('has exactly 10 items', () => {
    expect(CALIBRATION_JOBS).toHaveLength(10)
  })

  it('each item has all required fields', () => {
    const requiredKeys: (keyof CalibrationJob)[] = [
      'id',
      'company',
      'role',
      'location',
      'matchScore',
      'matchReasons',
      'coverLetterSnippet',
      'expectedAction',
      'insight',
    ]

    for (const job of CALIBRATION_JOBS) {
      for (const key of requiredKeys) {
        expect(job).toHaveProperty(key)
      }
    }
  })

  it('each item has a unique id', () => {
    const ids = CALIBRATION_JOBS.map(j => j.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('expectedAction is either "approve" or "skip" for every item', () => {
    for (const job of CALIBRATION_JOBS) {
      expect(['approve', 'skip']).toContain(job.expectedAction)
    }
  })

  it('matchScore is a number between 0 and 100 for every item', () => {
    for (const job of CALIBRATION_JOBS) {
      expect(job.matchScore).toBeGreaterThanOrEqual(0)
      expect(job.matchScore).toBeLessThanOrEqual(100)
    }
  })

  it('matchReasons is a non-empty array for every item', () => {
    for (const job of CALIBRATION_JOBS) {
      expect(Array.isArray(job.matchReasons)).toBe(true)
      expect(job.matchReasons.length).toBeGreaterThan(0)
    }
  })

  it('company and role are non-empty strings', () => {
    for (const job of CALIBRATION_JOBS) {
      expect(job.company.length).toBeGreaterThan(0)
      expect(job.role.length).toBeGreaterThan(0)
    }
  })
})
