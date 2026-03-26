/**
 * JobTracker LinkedIn Connect — Background Service Worker
 *
 * Handles:
 * - Reading the li_at session cookie from .linkedin.com
 * - Validating the cookie by fetching the LinkedIn profile API
 * - Responding to messages from popup.js and content.js
 * - Periodic cookie health checks
 */

const LINKEDIN_COOKIE_NAME = 'li_at'
const LINKEDIN_COOKIE_URL = 'https://www.linkedin.com'
const LINKEDIN_PROFILE_API = 'https://www.linkedin.com/voyager/api/me'
const COOKIE_CHECK_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

// ─── Cookie Operations ──────────────────────────────────────────────────────

/**
 * Read the li_at cookie from .linkedin.com
 * @returns {Promise<string|null>} The cookie value or null if not found
 */
async function getLinkedInCookie() {
  try {
    const cookie = await chrome.cookies.get({
      url: LINKEDIN_COOKIE_URL,
      name: LINKEDIN_COOKIE_NAME,
    })
    return cookie?.value || null
  } catch (err) {
    console.error('[JobTracker] Failed to read LinkedIn cookie:', err)
    return null
  }
}

/**
 * Validate the cookie by making a lightweight request to LinkedIn's API.
 * Returns the user's display name if valid, null otherwise.
 * @param {string} cookieValue
 * @returns {Promise<{valid: boolean, name: string|null}>}
 */
async function validateCookie(cookieValue) {
  try {
    const res = await fetch(LINKEDIN_PROFILE_API, {
      headers: {
        'csrf-token': 'ajax:0',
        'cookie': `li_at=${cookieValue}`,
      },
      credentials: 'omit',
    })

    if (!res.ok) {
      return { valid: false, name: null }
    }

    const data = await res.json()
    const firstName = data?.miniProfile?.firstName || data?.firstName || ''
    const lastName = data?.miniProfile?.lastName || data?.lastName || ''
    const name = `${firstName} ${lastName}`.trim() || 'LinkedIn User'

    return { valid: true, name }
  } catch {
    // Network error or CORS — cookie might still be valid, just can't verify from extension
    // Fall back to "cookie exists" as a weaker validation
    return { valid: !!cookieValue, name: null }
  }
}

// ─── Storage Helpers ────────────────────────────────────────────────────────

async function getStoredStatus() {
  const result = await chrome.storage.local.get([
    'connected',
    'linkedInName',
    'lastSync',
    'cookieValue',
  ])
  return {
    connected: result.connected || false,
    name: result.linkedInName || null,
    lastSync: result.lastSync || null,
    cookieValue: result.cookieValue || null,
  }
}

async function setConnected(cookieValue, name) {
  await chrome.storage.local.set({
    connected: true,
    linkedInName: name,
    lastSync: new Date().toISOString(),
    cookieValue,
  })
}

async function clearConnection() {
  await chrome.storage.local.remove([
    'connected',
    'linkedInName',
    'lastSync',
    'cookieValue',
  ])
}

// ─── Message Handler ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'getCookie') {
    handleGetCookie().then(sendResponse)
    return true // keep channel open for async response
  }

  if (message.action === 'connect') {
    handleConnect().then(sendResponse)
    return true
  }

  if (message.action === 'disconnect') {
    handleDisconnect().then(sendResponse)
    return true
  }

  if (message.action === 'getStatus') {
    handleGetStatus().then(sendResponse)
    return true
  }

  if (message.action === 'refreshCookie') {
    handleRefreshCookie().then(sendResponse)
    return true
  }
})

async function handleGetCookie() {
  const cookieValue = await getLinkedInCookie()
  if (!cookieValue) {
    return { success: false, error: 'No LinkedIn session found. Please log in to LinkedIn first.' }
  }
  const status = await getStoredStatus()
  return {
    success: true,
    cookie: cookieValue,
    connected: status.connected,
    name: status.name,
  }
}

async function handleConnect() {
  const cookieValue = await getLinkedInCookie()
  if (!cookieValue) {
    return {
      success: false,
      error: 'No LinkedIn session found. Please log in to LinkedIn in this browser first.',
    }
  }

  const validation = await validateCookie(cookieValue)
  if (!validation.valid) {
    return {
      success: false,
      error: 'LinkedIn session is expired. Please log in to LinkedIn again.',
    }
  }

  await setConnected(cookieValue, validation.name)

  return {
    success: true,
    connected: true,
    name: validation.name,
    lastSync: new Date().toISOString(),
  }
}

async function handleDisconnect() {
  await clearConnection()
  return { success: true, connected: false }
}

async function handleGetStatus() {
  const status = await getStoredStatus()

  // If connected, verify the cookie is still present
  if (status.connected) {
    const currentCookie = await getLinkedInCookie()
    if (!currentCookie) {
      await clearConnection()
      return { connected: false, name: null, lastSync: null }
    }
  }

  return {
    connected: status.connected,
    name: status.name,
    lastSync: status.lastSync,
  }
}

async function handleRefreshCookie() {
  const cookieValue = await getLinkedInCookie()
  if (!cookieValue) {
    await clearConnection()
    return { success: false, connected: false, error: 'LinkedIn session expired.' }
  }

  const validation = await validateCookie(cookieValue)
  if (!validation.valid) {
    await clearConnection()
    return { success: false, connected: false, error: 'LinkedIn session is no longer valid.' }
  }

  await setConnected(cookieValue, validation.name)
  return {
    success: true,
    connected: true,
    name: validation.name,
    lastSync: new Date().toISOString(),
  }
}

// ─── Periodic Cookie Health Check ───────────────────────────────────────────

chrome.alarms.create('cookieHealthCheck', {
  periodInMinutes: COOKIE_CHECK_INTERVAL_MS / 60000,
})

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'cookieHealthCheck') {
    const status = await getStoredStatus()
    if (status.connected) {
      const cookieValue = await getLinkedInCookie()
      if (!cookieValue) {
        await clearConnection()
        console.log('[JobTracker] LinkedIn cookie expired, cleared connection status.')
      } else if (cookieValue !== status.cookieValue) {
        // Cookie was refreshed by LinkedIn, update stored value
        const validation = await validateCookie(cookieValue)
        if (validation.valid) {
          await setConnected(cookieValue, validation.name || status.name)
          console.log('[JobTracker] LinkedIn cookie refreshed.')
        }
      }
    }
  }
})

// ─── Install / Update ───────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[JobTracker] Extension installed.')
  } else if (details.reason === 'update') {
    console.log('[JobTracker] Extension updated to', chrome.runtime.getManifest().version)
  }
})
