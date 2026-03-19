import type { JobStatus } from '../types/job'
import { STATUS_CONFIG } from '../types/job'

interface StatusBadgeProps {
  status: JobStatus
  size?: 'sm' | 'md'
}

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.submitted

  const isSmall = size === 'sm'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: isSmall ? 4 : 5,
        padding: isSmall ? '2px 6px' : '3px 10px',
        fontSize: isSmall ? 11 : 12,
        fontWeight: 500,
        lineHeight: 1,
        borderRadius: 9999,
        color: config.color,
        background: config.bg,
        border: `1px solid ${config.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: isSmall ? 10 : 11 }}>{config.icon}</span>
      {config.label}
    </span>
  )
}
