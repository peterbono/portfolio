/**
 * useGmailAPI — React hook for Gmail API integration via Supabase OAuth.
 *
 * Reads the `provider_token` (Google access token) from the Supabase session,
 * scans for job-related emails on mount and every 30 minutes,
 * and returns classified events.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSupabase } from '../context/SupabaseContext'
import {
  scanForJobEvents,
  GmailAuthError,
  type JobEvent,
} from '../lib/gmail-scanner'

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
  /** Whether the user has a valid Gmail token */
  isConnected: boolean
  /** The email address associated with the Google account */
  userEmail: string | null
  /** Trigger a manual scan */
  scanNow: () => Promise<void>
  /** Whether a re-auth is needed (token expired) */
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
  const onNewEventsRef = useRef(options.onNewEvents)
  onNewEventsRef.current = options.onNewEvents
  const autoScan = options.autoScan !== false

  // Extract provider_token from session
  const providerToken = session?.provider_token ?? null
  const providerRefreshToken = session?.provider_refresh_token ?? null
  const userEmail = session?.user?.email ?? null
  const isConnected = !!providerToken

  const scanNow = useCallback(async () => {
    if (!providerToken) {
      setError('No Gmail token available. Please sign in with Google.')
      return
    }

    setIsScanning(true)
    setError(null)
    setNeedsReauth(false)

    try {
      const newEvents = await scanForJobEvents(providerToken)
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
        setNeedsReauth(true)
        setError('Gmail access expired. Please sign in again to reconnect.')
        // Attempt to refresh session (Supabase may have refresh token)
        if (providerRefreshToken) {
          try {
            await supabase.auth.refreshSession()
          } catch {
            // Refresh failed, user must re-auth
          }
        }
      } else {
        setError(err instanceof Error ? err.message : 'Gmail scan failed')
      }
    } finally {
      setIsScanning(false)
    }
  }, [providerToken, providerRefreshToken, supabase.auth])

  // Auto-scan on mount (with delay) and every 30 minutes
  useEffect(() => {
    if (!providerToken || !autoScan) return

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
  }, [providerToken, autoScan, scanNow])

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
