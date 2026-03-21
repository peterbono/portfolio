import { useState, useCallback } from 'react'
import { useJobs } from '../context/JobsContext'
import { runMigration, type MigrationProgress } from '../lib/migration'
import { useAuthWall } from '../hooks/useAuthWall'

const MIGRATION_KEY = 'tracker_v2_migration_done'

interface MigrationState {
  done: boolean
  date: string | null
  count: number
  errorCount: number
}

function loadMigrationState(): MigrationState {
  try {
    const raw = localStorage.getItem(MIGRATION_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { done: false, date: null, count: 0, errorCount: 0 }
}

function saveMigrationState(state: MigrationState) {
  localStorage.setItem(MIGRATION_KEY, JSON.stringify(state))
}

export function MigrationBanner() {
  const { allJobs } = useJobs()
  const { requireAuth } = useAuthWall()
  const [migrationState, setMigrationState] = useState<MigrationState>(loadMigrationState)
  const [progress, setProgress] = useState<MigrationProgress | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  const doMigrate = useCallback(async () => {
    if (isRunning) return
    setIsRunning(true)
    setProgress({ phase: 'signing-in', current: 0, total: allJobs.length, errors: [] })

    try {
      const result = await runMigration(allJobs, (p) => {
        setProgress({ ...p })
      })

      const state: MigrationState = {
        done: true,
        date: new Date().toISOString(),
        count: result.migrated,
        errorCount: result.errors.length,
      }
      saveMigrationState(state)
      setMigrationState(state)
    } catch (err) {
      setProgress({
        phase: 'error',
        current: 0,
        total: allJobs.length,
        errors: [err instanceof Error ? err.message : 'Unknown error'],
      })
    } finally {
      setIsRunning(false)
    }
  }, [allJobs, isRunning])

  const handleMigrate = useCallback(() => {
    if (!requireAuth('save_cloud', () => { doMigrate() })) return
    doMigrate()
  }, [requireAuth, doMigrate])

  const phaseLabel = (p: MigrationProgress): string => {
    switch (p.phase) {
      case 'signing-in':
        return 'Signing in...'
      case 'ensuring-profile':
        return 'Setting up profile...'
      case 'migrating':
        return `Migrating... ${p.current}/${p.total} jobs`
      case 'done':
        return p.errors.length > 0
          ? `Done: ${p.total - p.errors.length} synced, ${p.errors.length} errors`
          : `Done: ${p.total} jobs synced`
      case 'error':
        return `Error: ${p.errors[0] || 'Unknown'}`
      default:
        return ''
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.iconCircle}>
          <span style={styles.icon}>
            {migrationState.done ? '\u2601' : '\u2191'}
          </span>
        </div>
        <div style={styles.headerText}>
          <span style={styles.title}>Cloud Sync</span>
          <span style={styles.description}>
            {migrationState.done
              ? `Synced ${migrationState.count} jobs to Supabase`
              : `Sync ${allJobs.length} jobs to Supabase for backup & future features`}
          </span>
        </div>
      </div>

      {migrationState.done && migrationState.date && (
        <div style={styles.doneRow}>
          <span style={styles.checkmark}>{'\u2713'}</span>
          <span style={styles.doneText}>
            Last synced {new Date(migrationState.date).toLocaleDateString()} at{' '}
            {new Date(migrationState.date).toLocaleTimeString()}
          </span>
          {migrationState.errorCount > 0 && (
            <span style={styles.warningText}>
              ({migrationState.errorCount} errors)
            </span>
          )}
        </div>
      )}

      {progress && isRunning && (
        <div style={styles.progressContainer}>
          <div style={styles.progressBar}>
            <div
              style={{
                ...styles.progressFill,
                width: `${Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%`,
              }}
            />
          </div>
          <span style={styles.progressLabel}>{phaseLabel(progress)}</span>
        </div>
      )}

      {progress && !isRunning && progress.phase === 'done' && (
        <div style={styles.resultRow}>
          {progress.errors.length > 0 ? (
            <span style={styles.warningText}>{phaseLabel(progress)}</span>
          ) : (
            <span style={styles.successText}>{phaseLabel(progress)}</span>
          )}
        </div>
      )}

      {progress && !isRunning && progress.phase === 'error' && (
        <div style={styles.resultRow}>
          <span style={styles.errorText}>{phaseLabel(progress)}</span>
        </div>
      )}

      <button
        style={{
          ...styles.button,
          opacity: isRunning ? 0.6 : 1,
          cursor: isRunning ? 'not-allowed' : 'pointer',
        }}
        onClick={handleMigrate}
        disabled={isRunning}
      >
        {isRunning
          ? 'Syncing...'
          : migrationState.done
            ? 'Re-sync to Cloud'
            : 'Sync to Cloud'}
      </button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: 'var(--bg-elevated)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  icon: {
    fontSize: 16,
  },
  headerText: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  description: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
  },
  doneRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 8px',
    background: 'rgba(52, 211, 153, 0.08)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 12,
  },
  checkmark: {
    color: '#34d399',
    fontWeight: 700,
  },
  doneText: {
    color: 'var(--text-secondary)',
  },
  progressContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  progressBar: {
    height: 4,
    background: 'var(--bg-elevated)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: 'var(--accent)',
    borderRadius: 2,
    transition: 'width 0.3s ease',
  },
  progressLabel: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
    fontVariantNumeric: 'tabular-nums',
  },
  resultRow: {
    padding: '4px 0',
  },
  successText: {
    fontSize: 12,
    color: '#34d399',
  },
  warningText: {
    fontSize: 12,
    color: '#fb923c',
  },
  errorText: {
    fontSize: 12,
    color: '#f43f5e',
  },
  button: {
    alignSelf: 'flex-start',
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    fontWeight: 500,
    fontSize: 13,
    padding: '8px 16px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)',
    whiteSpace: 'nowrap' as const,
  },
}
