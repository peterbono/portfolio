/**
 * JobTracker LinkedIn Connect — Content Script
 *
 * Injected into tracker-app-lyart.vercel.app and localhost dev servers.
 * Bridges communication between the web app and the extension's background
 * service worker via window.postMessage + chrome.runtime.sendMessage.
 */

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
// (in case the web app's listener isn't registered yet)
sendConnectionStatus()
setTimeout(sendConnectionStatus, 1000)
setTimeout(sendConnectionStatus, 3000)

// ─── Announce extension is installed ────────────────────────────────────────

window.postMessage({
  type: 'JOBTRACKER_EXTENSION_INSTALLED',
  version: chrome.runtime.getManifest().version,
}, '*')
