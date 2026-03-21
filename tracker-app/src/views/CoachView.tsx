import { useState, useEffect, useRef, useMemo, Component, type ErrorInfo, type ReactNode } from 'react'
import { useCoach, type GoalMode, type PersonalRank } from '../context/CoachContext'
import { useJobs } from '../context/JobsContext'
import { celebrate } from '../hooks/useCelebration'
import { detectGhosts, computeATSStats, computeQualityScore, computeIntelligenceSummary } from '../utils/intelligence'
import {
  Flame,
  Target,
  TrendingUp,
  Trophy,
  AlertTriangle,
  Lightbulb,
  Shield,
  ChevronDown,
  Check,
  Zap,
  Bot,
  Loader2,
  X,
  BarChart3,
  Star,
} from 'lucide-react'

const RANK_CONFIG: Record<PersonalRank, { label: string; color: string; icon: string }> = {
  bronze: { label: 'Bronze', color: '#cd7f32', icon: '🥉' },
  silver: { label: 'Silver', color: '#c0c0c0', icon: '🥈' },
  gold: { label: 'Gold', color: '#ffd700', icon: '🥇' },
  diamond: { label: 'Diamond', color: '#b9f2ff', icon: '💎' },
}

const GOAL_LABELS: Record<GoalMode, { label: string; desc: string }> = {
  light: { label: 'Light', desc: '2 actions/day — interview prep days' },
  standard: { label: 'Standard', desc: '4 actions/day — normal pace' },
  sprint: { label: 'Sprint', desc: '6+ actions/day — intensive mode' },
}

const MOOD_EMOJIS = [
  { value: 1, emoji: '😫', label: 'Exhausted' },
  { value: 2, emoji: '😕', label: 'Low' },
  { value: 3, emoji: '😐', label: 'Neutral' },
  { value: 4, emoji: '🙂', label: 'Good' },
  { value: 5, emoji: '🔥', label: 'On fire' },
]

class CoachErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; errorMsg: string }> {
  state = { hasError: false, errorMsg: '' }
  static getDerivedStateFromError(error: Error) { return { hasError: true, errorMsg: error?.message || String(error) } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Coach crash:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 12 }}>
            Something went wrong in the Coach view.
          </p>
          <p style={{ color: '#f87171', fontSize: 11, marginBottom: 12, fontFamily: 'monospace', maxWidth: 500, margin: '0 auto 12px', wordBreak: 'break-all' }}>
            {this.state.errorMsg}
          </p>
          <button
            onClick={() => {
              localStorage.removeItem('tracker_v2_ai_briefing')
              localStorage.removeItem('tracker_v2_coach')
              this.setState({ hasError: false, errorMsg: '' })
            }}
            style={{
              padding: '8px 16px', borderRadius: 8,
              background: 'var(--accent)', border: 'none',
              fontSize: 13, fontWeight: 600, color: '#000', cursor: 'pointer',
            }}
          >
            Reset & Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export function CoachView() {
  return (
    <CoachErrorBoundary>
      <CoachViewContent />
    </CoachErrorBoundary>
  )
}

function CoachViewContent() {
  return (
    <div style={styles.container}>
      {/* AI Coach Banner */}
      <AICoachBanner />
      <div style={styles.grid}>
        <div style={styles.leftCol}>
          <StreakCard />
          <DailyGoalCard />
          <FocusTasksCard />
          <IntelligenceInsightsCard />
          <PacingCard />
        </div>
        <div style={styles.rightCol}>
          <WeeklyProgressCard />
          <InsightsCard />
          <MilestonesCard />
          <MoodCard />
        </div>
      </div>
    </div>
  )
}

/* ── Streak Card ── */
function StreakCard() {
  const { streak, useStreakFreeze } = useCoach()

  return (
    <Card>
      <div style={styles.cardHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Flame size={18} color="#f97316" />
          <span style={styles.cardTitle}>Streak</span>
        </div>
        {streak.freezesAvailable > 0 && (
          <button onClick={useStreakFreeze} style={styles.freezeBtn} title="Use streak freeze for today">
            <Shield size={14} />
            <span>{streak.freezesAvailable} freeze{streak.freezesAvailable > 1 ? 's' : ''}</span>
          </button>
        )}
      </div>

      <div style={styles.streakDisplay}>
        <span style={styles.streakNumber}>{streak.current}</span>
        <span style={styles.streakLabel}>day{streak.current !== 1 ? 's' : ''}</span>
      </div>

      <div style={styles.streakMeta}>
        <span style={styles.metaItem}>Best: {streak.best} days</span>
        <span style={styles.metaDot} />
        <span style={styles.metaItem}>
          {streak.current >= 7 ? '3.6x more likely to succeed' : `${7 - streak.current} days to unlock boost`}
        </span>
      </div>

      {/* Mini flame visualization */}
      <div style={styles.flameRow}>
        {Array.from({ length: 7 }, (_, i) => (
          <div
            key={i}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              background: i < (streak.current % 7 || (streak.current >= 7 ? 7 : 0))
                ? 'rgba(249, 115, 22, 0.15)'
                : 'rgba(255,255,255,0.04)',
              border: i < (streak.current % 7 || (streak.current >= 7 ? 7 : 0))
                ? '1px solid rgba(249, 115, 22, 0.3)'
                : '1px solid var(--border)',
            }}
          >
            {i < (streak.current % 7 || (streak.current >= 7 ? 7 : 0)) ? '🔥' : '·'}
          </div>
        ))}
      </div>
    </Card>
  )
}

