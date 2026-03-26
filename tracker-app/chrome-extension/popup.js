/**
 * JobTracker LinkedIn Connect — Popup Logic
 *
 * Manages the popup UI states: disconnected, connecting, connected, error.
 * Communicates with background.js via chrome.runtime.sendMessage.
 */

// ─── DOM Elements ───────────────────────────────────────────────────────────

const stateDisconnected = document.getElementById('state-disconnected')
const stateConnecting = document.getElementById('state-connecting')
const stateConnected = document.getElementById('state-connected')
const stateError = document.getElementById('state-error')

const btnConnect = document.getElementById('btn-connect')
const btnDisconnect = document.getElementById('btn-disconnect')
const btnRetry = document.getElementById('btn-retry')

const linkedInNameEl = document.getElementById('linkedin-name')
const lastSyncEl = document.getElementById('last-sync')
const errorMessageEl = document.getElementById('error-message')

// ─── State Management ───────────────────────────────────────────────────────

function showState(state) {
  stateDisconnected.classList.add('hidden')
  stateConnecting.classList.add('hidden')
  stateConnected.classList.add('hidden')
  stateError.classList.add('hidden')

  switch (state) {
    case 'disconnected':
      stateDisconnected.classList.remove('hidden')
      break
    case 'connecting':
      stateConnecting.classList.remove('hidden')
      break
    case 'connected':
      stateConnected.classList.remove('hidden')
      break
    case 'error':
      stateError.classList.remove('hidden')
      break
  }
}

function showConnected(name, lastSync) {
  linkedInNameEl.textContent = name || 'LinkedIn User'
  lastSyncEl.textContent = formatLastSync(lastSync)
  showState('connected')
}

function showError(message) {
  errorMessageEl.textContent = message || 'An unexpected error occurred. Please try again.'
  showState('error')
}

function formatLastSync(isoDate) {
  if (!isoDate) return 'Last synced: never'

  const date = new Date(isoDate)
  const now = new Date()
  const diffMs = now - date
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return 'Last synced: just now'
  if (diffMin < 60) return `Last synced: ${diffMin}m ago`

  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `Last synced: ${diffHr}h ago`

  const diffDays = Math.floor(diffHr / 24)
  return `Last synced: ${diffDays}d ago`
}

// ─── Actions ────────────────────────────────────────────────────────────────

async function connect() {
  showState('connecting')

  try {
    const response = await sendMessage({ action: 'connect' })

    if (response?.success) {
      showConnected(response.name, response.lastSync)
    } else {
      showError(response?.error || 'Failed to connect. Make sure you are logged in to LinkedIn.')
    }
  } catch (err) {
    showError('Extension error. Please try again.')
    console.error('[JobTracker Popup] Connect error:', err)
  }
}

async function disconnect() {
  try {
    await sendMessage({ action: 'disconnect' })
    showState('disconnected')
  } catch (err) {
    console.error('[JobTracker Popup] Disconnect error:', err)
    // Still show disconnected — best effort
    showState('disconnected')
  }
}

async function checkStatus() {
  try {
    const response = await sendMessage({ action: 'getStatus' })

    if (response?.connected) {
      showConnected(response.name, response.lastSync)
    } else {
      showState('disconnected')
    }
  } catch (err) {
    console.error('[JobTracker Popup] Status check error:', err)
    showState('disconnected')
  }
}

// ─── Chrome Message Helper ──────────────────────────────────────────────────

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
      } else {
        resolve(response)
      }
    })
  })
}

// ─── Event Listeners ────────────────────────────────────────────────────────

btnConnect.addEventListener('click', connect)
btnDisconnect.addEventListener('click', disconnect)
btnRetry.addEventListener('click', connect)

// ─── Initialize ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', checkStatus)
