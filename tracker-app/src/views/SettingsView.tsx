import { useState, useCallback, useRef } from 'react'
import { useJobs } from '../context/JobsContext'
import { useGmailAPI } from '../hooks/useGmailAPI'
import { useSupabase } from '../context/SupabaseContext'
import { STATUS_CONFIG, type JobStatus, type Job } from '../types/job'
import { MigrationBanner } from '../components/MigrationBanner'
import { useAuthWall } from '../hooks/useAuthWall'

export function SettingsView() {
  const { jobs, counts, addJob } = useJobs()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { requireAuth } = useAuthWall()

  const [importStatus, setImportStatus] = useState<string | null>(null)
  const { supabase } = useSupabase()

  const [apiKey, setApiKey] = useState(() => {
    try { return localStorage.getItem('tracker_anthropic_key') || '' }
    catch { return '' }
  })
  const [apiKeySaved, setApiKeySaved] = useState(false)
  const [apiKeyError, setApiKeyError] = useState<string | null>(null)

  const handleSaveApiKey = useCallback(() => {
    try {
      setApiKeyError(null)
      // Basic validation: Anthropic keys start with sk-ant-
      if (apiKey && !apiKey.startsWith('sk-ant-')) {
        setApiKeyError('Invalid key format. Anthropic API keys start with sk-ant-')
        return
      }
      if (apiKey) localStorage.setItem('tracker_anthropic_key', apiKey)
      else localStorage.removeItem('tracker_anthropic_key')
      setApiKeySaved(true)
      setTimeout(() => setApiKeySaved(false), 2000)
    } catch { /* ignore */ }
  }, [apiKey])

  const {
    isConnected: gmailConnected,
    isScanning: gmailScanning,
    lastScanAt: gmailLastScan,
    events: gmailEvents,
    error: gmailError,
    userEmail: gmailEmail,
    scanNow: gmailScanNow,
    needsReauth: gmailNeedsReauth,
  } = useGmailAPI()

  const handleConnectGmail = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        scopes: 'https://www.googleapis.com/auth/gmail.readonly',
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
  }, [supabase.auth])

  const handleDisconnectGmail = useCallback(async () => {
    // Sign out and sign back in without Gmail scope
    await supabase.auth.signOut()
  }, [supabase.auth])

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
      // Limit import file size to 10MB to prevent memory abuse
      if (file.size > 10 * 1024 * 1024) {
        setImportStatus('Import failed: File too large (max 10MB)')
        setTimeout(() => setImportStatus(null), 4000)
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string) as Job[]
          if (!Array.isArray(data)) throw new Error('Expected an array')
          // Limit import to 5000 jobs max
          if (data.length > 5000) throw new Error('Too many jobs (max 5000)')
          let imported = 0
          for (const job of data) {
            if (job.id && job.company && job.role) {
              // Sanitize string fields to prevent oversized entries
              const sanitized = {
                ...job,
                company: String(job.company).slice(0, 200),
                role: String(job.role).slice(0, 200),
                notes: job.notes ? String(job.notes).slice(0, 2000) : '',
                link: job.link ? String(job.link).slice(0, 500) : '',
              }
              addJob(sanitized)
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

        {gmailConnected ? (
          <>
            {/* Connection status */}
            <div style={styles.fieldGroup}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(52, 211, 153, 0.08)',
                border: '1px solid rgba(52, 211, 153, 0.2)',
                fontSize: 13,
                color: '#34d399',
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#34d399', flexShrink: 0 }} />
                Gmail connected{gmailEmail ? ` as ${gmailEmail}` : ''}
              </div>
            </div>

            {/* Last scan info */}
            <div style={styles.fieldGroup}>
              <label style={styles.label}>Last Scan</label>
              <span style={styles.value}>
                {gmailLastScan ? (
                  <>
                    {new Date(gmailLastScan).toLocaleString()}
                    {gmailEvents.length > 0 && (
                      <span style={{ color: 'var(--text-tertiary)', marginLeft: 8 }}>
                        — Found {gmailEvents.length} event{gmailEvents.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </>
                ) : 'Never'}
              </span>
            </div>

            {/* Scan + Disconnect buttons */}
            <div style={{ ...styles.fieldGroup, display: 'flex', gap: 8 }}>
              <button
                style={{ ...styles.btnPrimary, opacity: gmailScanning ? 0.6 : 1 }}
                onClick={() => {
                  if (!requireAuth('sync_gmail', () => gmailScanNow())) return
                  gmailScanNow()
                }}
                disabled={gmailScanning}
              >
                {gmailScanning ? 'Scanning...' : 'Scan Now'}
              </button>
              <button style={styles.btnSecondary} onClick={handleDisconnectGmail}>
                Disconnect
              </button>
            </div>

            {gmailError && (
              <div style={styles.fieldGroup}>
                <span style={styles.errorText}>{gmailError}</span>
              </div>
            )}

            {gmailNeedsReauth && (
              <div style={styles.fieldGroup}>
                <button style={styles.btnPrimary} onClick={handleConnectGmail}>
                  Reconnect Gmail
                </button>
              </div>
            )}

            {/* Recent events */}
            {gmailEvents.length > 0 && (
              <div style={styles.fieldGroup}>
                <label style={styles.label}>Recent Events ({gmailEvents.length})</label>
                <div style={styles.rejectionList}>
                  {gmailEvents.slice(0, 10).map((evt, i) => (
                    <div key={i} style={styles.rejectionItem}>
                      <span style={{
                        ...styles.rejectionCompany,
                        color: evt.type === 'rejection' ? '#a855f7'
                          : evt.type === 'interview' ? '#60a5fa'
                            : evt.type === 'offer' ? '#fbbf24'
                              : 'var(--text-primary)',
                      }}>
                        {evt.type}
                      </span>
                      <span style={styles.rejectionRole}>{evt.company}</span>
                      <span style={styles.rejectionDate}>{evt.date}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={styles.fieldGroup}>
            <p style={styles.hint}>
              Connect your Gmail to automatically detect rejections, interviews, and offers.
            </p>
            <button style={styles.btnPrimary} onClick={() => {
              if (!requireAuth('sync_gmail', () => handleConnectGmail())) return
              handleConnectGmail()
            }}>
              Connect Gmail
            </button>
          </div>
        )}
      </section>

      {/* Cloud Sync */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Cloud Sync</h2>
        <MigrationBanner />
      </section>

      {/* AI Coach */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>AI Coach</h2>
        <div style={styles.fieldGroup}>
          <label style={styles.label}>Anthropic API Key</label>
          <p style={styles.hint}>Required for AI-powered coaching. Uses Claude Sonnet (~$0.03/briefing).</p>
          <div style={styles.inputRow}>
            <input
              style={{
                ...styles.input,
                ...(apiKeyError ? { borderColor: '#f43f5e' } : {}),
              }}
              type="password"
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setApiKeyError(null) }}
              placeholder="sk-ant-api03-..."
              aria-label="Anthropic API Key"
              aria-invalid={!!apiKeyError}
            />
            <button style={styles.btnPrimary} onClick={handleSaveApiKey}>
              {apiKeySaved ? 'Saved!' : 'Save'}
            </button>
          </div>
          {apiKeyError && (
            <span style={styles.errorText}>{apiKeyError}</span>
          )}
        </div>
      </section>

      {/* Data Management */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Data Management</h2>

        <div style={styles.fieldGroup}>
          <label style={styles.label}>Export</label>
          <p style={styles.hint}>Download all {jobs.length} jobs as a JSON file</p>
          <button style={styles.btnSecondary} onClick={() => {
            if (!requireAuth('export_data', () => handleExport())) return
            handleExport()
          }}>
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
