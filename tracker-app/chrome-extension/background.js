/**
 * JobTracker LinkedIn Connect — Background Service Worker v3.0.0
 *
 * v3.0.0 — Job Board Redirect Flow:
 * - applyAtsDirectly now detects job board URLs (WWR, RemoteOK, Dribbble, Jobicy,
 *   Himalayas, Remotive, Wellfound) and handles them before the ATS type check.
 * - Opens the job board listing page, finds the "Apply" / "View & Apply" button
 *   via chrome.scripting.executeScript, clicks it, and waits for the tab to
 *   redirect to the real ATS domain.
 * - Once on the ATS page, sets atsApplyContext and injects ats-apply.js normally.
 * - Existing ATS direct flow is completely unchanged.
 *
 * v2.9.0 fixes:
 * - pending_external: when linkedin-apply.js clicks external Apply, it now reports
 *   'pending_external' (not 'applied_external'). The polling loop skips this interim
 *   status and waits for ats-apply.js to overwrite lastApplyResult with the real
 *   status (applied_external, needs_manual, or failed). Secondary 60s timeout for ATS phase.
 * v2.8.0 fixes:
 * - Auto re-inject content scripts after extension reload (onInstalled)
 * - onMessageExternal for direct web-page-to-service-worker communication
 * v2.7.0 fixes:
 * - Separate focused window: create visible window → wait for SPA hydration → refocus original
 * v2.6.0 fixes:
 * - Snapshot tab IDs before opening LinkedIn tab; after result, close any new ATS tabs
 *   to prevent stale Greenhouse/SmartRecruiters/etc. tabs from accumulating
 * - Handle 'applied_external' status from linkedin-apply.js v3.2.0
 *
 * v2.5.0 fixes:
 * - Use background tabs (active:false) instead of minimized windows to avoid Chrome throttling
 * - Event-driven tab load wait with login/auth wall redirect detection
 * - Mid-flight re-injection at 25s if content script hasn't produced a result
 * - Stale result clearing before each job
 */

// ─── ATS Domain Detection ─────────────────────────────────────────────

const ATS_PATTERNS = [
  { pattern: /greenhouse\.io/i, type: 'greenhouse' },
  { pattern: /boards\.greenhouse\.io/i, type: 'greenhouse' },
  { pattern: /jobs\.lever\.co/i, type: 'lever' },
  { pattern: /lever\.co\/.*\/apply/i, type: 'lever' },
  { pattern: /apply\.workable\.com/i, type: 'workable' },
  { pattern: /workable\.com/i, type: 'workable' },
  { pattern: /jobs\.ashbyhq\.com/i, type: 'ashby' },
  { pattern: /careers-page\.com/i, type: 'manatal' },
  { pattern: /breezy\.hr/i, type: 'breezy' },
  { pattern: /recruitee\.com/i, type: 'recruitee' },
  { pattern: /teamtailor\.com/i, type: 'teamtailor' },
  { pattern: /smartrecruiters\.com/i, type: 'smartrecruiters' },
  { pattern: /bamboohr\.com/i, type: 'bamboohr' },
  { pattern: /applytojob\.com/i, type: 'bamboohr' },
  { pattern: /jobvite\.com/i, type: 'jobvite' },
  { pattern: /icims\.com/i, type: 'icims' },
  { pattern: /pinpointhq\.com/i, type: 'pinpoint' },
  { pattern: /dover\.com/i, type: 'dover' },
  { pattern: /rippling\.com/i, type: 'rippling' },
  { pattern: /jazz\.co/i, type: 'jazz' },
  { pattern: /comeet\.com/i, type: 'comeet' },
  { pattern: /freshteam\.com/i, type: 'freshteam' },
  { pattern: /zohorecruit\.com/i, type: 'zohorecruit' },
  { pattern: /personio\.(de|com)/i, type: 'personio' },
  { pattern: /join\.com/i, type: 'join' },
  { pattern: /polymer\.co/i, type: 'polymer' },
  { pattern: /welcomekit\.co/i, type: 'welcomekit' },
  { pattern: /homerun\.co/i, type: 'homerun' },
  { pattern: /hundred5\.com/i, type: 'hundred5' },
  { pattern: /myworkdayjobs\.com/i, type: 'workday' },
  { pattern: /workday\.com/i, type: 'workday' },
]

// Domains we should NOT inject on (these are not career pages)
const SKIP_DOMAINS = [
  /linkedin\.com/i,
  /google\.com/i,
  /facebook\.com/i,
  /tracker-app-lyart\.vercel\.app/i,
  /localhost/i,
]

// ─── Job Board Detection ─────────────────────────────────────────────
// Job boards list jobs but don't host ATS forms. When we receive a job
// board URL, we must open the page, click the "Apply" button, follow
// the redirect to the real ATS, then inject ats-apply.js there.
const JOB_BOARD_PATTERNS = [
  { pattern: /weworkremotely\.com/i, name: 'weworkremotely' },
  { pattern: /remoteok\.com/i, name: 'remoteok' },
  { pattern: /dribbble\.com\/jobs\//i, name: 'dribbble' },
  { pattern: /jobicy\.com/i, name: 'jobicy' },
  { pattern: /himalayas\.app/i, name: 'himalayas' },
  { pattern: /remotive\.com/i, name: 'remotive' },
  { pattern: /wellfound\.com/i, name: 'wellfound' },
]

function detectJobBoard(url) {
  if (!url) return null
  for (const board of JOB_BOARD_PATTERNS) {
    if (board.pattern.test(url)) return board.name
  }
  return null
}

/**
 * Content script injected into a job board page to find and click the
 * "Apply" / "View & Apply" button. Returns the href if it's an <a> tag,
 * or 'clicked' if it's a button that was clicked (expecting a navigation).
 */
function jobBoardClickApplyScript() {
  // Selectors ordered from most specific (per-board) to generic
  const selectors = [
    // WWR
    'a.apply-button',
    'a[href*="/apply"]',
    'input[type="button"][value*="Apply"]',
    // RemoteOK
    'a.action-apply',
    'a[itemprop="url"]',
    // Dribbble
    'a[data-test="apply-button"]',
    // Jobicy
    'a.btn-apply',
    // Generic: any link or button whose visible text includes "Apply"
  ]

  // First, try specific selectors
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (el) {
      console.log('[JobTracker:JobBoard] Found Apply element via selector:', sel, el.href || el.textContent?.trim())
      if (el.href) return el.href
      el.click()
      return 'clicked'
    }
  }

  // Fallback: scan all <a> and <button> elements for text containing "Apply"
  const applyTexts = ['view & apply', 'view and apply', 'apply for this job', 'apply now', 'apply']
  const allLinks = [...document.querySelectorAll('a, button')]
  for (const text of applyTexts) {
    for (const el of allLinks) {
      const elText = (el.textContent || '').trim().toLowerCase()
      if (elText === text || elText.startsWith(text)) {
        console.log('[JobTracker:JobBoard] Found Apply element via text match:', JSON.stringify(text), '→', el.href || el.tagName)
        if (el.href && el.href !== '#' && el.href !== window.location.href) return el.href
        el.click()
        return 'clicked'
      }
    }
  }

  return null
}

