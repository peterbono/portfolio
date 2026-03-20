import { useState, useCallback, useRef } from 'react'
import { useJobs } from '../context/JobsContext'
import { useGmailSync } from '../hooks/useGmailSync'
import { STATUS_CONFIG, type JobStatus, type Job } from '../types/job'

const GMAIL_URL_KEY = 'tracker_v2_gmail_url'
const DEFAULT_GMAIL_URL = ''

export function SettingsView() {
  const { jobs, counts, addJob } = useJobs()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [gmailUrl, setGmailUrl] = useState(() => {
    try {
      return localStorage.getItem(GMAIL_URL_KEY) || DEFAULT_GMAIL_URL
    } catch {
      return DEFAULT_GMAIL_URL
    }
  })
  const [urlSaved, setUrlSaved] = useState(false)
  const [importStatus, setImportStatus] = useState<string | null>(null)

  const [apiKey, setApiKey] = useState(() => {
    try { return localStorage.getItem('tracker_anthropic_key') || '' }
    catch { return '' }
  })
  const [apiKeySaved, setApiKeySaved] = useState(false)

  const handleSaveApiKey = useCallback(() => {
    try {
      if (apiKey) localStorage.setItem('tracker_anthropic_key', apiKey)
      else localStorage.removeItem('tracker_anthropic_key')
      setApiKeySaved(true)
      setTimeout(() => setApiKeySaved(false), 2000)
    } catch { /* ignore */ }
  }, [apiKey])

  const { lastSync, rejections, isLoading, error, syncNow } = useGmailSync()

  const handleSaveUrl = useCallback(() => {
    try {
      localStorage.setItem(GMAIL_URL_KEY, gmailUrl)
      setUrlSaved(true)
      setTimeout(() => setUrlSaved(false), 2000)
    } catch {
      // ignore
    }
  }, [gmailUrl])

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(jobs, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `job-tracker-export-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [jobs])

  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string) as Job[]
          if (!Array.isArray(data)) throw new Error('Expected an array')
          let imported = 0
          for (const job of data) {
            if (job.id && job.company && job.role) {
              addJob(job)
              imported++
            }
          }
          setImportStatus(`Imported ${imported} jobs successfully`)
          setTimeout(() => setImportStatus(null), 3000)
        } catch (err) {
          setImportStatus(`Import failed: ${err instanceof Error ? err.message : 'Invalid JSON'}`)
          setTimeout(() => setImportStatus(null), 4000)
        }
      }
      reader.readAsText(file)
      // Reset input so same file can be re-imported
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [addJob]
  )

  const statusEntries = (Object.entries(counts) as [JobStatus, number][])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Settings</h1>
        <p style={styles.subtitle}>Manage sync, data, and preferences</p>
      </div>

      {/* Gmail Sync */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Gmail Sync</h2>
        <div style={styles.fieldGroup}>
          <label style={styles.label}>Sync URL</label>
          <div style={styles.inputRow}>
            <input
              style={styles.input}
              type="url"
              value={gmailUrl}
              onChange={(e) => setGmailUrl(e.target.value)}
              placeholder="Google Apps Script URL"
            />
            <button style={styles.btnPrimary} onClick={handleSaveUrl}>
              {urlSaved ? 'Saved!' : 'Save'}
            </button>
          </div>
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.label}>Last Sync</label>
          <span style={styles.value}>
            {lastSync ? new Date(lastSync).toLocaleString() : 'Never'}
          </span>
        </div>

        <div style={styles.fieldGroup}>
          <button
            style={{ ...styles.btnPrimary, opacity: isLoading ? 0.6 : 1 }}
            onClick={syncNow}
            disabled={isLoading}
          >
            {isLoading ? 'Syncing...' : 'Sync Now'}
          </button>
          {error && <span style={styles.errorText}>{error}</span>}
        </div>

        {rejections.length > 0 && (
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Recent Rejections ({rejections.length})</label>
            <div style={styles.rejectionList}>
              {rejections.slice(0, 10).map((r, i) => (
                <div key={i} style={styles.rejectionItem}>
                  <span style={styles.rejectionCompany}>{r.company}</span>
                  <span style={styles.rejectionRole}>{r.role}</span>
                  <span style={styles.rejectionDate}>{r.date}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* AI Coach */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>AI Coach</h2>
        <div style={styles.fieldGroup}>
          <label style={styles.label}>Anthropic API Key</label>
          <p style={styles.hint}>Required for AI-powered coaching. Uses Claude Sonnet (~$0.03/briefing).</p>
          <div style={styles.inputRow}>
            <input
              style={styles.input}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-api03-..."
            />
            <button style={styles.btnPrimary} onClick={handleSaveApiKey}>
              {apiKeySaved ? 'Saved!' : 'Save'}
            </button>
          </div>
        </div>
      </section>

      {/* Data Management */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Data Management</h2>

        <div style={styles.fieldGroup}>
          <label style={styles.label}>Export</label>
          <p style={styles.hint}>Download all {jobs.length} jobs as a JSON file</p>
          <button style={styles.btnSecondary} onClick={handleExport}>
            Download JSON
          </button>
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.label}>Import</label>
          <p style={styles.hint}>Upload a JSON file to merge jobs into the tracker</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            style={styles.fileInput}
          />
          {importStatus && (
            <span style={importStatus.startsWith('Import failed') ? styles.errorText : styles.successText}>
              {importStatus}
            </span>
          )}
        </div>
      </section>

      {/* Stats Summary */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Stats Summary</h2>
        <div style={styles.fieldGroup}>
          <div style={styles.totalRow}>
            <span style={styles.label}>Total Jobs</span>
            <span style={styles.totalValue}>{jobs.length}</span>
          </div>
        </div>
        <div style={styles.statusBreakdown}>
          {statusEntries.map(([status, count]) => (
            <div key={status} style={styles.statusRow}>
              <div style={styles.statusLeft}>
                <span
                  style={{
                    ...styles.statusDot,
                    background: STATUS_CONFIG[status].color,
                  }}
                />
                <span style={styles.statusLabel}>{STATUS_CONFIG[status].label}</span>
              </div>
              <span style={styles.statusCount}>{count}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */
const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    overflow: 'auto',
    padding: 24,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--text-primary)',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: 'var(--text-tertiary)',
  },
  section: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: 20,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: 16,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
  fieldGroup: {
    marginBottom: 16,
  },
  label: {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-tertiary)',
    marginBottom: 6,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
  },
  hint: {
    fontSize: 12,
    color: 'var(--text-tertiary)',
    marginBottom: 8,
  },
  value: {
    fontSize: 13,
    color: 'var(--text-primary)',
  },
  inputRow: {
    display: 'flex',
    gap: 8,
  },
  input: {
    flex: 1,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: '8px 12px',
    color: 'var(--text-primary)',
    fontSize: 13,
    outline: 'none',
  },
  fileInput: {
    fontSize: 13,
    color: 'var(--text-secondary)',
  },
  btnPrimary: {
    background: 'var(--accent)',
    color: '#09090b',
    fontWeight: 600,
    fontSize: 13,
    padding: '8px 16px',
    borderRadius: 'var(--radius-md)',
    border: 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  btnSecondary: {
    background: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    fontWeight: 500,
    fontSize: 13,
    padding: '8px 16px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)',
    cursor: 'pointer',
  },
  errorText: {
    display: 'block',
    fontSize: 12,
    color: '#f43f5e',
    marginTop: 6,
  },
  successText: {
    display: 'block',
    fontSize: 12,
    color: '#34d399',
    marginTop: 6,
  },
  totalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalValue: {
    fontSize: 24,
    fontWeight: 700,
    color: 'var(--accent)',
  },
  statusBreakdown: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  statusRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 0',
    borderBottom: '1px solid var(--border)',
  },
  statusLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
  statusLabel: {
    fontSize: 13,
    color: 'var(--text-primary)',
  },
  statusCount: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    fontVariantNumeric: 'tabular-nums',
  },
  rejectionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    maxHeight: 200,
    overflow: 'auto',
  },
  rejectionItem: {
    display: 'flex',
    gap: 12,
    padding: '4px 8px',
    background: 'var(--bg-elevated)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 12,
  },
  rejectionCompany: {
    fontWeight: 600,
    color: 'var(--text-primary)',
    minWidth: 120,
  },
  rejectionRole: {
    color: 'var(--text-secondary)',
    flex: 1,
  },
  rejectionDate: {
    color: 'var(--text-tertiary)',
    whiteSpace: 'nowrap' as const,
  },
}
