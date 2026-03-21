import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { SupabaseClient, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'

type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error'

interface SupabaseContextValue {
  supabase: SupabaseClient<Database>
  session: Session | null
  isOnline: boolean
  syncStatus: SyncStatus
  setSyncStatus: (status: SyncStatus) => void
}

const SupabaseContext = createContext<SupabaseContextValue | undefined>(undefined)

export function SupabaseProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
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

  // Listen for auth state changes (for future auth integration)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession)
      }
    )

    // Get initial session
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      setSession(initialSession)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  return (
    <SupabaseContext.Provider
      value={{
        supabase,
        session,
        isOnline,
        syncStatus,
        setSyncStatus,
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
