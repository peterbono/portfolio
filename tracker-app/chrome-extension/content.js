/**
 * JobTracker LinkedIn Connect — Content Script v2.2.0
 *
 * Injected into tracker-app-lyart.vercel.app and localhost dev servers.
 * Bridges communication between the web app and the extension's background
 * service worker via window.postMessage + chrome.runtime.sendMessage.
 *
 * v2.1.0: Guard against double-injection after extension reload re-injection.
 */

// Guard: if already loaded in this page context, skip
if (window._jobTrackerContentLoaded) {
  console.log('[JobTracker Extension] Content script already loaded — skipping duplicate')
} else {
window._jobTrackerContentLoaded = true

console.log('[JobTracker Extension] Content script v2.2.0 loaded — batch apply with requestId')

// ─── Listen for requests from the web app ───────────────────────────────────

window.addEventListener('message', (event) => {
  // Only accept messages from the same window (the web app)
  if (event.source !== window) return

  // Handle cookie request
  if (event.data?.type === 'JOBTRACKER_REQUEST_COOKIE') {
    chrome.runtime.sendMessage({ action: 'getCookie' }, (response) => {
      if (chrome.runtime.lastError) {
        window.postMessage({
          type: 'JOBTRACKER_COOKIE_RESPONSE',
          cookie: null,
          connected: false,
          error: chrome.runtime.lastError.message,
        }, '*')
        return
      }

      window.postMessage({
        type: 'JOBTRACKER_COOKIE_RESPONSE',
        cookie: response?.cookie || null,
        connected: response?.connected || false,
        name: response?.name || null,
      }, '*')
    })
  }

  // Handle connect request (web app triggers connection)
  if (event.data?.type === 'JOBTRACKER_REQUEST_CONNECT') {
    chrome.runtime.sendMessage({ action: 'connect' }, (response) => {
      if (chrome.runtime.lastError) {
        window.postMessage({
          type: 'JOBTRACKER_CONNECT_RESPONSE',
          success: false,
          error: chrome.runtime.lastError.message,
        }, '*')
        return
      }

      window.postMessage({
        type: 'JOBTRACKER_CONNECT_RESPONSE',
        success: response?.success || false,
        connected: response?.connected || false,
        name: response?.name || null,
        error: response?.error || null,
      }, '*')
    })
  }

  // Handle LinkedIn Easy Apply via extension
  if (event.data?.type === 'JOBTRACKER_APPLY_VIA_EXTENSION') {
    const jobData = event.data.jobData
    const requestId = event.data.requestId || null
    console.log('[JobTracker Extension] Apply request received:', jobData?.company, '| requestId:', requestId)

    chrome.runtime.sendMessage({ action: 'applyViaExtension', jobData, requestId }, (response) => {
      if (chrome.runtime.lastError) {
        window.postMessage({
          type: 'JOBTRACKER_APPLY_RESULT',
          success: false,
          status: 'failed',
          reason: chrome.runtime.lastError.message,
          company: jobData?.company,
          requestId,
        }, '*')
        return
      }

      window.postMessage({
        type: 'JOBTRACKER_APPLY_RESULT',
        ...response,
        company: jobData?.company,
        requestId,
      }, '*')
    })
  }

  // Handle disconnect request
  if (event.data?.type === 'JOBTRACKER_REQUEST_DISCONNECT') {
    chrome.runtime.sendMessage({ action: 'disconnect' }, (response) => {
      window.postMessage({
        type: 'JOBTRACKER_DISCONNECT_RESPONSE',
        success: true,
        connected: false,
      }, '*')
    })
  }

  // Handle diagnostics read request
  if (event.data?.type === 'JOBTRACKER_READ_DIAGNOSTICS') {
    chrome.runtime.sendMessage({ action: 'getDiagnostics' }, (response) => {
      if (chrome.runtime.lastError) {
        window.postMessage({ type: 'JOBTRACKER_DIAGNOSTICS_RESPONSE', error: chrome.runtime.lastError.message }, '*')
        return
      }
      window.postMessage({ type: 'JOBTRACKER_DIAGNOSTICS_RESPONSE', ...response }, '*')
    })
  }

  // Handle extension reload request (so Claude can reload without chrome://extensions)
  if (event.data?.type === 'JOBTRACKER_REQUEST_RELOAD') {
    console.log('[JobTracker Extension] Reload requested via postMessage')
    chrome.runtime.sendMessage({ action: 'reloadExtension' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[JobTracker Extension] Reload failed:', chrome.runtime.lastError.message)
      }
    })
  }
})

// ─── Auto-send connection status on page load ───────────────────────────────

function sendConnectionStatus() {
  chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
    if (chrome.runtime.lastError) {
      // Extension context might be invalidated; silently fail
      return
    }

    window.postMessage({
      type: 'JOBTRACKER_CONNECTION_STATUS',
      connected: response?.connected || false,
      name: response?.name || null,
      lastSync: response?.lastSync || null,
    }, '*')
  })
}

// Send status immediately and also after a short delay
sendConnectionStatus()
setTimeout(sendConnectionStatus, 1000)
setTimeout(sendConnectionStatus, 3000)

// ─── Auto-sync cookie to localStorage on page load ──────────────────────────

function syncCookieToLocalStorage() {
  chrome.runtime.sendMessage({ action: 'getCookie' }, (response) => {
    if (chrome.runtime.lastError) return
    if (response?.success && response?.cookie) {
      localStorage.setItem('tracker_v2_linkedin_cookie', response.cookie)
      console.log('[JobTracker Extension] LinkedIn cookie synced to localStorage')
    }
  })
}

// Sync on load and periodically
syncCookieToLocalStorage()
setTimeout(syncCookieToLocalStorage, 2000)
setInterval(syncCookieToLocalStorage, 5 * 60 * 1000) // every 5 min

// ─── Announce extension is installed ────────────────────────────────────────

window.postMessage({
  type: 'JOBTRACKER_EXTENSION_INSTALLED',
  version: chrome.runtime.getManifest().version,
}, '*')

} // end of double-injection guard
