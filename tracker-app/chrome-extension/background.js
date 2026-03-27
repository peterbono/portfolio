/**
 * JobTracker LinkedIn Connect — Background Service Worker (simplified)
 */

const LINKEDIN_COOKIE_NAME = 'li_at'
const LINKEDIN_COOKIE_URL = 'https://www.linkedin.com'

async function getLinkedInCookie() {
  try {
    const cookie = await chrome.cookies.get({
      url: LINKEDIN_COOKIE_URL,
      name: LINKEDIN_COOKIE_NAME,
    })
    return cookie?.value || null
  } catch (err) {
    console.error('[JobTracker] Failed to read cookie:', err)
    return null
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handle = async () => {
    if (message.action === 'connect') {
      const cookie = await getLinkedInCookie()
      if (!cookie || cookie.length < 50) {
        return { success: false, error: 'Not logged in to LinkedIn. Open linkedin.com and sign in first.' }
      }
      await chrome.storage.local.set({
        connected: true,
        linkedInName: 'LinkedIn User',
        lastSync: new Date().toISOString(),
        cookieValue: cookie,
      })
      return { success: true, connected: true, name: 'LinkedIn User', lastSync: new Date().toISOString() }
    }

    if (message.action === 'disconnect') {
      await chrome.storage.local.clear()
      return { success: true, connected: false }
    }

    if (message.action === 'getStatus') {
      const data = await chrome.storage.local.get(['connected', 'linkedInName', 'lastSync'])
      return { connected: data.connected || false, name: data.linkedInName || null, lastSync: data.lastSync || null }
    }

    if (message.action === 'getCookie') {
      const data = await chrome.storage.local.get(['cookieValue', 'connected'])
      if (data.connected && data.cookieValue) {
        return { success: true, cookie: data.cookieValue, connected: true }
      }
      // Try fresh read
      const cookie = await getLinkedInCookie()
      if (cookie) {
        return { success: true, cookie, connected: false }
      }
      return { success: false, error: 'No LinkedIn session found.' }
    }

    return { success: false, error: 'Unknown action' }
  }

  handle().then(sendResponse).catch(err => {
    console.error('[JobTracker]', err)
    sendResponse({ success: false, error: err.message })
  })

  return true // keep channel open for async
})
