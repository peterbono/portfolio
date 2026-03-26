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
  Plus,
  Trash2,
  Sparkles,
  Send,
  Brain,
  Eye,
  Loader2,
  Zap,
} from 'lucide-react'
import { uploadDocument, triggerCompression } from '../lib/document-storage'
import { supabase } from '../lib/supabase'

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

/** A file uploaded in Step 1 (context for AI) */
export interface ContextFile {
  id: string
  fileName: string
  fileSize: number
  fileType: string // mime or extension
}

/** A link added in Step 1 */
export interface ContextLink {
  id: string
  url: string
  label?: string // auto-detected: "LinkedIn", "GitHub", "Website", etc.
}

export interface UserProfile {
  /* Step 1 — Feed the AI: raw materials */
  contextFiles: ContextFile[]
  contextLinks: ContextLink[]

  /* Step 2 — For Recruiters: curated submission */
  cvFileName: string | null
  cvFileSize: number | null
  portfolioFileName: string | null
  portfolioFileSize: number | null
  portfolioUrl: string
  websiteUrl: string

  /* Step 3 — Professional */
  linkedinUrl: string
  githubUrl: string
  currentRole: string
  yearsOfExperience: number | null
  keySkills: string[]

  /* Step 4 — Screening */
  workAuthorization: string
  noticePeriod: string
  languages: string[]
  education: string
}

