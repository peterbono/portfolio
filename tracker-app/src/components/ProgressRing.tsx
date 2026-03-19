interface ProgressRingProps {
  percentage: number
  size?: number
  strokeWidth?: number
  ringColor?: string
  trackColor?: string
}

export function ProgressRing({
  percentage,
  size = 80,
  strokeWidth = 6,
  ringColor = '#34d399',
  trackColor = '#1e1e24',
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percentage / 100) * circumference
  const center = size / 2

  return (
    <div style={styles.wrapper}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: 'rotate(-90deg)' }}
      >
        {/* Background track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        {/* Progress arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={ringColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div style={styles.center}>
        <span style={styles.value}>{Math.round(percentage)}%</span>
        <span style={styles.label}>SUBMITTED</span>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  center: {
    position: 'absolute',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  value: {
    fontSize: 16,
    fontWeight: 700,
    color: '#34d399',
    lineHeight: 1,
  },
  label: {
    fontSize: 7,
    fontWeight: 600,
    color: 'var(--text-tertiary)',
    letterSpacing: '0.08em',
    lineHeight: 1,
  },
}
