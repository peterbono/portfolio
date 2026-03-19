import { useState, useEffect, useCallback, useRef } from 'react'

const STORAGE_KEY = 'tracker_v2_gmail_url'
const DEFAULT_URL =
  'https://script.google.com/macros/s/AKfycbyRcWe4dYYniDGQBK5omu_k6dBWyxZxD1KwNOlGB3yfzqzGf1uvlbz3JRcteulNwvt0Bw/exec'

export interface GmailRejection {
  company: string
  date: string
  role: string
}

interface GmailSyncResponse {
  rejections: GmailRejection[]
  lastScan: string
}

interface UseGmailSyncOptions {
  onNewRejections?: (companies: string[]) => void
}

interface UseGmailSyncReturn {
  lastSync: string | null
  rejections: GmailRejection[]
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
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onNewRejectionsRef = useRef(options.onNewRejections)
  onNewRejectionsRef.current = options.onNewRejections

  const doSync = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const url = getGmailUrl()
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: GmailSyncResponse = await res.json()
      setRejections(data.rejections ?? [])
      setLastSync(data.lastScan ?? new Date().toISOString())
      if (data.rejections?.length && onNewRejectionsRef.current) {
        onNewRejectionsRef.current(data.rejections.map((r) => r.company))
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

  return { lastSync, rejections, isLoading, error, syncNow }
}