const EMPTY_PROFILE: UserProfile = {
  // Step 1
  contextFiles: [],
  contextLinks: [],
  // Step 2
  cvFileName: null,
  cvFileSize: null,
  portfolioFileName: null,
  portfolioFileSize: null,
  portfolioUrl: '',
  websiteUrl: 'https://',
  // Step 3
  linkedinUrl: '',
  githubUrl: '',
  currentRole: '',
  yearsOfExperience: null,
  keySkills: [],
  // Step 4
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
    if (raw) {
      const parsed = JSON.parse(raw)
      // Migration: if old format had contextCvFileName but no contextFiles
      if (parsed.contextCvFileName && !parsed.contextFiles) {
        parsed.contextFiles = [{
          id: 'migrated-cv',
          fileName: parsed.contextCvFileName,
          fileSize: parsed.contextCvFileSize || 0,
          fileType: 'application/pdf',
        }]
      }
      if (!parsed.contextFiles) parsed.contextFiles = []
      if (!parsed.contextLinks) {
        // Migrate old URLs to contextLinks
        const links: ContextLink[] = []
        if (parsed.contextPortfolioUrl) {
          links.push({ id: 'migrated-portfolio', url: parsed.contextPortfolioUrl, label: 'Portfolio' })
        }
        if (parsed.contextWebsiteUrl) {
          links.push({ id: 'migrated-website', url: parsed.contextWebsiteUrl, label: 'Website' })
        }
        parsed.contextLinks = links
      }
      return { ...EMPTY_PROFILE, ...parsed }
    }
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
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function detectLinkLabel(url: string): string | undefined {
  const lower = url.toLowerCase()
  if (lower.includes('linkedin.com')) return 'LinkedIn'
  if (lower.includes('github.com') || lower.includes('github.io')) return 'GitHub'
  if (lower.includes('dribbble.com')) return 'Dribbble'
  if (lower.includes('behance.net')) return 'Behance'
  if (lower.includes('figma.com')) return 'Figma'
  if (lower.includes('medium.com')) return 'Medium'
  if (lower.includes('notion.so') || lower.includes('notion.site')) return 'Notion'
  return undefined
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function isValidUrl(url: string): boolean {
  if (!url || url === 'https://') return true
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB per file
const MAX_TOTAL_FILES = 10
const ACCEPTED_FILE_TYPES = '.pdf,.doc,.docx,.png,.jpg,.jpeg'
const ACCEPTED_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
]

/* ------------------------------------------------------------------ */
/*  Skill / Language suggestions                                       */
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
/*  Step info for headers                                              */
/* ------------------------------------------------------------------ */
const STEP_META = [
  {
    key: 'feed',
    label: 'About You',
    icon: Brain,
    title: 'About You',
    subtitle: 'Upload documents and paste links so the AI understands your profile.',
    tip: 'CV, portfolio, LinkedIn export, certificates \u2014 anything goes. The AI figures out what is what.',
  },
  {
    key: 'recruiters',
    label: 'Documents',
    icon: Send,
    title: 'Documents',
    subtitle: 'Choose what gets attached to your applications.',
    tip: 'This is what hiring managers see. Pick your best 1-page CV and portfolio.',
  },
  {
    key: 'professional',
    label: 'Experience',
    icon: Briefcase,
    title: 'Experience',
    subtitle: 'Your role, background, and key skills.',
    tip: null,
  },
  {
    key: 'screening',
    label: 'Quick Answers',
    icon: Shield,
    title: 'Quick Answers',
    subtitle: 'Pre-fill common recruiter questions. Type once, never again.',
    tip: null,
  },
]

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */
interface ProfileSetupModalProps {
  onComplete: () => void
  onDismiss: () => void
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
  const [dragActive, setDragActive] = useState(false)
  const [linkInput, setLinkInput] = useState('')

  // PDF compression state
  const [compressionStatus, setCompressionStatus] = useState<
    'idle' | 'uploading' | 'compressing' | 'done' | 'error'
  >('idle')
  const [compressionMessage, setCompressionMessage] = useState('')

  // Ref to hold the actual File object for upload (state only holds metadata)
  const cvFileObjectRef = useRef<File | null>(null)

  // File input refs
  const contextFileRef = useRef<HTMLInputElement>(null)
  const cvFileRef = useRef<HTMLInputElement>(null)
  const portfolioFileRef = useRef<HTMLInputElement>(null)

  const STEPS = STEP_META.map((s) => s.label)

  const patch = useCallback((p: Partial<UserProfile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...p }
      saveProfile(next)
      return next
    })
    setErrors((prev) => {
      const next = { ...prev }
      Object.keys(p).forEach((k) => delete next[k])
      return next
    })
  }, [])

  /* ---- Step 1: File handling ---- */
  const addContextFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files)
    const valid: ContextFile[] = []
    const errs: string[] = []

    for (const file of arr) {
      if (!ACCEPTED_MIME.includes(file.type)) {
        errs.push(`${file.name}: unsupported format`)
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        errs.push(`${file.name}: exceeds 20MB`)
        continue
      }
      if (profile.contextFiles.length + valid.length >= MAX_TOTAL_FILES) {
        errs.push(`Maximum ${MAX_TOTAL_FILES} files allowed`)
        break
      }
      // Skip duplicates by name
      if (profile.contextFiles.some((f) => f.fileName === file.name)) {
        errs.push(`${file.name}: already added`)
        continue
      }
      valid.push({
        id: generateId(),
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
      })
    }

    if (valid.length > 0) {
      patch({ contextFiles: [...profile.contextFiles, ...valid] })
    }
    if (errs.length > 0) {
      setErrors((prev) => ({ ...prev, contextFiles: errs.join('. ') }))
      setTimeout(() => setErrors((prev) => { const n = { ...prev }; delete n.contextFiles; return n }), 4000)
    }
  }, [profile.contextFiles, patch])

  const removeContextFile = useCallback((id: string) => {
    patch({ contextFiles: profile.contextFiles.filter((f) => f.id !== id) })
  }, [profile.contextFiles, patch])

  const handleContextFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addContextFiles(e.target.files)
    e.target.value = '' // reset so same file can be re-selected
  }, [addContextFiles])

  /* ---- Step 1: Link handling ---- */
  const addContextLink = useCallback(() => {
    const url = linkInput.trim()
    if (!url) return
    // Auto-prepend https:// if missing
    const fullUrl = url.match(/^https?:\/\//) ? url : `https://${url}`
    if (!isValidUrl(fullUrl)) {
      setErrors((prev) => ({ ...prev, contextLink: 'Invalid URL' }))
      return
    }
    if (profile.contextLinks.some((l) => l.url === fullUrl)) {
      setErrors((prev) => ({ ...prev, contextLink: 'Already added' }))
      return
    }
    const label = detectLinkLabel(fullUrl)
    patch({ contextLinks: [...profile.contextLinks, { id: generateId(), url: fullUrl, label }] })
    setLinkInput('')
    setErrors((prev) => { const n = { ...prev }; delete n.contextLink; return n })
  }, [linkInput, profile.contextLinks, patch])

  const removeContextLink = useCallback((id: string) => {
    patch({ contextLinks: profile.contextLinks.filter((l) => l.id !== id) })
  }, [profile.contextLinks, patch])

  /* ---- Drag & drop ---- */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files.length > 0) {
      addContextFiles(e.dataTransfer.files)
    }
  }, [addContextFiles])

  /* ---- Step 2: CV file handling + compression ---- */

  /**
   * Upload CV to Supabase Storage and trigger Ghostscript compression.
   * Runs after the user selects a file or picks a suggestion.
   */
  const uploadAndCompress = useCallback(async (file: File) => {
    // Check auth — compression requires a user ID for storage paths
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user?.id) {
      // Not authenticated: store file locally, compress after auth
      cvFileObjectRef.current = file
      setCompressionStatus('idle')
      setCompressionMessage('Compression will run after you sign in.')
      return
    }

    const userId = session.user.id

    try {
      // Step A: Upload original to Supabase Storage
      setCompressionStatus('uploading')
      setCompressionMessage('Uploading CV to secure storage...')

      const { path: storagePath } = await uploadDocument(file, userId, 'recruiter')

      // Step B: Trigger Ghostscript compression task
      setCompressionStatus('compressing')
      setCompressionMessage('Compressing for different ATS platforms...')

      await triggerCompression(userId, storagePath, file.name)

      // Compression runs async on Trigger.dev — we show success immediately
      setCompressionStatus('done')
      setCompressionMessage('3 versions ready: 10MB, 5MB, 2MB — the bot picks the right one automatically')
    } catch (err) {
      console.error('[ProfileSetup] Compression failed:', err)
      setCompressionStatus('error')
      setCompressionMessage(
        err instanceof Error ? err.message : 'Compression failed. The original CV will still be used.'
      )
    }
  }, [])

  const handleCvFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== 'application/pdf') {
      setErrors((prev) => ({ ...prev, cv: 'Only PDF files accepted for CV' }))
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setErrors((prev) => ({ ...prev, cv: 'File must be under 20MB' }))
      return
    }
    // Store file reference and update profile metadata
    cvFileObjectRef.current = file
    patch({ cvFileName: file.name, cvFileSize: file.size })
    setErrors((prev) => { const n = { ...prev }; delete n.cv; return n })

    // Trigger upload + compression in background
    uploadAndCompress(file)
  }, [patch, uploadAndCompress])

  const handlePortfolioFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type !== 'application/pdf' || file.size > MAX_FILE_SIZE) return
    patch({ portfolioFileName: file.name, portfolioFileSize: file.size })
  }, [patch])

  /** Use a context file as the CV in Step 2 */
  const useSuggestedCv = useCallback((cf: ContextFile) => {
    patch({ cvFileName: cf.fileName, cvFileSize: cf.fileSize })
  }, [patch])

  /** Use a context file as the portfolio PDF in Step 2 */
  const useSuggestedPortfolio = useCallback((cf: ContextFile) => {
    patch({ portfolioFileName: cf.fileName, portfolioFileSize: cf.fileSize })
  }, [patch])

  /** Copy a context link to the recruiter URLs */
  const useContextLinkAsPortfolio = useCallback((url: string) => {
    patch({ portfolioUrl: url })
  }, [patch])

  const useContextLinkAsWebsite = useCallback((url: string) => {
    patch({ websiteUrl: url })
  }, [patch])

  /* ---- Step validation ---- */
  const validateStep = useCallback((stepIndex: number): boolean => {
    const newErrors: Record<string, string> = {}

    if (stepIndex === 0) {
      // Step 1: Need at least 1 file or 1 link
      if (profile.contextFiles.length === 0 && profile.contextLinks.length === 0) {
        newErrors.contextFiles = 'Add at least one document or link so the AI can understand your profile'
      }
    }

    if (stepIndex === 1) {
      // Step 2: CV is required
      if (!profile.cvFileName) {
        newErrors.cv = 'A CV/Resume is required for applications'
      }
      if (profile.portfolioUrl && !isValidUrl(profile.portfolioUrl)) {
        newErrors.portfolioUrl = 'Please enter a valid URL'
      }
      if (profile.websiteUrl && profile.websiteUrl !== 'https://' && !isValidUrl(profile.websiteUrl)) {
        newErrors.websiteUrl = 'Please enter a valid URL'
      }
    }

    if (stepIndex === 2) {
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
    if (step === 0 && profile.contextFiles.length === 0 && profile.contextLinks.length === 0) {
      setErrors({ contextFiles: 'Add at least one document or link to continue' })
      return
    }
    if (step === 1 && !profile.cvFileName) {
      setErrors({ cv: 'A CV/Resume is required. Upload or select one to continue.' })
      return
    }
    if (step < STEPS.length - 1) {
      setStep(step + 1)
    } else {
      handleComplete()
    }
  }, [step, profile.contextFiles.length, profile.contextLinks.length, profile.cvFileName, STEPS.length, handleComplete])

  // Helper: get PDF files from context (for Step 2 suggestions)
  const contextPdfs = profile.contextFiles.filter((f) => f.fileType === 'application/pdf')

  /* ================================================================ */
  /*  STEP 0 — Feed the AI                                            */
  /* ================================================================ */
  const renderStep0 = () => (
    <div style={ms.stepContent}>
      {/* Step description */}
      <div style={ms.stepTipBox}>
        <Sparkles size={14} color="var(--accent)" style={{ flexShrink: 0, marginTop: 1 }} />
        <span style={ms.stepTipText}>
          {STEP_META[0].tip}
        </span>
      </div>

      {/* Drop zone */}
      <div
        style={{
          ...ms.dropZone,
          ...(dragActive ? ms.dropZoneActive : {}),
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => contextFileRef.current?.click()}
      >
        <Upload size={28} color={dragActive ? 'var(--accent)' : 'var(--text-tertiary)'} />
        <div style={ms.dropZoneText}>
          <span style={ms.dropZoneTitle}>
            {dragActive ? 'Drop files here' : 'Drop files or click to browse'}
          </span>
          <span style={ms.dropZoneSub}>
            PDF, DOC, DOCX, PNG, JPG -- up to 20MB each, {MAX_TOTAL_FILES} files max
          </span>
        </div>
      </div>
      <input
        ref={contextFileRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        multiple
        style={{ display: 'none' }}
        onChange={handleContextFileInput}
      />

      {/* Uploaded files list */}
      {profile.contextFiles.length > 0 && (
        <div style={ms.fileList}>
          {profile.contextFiles.map((f) => (
            <div key={f.id} style={ms.fileRow}>
              <div style={ms.fileRowInfo}>
                <FileText size={14} color="var(--text-tertiary)" />
                <span style={ms.fileRowName}>{f.fileName}</span>
                <span style={ms.fileRowSize}>{formatFileSize(f.fileSize)}</span>
              </div>
              <button type="button" style={ms.fileRowRemove} onClick={() => removeContextFile(f.id)}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <div style={ms.fileListSummary}>
            {profile.contextFiles.length} file{profile.contextFiles.length > 1 ? 's' : ''} --{' '}
            {formatFileSize(profile.contextFiles.reduce((sum, f) => sum + f.fileSize, 0))} total
          </div>
        </div>
      )}

      {errors.contextFiles && (
        <span style={ms.error}><AlertCircle size={12} /> {errors.contextFiles}</span>
      )}

      {/* Link input */}
      <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0', paddingTop: 16 }}>
        <label style={ms.label}>
          <LinkIcon size={14} color="var(--text-tertiary)" />
          Add links
        </label>
        <p style={ms.helper}>LinkedIn, GitHub, Dribbble, personal website -- paste any URL</p>
        <div style={ms.linkInputRow}>
          <input
            type="url"
            style={{ ...ms.input, flex: 1 }}
            placeholder="https://..."
            value={linkInput}
            onChange={(e) => {
              setLinkInput(e.target.value)
              setErrors((prev) => { const n = { ...prev }; delete n.contextLink; return n })
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addContextLink() } }}
          />
          <button
            type="button"
            style={ms.addLinkBtn}
            onClick={addContextLink}
            disabled={!linkInput.trim()}
          >
            <Plus size={16} />
          </button>
        </div>
        {errors.contextLink && (
          <span style={ms.error}><AlertCircle size={12} /> {errors.contextLink}</span>
        )}
      </div>

      {/* Links list */}
      {profile.contextLinks.length > 0 && (
        <div style={ms.linkList}>
          {profile.contextLinks.map((l) => (
            <div key={l.id} style={ms.linkRow}>
              <div style={ms.linkRowInfo}>
                {l.label === 'LinkedIn' ? <Linkedin size={13} color="#0a66c2" /> :
                 l.label === 'GitHub' ? <Github size={13} color="var(--text-secondary)" /> :
                 <Globe size={13} color="var(--text-tertiary)" />}
                <span style={ms.linkRowUrl}>{l.url}</span>
                {l.label && <span style={ms.linkRowLabel}>{l.label}</span>}
              </div>
              <button type="button" style={ms.fileRowRemove} onClick={() => removeContextLink(l.id)}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  /* ================================================================ */
  /*  STEP 1 — For Recruiters                                         */
  /* ================================================================ */
  const renderStep1 = () => {
    // Suggestions from Step 1
    const suggestedCvs = contextPdfs.filter((f) => f.fileName !== profile.cvFileName)
    const suggestedPortfolios = contextPdfs.filter(
      (f) => f.fileName !== profile.portfolioFileName && f.fileName !== profile.cvFileName
    )
    const availableLinks = profile.contextLinks.filter(
      (l) => l.url !== profile.portfolioUrl && l.url !== profile.websiteUrl
    )

    return (
      <div style={ms.stepContent}>
        {/* Step description */}
        <div style={ms.stepTipBox}>
          <Eye size={14} color="var(--accent)" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={ms.stepTipText}>
            {STEP_META[1].tip}
          </span>
        </div>

        {/* CV Slot */}
        <div style={ms.fieldGroup}>
          <label style={ms.label}>
            <FileText size={14} color="var(--text-tertiary)" />
            CV / Resume <span style={ms.required}>*</span>
          </label>
          <p style={ms.helper}>Your polished, 1-page CV -- this is what recruiters see first.</p>

          {profile.cvFileName ? (
            <div style={ms.uploadedFile}>
              <div style={ms.uploadedFileInfo}>
                <Check size={16} color="#34d399" />
                <span style={ms.uploadedFileName}>{profile.cvFileName}</span>
                {profile.cvFileSize && (
                  <span style={ms.uploadedFileSize}>{formatFileSize(profile.cvFileSize)}</span>
                )}
              </div>
              <button type="button" style={ms.uploadedFileChange} onClick={() => cvFileRef.current?.click()}>
                Replace
              </button>
            </div>
          ) : (
            <>
              {/* Suggestions from Step 1 */}
              {suggestedCvs.length > 0 && (
                <div style={ms.suggestionBox}>
                  <span style={ms.suggestionLabel}>From your uploads:</span>
                  {suggestedCvs.map((cf) => (
                    <button
                      key={cf.id}
                      type="button"
                      style={ms.suggestionBtn}
                      onClick={() => useSuggestedCv(cf)}
                    >
                      <FileText size={12} />
                      Use {cf.fileName}
                    </button>
                  ))}
                </div>
              )}
              <button type="button" style={ms.uploadBtn} onClick={() => cvFileRef.current?.click()}>
                <Upload size={16} /> Upload CV (PDF, max 20MB)
              </button>
            </>
          )}
          <input ref={cvFileRef} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={handleCvFileChange} />
          {errors.cv && <span style={ms.error}><AlertCircle size={12} /> {errors.cv}</span>}

          {/* Compression status indicator */}
          {compressionStatus !== 'idle' && profile.cvFileName && (
            <div style={{
              marginTop: 8,
              padding: '10px 14px',
              borderRadius: 8,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: compressionStatus === 'done' ? 'rgba(52, 211, 153, 0.08)'
                : compressionStatus === 'error' ? 'rgba(239, 68, 68, 0.08)'
                : 'rgba(99, 102, 241, 0.08)',
              color: compressionStatus === 'done' ? '#34d399'
                : compressionStatus === 'error' ? '#ef4444'
                : 'var(--accent)',
              border: `1px solid ${
                compressionStatus === 'done' ? 'rgba(52, 211, 153, 0.2)'
                : compressionStatus === 'error' ? 'rgba(239, 68, 68, 0.2)'
                : 'rgba(99, 102, 241, 0.2)'
              }`,
            }}>
              {(compressionStatus === 'uploading' || compressionStatus === 'compressing') && (
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
              )}
              {compressionStatus === 'done' && <Zap size={14} />}
              {compressionStatus === 'error' && <AlertCircle size={14} />}
              <span>{compressionMessage}</span>
            </div>
          )}
        </div>

        {/* Portfolio PDF Slot */}
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
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" style={ms.uploadedFileChange} onClick={() => portfolioFileRef.current?.click()}>
                  Replace
                </button>
                <button type="button" style={{ ...ms.uploadedFileChange, color: 'var(--text-tertiary)' }} onClick={() => patch({ portfolioFileName: null, portfolioFileSize: null })}>
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <>
              {suggestedPortfolios.length > 0 && (
                <div style={ms.suggestionBox}>
                  <span style={ms.suggestionLabel}>From your uploads:</span>
                  {suggestedPortfolios.map((cf) => (
                    <button
                      key={cf.id}
                      type="button"
                      style={ms.suggestionBtn}
                      onClick={() => useSuggestedPortfolio(cf)}
                    >
                      <FileText size={12} />
                      Use {cf.fileName}
                    </button>
                  ))}
                </div>
              )}
              <button type="button" style={{ ...ms.uploadBtn, borderColor: 'var(--border)' }} onClick={() => portfolioFileRef.current?.click()}>
                <Upload size={16} /> Upload Portfolio PDF
              </button>
            </>
          )}
          <input ref={portfolioFileRef} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={handlePortfolioFileChange} />
        </div>

        {/* Links for recruiters */}
        <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0', paddingTop: 16 }}>
          <label style={ms.label}>
            <LinkIcon size={14} color="var(--text-tertiary)" />
            Links for applications <span style={ms.optional}>optional</span>
          </label>
          <p style={ms.helper}>Portfolio URL and website included in every application.</p>

          {/* Quick-use suggestions from context links */}
          {availableLinks.length > 0 && !profile.portfolioUrl && (
            <div style={{ ...ms.suggestionBox, marginBottom: 8 }}>
              <span style={ms.suggestionLabel}>Use a link from Step 1:</span>
              {availableLinks.slice(0, 3).map((cl) => (
                <button
                  key={cl.id}
                  type="button"
                  style={ms.suggestionBtn}
                  onClick={() => useContextLinkAsPortfolio(cl.url)}
                >
                  <LinkIcon size={12} />
                  {cl.label || 'Link'}: {cl.url.replace(/^https?:\/\//, '').slice(0, 30)}...
                </button>
              ))}
            </div>
          )}

          <div style={ms.fieldGroup}>
            <label style={{ ...ms.label, fontSize: 12 }}>
              <Globe size={12} color="var(--text-tertiary)" />
              Portfolio URL
            </label>
            <input
              type="url"
              style={ms.input}
              placeholder="https://your-portfolio.com"
              value={profile.portfolioUrl}
              onChange={(e) => patch({ portfolioUrl: e.target.value })}
            />
            {errors.portfolioUrl && <span style={ms.error}><AlertCircle size={12} /> {errors.portfolioUrl}</span>}
          </div>

          <div style={{ ...ms.fieldGroup, marginTop: 8 }}>
            <label style={{ ...ms.label, fontSize: 12 }}>
              <Globe size={12} color="var(--text-tertiary)" />
              Website
            </label>
            <input
              type="url"
              style={ms.input}
              placeholder="https://yoursite.com"
              value={profile.websiteUrl}
              onChange={(e) => patch({ websiteUrl: e.target.value })}
            />
            {errors.websiteUrl && <span style={ms.error}><AlertCircle size={12} /> {errors.websiteUrl}</span>}

            {/* Quick-fill from context links for website */}
            {availableLinks.length > 0 && (!profile.websiteUrl || profile.websiteUrl === 'https://') && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                {availableLinks.slice(0, 2).map((cl) => (
                  <button
                    key={cl.id}
                    type="button"
                    style={ms.inlineSuggestion}
                    onClick={() => useContextLinkAsWebsite(cl.url)}
                  >
                    Use {cl.label || cl.url.replace(/^https?:\/\//, '').slice(0, 25)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  /* ================================================================ */
  /*  STEP 2 — Professional                                           */
  /* ================================================================ */
  const renderStep2 = () => {
    // Pre-fill LinkedIn/GitHub from context links if available
    const linkedinFromContext = profile.contextLinks.find((l) => l.label === 'LinkedIn')
    const githubFromContext = profile.contextLinks.find((l) => l.label === 'GitHub')

    return (
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
          {!profile.linkedinUrl && linkedinFromContext && (
            <button
              type="button"
              style={ms.inlineSuggestion}
              onClick={() => patch({ linkedinUrl: linkedinFromContext.url })}
            >
              Use {linkedinFromContext.url.replace(/^https?:\/\//, '').slice(0, 35)}
            </button>
          )}
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
          {!profile.githubUrl && githubFromContext && (
            <button
              type="button"
              style={ms.inlineSuggestion}
              onClick={() => patch({ githubUrl: githubFromContext.url })}
            >
              Use {githubFromContext.url.replace(/^https?:\/\//, '').slice(0, 35)}
            </button>
          )}
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
  }

  /* ================================================================ */
  /*  STEP 3 — Screening                                              */
  /* ================================================================ */
  const renderStep3 = () => (
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

  const stepRenderers = [renderStep0, renderStep1, renderStep2, renderStep3]

  // Prevent body scroll when modal is open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const currentMeta = STEP_META[step]

  return (
    <div className="profile-modal-overlay" style={ms.overlay} onClick={onDismiss}>
      <div className="profile-modal" style={ms.modal} onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button type="button" style={ms.closeBtn} onClick={onDismiss}>
          <X size={18} />
        </button>

        {/* Header — dynamic per step */}
        <div className="profile-modal-header" style={ms.header}>
          <h2 style={ms.title}>{currentMeta.title}</h2>
          <p style={ms.subtitle}>{currentMeta.subtitle}</p>
        </div>

        {/* Step indicators */}
        <div className="profile-modal-stepper" style={ms.stepper}>
          {STEPS.map((label, i) => {
            const StepIcon = STEP_META[i].icon
            return (
              <button
                key={label}
                type="button"
                style={{
                  ...ms.stepIndicator,
                  ...(i === step ? ms.stepIndicatorActive : {}),
                  ...(i < step ? ms.stepIndicatorDone : {}),
                }}
                onClick={() => {
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
                  {i < step ? <Check size={12} /> : <StepIcon size={12} />}
                </span>
                <span style={{
                  ...ms.stepLabel,
                  ...(i === step ? ms.stepLabelActive : {}),
                }}>
                  {label}
                </span>
              </button>
            )
          })}
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
    maxWidth: 580,
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
    gap: 2,
    padding: '16px 28px 0',
  },
  stepIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
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
    fontSize: 11,
    fontWeight: 500,
    color: 'var(--text-tertiary)',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
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

  /* Step tip box */
  stepTipBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '10px 12px',
    background: 'rgba(var(--accent-rgb, 168, 85, 247), 0.06)',
    border: '1px solid rgba(var(--accent-rgb, 168, 85, 247), 0.15)',
    borderRadius: 'var(--radius-md)',
  },
  stepTipText: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
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

  /* Drop zone (Step 1) */
  dropZone: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: '28px 20px',
    background: 'var(--bg-base)',
    border: '2px dashed var(--border)',
    borderRadius: 'var(--radius-lg)',
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
    textAlign: 'center',
  },
  dropZoneActive: {
    borderColor: 'var(--accent)',
    background: 'rgba(var(--accent-rgb, 168, 85, 247), 0.04)',
  },
  dropZoneText: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  dropZoneTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-secondary)',
  },
  dropZoneSub: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
  },

  /* File list (Step 1) */
  fileList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  fileRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 10px',
    background: 'var(--bg-elevated)',
    borderRadius: 'var(--radius-sm)',
  },
  fileRowInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    flex: 1,
  },
  fileRowName: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  fileRowSize: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
    flexShrink: 0,
  },
  fileRowRemove: {
    background: 'none',
    border: 'none',
    color: 'var(--text-tertiary)',
    cursor: 'pointer',
    padding: 4,
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
    opacity: 0.6,
    transition: 'opacity 0.15s',
  },
  fileListSummary: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
    textAlign: 'right',
    padding: '4px 0',
  },

  /* Link input (Step 1) */
  linkInputRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  addLinkBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 0.15s',
  },

  /* Link list (Step 1) */
  linkList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  linkRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 10px',
    background: 'var(--bg-elevated)',
    borderRadius: 'var(--radius-sm)',
  },
  linkRowInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    flex: 1,
  },
  linkRowUrl: {
    fontSize: 12,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  linkRowLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--accent)',
    background: 'rgba(var(--accent-rgb, 168, 85, 247), 0.1)',
    padding: '2px 6px',
    borderRadius: 8,
    flexShrink: 0,
  },

  /* Suggestion box (Step 2) */
  suggestionBox: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    padding: '8px 10px',
    background: 'rgba(96, 165, 250, 0.06)',
    border: '1px solid rgba(96, 165, 250, 0.15)',
    borderRadius: 'var(--radius-md)',
    marginBottom: 4,
  },
  suggestionLabel: {
    fontSize: 11,
    fontWeight: 500,
    color: 'var(--text-tertiary)',
    marginRight: 4,
  },
  suggestionBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 10px',
    background: 'rgba(96, 165, 250, 0.1)',
    border: '1px solid rgba(96, 165, 250, 0.25)',
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 600,
    color: '#60a5fa',
    cursor: 'pointer',
    transition: 'background 0.15s',
    whiteSpace: 'nowrap' as const,
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  inlineSuggestion: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    padding: '2px 8px',
    background: 'none',
    border: '1px solid rgba(96, 165, 250, 0.2)',
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 500,
    color: '#60a5fa',
    cursor: 'pointer',
    transition: 'background 0.15s',
    whiteSpace: 'nowrap' as const,
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

  /* Section headers (legacy compat) */
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
