import { describe, it, expect } from 'vitest'
import { decidePipeline } from '../pipeline-dispatcher'
import type { PipelineDecision } from '../pipeline-dispatcher'

// ═══════════════════════════════════════════════════════════════════════
//  Auto mode — tier-aware routing
// ═══════════════════════════════════════════════════════════════════════

describe('decidePipeline — auto mode', () => {
  it('free + extension available → extension for scout/apply, server for qualify', () => {
    const d = decidePipeline('free', 'auto', true, false)
    expect(d.scout).toBe('extension')
    expect(d.qualify).toBe('server')
    expect(d.apply).toBe('extension')
    expect(d.fallbackApply).toBeUndefined()
  })

  it('free + no extension → server for everything', () => {
    const d = decidePipeline('free', 'auto', false, false)
    expect(d.scout).toBe('server')
    expect(d.qualify).toBe('server')
    expect(d.apply).toBe('server')
    expect(d.fallbackApply).toBeUndefined()
  })

  it('starter + extension + headless → extension primary, headless fallback', () => {
    const d = decidePipeline('starter', 'auto', true, true)
    expect(d.scout).toBe('extension')
    expect(d.qualify).toBe('server')
    expect(d.apply).toBe('extension')
    expect(d.fallbackApply).toBe('headless')
  })

  it('starter + extension + no headless → extension only, no fallback', () => {
    const d = decidePipeline('starter', 'auto', true, false)
    expect(d.scout).toBe('extension')
    expect(d.qualify).toBe('server')
    expect(d.apply).toBe('extension')
    expect(d.fallbackApply).toBeUndefined()
  })

  it('starter + no extension + headless → headless applies', () => {
    const d = decidePipeline('starter', 'auto', false, true)
    expect(d.scout).toBe('server')
    expect(d.qualify).toBe('server')
    expect(d.apply).toBe('headless')
  })

  it('starter + no extension + no headless → server fallback', () => {
    const d = decidePipeline('starter', 'auto', false, false)
    expect(d.scout).toBe('server')
    expect(d.qualify).toBe('server')
    expect(d.apply).toBe('server')
  })

  it('pro + headless available → full autopilot', () => {
    const d = decidePipeline('pro', 'auto', true, true)
    expect(d.scout).toBe('headless')
    expect(d.qualify).toBe('server')
    expect(d.apply).toBe('headless')
  })

  it('pro + headless available, no extension → still autopilot', () => {
    const d = decidePipeline('pro', 'auto', false, true)
    expect(d.scout).toBe('headless')
    expect(d.qualify).toBe('server')
    expect(d.apply).toBe('headless')
  })

  it('pro + no headless + extension → extension fallback', () => {
    const d = decidePipeline('pro', 'auto', true, false)
    expect(d.scout).toBe('extension')
    expect(d.qualify).toBe('server')
    expect(d.apply).toBe('extension')
  })

  it('boost + headless → full autopilot', () => {
    const d = decidePipeline('boost', 'auto', true, true)
    expect(d.scout).toBe('headless')
    expect(d.qualify).toBe('server')
    expect(d.apply).toBe('headless')
  })

  it('qualify is always server regardless of tier', () => {
    const tiers = ['free', 'starter', 'pro', 'boost'] as const
    for (const tier of tiers) {
      const d = decidePipeline(tier, 'auto', true, true)
      expect(d.qualify).toBe('server')
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  Explicit mode overrides
// ═══════════════════════════════════════════════════════════════════════

describe('decidePipeline — explicit mode', () => {
  it('server mode → all phases on server', () => {
    const d = decidePipeline('pro', 'server', true, true)
    expect(d.scout).toBe('server')
    expect(d.qualify).toBe('server')
    expect(d.apply).toBe('server')
  })

  it('extension mode + extension available → extension for scout/apply', () => {
    const d = decidePipeline('starter', 'extension', true, true)
    expect(d.scout).toBe('extension')
    expect(d.qualify).toBe('server')
    expect(d.apply).toBe('extension')
    expect(d.fallbackApply).toBe('headless')
  })

  it('extension mode + no extension → falls back to server', () => {
    const d = decidePipeline('pro', 'extension', false, true)
    expect(d.scout).toBe('server')
    expect(d.qualify).toBe('server')
    expect(d.apply).toBe('server')
  })

  it('headless mode + pro tier + headless available → headless', () => {
    const d = decidePipeline('pro', 'headless', true, true)
    expect(d.scout).toBe('headless')
    expect(d.qualify).toBe('server')
    expect(d.apply).toBe('headless')
  })

  it('headless mode + free tier → tier gate blocks, falls back', () => {
    const d = decidePipeline('free', 'headless', true, true)
    expect(d.apply).not.toBe('headless')
    expect(d.reason).toContain('Starter+')
  })

  it('headless mode + pro tier + headless not available → extension fallback', () => {
    const d = decidePipeline('pro', 'headless', true, false)
    expect(d.apply).toBe('extension')
    expect(d.reason).toContain('not configured')
  })

  it('headless mode + pro tier + nothing available → server fallback', () => {
    const d = decidePipeline('pro', 'headless', false, false)
    expect(d.apply).toBe('server')
    expect(d.reason).toContain('not configured')
  })
})

// ═══════════════════════════════════════════════════════════════════════
//  PipelineDecision always has a reason
// ═══════════════════════════════════════════════════════════════════════

describe('decidePipeline — reason field', () => {
  it('always returns a non-empty reason string', () => {
    const modes = ['auto', 'extension', 'server', 'headless'] as const
    const tiers = ['free', 'starter', 'pro', 'boost'] as const
    for (const tier of tiers) {
      for (const mode of modes) {
        for (const ext of [true, false]) {
          for (const headless of [true, false]) {
            const d = decidePipeline(tier, mode, ext, headless)
            expect(d.reason).toBeTruthy()
            expect(typeof d.reason).toBe('string')
          }
        }
      }
    }
  })
})
