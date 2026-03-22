import { useState, useEffect, type FormEvent } from 'react'
import {
  X,
  Mail,
  Lock,
  User,
  ArrowRight,
  Cloud,
  Bot,
  Inbox,
  Download,
  Shield,
  Zap,
  CheckCircle,
} from 'lucide-react'
import { useSupabase } from '../context/SupabaseContext'
import { useAuthWallContext, type AuthWallTrigger } from '../context/AuthWallContext'
import { useJobs } from '../context/JobsContext'
import { validateEmailFormat, getPasswordStrength } from '../utils/email-validation'

/* ------------------------------------------------------------------ */
/*  Trigger content config                                             */
/* ------------------------------------------------------------------ */

interface TriggerContent {
  icon: typeof Mail
  iconColor: string
  title: string
  subtitle: string
  bullets: string[]
}

function getTriggerContent(
  trigger: NonNullable<AuthWallTrigger>,
  jobCount: number
): TriggerContent {
  switch (trigger) {
    case 'sync_gmail':
      return {
        icon: Inbox,
        iconColor: '#60a5fa',
        title: 'Connect Gmail to auto-track applications',
        subtitle:
          "We'll detect rejections, interviews, and confirmations from your inbox",
        bullets: [
          'Auto-detect rejection emails',
          'Track interview invitations',
          'Never miss a status change',
        ],
      }
    case 'start_bot':
      return {
        icon: Bot,
        iconColor: '#34d399',
        title: 'Create an account to start the auto-apply bot',
        subtitle: 'Your search profiles and bot settings will be saved',
        bullets: [
          'AI-powered auto-apply on 4+ ATS platforms',
          'Search profiles saved across sessions',
          'Run history and analytics tracked',
        ],
      }
    case 'save_cloud':
      return {
        icon: Cloud,
        iconColor: '#a78bfa',
        title: 'Sync your data across devices',
        subtitle: `You have ${jobCount} job${jobCount !== 1 ? 's' : ''} saved locally. Create an account to never lose your progress.`,
        bullets: [
          'Backup to the cloud automatically',
          'Access from any device',
          'Encrypted and private',
        ],
      }
    case 'export_data':
      return {
        icon: Download,
        iconColor: '#f59e0b',
        title: 'Create a free account to export your data',
        subtitle: 'Download your job tracking data in JSON format',
        bullets: [
          'Full data export in JSON',
          'Import into spreadsheets',
          'Your data, your way',
        ],
      }
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function AuthWall() {
  const { supabase, session } = useSupabase()
  const { authWall, closeAuthWall, completeAuthWall } = useAuthWallContext()
  const { allJobs } = useJobs()

  const [mode, setMode] = useState<'options' | 'email-signup' | 'email-signin'>('options')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmationSent, setConfirmationSent] = useState(false)

  // Inline validation state
  const [emailTouched, setEmailTouched] = useState(false)
  const [nameTouched, setNameTouched] = useState(false)

  // Inline errors
  const emailError = emailTouched ? validateEmailFormat(email) : ''
  const nameError = nameTouched && !fullName.trim() ? 'Name is required' : ''
  const pwStrength = getPasswordStrength(password)

  // When auth succeeds externally (e.g. Google OAuth redirect), auto-complete
  useEffect(() => {
    if (session && authWall.trigger) {
      completeAuthWall()
    }
  }, [session, authWall.trigger, completeAuthWall])

  // Reset form state when modal opens
  useEffect(() => {
    if (authWall.trigger) {
      setMode('options')
      setEmail('')
      setPassword('')
      setFullName('')
      setError(null)
      setLoading(false)
      setConfirmationSent(false)
      setEmailTouched(false)
      setNameTouched(false)
    }
  }, [authWall.trigger])

  if (!authWall.trigger) return null

  const content = getTriggerContent(authWall.trigger, allJobs.length)
  const Icon = content.icon

  const handleGoogleOAuth = async () => {
    setError(null)
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        scopes: 'https://www.googleapis.com/auth/gmail.readonly',
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
    if (oauthError) setError(oauthError.message)
  }

  const handleEmailSignUp = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setConfirmationSent(false)

    // Trigger inline validation
    setNameTouched(true)
    setEmailTouched(true)

    if (!fullName.trim()) return
    const emailErr = validateEmailFormat(email)
    if (emailErr) return

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Password must contain both letters and numbers')
      return
    }
    setLoading(true)
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      })
      if (signUpError) {
        setError(signUpError.message)
      } else if (data.user && !data.session) {
        // Email confirmation required
        setConfirmationSent(true)
      }
      // If session exists, success is handled by session listener
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleEmailSignIn = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setEmailTouched(true)
    const emailErr = validateEmailFormat(email)
    if (emailErr) return
    setLoading(true)
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (signInError) setError(signInError.message)
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.overlay} onClick={closeAuthWall}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button style={styles.closeBtn} onClick={closeAuthWall} aria-label="Close">
          <X size={18} />
        </button>

        {/* Feature pitch */}
        <div style={styles.pitch}>
          <div
            style={{
              ...styles.iconCircle,
              background: `${content.iconColor}15`,
            }}
          >
            <Icon size={28} color={content.iconColor} />
          </div>
          <h2 style={styles.title}>{content.title}</h2>
          <p style={styles.subtitle}>{content.subtitle}</p>
          <ul style={styles.bullets}>
            {content.bullets.map((b, i) => (
              <li key={i} style={styles.bullet}>
                <Zap size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Error display */}
        {error && <div style={styles.error}>{error}</div>}

        {/* Email confirmation sent */}
        {confirmationSent && (
          <div style={styles.confirmationBox}>
            <Mail size={20} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong style={{ display: 'block', marginBottom: 4 }}>Check your email for a confirmation link</strong>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                We sent a verification email to <strong>{email}</strong>. Click the link inside to activate your account.
              </span>
            </div>
          </div>
        )}

        {/* Auth options */}
        {mode === 'options' && !confirmationSent && (
          <div style={styles.authSection}>
            <button style={styles.googleBtn} onClick={handleGoogleOAuth}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path
                  d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
                  fill="#4285F4"
                />
                <path
                  d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
                  fill="#34A853"
                />
                <path
                  d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
                  fill="#FBBC05"
                />
                <path
                  d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </button>

            <button
              style={styles.emailBtn}
              onClick={() => setMode('email-signup')}
            >
              <Mail size={16} />
              Sign up with email
            </button>

            <button style={styles.switchLink} onClick={() => setMode('email-signin')}>
              Already have an account? <span style={{ color: 'var(--accent)' }}>Sign in</span>
            </button>

            <p style={styles.freeText}>
              <Shield size={12} color="var(--text-tertiary)" />
              Free forever — no credit card required
            </p>
          </div>
        )}

        {/* Email sign-up form */}
        {mode === 'email-signup' && !confirmationSent && (
          <form onSubmit={handleEmailSignUp} style={styles.form}>
            {/* Name */}
            <div style={{ width: '100%' }}>
              <div style={styles.inputGroup}>
                <User size={16} color="var(--text-tertiary)" style={styles.inputIcon} />
                <input
                  type="text"
                  placeholder="Full name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  onBlur={() => setNameTouched(true)}
                  required
                  maxLength={100}
                  autoComplete="name"
                  style={{
                    ...styles.input,
                    ...(nameError ? styles.inputErrorBorder : {}),
                  }}
                />
              </div>
              {nameError && <div style={styles.inlineError}>{nameError}</div>}
            </div>

            {/* Email */}
            <div style={{ width: '100%' }}>
              <div style={styles.inputGroup}>
                <Mail size={16} color="var(--text-tertiary)" style={styles.inputIcon} />
                <input
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setEmailTouched(true)}
                  required
                  maxLength={254}
                  autoComplete="email"
                  style={{
                    ...styles.input,
                    ...(emailError ? styles.inputErrorBorder : {}),
                  }}
                />
              </div>
              {emailError && <div style={styles.inlineError}>{emailError}</div>}
            </div>

            {/* Password */}
            <div style={{ width: '100%' }}>
              <div style={styles.inputGroup}>
                <Lock size={16} color="var(--text-tertiary)" style={styles.inputIcon} />
                <input
                  type="password"
                  placeholder="Password (min 8 characters)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  style={styles.input}
                />
              </div>
              {/* Password strength indicator */}
              {password.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div style={styles.strengthBarBg}>
                    <div style={{
                      height: '100%',
                      borderRadius: 2,
                      background: pwStrength.color,
                      width: `${pwStrength.percent}%`,
                      transition: 'width 200ms ease, background 200ms ease',
                    }} />
                  </div>
                  <span style={{ fontSize: 11, color: pwStrength.color, marginTop: 2, display: 'block' }}>
                    {pwStrength.label}
                  </span>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{ ...styles.primaryBtn, opacity: loading ? 0.6 : 1 }}
            >
              {loading ? 'Creating account...' : 'Create Account'}
              {!loading && <ArrowRight size={16} />}
            </button>
            <button
              type="button"
              style={styles.switchLink}
              onClick={() => setMode('options')}
            >
              Back to options
            </button>
          </form>
        )}

        {/* Email sign-in form */}
        {mode === 'email-signin' && !confirmationSent && (
          <form onSubmit={handleEmailSignIn} style={styles.form}>
            <div style={{ width: '100%' }}>
              <div style={styles.inputGroup}>
                <Mail size={16} color="var(--text-tertiary)" style={styles.inputIcon} />
                <input
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setEmailTouched(true)}
                  required
                  maxLength={254}
                  autoComplete="email"
                  style={{
                    ...styles.input,
                    ...(emailError ? styles.inputErrorBorder : {}),
                  }}
                />
              </div>
              {emailError && <div style={styles.inlineError}>{emailError}</div>}
            </div>
            <div style={styles.inputGroup}>
              <Lock size={16} color="var(--text-tertiary)" style={styles.inputIcon} />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                maxLength={128}
                autoComplete="current-password"
                style={styles.input}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              style={{ ...styles.primaryBtn, opacity: loading ? 0.6 : 1 }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
              {!loading && <ArrowRight size={16} />}
            </button>
            <button
              type="button"
              style={styles.switchLink}
              onClick={() => setMode('email-signup')}
            >
              Don't have an account? <span style={{ color: 'var(--accent)' }}>Sign up</span>
            </button>
            <button
              type="button"
              style={styles.switchLink}
              onClick={() => setMode('options')}
            >
              Back to options
            </button>
          </form>
        )}

        {/* Back to sign-in after confirmation */}
        {confirmationSent && (
          <button
            onClick={() => { setConfirmationSent(false); setMode('email-signin') }}
            style={{
              ...styles.primaryBtn,
              marginTop: 8,
            }}
          >
            <CheckCircle size={16} />
            Back to Sign In
          </button>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    background: 'rgba(0, 0, 0, 0.7)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modal: {
    position: 'relative',
    width: '100%',
    maxWidth: 440,
    maxHeight: '90vh',
    overflowY: 'auto',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    padding: '32px 28px 28px',
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: 8,
    background: 'transparent',
    border: 'none',
    color: 'var(--text-tertiary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'color 150ms ease',
  },

  /* Pitch section */
  pitch: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: 10,
    marginBottom: 24,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: 'var(--text-primary)',
    lineHeight: 1.3,
  },
  subtitle: {
    fontSize: 14,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
    maxWidth: 340,
  },
  bullets: {
    listStyle: 'none',
    padding: 0,
    margin: '8px 0 0',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    width: '100%',
    maxWidth: 300,
  },
  bullet: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    color: 'var(--text-secondary)',
    textAlign: 'left',
  },

  /* Error */
  error: {
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 13,
    color: '#f87171',
    marginBottom: 16,
  },

  /* Confirmation box */
  confirmationBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    background: 'rgba(52, 211, 153, 0.08)',
    border: '1px solid rgba(52, 211, 153, 0.25)',
    borderRadius: 8,
    padding: '14px 16px',
    fontSize: 13,
    color: 'var(--text-primary)',
    marginBottom: 16,
    lineHeight: 1.4,
  },

  /* Auth section */
  authSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    alignItems: 'center',
  },
  googleBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    padding: '11px 16px',
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--text-primary)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    cursor: 'pointer',
    transition: 'border-color 150ms ease',
  },
  emailBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    padding: '11px 16px',
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 10,
    cursor: 'pointer',
    transition: 'border-color 150ms ease',
  },
  switchLink: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
    background: 'none',
    border: 'none',
    padding: '4px 0',
    cursor: 'pointer',
    transition: 'color 150ms ease',
  },
  freeText: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    color: 'var(--text-tertiary)',
    marginTop: 4,
  },

  /* Form */
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    alignItems: 'center',
    width: '100%',
  },
  inputGroup: {
    position: 'relative',
    width: '100%',
  },
  inputIcon: {
    position: 'absolute',
    left: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    pointerEvents: 'none' as const,
  },
  input: {
    width: '100%',
    padding: '10px 12px 10px 38px',
    fontSize: 14,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text-primary)',
    outline: 'none',
    transition: 'border-color 150ms ease',
  },
  inputErrorBorder: {
    borderColor: '#ef4444',
    boxShadow: '0 0 0 2px rgba(239, 68, 68, 0.15)',
  },
  inlineError: {
    fontSize: 12,
    color: '#ef4444',
    marginTop: 4,
    paddingLeft: 2,
  },
  strengthBarBg: {
    width: '100%',
    height: 4,
    borderRadius: 2,
    background: 'var(--bg-elevated)',
    overflow: 'hidden' as const,
  },
  primaryBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    padding: '11px 16px',
    fontSize: 14,
    fontWeight: 600,
    color: '#000',
    background: 'var(--accent)',
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
    transition: 'opacity 150ms ease',
  },
}
