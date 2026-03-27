import { describe, it, expect } from 'vitest'
import {
  COVER_LETTER_VARIANTS,
  VARIANT_PROMPTS,
  VARIANT_LABELS,
} from '../../types/intelligence'
import type { CoverLetterVariant } from '../../types/intelligence'

describe('COVER_LETTER_VARIANTS', () => {
  it('has exactly 5 entries', () => {
    expect(COVER_LETTER_VARIANTS).toHaveLength(5)
  })

  it('each entry is a non-empty string', () => {
    for (const variant of COVER_LETTER_VARIANTS) {
      expect(typeof variant).toBe('string')
      expect(variant.length).toBeGreaterThan(0)
    }
  })
})

describe('VARIANT_PROMPTS', () => {
  it('has a key for every variant in COVER_LETTER_VARIANTS', () => {
    for (const variant of COVER_LETTER_VARIANTS) {
      expect(VARIANT_PROMPTS).toHaveProperty(variant)
    }
  })

  it('has exactly the same keys as COVER_LETTER_VARIANTS', () => {
    const promptKeys = Object.keys(VARIANT_PROMPTS).sort()
    const variantKeys = [...COVER_LETTER_VARIANTS].sort()
    expect(promptKeys).toEqual(variantKeys)
  })

  it('each prompt is a non-empty string', () => {
    for (const variant of COVER_LETTER_VARIANTS) {
      const prompt = VARIANT_PROMPTS[variant]
      expect(typeof prompt).toBe('string')
      expect(prompt.length).toBeGreaterThan(0)
    }
  })
})

describe('VARIANT_LABELS', () => {
  it('has a key for every variant in COVER_LETTER_VARIANTS', () => {
    for (const variant of COVER_LETTER_VARIANTS) {
      expect(VARIANT_LABELS).toHaveProperty(variant)
    }
  })

  it('has exactly the same keys as COVER_LETTER_VARIANTS', () => {
    const labelKeys = Object.keys(VARIANT_LABELS).sort()
    const variantKeys = [...COVER_LETTER_VARIANTS].sort()
    expect(labelKeys).toEqual(variantKeys)
  })

  it('each label is a non-empty string', () => {
    for (const variant of COVER_LETTER_VARIANTS) {
      const label = VARIANT_LABELS[variant]
      expect(typeof label).toBe('string')
      expect(label.length).toBeGreaterThan(0)
    }
  })
})
