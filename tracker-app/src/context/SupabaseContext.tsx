import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { SupabaseClient, Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
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

  // Check Supabase reachability
  const checkConnection = useCallback(async () => {
    try {
      // A lightweight query to verify the connection is alive
      const { error } = await supabase.from('profiles').select('id', { count: 'exact', head: true })
      // Even a permission error means Supabase is reachable
      setIsOnline(!error || error.code !== 'NETWORK_ERROR')
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

  // Listen for auth state changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession)
        setAuthLoading(false)
      }
    )

    // Get initial session
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      setSession(initialSession)
      setAuthLoading(false)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const signOut = useCallback(async () => {
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
