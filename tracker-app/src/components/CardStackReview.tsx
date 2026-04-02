import { useState, useEffect, useCallback, useRef } from 'react'
import { Check, X, Shield, RotateCcw, ExternalLink, Eye } from 'lucide-react'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ReviewQueueItem {
  id: string
  company: string
  role: string
  matchScore: number
  matchReasons: string[]
  cvName: string
  coverLetterSnippet: string
  coverLetterVariant?: string
  status: 'pending' | 'approved' | 'skipped' | 'submitting' | 'submitted' | 'failed' | 'expired' | 'needs_manual' | 'unmatched'
  editedCoverLetter?: string
  editedAnswers?: Record<string, string>
  jobUrl?: string
}

interface CardStackReviewProps {
  queue: ReviewQueueItem[]
  onApprove: (id: string) => void
  onSkip: (id: string) => void
  onUndo: (id: string) => void
  onPreview?: (id: string) => void
}

/* ------------------------------------------------------------------ */
/*  Slide direction + animation states                                 */
/* ------------------------------------------------------------------ */

type SlideDir = 'enter' | 'exit-left' | 'exit-right' | 'idle'

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function CardStackReview({
  queue,
  onApprove,
  onSkip,
  onUndo,
  onPreview,
}: CardStackReviewProps) {
  const pendingItems = queue.filter((i) => i.status === 'pending')
  const totalPending = pendingItems.length
  const processedCount = queue.filter((i) => i.status !== 'pending').length

  // Track current card index into pendingItems
  const [currentIndex, setCurrentIndex] = useState(0)
  const [slideDir, setSlideDir] = useState<SlideDir>('enter')
  const [lastAction, setLastAction] = useState<{ id: string; type: 'approve' | 'skip' } | null>(null)
  const animatingRef = useRef(false)

  // The card currently displayed
  const currentItem = pendingItems[currentIndex] ?? null

  // Reset index when pending items change externally (e.g. new items added)
  useEffect(() => {
    if (currentIndex >= pendingItems.length && pendingItems.length > 0) {
      setCurrentIndex(0)
    }
  }, [pendingItems.length, currentIndex])

  // Trigger enter animation whenever currentItem changes
  useEffect(() => {
    if (currentItem) {
      setSlideDir('enter')
      const raf = requestAnimationFrame(() => {
        setSlideDir('idle')
      })
      return () => cancelAnimationFrame(raf)
    }
  }, [currentItem?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAction = useCallback(
    (type: 'approve' | 'skip') => {
      if (!currentItem || animatingRef.current) return
      animatingRef.current = true

      const dir: SlideDir = type === 'approve' ? 'exit-right' : 'exit-left'
      setSlideDir(dir)
      setLastAction({ id: currentItem.id, type })

      // Wait for exit animation, then commit action
      setTimeout(() => {
        if (type === 'approve') {
          onApprove(currentItem.id)
        } else {
          onSkip(currentItem.id)
        }
        animatingRef.current = false
        // The pending list will shrink, so currentIndex stays or wraps
        // enter animation triggers from the useEffect above
      }, 320)
    },
    [currentItem, onApprove, onSkip]
  )

  const handleUndo = useCallback(() => {
    if (!lastAction) return
    onUndo(lastAction.id)
    setLastAction(null)
  }, [lastAction, onUndo])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        handleAction('approve')
      } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
        e.preventDefault()
        handleAction('skip')
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        handleUndo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleAction, handleUndo])

  // ---- Score colors ----
  const getScoreColor = (score: number) =>
    score > 70 ? '#34d399' : score >= 50 ? '#fbbf24' : '#f43f5e'
  const getScoreBg = (score: number) =>
    score > 70
      ? 'rgba(52, 211, 153, 0.12)'
      : score >= 50
        ? 'rgba(251, 191, 36, 0.12)'
        : 'rgba(244, 63, 94, 0.12)'

  // ---- All done state ----
  if (totalPending === 0) {
    return (
      <div style={cs.emptyWrap}>
        <div style={cs.emptyIcon}>
          <Check size={32} color="#34d399" />
        </div>
        <p style={cs.emptyTitle}>All caught up!</p>
        <p style={cs.emptySubtext}>
          {processedCount} job{processedCount !== 1 ? 's' : ''} reviewed this session.
        </p>
        {lastAction && (
          <button style={cs.undoBtn} onClick={handleUndo}>
            <RotateCcw size={12} />
            <span>Undo last {lastAction.type}</span>
          </button>
        )}
      </div>
    )
  }

  // ---- Card animation classes ----
  const cardTransformStyle = (): React.CSSProperties => {
    switch (slideDir) {
      case 'enter':
        return {
          transform: 'translateY(40px) scale(0.97)',
          opacity: 0,
          transition: 'none',
        }
      case 'exit-right':
        return {
          transform: 'translateX(120%) rotate(8deg)',
          opacity: 0,
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease',
        }
      case 'exit-left':
        return {
          transform: 'translateX(-120%) rotate(-8deg)',
          opacity: 0,
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s ease',
        }
      case 'idle':
      default:
        return {
          transform: 'translateY(0) scale(1)',
          opacity: 1,
          transition: 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease',
        }
    }
  }

  // Tint overlay for exit
  const tintStyle = (): React.CSSProperties => {
    if (slideDir === 'exit-right') {
      return { ...cs.cardTint, background: 'rgba(52, 211, 153, 0.08)', opacity: 1 }
    }
    if (slideDir === 'exit-left') {
      return { ...cs.cardTint, background: 'rgba(244, 63, 94, 0.08)', opacity: 1 }
    }
    return { ...cs.cardTint, opacity: 0 }
  }

  if (!currentItem) return null

  const scoreColor = getScoreColor(currentItem.matchScore)
  const scoreBg = getScoreBg(currentItem.matchScore)

  return (
    <div style={cs.wrapper}>
      {/* Counter */}
      <div style={cs.counter}>
        <span style={cs.counterText}>
          {processedCount + 1} of {queue.length} remaining
        </span>
        {lastAction && (
          <button style={cs.undoBtn} onClick={handleUndo}>
            <RotateCcw size={11} />
            <span>Undo last</span>
          </button>
        )}
      </div>

      {/* Card */}
      <div style={cs.cardStage}>
        {/* Ghost card behind (depth illusion) */}
        {pendingItems.length > 1 && (
          <div style={cs.ghostCard} />
        )}

        {/* Main card */}
        <div
          style={{
            ...cs.card,
            ...cardTransformStyle(),
          }}
          key={currentItem.id}
        >
          {/* Tint overlay */}
          <div style={tintStyle()} />

          {/* Score badge — prominent at top */}
          <div style={cs.scoreRow}>
            <div
              style={{
                ...cs.scoreBadge,
                color: scoreColor,
                background: scoreBg,
                border: `1px solid ${scoreColor}33`,
              }}
            >
              <Shield size={16} />
              <span style={cs.scoreValue}>{currentItem.matchScore}%</span>
              <span style={cs.scoreLabel}>match</span>
            </div>
          </div>

          {/* Company + Role */}
          <div style={cs.mainInfo}>
            <h3 style={cs.company}>{currentItem.company}</h3>
            <p style={cs.role}>
              {currentItem.role}
              {currentItem.jobUrl && (
                <a
                  href={currentItem.jobUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={cs.jobLink}
                  title="Open job posting"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink size={12} />
                </a>
              )}
            </p>
          </div>

          {/* Match reasons */}
          <div style={cs.reasonsWrap}>
            {currentItem.matchReasons.map((reason, i) => (
              <span key={i} style={cs.reasonChip}>
                {reason}
              </span>
            ))}
          </div>

          {/* Cover letter snippet */}
          <div style={cs.coverSection}>
            <span style={cs.coverLabel}>Cover letter{currentItem.coverLetterVariant ? <span style={{ fontSize: 9, fontWeight: 500, color: 'var(--accent, #34d399)', marginLeft: 6, opacity: 0.7 }}>{currentItem.coverLetterVariant}</span> : null}</span>
            <p style={cs.coverText}>
              {currentItem.editedCoverLetter || currentItem.coverLetterSnippet}
            </p>
          </div>

          {/* CV info */}
          <div style={cs.metaRow}>
            <span style={cs.metaLabel}>CV:</span>
            <span style={cs.metaValue}>{currentItem.cvName}</span>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div style={cs.actions}>
        <button
          style={cs.btnSkip}
          onClick={() => handleAction('skip')}
          title="Skip (or press Left Arrow)"
        >
          <X size={22} />
          <span>Skip</span>
        </button>
        {onPreview && (
          <button
            style={cs.btnPreview}
            onClick={() => onPreview(currentItem.id)}
            title="Preview & edit application"
          >
            <Eye size={20} />
            <span>Preview</span>
          </button>
        )}
        <button
          style={cs.btnApprove}
          onClick={() => handleAction('approve')}
          title="Approve (or press Right Arrow)"
        >
          <Check size={22} />
          <span>Approve</span>
        </button>
      </div>

      {/* Keyboard hint */}
      <p style={cs.kbHint}>
        <kbd style={cs.kbd}>&larr;</kbd> Skip &nbsp;&middot;&nbsp; <kbd style={cs.kbd}>&rarr;</kbd> Approve &nbsp;&middot;&nbsp; <kbd style={cs.kbd}>Ctrl+Z</kbd> Undo
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const cs: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    padding: '8px 0',
  },

  /* Counter row */
  counter: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    justifyContent: 'center',
  },
  counterText: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
    fontWeight: 500,
  },

  /* Undo button */
  undoBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: 'rgba(96, 165, 250, 0.08)',
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: 500,
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid rgba(96, 165, 250, 0.18)',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },

  /* Card stage */
  cardStage: {
    position: 'relative',
    width: '100%',
    maxWidth: 440,
    minHeight: 340,
    display: 'flex',
    justifyContent: 'center',
  },

  /* Ghost card behind */
  ghostCard: {
    position: 'absolute',
    top: 8,
    left: '50%',
    transform: 'translateX(-50%) scale(0.96)',
    width: '94%',
    height: '100%',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    opacity: 0.4,
    pointerEvents: 'none',
  },

  /* Main card */
  card: {
    position: 'relative',
    width: '100%',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    overflow: 'hidden',
    zIndex: 1,
  },

  /* Tint overlay (green/red on exit) */
  cardTint: {
    position: 'absolute',
    inset: 0,
    borderRadius: 16,
    pointerEvents: 'none',
    transition: 'opacity 0.3s ease',
    zIndex: 0,
  },

  /* Score row */
  scoreRow: {
    display: 'flex',
    justifyContent: 'center',
  },
  scoreBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 18,
    fontWeight: 700,
    padding: '8px 18px',
    borderRadius: 12,
    flexShrink: 0,
  },
  scoreValue: {
    fontSize: 22,
    fontWeight: 800,
    lineHeight: 1,
  },
  scoreLabel: {
    fontSize: 13,
    fontWeight: 500,
    opacity: 0.7,
    marginLeft: 2,
  },

  /* Main info */
  mainInfo: {
    textAlign: 'center',
  },
  company: {
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--text-primary)',
    margin: 0,
    lineHeight: 1.3,
  },
  role: {
    fontSize: 15,
    color: 'var(--text-secondary)',
    margin: '4px 0 0',
  },
  jobLink: {
    display: 'inline-flex',
    alignItems: 'center',
    marginLeft: 6,
    color: 'var(--text-tertiary)',
    opacity: 0.6,
    verticalAlign: 'middle',
    transition: 'opacity 0.15s, color 0.15s',
    textDecoration: 'none',
  },

  /* Reasons */
  reasonsWrap: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
  },
  reasonChip: {
    fontSize: 11,
    padding: '3px 10px',
    borderRadius: 12,
    background: 'rgba(96, 165, 250, 0.10)',
    color: '#93c5fd',
    border: '1px solid rgba(96, 165, 250, 0.15)',
    whiteSpace: 'nowrap',
  },

  /* Cover letter */
  coverSection: {
    background: 'rgba(255,255,255,0.02)',
    borderRadius: 10,
    border: '1px solid var(--border)',
    padding: '10px 14px',
  },
  coverLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--text-tertiary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 4,
    display: 'block',
  },
  coverText: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
    margin: 0,
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },

  /* Meta row */
  metaRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-tertiary)',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    flexShrink: 0,
  },
  metaValue: {
    fontSize: 12,
    color: 'var(--text-secondary)',
  },

  /* Action buttons */
  actions: {
    display: 'flex',
    gap: 16,
    justifyContent: 'center',
    width: '100%',
    maxWidth: 440,
  },
  btnSkip: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    background: 'rgba(244, 63, 94, 0.08)',
    color: '#f43f5e',
    fontWeight: 700,
    fontSize: 15,
    padding: '14px 24px',
    borderRadius: 14,
    border: '2px solid rgba(244, 63, 94, 0.25)',
    cursor: 'pointer',
    transition: 'background 0.15s, border-color 0.15s',
  },
  btnPreview: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    background: 'rgba(168, 85, 247, 0.08)',
    color: '#a855f7',
    fontWeight: 700,
    fontSize: 14,
    padding: '14px 18px',
    borderRadius: 14,
    border: '2px solid rgba(168, 85, 247, 0.25)',
    cursor: 'pointer',
    transition: 'background 0.15s, border-color 0.15s',
  } as React.CSSProperties,
  btnApprove: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    background: 'rgba(52, 211, 153, 0.12)',
    color: '#34d399',
    fontWeight: 700,
    fontSize: 15,
    padding: '14px 24px',
    borderRadius: 14,
    border: '2px solid rgba(52, 211, 153, 0.3)',
    cursor: 'pointer',
    transition: 'background 0.15s, border-color 0.15s',
  },

  /* Keyboard hints */
  kbHint: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
    margin: 0,
    opacity: 0.7,
  },
  kbd: {
    display: 'inline-block',
    padding: '1px 5px',
    fontSize: 10,
    fontFamily: 'monospace',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    lineHeight: 1.4,
  },

  /* Empty state */
  emptyWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    padding: '32px 0',
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: 'rgba(52, 211, 153, 0.10)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--text-primary)',
    margin: 0,
  },
  emptySubtext: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
    margin: 0,
  },
}
