import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Bot,
  ArrowRight,
  ArrowLeft,
  MapPin,
  Upload,
  Sparkles,
  Zap,
  Brain,
  Shield,
  X,
  Check,
} from 'lucide-react'
import confetti from 'canvas-confetti'

const ONBOARDING_KEY = 'tracker_v2_onboarding_done'

const ROLE_OPTIONS = [
  'Software Engineer',
  'Frontend Developer',
  'Backend Developer',
  'Full Stack Developer',
  'Product Designer',
  'UX Designer',
  'UI Designer',
  'Product Manager',
  'Data Scientist',
  'Data Analyst',
  'DevOps Engineer',
  'QA Engineer',
  'Marketing Manager',
  'Sales Representative',
  'Project Manager',
  'Business Analyst',
  'Customer Success',
  'HR / Recruiter',
  'Finance / Accounting',
  'Operations Manager',
]

const EXPERIENCE_LEVELS = ['Junior', 'Mid', 'Senior', 'Lead', 'Principal']

interface OnboardingWizardProps {
  onComplete: () => void
  defaultEmail?: string
  defaultName?: string
}

export function OnboardingWizard({ onComplete, defaultEmail, defaultName }: OnboardingWizardProps) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState(defaultName ?? '')
  const [email, setEmail] = useState(defaultEmail ?? '')
  const [location, setLocation] = useState('')
  const [selectedRoles, setSelectedRoles] = useState<string[]>([])
  const [experience, setExperience] = useState('Mid')
  const [remoteOnly, setRemoteOnly] = useState(false)
  const [salaryMin, setSalaryMin] = useState(50)
  const [timezone, setTimezone] = useState('')
  const [excludedCompanies, setExcludedCompanies] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [botAnimating, setBotAnimating] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const totalSteps = 5

  useEffect(() => {
    const timer = setTimeout(() => setBotAnimating(false), 2000)
    return () => clearTimeout(timer)
  }, [])

  const toggleRole = useCallback((role: string) => {
    setSelectedRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    )
  }, [])

  const handleComplete = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEY, 'true')

    // Store profile data
    const profile = {
      name,
      email,
      location,
      roles: selectedRoles,
      experience,
      remoteOnly,
      salaryMin,
      timezone,
      excludedCompanies: excludedCompanies.split(',').map(s => s.trim()).filter(Boolean),
    }
    localStorage.setItem('tracker_v2_user_profile', JSON.stringify(profile))

    // Fire confetti
    const end = Date.now() + 1200
    const fire = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
        colors: ['#34d399', '#60a5fa', '#f59e0b'],
      })
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
        colors: ['#34d399', '#60a5fa', '#f59e0b'],
      })
      if (Date.now() < end) requestAnimationFrame(fire)
    }
    fire()

    setTimeout(onComplete, 1500)
  }, [name, email, location, selectedRoles, experience, remoteOnly, salaryMin, timezone, excludedCompanies, onComplete])

  const canProceed = () => {
    if (step === 1) return name.trim().length > 0
    return true
  }

  const nextStep = () => {
    if (step < totalSteps - 1) setStep(s => s + 1)
  }

  const prevStep = () => {
    if (step > 0) setStep(s => s - 1)
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        {/* Step indicators */}
        <div style={styles.stepRow}>
          {Array.from({ length: totalSteps }, (_, i) => (
            <div
              key={i}
              style={{
                ...styles.stepDot,
                background: i <= step ? 'var(--accent)' : 'var(--border)',
                width: i === step ? 24 : 8,
              }}
            />
          ))}
        </div>

        {/* Step 0: Welcome */}
        {step === 0 && (
          <div style={styles.stepContent}>
            <div style={{
              ...styles.botIcon,
              animation: botAnimating ? 'pulse 1s ease-in-out infinite' : 'none',
            }}>
              <Bot size={40} color="var(--accent)" />
            </div>
            <h1 style={styles.title}>Welcome to Job Tracker</h1>
            <p style={styles.subtitle}>
              Apply smarter, not harder. Let's set up your profile.
            </p>
            <button onClick={nextStep} style={styles.primaryBtn}>
              Get Started
              <ArrowRight size={16} />
            </button>
          </div>
        )}

        {/* Step 1: Profile */}
        {step === 1 && (
          <div style={styles.stepContent}>
            <h2 style={styles.stepTitle}>Your Profile</h2>
            <p style={styles.stepDesc}>Tell us a bit about yourself</p>
            <div style={styles.formGrid}>
              <div style={styles.field}>
                <label style={styles.label}>Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Your full name"
                  style={styles.input}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  style={styles.input}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>
                  <MapPin size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  Current Location
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  placeholder="Bangkok, Thailand"
                  style={styles.input}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Experience Level</label>
                <div style={styles.chipRow}>
                  {EXPERIENCE_LEVELS.map(level => (
                    <button
                      key={level}
                      onClick={() => setExperience(level)}
                      style={{
                        ...styles.chip,
                        ...(experience === level ? styles.chipActive : {}),
                      }}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Target Roles</label>
                <div style={styles.chipRow}>
                  {ROLE_OPTIONS.map(role => (
                    <button
                      key={role}
                      onClick={() => toggleRole(role)}
                      style={{
                        ...styles.chip,
                        ...(selectedRoles.includes(role) ? styles.chipActive : {}),
                      }}
                    >
                      {selectedRoles.includes(role) && <Check size={12} />}
                      {role}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Search Preferences */}
        {step === 2 && (
          <div style={styles.stepContent}>
            <h2 style={styles.stepTitle}>Search Preferences</h2>
            <p style={styles.stepDesc}>Configure how the bot searches for you</p>
            <div style={styles.formGrid}>
              <div style={styles.field}>
                <label style={styles.label}>
                  <span>Remote Only</span>
                  <button
                    onClick={() => setRemoteOnly(!remoteOnly)}
                    style={{
                      ...styles.toggle,
                      background: remoteOnly ? 'var(--accent)' : 'var(--bg-elevated)',
                    }}
                  >
                    <span style={{
                      ...styles.toggleThumb,
                      transform: remoteOnly ? 'translateX(16px)' : 'translateX(2px)',
                    }} />
                  </button>
                </label>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>
                  Minimum Salary: {salaryMin}k EUR/year
                </label>
                <input
                  type="range"
                  min={30}
                  max={200}
                  step={5}
                  value={salaryMin}
                  onChange={e => setSalaryMin(Number(e.target.value))}
                  style={styles.range}
                />
                <div style={styles.rangeLabels}>
                  <span>30k</span>
                  <span>200k</span>
                </div>
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Timezone Preference</label>
                <input
                  type="text"
                  value={timezone}
                  onChange={e => setTimezone(e.target.value)}
                  placeholder="GMT+7 (APAC)"
                  style={styles.input}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>Excluded Companies</label>
                <input
                  type="text"
                  value={excludedCompanies}
                  onChange={e => setExcludedCompanies(e.target.value)}
                  placeholder="Company A, Company B"
                  style={styles.input}
                />
                <span style={styles.hint}>Comma-separated list</span>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Import */}
        {step === 3 && (
          <div style={styles.stepContent}>
            <h2 style={styles.stepTitle}>Import Data</h2>
            <p style={styles.stepDesc}>Bring your existing job applications</p>
            <div
              onClick={() => fileInputRef.current?.click()}
              style={styles.dropZone}
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent)' }}
              onDragLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
              onDrop={e => {
                e.preventDefault()
                e.currentTarget.style.borderColor = 'var(--border)'
                const file = e.dataTransfer.files[0]
                if (file?.type === 'application/json') setImportFile(file)
              }}
            >
              <Upload size={32} color="var(--text-tertiary)" />
              {importFile ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--accent)', fontSize: 14 }}>{importFile.name}</span>
                  <button onClick={e => { e.stopPropagation(); setImportFile(null) }} style={{ color: 'var(--text-tertiary)' }}>
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                    Drop your JSON file here or click to browse
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    Supports JSON format from common job trackers
                  </p>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) setImportFile(file)
              }}
            />
            <button
              onClick={nextStep}
              style={styles.ghostBtn}
            >
              Or start fresh
              <ArrowRight size={14} />
            </button>
          </div>
        )}

        {/* Step 4: Ready */}
        {step === 4 && (
          <div style={styles.stepContent}>
            <div style={styles.readyIcon}>
              <Sparkles size={32} color="var(--accent)" />
            </div>
            <h2 style={styles.stepTitle}>You're All Set!</h2>
            <p style={styles.stepDesc}>Here's what the bot can do for you:</p>
            <div style={styles.featureList}>
              <div style={styles.featureItem}>
                <div style={styles.featureIcon}>
                  <Zap size={20} color="#f59e0b" />
                </div>
                <div>
                  <h4 style={styles.featureName}>Auto-Apply</h4>
                  <p style={styles.featureDesc}>
                    Automatically fill and submit applications to matching jobs
                  </p>
                </div>
              </div>
              <div style={styles.featureItem}>
                <div style={styles.featureIcon}>
                  <Brain size={20} color="#60a5fa" />
                </div>
                <div>
                  <h4 style={styles.featureName}>Smart Learning</h4>
                  <p style={styles.featureDesc}>
                    Thompson Sampling optimizes your application strategy over time
                  </p>
                </div>
              </div>
              <div style={styles.featureItem}>
                <div style={styles.featureIcon}>
                  <Shield size={20} color="#34d399" />
                </div>
                <div>
                  <h4 style={styles.featureName}>Full Control</h4>
                  <p style={styles.featureDesc}>
                    Every action requires your approval. You're always in the driver's seat.
                  </p>
                </div>
              </div>
            </div>
            <button onClick={handleComplete} style={styles.primaryBtn}>
              Go to Dashboard
              <ArrowRight size={16} />
            </button>
          </div>
        )}

        {/* Navigation */}
        {step > 0 && step < 4 && (
          <div style={styles.navRow}>
            <button onClick={prevStep} style={styles.backBtn}>
              <ArrowLeft size={14} />
              Back
            </button>
            <button
              onClick={nextStep}
              disabled={!canProceed()}
              style={{
                ...styles.primaryBtn,
                opacity: canProceed() ? 1 : 0.4,
                pointerEvents: canProceed() ? 'auto' : 'none',
              }}
            >
              {step === 3 ? 'Continue' : 'Next'}
              <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Inline keyframe for pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
      `}</style>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.85)',
    backdropFilter: 'blur(12px)',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90vh',
    overflowY: 'auto',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    padding: '32px 36px',
    position: 'relative',
  },
  stepRow: {
    display: 'flex',
    gap: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
  },
  stepDot: {
    height: 4,
    borderRadius: 2,
    transition: 'all 300ms ease',
  },
  stepContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: 12,
  },
  botIcon: {
    width: 80,
    height: 80,
    borderRadius: '50%',
    background: 'rgba(52, 211, 153, 0.1)',
    border: '2px solid rgba(52, 211, 153, 0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: 700,
    color: 'var(--text-primary)',
    letterSpacing: '-0.02em',
  },
  subtitle: {
    fontSize: 15,
    color: 'var(--text-secondary)',
    maxWidth: 320,
    lineHeight: 1.5,
    marginBottom: 8,
  },
  stepTitle: {
    fontSize: 20,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  stepDesc: {
    fontSize: 14,
    color: 'var(--text-tertiary)',
    marginBottom: 8,
  },
  formGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    width: '100%',
    textAlign: 'left',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  input: {
    width: '100%',
    padding: '9px 12px',
    fontSize: 14,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-primary)',
    outline: 'none',
  },
  hint: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 20,
    border: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    transition: 'all 150ms ease',
  },
  chipActive: {
    background: 'rgba(52, 211, 153, 0.12)',
    borderColor: 'rgba(52, 211, 153, 0.4)',
    color: 'var(--accent)',
  },
  toggle: {
    width: 36,
    height: 20,
    borderRadius: 10,
    border: '1px solid var(--border)',
    position: 'relative',
    cursor: 'pointer',
    transition: 'background 200ms ease',
    flexShrink: 0,
  },
  toggleThumb: {
    display: 'block',
    width: 14,
    height: 14,
    borderRadius: '50%',
    background: '#fff',
    position: 'absolute',
    top: 2,
    transition: 'transform 200ms ease',
  },
  range: {
    width: '100%',
    accentColor: 'var(--accent)',
    cursor: 'pointer',
    background: 'transparent',
    border: 'none',
    padding: 0,
  },
  rangeLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    color: 'var(--text-tertiary)',
  },
  dropZone: {
    width: '100%',
    padding: '32px 20px',
    border: '2px dashed var(--border)',
    borderRadius: 'var(--radius-lg)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    cursor: 'pointer',
    transition: 'border-color 200ms ease',
    marginTop: 4,
  },
  ghostBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: 'var(--text-tertiary)',
    padding: '8px 16px',
    borderRadius: 'var(--radius-md)',
    transition: 'color 150ms ease',
    marginTop: 8,
  },
  featureList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    width: '100%',
    textAlign: 'left',
    marginTop: 8,
    marginBottom: 8,
  },
  featureItem: {
    display: 'flex',
    gap: 14,
    alignItems: 'flex-start',
    padding: '12px 14px',
    background: 'var(--bg-elevated)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--border)',
  },
  featureIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    background: 'rgba(255,255,255,0.04)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  featureName: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary)',
    marginBottom: 2,
  },
  featureDesc: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    lineHeight: 1.4,
  },
  readyIcon: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: 'rgba(52, 211, 153, 0.1)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  primaryBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '11px 24px',
    fontSize: 14,
    fontWeight: 600,
    color: '#000',
    background: 'var(--accent)',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    transition: 'opacity 150ms ease',
    marginTop: 8,
  },
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: 'var(--text-secondary)',
    padding: '8px 12px',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    transition: 'color 150ms ease',
  },
  navRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
    paddingTop: 16,
    borderTop: '1px solid var(--border)',
  },
}
