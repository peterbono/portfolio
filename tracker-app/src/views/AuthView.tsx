import { useState, type FormEvent } from 'react'
import { Bot, Mail, Lock, User, ArrowRight, ArrowLeft, CheckCircle } from 'lucide-react'
import { useSupabase } from '../context/SupabaseContext'
import { validateEmailFormat, getPasswordStrength } from '../utils/email-validation'

type AuthTab = 'signin' | 'signup'

interface AuthViewProps {
  onBack?: () => void
}

export function AuthView({ onBack }: AuthViewProps = {}) {
  const { supabase } = useSupabase()
  const [activeTab, setActiveTab] = useState<AuthTab>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [confirmationSent, setConfirmationSent] = useState(false)

  // Inline validation state
  const [emailTouched, setEmailTouched] = useState(false)
  const [nameTouched, setNameTouched] = useState(false)

  // Inline errors
  const emailError = emailTouched ? validateEmailFormat(email) : ''
  const nameError = nameTouched && !fullName.trim() ? 'Name is required' : ''
  const pwStrength = getPasswordStrength(password)

  const handleSignIn = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    // Validate email inline
    const emailErr = validateEmailFormat(email)
    if (emailErr) {
      setEmailTouched(true)
      return
    }
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

  const handleSignUp = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setConfirmationSent(false)

    // Inline validation triggers
    setNameTouched(true)
    setEmailTouched(true)

    if (!fullName.trim()) return
    const emailErr = validateEmailFormat(email)
    if (emailErr) return

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password.length > 128) {
      setError('Password must be 128 characters or fewer')
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
        options: {
          data: { full_name: fullName },
        },
      })
      if (signUpError) {
        setError(signUpError.message)
      } else if (data.user && !data.session) {
        // Email confirmation required
        setConfirmationSent(true)
      }
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

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

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Enter your email address first')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (resetError) {
        setError(resetError.message)
      } else {
        setResetSent(true)
      }
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  const switchTab = (tab: AuthTab) => {
    setActiveTab(tab)
    setError(null)
    setResetSent(false)
    setConfirmationSent(false)
    setEmailTouched(false)
    setNameTouched(false)
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.card}>
        {/* Back button */}
        {onBack && (
          <button
            onClick={onBack}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'none', border: 'none', color: 'var(--text-secondary)',
              cursor: 'pointer', fontSize: 13, padding: '0 0 12px',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
          >
            <ArrowLeft size={14} /> Back
          </button>
        )}
        {/* Logo / Header */}
        <div style={styles.header}>
          <div style={styles.logoRow}>
            <div style={styles.logoCircle}>
              <Bot size={24} color="var(--accent)" />
            </div>
            <span style={styles.logoText}>Job Tracker</span>
          </div>
          <p style={styles.tagline}>Apply smarter, not harder</p>
        </div>

        {/* Tabs */}
        <div style={styles.tabs}>
          <button
            onClick={() => switchTab('signin')}
            style={{
              ...styles.tab,
              ...(activeTab === 'signin' ? styles.tabActive : {}),
            }}
          >
            Sign In
          </button>
          <button
            onClick={() => switchTab('signup')}
            style={{
              ...styles.tab,
              ...(activeTab === 'signup' ? styles.tabActive : {}),
            }}
          >
            Sign Up
          </button>
        </div>

        {/* Error display */}
        {error && <div style={styles.error}>{error}</div>}

        {/* Reset success */}
        {resetSent && (
          <div style={styles.success}>
            Password reset email sent. Check your inbox.
          </div>
        )}

        {/* Email confirmation sent */}
        {confirmationSent && (
          <div style={styles.confirmationBox}>
            <Mail size={20} color="var(--accent)" />
            <div>
              <strong style={{ display: 'block', marginBottom: 4 }}>Check your email for a confirmation link</strong>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                We sent a verification email to <strong>{email}</strong>. Click the link inside to activate your account.
              </span>
            </div>
          </div>
        )}

        {/* Sign In Form */}
        {activeTab === 'signin' && !confirmationSent && (
          <form onSubmit={handleSignIn} style={styles.form}>
            <div>
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
              type="button"
              onClick={handleForgotPassword}
              style={styles.forgotLink}
            >
              Forgot password?
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                ...styles.primaryBtn,
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
              {!loading && <ArrowRight size={16} />}
            </button>
          </form>
        )}

        {/* Sign Up Form */}
        {activeTab === 'signup' && !confirmationSent && (
          <form onSubmit={handleSignUp} style={styles.form}>
            {/* Name */}
            <div>
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
            <div>
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
            <div>
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
              style={{
                ...styles.primaryBtn,
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Creating account...' : 'Create Account'}
              {!loading && <ArrowRight size={16} />}
            </button>
            <p style={styles.terms}>
              By signing up, you agree to our Terms of Service
            </p>
          </form>
        )}

        {/* Divider */}
        {!confirmationSent && (
          <>
            <div style={styles.divider}>
              <span style={styles.dividerLine} />
              <span style={styles.dividerText}>or</span>
              <span style={styles.dividerLine} />
            </div>

            {/* Google OAuth */}
            <button onClick={handleGoogleOAuth} style={styles.googleBtn}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>
          </>
        )}

        {/* Back to sign-in after confirmation */}
        {confirmationSent && (
          <button
            onClick={() => { setConfirmationSent(false); switchTab('signin') }}
            style={{
              ...styles.primaryBtn,
              marginTop: 16,
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

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-base)',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-xl)',
    padding: 32,
  },
  header: {
    textAlign: 'center' as const,
    marginBottom: 28,
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 8,
  },
  logoCircle: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    background: 'rgba(52, 211, 153, 0.12)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 20,
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  tagline: {
    fontSize: 14,
    color: 'var(--text-tertiary)',
    marginTop: 4,
  },
  tabs: {
    display: 'flex',
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg-elevated)',
    padding: 3,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    padding: '8px 0',
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    borderRadius: 'var(--radius-sm)',
    transition: 'all 150ms ease',
    textAlign: 'center' as const,
  },
  tabActive: {
    background: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
  },
  error: {
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: 'var(--radius-md)',
    padding: '10px 12px',
    fontSize: 13,
    color: '#f87171',
    marginBottom: 16,
  },
  success: {
    background: 'rgba(52, 211, 153, 0.1)',
    border: '1px solid rgba(52, 211, 153, 0.3)',
    borderRadius: 'var(--radius-md)',
    padding: '10px 12px',
    fontSize: 13,
    color: 'var(--accent)',
    marginBottom: 16,
  },
  confirmationBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    background: 'rgba(52, 211, 153, 0.08)',
    border: '1px solid rgba(52, 211, 153, 0.25)',
    borderRadius: 'var(--radius-md)',
    padding: '14px 16px',
    fontSize: 13,
    color: 'var(--text-primary)',
    marginBottom: 16,
    lineHeight: 1.4,
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  inputGroup: {
    position: 'relative' as const,
  },
  inputIcon: {
    position: 'absolute' as const,
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
    borderRadius: 'var(--radius-md)',
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
  forgotLink: {
    alignSelf: 'flex-end',
    fontSize: 12,
    color: 'var(--text-tertiary)',
    padding: 0,
    marginTop: -4,
    transition: 'color 150ms ease',
  },
  primaryBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 600,
    color: '#000',
    background: 'var(--accent)',
    borderRadius: 'var(--radius-md)',
    transition: 'opacity 150ms ease',
    marginTop: 4,
  },
  terms: {
    fontSize: 11,
    color: 'var(--text-tertiary)',
    textAlign: 'center' as const,
    marginTop: 4,
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    margin: '20px 0',
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: 'var(--border)',
  },
  dividerText: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
  },
  googleBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    padding: '10px 16px',
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--text-primary)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    transition: 'border-color 150ms ease, background 150ms ease',
  },
}
