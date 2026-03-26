import { useState, useCallback, useRef, useEffect } from 'react'
import {
  X,
  Upload,
  Check,
  FileText,
  Link as LinkIcon,
  Globe,
  Linkedin,
  Github,
  Briefcase,
  Hash,
  Award,
  BookOpen,
  Languages,
  Clock,
  Shield,
  ChevronRight,
  ChevronLeft,
  AlertCircle,
} from 'lucide-react'

// Mobile responsive CSS
const profileModalResponsiveCSS = `
@media (max-width: 767px) {
  .profile-modal-overlay {
    padding: 0 !important;
    align-items: flex-end !important;
  }
  .profile-modal {
    max-width: 100% !important;
    max-height: 100vh !important;
    border-radius: 16px 16px 0 0 !important;
    height: 95vh !important;
  }
  .profile-modal-header {
    padding: 20px 16px 0 !important;
  }
  .profile-modal-stepper {
    padding: 12px 16px 0 !important;
  }
  .profile-modal-body {
    padding: 16px !important;
  }
  .profile-modal-footer {
    padding: 12px 16px !important;
  }
}
`
if (typeof document !== 'undefined') {
  const id = 'profile-modal-responsive-styles'
  if (!document.getElementById(id)) {
    const style = document.createElement('style')
    style.id = id
    style.textContent = profileModalResponsiveCSS
    document.head.appendChild(style)
  }
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface UserProfile {
  /* Step 1 — Documents: Context (for AI to understand you) */
  contextCvFileName: string | null
  contextCvFileSize: number | null
  contextPortfolioUrl: string
  contextWebsiteUrl: string
  contextLinkedinPdfFileName: string | null  // detailed LinkedIn export

  /* Step 1 — Documents: Submit (sent to recruiters) */
  cvFileName: string | null          // 1-page designed CV
  cvFileSize: number | null
  portfolioFileName: string | null   // curated portfolio PDF
  portfolioFileSize: number | null
  portfolioUrl: string               // online portfolio link
  websiteUrl: string

  /* Step 2 — Professional Links */
  linkedinUrl: string
  githubUrl: string
  currentRole: string
  yearsOfExperience: number | null
  keySkills: string[]

  /* Step 3 — Screening */
  workAuthorization: string
  noticePeriod: string
  languages: string[]
  education: string
}

const EMPTY_PROFILE: UserProfile = {
  // Context (for AI)
  contextCvFileName: null,
  contextCvFileSize: null,
  contextPortfolioUrl: '',
  contextWebsiteUrl: '',
  contextLinkedinPdfFileName: null,
  // Submit (to recruiters)
  cvFileName: null,
  cvFileSize: null,
  portfolioFileName: null,
  portfolioFileSize: null,
  portfolioUrl: '',
  websiteUrl: 'https://',
  // Professional
  linkedinUrl: '',
  githubUrl: '',
  currentRole: '',
  yearsOfExperience: null,
  keySkills: [],
  // Screening
  workAuthorization: '',
  noticePeriod: '',
  languages: [],
  education: '',
}

const PROFILE_LS_KEY = 'tracker_v2_user_profile'
const PROFILE_COMPLETE_LS_KEY = 'tracker_v2_profile_complete'

function loadProfile(): UserProfile {
  try {
    const raw = localStorage.getItem(PROFILE_LS_KEY)
    if (raw) return { ...EMPTY_PROFILE, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...EMPTY_PROFILE }
}

function saveProfile(p: UserProfile) {
  try {
    localStorage.setItem(PROFILE_LS_KEY, JSON.stringify(p))
  } catch { /* ignore */ }
}

export function isProfileComplete(): boolean {
  return localStorage.getItem(PROFILE_COMPLETE_LS_KEY) === 'true'
}

export function markProfileComplete() {
  localStorage.setItem(PROFILE_COMPLETE_LS_KEY, 'true')
}

/* ------------------------------------------------------------------ */
/*  Skill suggestions                                                  */
/* ------------------------------------------------------------------ */
const SKILL_SUGGESTIONS = [
  'Figma', 'React', 'TypeScript', 'Python', 'JavaScript', 'CSS',
  'Design Systems', 'User Research', 'Prototyping', 'Wireframing',
  'HTML', 'Node.js', 'SQL', 'Product Strategy', 'Agile', 'Scrum',
  'Data Analysis', 'A/B Testing', 'Accessibility', 'Storybook',
  'Tailwind CSS', 'Next.js', 'Vue.js', 'Angular', 'Swift', 'Kotlin',
  'Java', 'C++', 'Go', 'Rust', 'AWS', 'Docker', 'Kubernetes',
  'GraphQL', 'REST APIs', 'PostgreSQL', 'MongoDB', 'Redis',
  'Machine Learning', 'TensorFlow', 'PyTorch',
]

const LANGUAGE_SUGGESTIONS = [
  'English (Native)', 'English (Fluent)', 'English (Professional)',
  'French (Native)', 'French (Fluent)', 'French (Professional)',
  'Spanish (Native)', 'Spanish (Fluent)', 'Spanish (Professional)',
  'German (Native)', 'German (Fluent)', 'German (Professional)',
  'Mandarin (Native)', 'Mandarin (Fluent)', 'Mandarin (Professional)',
  'Japanese (Fluent)', 'Japanese (Professional)',
  'Korean (Fluent)', 'Korean (Professional)',
  'Thai (Native)', 'Thai (Fluent)',
  'Portuguese (Native)', 'Portuguese (Fluent)',
  'Italian (Fluent)', 'Arabic (Fluent)', 'Hindi (Fluent)',
  'Dutch (Fluent)', 'Swedish (Fluent)', 'Russian (Fluent)',
]

const WORK_AUTH_OPTIONS = [
  'EU Citizen',
  'US Citizen',
  'UK Citizen',
  'Work Visa Required',
  'No Visa Needed',
]

const NOTICE_OPTIONS = [
  'Immediately',
  '2 weeks',
  '1 month',
  '2 months',
  '3 months',
]

/* ------------------------------------------------------------------ */
/*  Chip input sub-component                                           */
/* ------------------------------------------------------------------ */
function ChipInput({
  value,
  onChange,
  suggestions,
  placeholder,
}: {
  value: string[]
  onChange: (v: string[]) => void
  suggestions: string[]
  placeholder: string
}) {
  const [input, setInput] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const filtered = suggestions.filter(
    (s) =>
      s.toLowerCase().includes(input.toLowerCase()) &&
      !value.includes(s)
  ).slice(0, 8)

  const addChip = useCallback((chip: string) => {
    const trimmed = chip.trim()
    if (!trimmed || value.includes(trimmed)) return
    onChange([...value, trimmed])
    setInput('')
    setShowSuggestions(false)
    inputRef.current?.focus()
  }, [value, onChange])

  const removeChip = useCallback((chip: string) => {
    onChange(value.filter((v) => v !== chip))
  }, [value, onChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault()
      addChip(input)
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }, [input, value, addChip, onChange])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={chipStyles.wrap}>
        {value.map((chip) => (
          <span key={chip} style={chipStyles.chip}>
            {chip}
            <button
              style={chipStyles.chipRemove}
              onClick={() => removeChip(chip)}
              type="button"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          style={chipStyles.input}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            setShowSuggestions(true)
          }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? placeholder : 'Add more...'}
        />
      </div>
      {showSuggestions && filtered.length > 0 && (
        <div style={chipStyles.dropdown}>
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              style={chipStyles.dropdownItem}
              onMouseDown={(e) => {
                e.preventDefault()
                addChip(s)
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const chipStyles: Record<string, React.CSSProperties> = {
  wrap: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    padding: '8px 10px',
    background: 'var(--bg-base)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    minHeight: 40,
    alignItems: 'center',
    cursor: 'text',
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap' as const,
  },
  chipRemove: {
    background: 'none',
    border: 'none',
    color: 'var(--text-tertiary)',
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    minWidth: 80,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'var(--text-primary)',
    fontSize: 13,
  },
  dropdown: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    maxHeight: 180,
    overflowY: 'auto' as const,
    zIndex: 20,
    boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
  },
  dropdownItem: {
    display: 'block',
    width: '100%',
    textAlign: 'left' as const,
    padding: '8px 12px',
    background: 'none',
    border: 'none',
    color: 'var(--text-primary)',
    fontSize: 13,
    cursor: 'pointer',
  },
}

/* ------------------------------------------------------------------ */
/*  URL validation helper                                              */
/* ------------------------------------------------------------------ */
function isValidUrl(url: string): boolean {
  if (!url || url === 'https://') return true // empty = optional = valid
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */
interface ProfileSetupModalProps {
  onComplete: () => void
  onDismiss: () => void
  /** The search config location rules — used for read-only salary/remote summary */
  locationRulesSummary?: string
  remotePreference?: string
}

export function ProfileSetupModal({
  onComplete,
  onDismiss,
  locationRulesSummary,
  remotePreference,
}: ProfileSetupModalProps) {
  const [step, setStep] = useState(0)
  const [profile, setProfile] = useState<UserProfile>(loadProfile)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const portfolioFileRef = useRef<HTMLInputElement>(null)
  const contextCvRef = useRef<HTMLInputElement>(null)

  const STEPS = ['Documents', 'Professional', 'Screening']

  const patch = useCallback((p: Partial<UserProfile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...p }
      saveProfile(next)
      return next
    })
    // Clear related errors
    setErrors((prev) => {
      const next = { ...prev }
      Object.keys(p).forEach((k) => delete next[k])
      return next
    })
  }, [])

  /* ---- File upload ---- */
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.type !== 'application/pdf') {
      setErrors((prev) => ({ ...prev, cv: 'Only PDF files are accepted' }))
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, cv: 'File must be under 20MB' }))
      return
    }

    patch({
      cvFileName: file.name,
      cvFileSize: file.size,
    })
    setErrors((prev) => {
      const next = { ...prev }
      delete next.cv
      return next
    })
  }, [patch])

  const handlePortfolioFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== 'application/pdf' || file.size > 20 * 1024 * 1024) return
    patch({ portfolioFileName: file.name, portfolioFileSize: file.size })
  }, [patch])

  const handleContextCvChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== 'application/pdf' || file.size > 10 * 1024 * 1024) return
    patch({ contextCvFileName: file.name, contextCvFileSize: file.size })
  }, [patch])

  /* ---- Step validation ---- */
  const validateStep = useCallback((stepIndex: number): boolean => {
    const newErrors: Record<string, string> = {}

    if (stepIndex === 0) {
      if (!profile.cvFileName) {
        newErrors.cv = 'A CV/Resume is required to proceed'
      }
      if (profile.portfolioUrl && !isValidUrl(profile.portfolioUrl)) {
        newErrors.portfolioUrl = 'Please enter a valid URL'
      }
      if (profile.websiteUrl && profile.websiteUrl !== 'https://' && !isValidUrl(profile.websiteUrl)) {
        newErrors.websiteUrl = 'Please enter a valid URL'
      }
    }

    if (stepIndex === 1) {
      if (profile.linkedinUrl && !isValidUrl(profile.linkedinUrl)) {
        newErrors.linkedinUrl = 'Please enter a valid URL'
      }
      if (profile.githubUrl && !isValidUrl(profile.githubUrl)) {
        newErrors.githubUrl = 'Please enter a valid URL'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [profile])

  const handleNext = useCallback(() => {
    if (!validateStep(step)) return
    if (step < STEPS.length - 1) {
      setStep(step + 1)
    }
  }, [step, validateStep, STEPS.length])

  const handleBack = useCallback(() => {
    if (step > 0) setStep(step - 1)
  }, [step])

  const handleComplete = useCallback(() => {
    if (!validateStep(step)) return
    saveProfile(profile)
    markProfileComplete()
    onComplete()
  }, [step, profile, validateStep, onComplete])

  const handleSkip = useCallback(() => {
    // On step 0 (Documents), CV is required — can't skip if no CV
    if (step === 0 && !profile.cvFileName) {
      setErrors({ cv: 'A CV/Resume is required. Upload it to continue.' })
      return
    }
    if (step < STEPS.length - 1) {
      setStep(step + 1)
    } else {
      // Last step skip = complete
      handleComplete()
    }
  }, [step, profile.cvFileName, STEPS.length, handleComplete])

  const formatFileSize = (bytes: number | null): string => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  }

  /* ---- Render steps ---- */
  const renderStep0 = () => (
    <div style={ms.stepContent}>
      {/* ---- Section: Send to Recruiters ---- */}
      <div style={ms.sectionHeader}>
        <span style={ms.sectionIcon}>📤</span>
        <div>
          <h4 style={ms.sectionTitle}>Send to Recruiters</h4>
          <p style={ms.sectionDesc}>These files are attached to every application.</p>
        </div>
      </div>

      <div style={ms.fieldGroup}>
        <label style={ms.label}>
          <FileText size={14} color="var(--text-tertiary)" />
          CV / Resume (1-page) <span style={ms.required}>*</span>
        </label>
        <p style={ms.helper}>Upload your polished, 1-page CV — this is what recruiters see.</p>
        {profile.cvFileName ? (
          <div style={ms.uploadedFile}>
            <div style={ms.uploadedFileInfo}>
              <Check size={16} color="#34d399" />
              <span style={ms.uploadedFileName}>{profile.cvFileName}</span>
              {profile.cvFileSize && (
                <span style={ms.uploadedFileSize}>{formatFileSize(profile.cvFileSize)}</span>
              )}
            </div>
            <button type="button" style={ms.uploadedFileChange} onClick={() => fileInputRef.current?.click()}>Change</button>
          </div>
        ) : (
          <button type="button" style={ms.uploadBtn} onClick={() => fileInputRef.current?.click()}>
            <Upload size={16} /> Upload PDF (max 20MB)
          </button>
        )}
        <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={handleFileChange} />
        {errors.cv && <span style={ms.error}><AlertCircle size={12} /> {errors.cv}</span>}
      </div>

      <div style={ms.fieldGroup}>
        <label style={ms.label}>
          <FileText size={14} color="var(--text-tertiary)" />
          Portfolio PDF <span style={ms.optional}>optional</span>
        </label>
        {profile.portfolioFileName ? (
          <div style={ms.uploadedFile}>
            <div style={ms.uploadedFileInfo}>
              <Check size={16} color="#34d399" />
              <span style={ms.uploadedFileName}>{profile.portfolioFileName}</span>
              {profile.portfolioFileSize && (
                <span style={ms.uploadedFileSize}>{formatFileSize(profile.portfolioFileSize)}</span>
              )}
            </div>
            <button type="button" style={ms.uploadedFileChange} onClick={() => portfolioFileRef.current?.click()}>Change</button>
          </div>
        ) : (
          <button type="button" style={{ ...ms.uploadBtn, borderColor: 'var(--border)' }} onClick={() => portfolioFileRef.current?.click()}>
            <Upload size={16} /> Upload Portfolio PDF
          </button>
        )}
        <input ref={portfolioFileRef} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={handlePortfolioFileChange} />
      </div>

      <div style={ms.fieldGroup}>
        <label style={ms.label}><LinkIcon size={14} color="var(--text-tertiary)" /> Portfolio URL <span style={ms.optional}>optional</span></label>
        <input type="url" style={ms.input} placeholder="https://your-portfolio.com" value={profile.portfolioUrl} onChange={(e) => patch({ portfolioUrl: e.target.value })} />
        {errors.portfolioUrl && <span style={ms.error}><AlertCircle size={12} /> {errors.portfolioUrl}</span>}
      </div>

      <div style={ms.fieldGroup}>
        <label style={ms.label}><Globe size={14} color="var(--text-tertiary)" /> Website <span style={ms.optional}>optional</span></label>
        <input type="url" style={ms.input} placeholder="https://yoursite.com" value={profile.websiteUrl} onChange={(e) => patch({ websiteUrl: e.target.value })} />
        {errors.websiteUrl && <span style={ms.error}><AlertCircle size={12} /> {errors.websiteUrl}</span>}
      </div>

      {/* ---- Separator ---- */}
      <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }} />

      {/* ---- Section: Context for AI ---- */}
      <div style={ms.sectionHeader}>
        <span style={ms.sectionIcon}>🧠</span>
        <div>
          <h4 style={ms.sectionTitle}>Context for AI</h4>
          <p style={ms.sectionDesc}>Help the bot understand your full profile. These are NOT sent to recruiters.</p>
        </div>
      </div>

      <div style={ms.fieldGroup}>
        <label style={ms.label}><FileText size={14} color="var(--text-tertiary)" /> Detailed CV / LinkedIn PDF <span style={ms.optional}>optional</span></label>
        <p style={ms.helper}>Upload your complete LinkedIn export or detailed CV. The AI reads this to answer screening questions accurately.</p>
        {profile.contextCvFileName ? (
          <div style={ms.uploadedFile}>
            <div style={ms.uploadedFileInfo}>
              <Check size={16} color="#60a5fa" />
              <span style={ms.uploadedFileName}>{profile.contextCvFileName}</span>
              {profile.contextCvFileSize && (
                <span style={ms.uploadedFileSize}>{formatFileSize(profile.contextCvFileSize)}</span>
              )}
            </div>
            <button type="button" style={ms.uploadedFileChange} onClick={() => contextCvRef.current?.click()}>Change</button>
          </div>
        ) : (
          <button type="button" style={{ ...ms.uploadBtn, borderColor: 'rgba(96, 165, 250, 0.3)' }} onClick={() => contextCvRef.current?.click()}>
            <Upload size={16} /> Upload detailed CV / LinkedIn PDF
          </button>
        )}
        <input ref={contextCvRef} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={handleContextCvChange} />
      </div>

      <div style={ms.fieldGroup}>
        <label style={ms.label}><Globe size={14} color="var(--text-tertiary)" /> Portfolio URL (detailed) <span style={ms.optional}>optional</span></label>
        <input type="url" style={ms.input} placeholder="https://full-portfolio.com" value={profile.contextPortfolioUrl} onChange={(e) => patch({ contextPortfolioUrl: e.target.value })} />
      </div>

      <div style={ms.fieldGroup}>
        <label style={ms.label}><Globe size={14} color="var(--text-tertiary)" /> Website (for context) <span style={ms.optional}>optional</span></label>
        <input type="url" style={ms.input} placeholder="https://your-detailed-site.com" value={profile.contextWebsiteUrl} onChange={(e) => patch({ contextWebsiteUrl: e.target.value })} />
      </div>
    </div>
  )

  const renderStep1 = () => (
    <div style={ms.stepContent}>
      <div style={ms.fieldGroup}>
        <label style={ms.label}>
          <Linkedin size={14} color="var(--text-tertiary)" />
          LinkedIn
        </label>
        <input
          type="url"
          style={ms.input}
          placeholder="https://linkedin.com/in/..."
          value={profile.linkedinUrl}
          onChange={(e) => patch({ linkedinUrl: e.target.value })}
        />
        {errors.linkedinUrl && <span style={ms.error}><AlertCircle size={12} /> {errors.linkedinUrl}</span>}
      </div>

      <div style={ms.fieldGroup}>
        <label style={ms.label}>
          <Github size={14} color="var(--text-tertiary)" />
          GitHub
          <span style={ms.optional}>optional</span>
        </label>
        <input
          type="url"
          style={ms.input}
          placeholder="https://github.com/..."
          value={profile.githubUrl}
          onChange={(e) => patch({ githubUrl: e.target.value })}
        />
        {errors.githubUrl && <span style={ms.error}><AlertCircle size={12} /> {errors.githubUrl}</span>}
      </div>

      <div style={ms.fieldGroup}>
        <label style={ms.label}>
          <Briefcase size={14} color="var(--text-tertiary)" />
          Current Role
        </label>
        <input
          type="text"
          style={ms.input}
          placeholder="e.g. Senior Product Designer"
          value={profile.currentRole}
          onChange={(e) => patch({ currentRole: e.target.value })}
        />
      </div>

      <div style={ms.fieldGroup}>
        <label style={ms.label}>
          <Hash size={14} color="var(--text-tertiary)" />
          Years of Experience
        </label>
        <input
          type="number"
          style={{ ...ms.input, maxWidth: 120 }}
          placeholder="e.g. 7"
          min={1}
          max={30}
          value={profile.yearsOfExperience ?? ''}
          onChange={(e) => {
            const val = e.target.value ? parseInt(e.target.value, 10) : null
            patch({ yearsOfExperience: val && val >= 1 && val <= 30 ? val : null })
          }}
        />
      </div>

      <div style={ms.fieldGroup}>
        <label style={ms.label}>
          <Award size={14} color="var(--text-tertiary)" />
          Key Skills
        </label>
        <ChipInput
          value={profile.keySkills}
          onChange={(v) => patch({ keySkills: v })}
          suggestions={SKILL_SUGGESTIONS}
          placeholder="Type or select skills..."
        />
      </div>
    </div>
  )

  const renderStep2 = () => (
    <div style={ms.stepContent}>
      <div style={ms.fieldGroup}>
        <label style={ms.label}>
          <Shield size={14} color="var(--text-tertiary)" />
          Work Authorization
        </label>
        <select
          style={ms.select}
          value={profile.workAuthorization}
          onChange={(e) => patch({ workAuthorization: e.target.value })}
        >
          <option value="">Select...</option>
          {WORK_AUTH_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>

      {remotePreference && (
        <div style={ms.fieldGroup}>
          <label style={ms.label}>
            <Globe size={14} color="var(--text-tertiary)" />
            Remote Preference
            <span style={ms.readOnlyBadge}>from search settings</span>
          </label>
          <div style={ms.readOnlyField}>{remotePreference}</div>
        </div>
      )}

      <div style={ms.fieldGroup}>
        <label style={ms.label}>
          <Clock size={14} color="var(--text-tertiary)" />
          Notice Period
        </label>
        <select
          style={ms.select}
          value={profile.noticePeriod}
          onChange={(e) => patch({ noticePeriod: e.target.value })}
        >
          <option value="">Select...</option>
          {NOTICE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>

      {locationRulesSummary && (
        <div style={ms.fieldGroup}>
          <label style={ms.label}>
            <Briefcase size={14} color="var(--text-tertiary)" />
            Salary Expectation
            <span style={ms.readOnlyBadge}>from location rules</span>
          </label>
          <div style={ms.readOnlyField}>{locationRulesSummary}</div>
        </div>
      )}

      <div style={ms.fieldGroup}>
        <label style={ms.label}>
          <Languages size={14} color="var(--text-tertiary)" />
          Languages
        </label>
        <ChipInput
          value={profile.languages}
          onChange={(v) => patch({ languages: v })}
          suggestions={LANGUAGE_SUGGESTIONS}
          placeholder="e.g. English (Fluent)..."
        />
      </div>

      <div style={ms.fieldGroup}>
        <label style={ms.label}>
          <BookOpen size={14} color="var(--text-tertiary)" />
          Education
        </label>
        <input
          type="text"
          style={ms.input}
          placeholder="e.g. Master UX Design, ESD Paris"
          value={profile.education}
          onChange={(e) => patch({ education: e.target.value })}
        />
      </div>
    </div>
  )

  const stepRenderers = [renderStep0, renderStep1, renderStep2]

  // Prevent body scroll when modal is open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  return (
    <div className="profile-modal-overlay" style={ms.overlay} onClick={onDismiss}>
      <div className="profile-modal" style={ms.modal} onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button type="button" style={ms.closeBtn} onClick={onDismiss}>
          <X size={18} />
        </button>

        {/* Header */}
        <div className="profile-modal-header" style={ms.header}>
          <h2 style={ms.title}>Complete Your Profile</h2>
          <p style={ms.subtitle}>
            The bot needs your professional data to apply on your behalf.
          </p>
        </div>

        {/* Step indicators */}
        <div className="profile-modal-stepper" style={ms.stepper}>
          {STEPS.map((label, i) => (
            <button
              key={label}
              type="button"
              style={{
                ...ms.stepIndicator,
                ...(i === step ? ms.stepIndicatorActive : {}),
                ...(i < step ? ms.stepIndicatorDone : {}),
              }}
              onClick={() => {
                // Allow going back freely, forward only if current step validates
                if (i < step) {
                  setStep(i)
                } else if (i === step + 1 && validateStep(step)) {
                  setStep(i)
                }
              }}
            >
              <span style={{
                ...ms.stepNumber,
                ...(i === step ? ms.stepNumberActive : {}),
                ...(i < step ? ms.stepNumberDone : {}),
              }}>
                {i < step ? <Check size={12} /> : i + 1}
              </span>
              <span style={{
                ...ms.stepLabel,
                ...(i === step ? ms.stepLabelActive : {}),
              }}>
                {label}
              </span>
            </button>
          ))}
        </div>

        {/* Step content */}
        <div className="profile-modal-body" style={ms.body}>
          {stepRenderers[step]()}
        </div>

        {/* Footer */}
        <div className="profile-modal-footer" style={ms.footer}>
          <div style={ms.footerLeft}>
            {step > 0 && (
              <button type="button" style={ms.btnBack} onClick={handleBack}>
                <ChevronLeft size={14} />
                Back
              </button>
            )}
          </div>
          <div style={ms.footerRight}>
            <button type="button" style={ms.btnSkip} onClick={handleSkip}>
              {step === STEPS.length - 1 ? 'Skip & Start Bot' : 'Skip for now'}
            </button>
            {step < STEPS.length - 1 ? (
              <button type="button" style={ms.btnNext} onClick={handleNext}>
                Next
                <ChevronRight size={14} />
              </button>
            ) : (
              <button type="button" style={ms.btnComplete} onClick={handleComplete}>
                <Check size={14} />
                Complete & Start Bot
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Keyframe for backdrop blur animation */}
      <style>{`
        @keyframes profileModalFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes profileModalSlideUp {
          from { opacity: 0; transform: translateY(24px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */
const ms: Record<string, React.CSSProperties> = {
  /* Overlay */
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.6)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    animation: 'profileModalFadeIn 0.2s ease',
    padding: 16,
  },

  /* Modal container */
  modal: {
    position: 'relative',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    width: '100%',
    maxWidth: 560,
    maxHeight: 'calc(100vh - 32px)',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
    animation: 'profileModalSlideUp 0.25s ease',
    overflow: 'hidden',
  },

  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    background: 'none',
    border: 'none',
    color: 'var(--text-tertiary)',
    cursor: 'pointer',
    padding: 4,
    borderRadius: 'var(--radius-sm)',
    display: 'flex',
    alignItems: 'center',
    zIndex: 2,
  },

  /* Header */
  header: {
    padding: '24px 28px 0',
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--text-primary)',
    margin: '0 0 4px',
  },
  subtitle: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
    margin: 0,
    lineHeight: 1.4,
  },

  /* Stepper */
  stepper: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '16px 28px 0',
  },
  stepIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    padding: '8px 0',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    borderBottom: '2px solid var(--border)',
    transition: 'border-color 0.15s',
  },
  stepIndicatorActive: {
    borderBottomColor: 'var(--accent)',
  },
  stepIndicatorDone: {
    borderBottomColor: '#34d399',
  },
  stepNumber: {
    width: 22,
    height: 22,
    borderRadius: '50%',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text-tertiary)',
    flexShrink: 0,
  },
  stepNumberActive: {
    background: 'var(--accent)',
    borderColor: 'var(--accent)',
    color: '#09090b',
  },
  stepNumberDone: {
    background: 'rgba(52, 211, 153, 0.15)',
    borderColor: '#34d399',
    color: '#34d399',
  },
  stepLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-tertiary)',
    whiteSpace: 'nowrap' as const,
  },
  stepLabelActive: {
    color: 'var(--text-primary)',
    fontWeight: 600,
  },

  /* Body (scrollable) */
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px 28px',
  },

  stepContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },

  /* Fields */
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-secondary)',
  },
  required: {
    color: '#f43f5e',
    fontSize: 13,
  },
  optional: {
    fontSize: 11,
    fontWeight: 400,
    color: 'var(--text-tertiary)',
    marginLeft: 4,
  },
  helper: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    margin: '0 0 4px',
    lineHeight: 1.4,
  },
  input: {
    background: 'var(--bg-base)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: '9px 12px',
    color: 'var(--text-primary)',
    fontSize: 13,
    outline: 'none',
    width: '100%',
    transition: 'border-color 0.15s',
  },
  select: {
    background: 'var(--bg-base)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: '9px 12px',
    color: 'var(--text-primary)',
    fontSize: 13,
    outline: 'none',
    width: '100%',
    cursor: 'pointer',
    appearance: 'none' as const,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238a8a94' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 12px center',
    paddingRight: 32,
  },
  error: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 12,
    color: '#f43f5e',
    marginTop: 2,
  },

  /* Section headers */
  sectionHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 4,
  },
  sectionIcon: {
    fontSize: 20,
    lineHeight: 1,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: 'var(--text-primary)',
    margin: 0,
  },
  sectionDesc: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    margin: '2px 0 0',
    lineHeight: 1.4,
  },

  /* Upload button */
  uploadBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '16px 20px',
    background: 'var(--bg-base)',
    border: '2px dashed var(--border)',
    borderRadius: 'var(--radius-lg)',
    color: 'var(--text-secondary)',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'border-color 0.15s, color 0.15s',
  },

  /* Uploaded file display */
  uploadedFile: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    background: 'rgba(52, 211, 153, 0.06)',
    border: '1px solid rgba(52, 211, 153, 0.2)',
    borderRadius: 'var(--radius-md)',
  },
  uploadedFileInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  uploadedFileName: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  uploadedFileSize: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
    flexShrink: 0,
  },
  uploadedFileChange: {
    background: 'none',
    border: 'none',
    color: 'var(--accent)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    flexShrink: 0,
    padding: '2px 6px',
  },

  /* Read-only fields */
  readOnlyBadge: {
    fontSize: 10,
    fontWeight: 500,
    color: 'var(--text-tertiary)',
    background: 'var(--bg-elevated)',
    padding: '2px 6px',
    borderRadius: 8,
    marginLeft: 6,
  },
  readOnlyField: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: '9px 12px',
    color: 'var(--text-secondary)',
    fontSize: 13,
    fontStyle: 'italic' as const,
  },

  /* Footer */
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 28px',
    borderTop: '1px solid var(--border)',
    gap: 12,
  },
  footerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  footerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },

  /* Buttons */
  btnBack: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    cursor: 'pointer',
  },
  btnSkip: {
    background: 'none',
    border: 'none',
    padding: '8px 12px',
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-tertiary)',
    cursor: 'pointer',
    textDecoration: 'underline' as const,
    textUnderlineOffset: '2px',
  },
  btnNext: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-hover)',
    borderRadius: 'var(--radius-md)',
    padding: '8px 18px',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  btnComplete: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: '#34d399',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    padding: '8px 20px',
    fontSize: 13,
    fontWeight: 700,
    color: '#09090b',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
}
