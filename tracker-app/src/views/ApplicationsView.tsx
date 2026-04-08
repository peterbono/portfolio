import { Suspense, lazy } from 'react'

const LazyPipelineView = lazy(() => import('./PipelineView').then(m => ({ default: m.PipelineView })))

const fallback = (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '50vh', gap: 12 }}>
    <div style={{ width: 24, height: 24, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Loading...</span>
  </div>
)

export function ApplicationsView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Suspense fallback={fallback}><LazyPipelineView /></Suspense>
      </div>
    </div>
  )
}
