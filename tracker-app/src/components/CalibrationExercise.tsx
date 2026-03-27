import { useState, useCallback } from 'react'
import { Check, X, Zap, ArrowRight } from 'lucide-react'
import { CALIBRATION_JOBS, type CalibrationJob } from '../data/calibration-jobs'
import { recordSignal, calibrateRubric } from '../lib/feedback-signals'

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface CalibrationExerciseProps {
  onComplete: (stats: { approved: number; skipped: number; agreementRate: number }) => void
  onSkipAll: () => void
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function CalibrationExercise({ onComplete, onSkipAll }: CalibrationExerciseProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [decisions, setDecisions] = useState<('approve' | 'skip')[]>([])
  const [showInsight, setShowInsight] = useState(false)
  const [exitDir, setExitDir] = useState<'left' | 'right' | null>(null)

  const job = CALIBRATION_JOBS[currentIndex] as CalibrationJob | undefined
  const isComplete = currentIndex >= CALIBRATION_JOBS.length
  const progress = Math.round((currentIndex / CALIBRATION_JOBS.length) * 100)

  const handleDecision = useCallback((action: 'approve' | 'skip') => {
    if (!job) return

    // Record feedback signal for calibration
    recordSignal({
      jobId: job.id,
      company: job.company,
      role: job.role,
      matchScore: job.matchScore,
      matchReasons: job.matchReasons,
      action: action === 'approve' ? 'approved' : 'skipped',
      timestamp: new Date().toISOString(),
    })

    const newDecisions = [...decisions, action]
    setDecisions(newDecisions)
    setExitDir(action === 'approve' ? 'right' : 'left')

    // Show insight briefly
    setShowInsight(true)
    setTimeout(() => {
      setShowInsight(false)
      setExitDir(null)

      if (currentIndex + 1 >= CALIBRATION_JOBS.length) {
        // Exercise complete — run calibration
        calibrateRubric()

        const approved = newDecisions.filter(d => d === 'approve').length
        const skipped = newDecisions.filter(d => d === 'skip').length
        const agreements = newDecisions.filter(
          (d, i) => d === CALIBRATION_JOBS[i].expectedAction
        ).length
        onComplete({
          approved,
          skipped,
          agreementRate: Math.round((agreements / CALIBRATION_JOBS.length) * 100),
        })
      } else {
        setCurrentIndex(prev => prev + 1)
      }
    }, 1800)
  }, [job, decisions, currentIndex, onComplete])

  if (isComplete) return null

  const scoreColor = (job?.matchScore ?? 0) >= 70
    ? '#34d399'
    : (job?.matchScore ?? 0) >= 40
    ? '#f59e0b'
    : '#ef4444'

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <Zap size={20} color="#f59e0b" />
          <div>
            <h2 style={styles.title}>Teach the bot your taste</h2>
            <p style={styles.subtitle}>
              Swipe through 10 sample jobs. Your choices calibrate the AI matcher.
            </p>
          </div>
          <button style={styles.skipAll} onClick={onSkipAll}>Skip</button>
        </div>

        {/* Progress bar */}
        <div style={styles.progressTrack}>
          <div style={{ ...styles.progressFill, width: `${progress}%` }} />
        </div>
        <span style={styles.progressLabel}>{currentIndex + 1} / {CALIBRATION_JOBS.length}</span>

        {/* Job card */}
        {job && (
          <div style={{
            ...styles.card,
            transform: exitDir === 'left' ? 'translateX(-120%) rotate(-8deg)'
              : exitDir === 'right' ? 'translateX(120%) rotate(8deg)'
              : 'translateX(0)',
            opacity: exitDir ? 0 : 1,
            transition: exitDir ? 'all 0.35s ease' : 'all 0.2s ease',
          }}>
            {/* Score badge */}
            <div style={{ ...styles.scoreBadge, background: scoreColor }}>
              {job.matchScore}%
            </div>

            <h3 style={styles.cardRole}>{job.role}</h3>
            <p style={styles.cardCompany}>{job.company} · {job.location}</p>

            {/* Match reasons */}
            <div style={styles.reasonsRow}>
              {job.matchReasons.map((r, i) => (
                <span key={i} style={styles.reasonChip}>{r}</span>
              ))}
            </div>

            {/* Cover letter preview */}
            {job.coverLetterSnippet && (
              <p style={styles.coverPreview}>{job.coverLetterSnippet}</p>
            )}
          </div>
        )}

        {/* Insight toast */}
        {showInsight && job && (
          <div style={{
            ...styles.insightToast,
            borderColor: decisions[decisions.length - 1] === job.expectedAction
              ? '#34d399' : '#f59e0b',
          }}>
            <span style={styles.insightIcon}>
              {decisions[decisions.length - 1] === job.expectedAction ? '✓' : '↔'}
            </span>
            <span style={styles.insightText}>{job.insight}</span>
          </div>
        )}

        {/* Action buttons */}
        {!showInsight && (
          <div style={styles.actions}>
            <button
              style={styles.btnSkip}
              onClick={() => handleDecision('skip')}
            >
              <X size={18} />
              Skip
            </button>
            <button
              style={styles.btnApprove}
              onClick={() => handleDecision('approve')}
            >
              <Check size={18} />
              Approve
            </button>
          </div>
        )}

        <p style={styles.hint}>
          ← Arrow keys → or click buttons
        </p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 9999,
  },
  modal: {
    width: 480, maxWidth: '95vw', maxHeight: '90vh',
    background: 'var(--bg-surface, #18181b)',
    border: '1px solid var(--border, #27272a)',
    borderRadius: 16, padding: 28,
    display: 'flex', flexDirection: 'column', gap: 16,
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'flex-start', gap: 12,
  },
  title: {
    margin: 0, fontSize: 18, fontWeight: 700,
    color: 'var(--text-primary, #fafafa)',
  },
  subtitle: {
    margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary, #a1a1aa)',
    lineHeight: 1.4,
  },
  skipAll: {
    marginLeft: 'auto', background: 'none', border: 'none',
    color: 'var(--text-tertiary, #71717a)', fontSize: 12, fontWeight: 500,
    cursor: 'pointer', padding: '4px 8px', whiteSpace: 'nowrap',
  },
  progressTrack: {
    height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%', borderRadius: 2, background: '#34d399',
    transition: 'width 0.3s ease',
  },
  progressLabel: {
    fontSize: 11, color: 'var(--text-tertiary, #71717a)', fontWeight: 500,
    textAlign: 'center' as const,
  },
  card: {
    position: 'relative' as const,
    background: 'var(--bg-elevated, #1f1f23)',
    border: '1px solid var(--border, #27272a)',
    borderRadius: 12, padding: 20,
    display: 'flex', flexDirection: 'column' as const, gap: 10,
    minHeight: 180,
  },
  scoreBadge: {
    position: 'absolute' as const, top: 16, right: 16,
    padding: '4px 10px', borderRadius: 20,
    fontSize: 13, fontWeight: 700, color: '#09090b',
  },
  cardRole: {
    margin: 0, fontSize: 16, fontWeight: 600,
    color: 'var(--text-primary, #fafafa)',
    paddingRight: 60,
  },
  cardCompany: {
    margin: 0, fontSize: 13, color: 'var(--text-secondary, #a1a1aa)',
  },
  reasonsRow: {
    display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginTop: 4,
  },
  reasonChip: {
    padding: '3px 10px', borderRadius: 12,
    background: 'rgba(52, 211, 153, 0.08)',
    border: '1px solid rgba(52, 211, 153, 0.15)',
    fontSize: 11, fontWeight: 500, color: '#6ee7b7',
  },
  coverPreview: {
    margin: '6px 0 0', fontSize: 12, lineHeight: 1.5,
    color: 'var(--text-tertiary, #a1a1aa)',
    fontStyle: 'italic' as const,
  },
  insightToast: {
    display: 'flex', alignItems: 'flex-start', gap: 8,
    padding: '10px 14px', borderRadius: 8,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid',
  },
  insightIcon: {
    fontSize: 14, fontWeight: 700, flexShrink: 0,
  },
  insightText: {
    fontSize: 12, lineHeight: 1.5,
    color: 'var(--text-secondary, #a1a1aa)',
  },
  actions: {
    display: 'flex', gap: 12, justifyContent: 'center',
  },
  btnSkip: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '10px 28px', borderRadius: 10,
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.2)',
    color: '#fca5a5', fontSize: 14, fontWeight: 600,
    cursor: 'pointer', transition: 'all 150ms ease',
  },
  btnApprove: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '10px 28px', borderRadius: 10,
    background: 'rgba(52, 211, 153, 0.1)',
    border: '1px solid rgba(52, 211, 153, 0.2)',
    color: '#6ee7b7', fontSize: 14, fontWeight: 600,
    cursor: 'pointer', transition: 'all 150ms ease',
  },
  hint: {
    textAlign: 'center' as const, fontSize: 11,
    color: 'var(--text-tertiary, #52525b)',
    margin: 0,
  },
}