/* ── Daily Goal Card ── */
function DailyGoalCard() {
  const { goalMode, setGoalMode, dailyTarget, todayActions, dailyProgress, isDailyGoalMet } = useCoach()
  const [showModeSelect, setShowModeSelect] = useState(false)
  const prevActionsRef = useRef(todayActions)
  const celebratedRef = useRef(isDailyGoalMet) // skip if already met on mount

  useEffect(() => {
    // Only celebrate when goal transitions from not-met to met during this session
    // (i.e., todayActions increased since last render AND goal is now met)
    if (isDailyGoalMet && !celebratedRef.current && prevActionsRef.current < dailyTarget) {
      celebratedRef.current = true
      celebrate('medium')
    }
    prevActionsRef.current = todayActions
  }, [isDailyGoalMet, todayActions, dailyTarget])

  return (
    <Card>
      <div style={styles.cardHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Target size={18} color="var(--accent)" />
          <span style={styles.cardTitle}>Daily Goal</span>
        </div>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowModeSelect(!showModeSelect)}
            style={styles.modeBtn}
          >
            {GOAL_LABELS[goalMode].label}
            <ChevronDown size={14} />
          </button>
          {showModeSelect && (
            <div style={styles.modeDropdown}>
              {(Object.keys(GOAL_LABELS) as GoalMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => { setGoalMode(mode); setShowModeSelect(false) }}
                  style={{
                    ...styles.modeOption,
                    background: mode === goalMode ? 'rgba(52, 211, 153, 0.1)' : 'transparent',
                  }}
                >
                  <strong>{GOAL_LABELS[mode].label}</strong>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{GOAL_LABELS[mode].desc}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={styles.progressSection}>
        <div style={styles.progressNumbers}>
          <span style={{ fontSize: 32, fontWeight: 700, color: isDailyGoalMet ? 'var(--accent)' : 'var(--text-primary)' }}>
            {todayActions}
          </span>
          <span style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>/ {dailyTarget}</span>
        </div>

        {/* Progress bar */}
        <div style={styles.progressBar}>
          <div
            style={{
              ...styles.progressFill,
              width: `${dailyProgress * 100}%`,
              background: isDailyGoalMet
                ? 'var(--accent)'
                : `linear-gradient(90deg, var(--accent), rgba(52, 211, 153, ${0.4 + dailyProgress * 0.6}))`,
            }}
          />
        </div>

        {isDailyGoalMet && (
          <div style={styles.goalMetBadge}>
            <Check size={14} />
            <span>Daily goal reached! Take a break.</span>
          </div>
        )}
      </div>
    </Card>
  )
}

/* ── Focus Tasks Card ── */
function FocusTasksCard() {
  const { focusTasks, focusDoneIds: doneIds, toggleFocusTask, dismissFocusTask } = useCoach()
  const allDoneCelebratedRef = useRef(false)

  const toggleTask = (id: string) => {
    const wasDone = doneIds.has(id)
    toggleFocusTask(id)
    if (!wasDone) {
      celebrate('small')
      // Check if all tasks will now be done
      if (doneIds.size + 1 === focusTasks.length && !allDoneCelebratedRef.current) {
        allDoneCelebratedRef.current = true
        setTimeout(() => celebrate('medium'), 600)
      }
    }
  }

  const TYPE_COLORS: Record<string, string> = {
    'follow-up': '#f59e0b',
    apply: '#34d399',
    prep: '#818cf8',
    network: '#38bdf8',
    general: '#a1a1aa',
  }

  return (
    <Card>
      <div style={styles.cardHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Zap size={18} color="#fbbf24" />
          <span style={styles.cardTitle}>Today's Focus</span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          {doneIds.size}/{focusTasks.length} done
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {focusTasks.map(task => {
          const done = doneIds.has(task.id)
          return (
            <button
              key={task.id}
              onClick={() => toggleTask(task.id)}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 8,
                background: done ? 'rgba(52, 211, 153, 0.06)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${done ? 'rgba(52, 211, 153, 0.2)' : 'var(--border)'}`,
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.15s',
                width: '100%',
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  border: `2px solid ${done ? 'var(--accent)' : 'var(--text-tertiary)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: done ? 'var(--accent)' : 'transparent',
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {done && <Check size={12} color="#000" />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13,
                  color: done ? 'var(--text-tertiary)' : 'var(--text-primary)',
                  textDecoration: done ? 'line-through' : 'none',
                  lineHeight: 1.4,
                }}>
                  {task.label}
                </div>
                <span style={{
                  fontSize: 10,
                  color: TYPE_COLORS[task.type] || '#a1a1aa',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  letterSpacing: 0.5,
                }}>
                  {task.type}
                </span>
              </div>
              <div
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); dismissFocusTask(task.id) }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); dismissFocusTask(task.id) } }}
                style={{
                  flexShrink: 0,
                  width: 20,
                  height: 20,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 4,
                  color: 'var(--text-tertiary)',
                  opacity: 0.4,
                  cursor: 'pointer',
                  transition: 'opacity 0.15s, color 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#f87171' }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.4'; e.currentTarget.style.color = 'var(--text-tertiary)' }}
                title="Dismiss — replace with another task"
              >
                <X size={13} />
              </div>
            </button>
          )
        })}
      </div>
    </Card>
  )
}

/* ── Intelligence Insights Card ── */
function IntelligenceInsightsCard() {
  const { allJobs, updateJobStatus } = useJobs()

  const ghosts = useMemo(() => detectGhosts(allJobs), [allJobs])
  const atsStats = useMemo(() => computeATSStats(allJobs), [allJobs])
  const summary = useMemo(() => computeIntelligenceSummary(allJobs), [allJobs])

  const avgQuality = useMemo(() => {
    const submitted = allJobs.filter(j => !['skipped', 'saved'].includes(j.status))
    if (submitted.length === 0) return 0
    const total = submitted.reduce((sum, j) => sum + computeQualityScore(j), 0)
    return Math.round(total / submitted.length)
  }, [allJobs])

  // ATS: top 3 best and worst (min 5 applications to qualify)
  const qualifiedATS = useMemo(() => atsStats.filter(s => s.totalApplied >= 5), [atsStats])
  const bestATS = qualifiedATS.slice(0, 3)
  const worstATS = qualifiedATS.length > 3
    ? qualifiedATS.slice(-3).reverse()
    : qualifiedATS.length > 1
      ? qualifiedATS.slice(-1)
      : []

  // Pick the most impactful insight
  const smartTip = summary.topInsights.length > 0 ? summary.topInsights[0] : null

  // Quality tip
  const qualityTip = useMemo(() => {
    // Find the most common missing element
    const submitted = allJobs.filter(j => !['skipped', 'saved'].includes(j.status))
    let noCv = 0, noPortfolio = 0, noSalary = 0, noNotes = 0
    for (const j of submitted) {
      if (!j.cv || j.cv.trim().length === 0 || j.cv.toLowerCase() === 'no') noCv++
      if (!j.portfolio || j.portfolio.trim().length === 0 || j.portfolio.toLowerCase() === 'no') noPortfolio++
      if (!j.salary || j.salary.trim().length === 0) noSalary++
      if (!j.notes || j.notes.trim().length === 0) noNotes++
    }
    const max = Math.max(noCv, noPortfolio, noSalary, noNotes)
    if (max === 0) return 'Your applications are well-documented. Keep it up.'
    if (max === noCv) return 'Adding your CV to more applications could improve your score.'
    if (max === noPortfolio) return 'Including your portfolio link in more applications could improve your score.'
    if (max === noSalary) return 'Adding salary expectations to more applications could improve your score.'
    return 'Adding notes to more applications could improve your score.'
  }, [allJobs])

  // Color for quality score ring
  const qualityColor = avgQuality >= 75 ? '#34d399' : avgQuality >= 50 ? '#fbbf24' : '#f87171'

  return (
    <Card>
      <div style={styles.cardHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BarChart3 size={18} color="#818cf8" />
          <span style={styles.cardTitle}>Intelligence Insights</span>
        </div>
      </div>

      {/* Ghost Alert */}
      {ghosts.length > 0 && (
        <div style={{
          padding: '10px 12px', borderRadius: 8, marginBottom: 10,
          background: 'rgba(249, 115, 22, 0.06)',
          border: '1px solid rgba(249, 115, 22, 0.15)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <AlertTriangle size={14} color="#f97316" />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#f97316' }}>
              {ghosts.length} application{ghosts.length > 1 ? 's' : ''} likely ghosted
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
              (no response &gt;21 days)
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {ghosts.slice(0, 3).map(ghost => (
              <div key={ghost.jobId} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 8px', borderRadius: 6,
                background: 'rgba(255,255,255,0.02)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>
                    {ghost.company}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 6 }}>
                    {ghost.daysSinceApply}d ago
                  </span>
                </div>
                <button
                  onClick={() => updateJobStatus(ghost.jobId, 'ghosted')}
                  style={{
                    padding: '3px 8px', borderRadius: 4,
                    background: 'rgba(63, 63, 70, 0.2)',
                    border: '1px solid rgba(63, 63, 70, 0.3)',
                    color: 'var(--text-tertiary)',
                    fontSize: 10, fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(63, 63, 70, 0.4)'
                    e.currentTarget.style.color = 'var(--text-secondary)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(63, 63, 70, 0.2)'
                    e.currentTarget.style.color = 'var(--text-tertiary)'
                  }}
                >
                  Mark Ghosted
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ATS Performance */}
      {qualifiedATS.length >= 2 && (
        <div style={{
          padding: '10px 12px', borderRadius: 8, marginBottom: 10,
          background: 'rgba(129, 140, 248, 0.04)',
          border: '1px solid rgba(129, 140, 248, 0.1)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <BarChart3 size={14} color="#818cf8" />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#818cf8' }}>ATS Performance</span>
          </div>

          {bestATS.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                Best
              </div>
              {bestATS.map(ats => {
                const pct = Math.round(ats.responseRate * 100)
                return (
                  <div key={ats.ats} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 80, textTransform: 'capitalize', flexShrink: 0 }}>
                      {ats.ats}
                    </span>
                    <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 2, width: `${Math.max(pct, 2)}%`,
                        background: 'linear-gradient(90deg, #34d399, #6ee7b7)',
                        transition: 'width 0.5s ease',
                      }} />
                    </div>
                    <span style={{ fontSize: 10, color: '#34d399', fontWeight: 600, width: 32, textAlign: 'right', flexShrink: 0 }}>
                      {pct}%
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {worstATS.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                Worst
              </div>
              {worstATS.map(ats => {
                const pct = Math.round(ats.responseRate * 100)
                return (
                  <div key={ats.ats} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 80, textTransform: 'capitalize', flexShrink: 0 }}>
                      {ats.ats}
                    </span>
                    <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 2, width: `${Math.max(pct, 2)}%`,
                        background: 'linear-gradient(90deg, #f87171, #fca5a5)',
                        transition: 'width 0.5s ease',
                      }} />
                    </div>
                    <span style={{ fontSize: 10, color: '#f87171', fontWeight: 600, width: 32, textAlign: 'right', flexShrink: 0 }}>
                      {pct}%
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Quality Score */}
      <div style={{
        padding: '10px 12px', borderRadius: 8, marginBottom: 10,
        background: `${qualityColor}06`,
        border: `1px solid ${qualityColor}15`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <Star size={14} color={qualityColor} />
          <span style={{ fontSize: 12, fontWeight: 600, color: qualityColor }}>Quality Score</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            fontSize: 28, fontWeight: 700, color: qualityColor, lineHeight: 1,
          }}>
            {avgQuality}
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-tertiary)' }}>/100</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ width: '100%', height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2, width: `${avgQuality}%`,
                background: qualityColor,
                transition: 'width 0.5s ease',
              }} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4, lineHeight: 1.4 }}>
              {qualityTip}
            </div>
          </div>
        </div>
      </div>

      {/* Smart Tip */}
      {smartTip && (
        <div style={{
          padding: '10px 12px', borderRadius: 8,
          background: 'rgba(251, 191, 36, 0.04)',
          border: '1px solid rgba(251, 191, 36, 0.1)',
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <Lightbulb size={14} color="#fbbf24" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {smartTip}
          </div>
        </div>
      )}
    </Card>
  )
}

/* ── Pacing Card ── */
function PacingCard() {
  const { pacingAlert, todayActions, daysSinceLastAction } = useCoach()

  if (!pacingAlert) {
    return (
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'rgba(52, 211, 153, 0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Check size={16} color="var(--accent)" />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
              Healthy pace
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              You're in the sweet spot. Keep it up.
            </div>
          </div>
        </div>
      </Card>
    )
  }

  const isOverwork = pacingAlert === 'overwork'

  return (
    <Card accent={isOverwork ? '#f97316' : '#f59e0b'}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: isOverwork ? 'rgba(249, 115, 22, 0.15)' : 'rgba(245, 158, 11, 0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <AlertTriangle size={16} color={isOverwork ? '#f97316' : '#f59e0b'} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: isOverwork ? '#f97316' : '#f59e0b' }}>
            {isOverwork ? 'Slow down' : 'Time to get moving'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.5 }}>
            {isOverwork
              ? `${todayActions} actions today. Research shows quality drops past 5h/day. Take a break, your conversion rate will thank you.`
              : `${daysSinceLastAction} days without activity. Start small — even 1 follow-up counts. Switch to Light mode if needed.`
            }
          </div>
        </div>
      </div>
    </Card>
  )
}

/* ── Weekly Progress Card ── */
function WeeklyProgressCard() {
  const { weekActions, weeklyTarget, weekProgress, personalRank, bestWeek } = useCoach()
  const rank = RANK_CONFIG[personalRank]

  return (
    <Card>
      <div style={styles.cardHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TrendingUp size={18} color="#818cf8" />
          <span style={styles.cardTitle}>This Week</span>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '3px 10px', borderRadius: 12,
          background: `${rank.color}15`,
          border: `1px solid ${rank.color}30`,
        }}>
          <span>{rank.icon}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: rank.color }}>{rank.label}</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '12px 0 8px' }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>{weekActions}</span>
        <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>/ {weeklyTarget} actions</span>
      </div>

      <div style={styles.progressBar}>
        <div
          style={{
            ...styles.progressFill,
            width: `${weekProgress * 100}%`,
            background: 'linear-gradient(90deg, #818cf8, #a78bfa)',
          }}
        />
      </div>

      {/* Rank progression */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 10 }}>
        {(['bronze', 'silver', 'gold', 'diamond'] as PersonalRank[]).map(r => {
          const rc = RANK_CONFIG[r]
          const isActive = r === personalRank
          return (
            <div key={r} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              opacity: isActive ? 1 : 0.4,
            }}>
              <span style={{ fontSize: 16 }}>{rc.icon}</span>
              <span style={{ color: isActive ? rc.color : 'var(--text-tertiary)', fontWeight: isActive ? 600 : 400 }}>
                {rc.label}
              </span>
            </div>
          )
        })}
      </div>

      {bestWeek && (
        <div style={{
          marginTop: 12, padding: '8px 10px', borderRadius: 6,
          background: 'rgba(255,255,255,0.02)', fontSize: 11, color: 'var(--text-tertiary)',
          borderLeft: '2px solid #818cf8',
        }}>
          Best week: <strong style={{ color: 'var(--text-secondary)' }}>{bestWeek.weekLabel}</strong> — {bestWeek.actions} actions
        </div>
      )}
    </Card>
  )
}

/* ── Insights Card ── */
function InsightsCard() {
  const { insights } = useCoach()

  if (insights.length === 0) return null

  return (
    <Card>
      <div style={styles.cardHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Lightbulb size={18} color="#fbbf24" />
          <span style={styles.cardTitle}>Insights</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {insights.map((insight, i) => (
          <div key={i} style={{
            padding: '10px 12px',
            borderRadius: 8,
            background: 'rgba(251, 191, 36, 0.04)',
            border: '1px solid rgba(251, 191, 36, 0.1)',
            fontSize: 12,
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}>
            {insight}
          </div>
        ))}
      </div>
    </Card>
  )
}

/* ── Milestones Card ── */
function MilestonesCard() {
  const { milestones } = useCoach()
  const achieved = milestones.filter(m => m.achieved)
  const pending = milestones.filter(m => !m.achieved)

  return (
    <Card>
      <div style={styles.cardHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Trophy size={18} color="#fbbf24" />
          <span style={styles.cardTitle}>Milestones</span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          {achieved.length}/{milestones.length}
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {achieved.map(m => (
          <div key={m.id} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 10px', borderRadius: 8,
            background: 'rgba(52, 211, 153, 0.08)',
            border: '1px solid rgba(52, 211, 153, 0.2)',
            fontSize: 11, color: 'var(--accent)', fontWeight: 500,
          }}>
            <span>{m.icon}</span>
            <span>{m.label}</span>
            <Check size={12} />
          </div>
        ))}
        {pending.map(m => (
          <div key={m.id} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 10px', borderRadius: 8,
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid var(--border)',
            fontSize: 11, color: 'var(--text-tertiary)',
          }}>
            <span style={{ opacity: 0.4 }}>{m.icon}</span>
            <span>{m.label}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

/* ── Mood Card ── */
function MoodCard() {
  const {
    weeklyMood, setWeeklyMood, moodHistory, moodTrend,
    moodCorrelation, consecutiveLowMoodDays, moodSuggestedMode,
    goalMode, setGoalMode,
  } = useCoach()

  const TREND_CONFIG = {
    improving: { label: 'Improving', color: '#34d399', icon: '📈' },
    declining: { label: 'Declining', color: '#f87171', icon: '📉' },
    stable: { label: 'Stable', color: '#a1a1aa', icon: '➡️' },
  }

  // Generate contextual advice based on mood + data
  const getAdvice = (mood: number) => {
    if (mood <= 1) {
      return {
        title: "Take it easy today",
        message: "Job searching is a marathon. On exhausted days, doing 1 quality follow-up is better than 10 spray-and-pray applications. Your goal has been adjusted to Light mode.",
        action: consecutiveLowMoodDays >= 2
          ? `You've felt low for ${consecutiveLowMoodDays} days. Consider taking tomorrow off entirely — research shows breaks improve response quality.`
          : "Focus on one thing: prep for your next screening or send a thoughtful follow-up.",
        color: '#f87171',
      }
    }
    if (mood === 2) {
      return {
        title: "Low energy — work smarter",
        message: "Skip mass applications today. Instead, spend 30 minutes on networking or portfolio updates — high-impact, low-energy tasks.",
        action: moodCorrelation
          ? `Data insight: on good days you average ${moodCorrelation.highMoodAvgActions} actions vs ${moodCorrelation.lowMoodAvgActions} on low days. Quality > quantity today.`
          : "Tip: review your top 3 pending applications and craft personalized follow-ups.",
        color: '#f59e0b',
      }
    }
    if (mood === 3) {
      return {
        title: "Steady state",
        message: "Consistent effort compounds. Stick to your Standard goal — 4 focused actions build more pipeline than 8 rushed ones.",
        action: "Today's play: 2 quality applications + 1 follow-up + 1 interview prep task.",
        color: '#a1a1aa',
      }
    }
    if (mood === 4) {
      return {
        title: "Good energy — capitalize",
        message: "You're in a productive headspace. Channel this into the hard tasks: challenging applications, companies you're excited about, portfolio updates.",
        action: moodCorrelation
          ? `When you feel this good, you average ${moodCorrelation.highMoodAvgActions} actions/day. Use that momentum on high-priority targets.`
          : "Tip: this is the day to tackle that cover letter you've been procrastinating on.",
        color: '#34d399',
      }
    }
    return {
      title: "You're on fire — go all in",
      message: "Peak energy day. This is when you land interviews. Focus on your dream companies, nail those applications, and push your Sprint goal.",
      action: "Sprint mode recommended. Apply to 6+ quality positions and follow up on everything pending.",
      color: '#f97316',
    }
  }

  const advice = weeklyMood ? getAdvice(weeklyMood) : null

  // Last 7 days mood heatmap
  const last7 = (() => {
    const days: { date: string; mood: number | null; label: string }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      const entry = moodHistory.find(m => m.date === dateStr)
      days.push({
        date: dateStr,
        mood: entry?.mood ?? null,
        label: d.toLocaleDateString('en', { weekday: 'short' }),
      })
    }
    return days
  })()

  const MOOD_COLORS: Record<number, string> = {
    1: '#f87171', 2: '#fb923c', 3: '#a1a1aa', 4: '#34d399', 5: '#f97316',
  }

  return (
    <Card>
      <div style={styles.cardHeader}>
        <span style={styles.cardTitle}>How are you feeling today?</span>
        {moodTrend && (
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 10,
            background: `${TREND_CONFIG[moodTrend].color}15`,
            color: TREND_CONFIG[moodTrend].color,
            fontWeight: 600,
          }}>
            {TREND_CONFIG[moodTrend].icon} {TREND_CONFIG[moodTrend].label}
          </span>
        )}
      </div>

      {/* Emoji picker */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: '8px 0' }}>
        {MOOD_EMOJIS.map(m => (
          <button
            key={m.value}
            onClick={() => setWeeklyMood(m.value)}
            title={m.label}
            style={{
              width: 44, height: 44, borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22,
              background: weeklyMood === m.value ? `${MOOD_COLORS[m.value]}15` : 'rgba(255,255,255,0.03)',
              border: weeklyMood === m.value ? `2px solid ${MOOD_COLORS[m.value]}` : '1px solid var(--border)',
              cursor: 'pointer',
              transition: 'all 0.15s',
              transform: weeklyMood === m.value ? 'scale(1.1)' : 'scale(1)',
            }}
          >
            {m.emoji}
          </button>
        ))}
      </div>

      {/* Contextual advice */}
      {advice && (
        <div style={{
          marginTop: 8, padding: '10px 12px', borderRadius: 8,
          background: `${advice.color}08`,
          border: `1px solid ${advice.color}20`,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: advice.color, marginBottom: 4 }}>
            {advice.title}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 6 }}>
            {advice.message}
          </div>
          <div style={{
            fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5,
            padding: '6px 8px', borderRadius: 4,
            background: 'rgba(255,255,255,0.02)',
          }}>
            {advice.action}
          </div>
          {/* Suggest mode change */}
          {moodSuggestedMode && moodSuggestedMode !== goalMode && (
            <button
              onClick={() => setGoalMode(moodSuggestedMode)}
              style={{
                marginTop: 8, padding: '6px 12px', borderRadius: 6,
                background: `${advice.color}15`,
                border: `1px solid ${advice.color}30`,
                color: advice.color,
                fontSize: 11, fontWeight: 600,
                cursor: 'pointer', width: '100%',
                transition: 'all 0.15s',
              }}
            >
              Switch to {GOAL_LABELS[moodSuggestedMode].label} mode
            </button>
          )}
        </div>
      )}

      {/* 7-day mood heatmap */}
      {moodHistory.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Last 7 days
          </div>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'space-between' }}>
            {last7.map(day => (
              <div key={day.date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 6,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14,
                  background: day.mood ? `${MOOD_COLORS[day.mood]}15` : 'rgba(255,255,255,0.03)',
                  border: day.mood ? `1px solid ${MOOD_COLORS[day.mood]}30` : '1px solid var(--border)',
                }}>
                  {day.mood ? MOOD_EMOJIS.find(m => m.value === day.mood)?.emoji : '·'}
                </div>
                <span style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>{day.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mood-productivity correlation */}
      {moodCorrelation && (
        <div style={{
          marginTop: 10, padding: '8px 10px', borderRadius: 6,
          background: 'rgba(255,255,255,0.02)',
          borderLeft: '2px solid #818cf8',
          fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5,
        }}>
          When you feel good (4-5): <strong style={{ color: 'var(--text-secondary)' }}>{moodCorrelation.highMoodAvgActions} actions/day</strong>
          {' '} vs low days (1-2): <strong style={{ color: 'var(--text-secondary)' }}>{moodCorrelation.lowMoodAvgActions} actions/day</strong>
        </div>
      )}

      {/* Consecutive low mood warning */}
      {consecutiveLowMoodDays >= 2 && (
        <div style={{
          marginTop: 8, padding: '8px 10px', borderRadius: 6,
          background: 'rgba(248, 113, 113, 0.06)',
          border: '1px solid rgba(248, 113, 113, 0.15)',
          fontSize: 11, color: '#fca5a5', lineHeight: 1.5,
        }}>
          {consecutiveLowMoodDays} days feeling low. Your goal has been automatically switched to Light mode. Consider a full day off — it resets your mindset.
        </div>
      )}
    </Card>
  )
}

/* ── AI Coach Banner ── */
const AI_COACH_KEY = 'tracker_v2_ai_briefing'

interface AIBriefing {
  message: string
  generatedAt: string
  tasks: string[]
}

function loadCachedBriefing(): AIBriefing | null {
  try {
    const raw = localStorage.getItem(AI_COACH_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as AIBriefing
    // Cache valid for same day only
    const today = new Date().toISOString().split('T')[0]
    if (!data.generatedAt?.startsWith(today)) return null
    // Sanitize cached data to prevent render crashes
    return {
      message: typeof data.message === 'string' ? data.message : String(data.message ?? ''),
      tasks: Array.isArray(data.tasks) ? data.tasks.map(String) : [],
      generatedAt: data.generatedAt,
    }
  } catch { return null }
}

function AICoachBanner() {
  const {
    streak, todayActions, dailyTarget, goalMode,
    weekActions, weeklyTarget, personalRank,
    milestones, insights, focusTasks, pacingAlert,
    weeklyMood, daysSinceLastAction,
  } = useCoach()

  const [briefing, setBriefing] = useState<AIBriefing | null>(loadCachedBriefing)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generateBriefing = async () => {
    const apiKey = localStorage.getItem('tracker_anthropic_key')
    if (!apiKey) {
      setError('No API key. Go to Settings and add your Anthropic API key.')
      return
    }

    setLoading(true)
    setError(null)

    // Build context for Claude
    const achievedMilestones = milestones.filter(m => m.achieved).map(m => m.label)
    const pendingMilestones = milestones.filter(m => !m.achieved).map(m => m.label)

    const prompt = `You are an AI career coach for a Senior Product Designer (7+ years experience) based in Bangkok, currently in an active job search. Your role is to provide a concise, actionable daily briefing based on their real data.

## Their Current Stats
- Streak: ${streak.current} days (best: ${streak.best})
- Today: ${todayActions}/${dailyTarget} actions (${goalMode} mode)
- This week: ${weekActions}/${weeklyTarget} actions (${personalRank} rank)
- Days since last action: ${daysSinceLastAction}
- Pacing alert: ${pacingAlert || 'none'}
- Weekly mood: ${weeklyMood ? MOOD_EMOJIS.find(m => m.value === weeklyMood)?.label : 'not set'}

## Insights from their data
${insights.map((ins, i) => `${i + 1}. ${ins}`).join('\n')}

## Current focus tasks
${focusTasks.map(t => `- [${t.done ? 'x' : ' '}] ${t.label} (${t.type})`).join('\n')}

## Milestones
- Achieved: ${achievedMilestones.join(', ') || 'none yet'}
- Next: ${pendingMilestones.slice(0, 3).join(', ')}

## Rules
- Be direct, concise, and motivating — no fluff
- Use data to back up recommendations
- If they're overworking, tell them to stop
- If they're inactive, give them ONE small action to restart
- Reference their actual numbers
- Max 3-4 sentences for the briefing
- Suggest exactly 2 smart action items they haven't thought of
- Write in English, casual professional tone
- End with one line of genuine encouragement based on their progress

Respond in this exact JSON format:
{"message": "your briefing here", "tasks": ["action 1", "action 2"]}`

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        if (res.status === 401) {
          setError('API key missing. Add it in Settings.')
        } else {
          setError(errData.error?.message || `API error ${res.status}`)
        }
        setLoading(false)
        return
      }

      const data = await res.json()
      const text = data.content?.[0]?.text || ''
      // Parse JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        const newBriefing: AIBriefing = {
          message: typeof parsed.message === 'string' ? parsed.message : JSON.stringify(parsed.message),
          tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(String) : [],
          generatedAt: new Date().toISOString(),
        }
        setBriefing(newBriefing)
        localStorage.setItem(AI_COACH_KEY, JSON.stringify(newBriefing))
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Request timed out. Try again.')
      } else {
        setError('Failed to connect to Claude API')
      }
    }
    setLoading(false)
  }

  return (
    <div style={{
      padding: 16,
      borderRadius: 12,
      background: 'linear-gradient(135deg, rgba(129, 140, 248, 0.08), rgba(52, 211, 153, 0.06))',
      border: '1px solid rgba(129, 140, 248, 0.2)',
      marginBottom: 16,
      maxWidth: 1000,
      margin: '0 auto 16px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: briefing ? 10 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bot size={18} color="#818cf8" />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>AI Coach</span>
          {briefing && (
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
              {new Date(briefing.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <button
          onClick={generateBriefing}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 8,
            background: loading ? 'rgba(129, 140, 248, 0.1)' : 'rgba(129, 140, 248, 0.15)',
            border: '1px solid rgba(129, 140, 248, 0.3)',
            color: '#818cf8', fontSize: 12, fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer',
            transition: 'all 0.15s',
          }}
        >
          {loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={14} />}
          {loading ? 'Thinking...' : briefing ? 'Refresh' : 'Get Briefing'}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: '#f87171', padding: '6px 0' }}>
          {error}
        </div>
      )}

      {briefing && (
        <div>
          <div style={{
            fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6,
            padding: '8px 12px', borderRadius: 8,
            background: 'rgba(255,255,255,0.02)',
            borderLeft: '3px solid #818cf8',
          }}>
            {briefing.message}
          </div>
          {briefing.tasks.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {briefing.tasks.map((task, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 10px', borderRadius: 6,
                  background: 'rgba(129, 140, 248, 0.06)',
                  border: '1px solid rgba(129, 140, 248, 0.15)',
                  fontSize: 11, color: '#a5b4fc',
                }}>
                  <Zap size={10} />
                  {task}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!briefing && !error && !loading && (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
          Click "Get Briefing" for personalized AI coaching based on your data.
        </div>
      )}
    </div>
  )
}

/* ── Card wrapper ── */
function Card({ children, accent }: { children: React.ReactNode; accent?: string }) {
  return (
    <div style={{
      padding: 16,
      borderRadius: 12,
      background: 'var(--bg-surface)',
      border: accent ? `1px solid ${accent}30` : '1px solid var(--border)',
      ...(accent ? { boxShadow: `0 0 20px ${accent}08` } : {}),
    }}>
      {children}
    </div>
  )
}

/* ── Styles ── */
const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 24,
    overflowY: 'auto',
    flex: 1,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
    maxWidth: 1000,
    margin: '0 auto',
  },
  leftCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  rightCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
    letterSpacing: 0.3,
  },
  streakDisplay: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    margin: '8px 0',
  },
  streakNumber: {
    fontSize: 48,
    fontWeight: 800,
    color: '#f97316',
    lineHeight: 1,
  },
  streakLabel: {
    fontSize: 16,
    color: 'var(--text-tertiary)',
    fontWeight: 500,
  },
  streakMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  metaItem: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: '50%',
    background: 'var(--text-tertiary)',
  },
  flameRow: {
    display: 'flex',
    gap: 4,
    marginTop: 4,
  },
  freezeBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 8px',
    borderRadius: 6,
    background: 'rgba(56, 189, 248, 0.1)',
    border: '1px solid rgba(56, 189, 248, 0.2)',
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
  },
  modeBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 10px',
    borderRadius: 6,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid var(--border)',
    color: 'var(--text-secondary)',
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
  },
  modeDropdown: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 4,
    width: 260,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    overflow: 'hidden',
    zIndex: 100,
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  modeOption: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '10px 12px',
    width: '100%',
    textAlign: 'left',
    cursor: 'pointer',
    color: 'var(--text-primary)',
    fontSize: 12,
    border: 'none',
    borderBottom: '1px solid var(--border)',
    transition: 'background 0.1s',
  },
  progressSection: {
    marginTop: 4,
  },
  progressNumbers: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 4,
    marginBottom: 10,
  },
  progressBar: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    background: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    transition: 'width 0.5s ease',
  },
  goalMetBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    padding: '8px 10px',
    borderRadius: 6,
    background: 'rgba(52, 211, 153, 0.08)',
    border: '1px solid rgba(52, 211, 153, 0.2)',
    fontSize: 12,
    color: 'var(--accent)',
    fontWeight: 500,
  },
}