// ─── Auto re-inject content scripts after extension reload/update ────────────
// When the extension reloads, all previously injected content scripts lose their
// chrome.runtime connection. This listener re-injects them on all matching tabs.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'update' || details.reason === 'install') {
    console.log('[JobTracker] Extension', details.reason, '— re-injecting content scripts')
    const manifest = chrome.runtime.getManifest()
    for (const cs of manifest.content_scripts) {
      // Use Chrome's native match pattern matching via tabs.query({ url: ... })
      chrome.tabs.query({ url: cs.matches, status: 'complete' }, (tabs) => {
        console.log('[JobTracker] Found', tabs.length, 'matching tabs for', cs.js.join(','))
        for (const tab of tabs) {
          // First: clear the guard variables that block re-injection
          // These persist on the window object even after the old content script context dies
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              window._jobTrackerContentLoaded = false;
              window._jobTrackerApplyRan = false;
            },
          }).then(() => {
            console.log('[JobTracker] Cleared guard variables on tab', tab.id)
            // Now re-inject the content scripts
            for (const file of cs.js) {
              chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: [file],
              }).then(() => {
                console.log('[JobTracker] Re-injected', file, 'into tab', tab.id, tab.url?.substring(0, 60))
              }).catch((err) => {
                console.warn('[JobTracker] Re-inject failed for tab', tab.id, ':', err.message)
              })
            }
          }).catch((err) => {
            console.warn('[JobTracker] Guard clear failed for tab', tab.id, ':', err.message)
          })
        }
      })
    }
  }
})

// ─── External message listener (for direct web-page → service worker) ────────
// Allows tracker-app-lyart.vercel.app to send messages directly via
// chrome.runtime.sendMessage(extensionId, msg) without content.js relay.
// This survives content script disconnection after extension reload.
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  console.log('[JobTracker] External message from', sender.url?.substring(0, 60), ':', message.action)
  // Handle reload directly (most important external action)
  if (message.action === 'reloadExtension') {
    console.log('[JobTracker] External reload request — reloading')
    sendResponse({ success: true })
    chrome.runtime.reload()
    return
  }
  // For other actions, fire an internal message to reuse existing handlers
  // (the onMessage listener below handles all other actions)
  chrome.runtime.sendMessage(message, (response) => {
    sendResponse(response)
  })
  return true // keep channel open for async
})

function detectAtsType(url) {
  if (!url) return null
  for (const skip of SKIP_DOMAINS) {
    if (skip.test(url)) return null
  }
  for (const ats of ATS_PATTERNS) {
    if (ats.pattern.test(url)) return ats.type
  }
  // If no known ATS but it's an external career page, return generic
  return 'generic'
}

