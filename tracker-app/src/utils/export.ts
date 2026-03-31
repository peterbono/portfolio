import type { Job } from '../types/job'
import { STATUS_CONFIG } from '../types/job'

const CSV_COLUMNS = ['Date', 'Status', 'Company', 'Role', 'Location', 'Salary', 'Link', 'Source', 'Notes'] as const

/** Escape a value for CSV: wrap in quotes if it contains commas, quotes, or newlines */
function escapeCSV(value: string): string {
  if (!value) return ''
  // If value contains comma, double-quote, or newline, wrap in quotes and escape inner quotes
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function jobToCSVRow(job: Job): string {
  const statusLabel = STATUS_CONFIG[job.status]?.label ?? job.status
  const values = [
    job.date ?? '',
    statusLabel,
    job.company ?? '',
    job.role ?? '',
    job.location ?? '',
    job.salary ?? '',
    job.link ?? '',
    job.source ?? '',
    job.notes ?? '',
  ]
  return values.map(escapeCSV).join(',')
}

function getDateStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Export an array of jobs as a CSV file download */
export function exportAsCSV(jobs: Job[], filename?: string): void {
  const header = CSV_COLUMNS.join(',')
  const rows = jobs.map(jobToCSVRow)
  // Add BOM for Excel compatibility with UTF-8
  const bom = '\uFEFF'
  const csv = bom + [header, ...rows].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  triggerDownload(blob, filename ?? `jobs-export-${getDateStamp()}.csv`)
}

/** Export an array of jobs as a JSON file download */
export function exportAsJSON(jobs: Job[], filename?: string): void {
  const json = JSON.stringify(jobs, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  triggerDownload(blob, filename ?? `jobs-export-${getDateStamp()}.json`)
}
