// ─── Primitives ─────────────────────────────────────────────────────

const staticBase: React.CSSProperties = {
  background: 'rgba(255,255,255,0.12)',
}

function SkeletonBar({ width = '100%', height = 12, radius = 6, style }: {
  width?: string | number
  height?: number
  radius?: number
  style?: React.CSSProperties
}) {
  return (
    <div
      style={{
        ...staticBase,
        width,
        height,
        borderRadius: radius,
        flexShrink: 0,
        ...style,
      }}
    />
  )
}

function SkeletonCircle({ size = 32, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        ...staticBase,
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        ...style,
      }}
    />
  )
}

function SkeletonCard({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

// ─── Table Skeleton ─────────────────────────────────────────────────

export function TableSkeleton() {

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Stat cards row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        {[1, 2, 3, 4].map(i => (
          <SkeletonCard key={i} style={{ flex: 1, padding: 14 }}>
            <SkeletonBar width="40%" height={10} />
            <SkeletonBar width="60%" height={22} />
          </SkeletonCard>
        ))}
      </div>

      {/* Search bar */}
      <div style={{ marginBottom: 16 }}>
        <SkeletonBar width="100%" height={38} radius={8} />
      </div>

      {/* Table header */}
      <div style={{ display: 'flex', gap: 12, padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 2 }}>
        <SkeletonBar width={28} height={14} />
        <SkeletonBar width="22%" height={14} />
        <SkeletonBar width="18%" height={14} />
        <SkeletonBar width="12%" height={14} />
        <SkeletonBar width="10%" height={14} />
        <SkeletonBar width="14%" height={14} />
      </div>

      {/* Table rows */}
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.03)',
          }}
        >
          <SkeletonCircle size={28} />
          <SkeletonBar width={`${18 + (i % 3) * 6}%`} height={12} />
          <SkeletonBar width={`${14 + (i % 2) * 5}%`} height={12} />
          <SkeletonBar width={60} height={22} radius={10} />
          <SkeletonBar width="8%" height={12} />
          <SkeletonBar width={16} height={12} />
        </div>
      ))}
    </div>
  )
}

// ─── Pipeline Skeleton ──────────────────────────────────────────────

function PipelineColumn({ cards }: { cards: number }) {
  return (
    <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Column header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 4px' }}>
        <SkeletonBar width="55%" height={14} />
        <SkeletonBar width={24} height={18} radius={8} />
      </div>
      {/* Cards */}
      {Array.from({ length: cards }).map((_, i) => (
        <SkeletonCard key={i} style={{ padding: 14 }}>
          <SkeletonBar width="70%" height={13} />
          <SkeletonBar width="50%" height={10} />
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <SkeletonBar width={55} height={18} radius={8} />
            <SkeletonBar width={40} height={18} radius={8} />
          </div>
        </SkeletonCard>
      ))}
    </div>
  )
}

export function PipelineSkeleton() {

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Search bar */}
      <div style={{ marginBottom: 16 }}>
        <SkeletonBar width={280} height={36} radius={8} />
      </div>
      {/* Columns */}
      <div style={{ display: 'flex', gap: 16, overflowX: 'hidden' }}>
        <PipelineColumn cards={3} />
        <PipelineColumn cards={2} />
        <PipelineColumn cards={3} />
        <PipelineColumn cards={1} />
        <PipelineColumn cards={2} />
      </div>
    </div>
  )
}

// ─── Analytics Skeleton ─────────────────────────────────────────────

export function AnalyticsSkeleton() {

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Stat cards */}
      <div style={{ display: 'flex', gap: 12 }}>
        {[1, 2, 3, 4].map(i => (
          <SkeletonCard key={i} style={{ flex: 1, padding: 16 }}>
            <SkeletonBar width="50%" height={10} />
            <SkeletonBar width="35%" height={26} />
            <SkeletonBar width="65%" height={8} />
          </SkeletonCard>
        ))}
      </div>

      {/* Charts row */}
      <div style={{ display: 'flex', gap: 16 }}>
        {/* Bar chart placeholder */}
        <SkeletonCard style={{ flex: 2, padding: 20 }}>
          <SkeletonBar width="30%" height={14} style={{ marginBottom: 8 }} />
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 160 }}>
            {[65, 90, 45, 110, 70, 130, 55, 100].map((h, i) => (
              <SkeletonBar key={i} width="100%" height={h} radius={4} style={{ flex: 1 }} />
            ))}
          </div>
          {/* X-axis labels */}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonBar key={i} width="100%" height={8} style={{ flex: 1 }} />
            ))}
          </div>
        </SkeletonCard>

        {/* Pie/donut chart placeholder */}
        <SkeletonCard style={{ flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center' }}>
          <SkeletonBar width="40%" height={14} style={{ alignSelf: 'flex-start' }} />
          <SkeletonCircle size={130} style={{ marginTop: 12 }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 16, width: '100%' }}>
            <SkeletonBar width="30%" height={8} />
            <SkeletonBar width="25%" height={8} />
            <SkeletonBar width="20%" height={8} />
          </div>
        </SkeletonCard>
      </div>

      {/* Second row of charts */}
      <div style={{ display: 'flex', gap: 16 }}>
        <SkeletonCard style={{ flex: 1, padding: 20 }}>
          <SkeletonBar width="35%" height={14} style={{ marginBottom: 12 }} />
          <div style={{ height: 140, position: 'relative' }}>
            {/* Horizontal grid lines */}
            {[0, 1, 2, 3].map(i => (
              <SkeletonBar
                key={i}
                width="100%"
                height={1}
                style={{ position: 'absolute', top: `${i * 33}%`, opacity: 0.5 }}
              />
            ))}
            {/* Area curve approximation */}
            <SkeletonBar width="100%" height={80} radius={8} style={{ marginTop: 60, opacity: 0.5 }} />
          </div>
        </SkeletonCard>

        <SkeletonCard style={{ flex: 1, padding: 20 }}>
          <SkeletonBar width="40%" height={14} style={{ marginBottom: 12 }} />
          {/* Horizontal bar chart */}
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <SkeletonBar width={70} height={10} />
              <SkeletonBar width={`${80 - i * 12}%`} height={16} radius={4} />
            </div>
          ))}
        </SkeletonCard>
      </div>
    </div>
  )
}

