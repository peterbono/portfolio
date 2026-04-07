import { describe, it, expect } from 'vitest'
import { decidePipeline, PIPELINE_DECISION } from '../pipeline-dispatcher'

describe('decidePipeline — fixed routing (extension removed)', () => {
  it('scout is always server', () => {
    const d = decidePipeline()
    expect(d.scout).toBe('server')
  })

  it('qualify is always server', () => {
    const d = decidePipeline()
    expect(d.qualify).toBe('server')
  })

  it('apply is always headless', () => {
    const d = decidePipeline()
    expect(d.apply).toBe('headless')
  })

  it('returns a non-empty reason string', () => {
    const d = decidePipeline()
    expect(d.reason).toBeTruthy()
    expect(typeof d.reason).toBe('string')
  })

  it('PIPELINE_DECISION constant matches function return', () => {
    expect(decidePipeline()).toEqual(PIPELINE_DECISION)
  })
})
