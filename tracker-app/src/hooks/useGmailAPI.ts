/**
 * useGmailAPI — React hook for Gmail API integration via Supabase OAuth.
 *
 * Uses `getGoogleAccessToken()` to obtain a valid access token:
 *  1. Fresh `provider_token` from the Supabase session (available right after OAuth)
 *  2. In-memory cached token (valid for ~1h)
 *  3. Persisted refresh token from DB → exchanged for a new access token
 *
 * This ensures Gmail stays connected across Vercel deploys and page reloads.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSupabase } from '../context/SupabaseContext'
import {
  scanForJobEvents,
  GmailAuthError,
  type JobEvent,
} from '../lib/gmail-scanner'
import {
  getGoogleAccessToken,
  loadGoogleRefreshToken,
} from '../lib/google-token'

const SCAN_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes
const LAST_SCAN_KEY = 'tracker_v2_gmail_api_last_scan'
const CACHED_EVENTS_KEY = 'tracker_v2_gmail_api_events'

export interface UseGmailAPIReturn {
  /** Classified job events from the last scan */
  events: JobEvent[]
  /** Whether a scan is currently in progress */
  isScanning: boolean
  /** ISO timestamp of the last successful scan */
  lastScanAt: string | null
  /** Error message from the last scan attempt */
  error: string | null
  /** Whether the user has a valid Gmail token (either fresh or refreshable) */
  isConnected: boolean
  /** The email address associated with the Google account */
  userEmail: string | null
  /** Trigger a manual scan */
  scanNow: () => Promise<void>
  /** Whether a re-auth is needed (token expired AND refresh failed) */
  needsReauth: boolean
}

export interface UseGmailAPIOptions {
  /** Called after a successful scan with new events */
  onNewEvents?: (events: JobEvent[]) => void
  /** Set to false to disable auto-scanning on mount */
  autoScan?: boolean
}

export function useGmailAPI(
  options: UseGmailAPIOptions = {},
): UseGmailAPIReturn {
  const { session, supabase } = useSupabase()
  const [events, setEvents] = useState<JobEvent[]>(() => {
    try {
      const cached = localStorage.getItem(CACHED_EVENTS_KEY)
      return cached ? JSON.parse(cached) : []
    } catch {
      return []
    }
  })
  const [isScanning, setIsScanning] = useState(false)
  const [lastScanAt, setLastScanAt] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_SCAN_KEY)
    } catch {
      return null
    }
  })
  const [error, setError] = useState<string | null>(null)
  const [needsReauth, setNeedsReauth] = useState(false)
  const [hasRefreshToken, setHasRefreshToken] = useState(false)
  const onNewEventsRef = useRef(options.onNewEvents)
  onNewEventsRef.current = options.onNewEvents
  const autoScan = options.autoScan !== false

  // Extract provider_token from session
  const providerToken = session?.provider_token ?? null
  const userId = session?.user?.id ?? null
  const userEmail = session?.user?.email ?? null

  // Gmail is "connected" if we have a live token OR a persisted refresh token
  const isConnected = !!providerToken || hasRefreshToken

  // On mount / user change, check if a refresh token is persisted
  useEffect(() => {
    if (!userId) {
      setHasRefreshToken(false)
      return
    }
    loadGoogleRefreshToken(supabase, userId).then((rt) => {
      setHasRefreshToken(!!rt)
    }).catch(() => {
      setHasRefreshToken(false)
    })
  }, [userId, supabase])

  const scanNow = useCallback(async () => {
    if (!userId) {
      setError('No user session. Please sign in.')
      return
    }

    setIsScanning(true)
    setError(null)
    setNeedsReauth(false)

    try {
      // Get a valid access token (fresh, cached, or refreshed from DB)
      const accessToken = await getGoogleAccessToken(supabase, userId, providerToken)

      if (!accessToken) {
        setNeedsReauth(true)
        setError('No Gmail token available. Please reconnect Gmail.')
        setIsScanning(false)
        return
      }

      const newEvents = await scanForJobEvents(accessToken)
      setEvents(newEvents)
      const now = new Date().toISOString()
      setLastScanAt(now)

      // Cache results
      try {
        localStorage.setItem(LAST_SCAN_KEY, now)
        localStorage.setItem(CACHED_EVENTS_KEY, JSON.stringify(newEvents))
      } catch {
        // localStorage quota exceeded, ignore
      }

      if (newEvents.length > 0 && onNewEventsRef.current) {
        onNewEventsRef.current(newEvents)
      }
    } catch (err) {
      if (err instanceof GmailAuthError) {
        // Access token expired mid-scan. Try once more with a forced refresh.
        try {
          const freshToken = await getGoogleAccessToken(supabase, userId, null)
          if (freshToken) {
            const retryEvents = await scanForJobEvents(freshToken)
            setEvents(retryEvents)
            const now = new Date().toISOString()
            setLastScanAt(now)
            try {
              localStorage.setItem(LAST_SCAN_KEY, now)
              localStorage.setItem(CACHED_EVENTS_KEY, JSON.stringify(retryEvents))
            } catch { /* ignore */ }
            if (retryEvents.length > 0 && onNewEventsRef.current) {
              onNewEventsRef.current(retryEvents)
            }
            return // retry succeeded
          }
        } catch {
          // Retry also failed
        }
        setNeedsReauth(true)
        setHasRefreshToken(false)
        setError('Gmail access expired. Please reconnect Gmail.')
      } else {
        setError(err instanceof Error ? err.message : 'Gmail scan failed')
      }
    } finally {
      setIsScanning(false)
    }
  }, [providerToken, userId, supabase])

  // Auto-scan on mount (with delay) and every 30 minutes
  useEffect(() => {
    if (!userId || !isConnected || !autoScan) return

    // Check if we scanned recently (within the interval)
    const lastScan = localStorage.getItem(LAST_SCAN_KEY)
    const now = Date.now()
    if (lastScan) {
      const elapsed = now - new Date(lastScan).getTime()
      if (elapsed < SCAN_INTERVAL_MS) {
        // Schedule next scan for remaining time
        const remaining = SCAN_INTERVAL_MS - elapsed
        const timer = setTimeout(() => scanNow(), remaining)
        return () => clearTimeout(timer)
      }
    }

    // Initial scan after 3 seconds
    const initialTimer = setTimeout(() => scanNow(), 3000)

    // Recurring scan every 30 minutes
    const interval = setInterval(() => scanNow(), SCAN_INTERVAL_MS)

    return () => {
      clearTimeout(initialTimer)
      clearInterval(interval)
    }
  }, [userId, isConnected, autoScan, scanNow])

  return {
    events,
    isScanning,
    lastScanAt,
    error,
    isConnected,
    userEmail,
    scanNow,
    needsReauth,
  }
}
