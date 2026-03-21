import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Application } from '../types/database'
import type { RealtimeChannel } from '@supabase/supabase-js'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface UseApplicationSyncReturn {
  /** Applications created or updated since the component mounted */
  newApplications: Application[]
  /** ISO timestamp of the last realtime event received, or null */
  lastSyncAt: string | null
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */
export function useApplicationSync(): UseApplicationSyncReturn {
  const [newApplications, setNewApplications] = useState<Application[]>([])
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    let mounted = true

    const channel = supabase
      .channel('applications-sync')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'applications',
        },
        (payload) => {
          if (!mounted) return
          const app = payload.new as Application
          setNewApplications((prev) => [app, ...prev])
          setLastSyncAt(new Date().toISOString())
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'applications',
        },
        (payload) => {
          if (!mounted) return
          const updated = payload.new as Application
          setNewApplications((prev) => {
            const idx = prev.findIndex((a) => a.id === updated.id)
            if (idx >= 0) {
              const next = [...prev]
              next[idx] = updated
              return next
            }
            return [updated, ...prev]
          })
          setLastSyncAt(new Date().toISOString())
        },
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      mounted = false
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [])

  return { newApplications, lastSyncAt }
}
