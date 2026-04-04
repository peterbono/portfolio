import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import type { SupabaseClient, Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { saveGoogleRefreshToken, clearTokenCache } from '../lib/google-token'
import type { Database } from '../types/database'

type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error'

interface SupabaseContextValue {
  supabase: SupabaseClient<Database>
  session: Session | null
  user: User | null
  authLoading: boolean
  isOnline: boolean
  syncStatus: SyncStatus
  setSyncStatus: (status: SyncStatus) => void
  signOut: () => Promise<void>
}

const SupabaseContext = createContext<SupabaseContextValue | undefined>(undefined)

export function SupabaseProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [isOnline, setIsOnline] = useState(true)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')

  // Check Supabase reachability (with 5s timeout to avoid hanging when throttled)
  const checkConnection = useCallback(async () => {
    try {
      const result = await Promise.race([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        new Promise<{ error: { code: string } }>((resolve) =>
          setTimeout(() => resolve({ error: { code: 'TIMEOUT' } }), 5_000)
        ),
      ])
      const error = (result as any).error
      setIsOnline(!error || (error.code !== 'NETWORK_ERROR' && error.code !== 'TIMEOUT'))
    } catch {
      setIsOnline(false)
    }
  }, [])

  useEffect(() => {
    // Initial connection check
    checkConnection()

    // Re-check when browser connectivity changes
    const handleOnline = () => {
      setIsOnline(true)
      checkConnection()
    }
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [checkConnection])

  // Track whether we've already persisted the refresh token this session
  const refreshTokenSavedRef = useRef(false)

  // Listen for auth state changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession)
        setAuthLoading(false)

        // Persist Google refresh token when it arrives from OAuth callback.
        // Supabase only provides provider_refresh_token on the initial
        // SIGNED_IN event after an OAuth redirect, not on subsequent
        // session restores. Save it to DB so we can use it after deploys.
        if (
          newSession?.provider_refresh_token &&
          newSession.user?.id &&
          !refreshTokenSavedRef.current
        ) {
          refreshTokenSavedRef.current = true
          saveGoogleRefreshToken(
            supabase,
            newSession.user.id,
            newSession.provider_refresh_token,
          ).catch(() => {
            // Non-critical — will retry on next OAuth
            refreshTokenSavedRef.current = false
          })
        }
      }
    )

    // Get initial session — with timeout fallback so the app doesn't hang
    // when Supabase is throttled/down (e.g. egress quota exceeded → 522)
    let resolved = false
    const timeout = setTimeout(() => {
      if (!resolved) {
        console.warn('[auth] Supabase auth timed out after 5s — rendering without session')
        setAuthLoading(false)
      }
    }, 5_000)

    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      resolved = true
      clearTimeout(timeout)
      setSession(initialSession)
      setAuthLoading(false)
    }).catch(() => {
      resolved = true
      clearTimeout(timeout)
      console.warn('[auth] Supabase auth.getSession() failed — rendering without session')
      setAuthLoading(false)
    })

    return () => {
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  const signOut = useCallback(async () => {
    clearTokenCache()
    refreshTokenSavedRef.current = false
    await supabase.auth.signOut()
  }, [])

  return (
    <SupabaseContext.Provider
      value={{
        supabase,
        session,
        user: session?.user ?? null,
        authLoading,
        isOnline,
        syncStatus,
        setSyncStatus,
        signOut,
      }}
    >
      {children}
    </SupabaseContext.Provider>
  )
}

export function useSupabase() {
  const context = useContext(SupabaseContext)
  if (context === undefined) {
    throw new Error('useSupabase must be used within a SupabaseProvider')
  }
  return context
}
