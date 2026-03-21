import { useState, type FormEvent } from 'react'
import { Bot, Mail, Lock, User, ArrowRight, ArrowLeft } from 'lucide-react'
import { useSupabase } from '../context/SupabaseContext'

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

  const handleSignIn = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
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
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
        },
      })
      if (signUpError) setError(signUpError.message)
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

        {/* Sign In Form */}
        {activeTab === 'signin' && (
          <form onSubmit={handleSignIn} style={styles.form}>
            <div style={styles.inputGroup}>
              <Mail size={16} color="var(--text-tertiary)" style={styles.inputIcon} />
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={254}
                autoComplete="email"
                style={styles.input}
              />
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
        {activeTab === 'signup' && (
          <form onSubmit={handleSignUp} style={styles.form}>
            <div style={styles.inputGroup}>
              <User size={16} color="var(--text-tertiary)" style={styles.inputIcon} />
              <input
                type="text"
                placeholder="Full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                maxLength={100}
                autoComplete="name"
                style={styles.input}
              />
            </div>
            <div style={styles.inputGroup}>
              <Mail size={16} color="var(--text-tertiary)" style={styles.inputIcon} />
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={254}
                autoComplete="email"
                style={styles.input}
              />
            </div>
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
