import { Search, Brain, Database, CheckCircle, AlertTriangle, X } from 'lucide-react'
import { useScout, type ScoutStage } from '../context/ScoutContext'

/**
 * ScoutProgressBanner — renders at the top of OpenJobsView when a scout is
 * running, done, or errored. Reads the global scout state from ScoutContext.
 *
 * Pattern: hybrid (stage label + counter + thin progress bar)
 *   Header: icon + stage label + elapsed time (right-aligned)
 *   Progress bar: 4px, animated green fill
 *   Subtext: counter (e.g., "12 jobs found, 3 matched")
 *
 * Dismissable only in terminal states (done/error) — during running, the
 * user cannot dismiss (would orphan the scout run from UI awareness).
 */

const STAGE_CONFIG: Record<ScoutStage, { label: string; icon: typeof Search; color: string }> = {
  idle:       { label: '',                            icon: Search,      color: '#34d399' },
  init:       { label: 'Warming up the scout',        icon: Search,      color: '#34d399' },
  scouting:   { label: 'Scanning 8 job boards',       icon: Search,      color: '#34d399' },
  qualifying: { label: 'Qualifying matches with AI',  icon: Brain,       color: '#34d399' },
  persisting: { label: 'Saving your matches',         icon: Database,    color: '#34d399' },
  done:       { label: 'Scout complete',              icon: CheckCircle, color: '#34d399' },
  error:      { label: 'Scout stalled',               icon: AlertTriangle, color: '#ef4444' },
}

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s elapsed`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}m ${s.toString().padStart(2, '0')}s elapsed`
}

export function ScoutProgressBanner() {
  const scout = useScout()

  if (scout.stage === 'idle') return null

  const cfg = STAGE_CONFIG[scout.stage]
  const Icon = cfg.icon
  const isTerminal = scout.stage === 'done' || scout.stage === 'error'

  // Subtext per stage
  let subtext = ''
  if (scout.stage === 'init') {
    subtext = 'Connecting to browser infrastructure'
  } else if (scout.stage === 'scouting') {
    subtext = scout.jobsFound > 0
      ? `Found ${scout.jobsFound} ${scout.jobsFound === 1 ? 'job' : 'jobs'}, still scouting`
      : 'Crawling RemoteOK, Wellfound, Himalayas, Remotive, Jobicy, Dribbble and 2 more'
  } else if (scout.stage === 'qualifying') {
    subtext = `${scout.jobsQualified} of ${scout.jobsFound} ${scout.jobsFound === 1 ? 'match' : 'matches'} passed so far`
  } else if (scout.stage === 'persisting') {
    subtext = 'Writing qualified matches to your job list'
  } else if (scout.stage === 'done') {
    if (scout.jobsQualified > 0) {
      subtext = `${scout.jobsQualified} new ${scout.jobsQualified === 1 ? 'match' : 'matches'} ready to review`
    } else {
      subtext = 'No new matches this run. Try broadening your criteria in Autopilot'
    }
  } else if (scout.stage === 'error') {
    subtext = scout.errorMessage || 'Retry when ready. Your previous matches are safe.'
  }

  return (
    <div style={{ ...s.banner, borderColor: `${cfg.color}4D`, background: `${cfg.color}14` }}>
      <div style={{ ...s.leftAccent, background: cfg.color }} />

      <div style={s.content}>
        <div style={s.header}>
          <div style={s.headerLeft}>
            <Icon size={16} color={cfg.color} />
            <span style={s.stageLabel}>{cfg.label}</span>
          </div>
          <div style={s.elapsed}>
            {isTerminal ? null : formatElapsed(scout.elapsedSec)}
          </div>
        </div>

        {/* Progress bar (hide on error) */}
        {scout.stage !== 'error' && (
          <div style={s.progressTrack}>
            <div
              style={{
                ...s.progressFill,
                width: `${scout.percent}%`,
                background: cfg.color,
              }}
            />
          </div>
        )}

        <div style={s.subtext}>{subtext}</div>
      </div>

      {isTerminal && (
        <button
          onClick={() => scout.dismiss()}
          style={s.dismissBtn}
          aria-label="Dismiss"
          title="Dismiss"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */
const s: Record<string, React.CSSProperties> = {
  banner: {
    position: 'relative',
    display: 'flex',
    alignItems: 'stretch',
    gap: 12,
    padding: '12px 16px 12px 20px',
    marginBottom: 16,
    border: '1px solid',
    borderRadius: 12,
    overflow: 'hidden',
    backdropFilter: 'blur(8px)',
  },
  leftAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  content: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    minWidth: 0,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  stageLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  elapsed: {
    fontSize: 11,
    fontWeight: 500,
    color: 'var(--text-tertiary)',
    fontVariantNumeric: 'tabular-nums',
    flexShrink: 0,
  },
  progressTrack: {
    position: 'relative',
    width: '100%',
    height: 4,
    background: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    transition: 'width 500ms cubic-bezier(0.4, 0, 0.2, 1)',
  },
  subtext: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1.4,
  },
  dismissBtn: {
    background: 'transparent',
    border: 'none',
    padding: 6,
    color: 'var(--text-tertiary)',
    cursor: 'pointer',
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    transition: 'color 150ms ease',
  },
}
