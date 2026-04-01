import { useState, useEffect } from 'react'
import { Chrome, X, ExternalLink, Zap } from 'lucide-react'

/**
 * Banner shown when the Chrome extension is not detected.
 * Listens for JOBTRACKER_EXTENSION_INSTALLED postMessage from the content script.
 * Dismissable — persists dismissal for 7 days in localStorage.
 */

const DISMISS_KEY = 'jobtracker_ext_banner_dismissed'
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// Will be updated once the extension is published on CWS
const CWS_URL = 'https://chromewebstore.google.com/detail/jobtracker-auto-apply/PLACEHOLDER_ID'
const IS_CWS_LIVE = false // flip to true once published

export function ExtensionBanner() {
  const [extensionDetected, setExtensionDetected] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    // Check if user dismissed recently
    const dismissedAt = localStorage.getItem(DISMISS_KEY)
    if (dismissedAt && Date.now() - Number(dismissedAt) < DISMISS_DURATION_MS) {
      setDismissed(true)
      setChecking(false)
      return
    }

    // Check localStorage fallback (extension syncs cookie here)
    if (localStorage.getItem('tracker_v2_linkedin_cookie')) {
      setExtensionDetected(true)
      setChecking(false)
      return
    }

    // Listen for extension postMessage
    const handler = (event: MessageEvent) => {
      if (event.source === window && event.data?.type === 'JOBTRACKER_EXTENSION_INSTALLED') {
        setExtensionDetected(true)
      }
    }
    window.addEventListener('message', handler)

    // Give extension 3s to announce itself
    const timer = setTimeout(() => setChecking(false), 3000)

    return () => {
      window.removeEventListener('message', handler)
      clearTimeout(timer)
    }
  }, [])

  // Don't show if extension detected, dismissed, or still checking
  if (extensionDetected || dismissed || checking) return null

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
    setDismissed(true)
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px 16px',
      background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(139, 92, 246, 0.08))',
      border: '1px solid rgba(99, 102, 241, 0.25)',
      borderRadius: '10px',
      marginBottom: '16px',
      position: 'relative',
    }}>
      {/* Icon */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 40,
        height: 40,
        borderRadius: 10,
        background: 'rgba(99, 102, 241, 0.15)',
        flexShrink: 0,
      }}>
        <Chrome size={20} color="#818cf8" />
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#e2e8f0' }}>
            Chrome Extension Required
          </span>
          <Zap size={14} color="#fbbf24" fill="#fbbf24" />
        </div>
        <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0, lineHeight: 1.4 }}>
          Install the extension to enable LinkedIn Easy Apply and auto-fill ATS forms directly from your browser.
        </p>
      </div>

      {/* CTA */}
      {IS_CWS_LIVE ? (
        <a
          href={CWS_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            background: '#6366f1',
            color: '#fff',
            borderRadius: 8,
            fontSize: '0.8rem',
            fontWeight: 600,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            border: 'none',
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#5457e5')}
          onMouseLeave={e => (e.currentTarget.style.background = '#6366f1')}
        >
          Add to Chrome
          <ExternalLink size={14} />
        </a>
      ) : (
        <a
          href="https://github.com/peterbono/portfolio/tree/main/tracker-app/chrome-extension"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            background: '#6366f1',
            color: '#fff',
            borderRadius: 8,
            fontSize: '0.8rem',
            fontWeight: 600,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            border: 'none',
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#5457e5')}
          onMouseLeave={e => (e.currentTarget.style.background = '#6366f1')}
        >
          Install Extension
          <ExternalLink size={14} />
        </a>
      )}

      {/* Dismiss X */}
      <button
        onClick={handleDismiss}
        aria-label="Dismiss"
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: '#64748b',
          padding: 4,
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
        onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}
      >
        <X size={14} />
      </button>
    </div>
  )
}