// ─── Auto-apply: watch for LinkedIn job tabs and inject apply script ───
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return
  if (!tab.url) return

  // ─── LinkedIn job page: ALWAYS inject linkedin-apply.js ───
  if (tab.url.includes('linkedin.com/jobs/view/')) {
    console.log('[JobTracker] LinkedIn job tab loaded, injecting apply script')

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['linkedin-apply.js'],
      })
      console.log('[JobTracker] linkedin-apply.js injected successfully')
    } catch (e) {
      console.warn('[JobTracker] Failed to inject linkedin-apply.js:', e.message)
    }
    return
  }

  // ─── ATS career page: inject ats-apply.js ───
  const data = await chrome.storage.local.get(['pendingExternalApply'])
  if (!data.pendingExternalApply) return

  // Check if this tab opened recently (within 30 seconds of the external click)
  const elapsed = Date.now() - (data.pendingExternalApply.timestamp || 0)
  if (elapsed > 30000) {
    console.log('[JobTracker] pendingExternalApply expired (>30s), clearing')
    await chrome.storage.local.remove('pendingExternalApply')
    return
  }

  const atsType = detectAtsType(tab.url)
  if (!atsType) return

  console.log('[JobTracker] ATS page detected:', atsType, '— URL:', tab.url)
  console.log('[JobTracker] Injecting ats-apply.js for', data.pendingExternalApply.company)

  // Store the ATS type so ats-apply.js can read it
  await chrome.storage.local.set({
    atsApplyContext: {
      ...data.pendingExternalApply,
      atsType,
      atsUrl: tab.url,
      tabId,
    }
  })

  // Inject the ATS apply script (programmatic backup — manifest content_script also auto-injects)
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['ats-apply.js'],
    })
    console.log('[JobTracker] ats-apply.js injected successfully on', atsType)
  } catch (e) {
    // Don't store failure — manifest content_script auto-injection may still work
    // (ats-apply.js has a retry loop for reading atsApplyContext)
    console.warn('[JobTracker] Programmatic inject failed (manifest auto-inject should handle it):', e.message)
  }
})

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
      // Only remove connection-related keys — preserve userProfile and any in-progress apply state
      await chrome.storage.local.remove(['connected', 'linkedInName', 'lastSync', 'cookieValue'])
      return { success: true, connected: false }
    }

    if (message.action === 'getStatus') {
      const data = await chrome.storage.local.get(['connected', 'linkedInName', 'lastSync'])
      return { connected: data.connected || false, name: data.linkedInName || null, lastSync: data.lastSync || null }
    }

    if (message.action === 'getDiagnostics') {
      const data = await chrome.storage.local.get(['lastApplyDiagnostics', 'lastApplyResult', 'atsApplyDebugLog'])
      return { diagnostics: data.lastApplyDiagnostics || null, result: data.lastApplyResult || null, debugLog: data.atsApplyDebugLog || null }
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

    // ─── LinkedIn Easy Apply via Extension ───────────────────────────
    if (message.action === 'applyViaExtension') {
      const job = message.jobData
      const requestId = message.requestId || null
      if (!job?.url) {
        return { success: false, error: 'No job URL provided', requestId }
      }

      // Normalize LinkedIn URL
      const url = job.url.replace(/https?:\/\/[a-z]{2}\.linkedin\.com/, 'https://www.linkedin.com')

      console.log('[JobTracker] Apply request:', job.company, '| requestId:', requestId)

      // Store job data so the injected script can access it
      await chrome.storage.local.set({ pendingApplyJob: { ...job, url, requestId } })

      // ─── Snapshot existing tab IDs before opening anything ───
      // Used later to identify ATS tabs opened by external apply clicks
      const preExistingTabIds = new Set()
      try {
        const allTabs = await chrome.tabs.query({})
        for (const t of allTabs) preExistingTabIds.add(t.id)
      } catch {}

      // ─── FIX: Separate window approach for LinkedIn SPA rendering ───
      // Background tabs (active:false) → LinkedIn SPA defers render (Page Visibility API).
      // Minimized windows → Chrome throttles JS execution.
      // Off-screen windows → macOS clips to screen bounds.
      // Tab flash → too fast, SPA hasn't loaded when we switch back.
      //
      // Solution: Create a separate normal window (focused), wait for page load + SPA
      // hydration, then refocus the original window. The LinkedIn window stays behind
      // but renders fully because it was visible during load.
      let tab
      let windowId = null
      const senderTabId = _sender?.tab?.id || null
      let originalWindowId = null
      try {
        // Remember the original window to refocus later
        if (senderTabId) {
          const senderTab = await chrome.tabs.get(senderTabId)
          originalWindowId = senderTab.windowId
        }
        // Create new window — will be focused, LinkedIn SPA renders
        // FIX: 800x600 was too small — Easy Apply modal buttons get cut off.
        // 1400x900 gives enough room for multi-step forms + review page Submit button.
        const win = await chrome.windows.create({
          url,
          width: 1400,
          height: 900,
          focused: true,
          type: 'normal',
        })
        tab = win.tabs[0]
        windowId = win.id
        console.log('[JobTracker] Separate window created:', win.id, 'tab:', tab.id)
      } catch (winErr) {
        // Fallback: background tab
        try {
          tab = await chrome.tabs.create({ url, active: false })
        } catch (tabErr) {
          return { success: false, status: 'error', error: 'Failed to open: ' + (winErr.message || tabErr.message), requestId }
        }
      }

      const tabCreatedAt = Date.now()
      console.log('[JobTracker] [DIAG] Tab created:', tab.id, 'for', job.company, '(window:', windowId, ') at', new Date(tabCreatedAt).toISOString())

      // Helper: close the tab + window (best effort)
      async function cleanupTab() {
        try { await chrome.tabs.remove(tab.id) } catch {}
        if (windowId) {
          try { await chrome.windows.remove(windowId) } catch {}
        }
      }

      // Helper: close any ATS tabs that were opened AFTER we started
      // (i.e., not in our pre-existing snapshot). Prevents stale Greenhouse/EPAM/etc. tabs.
      async function cleanupAtsTabs() {
        try {
          const currentTabs = await chrome.tabs.query({})
          for (const t of currentTabs) {
            // Skip tabs that existed before we started, and skip our own LinkedIn tab
            if (preExistingTabIds.has(t.id) || t.id === tab.id) continue
            // Check if this new tab's URL matches an ATS pattern
            const atsType = detectAtsType(t.url)
            if (atsType && atsType !== 'generic') {
              console.log('[JobTracker] Closing stale ATS tab:', t.id, '(' + atsType + ')', t.url)
              try { await chrome.tabs.remove(t.id) } catch {}
            }
          }
        } catch (e) {
          console.warn('[JobTracker] ATS tab cleanup error:', e.message)
        }
      }

      // Clear any stale lastApplyResult from a previous job before we start
      const staleCheck = await chrome.storage.local.get(['lastApplyResult'])
      if (staleCheck.lastApplyResult) {
        console.log('[JobTracker] [DIAG] Clearing stale lastApplyResult from previous job:', staleCheck.lastApplyResult.company, staleCheck.lastApplyResult.status)
        await chrome.storage.local.remove('lastApplyResult')
      }

      // ─── FIX: Event-driven tab load wait with login redirect detection ───
      // Waits for chrome.tabs.onUpdated 'complete', with 20s safety timeout.
      // Also detects login/auth wall redirects to bail early.
      const tabLoadResult = await new Promise((resolve) => {
        const LOAD_TIMEOUT = 20000
        let settled = false

        function settle(result) {
          if (settled) return
          settled = true
          chrome.tabs.onUpdated.removeListener(onUpdate)
          clearTimeout(timer)
          resolve(result)
        }

        function onUpdate(tabId, changeInfo, updatedTab) {
          if (tabId !== tab.id) return
          if (changeInfo.status === 'complete') {
            const loadTime = ((Date.now() - tabCreatedAt) / 1000).toFixed(1)
            const finalUrl = updatedTab.url || ''
            console.log('[JobTracker] Tab', tab.id, 'loaded in', loadTime + 's — URL:', finalUrl)
            const isAuthWall = finalUrl.includes('/login') || finalUrl.includes('/checkpoint') || finalUrl.includes('/authwall')
            settle({ loaded: true, isAuthWall, finalUrl })
          }
        }

        chrome.tabs.onUpdated.addListener(onUpdate)

        // Race condition guard: tab might already be complete before listener attached
        chrome.tabs.get(tab.id).then(currentTab => {
          if (currentTab.status === 'complete') {
            const finalUrl = currentTab.url || ''
            const isAuthWall = finalUrl.includes('/login') || finalUrl.includes('/checkpoint') || finalUrl.includes('/authwall')
            settle({ loaded: true, isAuthWall, finalUrl })
          }
        }).catch(() => {})

        const timer = setTimeout(() => {
          console.warn('[JobTracker] Tab', tab.id, 'did not reach complete within 20s — proceeding anyway')
          settle({ loaded: false, isAuthWall: false, finalUrl: '' })
        }, LOAD_TIMEOUT)
      })

      // ─── FIX: Detect login redirect and bail early ───
      if (tabLoadResult.isAuthWall) {
        console.warn('[JobTracker] LinkedIn auth wall for', job.company, '— URL:', tabLoadResult.finalUrl)
        await cleanupTab()
        return {
          success: false,
          status: 'auth_wall',
          error: 'LinkedIn redirected to login — session may have expired',
          company: job.company,
          role: job.role || '',
          url,
          requestId,
        }
      }

      // Post-load delay for LinkedIn SPA hydration (React render + Easy Apply button)
      // The page must be in a visible/focused window during this period.
      await new Promise(r => setTimeout(r, 3000))

      // FIX: Do NOT refocus original window during apply flow.
      // LinkedIn React needs the window to stay focused for form interactions.
      // The window will be closed automatically after the result is received.
      // Refocusing was causing the modal buttons to become unresponsive.
      console.log('[JobTracker] Keeping LinkedIn window focused for form interactions')

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['linkedin-apply.js'],
        })
        console.log('[JobTracker] Programmatic inject succeeded for tab', tab.id, job.company)
      } catch (injectErr) {
        // Not fatal — manifest content_script + global onUpdated listener may have already injected
        console.warn('[JobTracker] Programmatic inject skipped:', injectErr.message)
      }

      // Poll for result (linkedin-apply.js stores it in chrome.storage.local.lastApplyResult)
      let attempts = 0
      let pendingExternalSince = null // Timestamp when pending_external was first detected
      const maxAttempts = 150 // 150 seconds max — includes up to 60s for ATS form fill after external redirect
      // Extract LinkedIn job ID for robust matching (e.g., "4392382389" from the URL)
      const jobIdMatch = url.match(/\/jobs\/view\/[^/]*?(\d{6,})/)
      const jobId = jobIdMatch ? jobIdMatch[1] : null
      console.log('[JobTracker] [DIAG] Polling started — URL:', url, '| JobID:', jobId, '| Company:', job.company)

      while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000))

        // ─── FIX: Mid-flight diagnostic + re-injection at 60s ───
        if (attempts === 60) {
          try {
            const midTab = await chrome.tabs.get(tab.id)
            const midUrl = midTab.url || ''
            console.log('[JobTracker] Mid-flight check (25s) — status:', midTab.status, '| URL:', midUrl)

            // Detect late redirect to auth wall
            if (midUrl.includes('/login') || midUrl.includes('/checkpoint') || midUrl.includes('/authwall')) {
              console.warn('[JobTracker] Auth wall detected at 25s — aborting')
              await cleanupTab()
              return {
                success: false,
                status: 'auth_wall',
                error: 'LinkedIn redirected to login during apply',
                company: job.company,
                url,
              }
            }

            // Force re-inject: reset the guard flag so the script runs fresh
            console.log('[JobTracker] No result after 60s — force re-injecting content script')
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => { window._jobTrackerApplyRan = false; },
              })
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['linkedin-apply.js'],
              })
              console.log('[JobTracker] Force re-inject at 60s succeeded')
            } catch (reInjectErr) {
              console.warn('[JobTracker] Force re-inject at 60s failed:', reInjectErr.message)
            }
          } catch (tabErr) {
            console.warn('[JobTracker] Mid-flight tab check failed:', tabErr.message)
          }
        }

        const data = await chrome.storage.local.get(['lastApplyResult'])
        if (attempts % 10 === 0 && attempts > 0) {
          const elapsed = ((Date.now() - tabCreatedAt) / 1000).toFixed(1)
          console.log('[JobTracker] Poll #' + attempts + ' (' + elapsed + 's) — result:', data.lastApplyResult ? data.lastApplyResult.status : 'none')
        }
        if (data.lastApplyResult) {
          const resultUrl = data.lastApplyResult.url || ''
          const resultLinkedinUrl = data.lastApplyResult.linkedinUrl || ''

          // Robust matching: compare by job ID (most reliable), URL path, or company name
          const resultJobIdMatch = resultUrl.match(/\/jobs\/view\/[^/]*?(\d{6,})/)
          const resultJobId = resultJobIdMatch ? resultJobIdMatch[1] : null

          const matchesJobId = jobId && resultJobId && jobId === resultJobId
          const matchesUrl = resultUrl === url || resultUrl.split('?')[0] === url.split('?')[0]
          const matchesLinkedinUrl = resultLinkedinUrl === url || resultLinkedinUrl.split('?')[0] === url.split('?')[0]
          const matchesCompany = data.lastApplyResult.company === job.company
          const isExternalResult = data.lastApplyResult.status === 'applied_external' || data.lastApplyResult.atsType
          const isPendingExternal = data.lastApplyResult.status === 'pending_external'

          if (matchesJobId || matchesUrl || matchesLinkedinUrl || (isExternalResult && matchesCompany) || (isPendingExternal && matchesCompany)) {
            // ─── FIX: pending_external is NOT a final result ───
            // linkedin-apply.js reports this when the external Apply button was clicked
            // but ats-apply.js hasn't filled/submitted the form yet. We must keep polling
            // until ats-apply.js overwrites lastApplyResult with the real status.
            if (isPendingExternal) {
              if (!pendingExternalSince) {
                pendingExternalSince = Date.now()
                console.log('[JobTracker] [DIAG] pending_external detected at attempt', attempts, '— waiting for ats-apply.js to report real result')
                // Clear the interim result so the next poll waits for ats-apply.js to write
                await chrome.storage.local.remove('lastApplyResult')
              } else {
                const atsElapsed = ((Date.now() - pendingExternalSince) / 1000).toFixed(1)
                if (attempts % 10 === 0) {
                  console.log('[JobTracker] [DIAG] Still waiting for ATS result (' + atsElapsed + 's since pending_external)')
                }
                // Secondary timeout: if ats-apply.js doesn't produce a result within 60s
                // after we got pending_external, report needs_manual so the user can check
                if (Date.now() - pendingExternalSince > 60000) {
                  console.warn('[JobTracker] ATS apply timeout — 60s since pending_external, no final result from ats-apply.js')
                  await chrome.storage.local.remove('lastApplyResult')
                  await chrome.storage.local.remove('pendingExternalApply')
                  await cleanupTab()
                  await cleanupAtsTabs()
                  return {
                    success: false,
                    status: 'needs_manual',
                    reason: 'External ATS form opened but ats-apply.js did not report a result within 60s — check the ATS tab manually',
                    company: job.company,
                    role: job.role || '',
                    requestId,
                  }
                }
              }
              // Keep polling — don't return pending_external as a final result
              attempts++
              continue
            }

            const totalTime = ((Date.now() - tabCreatedAt) / 1000).toFixed(1)
            console.log('[JobTracker] [DIAG] Result matched at attempt', attempts, '(' + totalTime + 's total) — matched by:', matchesJobId ? 'jobId' : matchesUrl ? 'url' : matchesLinkedinUrl ? 'linkedinUrl' : 'company', '— status:', data.lastApplyResult.status)
            const result = { ...data.lastApplyResult, requestId }
            await chrome.storage.local.remove('lastApplyResult')
            await chrome.storage.local.remove('pendingExternalApply')

            console.log('[JobTracker] Result for', job.company, ':', result.status, '-', result.reason)

            // Always close the LinkedIn tab/window after processing (success or failure)
            await cleanupTab()
            // Close any ATS tabs opened by external apply (Greenhouse, SmartRecruiters, etc.)
            await cleanupAtsTabs()

            return result
          }
        }
        attempts++
      }

      // Clean up on timeout — always close the tab + any ATS tabs
      const timeoutElapsed = ((Date.now() - tabCreatedAt) / 1000).toFixed(1)
      console.warn('[JobTracker] [DIAG] Timeout for', job.company, 'after', timeoutElapsed + 's — closing tab')
      await cleanupTab()
      await cleanupAtsTabs()
      await chrome.storage.local.remove('pendingExternalApply')
      await chrome.storage.local.remove('lastApplyResult')
      return { success: false, status: 'timeout', error: 'Apply timed out after ' + timeoutElapsed + ' seconds', requestId }
    }

    // ─── Sync User Profile ─────────────────────────────────────────
    if (message.action === 'syncProfile') {
      const profileData = message.profileData
      if (!profileData || typeof profileData !== 'object') {
        return { success: false, error: 'No profile data provided' }
      }
      await chrome.storage.local.set({ userProfile: profileData })
      console.log('[JobTracker] User profile synced to storage:', Object.keys(profileData).join(', '))
      return { success: true }
    }

    // ─── Direct ATS Apply (no LinkedIn redirect) ────────────────────
    if (message.action === 'applyAtsDirectly') {
      const job = message.jobData
      const requestId = message.requestId || null
      if (!job?.url) {
        return { success: false, status: 'error', error: 'No ATS URL provided', requestId }
      }

      let atsUrl = job.url
      const jobBoard = detectJobBoard(atsUrl)

      // ─── Job Board Redirect Flow ──────────────────────────────────
      // If the URL is a job board (not an ATS), open the listing page,
      // click the "Apply" button, and follow the redirect to the real ATS.
      if (jobBoard) {
        console.log('[JobTracker] Job board detected:', jobBoard, '| URL:', atsUrl, '| Company:', job.company, '| requestId:', requestId)

        // Clear stale state
        await chrome.storage.local.remove('lastApplyResult')
        await chrome.storage.local.remove('atsApplyContext')
        await chrome.storage.local.remove('atsApplyRunning')
        await chrome.storage.local.remove('atsApplyForceRerun')

        // Step 1: Open job board page in a new window
        let boardTab
        let boardWindowId = null
        try {
          const win = await chrome.windows.create({
            url: atsUrl,
            width: 1400,
            height: 900,
            focused: true,
            type: 'normal',
          })
          boardTab = win.tabs[0]
          boardWindowId = win.id
          console.log('[JobTracker] [JobBoard] Window created:', win.id, 'tab:', boardTab.id)
        } catch (winErr) {
          try {
            boardTab = await chrome.tabs.create({ url: atsUrl, active: false })
          } catch (tabErr) {
            return { success: false, status: 'error', error: 'Failed to open job board: ' + (winErr.message || tabErr.message), requestId }
          }
        }

        const boardTabCreatedAt = Date.now()

        async function cleanupBoardTab() {
          try { await chrome.tabs.remove(boardTab.id) } catch {}
          if (boardWindowId) {
            try { await chrome.windows.remove(boardWindowId) } catch {}
          }
        }

        // Step 2: Wait for job board page to load
        const boardLoadResult = await new Promise((resolve) => {
          const LOAD_TIMEOUT = 20000
          let settled = false

          function settle(result) {
            if (settled) return
            settled = true
            chrome.tabs.onUpdated.removeListener(onUpdate)
            clearTimeout(timer)
            resolve(result)
          }

          function onUpdate(tabId, changeInfo, updatedTab) {
            if (tabId !== boardTab.id) return
            if (changeInfo.status === 'complete') {
              const loadTime = ((Date.now() - boardTabCreatedAt) / 1000).toFixed(1)
              console.log('[JobTracker] [JobBoard] Tab loaded in', loadTime + 's — URL:', updatedTab.url)
              settle({ loaded: true, finalUrl: updatedTab.url || '' })
            }
          }

          chrome.tabs.onUpdated.addListener(onUpdate)

          chrome.tabs.get(boardTab.id).then(currentTab => {
            if (currentTab.status === 'complete') {
              settle({ loaded: true, finalUrl: currentTab.url || '' })
            }
          }).catch(() => {})

          const timer = setTimeout(() => {
            console.warn('[JobTracker] [JobBoard] Tab did not load within 20s — proceeding anyway')
            settle({ loaded: false, finalUrl: '' })
          }, LOAD_TIMEOUT)
        })

        // Wait for page to fully render (SPAs, lazy load)
        await new Promise(r => setTimeout(r, 3000))

        // Step 3: Find and click the "Apply" button on the job board page
        let applyResult = null
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: boardTab.id },
            func: jobBoardClickApplyScript,
          })
          applyResult = results?.[0]?.result || null
          console.log('[JobTracker] [JobBoard] Apply button script result:', applyResult)
        } catch (clickErr) {
          console.warn('[JobTracker] [JobBoard] Apply button script failed:', clickErr.message)
          await cleanupBoardTab()
          return { success: false, status: 'needs_manual', reason: 'Could not find Apply button on ' + jobBoard + ' page: ' + clickErr.message, company: job.company, role: job.role || '', requestId }
        }

        if (!applyResult) {
          console.warn('[JobTracker] [JobBoard] No Apply button found on', jobBoard, 'page')
          await cleanupBoardTab()
          return { success: false, status: 'needs_manual', reason: 'No Apply button found on ' + jobBoard + ' job listing page', company: job.company, role: job.role || '', requestId }
        }

        // Step 4: If the result is a URL (from an <a> tag), navigate to it.
        // If 'clicked', the page should navigate via the button click.
        if (applyResult !== 'clicked' && applyResult.startsWith('http')) {
          // Direct URL found — navigate the tab there
          console.log('[JobTracker] [JobBoard] Navigating to Apply URL:', applyResult)
          try {
            await chrome.tabs.update(boardTab.id, { url: applyResult })
          } catch (navErr) {
            console.warn('[JobTracker] [JobBoard] Navigation failed:', navErr.message)
          }
        }

        // Step 5: Wait for the tab to navigate away from the job board to an ATS domain.
        // Listen for URL changes on this tab. Timeout after 30s.
        const resolvedAtsUrl = await new Promise((resolve) => {
          const REDIRECT_TIMEOUT = 30000
          let settled = false
          const startedAt = Date.now()

          function settle(result) {
            if (settled) return
            settled = true
            chrome.tabs.onUpdated.removeListener(onRedirect)
            clearTimeout(timer)
            resolve(result)
          }

          function onRedirect(tabId, changeInfo, updatedTab) {
            if (tabId !== boardTab.id) return
            // Check URL changes (even before complete — catch redirects early)
            const newUrl = changeInfo.url || updatedTab.url || ''
            if (!newUrl) return

            // Did we leave the job board domain?
            const stillOnJobBoard = detectJobBoard(newUrl)
            if (stillOnJobBoard) return // Still on the job board, keep waiting

            // Check if the new URL is an ATS
            const newAtsType = detectAtsType(newUrl)
            if (newAtsType) {
              const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
              console.log('[JobTracker] [JobBoard] Redirected to ATS in', elapsed + 's:', newAtsType, '—', newUrl)
              // Wait for the page to actually finish loading before resolving
              if (changeInfo.status === 'complete') {
                settle(newUrl)
              } else {
                // Set up a secondary listener for 'complete' on this URL
                const waitForComplete = (tid, ci) => {
                  if (tid !== boardTab.id) return
                  if (ci.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(waitForComplete)
                    settle(newUrl)
                  }
                }
                chrome.tabs.onUpdated.addListener(waitForComplete)
                // Safety: if complete never fires, resolve after 10s
                setTimeout(() => {
                  chrome.tabs.onUpdated.removeListener(waitForComplete)
                  settle(newUrl)
                }, 10000)
              }
            } else if (!stillOnJobBoard && newUrl.startsWith('http') && changeInfo.status === 'complete') {
              // Landed on an unknown external page (not a known ATS, not the job board).
              // This could be a company careers page with a generic form.
              const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
              console.log('[JobTracker] [JobBoard] Redirected to external (generic) in', elapsed + 's:', newUrl)
              settle(newUrl)
            }
          }

          chrome.tabs.onUpdated.addListener(onRedirect)

          // Also check current URL immediately (redirect may have already happened)
          chrome.tabs.get(boardTab.id).then(currentTab => {
            if (currentTab.url && !detectJobBoard(currentTab.url) && currentTab.url !== atsUrl) {
              const newAtsType = detectAtsType(currentTab.url)
              if (newAtsType || currentTab.status === 'complete') {
                settle(currentTab.url)
              }
            }
          }).catch(() => {})

          const timer = setTimeout(() => {
            console.warn('[JobTracker] [JobBoard] No redirect detected within 30s')
            settle(null)
          }, REDIRECT_TIMEOUT)
        })

        if (!resolvedAtsUrl) {
          console.warn('[JobTracker] [JobBoard] Failed to resolve ATS URL from', jobBoard, '— no redirect detected')
          await cleanupBoardTab()
          return { success: false, status: 'needs_manual', reason: 'Job board Apply button did not redirect to a known ATS within 30s', company: job.company, role: job.role || '', requestId }
        }

        // Step 6: We are now on the ATS page. Update atsUrl and continue
        // with the normal ATS apply flow below (reusing the same tab).
        console.log('[JobTracker] [JobBoard] Resolved ATS URL:', resolvedAtsUrl, '— proceeding with ATS apply flow')
        atsUrl = resolvedAtsUrl

        const resolvedAtsType = detectAtsType(atsUrl) || 'generic'

        // Wait for the ATS page to finish rendering
        await new Promise(r => setTimeout(r, 2000))

        // Set atsApplyContext for the resolved ATS page
        await chrome.storage.local.set({
          atsApplyContext: {
            company: job.company || 'Unknown',
            role: job.role || 'Unknown',
            url: job.url || '',
            linkedinUrl: job.linkedinUrl || '',
            atsType: resolvedAtsType,
            atsUrl: atsUrl,
            tabId: boardTab.id,
          }
        })
        await chrome.storage.local.remove('atsApplyRunning')

        // Inject ats-apply.js on the ATS page
        try {
          await chrome.storage.local.set({ atsApplyForceRerun: true })
          await chrome.scripting.executeScript({
            target: { tabId: boardTab.id },
            files: ['ats-apply.js'],
          })
          console.log('[JobTracker] [JobBoard] ats-apply.js injected on', resolvedAtsType, '(tab:', boardTab.id, ')')
        } catch (injectErr) {
          console.warn('[JobTracker] [JobBoard] ats-apply.js injection failed:', injectErr.message)
          await chrome.storage.local.remove('atsApplyForceRerun')
          await cleanupBoardTab()
          return { success: false, status: 'failed', error: 'Redirected to ATS but failed to inject ats-apply.js: ' + injectErr.message, requestId }
        }

        // Poll for result (same pattern as normal ATS apply)
        let boardAttempts = 0
        const boardMaxAttempts = 90

        while (boardAttempts < boardMaxAttempts) {
          await new Promise(r => setTimeout(r, 1000))

          const data = await chrome.storage.local.get(['lastApplyResult'])
          if (boardAttempts % 10 === 0 && boardAttempts > 0) {
            const elapsed = ((Date.now() - boardTabCreatedAt) / 1000).toFixed(1)
            console.log('[JobTracker] [JobBoard] ATS poll #' + boardAttempts + ' (' + elapsed + 's) — result:', data.lastApplyResult ? data.lastApplyResult.status : 'none')
          }

          if (data.lastApplyResult) {
            const matchesCompany = data.lastApplyResult.company === (job.company || 'Unknown')
            const matchesAts = data.lastApplyResult.atsType === resolvedAtsType

            if (matchesCompany || matchesAts) {
              const totalTime = ((Date.now() - boardTabCreatedAt) / 1000).toFixed(1)
              console.log('[JobTracker] [JobBoard] ATS result at attempt', boardAttempts, '(' + totalTime + 's) — status:', data.lastApplyResult.status)
              const result = { ...data.lastApplyResult, requestId, jobBoard }
              await chrome.storage.local.remove('lastApplyResult')
              await chrome.storage.local.remove('atsApplyContext')
              await chrome.storage.local.remove('atsApplyRunning')
              await chrome.storage.local.remove('atsApplyForceRerun')

              console.log('[JobTracker] [JobBoard] Result for', job.company, ':', result.status, '-', result.reason)
              await cleanupBoardTab()
              return result
            }
          }
          boardAttempts++
        }

        // Timeout
        const boardTimeoutElapsed = ((Date.now() - boardTabCreatedAt) / 1000).toFixed(1)
        console.warn('[JobTracker] [JobBoard] Timeout for', job.company, 'after', boardTimeoutElapsed + 's (job board:', jobBoard, ')')
        await cleanupBoardTab()
        await chrome.storage.local.remove('atsApplyContext')
        await chrome.storage.local.remove('lastApplyResult')
        await chrome.storage.local.remove('atsApplyRunning')
        await chrome.storage.local.remove('atsApplyForceRerun')
        return { success: false, status: 'timeout', error: 'ATS apply via job board redirect timed out after ' + boardTimeoutElapsed + ' seconds', requestId, jobBoard }
      }
      // ─── End Job Board Redirect Flow ──────────────────────────────

      const atsType = detectAtsType(atsUrl)
      if (!atsType) {
        return { success: false, status: 'error', error: 'URL does not match any known ATS pattern: ' + atsUrl, requestId }
      }

      console.log('[JobTracker] Direct ATS apply:', job.company, '| ATS:', atsType, '| URL:', atsUrl, '| requestId:', requestId)

      // Clear any stale lastApplyResult from a previous job
      const staleCheck = await chrome.storage.local.get(['lastApplyResult'])
      if (staleCheck.lastApplyResult) {
        console.log('[JobTracker] Clearing stale lastApplyResult from previous job:', staleCheck.lastApplyResult.company)
        await chrome.storage.local.remove('lastApplyResult')
      }

      // Set atsApplyContext BEFORE opening the tab so the manifest-injected
      // copy of ats-apply.js can find it immediately (avoids standalone fallback)
      await chrome.storage.local.set({
        atsApplyContext: {
          company: job.company || 'Unknown',
          role: job.role || 'Unknown',
          url: job.url || '',
          linkedinUrl: job.linkedinUrl || '',
          atsType: atsType,
          atsUrl: atsUrl,
        }
      })
      // Clear any stale execution guard from a previous run
      await chrome.storage.local.remove('atsApplyRunning')

      // Open ATS URL in a new focused window (same pattern as applyViaExtension)
      let tab
      let windowId = null
      try {
        const win = await chrome.windows.create({
          url: atsUrl,
          width: 1400,
          height: 900,
          focused: true,
          type: 'normal',
        })
        tab = win.tabs[0]
        windowId = win.id
        console.log('[JobTracker] ATS window created:', win.id, 'tab:', tab.id)
      } catch (winErr) {
        // Fallback: background tab
        try {
          tab = await chrome.tabs.create({ url: atsUrl, active: false })
        } catch (tabErr) {
          await chrome.storage.local.remove('atsApplyContext')
          return { success: false, status: 'error', error: 'Failed to open ATS URL: ' + (winErr.message || tabErr.message), requestId }
        }
      }

      const tabCreatedAt = Date.now()

      // Helper: close the tab + window (best effort)
      async function cleanupAtsTab() {
        try { await chrome.tabs.remove(tab.id) } catch {}
        if (windowId) {
          try { await chrome.windows.remove(windowId) } catch {}
        }
      }

      // Wait for page load (event-driven with 20s timeout, same as applyViaExtension)
      const tabLoadResult = await new Promise((resolve) => {
        const LOAD_TIMEOUT = 20000
        let settled = false

        function settle(result) {
          if (settled) return
          settled = true
          chrome.tabs.onUpdated.removeListener(onUpdate)
          clearTimeout(timer)
          resolve(result)
        }

        function onUpdate(tabId, changeInfo, updatedTab) {
          if (tabId !== tab.id) return
          if (changeInfo.status === 'complete') {
            const loadTime = ((Date.now() - tabCreatedAt) / 1000).toFixed(1)
            console.log('[JobTracker] ATS tab', tab.id, 'loaded in', loadTime + 's — URL:', updatedTab.url)
            settle({ loaded: true, finalUrl: updatedTab.url || '' })
          }
        }

        chrome.tabs.onUpdated.addListener(onUpdate)

        // Race condition guard: tab might already be complete
        chrome.tabs.get(tab.id).then(currentTab => {
          if (currentTab.status === 'complete') {
            settle({ loaded: true, finalUrl: currentTab.url || '' })
          }
        }).catch(() => {})

        const timer = setTimeout(() => {
          console.warn('[JobTracker] ATS tab', tab.id, 'did not reach complete within 20s — proceeding anyway')
          settle({ loaded: false, finalUrl: '' })
        }, LOAD_TIMEOUT)
      })

      // Post-load delay for ATS page rendering
      await new Promise(r => setTimeout(r, 2000))

      // Detect ATS type from the final URL (may differ after redirects)
      const finalAtsType = detectAtsType(tabLoadResult.finalUrl || atsUrl) || atsType

      // Update atsApplyContext with final URL info and tabId (post-redirect)
      await chrome.storage.local.set({
        atsApplyContext: {
          company: job.company || 'Unknown',
          role: job.role || 'Unknown',
          url: job.url || '',
          linkedinUrl: job.linkedinUrl || '',
          atsType: finalAtsType,
          atsUrl: tabLoadResult.finalUrl || atsUrl,
          tabId: tab.id,
        }
      })

      // Force re-run: set the flag so ats-apply.js re-executes even if the
      // manifest-injected copy already ran (and set the atsApplyRunning guard).
      // Then clear the guard and inject programmatically.
      try {
        await chrome.storage.local.set({ atsApplyForceRerun: true })
        await chrome.storage.local.remove('atsApplyRunning')
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['ats-apply.js'],
        })
        console.log('[JobTracker] ats-apply.js injected for direct ATS apply on', finalAtsType)
      } catch (injectErr) {
        console.warn('[JobTracker] ats-apply.js injection failed:', injectErr.message)
        await chrome.storage.local.remove('atsApplyForceRerun')
        await cleanupAtsTab()
        return { success: false, status: 'failed', error: 'Failed to inject ats-apply.js: ' + injectErr.message, requestId }
      }

      // Poll for result (ats-apply.js stores it in chrome.storage.local.lastApplyResult)
      let attempts = 0
      const maxAttempts = 90 // 90 seconds max for ATS form fill + submit

      while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 1000))

        const data = await chrome.storage.local.get(['lastApplyResult'])
        if (attempts % 10 === 0 && attempts > 0) {
          const elapsed = ((Date.now() - tabCreatedAt) / 1000).toFixed(1)
          console.log('[JobTracker] ATS poll #' + attempts + ' (' + elapsed + 's) — result:', data.lastApplyResult ? data.lastApplyResult.status : 'none')
        }

        if (data.lastApplyResult) {
          // Match by company name or ATS type (direct ATS has no LinkedIn URL to match)
          const matchesCompany = data.lastApplyResult.company === (job.company || 'Unknown')
          const matchesAts = data.lastApplyResult.atsType === finalAtsType

          if (matchesCompany || matchesAts) {
            const totalTime = ((Date.now() - tabCreatedAt) / 1000).toFixed(1)
            console.log('[JobTracker] ATS result at attempt', attempts, '(' + totalTime + 's) — status:', data.lastApplyResult.status)
            const result = { ...data.lastApplyResult, requestId }
            await chrome.storage.local.remove('lastApplyResult')
            await chrome.storage.local.remove('atsApplyContext')
            await chrome.storage.local.remove('atsApplyRunning')
            await chrome.storage.local.remove('atsApplyForceRerun')

            console.log('[JobTracker] Direct ATS result for', job.company, ':', result.status, '-', result.reason)
            await cleanupAtsTab()
            return result
          }
        }
        attempts++
      }

      // Timeout — clean up
      const timeoutElapsed = ((Date.now() - tabCreatedAt) / 1000).toFixed(1)
      console.warn('[JobTracker] Direct ATS timeout for', job.company, 'after', timeoutElapsed + 's')
      await cleanupAtsTab()
      await chrome.storage.local.remove('atsApplyContext')
      await chrome.storage.local.remove('lastApplyResult')
      await chrome.storage.local.remove('atsApplyRunning')
      await chrome.storage.local.remove('atsApplyForceRerun')
      return { success: false, status: 'timeout', error: 'ATS apply timed out after ' + timeoutElapsed + ' seconds', requestId }
    }

    if (message.action === 'reloadExtension') {
      console.log('[JobTracker] Extension self-reload requested')
      chrome.runtime.reload()
      return { success: true }
    }

    // ─── CDP Debugger Session Management (for React-Select dropdowns) ──
    // React-Select only responds to isTrusted:true mouse events.
    // Content scripts can only dispatch isTrusted:false synthetic events.
    // These handlers use chrome.debugger CDP Input.dispatchMouseEvent
    // for real browser-level trusted clicks.
    //
    // Flow: debuggerAttach → trustedClick (×N) → debuggerDetach
    // This keeps the debugger attached for the entire form-fill session,
    // avoiding repeated attach/detach overhead and info bar flicker.

    if (message.action === 'debuggerAttach') {
      const tid = message.tabId || _sender.tab?.id
      if (!tid) return { success: false, error: 'No tabId' }
      try {
        await chrome.debugger.attach({ tabId: tid }, '1.3')
        console.log('[JobTracker] Debugger attached to tab', tid)
        return { success: true, tabId: tid }
      } catch (e) {
        // Already attached? That's fine
        if (e.message?.includes('Already attached')) return { success: true, tabId: tid }
        return { success: false, error: e.message }
      }
    }

    if (message.action === 'debuggerDetach') {
      const tid = message.tabId || _sender.tab?.id
      if (!tid) return { success: false, error: 'No tabId' }
      try {
        await chrome.debugger.detach({ tabId: tid })
        console.log('[JobTracker] Debugger detached from tab', tid)
      } catch (e) { /* ignore detach errors */ }
      return { success: true }
    }

    if (message.action === 'trustedKeypress') {
      const { key, code, keyCode } = message
      const tid = message.tabId || _sender.tab?.id
      if (!tid) return { success: false, error: 'No tabId' }
      console.log('[JobTracker] trustedKeypress:', key, 'on tab', tid)

      async function doKeypress(debuggee, key, code, keyCode) {
        await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
          type: 'keyDown', key: key || 'Escape', code: code || 'Escape',
          windowsVirtualKeyCode: keyCode || 27, nativeVirtualKeyCode: keyCode || 27
        })
        await chrome.debugger.sendCommand(debuggee, 'Input.dispatchKeyEvent', {
          type: 'keyUp', key: key || 'Escape', code: code || 'Escape',
          windowsVirtualKeyCode: keyCode || 27, nativeVirtualKeyCode: keyCode || 27
        })
      }

      try {
        await doKeypress({ tabId: tid }, key, code, keyCode)
        console.log('[JobTracker] trustedKeypress succeeded')
        return { success: true }
      } catch (e) {
        console.warn('[JobTracker] trustedKeypress failed:', e.message)
        // Auto-attach debugger if needed
        if (e.message?.includes('not attached') || e.message?.includes('Debugger is not attached')) {
          try {
            await chrome.debugger.attach({ tabId: tid }, '1.3')
            console.log('[JobTracker] Auto-attached debugger for trustedKeypress on tab', tid)
            await new Promise(r => setTimeout(r, 200))
            await doKeypress({ tabId: tid }, key, code, keyCode)
            console.log('[JobTracker] trustedKeypress succeeded after auto-attach')
            return { success: true }
          } catch (e2) {
            console.error('[JobTracker] trustedKeypress failed after auto-attach:', e2.message)
            return { success: false, error: e2.message }
          }
        }
        return { success: false, error: e.message }
      }
    }

    if (message.action === 'trustedClick') {
      const { x, y } = message
      const tid = message.tabId || _sender.tab?.id
      if (!tid) return { success: false, error: 'No tabId' }
      console.log('[JobTracker] trustedClick at (' + x + ',' + y + ') on tab', tid)

      async function doMouseClick(debuggee, x, y) {
        // Full mouse event sequence: move → press → release
        // Some React handlers need mouseMoved to register hover state before click
        await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved', x, y
        })
        await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
          type: 'mousePressed', x, y, button: 'left', clickCount: 1
        })
        await chrome.debugger.sendCommand(debuggee, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased', x, y, button: 'left', clickCount: 1
        })
      }

      try {
        const debuggee = { tabId: tid }
        await doMouseClick(debuggee, x, y)
        console.log('[JobTracker] trustedClick succeeded (debugger was attached)')
        return { success: true }
      } catch (e) {
        console.warn('[JobTracker] trustedClick first try failed:', e.message)
        // If debugger not attached, try auto-attach
        if (e.message?.includes('not attached') || e.message?.includes('Debugger is not attached')) {
          try {
            await chrome.debugger.attach({ tabId: tid }, '1.3')
            console.log('[JobTracker] Auto-attached debugger to tab', tid, 'for trustedClick')
            // Wait a beat for debugger bar to render (shifts viewport)
            await new Promise(r => setTimeout(r, 200))
            await doMouseClick({ tabId: tid }, x, y)
            console.log('[JobTracker] trustedClick succeeded after auto-attach')
            return { success: true }
          } catch (e2) {
            console.error('[JobTracker] trustedClick failed after auto-attach:', e2.message)
            return { success: false, error: e2.message }
          }
        }
        return { success: false, error: e.message }
      }
    }

    // ─── Greenhouse Security Code via Gmail ──────────────────────────
    // After Greenhouse submit, a security code is emailed to the user.
    // This handler reads the code from Gmail and returns it.
    if (message.action === 'getGreenhouseSecurityCode') {
      console.log('[JobTracker] Fetching Greenhouse security code from Gmail...')

      const codePatterns = [
        /application:\s*([A-Za-z0-9]{8})/,
        /([A-Za-z0-9]{8})\s*After you enter/,
        /security code.*?:\s*([A-Za-z0-9]{8})/i,
      ]

      function extractCode(text) {
        for (const p of codePatterns) {
          const m = text.match(p)
          if (m) return m[1]
        }
        return null
      }

      // Method 1: Fetch Gmail basic HTML search (fast, no tab)
      try {
        const q = encodeURIComponent('from:no-reply@us.greenhouse-mail.io security code newer_than:10m')
        const resp = await fetch(
          `https://mail.google.com/mail/u/0/h/?s=q&q=${q}&search=query`,
          { credentials: 'include', redirect: 'follow' }
        )
        if (resp.ok) {
          const html = await resp.text()
          const code = extractCode(html)
          if (code) {
            console.log('[JobTracker] Security code from Gmail fetch:', code)
            return { success: true, code, method: 'fetch_basic' }
          }
          console.log('[JobTracker] Gmail fetch OK but no code found in HTML, trying tab method...')
        } else {
          console.warn('[JobTracker] Gmail fetch status:', resp.status)
        }
      } catch (fetchErr) {
        console.warn('[JobTracker] Gmail fetch error:', fetchErr.message)
      }

      // Method 2: Open Gmail tab in background and scrape
      try {
        const searchUrl = 'https://mail.google.com/mail/u/0/#search/from%3Agreenhouse-mail.io+newer_than%3A5m'
        const tab = await chrome.tabs.create({ url: searchUrl, active: false })

        // Wait for tab to finish loading
        await new Promise((resolve) => {
          const timeout = setTimeout(resolve, 20000)
          const listener = (tabId, changeInfo) => {
            if (tabId === tab.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener)
              clearTimeout(timeout)
              resolve()
            }
          }
          chrome.tabs.onUpdated.addListener(listener)
        })

        // Gmail SPA needs extra time to render search results
        await new Promise(r => setTimeout(r, 5000))

        // Scrape the page text for the security code
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const text = document.body?.innerText || ''
            const patterns = [
              /application:\s*([A-Za-z0-9]{8})/,
              /([A-Za-z0-9]{8})\s*After you enter/,
              /security code.*?:\s*([A-Za-z0-9]{8})/i,
            ]
            for (const p of patterns) {
              const m = text.match(p)
              if (m) return m[1]
            }
            return null
          },
        })

        let code = results?.[0]?.result

        // If not found in list, try clicking the first email
        if (!code) {
          console.log('[JobTracker] Code not in list view, clicking first email...')
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const row = document.querySelector('tr.zA, [data-legacy-thread-id], .xT a')
              if (row) row.click()
            },
          })
          await new Promise(r => setTimeout(r, 3000))

          const emailResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const text = document.body?.innerText || ''
              const m = text.match(/application:\s*([A-Za-z0-9]{8})/)
                || text.match(/([A-Za-z0-9]{8})\s*After you enter/)
              return m ? m[1] : null
            },
          })
          code = emailResults?.[0]?.result
        }

        // Clean up Gmail tab
        try { await chrome.tabs.remove(tab.id) } catch {}

        if (code) {
          console.log('[JobTracker] Security code from Gmail tab:', code)
          return { success: true, code, method: 'tab_scrape' }
        }
      } catch (tabErr) {
        console.warn('[JobTracker] Gmail tab scrape error:', tabErr.message)
      }

      return { success: false, error: 'Could not extract security code from Gmail' }
    }

    return { success: false, error: 'Unknown action' }
  }

  handle().then(sendResponse).catch(err => {
    console.error('[JobTracker]', err)
    sendResponse({ success: false, error: err.message })
  })

  return true // keep channel open for async
})
