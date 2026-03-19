import { useState, useCallback, useMemo } from 'react'
import type { JobEvent } from '../types/job'

const STORAGE_KEY = 'tracker_v2_events'

type EventStore = Record<string, JobEvent[]>

function loadStore(): EventStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function persistStore(store: EventStore) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function useJobEvents(jobId: string | null) {
  const [store, setStore] = useState<EventStore>(loadStore)

  const events = useMemo(() => {
    if (!jobId) return []
    const list = store[jobId] ?? []
    return [...list].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )
  }, [store, jobId])

  const addEvent = useCallback(
    (id: string, event: JobEvent) => {
      setStore((prev) => {
        const existing = prev[id] ?? []
        const next = { ...prev, [id]: [...existing, event] }
        persistStore(next)
        return next
      })
    },
    []
  )

  const deleteEvent = useCallback(
    (id: string, eventId: string) => {
      setStore((prev) => {
        const existing = prev[id] ?? []
        const next = {
          ...prev,
          [id]: existing.filter((e) => e.id !== eventId),
        }
        persistStore(next)
        return next
      })
    },
    []
  )

  const getEvents = useCallback(
    (id: string): JobEvent[] => {
      const list = store[id] ?? []
      return [...list].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      )
    },
    [store]
  )

  return { events, addEvent, deleteEvent, getEvents }
}