// ─── Coach Skeleton ─────────────────────────────────────────────────

export function CoachSkeleton() {

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Streak card */}
      <SkeletonCard style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <SkeletonCircle size={48} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SkeletonBar width="40%" height={16} />
            <SkeletonBar width="25%" height={10} />
          </div>
          <SkeletonBar width={80} height={28} radius={8} />
        </div>
      </SkeletonCard>

      {/* Daily goal card */}
      <SkeletonCard style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <SkeletonBar width="30%" height={14} />
          <SkeletonBar width={50} height={12} />
        </div>
        <SkeletonBar width="100%" height={8} radius={4} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <SkeletonBar width={60} height={20} radius={8} />
          <SkeletonBar width={60} height={20} radius={8} />
          <SkeletonBar width={60} height={20} radius={8} />
        </div>
      </SkeletonCard>

      {/* Focus tasks */}
      <SkeletonCard style={{ padding: 20 }}>
        <SkeletonBar width="35%" height={14} style={{ marginBottom: 4 }} />
        {[1, 2, 3].map(i => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
            <SkeletonCircle size={20} />
            <SkeletonBar width={`${50 + i * 8}%`} height={12} />
            <SkeletonBar width={50} height={18} radius={6} style={{ marginLeft: 'auto' }} />
          </div>
        ))}
      </SkeletonCard>

      {/* Mood + rank row */}
      <div style={{ display: 'flex', gap: 12 }}>
        <SkeletonCard style={{ flex: 1, padding: 16 }}>
          <SkeletonBar width="50%" height={12} />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {[1, 2, 3, 4, 5].map(i => (
              <SkeletonCircle key={i} size={32} />
            ))}
          </div>
        </SkeletonCard>
        <SkeletonCard style={{ flex: 1, padding: 16, alignItems: 'center' }}>
          <SkeletonBar width="45%" height={12} />
          <SkeletonCircle size={44} style={{ marginTop: 6 }} />
          <SkeletonBar width="55%" height={10} style={{ marginTop: 4 }} />
        </SkeletonCard>
      </div>
    </div>
  )
}

// ─── Insights Skeleton ──────────────────────────────────────────────

export function InsightsSkeleton() {

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Bot IQ header */}
      <SkeletonCard style={{ padding: 20, alignItems: 'center' }}>
        <SkeletonCircle size={80} />
        <SkeletonBar width="25%" height={16} style={{ marginTop: 8 }} />
        <SkeletonBar width="40%" height={10} />
      </SkeletonCard>

      {/* Insight cards */}
      {[1, 2, 3].map(i => (
        <SkeletonCard key={i} style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <SkeletonCircle size={36} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <SkeletonBar width={`${35 + i * 8}%`} height={13} />
              <SkeletonBar width={`${55 + i * 5}%`} height={10} />
            </div>
            <SkeletonBar width={50} height={22} radius={8} />
          </div>
          {i <= 2 && (
            <div style={{ marginTop: 10 }}>
              <SkeletonBar width="100%" height={120} radius={8} />
            </div>
          )}
        </SkeletonCard>
      ))}
    </div>
  )
}

// ─── Skeleton picker ────────────────────────────────────────────────

export function SkeletonForView({ view }: { view: string }) {
  switch (view) {
    case 'table': return <TableSkeleton />
    case 'pipeline': return <PipelineSkeleton />
    case 'analytics': return <AnalyticsSkeleton />
    case 'coach': return <CoachSkeleton />
    case 'insights': return <InsightsSkeleton />
    default: return <TableSkeleton />
  }
}
