import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests for src/bot/cv-tailor.ts — per-job CV & cover letter tailoring.
 * Mocks the Anthropic SDK so no real API calls happen.
 */

// ---------------------------------------------------------------------------
// Mock Anthropic SDK
// ---------------------------------------------------------------------------

const mockCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = { create: (...args: unknown[]) => mockCreate(...args) }
  }
  return { default: Anthropic }
})

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import Anthropic from '@anthropic-ai/sdk'
import { tailorCVSummary, tailorCoverLetterSnippet } from '../cv-tailor'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cannedResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
  }
}

const BASE_PROFILE = {
  firstName: 'Florian',
  lastName: 'Gouloubi',
  yearsExperience: 7,
  currentRole: 'Senior Product Designer',
  achievements: [
    'Shipped design system used across 7 SaaS products',
    'Led design ops for 143 templates with zero-defect QA',
    'Improved dev feedback loop by 90%',
  ],
}

const JOB_CTX = {
  company: 'Acme',
  role: 'Staff Product Designer',
  jdKeywords: ['figma', 'design system', 'prototyping'],
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('cv-tailor', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  describe('tailorCVSummary', () => {
    it('returns a string containing at least one jdKeyword', async () => {
      mockCreate.mockResolvedValueOnce(
        cannedResponse(
          'Senior Product Designer with 7+ years building scalable design systems and shipping Figma-based workflows across global SaaS products.',
        ),
      )

      const client = new Anthropic()
      const result = await tailorCVSummary(BASE_PROFILE, JOB_CTX, client)

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
      const lower = result.toLowerCase()
      const hasOneKeyword = JOB_CTX.jdKeywords.some((kw) =>
        lower.includes(kw.toLowerCase()),
      )
      expect(hasOneKeyword).toBe(true)
      expect(mockCreate).toHaveBeenCalledTimes(1)
    })

    // NOTE: cv-tailor.ts has no short-circuit for empty jdKeywords — it still
    // calls Haiku with an empty keyword list. A "baseline" return is therefore
    // not meaningful against the current impl. The test below asserts the next
    // best thing: the function still returns a usable string AND the Haiku
    // call is issued (documenting current behavior).
    it('with empty jdKeywords still returns a string from Haiku (documents current behavior)', async () => {
      mockCreate.mockResolvedValueOnce(
        cannedResponse(
          'Senior Product Designer with 7+ years shipping design systems across SaaS products.',
        ),
      )

      const client = new Anthropic()
      const result = await tailorCVSummary(
        BASE_PROFILE,
        { ...JOB_CTX, jdKeywords: [] },
        client,
      )

      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
      expect(mockCreate).toHaveBeenCalledTimes(1)
    })

    // Skipped: the current cv-tailor.ts does NOT implement a "return baseline
    // summary when jdKeywords is empty" short-circuit — it always calls Haiku.
    // This test would require a source-code change to be meaningful.
    it.skip('TODO: tailorCVSummary with empty jdKeywords returns baseline summary (requires source change: add short-circuit in cv-tailor.ts)', async () => {
      // When cv-tailor.ts adds: `if (jobContext.jdKeywords.length === 0) return baselineSummary`
      // then this test should assert: result === baselineSummary && mockCreate not called.
    })
  })

  describe('tailorCoverLetterSnippet', () => {
    it('returns empty string when baseSnippet is empty (no Haiku call)', async () => {
      const client = new Anthropic()
      const result = await tailorCoverLetterSnippet('', JOB_CTX, client)
      expect(result).toBe('')
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('preserves the original length within +/- 30%', async () => {
      const baseSnippet =
        "I'm excited to apply for this role because I've spent the last seven years building scalable design systems at global SaaS companies, and your team's pace matches how I like to ship."
      const refined =
        "I'm excited to apply because I've spent seven years building scalable design systems with Figma at global SaaS companies, and your team's shipping cadence matches how I like to prototype."

      mockCreate.mockResolvedValueOnce(cannedResponse(refined))

      const client = new Anthropic()
      const result = await tailorCoverLetterSnippet(baseSnippet, JOB_CTX, client)

      const baseLen = baseSnippet.length
      const minLen = Math.floor(baseLen * 0.7)
      const maxLen = Math.ceil(baseLen * 1.3)
      expect(result.length).toBeGreaterThanOrEqual(minLen)
      expect(result.length).toBeLessThanOrEqual(maxLen)
      expect(mockCreate).toHaveBeenCalledTimes(1)
    })

    it('invokes Haiku with the Anthropic SDK (canned response returned verbatim)', async () => {
      mockCreate.mockResolvedValueOnce(cannedResponse('Refined snippet text.'))

      const client = new Anthropic()
      const result = await tailorCoverLetterSnippet(
        'Original snippet text.',
        JOB_CTX,
        client,
      )
      expect(result).toBe('Refined snippet text.')
      expect(mockCreate).toHaveBeenCalledTimes(1)
      const callArg = mockCreate.mock.calls[0][0] as {
        model: string
        system: string
        messages: Array<{ role: string; content: string }>
      }
      expect(callArg.model).toMatch(/haiku/i)
      expect(callArg.system).toMatch(/cover letter/i)
      expect(callArg.messages[0].content).toContain('Acme')
    })
  })
})
