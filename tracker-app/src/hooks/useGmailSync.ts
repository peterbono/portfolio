import { useState, useEffect, useCallback, useRef } from 'react'

const STORAGE_KEY = 'tracker_v2_gmail_url'
const DEFAULT_URL = ''

export interface GmailRejection {
  company: string
  date: string
  role: string
}

export interface GmailEvent {
  company: string
  type: string  // screening, interview, challenge, portfolio_review, offer, withdrawn
  date: string
  subject: string
  role: string
  meetLink: string
  person: string
  source: string // gmail, gmail_sent, calendar
}

interface GmailSyncResponse {
  rejections: GmailRejection[]
  applications?: { company: string; role: string; date: string }[]
  events?: GmailEvent[]
  lastScan: string
}

interface UseGmailSyncOptions {
  onNewRejections?: (companies: string[], rejections: GmailRejection[]) => void
  onNewEvents?: (events: GmailEvent[]) => void
}

interface UseGmailSyncReturn {
  lastSync: string | null
  rejections: GmailRejection[]
  events: GmailEvent[]
  isLoading: boolean
  error: string | null
  syncNow: () => void
}

function getGmailUrl(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_URL
  } catch {
    return DEFAULT_URL
  }
}

export function useGmailSync(options: UseGmailSyncOptions = {}): UseGmailSyncReturn {
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [rejections, setRejections] = useState<GmailRejection[]>([])
  const [events, setEvents] = useState<GmailEvent[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onNewRejectionsRef = useRef(options.onNewRejections)
  const onNewEventsRef = useRef(options.onNewEvents)
  onNewRejectionsRef.current = options.onNewRejections
  onNewEventsRef.current = options.onNewEvents

  const doSync = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const url = getGmailUrl()
      if (!url) {
        setError('No Apps Script URL configured. Add it in Settings.')
        setIsLoading(false)
        return
      }
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: GmailSyncResponse = await res.json()
      setRejections(data.rejections ?? [])
      setEvents(data.events ?? [])
      setLastSync(data.lastScan ?? new Date().toISOString())
      if (data.rejections?.length && onNewRejectionsRef.current) {
        onNewRejectionsRef.current(data.rejections.map((r) => r.company), data.rejections)
      }
      if (data.events?.length && onNewEventsRef.current) {
        onNewEventsRef.current(data.events)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const syncNow = useCallback(() => {
    doSync()
  }, [doSync])

  useEffect(() => {
    const timer = setTimeout(() => {
      doSync()
    }, 2000)
    return () => clearTimeout(timer)
  }, [doSync])

  return { lastSync, rejections, events, isLoading, error, syncNow }
}
