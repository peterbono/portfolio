import { useGmailSync } from '../hooks/useGmailSync'
import { useJobs } from '../context/JobsContext'

export function GmailSyncBridge() {
  const { markRejected } = useJobs()

  useGmailSync({
    onNewRejections: (companies) => {
      markRejected(companies)
    },
  })

  return null
}
