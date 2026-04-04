/**
 * JobTracker — ATS Auto-Apply Content Script v2.6.0
 *
 * Injected on external career pages (Greenhouse, Lever, Workable, etc.)
 * after the user clicks "Apply on company website" from LinkedIn.
 *
 * Reads atsApplyContext from chrome.storage.local, detects ATS type,
 * fills the form, uploads CV, and submits.
 *
 * v2.0.0: Smart Greenhouse handler, validation-aware submit, retry on errors
 *
 * SECURITY: Runs in the user's own browser with their own IP and cookies.
 */

// ─── Profile Data (defaults, overridden by stored userProfile) ───────

// IMPORTANT: These defaults are overridden by the profile synced from the dashboard
// via chrome.storage.local (see loadProfile below). They serve as last-resort fallbacks
// only when no profile has been synced. Avoid putting real PII here — use the dashboard
// profile sync instead.
const PROFILE_DEFAULTS = {
  firstName: '',
  lastName: '',
  fullName: '',
  email: '',
  phone: '',
  portfolio: '',
  linkedin: '',
  city: '',
  country: '',
  yearsExperience: '',
  salary: '',
  currentTitle: '',
  cvUrl: '',
  cvFilename: 'CV.pdf',
}

let PROFILE = { ...PROFILE_DEFAULTS }

async function loadProfile() {
  try {
    const data = await chrome.storage.local.get(['userProfile'])
    if (data.userProfile && typeof data.userProfile === 'object') {
      PROFILE = { ...PROFILE_DEFAULTS, ...data.userProfile }
      console.log('[JobTracker ATS] Profile loaded from storage — keys:', Object.keys(data.userProfile).join(', '))
    } else {
      console.log('[JobTracker ATS] No stored profile — using defaults')
    }
  } catch (err) {
    console.warn('[JobTracker ATS] Failed to load profile from storage:', err.message, '— using defaults')
  }
}

// ─── Config ───────────────────────────────────────────────────────────

const ATS_CONFIG = {
  maxAttempts: 15,          // Max form pages / retries
  stepDelay: { min: 1200, max: 2500 },
  typeDelay: { min: 25, max: 70 },
  clickDelay: { min: 300, max: 700 },
  pageLoadWait: 3000,       // Wait for ATS page to fully render
  cvFetchTimeout: 15000,    // CV download timeout
}

// ─── Utility Functions ────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function randomDelay(min, max) {
  return sleep(min + Math.random() * (max - min))
}

const _debugLog = []
function log(...args) {
  console.log('[JobTracker ATS]', ...args)
  _debugLog.push('[LOG] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
}

function warn(...args) {
  console.warn('[JobTracker ATS]', ...args)
  _debugLog.push('[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
}

// Human-like typing into an input field
async function humanType(input, text) {
  if (!input || !text) return
  input.focus()
  input.value = ''
  input.dispatchEvent(new Event('focus', { bubbles: true }))
  input.dispatchEvent(new Event('input', { bubbles: true }))

  for (const char of text) {
    input.value += char
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }))
    await randomDelay(ATS_CONFIG.typeDelay.min, ATS_CONFIG.typeDelay.max)
  }

  input.dispatchEvent(new Event('change', { bubbles: true }))
  input.dispatchEvent(new Event('blur', { bubbles: true }))
}

// Set value using React-compatible setter (for React-based ATS like Lever, Ashby)
function setReactValue(input, value) {
  // Pick the setter that matches the element type — calling the wrong one
  // (e.g. HTMLInputElement setter on a <textarea>) throws "Illegal invocation".
  const proto = input.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set

  if (nativeSetter) {
    nativeSetter.call(input, value)
  } else {
    input.value = value
  }

  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

// ─── React Internal Props Access (from job_app_filler benchmark) ──────
// React stores internal props on DOM elements as __reactProps$... keys.
// This allows direct invocation of React event handlers, bypassing browser events.
function getReactProps(element) {
  if (!element) return null
  for (const key in element) {
    if (key.startsWith('__reactProps')) return element[key]
  }
  return null
}

// Set value via React internal props (strongest method for React ATS)
function setValueViaReact(input, value) {
  const props = getReactProps(input)
  if (props?.onChange) {
    // Set the actual value first
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set
    if (nativeSetter) nativeSetter.call(input, value)
    else input.value = value

    // Call React's internal onChange
    props.onChange({ target: input })
    // Also call onBlur for fields with validation (Workday pattern)
    if (props.onBlur) props.onBlur({ target: input })
    return true
  }
  return false
}

// ─── Select2 Dropdown Handling (Greenhouse Classic) ──────────────────
// Greenhouse Classic uses jQuery Select2 for dropdowns, NOT native <select>.
// Must interact with the Select2 widget: mousedown to open, mouseup to select.

async function handleSelect2Dropdown(selectElement, searchText, optionTexts) {
  // Find the Select2 container associated with this <select>
  const containerId = 's2id_' + selectElement.id
  let container = document.getElementById(containerId)
  if (!container) {
    // Try finding it as a sibling
    container = selectElement.closest('.field')?.querySelector('.select2-container')
  }
  if (!container) {
    log('No Select2 container found for:', selectElement.id)
    return false
  }

  log('Found Select2 container:', containerId || 'sibling')

  // Open the dropdown by dispatching mousedown on the container's <a> element
  const trigger = container.querySelector('a, .select2-choice, .select2-selection')
  if (!trigger) {
    log('No Select2 trigger element found')
    return false
  }

  trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  await sleep(500)

  // If searchable, type into the search box
  const searchInput = document.querySelector('.select2-search input, .select2-input, #select2-drop input')
  if (searchInput && searchText) {
    searchInput.value = ''
    searchInput.focus()
    for (const char of searchText) {
      searchInput.value += char
      searchInput.dispatchEvent(new Event('input', { bubbles: true }))
      searchInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }))
      await sleep(80)
    }
    // Wait for search results (Select2 shows "Searching..." then results)
    await sleep(1500)
  }

  // Find and click the matching option
  const resultItems = document.querySelectorAll('.select2-results li, .select2-result-label, .select2-results .select2-result')
  for (const item of resultItems) {
    const text = item.textContent?.trim().toLowerCase() || ''
    for (const target of optionTexts) {
      if (text.includes(target.toLowerCase())) {
        item.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
        log('Select2: selected', item.textContent?.trim())
        await sleep(300)
        return true
      }
    }
  }

  // Close dropdown if nothing matched
  trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  log('Select2: no matching option found for:', optionTexts.join(', '))
  return false
}

// ─── React-Select Dropdown Handling (Greenhouse React) ───────────────
async function handleReactSelectDropdown(container, searchText, optionTexts) {
  // React-Select uses div[class*="select-shell"] or div[class*="css-"]
  const props = getReactProps(container)
  if (props?.onMouseUp) {
    props.onMouseUp({ defaultPrevented: false })
    await sleep(500)
  } else {
    // Fallback: click the container to open
    container.click()
    await sleep(500)
  }

  // If searchable, find the input and type
  const input = container.querySelector('input')
  if (input && searchText) {
    if (!setValueViaReact(input, searchText)) {
      setReactValue(input, searchText)
    }
    await sleep(1000)
  }

  // Find and click matching option
  const options = document.querySelectorAll('[class*="select__option"], [class*="option"], [role="option"]')
  for (const opt of options) {
    const text = opt.textContent?.trim().toLowerCase() || ''
    for (const target of optionTexts) {
      if (text.includes(target.toLowerCase())) {
        const optProps = getReactProps(opt)
        if (optProps?.onClick) {
          optProps.onClick({ preventDefault: () => {} })
        } else {
          opt.click()
        }
        log('React-Select: selected', opt.textContent?.trim())
        await sleep(300)
        return true
      }
    }
  }

  log('React-Select: no matching option found')
  return false
}

// ─── PDF Cover Letter Generator ──────────────────────────────────────
// Generates a minimal valid PDF with cover letter text, entirely in-browser.
function generateCoverLetterPDF(company, role, customText) {
  const text = customText || `Dear Hiring Manager,

I am writing to express my strong interest in the ${role} position at ${company}.

As a Senior Product Designer with 7+ years of experience, I specialize in design systems, complex product architecture, and design operations. My track record includes:

- Leading design for a #1 US poker product in the regulated iGaming space
- Improving development feedback cycles by 90% through design system governance
- Managing 143+ templates across 7 SaaS products with multi-brand consistency
- Building scalable design systems using Figma, Storybook, and Zeroheight

I am currently based in Bangkok and available to start immediately. I would welcome the opportunity to discuss how my experience aligns with your team's needs.

Portfolio: https://www.floriangouloubi.com/
LinkedIn: https://www.linkedin.com/in/floriangouloubi/

Best regards,
Florian Gouloubi`

  // Build minimal valid PDF with plain text
  const lines = text.split('\n')
  // PDF stream content: position text lines from top
  let streamContent = 'BT\n/F1 11 Tf\n'
  let y = 740
  for (const line of lines) {
    // Escape PDF special chars
    const safe = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
    streamContent += `1 0 0 1 72 ${y} Tm\n(${safe}) Tj\n`
    y -= 16
    if (y < 72) break // Stop before bottom margin
  }
  streamContent += 'ET'

  const streamBytes = new TextEncoder().encode(streamContent)
  const streamLen = streamBytes.length

  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length ${streamLen}>>
stream
${streamContent}
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000266 00000 n
${String(280 + streamLen).padStart(10, '0')} 00000 n
trailer<</Size 6/Root 1 0 R>>
startxref
${330 + streamLen}
%%EOF`

  const blob = new Blob([pdf], { type: 'application/pdf' })
  return new File([blob], `Cover_Letter_${company.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`, { type: 'application/pdf' })
}

// ─── Enhanced File Upload (DragEvent + React props) ──────────────────
async function uploadFileEnhanced(fileInput, file) {
  if (!fileInput || !file) return false

  // Method 1: Try React internal props (strongest for React ATS)
  const reactProps = getReactProps(fileInput)
  if (reactProps?.onChange) {
    log('Uploading via React onChange props')
    reactProps.onChange({ target: { files: [file] } })
    await sleep(1000)
    if (fileInput.files?.length > 0) return true
  }

  // Method 2: DataTransfer API (standard approach)
  log('Uploading via DataTransfer API')
  const dataTransfer = new DataTransfer()
  dataTransfer.items.add(file)
  fileInput.files = dataTransfer.files
  fileInput.dispatchEvent(new Event('change', { bubbles: true }))
  fileInput.dispatchEvent(new Event('input', { bubbles: true }))
  await sleep(500)
  if (fileInput.files?.length > 0) return true

  // Method 3: Fake DragEvent on drop zone (Greenhouse Classic)
  const dropZone = fileInput.closest('[class*="drop"], [class*="upload"], [class*="file"]')
    || fileInput.closest('.field')?.querySelector('[class*="drop"]')
  if (dropZone) {
    log('Uploading via DragEvent on drop zone')
    // React drop zone
    const dropProps = getReactProps(dropZone)
    if (dropProps?.onDrop) {
      dropProps.onDrop({
        dataTransfer: { files: [file] },
        preventDefault: () => {},
        stopPropagation: () => {},
      })
      await sleep(1000)
      return true
    }
    // Standard DragEvent
    const dropEvent = new DragEvent('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: { files: [file], items: [{ kind: 'file', type: file.type, getAsFile: () => file }] }
    })
    dropZone.dispatchEvent(dropEvent)
    await sleep(1000)
    return true
  }

  return false
}

// Find the label text for an input element
function getLabelText(input) {
  // Check aria-label
  const ariaLabel = input.getAttribute('aria-label') || ''
  // Check placeholder
  const placeholder = input.getAttribute('placeholder') || ''
  // Check associated <label>
  const id = input.getAttribute('id')
  const labelEl = id ? document.querySelector(`label[for="${id}"]`) : null
  const labelText = labelEl?.textContent || ''
  // Check parent label
  const parentLabel = input.closest('label')?.textContent || ''
  // Check nearby label in parent container (includes Lever custom-question / application-question)
  const container = input.closest('.field, .form-group, .form-field, [class*="field"], [class*="form"], .custom-question, .application-question, [class*="custom-question"], [class*="application-question"]')
  const nearbyLabel = container?.querySelector('label, .label, [class*="label"], .custom-question-title, .question-label')?.textContent || ''
  // Check name attribute
  const name = input.getAttribute('name') || ''

  return (ariaLabel + ' ' + placeholder + ' ' + labelText + ' ' + parentLabel + ' ' + nearbyLabel + ' ' + name).toLowerCase()
}

// Find a button matching any of the given text patterns
// Prioritizes: exact text match > contains match, and form-area buttons > header buttons
function findAndClickButton(texts) {
  const allClickables = document.querySelectorAll('button, input[type="submit"], a[role="button"], [class*="submit"], [class*="btn"]')
  let bestMatch = null
  let bestScore = -1

  for (const el of allClickables) {
    // Skip Claude MCP / browser extension injected buttons
    if (el.id && (el.id.includes('claude') || el.id.includes('mcp'))) continue
    if (el.closest('[id*="claude"], [id*="mcp"], [class*="claude"]')) continue

    // Skip invisible/hidden elements (offsetHeight 0 means not rendered or display:none)
    if (el.offsetHeight === 0 || el.offsetWidth === 0) continue
    // Skip elements hidden via CSS visibility or opacity
    const style = window.getComputedStyle(el)
    if (style.visibility === 'hidden' || style.opacity === '0' || style.display === 'none') continue
    // Skip disabled buttons
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue

    const text = (el.textContent || el.value || '').trim().toLowerCase()
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase()

    // Skip buttons with no visible text AND no aria-label (likely icon-only or phantom elements)
    if (!text && !ariaLabel) continue

    for (let i = 0; i < texts.length; i++) {
      const t = texts[i].toLowerCase()
      const matchesText = text.includes(t)
      const matchesAria = ariaLabel.includes(t)
      if (!matchesText && !matchesAria) continue

      // Score: lower index in texts array = higher priority (earlier = more specific)
      // Exact text match gets bonus, form-context button gets bonus
      let score = (texts.length - i) * 10
      if (text === t) score += 50                    // Exact match bonus
      if (el.type === 'submit') score += 30          // type="submit" bonus
      if (el.closest('form:not([id*="claude"])')) score += 20  // Inside a real form bonus
      if (el.closest('.application--submit, [class*="submit"], [class*="actions"]')) score += 15 // Submit area bonus

      if (score > bestScore) {
        bestScore = score
        bestMatch = el
      }
      break // Don't check remaining text patterns for this element
    }
  }
  return bestMatch
}

// ─── CV Upload Error Detection ───────────────────────────────────────
// After setting files on an input, check if the ATS displayed an error message
// (e.g. "File exceeds maximum upload size"). This catches cases where DataTransfer
// sets fileInput.files correctly but React's internal state rejects the file.

function _detectUploadError() {
  // Look for common error patterns near file inputs
  const errorSelectors = [
    '.error', '.error-message', '[class*="error"]', '[class*="Error"]',
    '[role="alert"]', '.invalid-feedback', '.field-error',
    '[class*="upload-error"]', '[class*="file-error"]',
    '.form-error', '.validation-error'
  ]
  for (const sel of errorSelectors) {
    const els = document.querySelectorAll(sel)
    for (const el of els) {
      const text = (el.textContent || '').trim()
      if (!text) continue
      // Only flag actual file/upload errors, not unrelated form validation
      if (text.toLowerCase().includes('file') ||
          text.toLowerCase().includes('upload') ||
          text.toLowerCase().includes('size') ||
          text.toLowerCase().includes('too large') ||
          text.toLowerCase().includes('exceed') ||
          text.toLowerCase().includes('maximum')) {
        return text
      }
    }
  }
  return null
}

// ─── CV Upload via fetch + DataTransfer ───────────────────────────────

async function fetchAndUploadCV(fileInput) {
  if (!fileInput) {
    log('No file input found for CV upload')
    return false
  }

  try {
    // Ensure cvUrl is available (may be empty after extension reinstall)
    if (!PROFILE.cvUrl) {
      try { const s = await chrome.storage.local.get(['userProfile']); if (s.userProfile?.cvUrl) PROFILE.cvUrl = s.userProfile.cvUrl } catch {}
    }
    if (!PROFILE.cvUrl) PROFILE.cvUrl = 'https://raw.githubusercontent.com/peterbono/portfolio/main/cvflo.pdf'
    log('Fetching CV from GitHub...', PROFILE.cvUrl)
    // Content scripts have their own fetch (not subject to page CSP)
    const response = await fetch(PROFILE.cvUrl)
    if (!response.ok) throw new Error(`CV fetch failed: ${response.status} ${response.statusText}`)

    const blob = await response.blob()
    log('CV fetched:', blob.size, 'bytes, type:', blob.type)

    // ── Sanity check: reject if file is unexpectedly large (corrupt fetch / redirect page) ──
    const MAX_CV_SIZE = 10 * 1024 * 1024 // 10 MB
    if (blob.size > MAX_CV_SIZE) {
      warn(`CV fetch returned ${blob.size} bytes (>${MAX_CV_SIZE}) — aborting upload (likely a redirect/error page)`)
      return false
    }
    if (blob.size < 1000) {
      warn(`CV fetch returned only ${blob.size} bytes — aborting upload (likely a 404 page)`)
      return false
    }

    // ── Force correct MIME type ──
    // GitHub raw serves as application/octet-stream — Lever/React may validate the
    // File.type property and reject or misinterpret non-PDF types.
    // Re-wrap the blob to guarantee type: 'application/pdf'.
    const pdfBlob = new Blob([blob], { type: 'application/pdf' })
    const file = new File([pdfBlob], PROFILE.cvFilename, {
      type: 'application/pdf',
      lastModified: Date.now()
    })
    log('File object created:', file.name, file.size, 'bytes, type:', file.type)

    // ── Build DataTransfer ──
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(file)

    // ── Method 1: React internal props (FIRST — most reliable for React ATS like Lever) ──
    // React attaches its own event system via __reactProps. Calling onChange directly
    // guarantees React's state updates, unlike native DOM events which React may ignore
    // on file inputs. This is why DataTransfer "worked" (set fileInput.files) but Lever
    // still showed the 100MB error: React's state never received the file.
    // Search for React onChange on the file input AND its ancestors (Lever puts it on a wrapper)
    let reactProps = getReactProps(fileInput)
    if (!reactProps?.onChange) {
      // Walk up to 5 ancestors looking for onChange
      let el = fileInput.parentElement
      for (let i = 0; i < 5 && el; i++) {
        const props = getReactProps(el)
        if (props?.onChange) { reactProps = props; break }
        el = el.parentElement
      }
    }
    if (reactProps?.onChange) {
      log('Found React props on file input — calling onChange directly...')
      // Set files on the DOM element first so React can read them
      fileInput.files = dataTransfer.files
      // Call React's onChange with a synthetic-like event object
      reactProps.onChange({
        target: fileInput,
        currentTarget: fileInput,
        type: 'change',
        bubbles: true,
        preventDefault: () => {},
        stopPropagation: () => {},
        nativeEvent: new Event('change', { bubbles: true })
      })
      await sleep(1000)

      // Check for error messages that indicate rejection
      const errorAfterReact = _detectUploadError()
      if (!errorAfterReact) {
        log('CV uploaded via React onChange props:', file.name, file.size, 'bytes')
        return true
      }
      warn('React onChange triggered but error detected:', errorAfterReact)
    }

    // ── Method 2: DataTransfer + native events (standard approach) ──
    log('Uploading CV via DataTransfer API...')
    fileInput.files = dataTransfer.files

    // Dispatch both Event and InputEvent — some React versions listen to one or the other
    // via their delegated event system at document root
    fileInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }))
    fileInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }))

    // Also try React's synthetic event trigger: React 16+ delegates to document/root,
    // so we simulate what happens when React's event handler fires
    const reactFiberKey = Object.keys(fileInput).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'))
    if (reactFiberKey) {
      log('Found React fiber — attempting simulated React event dispatch...')
      try {
        // React 17+ listens on the root container, not document
        const rootContainer = fileInput.closest('[data-reactroot]') || document.getElementById('root') || document.body
        const changeEvent = new Event('change', { bubbles: true, cancelable: true })
        Object.defineProperty(changeEvent, 'target', { writable: false, value: fileInput })
        rootContainer.dispatchEvent(changeEvent)
      } catch (e) {
        log('React fiber dispatch attempt failed (non-critical):', e.message)
      }
    }
    await sleep(1000)

    // Verify: check both that files are set AND no error message appeared
    const errorAfterDT = _detectUploadError()
    if (fileInput.files?.length > 0 && fileInput.files[0]?.size > 0 && !errorAfterDT) {
      log('CV uploaded successfully via DataTransfer:', PROFILE.cvFilename, fileInput.files[0].size, 'bytes')
      return true
    }
    if (errorAfterDT) {
      warn('DataTransfer set files but error detected:', errorAfterDT)
    }

    // ── Method 3: DragEvent on nearest drop zone ──
    log('Trying DragEvent on drop zone...')
    const dropZone = fileInput.closest('[class*="drop"], [class*="upload"], [class*="file"], .field')
      || fileInput.parentElement
    if (dropZone) {
      const dragEnterEvent = new DragEvent('dragenter', { bubbles: true, cancelable: true })
      const dragOverEvent = new DragEvent('dragover', { bubbles: true, cancelable: true })
      const dropEvent = new DragEvent('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {
          files: dataTransfer.files,
          items: [{ kind: 'file', type: 'application/pdf', getAsFile: () => file }],
          types: ['Files']
        }
      })
      dropZone.dispatchEvent(dragEnterEvent)
      dropZone.dispatchEvent(dragOverEvent)
      dropZone.dispatchEvent(dropEvent)
      await sleep(1000)

      const errorAfterDrop = _detectUploadError()
      if (!errorAfterDrop) {
        log('CV uploaded via DragEvent on drop zone')
        return true
      }
      warn('DragEvent dispatched but error detected:', errorAfterDrop)
    }

    // ── Method 4: React props on parent/drop zone ──
    // Some React ATS attach onChange not on the <input> but on a wrapper component
    if (dropZone) {
      const dropZoneProps = getReactProps(dropZone)
      if (dropZoneProps?.onDrop) {
        log('Found React onDrop on drop zone — calling directly...')
        dropZoneProps.onDrop({
          dataTransfer: { files: dataTransfer.files },
          preventDefault: () => {},
          stopPropagation: () => {}
        })
        await sleep(1000)
        log('CV uploaded via React onDrop on drop zone')
        return true
      }
    }

    // If all methods tried, consider it uploaded (DataTransfer was set even if files prop didn't stick)
    log('CV upload methods exhausted — DataTransfer was applied, files set:', fileInput.files?.length)
    return true
  } catch (err) {
    warn('CV upload failed:', err.message)
    return false
  }
}

// ─── Unified Form Field Classifier ───────────────────────────────────
// Determines the ACTUAL type of any form element, preventing the recurring bug
// where a select/radio/React-Select is treated as a text input (or vice versa).
// Every form-filling function MUST call this before choosing a fill strategy.

function classifyFormField(element) {
  if (!element) return 'unknown'

  const tag = element.tagName?.toUpperCase()
  const type = (element.getAttribute('type') || '').toLowerCase()

  // ── 1. Hidden fields — skip immediately ──
  if (type === 'hidden') return 'hidden'
  if (tag === 'INPUT' && element.offsetParent === null && !element.closest('[style*="display"]')) {
    const style = window.getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') return 'hidden'
  }

  // ── 2. File input ──
  if (type === 'file') return 'file'

  // ── 3. Checkbox ──
  if (type === 'checkbox') return 'checkbox'

  // ── 4. Radio button ──
  if (type === 'radio') return 'radio'

  // ── 5. Native <select> ──
  if (tag === 'SELECT') return 'select'

  // ── 6. React-Select detection ──
  // React-Select renders as: div.select-shell > div.select__control > input[role="combobox"]
  if (_isReactSelectElement(element)) return 'react-select'

  // ── 7. Submit / button — not a fillable field ──
  if (type === 'submit' || type === 'button' || tag === 'BUTTON') return 'button'

  // ── 8. Textarea ──
  if (tag === 'TEXTAREA') return 'text'

  // ── 9. Standard text input ──
  if (tag === 'INPUT') {
    const textTypes = ['text', 'email', 'tel', 'url', 'number', 'search', 'password', '']
    if (textTypes.includes(type)) return 'text'
  }

  return 'unknown'
}

// Internal helper: checks if an element is part of a React-Select component
function _isReactSelectElement(element) {
  // Direct checks on the element
  if (element.getAttribute('role') === 'combobox' && (
    element.classList.contains('select__input') ||
    element.id?.includes('react-select') ||
    element.closest('.select-shell, [class*="select-shell"], [class*="select__container"], [class*="select__control"]')
  )) return true

  // Check if element is inside a React-Select container
  if (element.closest('.select-shell')) return true
  if (element.closest('[class*="select__control"]')) return true
  if (element.closest('[class*="select__container"]')) return true

  // CSS module pattern: class contains "select" + "control" or "container"
  const parent = element.closest('[class*="select-shell"], [class*="css-"][class*="control"]')
  if (parent && parent.querySelector('input[role="combobox"]')) return true

  // Check sibling/child indicators within the field container
  const container = element.closest('.field, .form-field, [class*="field"]')
  if (container) {
    const hasControl = container.querySelector('[class*="select__control"]')
    const hasShell = container.querySelector('.select-shell')
    if (hasControl || hasShell) {
      const shell = hasShell || hasControl?.closest('.select-shell, [class*="select__container"]')
      if (shell && shell.contains(element)) return true
    }
  }

  return false
}

// Classify a container/field-wrapper to determine what kind of input it holds.
// Useful for functions that iterate containers (e.g., fillGreenhouseCustomQuestions).
function classifyFieldContainer(container) {
  if (!container) return 'unknown'

  // ── React-Select: check for .select-shell or select__control INSIDE the container ──
  if (container.querySelector('.select-shell, [class*="select-shell"], [class*="select__control"]')) {
    return 'react-select'
  }

  // ── Radio group: container has multiple radio inputs ──
  const radios = container.querySelectorAll('input[type="radio"]')
  if (radios.length > 0) return 'radio'

  // ── Checkbox ──
  const checkboxes = container.querySelectorAll('input[type="checkbox"]')
  if (checkboxes.length > 0) return 'checkbox'

  // ── Native select ──
  if (container.querySelector('select')) return 'select'

  // ── File input ──
  if (container.querySelector('input[type="file"]')) return 'file'

  // ── Text input or textarea ──
  const textInput = container.querySelector(
    'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], ' +
    'input[type="number"], input:not([type]), textarea'
  )
  if (textInput) {
    // Final guard: make sure this input isn't a React-Select combobox
    if (textInput.getAttribute('role') === 'combobox') return 'react-select'
    if (textInput.id?.includes('react-select')) return 'react-select'
    return 'text'
  }

  return 'unknown'
}

// ─── Unified Field Fill Dispatcher ───────────────────────────────────
// Given a classified field type, fills the element using the correct strategy.
// NEVER types text into a select/radio/React-Select.
// NEVER selects an option from a text input.

async function fillClassifiedField(element, fieldType, answer, questionText) {
  if (!element || !answer || fieldType === 'hidden' || fieldType === 'unknown' || fieldType === 'button') return false

  const actualValue = answer === '___PHONE___' ? PROFILE.phone : answer

  switch (fieldType) {
    case 'text':
      return _fillTextField(element, actualValue)

    case 'select':
      return _fillNativeSelect(element, actualValue)

    case 'react-select':
      return await _fillReactSelectField(element, actualValue, questionText)

    case 'radio':
      return await _fillRadioField(element, actualValue)

    case 'checkbox':
      return _fillCheckboxField(element, actualValue)

    case 'file':
      return false // File inputs handled by dedicated upload functions

    default:
      log(`fillClassifiedField: unhandled type "${fieldType}" for element`, element.tagName)
      return false
  }
}

// ── Text fill (input or textarea) ──
function _fillTextField(element, value) {
  const tag = element.tagName?.toUpperCase()
  if (tag === 'TEXTAREA') {
    const taSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
    if (taSetter) taSetter.call(element, value)
    else element.value = value
  } else {
    const inpSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    if (inpSetter) inpSetter.call(element, value)
    else element.value = value
  }
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
  element.dispatchEvent(new Event('blur', { bubbles: true }))
  return true
}

// ── Native <select> fill ──
function _fillNativeSelect(selectEl, answer) {
  const ansLower = answer.toLowerCase().trim()
  const isYes = ansLower.startsWith('yes')
  const isNo = ansLower === 'no' || ansLower.startsWith('no ') || ansLower.startsWith('no,') || ansLower.startsWith('no —')

  const options = Array.from(selectEl.options)
  const match = options.find(o => {
    const t = o.text.toLowerCase().trim()
    const v = o.value.toLowerCase().trim()
    if (t === ansLower || v === ansLower) return true
    if (isYes && (t === 'yes' || t.startsWith('yes,') || t.startsWith('yes '))) return true
    if (isNo && (t === 'no' || t.startsWith('no,') || t.startsWith('no '))) return true
    if (ansLower.length > 5 && (t.includes(ansLower) || ansLower.includes(t))) return true
    if (ansLower.includes('linkedin') && t.includes('linkedin')) return true
    if ((ansLower.includes('decline') || ansLower.includes('prefer not')) &&
        (t.includes('decline') || t.includes('prefer not') || t.includes('not wish'))) return true
    return false
  })

  if (match) {
    selectEl.value = match.value
    selectEl.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }
  return false
}

// ── React-Select fill (robust, works WITHOUT CDP) ──
// Strategy: focus control -> dispatch mousedown+click to open -> find combobox input ->
// type answer -> wait for options to filter -> click matching option -> verify value
async function _fillReactSelectField(element, answer, questionText) {
  const shell = element.closest('.select-shell') ||
                element.closest('[class*="select__container"]') ||
                element.closest('[class*="select__control"]')?.parentElement ||
                element

  if (isPhoneCountryShell(shell)) {
    log('_fillReactSelectField: skipping phone country shell')
    return false
  }

  const existingValue = shell.querySelector('[class*="select__single-value"], [class*="singleValue"]')
  if (existingValue && existingValue.textContent?.trim()) {
    log(`_fillReactSelectField: already has value "${existingValue.textContent.trim()}"`)
    return false
  }

  const control = shell.querySelector('[class*="select__control"]') || shell
  let comboboxInput = shell.querySelector('input[role="combobox"]')
    || shell.querySelector('input[class*="select__input"]')
    || shell.querySelector('input:not([type="hidden"])')

  log(`_fillReactSelectField: opening dropdown for "${(questionText || '').substring(0, 50)}" answer="${answer.substring(0, 30)}"`)

  // ── Step 1: Clear any leftover text in combobox ──
  if (comboboxInput && comboboxInput.value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    if (nativeSetter) nativeSetter.call(comboboxInput, '')
    else comboboxInput.value = ''
    comboboxInput.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(100)
  }

  // ── Step 2: Scroll into view ──
  control.scrollIntoView({ block: 'center', behavior: 'instant' })
  await sleep(200)

  // ── Step 3: Open the dropdown (multiple strategies) ──
  let menu = null

  // Method A: Focus combobox + mousedown on control
  if (comboboxInput) {
    comboboxInput.focus()
    comboboxInput.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
    comboboxInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    await sleep(150)
  }
  control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
  control.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
  await sleep(500)
  menu = shell.querySelector('[class*="select__menu"]')

  // Method B: ArrowDown key to force open
  if (!menu && comboboxInput) {
    comboboxInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }))
    await sleep(500)
    menu = shell.querySelector('[class*="select__menu"]')
  }

  // Method C: React internal props
  if (!menu) {
    const controlProps = getReactProps(control)
    if (controlProps?.onMouseDown) {
      controlProps.onMouseDown({ preventDefault: () => {}, button: 0 })
      await sleep(500)
      menu = shell.querySelector('[class*="select__menu"]')
    }
    if (!menu && controlProps?.onClick) {
      controlProps.onClick({ preventDefault: () => {} })
      await sleep(500)
      menu = shell.querySelector('[class*="select__menu"]')
    }
  }

  // Method D: Click on the dropdown indicator arrow
  if (!menu) {
    const indicator = shell.querySelector('[class*="select__indicator"], [class*="select__dropdown-indicator"], [class*="indicatorContainer"]')
    if (indicator) {
      indicator.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
      indicator.click()
      await sleep(500)
      menu = shell.querySelector('[class*="select__menu"]')
    }
  }

  // Method E: Check for portal/global menu
  if (!menu) {
    const globalMenu = document.querySelector('[class*="select__menu"]')
    if (globalMenu && !isPhoneCountryMenu(globalMenu)) {
      menu = globalMenu
    }
  }

  if (!menu) {
    log(`_fillReactSelectField: could not open dropdown for "${(questionText || '').substring(0, 40)}"`)
    document.body.click()
    await sleep(200)
    return false
  }

  // ── Step 4: Find matching option ──
  const menuOptions = Array.from(menu.querySelectorAll('[class*="select__option"], [role="option"]'))
    .filter(el => !el.closest('.iti, .intl-tel-input'))

  if (menuOptions.length === 0) {
    log('_fillReactSelectField: menu opened but no options')
    document.body.click()
    await sleep(200)
    return false
  }

  let bestMatch = findBestOption(menuOptions, answer)

  // ── Step 5: If no match, try typing to filter (searchable React-Selects) ──
  if (!bestMatch && comboboxInput) {
    const searchTerm = answer.split(/[\s,\u2014-]/)[0].substring(0, 15)
    if (searchTerm.length >= 2) {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      comboboxInput.focus()
      for (const char of searchTerm) {
        const newVal = comboboxInput.value + char
        if (nativeSetter) nativeSetter.call(comboboxInput, newVal)
        else comboboxInput.value = newVal
        comboboxInput.dispatchEvent(new Event('input', { bubbles: true }))
        comboboxInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }))
        await sleep(60)
      }
      await sleep(600)

      const filteredMenu = shell.querySelector('[class*="select__menu"]') || document.querySelector('[class*="select__menu"]')
      if (filteredMenu) {
        const filteredOptions = Array.from(filteredMenu.querySelectorAll('[class*="select__option"], [role="option"]'))
        bestMatch = findBestOption(filteredOptions, answer)
        if (!bestMatch && filteredOptions.length === 1) {
          bestMatch = filteredOptions[0]
        }
      }

      // Clear search text to prevent orphaned text
      if (nativeSetter) nativeSetter.call(comboboxInput, '')
      else comboboxInput.value = ''
      comboboxInput.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(200)
    }
  }

  if (!bestMatch) {
    log(`_fillReactSelectField: no matching option for "${(questionText || '').substring(0, 40)}" (answer: "${answer.substring(0, 30)}")`)
    log(`  Available: ${menuOptions.slice(0, 5).map(o => o.textContent?.trim()).join(', ')}`)
    if (comboboxInput) {
      comboboxInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }))
    } else {
      document.body.click()
    }
    await sleep(200)
    return false
  }

  // ── Step 6: Click the matching option ──
  let selectionConfirmed = false

  // Method A: React props onClick
  const optProps = getReactProps(bestMatch)
  if (optProps?.onClick) {
    optProps.onClick({ preventDefault: () => {}, stopPropagation: () => {} })
    await sleep(400)
    const selectedVal = shell.querySelector('[class*="select__single-value"], [class*="singleValue"]')
    if (selectedVal && selectedVal.textContent?.trim()) {
      selectionConfirmed = true
    }
  }

  // Method B: Direct click
  if (!selectionConfirmed) {
    bestMatch.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    await sleep(100)
    bestMatch.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    bestMatch.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }))
    bestMatch.click()
    await sleep(400)
    const selectedVal2 = shell.querySelector('[class*="select__single-value"], [class*="singleValue"]')
    if (selectedVal2 && selectedVal2.textContent?.trim()) {
      selectionConfirmed = true
    }
  }

  // Method C: Keyboard navigation (ArrowDown to target + Enter)
  if (!selectionConfirmed) {
    let reopenedMenu = shell.querySelector('[class*="select__menu"]')
    if (!reopenedMenu) {
      if (comboboxInput) comboboxInput.focus()
      control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
      await sleep(500)
      reopenedMenu = shell.querySelector('[class*="select__menu"]')
    }
    if (reopenedMenu) {
      const reopenedOptions = Array.from(reopenedMenu.querySelectorAll('[class*="select__option"]'))
      const targetOpt = findBestOption(reopenedOptions, answer)
      if (targetOpt) {
        const idx = reopenedOptions.indexOf(targetOpt)
        const target = comboboxInput || control
        for (let i = 0; i < idx; i++) {
          target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }))
          await sleep(80)
        }
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }))
        await sleep(400)
      }
    }
  }

  // ── Step 7: Verify the value was set ──
  const finalValue = shell.querySelector('[class*="select__single-value"], [class*="singleValue"]')
  if (finalValue && finalValue.textContent?.trim()) {
    log(`_fillReactSelectField OK: "${finalValue.textContent.trim()}"`)
    return true
  }

  log('_fillReactSelectField: selection attempted but value not confirmed')
  return false
}

// ── Radio button fill ──
async function _fillRadioField(element, answer) {
  let radios
  if (element.type === 'radio') {
    const name = element.getAttribute('name')
    const container = element.closest('fieldset, [role="radiogroup"], [class*="radio-group"], [class*="question"], .field')
    radios = name
      ? container?.querySelectorAll(`input[type="radio"][name="${name}"]`) || document.querySelectorAll(`input[type="radio"][name="${name}"]`)
      : container?.querySelectorAll('input[type="radio"]') || [element]
  } else {
    radios = element.querySelectorAll('input[type="radio"]')
  }

  if (!radios || radios.length === 0) return false
  if (Array.from(radios).some(r => r.checked)) return false

  const ansLower = answer.toLowerCase().trim()
  for (const radio of radios) {
    const radioLabel = (radio.closest('label')?.textContent || radio.nextElementSibling?.textContent || radio.parentElement?.textContent || '').toLowerCase().trim()
    if ((ansLower.includes('yes') && radioLabel.includes('yes')) ||
        (ansLower === 'no' && radioLabel.includes('no') && !radioLabel.includes('not')) ||
        radioLabel.includes(ansLower) || ansLower.includes(radioLabel)) {
      radio.click()
      await sleep(200)
      return true
    }
  }
  return false
}

// ── Checkbox fill ──
function _fillCheckboxField(element, answer) {
  if (element.checked) return false
  const ansLower = answer.toLowerCase().trim()
  if (ansLower.includes('yes') || ansLower.includes('agree') || ansLower.includes('consent') || ansLower.includes('accept') || ansLower === 'true') {
    element.click()
    return true
  }
  return false
}

// ─── Smart Field Matching ─────────────────────────────────────────────

function matchFieldToValue(labelInfo) {
  const l = labelInfo.toLowerCase()

  // ── Name fields ──
  if (l.includes('first') && l.includes('name')) return PROFILE.firstName
  if (l.includes('last') && l.includes('name')) return PROFILE.lastName
  if (l.includes('prenom') || l.includes('prénom')) return PROFILE.firstName
  if (l.includes('nom de famille') || (l.includes('nom') && !l.includes('prenom') && !l.includes('prénom') && !l.includes('company') && !l.includes('entreprise'))) return PROFILE.lastName
  if (l.includes('full name') || l.includes('your name') || l.includes('candidate name') || l === 'name') return PROFILE.fullName

  // ── Contact ──
  if (l.includes('email') || l.includes('e-mail') || l.includes('courriel')) return PROFILE.email
  if (l.includes('phone') || l.includes('mobile') || l.includes('telephone') || l.includes('téléphone') || l.includes('tel')) return '___PHONE___' // Special marker — handled by fillAllFormFields to use setReactValue

  // ── Location ──
  // IMPORTANT: Skip country/location if the label is a complex question or contains authorization/legal keywords
  if (l.includes('authorized') || l.includes('authorised') || l.includes('sponsor') || l.includes('employed') || l.includes('prohibited') || l.includes('interviewed') || l.includes('relative') || l.includes('eligible') || l.includes('legally') || l.includes('right to work') || l.includes('visa') || l.includes('permit') || l.includes('specified') || l.includes('previously') || l.includes('require')) return null
  if (l.includes('city') || l.includes('ville') || l.includes('location') || l.includes('lieu') || l.includes('where are you based') || l.includes('current location')) return PROFILE.city
  if ((l.includes('country') || l.includes('pays')) && l.length < 30) return PROFILE.country
  if (l.includes('address') && !l.includes('email')) return 'Bangkok, Thailand'
  if (l.includes('zip') || l.includes('postal') || l.includes('code postal')) return '10110'
  if (l.includes('state') || l.includes('province') || l.includes('region') || l.includes('région')) return 'Bangkok'

  // ── Professional ──
  if (l.includes('linkedin')) return PROFILE.linkedin
  if (l.includes('password')) return 'No password required'
  if (l.includes('portfolio') || l.includes('website') || l.includes('url') || l.includes('site web') || l.includes('personal site') || l.includes('link') || l.includes('github')) return PROFILE.portfolio
  if (l.includes('title') && (l.includes('current') || l.includes('job') || l.includes('poste'))) return PROFILE.currentTitle
  if (l.includes('years') && (l.includes('experience') || l.includes('expérience'))) return PROFILE.yearsExperience
  if (l.includes('salary') || l.includes('salaire') || l.includes('compensation') || l.includes('expected') && l.includes('pay')) return PROFILE.salary
  if (l.includes('notice period') || l.includes('préavis') || l.includes('availability') || l.includes('disponibilité')) return 'Immediately'
  if (l.includes('how did you hear') || l.includes('source') || l.includes('referral') || l.includes('comment avez')) return 'LinkedIn'

  return null
}

// ─── Generic Form Filler ──────────────────────────────────────────────

async function fillAllFormFields() {
  log('Starting generic form fill (with classifyFormField)...')
  let filledCount = 0

  // ── Scan ALL visible form elements and classify each one ──
  const allInputs = document.querySelectorAll(
    'input, textarea, select'
  )

  for (const input of allInputs) {
    // ── CLASSIFY FIRST — never guess ──
    const fieldType = classifyFormField(input)

    // Skip non-fillable types
    if (fieldType === 'hidden' || fieldType === 'button' || fieldType === 'unknown') continue
    // File inputs handled separately below
    if (fieldType === 'file') continue
    // React-Select combobox inputs are handled by fillReactSelectDropdowns (with CDP support)
    // The classifier catches these; we skip them here to avoid double-handling
    if (fieldType === 'react-select') continue

    // Skip if already filled
    if (fieldType === 'text' && input.value && input.value.trim().length > 0) continue
    if (fieldType === 'select' && input.value && input.selectedIndex > 0) continue
    if (fieldType === 'checkbox' && input.checked) continue
    if (fieldType === 'radio') continue // Radio groups handled in the group scan below

    // Skip invisible inputs
    if (input.offsetParent === null && !input.closest('[style*="display"]')) continue
    // Skip intl-tel-input search inputs (handled separately by ATS-specific code)
    if (input.id === 'country' || input.closest('.iti__search-input, .iti')) continue
    // Skip EEO/demographic fields (select dropdowns rendered as text inputs by React)
    const eeoIds = ['gender', 'race', 'ethnicity', 'hispanic_ethnicity', 'veteran_status', 'disability_status']
    if (eeoIds.includes(input.id) || input.id?.startsWith('4014') || input.id?.startsWith('4015')) continue

    const labelInfo = getLabelText(input)

    if (fieldType === 'text') {
      // ── Text inputs and textareas — use matchFieldToValue or cover letter detection ──
      let matched = matchFieldToValue(labelInfo)

      // Cover letter / Additional info textareas
      if (!matched && input.tagName === 'TEXTAREA' && (
        labelInfo.includes('cover') || labelInfo.includes('letter') || labelInfo.includes('motivation') ||
        labelInfo.includes('additional') || labelInfo.includes('message') || labelInfo.includes('why') ||
        labelInfo.includes('about you') || labelInfo.includes('lettre') || labelInfo.includes('presentation')
      )) {
        matched = `I am a Senior Product Designer with 7+ years of experience specializing in design systems, complex product architecture, and design ops. I have led design across iGaming, B2B SaaS, and media platforms, delivering scalable systems that improved development feedback by 90% and managed 143+ templates. I am currently based in Bangkok and available to start immediately. Please find my portfolio at ${PROFILE.portfolio}`
      }

      // Fallback: try answerCustomQuestion for unmatched fields (e.g. Lever cards[*] custom questions)
      // matchFieldToValue only matches standard field names; answerCustomQuestion handles screening questions
      if (!matched) {
        // Build richer label from container context (Lever wraps cards in .custom-question / .application-question)
        const questionContainer = input.closest('.custom-question, .application-question, [class*="custom-question"], [class*="application-question"], .field, .form-field, fieldset, [class*="question"]')
        const containerLabel = questionContainer?.querySelector('label, legend, .field-label, [class*="label"], .custom-question-title, .question-label, h3, h4, [class*="title"]')?.textContent?.trim() || ''
        const enrichedLabel = (labelInfo + ' ' + containerLabel.toLowerCase()).trim()
        if (enrichedLabel.length > 5) {
          const isTextarea = input.tagName === 'TEXTAREA'
          matched = answerCustomQuestion(enrichedLabel, isTextarea ? 'textarea' : 'text')
          if (matched) {
            log(`[classify:text:customQ] [${enrichedLabel.substring(0, 50)}] -> ${matched.substring(0, 30)}...`)
          }
        }
      }

      if (matched) {
        const actualValue = matched === '___PHONE___' ? PROFILE.phone : matched
        log(`[classify:text] [${labelInfo.trim().substring(0, 50)}] -> ${actualValue.substring(0, 30)}...`)
        _fillTextField(input, actualValue)
        filledCount++
        await sleep(150)
      }
    } else if (fieldType === 'select') {
      // ── Native <select> — use smart matching ──
      // Try to match country
      if (labelInfo.includes('country') || labelInfo.includes('pays')) {
        const options = Array.from(input.options)
        const match = options.find(o => o.text.toLowerCase().includes('thailand') || o.value.toLowerCase().includes('thailand') || o.value.toLowerCase().includes('th'))
        if (match) {
          input.value = match.value
          input.dispatchEvent(new Event('change', { bubbles: true }))
          filledCount++
          log(`[classify:select] country -> Thailand`)
          continue
        }
      }

      // Gender / EEO — select "Prefer not to say" or "Decline"
      if (labelInfo.includes('gender') || labelInfo.includes('race') || labelInfo.includes('veteran') || labelInfo.includes('disability') || labelInfo.includes('ethnicity')) {
        const options = Array.from(input.options)
        const match = options.find(o => {
          const t = o.text.toLowerCase()
          return t.includes('decline') || t.includes('prefer not') || t.includes('not wish') || t.includes('ne souhaite pas')
        })
        if (match) {
          input.value = match.value
          input.dispatchEvent(new Event('change', { bubbles: true }))
          filledCount++
          log(`[classify:select] EEO -> ${match.text}`)
        }
        continue
      }

      // How did you hear — select "LinkedIn" if available
      if (labelInfo.includes('how did you') || labelInfo.includes('source') || labelInfo.includes('hear about')) {
        const options = Array.from(input.options)
        const match = options.find(o => o.text.toLowerCase().includes('linkedin'))
        if (match) {
          input.value = match.value
          input.dispatchEvent(new Event('change', { bubbles: true }))
          filledCount++
          log(`[classify:select] source -> ${match.text}`)
        }
        continue
      }

      // Generic select: try answerCustomQuestion
      const selectOpts = Array.from(input.options).map(o => ({ text: o.text, value: o.value, label: o.text }))
      const answer = answerCustomQuestion(labelInfo, 'select', selectOpts)
      if (answer && _fillNativeSelect(input, answer)) {
        filledCount++
        log(`[classify:select] [${labelInfo.trim().substring(0, 50)}] -> ${answer.substring(0, 30)}`)
      }
    } else if (fieldType === 'checkbox') {
      // ── Checkboxes (consent, terms) ──
      if (labelInfo.includes('agree') || labelInfo.includes('consent') || labelInfo.includes('privacy') ||
          labelInfo.includes('terms') || labelInfo.includes('acknowledge') || labelInfo.includes('accept') ||
          labelInfo.includes('j\'accepte') || labelInfo.includes('conditions')) {
        input.click()
        filledCount++
        log(`[classify:checkbox] checked consent`)
        await randomDelay(100, 300)
      }
    }
  }

  // ── Radio buttons (Yes/No questions) — scan by group containers ──
  const radioGroups = document.querySelectorAll('fieldset, [role="radiogroup"], [class*="radio-group"], [class*="question"]')
  for (const group of radioGroups) {
    const radios = group.querySelectorAll('input[type="radio"]')
    if (radios.length === 0) continue

    // Verify this is actually a radio group (classifier confirms each child)
    const firstRadioType = classifyFormField(radios[0])
    if (firstRadioType !== 'radio') continue

    // Check if already answered
    if (Array.from(radios).some(r => r.checked)) continue

    const groupText = (group.textContent || '').toLowerCase()
    let selectValue = null
    if (groupText.includes('sponsor') || groupText.includes('visa')) selectValue = 'no'
    else if (groupText.includes('authorized') || groupText.includes('eligible') || groupText.includes('right to work') || groupText.includes('legally')) selectValue = 'yes'
    else if (groupText.includes('remote') || groupText.includes('willing')) selectValue = 'yes'
    else if (groupText.includes('relocate') || groupText.includes('commute')) selectValue = 'yes'
    else if (groupText.includes('18') || groupText.includes('legal age')) selectValue = 'yes'
    else if (groupText.includes('agree') || groupText.includes('consent') || groupText.includes('privacy') || groupText.includes('terms')) selectValue = 'yes'
    else if (groupText.includes('gender') || groupText.includes('race') || groupText.includes('veteran') || groupText.includes('disability')) {
      // EEO questions — prefer "decline" or "prefer not"
      for (const radio of radios) {
        const radioLabel = (radio.closest('label')?.textContent || radio.nextElementSibling?.textContent || '').toLowerCase()
        if (radioLabel.includes('decline') || radioLabel.includes('prefer not') || radioLabel.includes('not wish')) {
          radio.click()
          await randomDelay(200, 500)
          break
        }
      }
      continue
    }

    if (selectValue) {
      const filled = await _fillRadioField(group, selectValue)
      if (filled) {
        filledCount++
        log(`[classify:radio] [${groupText.substring(0, 50)}] -> ${selectValue}`)
      }
    }
  }

  // ── File inputs (CV upload — skip cover_letter) ──
  const fileInputs = document.querySelectorAll('input[type="file"]')
  let cvUploaded = false
  for (const fi of fileInputs) {
    if (classifyFormField(fi) !== 'file') continue
    if (fi.files && fi.files.length > 0) continue // Already has a file
    const labelInfo = getLabelText(fi)
    const fiId = (fi.id || '').toLowerCase()
    // Skip cover letter inputs — those get a generated PDF separately
    if (fiId.includes('cover') || labelInfo.includes('cover letter') || labelInfo.includes('lettre de motivation')) continue
    // Upload CV to resume/CV fields
    if (!cvUploaded && (fiId.includes('resume') || fiId.includes('cv') || labelInfo.includes('resume') || labelInfo.includes('cv') ||
        labelInfo.includes('upload') || labelInfo.includes('document'))) {
      const uploaded = await fetchAndUploadCV(fi)
      if (uploaded) { filledCount++; cvUploaded = true }
    }
  }

  // If no labeled resume input found, try the first file input (but not cover_letter)
  if (!cvUploaded && fileInputs.length > 0) {
    const firstFI = Array.from(fileInputs).find(fi => {
      const fiId = (fi.id || '').toLowerCase()
      return !fiId.includes('cover') && (!fi.files || fi.files.length === 0)
    })
    if (firstFI) {
      const uploaded = await fetchAndUploadCV(firstFI)
      if (uploaded) filledCount++
    }
  }

  log(`Filled ${filledCount} fields (with classifier)`)
  return filledCount
}

// ─── ATS-Specific Handlers ────────────────────────────────────────────

// ── Greenhouse ────────────────────────────────────────────────────────

// Smart answers for common custom questions on ATS forms
const CUSTOM_QUESTION_ANSWERS = {
  // Work authorization
  authorized: 'Yes',
  authorizedLong: 'Yes — EU citizen (French passport), eligible to work in most countries',
  sponsor: 'No',
  sponsorLong: 'No — I do not require visa sponsorship now or in the future.',
  visa: 'I hold a French/EU passport and am currently based in Bangkok, Thailand. I do not require visa sponsorship for EU-based remote positions.',
  citizenship: 'French (EU citizen)',

  // Availability
  startDate: 'Immediately',
  noticePeriod: '0 — available immediately',
  availability: 'Immediately available',

  // Salary
  salary: '80000',
  salaryExpectation: '80,000 EUR annually',
  salaryRange: '70000-90000',

  // Experience
  yearsExperience: '7',
  designSystems: 'Yes — 7+ years building and maintaining design systems (Figma, Storybook, Zeroheight). Managed 143+ templates across 7 SaaS products.',
  tools: 'Figma, Storybook, Zeroheight, Jira, Maze, Rive, Notion, Adobe Creative Suite',

  // Remote / location
  remote: 'Yes',
  relocate: 'Open to discussion',
  timezone: 'GMT+7 (Bangkok) — flexible with async teams',
  onsite: 'Yes — open to on-site, hybrid, or remote arrangements',
  travel: 'Yes — willing to travel as needed',
  currentLocation: 'Bangkok, Thailand',

  // Education
  education: "Bachelor's Degree",
  educationDetail: "Bachelor's Degree in Digital Design",

  // Background / compliance
  backgroundCheck: 'Yes',
  drugTest: 'Yes',
  criminalHistory: 'No',
  nda: 'Yes',
  over18: 'Yes',

  // EEO / demographics (always decline)
  eeoDecline: 'Decline to Self Identify',
  eeoPreferNot: 'Prefer not to say',

  // Employment type
  employmentType: 'Full-time',
  contractType: 'Open to full-time, contract, or freelance',

  // Current employment
  currentEmployer: 'Currently seeking new opportunities',
  reasonLeaving: 'Seeking new challenges and growth opportunities in product design',

  // Languages
  languages: 'Bilingual French/English (native French, fluent English). Working proficiency in both languages.',
  french: 'Native French speaker',

  // Generic
  howHeard: 'LinkedIn',
  referral: 'No referral — found via LinkedIn',
  portfolio: 'https://www.floriangouloubi.com/',
  linkedin: 'LinkedIn profile available upon request',
  coverLetter: 'I am a Senior Product Designer with 7+ years of experience specializing in design systems, complex product architecture, and design ops. I have led design across iGaming, B2B SaaS, and media platforms, delivering scalable systems that improved development feedback by 90% and managed 143+ templates across 7 SaaS products. Currently based in Bangkok, available immediately. Portfolio: https://www.floriangouloubi.com/',

  // Consent / agreement
  consent: 'Yes',
  dataConsent: 'Yes, I consent to the processing of my personal data for recruitment purposes.',

  // Previously employed / affiliated
  previouslyEmployed: 'No',
  previouslyApplied: 'No',
  hasRelative: 'No',
  nonCompete: 'No',
  meetsRequirements: 'Yes',

  // Accommodations
  accommodations: 'No accommodations needed.',
  interviewAvailability: 'Available for interviews any weekday. Based in Bangkok (GMT+7), flexible with time zones for video calls.',

  // ─── NEW: Tech / Tools / Stack ───────────────────────────────────────
  excitingTech: 'Recently I have been exploring design token automation pipelines and AI-assisted design workflows — using tools like Figma Variables, Style Dictionary, and Claude for UX writing. The convergence of design systems and AI is exciting for scalable product design.',
  techStack: 'Figma, Storybook, Zeroheight, Style Dictionary, Rive, Maze, Jira, Notion. For prototyping: Framer, ProtoPie. For design-to-dev: Figma Dev Mode, Storybook, and custom token pipelines.',
  favoriteTool: 'Figma — it is the backbone of my design workflow. Combined with Storybook for component documentation and Zeroheight for design system governance, it enables me to maintain 143+ templates across 7 SaaS products efficiently.',

  // ─── NEW: Motivation / Interest ──────────────────────────────────────
  whyRole: 'I am drawn to roles where I can leverage my 7+ years of design systems expertise to solve complex product challenges. I thrive in environments that value systematic thinking, cross-functional collaboration, and design at scale.',
  whyCompany: 'I am excited about companies that invest in design quality and scalable systems. My experience leading design across iGaming, B2B SaaS, and media platforms has shown me the impact of thoughtful design infrastructure on product velocity.',
  whatExcites: 'Building design systems that genuinely accelerate product teams excites me most. Seeing a component library reduce development feedback cycles by 90% — as I achieved in my previous role — is deeply rewarding.',

  // ─── NEW: Strengths / Differentiators ────────────────────────────────
  greatestStrength: 'My ability to bridge design and engineering. I do not just create mockups — I build complete design systems with tokens, documentation, and governance processes that scale across products and teams.',
  whatMakesUnique: 'The combination of deep design systems expertise (143+ templates, 7 SaaS products) with hands-on experience in design ops, accessibility audits, and cross-functional leadership. I think in systems, not just screens.',
  whatSetsApart: 'I bring a rare blend of visual design craft and systematic architecture. My design systems have improved development feedback by 90% and I have led design across diverse industries from iGaming to B2B SaaS to media.',

  // ─── NEW: Projects / Impact ──────────────────────────────────────────
  proudestProject: 'Building a unified design system for 7 SaaS products from scratch — 143+ templates in Figma, full Storybook documentation, and a token pipeline that reduced design-to-dev handoff friction by 90%. It transformed how the entire product organization shipped.',
  mostImpactfulWork: 'Leading the design system initiative that consolidated fragmented UI patterns across 7 products into one coherent system. It cut component development time in half and established a shared design language across teams.',

  // ─── NEW: Challenges / Behavioral ────────────────────────────────────
  biggestChallenge: 'Unifying design patterns across 7 independently built SaaS products was my biggest challenge. I audited every product, identified common patterns, negotiated with stakeholders, and built an incremental migration plan that avoided disrupting active development.',
  describeTimeWhen: 'When I joined my previous company, each product team had its own UI patterns. I led an audit of all 7 products, mapped overlapping components, and proposed a unified system. Through cross-team workshops and iterative releases, I consolidated everything into 143+ shared templates — improving consistency and reducing dev cycles by 90%.',
  howDoYouHandle: 'I approach challenges methodically: define the problem clearly, audit the current state, align stakeholders on priorities, then execute iteratively. For design systems specifically, I break large migrations into incremental phases so teams can adopt changes without disruption.',

  // ─── NEW: Availability / Scheduling ──────────────────────────────────
  whenAvailable: 'Available for interviews any weekday. Based in Bangkok (GMT+7), highly flexible with time zones for video calls. I am available immediately for the right opportunity.',
  preferredTime: 'Flexible — I work across time zones regularly. I am comfortable with morning sessions (Asia time) or evening sessions to overlap with US/EU hours.',

  // ─── NEW: AI / Design / Systems ──────────────────────────────────────
  aiExperience: 'I integrate AI into my design workflow using Figma AI for auto-layout suggestions, Midjourney for concept exploration, Claude/ChatGPT for UX copy iteration, and Maze for AI-powered usability analysis. I also build design system automation pipelines.',
  designPhilosophy: 'Design is a system, not a series of screens. I believe in building scalable, token-driven design foundations that empower teams to ship consistently and fast. Good design systems are invisible — they make the right thing the easy thing.',
  systemsThinking: 'I approach every design challenge as a systems problem. Whether it is a component library, a token architecture, or a cross-product pattern audit, I think about scalability, governance, and how the pieces interconnect to serve the whole.',
}

// Match a custom question text to a smart answer
// Covers 80+ common screening question patterns from Greenhouse, Lever, Workable, etc.
// fieldType (optional): 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' — used for smart fallback
// options (optional): array of option texts for select/radio fields — used for smart fallback
function answerCustomQuestion(questionText, fieldType, options) {
  const q = questionText.toLowerCase().trim()

  // ─── 1. VISA / SPONSORSHIP / WORK AUTHORIZATION ─────────────────────
  // These MUST come first — highest priority, most common screening failures

  // "Will you now or in the future require visa sponsorship?" (exact Greenhouse/Virtru pattern)
  if (q.includes('require') && (q.includes('sponsor') || q.includes('visa'))) return CUSTOM_QUESTION_ANSWERS.sponsor
  // "Do you now or will you in the future require sponsorship?"
  if (q.includes('now or') && (q.includes('future') || q.includes('ever')) && (q.includes('sponsor') || q.includes('visa'))) return CUSTOM_QUESTION_ANSWERS.sponsor
  // "Will you require sponsorship..." / "Do you require sponsorship..."
  if (q.includes('sponsor') && (q.includes('visa') || q.includes('now or in the future') || q.includes('immigration') || q.includes('employ'))) return CUSTOM_QUESTION_ANSWERS.sponsor
  // Standalone "sponsorship" question (e.g., "Sponsorship required?")
  if (q.includes('sponsorship')) return CUSTOM_QUESTION_ANSWERS.sponsor

  // "Are you authorized to work in..." / "Are you authorised..."
  if (q.includes('authorized') || q.includes('authorised')) return CUSTOM_QUESTION_ANSWERS.authorized
  // "Do you have the right to work..." / "Right to work in..."
  if (q.includes('right to work')) return CUSTOM_QUESTION_ANSWERS.authorized
  // "Are you eligible to work..." / "Eligible for employment..."
  if (q.includes('eligible to work') || q.includes('eligible for employment')) return CUSTOM_QUESTION_ANSWERS.authorized
  // "Are you legally authorized..." / "Legally able to work..."
  if (q.includes('legally') && q.includes('work')) return CUSTOM_QUESTION_ANSWERS.authorized
  // "Do you have a valid work visa..."
  if ((q.includes('visa') || q.includes('work permit')) && !q.includes('status')) return CUSTOM_QUESTION_ANSWERS.visa
  // "Legal right to work" / "Employment eligibility"
  if (q.includes('legal right') || q.includes('employment eligib')) return CUSTOM_QUESTION_ANSWERS.authorized
  // "Immigration status" / "Citizenship"
  if (q.includes('immigration') && !q.includes('sponsor')) return CUSTOM_QUESTION_ANSWERS.visa
  if (q.includes('citizen') && !q.includes('senior')) return CUSTOM_QUESTION_ANSWERS.citizenship
  // "Work permit" standalone
  if (q.includes('work') && q.includes('permit')) return CUSTOM_QUESTION_ANSWERS.visa

  // ─── 2. EEO / DEMOGRAPHICS (always decline) ────────────────────────
  // Must come before generic keyword matches to avoid false positives
  if (q.includes('gender') || q.includes('sex') && !q.includes('sexual harassment')) return CUSTOM_QUESTION_ANSWERS.eeoDecline
  if (q.includes('race') || q.includes('ethnicity') || q.includes('ethnic background')) return CUSTOM_QUESTION_ANSWERS.eeoDecline
  if (q.includes('hispanic') || q.includes('latino') || q.includes('latina')) return CUSTOM_QUESTION_ANSWERS.eeoDecline
  if (q.includes('veteran') || q.includes('military') && q.includes('status')) return CUSTOM_QUESTION_ANSWERS.eeoDecline
  if (q.includes('disability') && !q.includes('accommodat') && !q.includes('require')) return CUSTOM_QUESTION_ANSWERS.eeoDecline
  if (q.includes('sexual orientation') || q.includes('lgbtq') || q.includes('pronouns')) return CUSTOM_QUESTION_ANSWERS.eeoPreferNot
  if (q.includes('protected class') || q.includes('demographic') || q.includes('self-identify') || q.includes('self identify')) return CUSTOM_QUESTION_ANSWERS.eeoDecline

  // ─── 3. EMPLOYMENT HISTORY AT THIS COMPANY ──────────────────────────
  if (q.includes('ever been employed') || q.includes('previously employed') || q.includes('former employee') || q.includes('worked at') || q.includes('have you worked')) return CUSTOM_QUESTION_ANSWERS.previouslyEmployed
  if (q.includes('previously interviewed') || q.includes('ever interviewed') || q.includes('applied before') || q.includes('prior application') || q.includes('previously applied') || q.includes('applied to this')) return CUSTOM_QUESTION_ANSWERS.previouslyApplied
  if (q.includes('relative') || q.includes('spouse') || q.includes('partner') || q.includes('in-law') || q.includes('family member')) return CUSTOM_QUESTION_ANSWERS.hasRelative
  if (q.includes('prohibited') || q.includes('restrictive') || q.includes('non-compete') || q.includes('covenant') || q.includes('limited in your performance') || q.includes('non compete') || q.includes('noncompete')) return CUSTOM_QUESTION_ANSWERS.nonCompete
  if ((q.includes('meet') && q.includes('qualifications')) || (q.includes('meet') && q.includes('requirements')) || (q.includes('meet') && q.includes('minimum'))) return CUSTOM_QUESTION_ANSWERS.meetsRequirements

  // ─── 4. AGE / LEGAL REQUIREMENTS ───────────────────────────────────
  if (q.includes('18 years') || q.includes('over 18') || q.includes('at least 18') || q.includes('age of 18') || q.includes('legal age') || q.includes('minimum age')) return CUSTOM_QUESTION_ANSWERS.over18
  if (q.includes('21 years') || q.includes('over 21') || q.includes('at least 21')) return 'Yes'

  // ─── 5. BACKGROUND CHECK / DRUG TEST / COMPLIANCE ──────────────────
  if (q.includes('background check') || q.includes('background screening') || q.includes('background investigation')) return CUSTOM_QUESTION_ANSWERS.backgroundCheck
  if (q.includes('drug test') || q.includes('drug screen') || q.includes('substance')) return CUSTOM_QUESTION_ANSWERS.drugTest
  if (q.includes('criminal') || q.includes('conviction') || q.includes('felony') || q.includes('misdemeanor') || q.includes('arrested')) return CUSTOM_QUESTION_ANSWERS.criminalHistory
  if (q.includes('nda') || q.includes('non-disclosure') || q.includes('confidential') && q.includes('agree')) return CUSTOM_QUESTION_ANSWERS.nda

  // ─── 6. SALARY / COMPENSATION ──────────────────────────────────────
  if (q.includes('extra compensation') || q.includes('benefits you receive') || (q.includes('current') && q.includes('compensation'))) return 'No additional compensation or benefits beyond base salary.'
  if (q.includes('current salary') || q.includes('current pay') || q.includes('present salary')) return CUSTOM_QUESTION_ANSWERS.salary
  if (q.includes('salary') && (q.includes('range') || q.includes('minimum') && q.includes('maximum'))) return CUSTOM_QUESTION_ANSWERS.salaryRange
  if (q.includes('minimum salary') || q.includes('lowest') && q.includes('salary')) return CUSTOM_QUESTION_ANSWERS.salary
  if (q.includes('salary') || q.includes('compensation') || q.includes('pay expectation') || q.includes('desired pay') || q.includes('desired salary') || (q.includes('annual') && q.includes('expect'))) return CUSTOM_QUESTION_ANSWERS.salaryExpectation

  // ─── 7. AI TOOLS (before generic tool check) ──────────────────────
  if (q.includes('ai') && (q.includes('tool') || q.includes('software') || q.includes('use') || q.includes('familiar'))) return 'Experienced with AI-assisted design workflows: Figma AI, Midjourney for concept exploration, ChatGPT/Claude for UX writing, and custom design system automation.'

  // ─── 8. INDUSTRY / BRAND EXPERIENCE (before generic experience) ────
  if (q.includes('beauty') || (q.includes('brand') && !q.includes('brandtech')) || q.includes('luxury') || q.includes('fashion') || q.includes('cosmetic') || q.includes('skincare')) return 'Experienced with premium brand design across iGaming, B2B SaaS, and media platforms. Strong visual design skills with attention to brand consistency and premium aesthetics.'

  // ─── 9. EXPERIENCE / YEARS ─────────────────────────────────────────
  if ((q.includes('years') || q.includes('how many') || q.includes('how long')) && (q.includes('experience') || q.includes('expérience'))) return CUSTOM_QUESTION_ANSWERS.yearsExperience
  if (q.includes('years of') && (q.includes('design') || q.includes('product') || q.includes('ux') || q.includes('ui'))) return CUSTOM_QUESTION_ANSWERS.yearsExperience
  if (q.includes('level of experience') || q.includes('experience level') || q.includes('seniority')) return 'Senior (7+ years)'
  if (q.includes('design system') || q.includes('design ops')) return CUSTOM_QUESTION_ANSWERS.designSystems
  if (q.includes('tool') || q.includes('software') || q.includes('proficien')) return CUSTOM_QUESTION_ANSWERS.tools

  // ─── 10. EDUCATION ─────────────────────────────────────────────────
  if (q.includes('highest degree') || q.includes('level of education') || q.includes('education level') || q.includes('degree') && (q.includes('what') || q.includes('highest') || q.includes('type'))) return CUSTOM_QUESTION_ANSWERS.education
  if (q.includes('education') && !q.includes('continue') && !q.includes('additional')) return CUSTOM_QUESTION_ANSWERS.educationDetail
  if (q.includes('university') || q.includes('college') || q.includes('school') && q.includes('attend')) return CUSTOM_QUESTION_ANSWERS.educationDetail
  if (q.includes('gpa') || q.includes('grade point')) return 'N/A'
  if (q.includes('major') || q.includes('field of study') || q.includes('area of study')) return 'Digital Design'
  if (q.includes('certif') && !q.includes('certify') && !q.includes('i certif')) return 'Figma Professional Certificate, Google UX Design Certificate'

  // ─── 11. AVAILABILITY / START DATE / NOTICE PERIOD ─────────────────
  if (q.includes('start date') || q.includes('when can you start') || q.includes('available to start') || q.includes('earliest start') || q.includes('earliest date')) return CUSTOM_QUESTION_ANSWERS.startDate
  if (q.includes('when can you') || q.includes('how soon')) return CUSTOM_QUESTION_ANSWERS.startDate
  if (q.includes('notice period') || q.includes('préavis') || q.includes('notice required')) return CUSTOM_QUESTION_ANSWERS.noticePeriod
  if (q.includes('availab') || q.includes('disponib')) return CUSTOM_QUESTION_ANSWERS.availability

  // ─── 12. EMPLOYMENT TYPE / CONTRACT ────────────────────────────────
  if (q.includes('employment type') || q.includes('type of employment') || q.includes('full-time') || q.includes('full time') || q.includes('part-time') || q.includes('part time')) return CUSTOM_QUESTION_ANSWERS.employmentType
  if (q.includes('contract') && (q.includes('type') || q.includes('prefer') || q.includes('open to'))) return CUSTOM_QUESTION_ANSWERS.contractType
  if (q.includes('freelance') || q.includes('contractor') || q.includes('w-2') || q.includes('w2') || q.includes('1099') || q.includes('c2c')) return CUSTOM_QUESTION_ANSWERS.contractType

  // ─── 13. CURRENT EMPLOYER / REASON FOR LEAVING ─────────────────────
  if (q.includes('current employer') || q.includes('current company') || q.includes('present employer') || q.includes('where do you work')) return CUSTOM_QUESTION_ANSWERS.currentEmployer
  if (q.includes('reason') && (q.includes('leaving') || q.includes('left') || q.includes('looking') || q.includes('change'))) return CUSTOM_QUESTION_ANSWERS.reasonLeaving

  // ─── 14. COUNTRY (standalone label) ────────────────────────────────
  if ((q === 'country' || q === 'country*') && q.length < 15) return PROFILE.country

  // ─── 15. LOCATION / REMOTE / COMMUTE / ON-SITE ────────────────────
  if (q.includes('on-site') || q.includes('onsite') || q.includes('in-office') || q.includes('in office') || q.includes('hybrid')) return CUSTOM_QUESTION_ANSWERS.onsite
  if (q.includes('remote') || q.includes('work from home') || q.includes('wfh') || q.includes('télétravail')) return CUSTOM_QUESTION_ANSWERS.remote
  if (q.includes('willing to commute') || q.includes('commute') && q.includes('willing')) return CUSTOM_QUESTION_ANSWERS.onsite
  if (q.includes('relocat') || q.includes('willing to move')) return CUSTOM_QUESTION_ANSWERS.relocate
  if (q.includes('travel') && (q.includes('willing') || q.includes('able') || q.includes('require') || q.includes('percent') || q.includes('%'))) return CUSTOM_QUESTION_ANSWERS.travel
  if (q.includes('overtime') || q.includes('extra hours') || q.includes('weekend') && q.includes('work')) return 'Yes'
  if (q.includes('timezone') || q.includes('time zone') || q.includes('time difference') || q.includes('fuseau')) return CUSTOM_QUESTION_ANSWERS.timezone
  if (q.includes('where are you based') || q.includes('current location') || q.includes('where do you live') || q.includes('current city')) return CUSTOM_QUESTION_ANSWERS.currentLocation

  // ─── 16. REFERRAL / SOURCE ─────────────────────────────────────────
  if (q.includes('how did you hear') || q.includes('how did you find') || q.includes('how did you learn') || q.includes('where did you')) return CUSTOM_QUESTION_ANSWERS.howHeard
  if (q.includes('source') && !q.includes('open source') && !q.includes('source code')) return CUSTOM_QUESTION_ANSWERS.howHeard
  if ((q.includes('referr') && (q.includes('employee') || q.includes('someone') || q.includes('who') || q.includes('by') || q.includes('name'))) || q.includes('recommend') || q.includes('who referred')) return CUSTOM_QUESTION_ANSWERS.referral

  // ─── 17. COVER LETTER / MOTIVATION / ABOUT YOU ─────────────────────
  if (q.includes('cover letter') || q.includes('lettre de motivation')) return CUSTOM_QUESTION_ANSWERS.coverLetter
  if (q.includes('why this role') || q.includes('why this position') || q.includes('why this company')) return CUSTOM_QUESTION_ANSWERS.coverLetter
  if (q.includes('additional information') || q.includes('additional comments') || q.includes('anything else')) return CUSTOM_QUESTION_ANSWERS.coverLetter
  if ((q.includes('why') && q.includes('interest')) || (q.includes('why') && q.includes('apply')) || (q.includes('why') && q.includes('join'))) return CUSTOM_QUESTION_ANSWERS.coverLetter
  if (q.includes('motivation') || q.includes('about yourself') || q.includes('tell us about')) return CUSTOM_QUESTION_ANSWERS.coverLetter

  // ─── 18. PORTFOLIO / WEBSITE / LINK ────────────────────────────────
  if (q.includes('portfolio') || q.includes('website') || q.includes('personal site')) return CUSTOM_QUESTION_ANSWERS.portfolio
  if (q.includes('url') || q.includes('link to your work') || q.includes('examples of') || q.includes('work samples')) return CUSTOM_QUESTION_ANSWERS.portfolio
  if (q.includes('linkedin') && (q.includes('url') || q.includes('profile') || q.includes('link'))) return PROFILE.linkedin || CUSTOM_QUESTION_ANSWERS.linkedin
  if (q.includes('github') || q.includes('dribbble') || q.includes('behance')) return CUSTOM_QUESTION_ANSWERS.portfolio

  // ─── 19. DATA / CONSENT / GDPR ────────────────────────────────────
  if (q.includes('data') && (q.includes('transfer') || q.includes('consent') || q.includes('process') || q.includes('protection') || q.includes('privacy'))) return CUSTOM_QUESTION_ANSWERS.dataConsent
  if (q.includes('gdpr') || q.includes('rgpd')) return CUSTOM_QUESTION_ANSWERS.dataConsent

  // ─── 20. ACCOMMODATIONS / INTERVIEW ────────────────────────────────
  if (q.includes('accommodat') || q.includes('special requirement') || q.includes('adjustment') || q.includes('accessibility need') || (q.includes('disability') && q.includes('require'))) return CUSTOM_QUESTION_ANSWERS.accommodations
  if (q.includes('interview') && (q.includes('consider') || q.includes('prefer') || q.includes('availab') || q.includes('schedule'))) return CUSTOM_QUESTION_ANSWERS.interviewAvailability

  // ─── 21. LANGUAGES / FLUENCY ───────────────────────────────────────
  if (q.includes('language') || q.includes('fluent') || (q.includes('proficien') && q.includes('english'))) return CUSTOM_QUESTION_ANSWERS.languages
  if (q.includes('french') || q.includes('français')) return CUSTOM_QUESTION_ANSWERS.french
  if (q.includes('english') && (q.includes('level') || q.includes('proficien') || q.includes('fluent'))) return 'Fluent / Professional working proficiency'

  // ─── 22. "ANYTHING ELSE" / OPEN-ENDED ─────────────────────────────
  if (q.includes('anything') && (q.includes('know') || q.includes('share') || q.includes('else') || q.includes('add'))) return `Portfolio: ${PROFILE.portfolio} — 7+ years as a Senior Product Designer specializing in design systems, complex product architecture, and design ops.`

  // ─── 23. BROADER INTEREST / MOTIVATION (catch-all) ─────────────────
  if (q.includes('interest') && (q.includes('role') || q.includes('position') || q.includes('company') || q.includes('job'))) return CUSTOM_QUESTION_ANSWERS.coverLetter
  if (q.includes('motivat') || (q.includes('why') && (q.includes('role') || q.includes('company') || q.includes('position')))) return CUSTOM_QUESTION_ANSWERS.coverLetter
  if (q.includes('tell us') || q.includes('describe') || q.includes('about yourself') || q.includes('summary') || q.includes('introduce')) return CUSTOM_QUESTION_ANSWERS.coverLetter

  // ─── 24. CONSENT / AGREEMENT (broad catch-all) ────────────────────
  if (q.includes('consent') || q.includes('agree') || q.includes('acknowledge') || q.includes('confirm') || q.includes('certify') || q.includes('attest') || q.includes('i understand')) return CUSTOM_QUESTION_ANSWERS.consent

  // ─── 25. TECH / TOOLS / STACK (open-ended) ────────────────────────
  if (q.includes('exciting tech') || q.includes('recently learned') || q.includes('new technology') || q.includes('latest tech') || q.includes('emerging tech')) return CUSTOM_QUESTION_ANSWERS.excitingTech
  if (q.includes('tech stack') || q.includes('technologies you use') || q.includes('technical stack') || q.includes('tools you use') || q.includes('what tools')) return CUSTOM_QUESTION_ANSWERS.techStack
  if (q.includes('favorite tool') || q.includes('favourite tool') || q.includes('preferred tool') || q.includes('go-to tool') || q.includes('go to tool')) return CUSTOM_QUESTION_ANSWERS.favoriteTool

  // ─── 26. MOTIVATION / INTEREST (open-ended) ───────────────────────
  if (q.includes('why this role') || q.includes('why are you applying') || q.includes('why do you want this') || q.includes('what draws you')) return CUSTOM_QUESTION_ANSWERS.whyRole
  if (q.includes('why this company') || q.includes('why do you want to work') || q.includes('why us') || q.includes('what attracts you')) return CUSTOM_QUESTION_ANSWERS.whyCompany
  if (q.includes('what excites you') || q.includes('what interests you') || q.includes('what are you passionate') || q.includes('what drives you') || q.includes('what motivates you')) return CUSTOM_QUESTION_ANSWERS.whatExcites

  // ─── 27. STRENGTHS / DIFFERENTIATORS ──────────────────────────────
  if (q.includes('greatest strength') || q.includes('biggest strength') || q.includes('key strength') || q.includes('top strength') || q.includes('main strength')) return CUSTOM_QUESTION_ANSWERS.greatestStrength
  if (q.includes('what makes you unique') || q.includes('unique about you') || q.includes('stand out') || q.includes('differentiate yourself')) return CUSTOM_QUESTION_ANSWERS.whatMakesUnique
  if (q.includes('what sets you apart') || q.includes('competitive advantage') || q.includes('why should we hire') || q.includes('why you')) return CUSTOM_QUESTION_ANSWERS.whatSetsApart

  // ─── 28. PROJECTS / IMPACT ────────────────────────────────────────
  if (q.includes('proudest project') || q.includes('favorite project') || q.includes('favourite project') || q.includes('best project') || q.includes('project you are most')) return CUSTOM_QUESTION_ANSWERS.proudestProject
  if (q.includes('most impactful') || q.includes('biggest impact') || q.includes('greatest achievement') || q.includes('accomplishment') || q.includes('achievement')) return CUSTOM_QUESTION_ANSWERS.mostImpactfulWork
  if (q.includes('tell us about a project') || q.includes('describe a project') || q.includes('recent project') || q.includes('side project')) return CUSTOM_QUESTION_ANSWERS.proudestProject

  // ─── 29. CHALLENGES / BEHAVIORAL ──────────────────────────────────
  if (q.includes('biggest challenge') || q.includes('greatest challenge') || q.includes('most difficult') || q.includes('toughest') || q.includes('hardest')) return CUSTOM_QUESTION_ANSWERS.biggestChallenge
  if (q.includes('describe a time') || q.includes('tell me about a time') || q.includes('give an example') || q.includes('share an example') || q.includes('walk us through')) return CUSTOM_QUESTION_ANSWERS.describeTimeWhen
  if (q.includes('how do you handle') || q.includes('how do you deal') || q.includes('how do you approach') || q.includes('how do you manage') || q.includes('how would you')) return CUSTOM_QUESTION_ANSWERS.howDoYouHandle

  // ─── 30. AVAILABILITY / SCHEDULING (extended) ─────────────────────
  if (q.includes('interview availability') || q.includes('when are you available') || q.includes('scheduling preference')) return CUSTOM_QUESTION_ANSWERS.whenAvailable
  if (q.includes('preferred time') || q.includes('preferred schedule') || q.includes('best time') || q.includes('time preference')) return CUSTOM_QUESTION_ANSWERS.preferredTime

  // ─── 31. AI / DESIGN PHILOSOPHY / SYSTEMS THINKING ────────────────
  if (q.includes('artificial intelligence') || q.includes('machine learning') || q.includes('ai experience') || q.includes('generative ai')) return CUSTOM_QUESTION_ANSWERS.aiExperience
  if (q.includes('design philosophy') || q.includes('design approach') || q.includes('design process') || q.includes('design thinking') || q.includes('how do you design')) return CUSTOM_QUESTION_ANSWERS.designPhilosophy
  if (q.includes('systems thinking') || q.includes('scalab') || q.includes('design at scale') || q.includes('component library') || q.includes('token')) return CUSTOM_QUESTION_ANSWERS.systemsThinking
  if (q.includes('accessibility') || q.includes('a11y') || q.includes('wcag') || q.includes('inclusive design')) return 'Strong commitment to accessibility — I conduct WCAG 2.1 AA audits on all design system components, build accessible color palettes with proper contrast ratios, and document accessibility guidelines within the system.'
  if (q.includes('user research') || q.includes('usability test') || q.includes('user testing')) return 'I integrate research into the design process using Maze for unmoderated testing, conduct stakeholder interviews, and use analytics data to validate design decisions. My design systems include built-in patterns for common accessibility and usability patterns.'
  if (q.includes('collaborat') || q.includes('cross-functional') || q.includes('work with engineers') || q.includes('work with developers')) return 'I excel at cross-functional collaboration. I run design-dev syncs, maintain Storybook documentation developers actually use, and build token pipelines that bridge the gap between design and code. My systems have reduced design-to-dev handoff friction by 90%.'
  if (q.includes('leadership') || q.includes('lead') && q.includes('team') || q.includes('manage') && q.includes('team') || q.includes('mentor')) return 'I have led design across 7 SaaS products, mentored junior designers, and facilitated cross-team alignment on design system adoption. My leadership style focuses on building shared understanding and empowering teams through scalable systems and clear documentation.'

  // ─── LAYER 2: Smart fallback — NEVER return null ──────────────────
  // If we reach here, no keyword matched. Use generateFallbackAnswer.
  const fallback = generateFallbackAnswer(questionText, fieldType, options)
  if (fallback) {
    logUnansweredQuestion(questionText, fallback)
    return fallback
  }

  // Absolute last resort — should never reach here
  logUnansweredQuestion(questionText, CUSTOM_QUESTION_ANSWERS.coverLetter)
  return CUSTOM_QUESTION_ANSWERS.coverLetter
}

// ═══════════════════════════════════════════════════════════════════════
// LAYER 2: Smart fallback answer generator
// Detects question category via sentiment/keyword heuristics and returns
// a contextual, professional answer. NEVER returns empty string.
// ═══════════════════════════════════════════════════════════════════════
function generateFallbackAnswer(questionText, fieldType, options) {
  const q = (questionText || '').toLowerCase().trim()

  // ── For radio/select with options: pick the most positive/affirmative option ──
  if (fieldType === 'radio' || fieldType === 'select') {
    if (options && options.length > 0) {
      const optTexts = options.map(o => (typeof o === 'string' ? o : o.text || o.label || o.value || '').toLowerCase())

      // Sensitive topics → prefer "Prefer not to say" / "Decline"
      const sensitiveKeywords = ['gender', 'race', 'ethnic', 'veteran', 'disability', 'orientation', 'religion', 'marital']
      const isSensitive = sensitiveKeywords.some(kw => q.includes(kw))
      if (isSensitive) {
        const declineOption = options.find((_, i) =>
          optTexts[i].includes('prefer not') || optTexts[i].includes('decline') ||
          optTexts[i].includes('choose not') || optTexts[i].includes('n/a')
        )
        if (declineOption) return typeof declineOption === 'string' ? declineOption : declineOption.text || declineOption.label || declineOption.value
      }

      // Affirmative: prefer "Yes" options
      const yesOption = options.find((_, i) =>
        optTexts[i] === 'yes' || optTexts[i].startsWith('yes')
      )
      if (yesOption) return typeof yesOption === 'string' ? yesOption : yesOption.text || yesOption.label || yesOption.value

      // Pick first non-empty, non-placeholder option
      const validOption = options.find((_, i) =>
        optTexts[i] && optTexts[i] !== '' && optTexts[i] !== 'select' &&
        optTexts[i] !== 'choose' && optTexts[i] !== '-- select --' &&
        optTexts[i] !== 'please select' && optTexts[i] !== 'select one' &&
        !optTexts[i].startsWith('--') && !optTexts[i].startsWith('select')
      )
      if (validOption) return typeof validOption === 'string' ? validOption : validOption.text || validOption.label || validOption.value
    }
    // If radio/select but no options provided, return Yes
    return 'Yes'
  }

  // ── For checkboxes: return affirmative ──
  if (fieldType === 'checkbox') {
    return 'Yes'
  }

  // ── For text fields: detect category and return contextual answer ──
  // Category detection via lightweight keyword groups
  const categories = [
    {
      keywords: ['tech', 'tool', 'stack', 'software', 'framework', 'language', 'programming', 'code', 'engineering', 'api', 'platform'],
      answer: CUSTOM_QUESTION_ANSWERS.excitingTech,
    },
    {
      keywords: ['why', 'interest', 'motivat', 'excite', 'passion', 'attract', 'drawn', 'appeal', 'inspir'],
      answer: CUSTOM_QUESTION_ANSWERS.whyRole,
    },
    {
      keywords: ['strength', 'unique', 'apart', 'differentiat', 'advantage', 'best quality', 'superpower'],
      answer: CUSTOM_QUESTION_ANSWERS.greatestStrength,
    },
    {
      keywords: ['project', 'achievement', 'accomplish', 'impact', 'proud', 'built', 'created', 'delivered', 'shipped'],
      answer: CUSTOM_QUESTION_ANSWERS.proudestProject,
    },
    {
      keywords: ['challenge', 'difficult', 'obstacle', 'problem', 'conflict', 'failure', 'mistake', 'tough', 'hard'],
      answer: CUSTOM_QUESTION_ANSWERS.biggestChallenge,
    },
    {
      keywords: ['time when', 'example', 'situation', 'walk us', 'tell me about', 'describe a', 'share a'],
      answer: CUSTOM_QUESTION_ANSWERS.describeTimeWhen,
    },
    {
      keywords: ['handle', 'approach', 'manage', 'deal with', 'cope', 'respond to', 'react to', 'prioriti'],
      answer: CUSTOM_QUESTION_ANSWERS.howDoYouHandle,
    },
    {
      keywords: ['design', 'ux', 'ui', 'figma', 'prototype', 'wireframe', 'mockup', 'user experience', 'visual'],
      answer: CUSTOM_QUESTION_ANSWERS.designPhilosophy,
    },
    {
      keywords: ['ai', 'machine learning', 'automat', 'artificial', 'generat'],
      answer: CUSTOM_QUESTION_ANSWERS.aiExperience,
    },
    {
      keywords: ['team', 'collaborat', 'work with', 'cross-functional', 'stakeholder', 'communicat'],
      answer: 'I thrive in cross-functional environments. With 7+ years leading design across multiple product teams, I have developed strong collaboration practices including design-dev syncs, shared documentation in Storybook and Zeroheight, and stakeholder alignment workshops.',
    },
    {
      keywords: ['learn', 'grow', 'develop', 'improve', 'goal', 'aspir', 'career', 'future', 'ambition', 'plan'],
      answer: 'I am focused on deepening my expertise in design systems architecture and AI-integrated design workflows. My goal is to lead design infrastructure at scale — building the systems, tools, and processes that enable product teams to ship better products faster.',
    },
    {
      keywords: ['culture', 'values', 'environment', 'workplace', 'ideal', 'thrive', 'work style', 'preference'],
      answer: 'I thrive in environments that value design quality, systematic thinking, and async-friendly collaboration. I am at my best when I can build scalable systems, document clearly, and see the direct impact of design infrastructure on product velocity.',
    },
  ]

  for (const cat of categories) {
    if (cat.keywords.some(kw => q.includes(kw))) {
      return cat.answer
    }
  }

  // ── No category matched: return a professional generic answer ──
  // For short text inputs, return concise. For textarea/long, return detailed.
  if (fieldType === 'textarea' || fieldType === 'long') {
    return 'I am a Senior Product Designer with 7+ years of experience specializing in design systems, complex product architecture, and design ops. I have led design across iGaming, B2B SaaS, and media platforms, delivering scalable systems that improved development feedback by 90% and managed 143+ templates across 7 SaaS products. Portfolio: https://www.floriangouloubi.com/'
  }

  // Default short answer for any text input
  return 'Senior Product Designer — 7+ years in design systems and product architecture. Portfolio: https://www.floriangouloubi.com/'
}

// ═══════════════════════════════════════════════════════════════════════
// LAYER 3: Log unanswered questions for future improvement
// Stores unmatched questions in chrome.storage.local so we can review
// and add specific keyword patterns later.
// ═══════════════════════════════════════════════════════════════════════
function logUnansweredQuestion(questionText, fallbackUsed) {
  const entry = {
    question: questionText.substring(0, 200),
    fallback: (fallbackUsed || '').substring(0, 100),
    url: window.location.href,
    timestamp: new Date().toISOString(),
  }

  log(`[FALLBACK] No keyword match for: "${questionText.substring(0, 80)}" — used fallback answer`)

  // Async — fire and forget, do not block form filling
  try {
    chrome.storage.local.get(['unansweredQuestions'], (result) => {
      const existing = result.unansweredQuestions || []
      // Deduplicate: skip if same question already logged (case-insensitive)
      const isDuplicate = existing.some(e =>
        e.question.toLowerCase().trim() === entry.question.toLowerCase().trim()
      )
      if (!isDuplicate) {
        // Keep last 200 entries max to avoid storage bloat
        const updated = [...existing, entry].slice(-200)
        chrome.storage.local.set({ unansweredQuestions: updated })
      }
    })
  } catch (e) {
    // Silently fail — logging should never break form filling
    warn('[FALLBACK] Could not log unanswered question:', e.message)
  }
}

// Detect validation errors on the form
function getValidationErrors() {
  const errors = []

  // Check for error classes
  const errorElements = document.querySelectorAll(
    '.field--error, .field-error, .error-message, .invalid-feedback, ' +
    '[class*="error"]:not([class*="error-hide"]), [aria-invalid="true"], ' +
    '.field.required.has-error, .required-error, .form-error'
  )
  for (const el of errorElements) {
    const text = el.textContent?.trim()
    if (text && text.length > 0 && text.length < 200) {
      errors.push(text)
    }
  }

  // Check for required fields that are empty
  const requiredInputs = document.querySelectorAll(
    'input[required]:not([type="hidden"]), select[required], textarea[required], ' +
    '.required input:not([type="hidden"]), .field.required input:not([type="hidden"])'
  )
  for (const input of requiredInputs) {
    if (!input.value || input.value.trim() === '') {
      const label = getLabelText(input)
      errors.push(`Empty required: ${label.trim().substring(0, 60)}`)
    }
  }

  return errors
}

async function handleGreenhouse(context) {
  log('Greenhouse ATS v2 — smart handler with exact IDs')

  // Greenhouse Remix pages are React SPAs — wait for hydration before interacting.
  // Poll for a key form element (#first_name or #application) up to 10s instead of
  // relying on a fixed sleep, which may be too short for heavy pages.
  const ghHydrationDeadline = Date.now() + 10000
  while (Date.now() < ghHydrationDeadline) {
    if (document.querySelector('#first_name') || document.querySelector('#application')) break
    await sleep(500)
  }
  // Still give a baseline wait for any remaining rendering
  await sleep(ATS_CONFIG.pageLoadWait)

  // Step 1: Click "Apply for this job" if on landing page
  // On Remix layouts the form is below the job description on the SAME page.
  // The Apply button triggers a smooth scroll to #application — we can't rely on
  // the scroll animation timing. Instead, after clicking, we scroll directly to the
  // form section and then poll until #first_name is in the viewport.
  const applyBtn = findAndClickButton(['Apply for this job', 'Apply now', 'Apply', 'Postuler'])
  if (applyBtn) {
    log('Clicking Greenhouse apply button...')
    applyBtn.click()
    await sleep(500) // Brief pause for any click handler side-effects

    // Scroll directly to the application section (don't rely on smooth scroll finishing)
    const appSection = document.querySelector('#application') || document.querySelector('[class*="application"]')
    if (appSection) {
      appSection.scrollIntoView({ behavior: 'instant', block: 'start' })
      log('Scrolled directly to #application section')
    }

    // Poll until #first_name is in the viewport (form is visible and interactable)
    const scrollDeadline = Date.now() + 10000
    while (Date.now() < scrollDeadline) {
      const fn = document.querySelector('#first_name')
      if (fn) {
        const rect = fn.getBoundingClientRect()
        if (rect.top >= 0 && rect.top < window.innerHeight) {
          log('#first_name is in viewport — form ready')
          break
        }
      }
      await sleep(500)
    }
    await sleep(500) // Small buffer after form becomes visible
  }

  // Step 2: Fill basic fields via confirmed Greenhouse IDs (#main_fields)
  // IMPORTANT: Fill #first_name and #last_name BEFORE #phone to avoid
  // intl-tel-input country search intercepting the name text.
  // Also fill phone LAST and use setReactValue (not humanType).
  const ghFieldsOrdered = [
    ['#first_name', PROFILE.firstName],
    ['#last_name', PROFILE.lastName],
    ['#email', PROFILE.email],
  ]
  for (const [sel, value] of ghFieldsOrdered) {
    const el = document.querySelector(sel)
    if (el && (!el.value || el.value.trim() === '')) {
      setReactValue(el, value)
      log(`Greenhouse ID ${sel} → ${value.substring(0, 20)}`)
      await sleep(300)
    }
  }

  // Handle intl-tel-input / country code BEFORE phone number
  // Greenhouse uses intl-tel-input library: flag dropdown + country list
  // v17+: .iti, v16-: .intl-tel-input — check both
  // IMPORTANT: On Greenhouse Remix, phone country uses React-Select (handled by fillPhoneCountryReactSelect).
  // Only use the ITI handler if the phone fieldset does NOT have a React-Select inside it.
  const phoneFieldset = document.querySelector('fieldset.phone-input, [class*="phone-input"]')
  const phoneHasReactSelect = phoneFieldset?.querySelector('.select-shell, [class*="select__control"]')
  const itiContainer = phoneHasReactSelect ? null : document.querySelector('.iti, .intl-tel-input, [class*="intl-tel-input"]')
  let itiCountrySelected = false

  if (itiContainer) {
    log('Detected intl-tel-input widget (no React-Select in phone):', itiContainer.className?.substring(0, 60))

    // Method 1: Click the flag button to open the dropdown, then select Thailand
    const flagSelectors = [
      '.iti__selected-flag',    // v17+ standard
      '.iti__flag-container',   // v17+ alt
      '.selected-flag',         // v16
      '.flag-container',        // v16 alt
      '[class*="selected-flag"]',
      // NOTE: removed [role="combobox"] — it matches the ITI search input, not the flag button
    ]
    let flagBtn = null
    for (const sel of flagSelectors) {
      flagBtn = itiContainer.querySelector(sel)
      if (flagBtn) break
    }
    // Fallback: first clickable element in the container that isn't an input
    if (!flagBtn) {
      flagBtn = itiContainer.querySelector('div[tabindex], button, a')
    }

    if (flagBtn) {
      // Some intl-tel-input versions need mousedown, not just click
      flagBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      flagBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      flagBtn.click()
      await sleep(1200) // Wait longer for dropdown animation
      log('Opened intl-tel-input dropdown')

      // Search for Thailand if search input exists
      // IMPORTANT: Only search INSIDE the .iti container — never use #country which is the React-Select combobox
      const searchSelectors = [
        '.iti__search-input',
        'input[type="search"]',
        'input[type="text"]:not(#phone):not(#country):not([role="combobox"])',
        '.country-search input',
        'input.search-box',
      ]
      let itiSearch = null
      for (const sel of searchSelectors) {
        itiSearch = itiContainer.querySelector(sel)
        if (itiSearch && itiSearch.offsetParent !== null) break
        itiSearch = null
      }
      if (itiSearch) {
        itiSearch.focus()
        itiSearch.value = ''
        itiSearch.dispatchEvent(new Event('input', { bubbles: true }))
        await sleep(100)
        // Type "thai" char by char for better filtering
        for (const char of 'thai') {
          itiSearch.value += char
          itiSearch.dispatchEvent(new Event('input', { bubbles: true }))
          itiSearch.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: char }))
          await sleep(80)
        }
        await sleep(600)
        log('Typed "thai" into intl-tel-input search')
      }

      // Click Thailand item by data attributes (most reliable)
      const thDataSelectors = [
        '#iti-0__item-th',
        '#iti-1__item-th',
        '[data-country-code="th"]',
        'li[data-dial-code="66"]',
        '.iti__country[data-country-code="th"]',
        '.country[data-dial-code="66"]',
        'li.iti__country[data-country-code="th"]',
      ]
      for (const sel of thDataSelectors) {
        const thItem = document.querySelector(sel)
        if (thItem && thItem.offsetParent !== null) {
          thItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
          thItem.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
          thItem.click()
          itiCountrySelected = true
          log('Selected Thailand (+66) via data selector:', sel)
          await sleep(300)
          break
        }
      }

      // Fallback: scan all visible country items for "Thailand" or "+66"
      if (!itiCountrySelected) {
        const countryListSelectors = [
          '.iti__country-list li',
          '.iti__country',
          '.country-list li',
          '[class*="country-list"] li',
          'ul.iti__country-list .iti__country',
        ]
        for (const listSel of countryListSelectors) {
          const items = document.querySelectorAll(listSel)
          if (items.length === 0) continue
          for (const item of items) {
            const text = item.textContent?.toLowerCase() || ''
            if (text.includes('thailand') || text.includes('+66') || text.includes('ไทย')) {
              item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
              item.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
              item.click()
              itiCountrySelected = true
              log('Selected Thailand via text scan of', listSel)
              await sleep(300)
              break
            }
          }
          if (itiCountrySelected) break
        }
      }

      // Close dropdown if nothing was selected
      if (!itiCountrySelected) {
        flagBtn.click()
        await sleep(200)
        log('Could not find Thailand in intl-tel-input dropdown')
      }
    } else {
      log('No flag button found in intl-tel-input container')
    }
  }

  // Standalone #country field (not part of intl-tel-input, or intl-tel-input failed)
  // IMPORTANT: Skip if #country is a React-Select combobox (Greenhouse Remix phone country)
  // — typing into a combobox puts React-Select in search mode, causing contamination
  if (!itiCountrySelected) {
    const countryInput = document.querySelector('#country')
    if (countryInput && !countryInput.closest('.select-shell, [class*="select-shell"]') && countryInput.getAttribute('role') !== 'combobox') {
      if (countryInput.tagName === 'SELECT') {
        const thOpt = Array.from(countryInput.options).find(o =>
          o.text.toLowerCase().includes('thailand') || o.value.toLowerCase().includes('th')
        )
        if (thOpt) {
          countryInput.value = thOpt.value
          countryInput.dispatchEvent(new Event('change', { bubbles: true }))
          log('Selected Thailand in #country select')
        }
      } else if (countryInput.type !== 'search') {
        setReactValue(countryInput, 'Thailand')
        log('Set #country input to Thailand')
      }
      await sleep(300)
    } else if (countryInput) {
      log('#country is React-Select combobox — skipping standalone fill (handled by fillReactSelectDropdowns)')
    }
  }

  // Now fill phone number (AFTER country code is set)
  const phoneInput = document.querySelector('#phone')
  if (phoneInput && (!phoneInput.value || phoneInput.value.trim() === '')) {
    // For intl-tel-input with country selected, enter local number only
    const phoneNumber = itiCountrySelected ? '618156481' : PROFILE.phone
    const phoneSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    if (phoneSetter) phoneSetter.call(phoneInput, phoneNumber)
    else phoneInput.value = phoneNumber
    phoneInput.dispatchEvent(new Event('input', { bubbles: true }))
    phoneInput.dispatchEvent(new Event('change', { bubbles: true }))
    phoneInput.dispatchEvent(new Event('blur', { bubbles: true }))
    log(`Greenhouse #phone → ${phoneNumber}`)
    await sleep(200)
  }

  // Fill preferred name if present
  const preferredName = document.querySelector('#preferred_name')
  if (preferredName && (!preferredName.value || preferredName.value.trim() === '')) {
    setReactValue(preferredName, PROFILE.firstName)
    log('Filled preferred_name')
  }

  // Step 3: Upload CV (attach mode first, paste fallback)
  let cvUploaded = false
  try { cvUploaded = await uploadGreenhouseCV() } catch(e) { warn('CV upload error:', e.message) }
  if (!cvUploaded) {
    // Fallback: click "Enter manually" button to switch to paste mode
    const pasteToggle = document.querySelector('[data-source="paste"]')
      || Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Enter manually')
    if (pasteToggle) {
      log('File upload failed — switching to paste mode via Enter manually')
      pasteToggle.click()
      await sleep(500)
      const resumeText = document.querySelector('#resume_text')
      if (resumeText) {
        setReactValue(resumeText, `Florian Gouloubi — Senior Product Designer\n${PROFILE.email} | ${PROFILE.phone}\n${PROFILE.portfolio}\n${PROFILE.linkedin}\n\n7+ years experience in design systems, complex product architecture, and design ops.\nIndustries: iGaming, B2B SaaS, media, biometric security.\nTools: Figma, Storybook, Zeroheight, Jira, Maze.\nEducation: Master UX — ESD (RNCP niveau 7)`)
        log('Pasted resume text as fallback')
      }
    }
  }

  // Step 3b: Generate and upload cover letter PDF to #cover_letter
  const coverLetterInput = document.querySelector('#cover_letter, input[type="file"][id*="cover"], input[type="file"][name*="cover"]')
  if (coverLetterInput && (!coverLetterInput.files || coverLetterInput.files.length === 0)) {
    const company = context?.company || 'your company'
    const role = context?.role || 'this role'
    const customCL = context?.coverLetter || ''
    const clFile = generateCoverLetterPDF(company, role, customCL)
    const uploaded = await uploadFileEnhanced(coverLetterInput, clFile)
    if (uploaded) {
      log('Cover letter PDF generated and uploaded for', company)
    } else {
      // Fallback: DataTransfer
      const dt = new DataTransfer()
      dt.items.add(clFile)
      coverLetterInput.files = dt.files
      coverLetterInput.dispatchEvent(new Event('change', { bubbles: true }))
      log('Cover letter PDF uploaded via DataTransfer fallback')
    }
  }

  // Step 4: Fill all generic fields (catches anything #main_fields IDs missed)
  try { await fillAllFormFields() } catch(e) { warn('fillAllFormFields error:', e.message) }

  // Step 5: Greenhouse-specific location autocomplete
  try { await fillGreenhouseLocation() } catch(e) { warn('fillGreenhouseLocation error:', e.message) }

  // Step 6: Greenhouse-specific custom questions (#custom_fields)
  try { await fillGreenhouseCustomQuestions() } catch(e) { warn('fillGreenhouseCustomQuestions error:', e.message) }

  // Step 7: Handle ALL React-Select + native select dropdowns (THE critical step)
  try { await fillReactSelectDropdowns() } catch(e) { warn('fillReactSelectDropdowns error:', e.message) }

  // Step 7a: Handle phone country React-Select (skipped by fillReactSelectDropdowns via isPhoneCountryShell)
  try { await fillPhoneCountryReactSelect() } catch(e) { warn('fillPhoneCountryReactSelect error:', e.message) }

  // Step 7b: Handle Select2 + native dropdowns (classic Greenhouse)
  try { await fillGreenhouseDropdowns() } catch(e) { warn('fillGreenhouseDropdowns error:', e.message) }

  // Step 7c: Label-based direct scan (catches questions in forms without .field containers)
  try { await fillByLabelScan() } catch(e) { warn('fillByLabelScan error:', e.message) }

  // Step 8: Consent checkboxes (GDPR, data processing, etc.)
  const checkboxes = document.querySelectorAll('input[type="checkbox"]:not(:checked)')
  for (const cb of checkboxes) {
    const labelInfo = getLabelText(cb)
    if (labelInfo.includes('consent') || labelInfo.includes('agree') || labelInfo.includes('privacy') ||
        labelInfo.includes('terms') || labelInfo.includes('data') || labelInfo.includes('acknowledge') ||
        labelInfo.includes('gdpr') || labelInfo.includes('accept')) {
      cb.click()
      await sleep(200)
      log('Checked consent checkbox')
    }
  }

  // Step 9: Pre-submit validation check
  const errors = getValidationErrors()
  if (errors.length > 0) {
    log('Pre-submit validation issues:', errors.length)
    errors.forEach(e => log('  -', e))
  }

  // Step 10: Scroll submit button into view for Greenhouse Remix
  // Greenhouse Remix forms can be very long (5000px+). The submit button at the bottom
  // may not be interactable via click() if it's far off-screen in some browser configs.
  const ghSubmitBtn = document.querySelector('.application--submit button, #submit_app, #application-form button[type="submit"], button[type="submit"]')
  if (ghSubmitBtn) {
    ghSubmitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' })
    await sleep(600)
    log('Scrolled to Greenhouse submit button:', (ghSubmitBtn.textContent || '').trim())
  }

  return true // Always try to proceed to submit
}

async function uploadGreenhouseCV() {
  // Greenhouse CV input selectors (ordered by specificity)
  // IMPORTANT: Only target resume/CV inputs, NOT cover_letter
  const selectors = [
    '#resume',
    '#s3_upload_for_resume',
    'input[type="file"][id*="resume"]',
    'input[type="file"][id*="cv"]',
    'input[type="file"][name*="resume"]',
    'input[type="file"][name*="cv"]',
    'input[type="file"][data-field="resume"]',
  ]

  for (const sel of selectors) {
    const fileInput = document.querySelector(sel)
    if (fileInput && (!fileInput.files || fileInput.files.length === 0)) {
      log('Found CV input:', sel)
      const success = await fetchAndUploadCV(fileInput)
      if (success) return true
    }
  }

  // Try click-to-upload buttons (some Greenhouse forms hide the file input)
  const uploadBtns = document.querySelectorAll(
    '[class*="upload"] button, [class*="attach"] button, ' +
    'button[class*="resume"], a[class*="upload"], ' +
    '.drop-zone, [class*="dropzone"]'
  )
  for (const btn of uploadBtns) {
    const text = (btn.textContent || '').toLowerCase()
    if (text.includes('upload') || text.includes('attach') || text.includes('resume') || text.includes('cv') || text.includes('drop')) {
      log('Clicking upload button to reveal file input...')
      btn.click()
      await sleep(1000)
      // After clicking, a file input might appear
      const newFileInput = document.querySelector('input[type="file"]:not([style*="display: none"])')
      if (newFileInput && (!newFileInput.files || newFileInput.files.length === 0)) {
        return await fetchAndUploadCV(newFileInput)
      }
    }
  }

  log('No CV input found on this page')
  return false
}

async function fillGreenhouseLocation() {
  // Greenhouse location field uses Google Places autocomplete
  // MUST type char-by-char and select from the .pac-item dropdown
  const locationSelectors = [
    '#candidate-location',              // Newer Greenhouse forms
    '#job_application_location',        // Classic Greenhouse
    '#candidate_location',
    'input[name*="location"]',
    'input[id*="location"]',
  ]

  for (const sel of locationSelectors) {
    const input = document.querySelector(sel)
    if (input && (!input.value || input.value.trim() === '')) {
      log('Filling Greenhouse location field:', sel)

      // Disable Chrome autofill to prevent interference
      input.setAttribute('autocomplete', 'nope')

      // Clear and focus
      input.focus()
      input.dispatchEvent(new Event('focus', { bubbles: true }))
      input.value = ''
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(300)

      // Type "Bangkok" char-by-char with proper keyboard events
      // Google Places needs keydown/keypress/keyup sequence to trigger
      const searchText = 'Bangkok'
      for (const char of searchText) {
        const keyCode = char.charCodeAt(0)
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: char, keyCode, which: keyCode, cancelable: true }))
        input.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: char, keyCode, which: keyCode, cancelable: true }))
        input.value += char
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }))
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: char, keyCode, which: keyCode }))
        await sleep(80)
      }
      input.dispatchEvent(new Event('change', { bubbles: true }))

      // Wait for Google Places dropdown to render (needs network request)
      log('Waiting for Google Places dropdown...')
      let pacItems = []
      for (let wait = 0; wait < 5; wait++) {
        await sleep(800)
        pacItems = document.querySelectorAll('.pac-item')
        if (pacItems.length > 0) break
      }
      log(`Found ${pacItems.length} .pac-item suggestions`)

      // Click the best matching .pac-item
      let clicked = false
      if (pacItems.length > 0) {
        // Priority 1: "Bangkok" + "Thailand"
        for (const item of pacItems) {
          const text = item.textContent?.toLowerCase() || ''
          if (text.includes('bangkok') && text.includes('thailand')) {
            item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
            item.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
            item.click()
            clicked = true
            log('Selected Google Places:', item.textContent?.trim()?.substring(0, 60))
            await sleep(500)
            break
          }
        }
        // Priority 2: first item with "Bangkok"
        if (!clicked) {
          for (const item of pacItems) {
            if (item.textContent?.toLowerCase()?.includes('bangkok')) {
              item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
              item.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
              item.click()
              clicked = true
              log('Selected first Bangkok:', item.textContent?.trim()?.substring(0, 60))
              await sleep(500)
              break
            }
          }
        }
        // Priority 3: first .pac-item regardless
        if (!clicked && pacItems[0]) {
          pacItems[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
          pacItems[0].dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
          pacItems[0].click()
          clicked = true
          log('Selected first pac-item:', pacItems[0].textContent?.trim()?.substring(0, 60))
          await sleep(500)
        }
      }

      if (!clicked) {
        // No Google Places suggestions — try ArrowDown+Enter
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown', keyCode: 40, which: 40 }))
        await sleep(200)
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 13, which: 13 }))
        await sleep(300)
        log('No pac-items — sent ArrowDown+Enter')

        // If still empty after all attempts, set value directly as last resort
        if (!input.value || input.value.trim() === '') {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          if (setter) setter.call(input, 'Bangkok, Thailand')
          else input.value = 'Bangkok, Thailand'
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
          log('Set location directly as fallback')
        }
      }

      input.dispatchEvent(new Event('blur', { bubbles: true }))
      log('Location field final value:', input.value?.substring(0, 50))
      break // Only fill first location field
    }
  }
}

async function fillGreenhouseCustomQuestions() {
  log('Scanning for custom questions (with classifyFieldContainer)...')

  // Greenhouse wraps custom questions in various containers — be aggressive
  const customContainers = document.querySelectorAll(
    '#custom_fields .field, .custom-field, .custom_fields .field, ' +
    '[class*="custom-question"], [class*="custom_field"], ' +
    '.field:not(.required-basic), ' +
    // Broader selectors for non-standard Greenhouse forms
    'form .field, .form-field, .question, [class*="question"], ' +
    '.application-field, [data-field], fieldset'
  )

  const processedInputs = new Set()

  for (const container of customContainers) {
    // Extract question text from multiple label sources
    const questionText = (
      container.querySelector('label, .field-label, [class*="label"], legend, h3, h4, .question-text, [class*="title"]')?.textContent?.trim()
      || container.getAttribute('aria-label')
      || ''
    )
    if (!questionText) continue

    // Skip phone fieldsets (intl-tel-input + React-Select country code)
    if (container.matches('fieldset.phone-input, [class*="phone-input"], [class*="phone-field"]') || container.closest('fieldset.phone-input, [class*="phone-input"]')) continue

    // ── CLASSIFY THE CONTAINER to determine what kind of input it holds ──
    const containerType = classifyFieldContainer(container)

    if (containerType === 'react-select') {
      // React-Select dropdowns are handled by fillReactSelectDropdowns (with CDP support)
      // Do NOT try to fill them as text inputs here
      log(`Custom Q [classify:react-select] skip: "${questionText.substring(0, 50)}" — handled by fillReactSelectDropdowns`)
      continue
    }

    if (containerType === 'text') {
      // ── Text inputs and textareas ──
      const textInput = container.querySelector('input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], input:not([type]), textarea')
      // Double-check: classifier might miss edge cases
      if (textInput && classifyFormField(textInput) !== 'text') {
        log(`Custom Q [classify:mismatch] "${questionText.substring(0, 50)}" — element classified as ${classifyFormField(textInput)}, skipping text fill`)
        continue
      }
      if (textInput && (!textInput.value || textInput.value.trim() === '') && !processedInputs.has(textInput)) {
        const isTextarea = textInput.tagName === 'TEXTAREA'
        const answer = answerCustomQuestion(questionText, isTextarea ? 'textarea' : 'text') || matchFieldToValue(getLabelText(textInput))
        if (answer) {
          const actualValue = answer === '___PHONE___' ? PROFILE.phone : answer
          _fillTextField(textInput, actualValue)
          processedInputs.add(textInput)
          log(`Custom Q [classify:text] [${questionText.substring(0, 50)}] -> ${actualValue.substring(0, 40)}...`)
          await sleep(300)
        }
      }
    } else if (containerType === 'select') {
      // ── Native <select> dropdown ──
      const select = container.querySelector('select')
      if (select && (!select.value || select.selectedIndex <= 0) && !processedInputs.has(select)) {
        // Extract option texts for smart fallback
        const selectOptions = Array.from(select.options).map(o => ({ text: o.text, value: o.value, label: o.text }))
        const answer = answerCustomQuestion(questionText, 'select', selectOptions)
        if (answer) {
          if (_fillNativeSelect(select, answer)) {
            processedInputs.add(select)
            log(`Custom Q [classify:select] [${questionText.substring(0, 50)}] -> ${answer.substring(0, 30)}`)
          }
        }
        await sleep(300)
      }
    } else if (containerType === 'radio') {
      // ── Radio buttons ──
      const radios = container.querySelectorAll('input[type="radio"]')
      if (radios.length > 0 && !Array.from(radios).some(r => r.checked)) {
        // Extract radio label texts for smart fallback
        const radioOptions = Array.from(radios).map(r => {
          const lbl = r.labels?.[0]?.textContent?.trim() || r.closest('label')?.textContent?.trim() || r.value
          return { text: lbl, value: r.value, label: lbl }
        })
        const answer = answerCustomQuestion(questionText, 'radio', radioOptions)
        if (answer) {
          const filled = await _fillRadioField(container, answer)
          if (filled) {
            log(`Custom Q [classify:radio] [${questionText.substring(0, 50)}] -> ${answer.substring(0, 30)}`)
          }
        }
      }
    } else if (containerType === 'checkbox') {
      // ── Checkboxes ──
      const cb = container.querySelector('input[type="checkbox"]')
      if (cb && !cb.checked) {
        const answer = answerCustomQuestion(questionText, 'checkbox')
        if (answer) {
          _fillCheckboxField(cb, answer)
          log(`Custom Q [classify:checkbox] [${questionText.substring(0, 50)}] -> ${answer.substring(0, 30)}`)
        }
      }
    }
    // containerType === 'file' or 'unknown' — skip (handled elsewhere)
  }

  // ── Catch-all: fill any remaining empty textareas that weren't matched above ──
  const allTextareas = document.querySelectorAll('textarea')
  for (const ta of allTextareas) {
    if (ta.value && ta.value.trim().length > 0) continue
    if (processedInputs.has(ta)) continue
    if (ta.id === 'resume_text') continue
    // Classify to be safe — skip if it's inside a React-Select
    if (classifyFormField(ta) !== 'text') continue

    const labelInfo = getLabelText(ta)
    const containerLabel = ta.closest('.field, .form-field, fieldset, [class*="question"]')
      ?.querySelector('label, legend, .field-label, [class*="label"]')?.textContent?.trim() || ''
    const combinedLabel = labelInfo + ' ' + containerLabel.toLowerCase()

    let answer = answerCustomQuestion(combinedLabel, 'textarea')
    // answerCustomQuestion now always returns a non-null answer via fallback
    if (!answer) {
      // Defensive: should never happen, but just in case
      answer = CUSTOM_QUESTION_ANSWERS.coverLetter
      log(`Catch-all: filling required empty textarea [${combinedLabel.substring(0, 60)}] with cover letter`)
    }
    if (answer) {
      _fillTextField(ta, answer)
      log(`Catch-all textarea [classify:text] [${combinedLabel.substring(0, 50)}] -> filled`)
    }
  }
}

// ── Label-based direct scan (no container dependency) ───────────────
// Scans ALL <label> elements, finds their associated input via `for` attribute,
// and fills using answerCustomQuestion. Works on Greenhouse forms that don't use
// .field container wrappers.
async function fillByLabelScan() {
  log('Running label-based direct scan (with classifyFormField)...')
  let filledCount = 0

  const allLabels = document.querySelectorAll('label')
  for (const label of allLabels) {
    const labelText = label.textContent?.trim() || ''
    if (labelText.length < 3) continue

    // Find associated input via for attribute
    const forAttr = label.getAttribute('for')
    if (!forAttr) continue
    const input = document.getElementById(forAttr)
    if (!input) continue

    // ── CLASSIFY the input FIRST ──
    const fieldType = classifyFormField(input)

    // Only fill text fields here — selects/radios/checkboxes/react-selects
    // are handled by their dedicated functions. This prevents the bug where
    // label scan types text into a dropdown or radio group.
    if (fieldType !== 'text') {
      if (fieldType === 'react-select') {
        log(`Label scan [classify:react-select] skip: "${labelText.substring(0, 50)}" — handled by fillReactSelectDropdowns`)
      }
      continue
    }

    // Skip if already filled
    if (input.value && input.value.trim().length > 0) continue
    // Skip recaptcha
    if (input.name === 'g-recaptcha-response') continue
    // Skip country + candidate-location (handled by ATS-specific code)
    if (input.id === 'country' || input.id === 'candidate-location') continue
    // Skip EEO/demographic fields
    const eeoIds = ['gender', 'race', 'ethnicity', 'hispanic_ethnicity', 'veteran_status', 'disability_status']
    if (eeoIds.includes(input.id) || input.id?.startsWith('4014') || input.id?.startsWith('4015')) continue

    // Try answerCustomQuestion with the label text + aria-label
    const ariaLabel = input.getAttribute('aria-label') || ''
    const combinedText = labelText + ' ' + ariaLabel
    const isTextarea = input.tagName === 'TEXTAREA'
    const answer = answerCustomQuestion(combinedText, isTextarea ? 'textarea' : 'text') || matchFieldToValue(combinedText.toLowerCase())
    if (!answer) continue

    const actualValue = answer === '___PHONE___' ? PROFILE.phone : answer

    // Fill using the unified text fill helper
    _fillTextField(input, actualValue)
    filledCount++
    log(`Label scan [classify:text] [${labelText.substring(0, 55)}] -> ${actualValue.substring(0, 40)}`)
    await sleep(200)
  }

  log(`Label scan filled ${filledCount} fields (with classifier)`)
  return filledCount
}

// ── React-Select Dropdown Handler (UNIVERSAL — works on all ATS) ────────
// Modern ATS (Greenhouse, Lever, Workable) use React-Select for dropdowns.
// These render as: div.select-shell > div.select__control > input[role="combobox"]
// There is NO native <select> — must click to open, then click an option.
//
// Detection: look for div.select-shell, div[class*="select__control"], or
// input[role="combobox"][class*="select__input"]
// ─── CDP Trusted Click Helpers ───────────────────────────────────────
// React-Select ONLY responds to isTrusted:true mouse events.
// Content scripts dispatch isTrusted:false synthetic events.
// These helpers use chrome.debugger CDP via the background service worker.

function sendChromeMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        warn('chrome.runtime error:', chrome.runtime.lastError.message)
        resolve({ success: false, error: chrome.runtime.lastError.message })
      } else {
        resolve(resp || { success: false })
      }
    })
  })
}

async function debuggerAttach() {
  const resp = await sendChromeMessage({ action: 'debuggerAttach' })
  if (resp.success) log('CDP debugger attached')
  else warn('CDP debugger attach failed:', resp.error)
  return resp.success
}

async function debuggerDetach() {
  await sendChromeMessage({ action: 'debuggerDetach' })
  log('CDP debugger detached')
}

function sendTrustedClick(x, y) {
  return sendChromeMessage({ action: 'trustedClick', x, y }).then(r => r?.success || false)
}

function sendTrustedEscape() {
  return sendChromeMessage({ action: 'trustedKeypress', key: 'Escape', code: 'Escape', keyCode: 27 }).then(r => r?.success || false)
}

// Get absolute page coordinates for an element (accounts for scroll)
function getElementCenter(el) {
  const rect = el.getBoundingClientRect()
  return {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2),
  }
}

// Scroll element into view and return its center coordinates
function scrollAndGetCenter(el) {
  el.scrollIntoView({ block: 'center', behavior: 'instant' })
  return getElementCenter(el)
}

// Match an answer string against a list of React-Select option elements
function findBestOption(menuOptions, answer) {
  const ansLower = answer.toLowerCase().trim()
  const isYes = ansLower.startsWith('yes') || ansLower.includes('yes —') || ansLower.includes('yes,')
  const isNo = ansLower === 'no' || ansLower.startsWith('no ') || ansLower.startsWith('no,') || ansLower.startsWith('no —')

  let bestMatch = null
  for (const opt of menuOptions) {
    const optText = opt.textContent?.trim().toLowerCase() || ''

    // Exact match
    if (optText === ansLower) { bestMatch = opt; break }

    // STRICT Yes/No matching (avoid "Lebanon".includes("no") bugs)
    if (isYes && (optText === 'yes' || optText.startsWith('yes,') || optText.startsWith('yes -') || optText.startsWith('yes —') || optText.startsWith('yes.'))) { bestMatch = opt; break }
    if (isNo && (optText === 'no' || optText.startsWith('no,') || optText.startsWith('no -') || optText.startsWith('no —') || optText.startsWith('no.'))) { bestMatch = opt; break }

    // LinkedIn / source matching
    if (ansLower.includes('linkedin') && optText.includes('linkedin')) { bestMatch = opt; break }
    if (ansLower.includes('linkedin') && optText.includes('job board')) { bestMatch = bestMatch || opt }
    if (ansLower.includes('linkedin') && optText.includes('social media')) { bestMatch = bestMatch || opt }
    if (ansLower.includes('linkedin') && optText.includes('online')) { bestMatch = bestMatch || opt }
    if (ansLower.includes('linkedin') && optText.includes('other')) { bestMatch = bestMatch || opt }

    // EEO: prefer opt-out options (many different wordings across ATS)
    if ((ansLower.includes('decline') || ansLower.includes('prefer not')) &&
        (optText.includes('decline') || optText.includes('prefer not') || optText.includes('not wish') ||
         optText.includes('not declared') || optText.includes('not specified') ||
         optText.includes('do not want to answer') || optText.includes("don't wish") ||
         optText.includes('choose not') || optText.includes('rather not') ||
         optText.includes('i do not wish') || optText.includes('opt out') ||
         optText.includes('not disclose'))) { bestMatch = opt; break }

    // Education: match degree level
    if (ansLower.includes('bachelor') && optText.includes('bachelor')) { bestMatch = opt; break }
    if (ansLower.includes('master') && optText.includes('master')) { bestMatch = opt; break }

    // Immediately / available now (for start date dropdowns)
    if (ansLower.includes('immediately') && (optText.includes('immediately') || optText.includes('asap') || optText.includes('right away') || optText.includes('2 weeks') || optText.includes('less than'))) { bestMatch = opt; break }

    // Full-time employment type
    if (ansLower.includes('full-time') && (optText.includes('full-time') || optText.includes('full time'))) { bestMatch = opt; break }

    // Partial match — only for LONG answers (>5 chars) to avoid false positives
    if (ansLower.length > 5 && (optText.includes(ansLower) || ansLower.includes(optText))) { bestMatch = opt; break }
  }
  return bestMatch
}

// ─── Shell Filter: Is this a phone country code selector? ───────────
// .closest() only looks UP — but phone .select-shell has .iti as a CHILD.
// This helper checks both ancestors AND descendants for phone/intl-tel markers.
function isPhoneCountryShell(el) {
  // ── Ancestor checks ──
  // Original: .iti is an ancestor
  if (el.closest('.iti, .intl-tel-input, [class*="intl-tel"]')) return true
  // Greenhouse Remix: phone-input__country, phone-input, phone-field, etc.
  if (el.closest('[class*="phone-input"], [class*="phone-field"], [class*="phoneInput"], fieldset.phone-input')) return true

  // ── Descendant checks ──
  // .iti is a CHILD of .select-shell on some Greenhouse versions
  if (el.querySelector('.iti, .intl-tel-input, [class*="intl-tel"], input[type="tel"], .iti__flag-container, .iti__selected-flag')) return true

  // ── React-Select ID/name check ──
  // Greenhouse Remix uses id="react-select-country-live-region" inside the phone country shell
  const liveRegion = el.querySelector('[id*="react-select-country"]')
  if (liveRegion) return true
  // Check the combobox input's id/name
  const comboInput = el.querySelector('input[role="combobox"]')
  if (comboInput) {
    const inputId = comboInput.id || ''
    const inputName = comboInput.name || ''
    // react-select-country-input, country-code, phone-country, etc.
    if (/country/i.test(inputId) && el.closest('[class*="phone"], fieldset')) return true
    if (/phone.*country|country.*code/i.test(inputId) || /phone.*country|country.*code/i.test(inputName)) return true
  }

  // ── Label-based check ──
  // If nearest field wrapper says "Phone" and has a tel input nearby
  const wrapper = el.closest('.field-wrapper, .field, .form-field, [class*="field"], fieldset')
  if (wrapper) {
    const label = wrapper.querySelector('label')?.textContent?.toLowerCase() || ''
    if ((label.includes('phone') || label.includes('mobile') || label.includes('tel')) && wrapper.querySelector('input[type="tel"]')) return true
    // Greenhouse Remix: label is "Country*" inside a phone-input fieldset
    if (label.includes('country') && wrapper.matches('[class*="phone"], fieldset.phone-input, [class*="phone-input"]')) return true
  }

  // ── Aria content check ──
  // The live region text mentions country codes like "Thailand +66"
  const ariaText = el.querySelector('[id*="live-region"], [aria-live]')?.textContent?.trim() || ''
  if (/\+\d{1,4}/.test(ariaText) && /country|code/i.test(ariaText + ' ' + (el.closest('[class*="phone"]')?.className || ''))) return true

  // ── Placeholder/value pattern check ──
  const placeholder = el.querySelector('[class*="select__placeholder"], [class*="placeholder"]')?.textContent?.trim() || ''
  if (/^\+?\d{1,4}$/.test(placeholder)) return true
  // Check for existing single value that looks like a country code
  const val = el.querySelector('[class*="select__single-value"], [class*="singleValue"]')?.textContent?.trim() || ''
  if (/^.{0,3}\+\d{1,4}/.test(val) || /^\w+\s*\+\d{1,4}$/.test(val)) return true

  return false
}

// ─── Menu Sanity Check: Does this menu belong to a phone country selector? ───
function isPhoneCountryMenu(menu) {
  const options = menu.querySelectorAll('[class*="select__option"], [role="option"]')
  if (options.length === 0) return false
  // Sample first 5 options — if most look like country codes, it's a phone menu
  let phonePatternCount = 0
  const sample = Array.from(options).slice(0, 5)
  for (const opt of sample) {
    const t = opt.textContent?.trim() || ''
    // Matches: "Thailand +66", "United States +1", "+66", "🇹🇭 Thailand +66"
    if (/\+\d{1,4}\s*$/.test(t) || /^\+\d{1,4}$/.test(t)) phonePatternCount++
  }
  return phonePatternCount >= Math.min(3, sample.length)
}

// ─── Dismiss all open React-Select menus before starting fresh ───
async function dismissAllOpenMenus(useCDP) {
  const openMenus = document.querySelectorAll('[class*="select__menu"], [role="listbox"]')
  const openItiLists = document.querySelectorAll('.iti__country-list:not(.iti__hide)')
  const totalOpen = openMenus.length + openItiLists.length
  if (totalOpen > 0) {
    log(`Dismissing ${totalOpen} open menu(s) before processing...`)
    if (useCDP) {
      // Escape key is the standard way to close React-Select dropdowns
      await sendTrustedEscape()
      await sleep(200)
      // Double-tap Escape for stubborn menus (intl-tel-input needs its own Escape)
      if (document.querySelectorAll('[class*="select__menu"], [role="listbox"]').length > 0) {
        await sendTrustedEscape()
        await sleep(200)
      }
    } else {
      // Dispatch Escape key event (more reliable than body.click for React-Select)
      const escEvt = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
      ;(document.activeElement || document.body).dispatchEvent(escEvt)
      await sleep(100)
      document.body.click()
      await sleep(200)
    }
    // Also blur any focused combobox to prevent re-opening
    const focused = document.activeElement
    if (focused?.role === 'combobox' || focused?.closest?.('.select-shell')) {
      focused.blur()
      await sleep(100)
    }
  }
}

async function fillReactSelectDropdowns() {
  log('Scanning for React-Select dropdowns (CDP trusted clicks v4 + DOM fallback)...')
  let filledCount = 0
  const processed = new Set()
  let debuggerActive = false

  // ──── Helpers: ARIA + class-based selectors for Greenhouse Remix CSS modules ────
  // Greenhouse Remix uses CSS modules (class="css-1a2b3c-control" instead of "select__control")
  // so [class*="select__menu"] won't match. Use [role="listbox"] and [role="option"] as fallbacks.
  function findMenu(root) {
    return root.querySelector('[class*="select__menu"], [class*="-menu"][role="listbox"], [role="listbox"]')
  }
  function findMenuGlobal() {
    return document.querySelector('[class*="select__menu"], [class*="-menu"][role="listbox"], [role="listbox"]')
  }
  function findOptions(menu) {
    return Array.from(menu.querySelectorAll('[class*="select__option"], [role="option"]'))
      .filter(el => !el.closest('.iti, .intl-tel-input'))
  }
  function findSelectedValue(root) {
    return root.querySelector('[class*="select__single-value"], [class*="singleValue"], [class*="-singleValue"]')
  }

  // Find all React-Select instances via .select-shell wrapper
  const allRoots = new Set()
  document.querySelectorAll('.select-shell').forEach(el => {
    if (isPhoneCountryShell(el)) { log('Skipping phone country shell:', el.className?.substring(0, 40)); return }
    allRoots.add(el)
  })
  // Fallback: find by combobox inputs (broad — catches Remix CSS module class names)
  document.querySelectorAll('input[role="combobox"]').forEach(cb => {
    const shell = cb.closest('.select-shell, [class*="select__container"], [class*="css-"][class*="container"], [class*="-container"]')
    if (!shell || isPhoneCountryShell(shell)) return
    allRoots.add(shell)
  })
  // Also find generic React-Select without .select-shell (other ATS platforms)
  document.querySelectorAll('[class*="select__control"]').forEach(ctrl => {
    const shell = ctrl.closest('.select-shell, [class*="select__container"], [class*="css-"][class*="container"]')
    if (!shell || isPhoneCountryShell(shell)) return
    allRoots.add(shell)
  })
  // Greenhouse Remix: find by CSS module control classes (css-XXXX-control)
  document.querySelectorAll('[class*="-control"]').forEach(ctrl => {
    // Only match if it looks like a React-Select control (has a combobox input inside)
    if (!ctrl.querySelector('input[role="combobox"]')) return
    const shell = ctrl.closest('.select-shell, [class*="select__container"], [class*="css-"][class*="container"], [class*="-container"]') || ctrl.parentElement
    if (!shell || isPhoneCountryShell(shell)) return
    allRoots.add(shell)
  })

  log(`Found ${allRoots.size} React-Select instances (after phone filtering)`)

  for (const shell of allRoots) {
    // Skip if already has a selected value
    const hasValue = findSelectedValue(shell)
    if (hasValue && hasValue.textContent?.trim()) {
      log(`React-Select skip — already has value: "${hasValue.textContent.trim().substring(0, 30)}"`)
      continue
    }

    // Find the question label — multiple strategies for robustness
    let questionText = ''
    // Strategy 1: Check for label with `for` attribute matching a nearby input
    const comboInput = shell.querySelector('input[role="combobox"]')
    const inputId = comboInput?.id || comboInput?.getAttribute('aria-labelledby')
    if (inputId) {
      // Check for label[for="..."] or aria-labelledby
      const forLabel = document.querySelector(`label[for="${inputId.replace('react-select-', '').replace('-input', '')}"]`)
      if (forLabel) questionText = forLabel.textContent?.trim() || ''
      // Also try aria-labelledby pointing to an element by ID
      if (!questionText && comboInput?.getAttribute('aria-labelledby')) {
        const ariaLabel = document.getElementById(comboInput.getAttribute('aria-labelledby'))
        if (ariaLabel) questionText = ariaLabel.textContent?.trim() || ''
      }
    }
    // Strategy 2: Walk up to field-wrapper and find label
    if (!questionText) {
      const fieldWrapper = shell.closest('.field-wrapper, .field, .form-field, [class*="field"], [class*="question"]')
      if (fieldWrapper) {
        // Only use label if it's a DIRECT child or nearby (not from a sibling field)
        const labelEl = fieldWrapper.querySelector('label, legend, .field-label, [class*="label"]:not([class*="select__"])')
        if (labelEl) questionText = labelEl.textContent?.trim() || ''
      }
    }
    // Strategy 3: Check parent's previous sibling (label before select)
    if (!questionText) {
      const prev = shell.parentElement?.previousElementSibling
      if (prev?.tagName === 'LABEL') questionText = prev.textContent?.trim() || ''
    }
    // Strategy 4: Walk up DOM tree until we find a label
    if (!questionText) {
      let el = shell.parentElement
      for (let i = 0; i < 5 && el; i++) {
        const lbl = el.querySelector('label')
        if (lbl && !lbl.closest('.select-shell')) { questionText = lbl.textContent?.trim() || ''; break }
        el = el.parentElement
      }
    }
    if (questionText.length < 3 || processed.has(questionText)) continue
    processed.add(questionText)

    // Get answer for this question (pass 'select' fieldType for smart fallback)
    const answer = answerCustomQuestion(questionText, 'select')
    if (!answer) {
      log(`React-Select skip — no answer for: "${questionText.substring(0, 60)}"`)
      continue
    }

    log(`React-Select: filling "${questionText.substring(0, 50)}" → "${answer}"`)

    // Attach CDP debugger on first dropdown (stays attached for all) — retry up to 3 times
    if (!debuggerActive) {
      for (let attempt = 0; attempt < 3 && !debuggerActive; attempt++) {
        debuggerActive = await debuggerAttach()
        if (!debuggerActive && attempt < 2) {
          log(`CDP attach attempt ${attempt + 1} failed, retrying...`)
          await sleep(500)
        }
      }
      if (!debuggerActive) {
        warn('CDP debugger not available after 3 attempts — using synthetic events + React props fallback')
      }
      await sleep(300)
    }

    // ──── DISMISS any open menus + blur previous element before opening new dropdown ────
    await dismissAllOpenMenus(debuggerActive)
    // Explicitly blur any previously focused element to prevent stale focus
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur()
      await sleep(100)
    }

    // ──── OPEN DROPDOWN: CDP click first (most reliable for cold React-Select) ────
    // Also match Greenhouse Remix CSS module classes (css-XXXX-control)
    const control = shell.querySelector('[class*="select__control"]')
      || shell.querySelector('[class*="-control"]:has(input[role="combobox"])')
      || shell
    // Find combobox input — be very broad to catch Remix CSS module class names
    let comboboxInput = shell.querySelector('input[role="combobox"]')
    if (!comboboxInput) comboboxInput = shell.querySelector('input[class*="select__input"]')
    if (!comboboxInput) comboboxInput = shell.querySelector('input[class*="nput"]') // catches remix-css-XXXX-input
    if (!comboboxInput) comboboxInput = shell.querySelector('input:not([type="hidden"])')

    // ──── CLEAR any leftover text in combobox (prevents search-mode corruption) ────
    if (comboboxInput && comboboxInput.value) {
      log(`React-Select: clearing leftover text "${comboboxInput.value}" from combobox`)
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      if (nativeSetter) nativeSetter.call(comboboxInput, '')
      else comboboxInput.value = ''
      comboboxInput.dispatchEvent(new Event('input', { bubbles: true }))
      comboboxInput.dispatchEvent(new Event('change', { bubbles: true }))
      await sleep(100)
    }

    // Scroll into view so the menu can render visually
    control.scrollIntoView({ block: 'center', behavior: 'instant' })
    await sleep(200)

    // ──── Helper: send ArrowDown via CDP or synthetic fallback ────
    async function sendArrowDown() {
      if (debuggerActive) {
        await sendChromeMessage({ action: 'trustedKeypress', key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 })
      } else {
        // Synthetic fallback (isTrusted=false — may not work on all React-Selects)
        const target = document.activeElement || comboboxInput || control
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }))
      }
    }

    // Method 1 (PRIMARY): CDP click on control — activates React-Select from cold state
    let menu = null
    if (debuggerActive) {
      const controlRect = control.getBoundingClientRect()
      const cx = Math.round(controlRect.left + controlRect.width / 2)
      const cy = Math.round(controlRect.top + controlRect.height / 2)
      log(`React-Select: CDP click on control at (${cx}, ${cy})`)
      await sendTrustedClick(cx, cy)
      await sleep(600)
      menu = findMenu(shell)

      // CDP click may have focused the control without opening — send ArrowDown
      if (!menu) {
        await sendArrowDown()
        await sleep(500)
        menu = findMenu(shell)
      }
    }

    // Method 2: Focus combobox input + ArrowDown
    if (!menu && comboboxInput) {
      log('React-Select: trying focus + ArrowDown...')
      comboboxInput.focus()
      comboboxInput.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
      comboboxInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      await sleep(200)
      await sendArrowDown()
      await sleep(500)
      menu = findMenu(shell)
    }

    // Method 3 (ENHANCED): Full synthetic event sequence on control — mimics real user click
    // React-Select v5 listens for onMouseDown on the control div. We dispatch a complete
    // mousedown → mouseup → click sequence with correct coordinates to trigger it.
    if (!menu) {
      log('React-Select: trying full synthetic mousedown/mouseup/click on control...')
      const ctrlRect = control.getBoundingClientRect()
      const evtInit = {
        bubbles: true, cancelable: true, button: 0,
        clientX: Math.round(ctrlRect.left + ctrlRect.width / 2),
        clientY: Math.round(ctrlRect.top + ctrlRect.height / 2),
        view: window,
      }
      control.dispatchEvent(new MouseEvent('mousedown', evtInit))
      await sleep(50)
      control.dispatchEvent(new MouseEvent('mouseup', evtInit))
      await sleep(50)
      control.dispatchEvent(new MouseEvent('click', evtInit))
      await sleep(400)
      if (comboboxInput) { comboboxInput.focus(); await sleep(100) }
      menu = findMenu(shell)
      // If control click didn't open, try ArrowDown with focus
      if (!menu && comboboxInput) {
        await sendArrowDown()
        await sleep(500)
        menu = findMenu(shell)
      }
    }

    // Method 4: CDP click on dropdown indicator (the arrow icon)
    if (!menu && debuggerActive) {
      const indicator = shell.querySelector('[class*="select__indicator"], [class*="select__dropdown-indicator"], [class*="indicatorContainer"], [class*="-indicatorContainer"]')
      if (indicator) {
        log('React-Select: trying CDP click on dropdown indicator...')
        const indRect = indicator.getBoundingClientRect()
        await sendTrustedClick(Math.round(indRect.left + indRect.width / 2), Math.round(indRect.top + indRect.height / 2))
        await sleep(600)
        menu = findMenu(shell)
      }
    }

    // Method 4b: Synthetic click on dropdown indicator (non-CDP fallback)
    if (!menu) {
      const indicator = shell.querySelector('[class*="select__indicator"], [class*="select__dropdown-indicator"], [class*="indicatorContainer"], [class*="-indicatorContainer"], svg')
      if (indicator) {
        log('React-Select: trying synthetic click on dropdown indicator...')
        const indRect = indicator.getBoundingClientRect()
        const indEvtInit = {
          bubbles: true, cancelable: true, button: 0,
          clientX: Math.round(indRect.left + indRect.width / 2),
          clientY: Math.round(indRect.top + indRect.height / 2),
          view: window,
        }
        indicator.dispatchEvent(new MouseEvent('mousedown', indEvtInit))
        await sleep(50)
        indicator.dispatchEvent(new MouseEvent('mouseup', indEvtInit))
        await sleep(50)
        indicator.dispatchEvent(new MouseEvent('click', indEvtInit))
        await sleep(500)
        menu = findMenu(shell)
      }
    }

    // Method 5: React internal props (works without CDP — calls React's own handlers)
    if (!menu) {
      log('React-Select: trying React internal props...')
      // Walk children to find the element with onMouseDown (may be a nested div in CSS modules)
      const candidates = [control, ...control.querySelectorAll('div')]
      for (const candidate of candidates) {
        if (menu) break
        const cProps = getReactProps(candidate)
        if (cProps?.onMouseDown) {
          cProps.onMouseDown({ preventDefault: () => {}, button: 0 })
          await sleep(500)
          menu = findMenu(shell)
        }
        if (!menu && cProps?.onClick) {
          cProps.onClick({ preventDefault: () => {} })
          await sleep(500)
          menu = findMenu(shell)
        }
      }
      // Try on the shell itself
      if (!menu) {
        const shellProps = getReactProps(shell)
        if (shellProps?.onMouseDown) {
          shellProps.onMouseDown({ preventDefault: () => {}, button: 0 })
          await sleep(500)
          menu = findMenu(shell)
        }
      }
    }

    // Check global menu (portal) but reject phone country menus
    if (!menu) {
      const globalMenu = findMenuGlobal()
      if (globalMenu && !isPhoneCountryMenu(globalMenu)) {
        menu = globalMenu
      } else if (globalMenu) {
        log('React-Select: found phone country menu — dismissing')
        await sendTrustedEscape()
        await sleep(200)
      }
    }

    if (!menu) {
      log(`React-Select: all methods failed to open "${questionText.substring(0, 40)}"`)
      if (debuggerActive) await sendTrustedEscape(); else document.body.click()
      await sleep(200)
      continue
    }

    // ──── VALIDATE: menu isn't phone country ────
    if (isPhoneCountryMenu(menu)) {
      log(`React-Select: wrong menu (phone country) — dismissing`)
      if (debuggerActive) await sendTrustedEscape(); else document.body.click()
      await sleep(300)
      continue
    }

    // ──── FIND MATCHING OPTION ────
    const menuOptions = findOptions(menu)

    if (menuOptions.length === 0) {
      log(`React-Select: menu opened but no options for "${questionText.substring(0, 40)}"`)
      if (debuggerActive) await sendTrustedEscape(); else document.body.click()
      await sleep(200)
      continue
    }

    log(`React-Select: ${menuOptions.length} options found — first 3: ${menuOptions.slice(0, 3).map(o => o.textContent?.trim()).join(', ')}`)

    const bestMatch = findBestOption(menuOptions, answer)

    if (bestMatch) {
      // ──── SELECT OPTION ────
      // Method A: CDP ArrowDown to navigate to option, then Enter to select
      // Method B: CDP click on the option (fallback)
      const optionIndex = menuOptions.indexOf(bestMatch)

      // Navigate with ArrowDown keys to the option, then Enter to select.
      // After opening the menu, option 0 is already focused.
      // So we need (optionIndex) more ArrowDowns to reach the target — NOT (optionIndex + 1).
      let selectionConfirmed = false

      // Method A: CDP keyboard navigation (ArrowDown×N + Enter)
      if (debuggerActive && optionIndex >= 0) {
        for (let i = 0; i < optionIndex; i++) {
          await sendChromeMessage({ action: 'trustedKeypress', key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 })
          await sleep(80)
        }
        await sendChromeMessage({ action: 'trustedKeypress', key: 'Enter', code: 'Enter', keyCode: 13 })
        await sleep(400)
        const selectedVal = findSelectedValue(shell)
        if (selectedVal && selectedVal.textContent?.trim()) {
          selectionConfirmed = true
          log(`React-Select: keyboard selection verified — "${selectedVal.textContent.trim()}"`)
        }
      }

      // Method B: Synthetic click on the option element (full mousedown/mouseup/click)
      if (!selectionConfirmed) {
        log('React-Select: trying synthetic click on option...')
        bestMatch.scrollIntoView({ block: 'nearest', behavior: 'instant' })
        await sleep(50)
        const optRect = bestMatch.getBoundingClientRect()
        const optEvt = {
          bubbles: true, cancelable: true, button: 0,
          clientX: Math.round(optRect.left + optRect.width / 2),
          clientY: Math.round(optRect.top + optRect.height / 2),
          view: window,
        }
        bestMatch.dispatchEvent(new MouseEvent('mousedown', optEvt))
        await sleep(30)
        bestMatch.dispatchEvent(new MouseEvent('mouseup', optEvt))
        await sleep(30)
        bestMatch.dispatchEvent(new MouseEvent('click', optEvt))
        await sleep(400)
        const selectedVal1b = findSelectedValue(shell)
        if (selectedVal1b && selectedVal1b.textContent?.trim()) {
          selectionConfirmed = true
          log(`React-Select: synthetic click on option verified — "${selectedVal1b.textContent.trim()}"`)
        }
      }

      // Method C: React props onClick on the option element
      if (!selectionConfirmed) {
        log('React-Select: trying React props onClick on option...')
        const optProps = getReactProps(bestMatch)
        if (optProps?.onClick) {
          optProps.onClick({ preventDefault: () => {}, stopPropagation: () => {} })
          await sleep(400)
          const selectedVal2 = findSelectedValue(shell)
          if (selectedVal2 && selectedVal2.textContent?.trim()) {
            selectionConfirmed = true
            log(`React-Select: React props onClick verified — "${selectedVal2.textContent.trim()}"`)
          }
        }
        // Also try onMouseDown on option (React-Select v5 uses this for selection)
        if (!selectionConfirmed && optProps?.onMouseDown) {
          optProps.onMouseDown({ preventDefault: () => {}, stopPropagation: () => {}, button: 0 })
          await sleep(400)
          const selectedVal2b = findSelectedValue(shell)
          if (selectedVal2b && selectedVal2b.textContent?.trim()) {
            selectionConfirmed = true
            log(`React-Select: React props onMouseDown verified — "${selectedVal2b.textContent.trim()}"`)
          }
        }
      }

      // Method D: Re-open menu + CDP or synthetic click on option (coordinate-based)
      if (!selectionConfirmed) {
        log('React-Select: trying re-open + coordinate click on option...')
        // Re-open menu if it closed
        let reopenedMenu = findMenu(shell)
        if (!reopenedMenu) {
          if (debuggerActive) {
            const controlRect2 = control.getBoundingClientRect()
            await sendTrustedClick(Math.round(controlRect2.left + controlRect2.width / 2), Math.round(controlRect2.top + controlRect2.height / 2))
          } else {
            const ctrlRect2 = control.getBoundingClientRect()
            const evtInit2 = {
              bubbles: true, cancelable: true, button: 0,
              clientX: Math.round(ctrlRect2.left + ctrlRect2.width / 2),
              clientY: Math.round(ctrlRect2.top + ctrlRect2.height / 2),
              view: window,
            }
            control.dispatchEvent(new MouseEvent('mousedown', evtInit2))
            await sleep(50)
            control.dispatchEvent(new MouseEvent('mouseup', evtInit2))
            await sleep(50)
            control.dispatchEvent(new MouseEvent('click', evtInit2))
            if (comboboxInput) { await sleep(100); comboboxInput.focus(); await sleep(100) }
            await sendArrowDown()
          }
          await sleep(500)
          reopenedMenu = findMenu(shell)
        }
        const targetOpt = reopenedMenu ? findBestOption(findOptions(reopenedMenu), answer) : bestMatch
        if (targetOpt) {
          targetOpt.scrollIntoView({ block: 'nearest', behavior: 'instant' })
          await sleep(100)
          if (debuggerActive) {
            const optRect2 = targetOpt.getBoundingClientRect()
            await sendTrustedClick(Math.round(optRect2.left + optRect2.width / 2), Math.round(optRect2.top + optRect2.height / 2))
          } else {
            // Full synthetic click with coordinates
            const optRect2 = targetOpt.getBoundingClientRect()
            const optEvt2 = {
              bubbles: true, cancelable: true, button: 0,
              clientX: Math.round(optRect2.left + optRect2.width / 2),
              clientY: Math.round(optRect2.top + optRect2.height / 2),
              view: window,
            }
            targetOpt.dispatchEvent(new MouseEvent('mousedown', optEvt2))
            await sleep(30)
            targetOpt.dispatchEvent(new MouseEvent('mouseup', optEvt2))
            await sleep(30)
            targetOpt.dispatchEvent(new MouseEvent('click', optEvt2))
          }
          await sleep(400)
          const selectedVal3 = findSelectedValue(shell)
          if (selectedVal3 && selectedVal3.textContent?.trim()) {
            selectionConfirmed = true
            log(`React-Select: coordinate click verified — "${selectedVal3.textContent.trim()}"`)
          }
        }
      }

      // Method E (LAST RESORT): Set hidden input value directly + trigger React change
      // React-Select creates a hidden <input name="..."> for form submission.
      if (!selectionConfirmed) {
        log('React-Select: all click methods failed — trying hidden input fallback...')
        const hiddenInput = shell.querySelector('input[type="hidden"][name]')
        if (hiddenInput) {
          // The value for React-Select options is typically the option text or a data-value
          const optValue = bestMatch.getAttribute('data-value') || bestMatch.textContent?.trim() || answer
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          if (nativeSetter) nativeSetter.call(hiddenInput, optValue)
          else hiddenInput.value = optValue
          hiddenInput.dispatchEvent(new Event('input', { bubbles: true }))
          hiddenInput.dispatchEvent(new Event('change', { bubbles: true }))
          // Also try React's onChange on the hidden input
          const hiddenProps = getReactProps(hiddenInput)
          if (hiddenProps?.onChange) hiddenProps.onChange({ target: hiddenInput })
          log(`React-Select: hidden input set to "${optValue}" (name="${hiddenInput.name}")`)
          // Try to also update the React-Select internal state via the container's React fiber
          const containerEl = shell.querySelector('[class*="select__container"], [class*="-container"]') || shell
          const fiberKey = Object.keys(containerEl).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'))
          if (fiberKey) {
            try {
              let fiber = containerEl[fiberKey]
              // Walk up fiber tree to find the Select component's state setter
              for (let i = 0; i < 20 && fiber; i++) {
                if (fiber.memoizedState && fiber.stateNode?.setState) {
                  // Found a class component — try to set value
                  log('React-Select: found class component fiber — attempting setState')
                  break
                }
                // For hooks-based React-Select v5, look for the state with selectValue
                if (fiber.memoizedState?.memoizedState?.selectValue !== undefined) {
                  log('React-Select: found hooks fiber with selectValue')
                  break
                }
                fiber = fiber.return
              }
            } catch (fiberErr) {
              warn('React-Select: fiber walk error:', fiberErr.message)
            }
          }
          selectionConfirmed = true // Mark as confirmed — best effort
        }
      }

      if (selectionConfirmed) {
        filledCount++
        log(`React-Select OK [${questionText.substring(0, 50)}] -> "${bestMatch.textContent?.trim()}"`)
      } else {
        warn(`React-Select FAILED to confirm selection for [${questionText.substring(0, 50)}] -> "${bestMatch.textContent?.trim()}"`)
      }
      // Dismiss any leftover open menu
      const leftoverMenu = findMenu(shell)
      if (leftoverMenu) {
        if (debuggerActive) await sendTrustedEscape()
        else {
          const escEvt = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
          ;(document.activeElement || document.body).dispatchEvent(escEvt)
        }
        await sleep(200)
      }
      await sleep(300)
    } else {
      log(`React-Select: no matching option for "${questionText.substring(0, 50)}" (answer: "${answer.substring(0, 30)}")`)
      log(`  Available: ${menuOptions.map(o => o.textContent?.trim()).join(', ')}`)
      if (debuggerActive) await sendTrustedEscape(); else document.body.click()
      await sleep(200)
    }
  }

  // ──── Also handle native <select> elements ────
  const allSelects = document.querySelectorAll('select')
  for (const select of allSelects) {
    if (select.value && select.selectedIndex > 0) continue
    const container = select.closest('.field, .form-field, [class*="field"]') || select.parentElement
    if (!container) continue
    const labelEl = container.querySelector('label, legend, [class*="label"]')
    const questionText = labelEl?.textContent?.trim() || ''
    if (!questionText || processed.has(questionText)) continue

    const selectOpts2 = Array.from(select.options).map(o => ({ text: o.text, value: o.value, label: o.text }))
    const answer = answerCustomQuestion(questionText, 'select', selectOpts2)
    if (!answer) continue
    const ansLower = answer.toLowerCase().trim()
    const isYes = ansLower.startsWith('yes')
    const isNo = ansLower === 'no' || ansLower.startsWith('no ')

    const match = Array.from(select.options).find(o => {
      const t = o.text.toLowerCase().trim()
      return t === ansLower || (isYes && t === 'yes') || (isNo && t === 'no') ||
             t.includes(ansLower) || ansLower.includes(t)
    })
    if (match) {
      select.value = match.value
      select.dispatchEvent(new Event('change', { bubbles: true }))
      filledCount++
      log(`Native select ✓ [${questionText.substring(0, 50)}] → "${match.text}"`)
      await sleep(300)
    }
  }

  // Detach CDP debugger when done
  if (debuggerActive) {
    await debuggerDetach()
  }

  log(`React-Select + native selects filled: ${filledCount}`)
  return filledCount
}

// ── Dedicated Phone Country React-Select Handler ──────────────────────
// The phone country code dropdown is SKIPPED by fillReactSelectDropdowns
// (via isPhoneCountryShell) because it has 200+ options and needs search-based
// interaction. This handler opens it, types "Thai" to filter, then selects.
async function fillPhoneCountryReactSelect() {
  // Find phone country shells (the ones isPhoneCountryShell identifies)
  const phoneShells = []
  document.querySelectorAll('.select-shell').forEach(el => {
    if (isPhoneCountryShell(el)) phoneShells.push(el)
  })

  if (phoneShells.length === 0) {
    log('Phone country React-Select: none found')
    return
  }

  for (const shell of phoneShells) {
    // Skip if already has a value
    const hasValue = shell.querySelector('[class*="select__single-value"], [class*="singleValue"]')
    if (hasValue && hasValue.textContent?.trim()) {
      log(`Phone country: already set to "${hasValue.textContent.trim()}"`)
      continue
    }

    log('Phone country React-Select: filling Thailand +66...')

    const control = shell.querySelector('[class*="select__control"]') || shell
    const comboboxInput = shell.querySelector('input[role="combobox"]')

    // Clear any leftover text
    if (comboboxInput && comboboxInput.value) {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      if (nativeSetter) nativeSetter.call(comboboxInput, '')
      else comboboxInput.value = ''
      comboboxInput.dispatchEvent(new Event('input', { bubbles: true }))
      await sleep(100)
    }

    // Scroll into view
    control.scrollIntoView({ block: 'center', behavior: 'instant' })
    await sleep(200)

    // Attach debugger if needed
    let dbg = false
    try { dbg = await debuggerAttach() } catch(e) {}

    // Open the dropdown via CDP click
    if (dbg) {
      const rect = control.getBoundingClientRect()
      await sendTrustedClick(Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2))
      await sleep(500)
    } else {
      // Fallback: focus + mouseDown
      if (comboboxInput) comboboxInput.focus()
      control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
      await sleep(500)
    }

    // Type "Thai" char by char to trigger React-Select's search filter
    if (comboboxInput) {
      comboboxInput.focus()
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      for (const char of 'Thai') {
        const newVal = comboboxInput.value + char
        if (nativeSetter) nativeSetter.call(comboboxInput, newVal)
        else comboboxInput.value = newVal
        comboboxInput.dispatchEvent(new Event('input', { bubbles: true }))
        comboboxInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: char, inputType: 'insertText' }))
        await sleep(80)
      }
      await sleep(800)
      log('Phone country: typed "Thai" into combobox, value now: "' + comboboxInput.value + '"')
    }

    // Find the Thailand option in the filtered menu
    const menu = shell.querySelector('[class*="select__menu"]') || document.querySelector('[class*="select__menu"]')
    if (!menu) {
      log('Phone country: menu did not open')
      if (dbg) await debuggerDetach()
      continue
    }

    const options = Array.from(menu.querySelectorAll('[class*="select__option"], [role="option"]'))
    let thaiOption = null
    for (const opt of options) {
      const t = opt.textContent?.trim() || ''
      if (t.includes('Thailand') || t.includes('+66') || t.includes('🇹🇭')) {
        thaiOption = opt
        break
      }
    }

    if (thaiOption) {
      // Select via CDP click or React props
      if (dbg) {
        thaiOption.scrollIntoView({ block: 'nearest', behavior: 'instant' })
        await sleep(100)
        const optRect = thaiOption.getBoundingClientRect()
        await sendTrustedClick(Math.round(optRect.left + optRect.width / 2), Math.round(optRect.top + optRect.height / 2))
      } else {
        const optProps = getReactProps(thaiOption)
        if (optProps?.onClick) {
          optProps.onClick({ preventDefault: () => {}, stopPropagation: () => {} })
        } else {
          thaiOption.click()
        }
      }
      await sleep(400)
      log('Phone country ✓ Thailand +66 selected')
    } else {
      log('Phone country: Thailand option not found in menu. Options: ' + options.slice(0, 3).map(o => o.textContent?.trim()).join(', '))
      // Close menu
      if (dbg) await sendTrustedEscape()
      else document.body.click()
    }

    if (dbg) await debuggerDetach()
  }
}

async function fillGreenhouseDropdowns() {
  // ── Step 1: Handle Select2 dropdowns (Greenhouse Classic) ──
  const select2Containers = document.querySelectorAll('.select2-container')
  for (const container of select2Containers) {
    // Find the associated hidden <select>
    const selectId = container.id?.replace('s2id_', '')
    const select = selectId ? document.getElementById(selectId) : container.closest('.field')?.querySelector('select')
    if (!select || (select.value && select.selectedIndex > 0)) continue

    const labelInfo = getLabelText(select)

    if (labelInfo.includes('country') || labelInfo.includes('pays')) {
      await handleSelect2Dropdown(select, 'Thailand', ['thailand', 'thaïlande'])
      continue
    }
    if (labelInfo.includes('school') || labelInfo.includes('university') || labelInfo.includes('école')) {
      await handleSelect2Dropdown(select, 'ESD', ['esd', 'ecole superieure', 'école supérieure'])
      continue
    }
    if (labelInfo.includes('degree') || labelInfo.includes('diplôme')) {
      await handleSelect2Dropdown(select, 'Master', ['master', "master's", 'bac+5'])
      continue
    }
    if (labelInfo.includes('discipline') || labelInfo.includes('field of study') || labelInfo.includes('major')) {
      await handleSelect2Dropdown(select, 'Design', ['design', 'ux', 'arts', 'graphic', 'multimedia'])
      continue
    }
  }

  // ── Step 2: React-Select dropdowns are handled by fillReactSelectDropdowns() (CDP keyboard)
  // DO NOT use handleReactSelectDropdown here — it TYPES text into combobox inputs
  // which leaves orphaned text (e.g. "Thailand") that causes validation errors.

  // ── Step 3: Handle remaining native <select> dropdowns ──
  const selects = document.querySelectorAll('select')
  for (const select of selects) {
    if (select.value && select.selectedIndex > 0) continue
    // Skip if already handled by Select2
    if (document.getElementById('s2id_' + select.id)) continue

    const labelInfo = getLabelText(select)

    // Country
    if (labelInfo.includes('country') || labelInfo.includes('pays') || labelInfo.includes('nation')) {
      const options = Array.from(select.options)
      const match = options.find(o => {
        const t = (o.text + ' ' + o.value).toLowerCase()
        return t.includes('thailand') || t === 'th' || t.includes('thaïlande')
      })
      if (match) {
        select.value = match.value
        select.dispatchEvent(new Event('change', { bubbles: true }))
        log('Selected country dropdown: Thailand')
        await sleep(500)
      }
      continue
    }

    // Phone country code
    if (labelInfo.includes('phone') && (labelInfo.includes('code') || labelInfo.includes('country'))) {
      const options = Array.from(select.options)
      const match = options.find(o => o.text.includes('+66') || o.text.includes('Thailand') || o.value === 'TH' || o.value === '+66')
      if (match) {
        select.value = match.value
        select.dispatchEvent(new Event('change', { bubbles: true }))
        log('Selected phone country code: +66')
        await sleep(300)
      }
      continue
    }

    // Gender / EEO
    if (labelInfo.includes('gender') || labelInfo.includes('race') || labelInfo.includes('veteran') ||
        labelInfo.includes('disability') || labelInfo.includes('ethnicity')) {
      const options = Array.from(select.options)
      const match = options.find(o => {
        const t = o.text.toLowerCase()
        return t.includes('decline') || t.includes('prefer not') || t.includes('not wish') || t.includes('ne souhaite')
      })
      if (match) {
        select.value = match.value
        select.dispatchEvent(new Event('change', { bubbles: true }))
        log('Selected EEO: Decline/Prefer not')
      }
      continue
    }

    // How did you hear
    if (labelInfo.includes('how did you') || labelInfo.includes('hear about') || labelInfo.includes('source')) {
      const options = Array.from(select.options)
      const match = options.find(o => o.text.toLowerCase().includes('linkedin'))
        || options.find(o => o.text.toLowerCase().includes('job board'))
        || options.find(o => o.text.toLowerCase().includes('online'))
        || options.find(o => o.text.toLowerCase().includes('other'))
      if (match) {
        select.value = match.value
        select.dispatchEvent(new Event('change', { bubbles: true }))
        log('Selected how-heard: ' + match.text)
      }
      continue
    }

    // Degree / education level
    if (labelInfo.includes('degree') || labelInfo.includes('education') || labelInfo.includes('diplôme')) {
      const options = Array.from(select.options)
      const match = options.find(o => o.text.toLowerCase().includes('master'))
        || options.find(o => o.text.toLowerCase().includes('bac+5'))
        || options.find(o => o.text.toLowerCase().includes('graduate'))
      if (match) {
        select.value = match.value
        select.dispatchEvent(new Event('change', { bubbles: true }))
        log('Selected degree: ' + match.text)
      }
      continue
    }
  }
}

// ── Lever ─────────────────────────────────────────────────────────────

// Lever custom questions use a cards[xxx][fieldN] name pattern inside
// .custom-question or .application-question containers. These are NOT
// covered by fillGreenhouseCustomQuestions (which targets #custom_fields).
// This function scans all cards[*] fields and fills them via answerCustomQuestion.
async function fillLeverCustomQuestions() {
  log('Scanning for Lever cards[*] custom questions...')
  let filledCount = 0
  const processedInputs = new Set()

  // Strategy 1: Container-based scan — Lever wraps custom questions in
  // .custom-question or .application-question divs, each with a label and input(s)
  const leverContainers = document.querySelectorAll(
    '.custom-question, .application-question, ' +
    '[class*="custom-question"], [class*="application-question"]'
  )

  for (const container of leverContainers) {
    // Extract question text from the container label
    const questionText = (
      container.querySelector('label, .custom-question-title, .question-label, legend, [class*="label"], [class*="title"], h3, h4')?.textContent?.trim()
      || container.getAttribute('aria-label')
      || ''
    )
    if (!questionText || questionText.length < 3) continue

    // ── Text inputs ──
    const textInputs = container.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], input:not([type]), textarea')
    for (const input of textInputs) {
      if (processedInputs.has(input)) continue
      const fType = classifyFormField(input)
      if (fType !== 'text') continue
      if (input.value && input.value.trim().length > 0) continue

      const isTextarea = input.tagName === 'TEXTAREA'
      const answer = answerCustomQuestion(questionText, isTextarea ? 'textarea' : 'text')
      if (!answer) continue
      const actualValue = answer === '___PHONE___' ? PROFILE.phone : answer
      _fillTextField(input, actualValue)
      processedInputs.add(input)
      filledCount++
      log(`Lever custom Q [text] [${questionText.substring(0, 50)}] -> ${actualValue.substring(0, 30)}...`)
      await sleep(200)
    }

    // ── Native <select> ──
    const selects = container.querySelectorAll('select')
    for (const select of selects) {
      if (processedInputs.has(select)) continue
      if (select.value && select.selectedIndex > 0) continue

      const selectOptions = Array.from(select.options).map(o => ({ text: o.text, value: o.value, label: o.text }))
      const answer = answerCustomQuestion(questionText, 'select', selectOptions)
      if (!answer) continue
      if (_fillNativeSelect(select, answer)) {
        processedInputs.add(select)
        filledCount++
        log(`Lever custom Q [select] [${questionText.substring(0, 50)}] -> ${answer.substring(0, 30)}`)
      }
      await sleep(200)
    }

    // ── Radio buttons ──
    const radios = container.querySelectorAll('input[type="radio"]')
    if (radios.length > 0 && !Array.from(radios).some(r => r.checked)) {
      const radioOptions = Array.from(radios).map(r => {
        const lbl = r.labels?.[0]?.textContent?.trim() || r.closest('label')?.textContent?.trim() || r.value
        return { text: lbl, value: r.value, label: lbl }
      })
      const answer = answerCustomQuestion(questionText, 'radio', radioOptions)
      if (answer) {
        const filled = await _fillRadioField(container, answer)
        if (filled) {
          filledCount++
          log(`Lever custom Q [radio] [${questionText.substring(0, 50)}] -> ${answer.substring(0, 30)}`)
        }
      }
    }

    // ── Checkboxes ──
    const checkboxes = container.querySelectorAll('input[type="checkbox"]')
    for (const cb of checkboxes) {
      if (cb.checked) continue
      const cbAnswer = answerCustomQuestion(questionText, 'checkbox')
      if (cbAnswer) {
        _fillCheckboxField(cb, cbAnswer)
        filledCount++
        log(`Lever custom Q [checkbox] [${questionText.substring(0, 50)}] -> ${cbAnswer.substring(0, 30)}`)
      }
    }
  }

  // Strategy 2: Direct selector scan — find ALL inputs whose name matches cards[*]
  // This catches fields that may not be inside a recognized container class
  const cardInputs = document.querySelectorAll('input[name^="cards["], textarea[name^="cards["], select[name^="cards["]')
  for (const input of cardInputs) {
    if (processedInputs.has(input)) continue
    const fieldType = classifyFormField(input)
    if (fieldType === 'hidden' || fieldType === 'file') continue

    // Check if already filled
    if (fieldType === 'text' && input.value && input.value.trim().length > 0) continue
    if (fieldType === 'select' && input.selectedIndex > 0) continue
    if (fieldType === 'checkbox' && input.checked) continue
    if (fieldType === 'radio' && document.querySelector(`input[name="${input.name}"]:checked`)) continue

    // Build label from surrounding context
    const labelInfo = getLabelText(input)
    const questionContainer = input.closest('.custom-question, .application-question, [class*="custom-question"], [class*="application-question"], .field, fieldset, [class*="question"]')
    const containerLabel = questionContainer?.querySelector('label, legend, .field-label, [class*="label"], .custom-question-title, .question-label, h3, h4, [class*="title"]')?.textContent?.trim() || ''
    const enrichedLabel = (labelInfo + ' ' + containerLabel.toLowerCase()).trim()

    if (enrichedLabel.length < 5) {
      log(`Lever cards[*] field: no label found for ${input.name}`)
      continue
    }

    if (fieldType === 'text') {
      const isTextarea = input.tagName === 'TEXTAREA'
      const answer = answerCustomQuestion(enrichedLabel, isTextarea ? 'textarea' : 'text') || matchFieldToValue(enrichedLabel)
      if (answer) {
        const actualValue = answer === '___PHONE___' ? PROFILE.phone : answer
        _fillTextField(input, actualValue)
        processedInputs.add(input)
        filledCount++
        log(`Lever cards[*] [text] [${enrichedLabel.substring(0, 50)}] -> ${actualValue.substring(0, 30)}...`)
        await sleep(200)
      }
    } else if (fieldType === 'select') {
      const selectOptions = Array.from(input.options || []).map(o => ({ text: o.text, value: o.value, label: o.text }))
      const answer = answerCustomQuestion(enrichedLabel, 'select', selectOptions)
      if (answer && _fillNativeSelect(input, answer)) {
        processedInputs.add(input)
        filledCount++
        log(`Lever cards[*] [select] [${enrichedLabel.substring(0, 50)}] -> ${answer.substring(0, 30)}`)
      }
    } else if (fieldType === 'radio') {
      const radioGroup = document.querySelectorAll(`input[name="${input.name}"]`)
      const radioOptions = Array.from(radioGroup).map(r => {
        const lbl = r.labels?.[0]?.textContent?.trim() || r.closest('label')?.textContent?.trim() || r.value
        return { text: lbl, value: r.value, label: lbl }
      })
      const answer = answerCustomQuestion(enrichedLabel, 'radio', radioOptions)
      if (answer) {
        const radioContainer = input.closest('fieldset, [role="radiogroup"], [class*="radio-group"], [class*="question"], .custom-question, .application-question')
        if (radioContainer) {
          const filled = await _fillRadioField(radioContainer, answer)
          if (filled) {
            filledCount++
            log(`Lever cards[*] [radio] [${enrichedLabel.substring(0, 50)}] -> ${answer.substring(0, 30)}`)
          }
        }
      }
    } else if (fieldType === 'checkbox') {
      const answer = answerCustomQuestion(enrichedLabel, 'checkbox')
      if (answer) {
        _fillCheckboxField(input, answer)
        filledCount++
        log(`Lever cards[*] [checkbox] [${enrichedLabel.substring(0, 50)}] -> ${answer.substring(0, 30)}`)
      }
    }
  }

  log(`Lever custom questions: filled ${filledCount} cards[*] fields`)
  return filledCount
}

async function handleLever() {
  log('Lever ATS detected')
  await sleep(ATS_CONFIG.pageLoadWait)

  // Lever has a simpler form — usually on the same page
  // Check if we need to click "Apply for this job"
  const applyBtn = findAndClickButton(['Apply for this job', 'Apply now', 'Apply', 'Postuler'])
  if (applyBtn) {
    applyBtn.click()
    await sleep(2000)
  }

  // Lever uses specific field names
  const leverFields = {
    'input[name="name"]': PROFILE.fullName,
    'input[name="email"]': PROFILE.email,
    'input[name="phone"]': PROFILE.phone,
    'input[name="org"]': '', // Current company — leave blank
    'input[name="urls[LinkedIn]"]': PROFILE.linkedin,
    'input[name="urls[Portfolio]"]': PROFILE.portfolio,
    'input[name="urls[Other]"]': PROFILE.portfolio,
    'textarea[name="comments"]': `Senior Product Designer with 7+ years of experience. Portfolio: ${PROFILE.portfolio}`,
  }

  for (const [selector, value] of Object.entries(leverFields)) {
    if (!value) continue
    const input = document.querySelector(selector)
    if (input && (!input.value || input.value.trim().length === 0)) {
      setReactValue(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await randomDelay(200, 500)
    }
  }

  // Fill Lever-specific cards[*] custom questions (screening questions)
  try { await fillLeverCustomQuestions() } catch(e) { warn('fillLeverCustomQuestions error:', e.message) }

  // Fill any remaining generic fields
  await fillAllFormFields()

  // ── CV Upload: Direct API submission ──────────────────────────────────
  // Lever's React file input rejects DataTransfer-set files with a spurious
  // "File exceeds 100MB" error on any file, regardless of size.  Instead of
  // fighting React, we bypass its file input entirely:
  //   1. Fetch the CV from GitHub (content-script fetch — not subject to page CSP)
  //   2. Collect every filled field value from the DOM
  //   3. Build a FormData with fields + CV as "resume" file
  //   4. POST directly to Lever's apply endpoint (same origin — no CORS issues)
  // If the direct submit succeeds, we set a flag so navigateMultiStepForm()
  // knows the application is already submitted and skips clicking Submit.
  const directSubmitOk = await _leverDirectSubmit()
  if (directSubmitOk) {
    // Signal to the main flow that submission already happened
    window.__leverDirectSubmitted = true
    return true
  }

  // Fallback: try the standard file input approach (unlikely to work, but safe)
  log('Lever direct submit failed — falling back to DataTransfer file input')
  const fileInput = document.querySelector('input[type="file"][name="resume"], input[type="file"]')
  if (fileInput) await fetchAndUploadCV(fileInput)

  return true
}

// ── Lever Direct Submit (bypasses React file input) ─────────────────────
// Collects form field values + CV and POSTs directly to Lever's apply endpoint.
// This runs from the content script on jobs.lever.co — same origin, no CORS.

async function _leverDirectSubmit() {
  try {
    // ── 1. Resolve the Lever apply endpoint ──
    const applyUrl = _leverResolveApplyUrl()
    if (!applyUrl) {
      warn('Lever direct submit: could not determine apply endpoint')
      return false
    }
    log('Lever direct submit: endpoint =', applyUrl)

    // ── 2. Fetch the CV ──
    // PROFILE.cvUrl may be empty if chrome.storage was wiped (extension reinstall).
    // Fall back to chrome.storage direct read, then hardcoded GitHub URL.
    if (!PROFILE.cvUrl) {
      try {
        const stored = await chrome.storage.local.get(['userProfile'])
        if (stored.userProfile?.cvUrl) PROFILE.cvUrl = stored.userProfile.cvUrl
      } catch {}
    }
    if (!PROFILE.cvUrl) {
      PROFILE.cvUrl = 'https://raw.githubusercontent.com/peterbono/portfolio/main/cvflo.pdf'
      log('Lever direct submit: using fallback CV URL')
    }
    log('Lever direct submit: fetching CV from', PROFILE.cvUrl)
    const cvResponse = await fetch(PROFILE.cvUrl)
    if (!cvResponse.ok) {
      warn('Lever direct submit: CV fetch failed:', cvResponse.status, cvResponse.statusText)
      return false
    }
    const cvBlob = await cvResponse.blob()
    if (cvBlob.size < 1000 || cvBlob.size > 10 * 1024 * 1024) {
      warn('Lever direct submit: CV size suspicious:', cvBlob.size, 'bytes')
      return false
    }
    const pdfBlob = new Blob([cvBlob], { type: 'application/pdf' })
    const cvFile = new File([pdfBlob], PROFILE.cvFilename || 'CV.pdf', {
      type: 'application/pdf',
      lastModified: Date.now(),
    })
    log('Lever direct submit: CV ready —', cvFile.name, cvFile.size, 'bytes')

    // ── 3. Build FormData from filled form fields ──
    const formData = new FormData()

    // 3a. Standard Lever fields (read from DOM — reflects what user sees)
    const fieldMap = {
      name: 'input[name="name"]',
      email: 'input[name="email"]',
      phone: 'input[name="phone"]',
      org: 'input[name="org"]',
      'urls[LinkedIn]': 'input[name="urls[LinkedIn]"]',
      'urls[Portfolio]': 'input[name="urls[Portfolio]"]',
      'urls[Other]': 'input[name="urls[Other]"]',
      'urls[Twitter]': 'input[name="urls[Twitter]"]',
      'urls[GitHub]': 'input[name="urls[GitHub]"]',
      comments: 'textarea[name="comments"]',
    }

    for (const [name, selector] of Object.entries(fieldMap)) {
      const el = document.querySelector(selector)
      if (el && el.value && el.value.trim()) {
        formData.append(name, el.value.trim())
      }
    }

    // 3b. cards[*] custom questions (screening questions)
    const cardInputs = document.querySelectorAll(
      'input[name^="cards["], textarea[name^="cards["], select[name^="cards["]'
    )
    for (const input of cardInputs) {
      const name = input.getAttribute('name')
      if (!name) continue
      if (input.type === 'radio') {
        if (input.checked) formData.append(name, input.value)
      } else if (input.type === 'checkbox') {
        if (input.checked) formData.append(name, input.value || 'on')
      } else if (input.value && input.value.trim()) {
        formData.append(name, input.value.trim())
      }
    }

    // 3c. Hidden fields (CSRF tokens, posting ID, etc.)
    const hiddenInputs = document.querySelectorAll('input[type="hidden"]')
    for (const hi of hiddenInputs) {
      const name = hi.getAttribute('name')
      if (name && hi.value) {
        formData.append(name, hi.value)
      }
    }

    // 3d. Consent / privacy checkboxes
    const consentBoxes = document.querySelectorAll(
      'input[type="checkbox"][name*="consent"], input[type="checkbox"][name*="privacy"], ' +
      'input[type="checkbox"][name*="gdpr"], input[type="checkbox"][name*="terms"]'
    )
    for (const cb of consentBoxes) {
      if (cb.checked) {
        formData.append(cb.name, cb.value || 'on')
      }
    }

    // 3e. Attach the CV as "resume"
    formData.append('resume', cvFile, cvFile.name)

    // ── 4. POST to Lever's apply endpoint ──
    log('Lever direct submit: POSTing to', applyUrl, '...')
    const submitResponse = await fetch(applyUrl, {
      method: 'POST',
      body: formData,
      credentials: 'same-origin', // Send cookies (session, CSRF)
      // Do NOT set Content-Type — browser will set multipart boundary automatically
    })

    log('Lever direct submit: response status =', submitResponse.status)

    if (submitResponse.ok || submitResponse.status === 303 || submitResponse.status === 302) {
      log('Lever direct submit: SUCCESS — application submitted via API')
      return true
    }

    // Some Lever endpoints return JSON with error details
    let responseBody = ''
    try { responseBody = await submitResponse.text() } catch {}
    warn('Lever direct submit: failed — status', submitResponse.status, responseBody.substring(0, 500))

    // 4xx might mean missing required fields — log them for debugging
    if (submitResponse.status >= 400 && submitResponse.status < 500) {
      log('Lever direct submit: form fields sent:')
      for (const [key, val] of formData.entries()) {
        if (key === 'resume') {
          log('  resume:', cvFile.name, cvFile.size, 'bytes')
        } else {
          log('  ' + key + ':', String(val).substring(0, 80))
        }
      }
    }

    return false
  } catch (err) {
    warn('Lever direct submit: exception —', err.message)
    return false
  }
}

// ── Resolve the Lever apply URL from the current page ───────────────────
// Lever forms use several endpoint patterns. We try them in order of reliability.

function _leverResolveApplyUrl() {
  const pageUrl = window.location.href

  // Method 1: Read the form's action attribute directly
  const form = document.querySelector('form[action]')
  if (form) {
    const action = form.getAttribute('action')
    if (action) {
      // Resolve relative URLs against the page origin
      try {
        const resolved = new URL(action, window.location.origin).href
        log('Lever apply URL from form action:', resolved)
        return resolved
      } catch {}
    }
  }

  // Method 2: Parse the page URL — Lever postings follow:
  //   https://jobs.lever.co/{company}/{postingId}
  //   https://jobs.lever.co/{company}/{postingId}/apply
  // The API endpoint is:
  //   https://jobs.lever.co/v0/postings/{company}/{postingId}?lever-source[]=Applied
  const leverUrlMatch = pageUrl.match(
    /https:\/\/jobs\.lever\.co\/([^/]+)\/([0-9a-f-]{36})/i
  )
  if (leverUrlMatch) {
    const company = leverUrlMatch[1]
    const postingId = leverUrlMatch[2]
    // Lever's own form POSTs to the same URL with /apply or just the posting URL
    // The public API endpoint pattern:
    const apiUrl = `https://jobs.lever.co/${company}/${postingId}/apply`
    log('Lever apply URL from URL pattern:', apiUrl)
    return apiUrl
  }

  // Method 3: Look for XHR/fetch intercepted URLs in the page
  // Some Lever pages embed the posting ID in a script tag or data attribute
  const scripts = document.querySelectorAll('script:not([src])')
  for (const script of scripts) {
    const text = script.textContent || ''
    const match = text.match(/postingId["':\s]+["']([0-9a-f-]{36})["']/i)
    if (match) {
      // Try to also find company from the URL or page
      const companyMatch = pageUrl.match(/jobs\.lever\.co\/([^/]+)/) || text.match(/company["':\s]+["']([^"']+)["']/)
      const company = companyMatch ? companyMatch[1] : null
      if (company) {
        const apiUrl = `https://jobs.lever.co/${company}/${match[1]}/apply`
        log('Lever apply URL from inline script:', apiUrl)
        return apiUrl
      }
    }
  }

  warn('Lever: could not resolve apply URL from page')
  return null
}

// ── Workable ──────────────────────────────────────────────────────────

async function handleWorkable() {
  log('Workable ATS detected')
  await sleep(ATS_CONFIG.pageLoadWait)

  // Workable usually has an "Apply" button on the job page
  const applyBtn = findAndClickButton(['Apply for this job', 'Apply now', 'Apply', 'Postuler'])
  if (applyBtn) {
    applyBtn.click()
    await sleep(3000)
  }

  // Workable specific selectors
  const workableFields = {
    'input[data-ui="firstname"], input[name="firstname"]': PROFILE.firstName,
    'input[data-ui="lastname"], input[name="lastname"]': PROFILE.lastName,
    'input[data-ui="email"], input[name="email"]': PROFILE.email,
    'input[data-ui="phone"], input[name="phone"]': PROFILE.phone,
    'input[data-ui="address"], input[name="address"]': 'Bangkok, Thailand',
    'textarea[data-ui="cover_letter"], textarea[name="cover_letter"]': `Senior Product Designer with 7+ years of experience. Portfolio: ${PROFILE.portfolio}`,
  }

  for (const [selector, value] of Object.entries(workableFields)) {
    const input = document.querySelector(selector)
    if (input && (!input.value || input.value.trim().length === 0)) {
      setReactValue(input, value)
      await randomDelay(200, 500)
    }
  }

  // Upload CV
  const fileInput = document.querySelector('input[type="file"]')
  if (fileInput) await fetchAndUploadCV(fileInput)

  // Fill remaining
  await fillAllFormFields()

  return true
}

// ── Ashby ─────────────────────────────────────────────────────────────
// Note: Ashby blocks external fetch via CSP — mark as needs_manual

async function handleAshby() {
  log('Ashby ATS detected — CSP blocks CV fetch, marking as needs_manual')

  await sleep(ATS_CONFIG.pageLoadWait)

  // Still try to fill text fields (CSP only blocks fetch, not input filling)
  const filled = await fillAllFormFields()

  // CV upload will fail due to CSP — that's expected
  // We still fill what we can so the user only needs to attach their CV

  return false // Will be marked needs_manual
}

// ── Manatal (careers-page.com) ────────────────────────────────────────

async function handleManatal() {
  log('Manatal (careers-page.com) ATS detected')
  await sleep(ATS_CONFIG.pageLoadWait)

  // Click apply if needed
  const applyBtn = findAndClickButton(['Apply', 'Apply now', 'Postuler'])
  if (applyBtn) {
    applyBtn.click()
    await sleep(3000)
  }

  // Fill form
  await fillAllFormFields()

  // Upload CV
  const fileInput = document.querySelector('input[type="file"]')
  if (fileInput) await fetchAndUploadCV(fileInput)

  return true
}

// ── Breezy HR ─────────────────────────────────────────────────────────

async function handleBreezy() {
  log('Breezy HR ATS detected')
  await sleep(ATS_CONFIG.pageLoadWait)

  // Breezy usually has an "Apply Now" button
  const applyBtn = findAndClickButton(['Apply Now', 'Apply for this Position', 'Apply', 'Postuler'])
  if (applyBtn) {
    applyBtn.click()
    await sleep(3000)
  }

  // Fill form
  await fillAllFormFields()

  // Upload CV
  const fileInput = document.querySelector('input[type="file"]')
  if (fileInput) await fetchAndUploadCV(fileInput)

  return true
}

// ── Recruitee ─────────────────────────────────────────────────────────

async function handleRecruitee() {
  log('Recruitee ATS detected')
  await sleep(ATS_CONFIG.pageLoadWait)

  // Click apply
  const applyBtn = findAndClickButton(['Apply', 'Apply now', 'Postuler'])
  if (applyBtn) {
    applyBtn.click()
    await sleep(3000)
  }

  // Recruitee uses React — need nativeInputValueSetter
  const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"])')
  for (const input of inputs) {
    if (input.value && input.value.trim().length > 0) continue
    const labelInfo = getLabelText(input)
    const matched = matchFieldToValue(labelInfo)
    if (matched) {
      setReactValue(input, matched)
      await randomDelay(200, 500)
    }
  }

  // Fill remaining + upload
  await fillAllFormFields()
  const fileInput = document.querySelector('input[type="file"]')
  if (fileInput) await fetchAndUploadCV(fileInput)

  return true
}

// ── Teamtailor ────────────────────────────────────────────────────────

async function handleTeamtailor() {
  log('Teamtailor ATS detected')
  await sleep(ATS_CONFIG.pageLoadWait)

  // Click apply
  const applyBtn = findAndClickButton(['Apply', 'Apply now', 'Apply for this job', 'Postuler'])
  if (applyBtn) {
    applyBtn.click()
    await sleep(3000)
  }

  // Fill the form
  await fillAllFormFields()

  // Upload CV via GitHub fetch + DataTransfer
  const fileInput = document.querySelector('input[type="file"]')
  if (fileInput) await fetchAndUploadCV(fileInput)

  return true
}

// ── SmartRecruiters ───────────────────────────────────────────────────

async function handleSmartRecruiters() {
  log('SmartRecruiters ATS detected')
  await sleep(ATS_CONFIG.pageLoadWait)

  const applyBtn = findAndClickButton(['Apply', 'Apply Now', 'Postuler'])
  if (applyBtn) {
    applyBtn.click()
    await sleep(3000)
  }

  await fillAllFormFields()
  const fileInput = document.querySelector('input[type="file"]')
  if (fileInput) await fetchAndUploadCV(fileInput)

  return true
}

// ── Workday ───────────────────────────────────────────────────────────
// Workday usually requires account creation, but if already logged in we can fill

async function handleWorkday() {
  log('Workday ATS detected')
  await sleep(ATS_CONFIG.pageLoadWait)

  // Check if we're on a sign-in/create-account page
  const pageText = document.body.textContent?.toLowerCase() || ''
  if (pageText.includes('sign in') && pageText.includes('create account') && !pageText.includes('application')) {
    log('Workday requires account creation — marking as needs_manual')
    return false
  }

  // If on application form, try to fill using React props
  const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="file"])')
  let filled = 0
  for (const input of inputs) {
    if (input.value?.trim()) continue
    const label = getLabelText(input)
    const value = matchFieldToValue(label)
    if (value) {
      const actualValue = value === '___PHONE___' ? PROFILE.phone : value
      // Workday is React-based — try React props first
      if (!setValueViaReact(input, actualValue)) {
        setReactValue(input, actualValue)
      }
      filled++
    }
  }

  // Handle Workday dropdowns via React props
  const dropdownBtns = document.querySelectorAll('button[aria-haspopup="listbox"]')
  for (const btn of dropdownBtns) {
    const label = getLabelText(btn)
    if (label.includes('country')) {
      btn.click()
      await sleep(500)
      const listId = btn.getAttribute('aria-controls')
      const list = listId ? document.getElementById(listId) : document.querySelector('[role="listbox"]')
      if (list) {
        const items = list.querySelectorAll('[role="option"], li')
        for (const item of items) {
          if (item.textContent?.toLowerCase()?.includes('thailand')) {
            const itemProps = getReactProps(item)
            if (itemProps?.onClick) itemProps.onClick({ preventDefault: () => {} })
            else item.click()
            filled++
            break
          }
        }
      }
    }
  }

  // File upload via React drop zone
  const dropZone = document.querySelector('[class*="drop-zone"], [class*="dropzone"], [class*="file-upload"]')
  if (dropZone) {
    try {
      const response = await fetch(PROFILE.cvUrl, { mode: 'cors' })
      if (response.ok) {
        const blob = await response.blob()
        if (blob.size > 10 * 1024 * 1024 || blob.size < 1000) {
          log('Workday CV fetch returned unexpected size:', blob.size, '— skipping')
        } else {
          const pdfBlob = new Blob([blob], { type: 'application/pdf' })
          const file = new File([pdfBlob], PROFILE.cvFilename, { type: 'application/pdf', lastModified: Date.now() })
          const dzProps = getReactProps(dropZone)
          if (dzProps?.onDrop) {
            dzProps.onDrop({ dataTransfer: { files: [file] }, preventDefault: () => {}, stopPropagation: () => {} })
            filled++
          }
        }
      }
    } catch (e) {
      log('Workday CV upload failed:', e.message)
    }
  }

  // Also fill generic fields
  await fillAllFormFields()

  return filled > 0
}

// ── Generic (unknown ATS) ─────────────────────────────────────────────

async function handleGeneric() {
  log('Generic career page detected, attempting smart form fill')
  await sleep(ATS_CONFIG.pageLoadWait)

  // Look for an apply button on the page
  const applyBtn = findAndClickButton([
    'Apply', 'Apply Now', 'Apply for this job', 'Apply for this position',
    'Submit Application', 'Start Application', 'Postuler', 'Candidater',
  ])
  if (applyBtn) {
    log('Found apply button, clicking...')
    applyBtn.click()
    await sleep(3000)
  }

  // Fill all detectable form fields
  const filled = await fillAllFormFields()

  // Upload CV if possible
  const fileInput = document.querySelector('input[type="file"]')
  if (fileInput) await fetchAndUploadCV(fileInput)

  return filled > 0
}

// ─── Submit Form ──────────────────────────────────────────────────────

async function submitForm() {
  // Helper: check if a button is truly clickable (visible, not disabled, not aria-disabled)
  function isClickable(btn) {
    if (!btn || btn.offsetHeight === 0) return false
    if (btn.disabled) return false
    // Greenhouse Remix uses aria-disabled="true" instead of native disabled
    if (btn.getAttribute('aria-disabled') === 'true') return false
    return true
  }

  // Helper: scroll to button and click with human-like behavior
  async function scrollAndClick(btn, source) {
    log('Found submit via', source, '| Text:', (btn.textContent || btn.value || '').trim())
    // Scroll button into view — some React apps ignore clicks on off-screen elements
    btn.scrollIntoView({ behavior: 'smooth', block: 'center' })
    await sleep(500)
    await randomDelay(ATS_CONFIG.clickDelay.min, ATS_CONFIG.clickDelay.max)
    btn.click()
    await sleep(3000)
    return true
  }

  // Try ATS-specific submit selectors first (most reliable)
  const specificSelectors = [
    '#submit_app',                                    // Greenhouse Classic
    '.application--submit button',                    // Greenhouse Remix (job-boards.greenhouse.io)
    '#application-form button[type="submit"]',        // Greenhouse Remix by form ID
    'button[type="submit"]',                          // Standard button submit
    'input[type="submit"]',                           // Standard HTML submit
    'button[data-testid="submit"]',                   // Modern React ATS (camelCase)
    'button[data-test-id="submit-application"]',      // React ATS (kebab-case)
    'button[class*="submit"]',                        // Class-based
    '#application-submit',                            // Common pattern
  ]

  for (const sel of specificSelectors) {
    const candidates = document.querySelectorAll(sel)
    for (const btn of candidates) {
      // Skip Claude MCP / browser extension injected buttons
      if (btn.id && (btn.id.includes('claude') || btn.id.includes('mcp'))) continue
      if (btn.closest('[id*="claude"], [id*="mcp"]')) continue
      if (isClickable(btn)) {
        return await scrollAndClick(btn, 'selector: ' + sel)
      }
    }
  }

  // Fallback: text-based button search
  // IMPORTANT: "Apply" alone is too broad — it matches header/navigation buttons
  // on Greenhouse Remix (div.job__header > button "Apply") which is NOT the submit button.
  // Use specific submit phrases only.
  const submitBtn = findAndClickButton([
    'Submit Application', 'Submit application', 'Submit',
    'Send Application', 'Send application',
    'Soumettre ma candidature', 'Soumettre', 'Envoyer',
    'Complete Application', 'Finish Application',
    'Apply Now', 'Confirm', 'Confirmer',
  ])

  if (submitBtn && isClickable(submitBtn)) {
    return await scrollAndClick(submitBtn, 'text match')
  }

  if (submitBtn && !isClickable(submitBtn)) {
    log('Submit button found but NOT CLICKABLE — disabled:', submitBtn.disabled, 'aria-disabled:', submitBtn.getAttribute('aria-disabled'))
    return false
  }

  // Last resort: form.submit()
  const form = document.querySelector('#application-form, form[class*="apply"], form[class*="application"], form[action*="apply"], form')
  if (form) {
    log('No submit button found, trying form.submit()')
    try {
      form.submit()
      await sleep(3000)
      return true
    } catch {}
  }

  warn('No submit button or form found')
  return false
}

// ─── Confirmation Detection ───────────────────────────────────────────

function isApplicationConfirmed() {
  // Greenhouse-specific: check for #application_confirmation element
  if (document.querySelector('#application_confirmation')) {
    log('Confirmed via #application_confirmation element')
    return true
  }

  const text = document.body.textContent.toLowerCase()
  const confirmPhrases = [
    'application submitted',
    'application was sent',
    'application received',
    'thank you for applying',
    'thanks for applying',
    'thank you for your application',
    'thanks for your application',
    'your application has been',
    'successfully submitted',
    'successfully applied',
    'candidature envoyée',
    'candidature soumise',
    'merci pour votre candidature',
    'merci d\'avoir postulé',
    'we have received your application',
    'application complete',
    'you have applied',
    'application sent',
    'we\'ll be in touch',
    'we will review',
    'we\'ve received',
    'you\'re all set',
  ]

  return confirmPhrases.some(phrase => text.includes(phrase))
}

// ─── Greenhouse Security Code Handler ─────────────────────────────────
// After initial submit, Greenhouse may show a security code page.
// The 8-character code is emailed to the applicant. This handler:
// 1. Detects the security code page
// 2. Requests the code from background.js (which reads Gmail)
// 3. Enters the code into the 8 individual input fields
// 4. Re-submits the form

async function handleGreenhouseSecurityCode() {
  const bodyText = (document.body?.innerText || '').toLowerCase()

  // Detect security code page — Greenhouse shows specific text
  const hasSecurityText =
    (bodyText.includes('verification code') || bodyText.includes('security code')) &&
    (bodyText.includes('8-character') || bodyText.includes('confirm you') || bodyText.includes('resubmit'))

  // Also detect by presence of multiple single-char inputs (the code entry fields)
  const singleCharInputs = Array.from(document.querySelectorAll('input')).filter(inp => {
    const ml = inp.getAttribute('maxlength')
    const size = inp.getAttribute('size')
    return ml === '1' || size === '1'
  })

  if (!hasSecurityText && singleCharInputs.length < 8) {
    return null // Not a security code page
  }

  log('Greenhouse security code page detected! Fetching code from Gmail...')

  // Retry up to 3 times (email delivery can take a few seconds)
  let code = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      log(`Security code fetch attempt ${attempt + 1}/3 — waiting for email delivery...`)
      await sleep(10000) // Wait 10s between retries
    }

    const response = await sendChromeMessage({ action: 'getGreenhouseSecurityCode' })
    if (response?.success && response.code) {
      code = response.code
      log(`Got security code: ${code} (method: ${response.method})`)
      break
    }
    warn('Security code not found, attempt', attempt + 1, ':', response?.error)
  }

  if (!code) {
    warn('Failed to get security code after 3 attempts — manual entry required')
    return null
  }

  // Enter the code into the input fields
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set

  if (singleCharInputs.length >= 8) {
    // 8 individual single-char inputs
    log('Entering code into', singleCharInputs.length, 'individual input fields...')
    for (let i = 0; i < 8 && i < code.length && i < singleCharInputs.length; i++) {
      const inp = singleCharInputs[i]
      inp.focus()
      if (nativeSetter) nativeSetter.call(inp, code[i])
      else inp.value = code[i]
      inp.dispatchEvent(new Event('input', { bubbles: true }))
      inp.dispatchEvent(new InputEvent('input', { bubbles: true, data: code[i], inputType: 'insertText' }))
      inp.dispatchEvent(new Event('change', { bubbles: true }))
      await sleep(80)
    }
  } else {
    // Fallback: single input for the full code
    const singleInput = document.querySelector(
      'input[name*="security"], input[name*="code"], input[placeholder*="code"], ' +
      'input[aria-label*="code"], input[aria-label*="security"]'
    )
    if (singleInput) {
      singleInput.focus()
      if (nativeSetter) nativeSetter.call(singleInput, code)
      else singleInput.value = code
      singleInput.dispatchEvent(new Event('input', { bubbles: true }))
      singleInput.dispatchEvent(new Event('change', { bubbles: true }))
      log('Entered full code into single input field')
    } else {
      warn('No suitable input field found for security code')
      return null
    }
  }

  log('Security code entered, re-submitting application...')
  await sleep(1000)

  // Re-click Submit
  const submitted = await submitForm()
  if (submitted) {
    await sleep(3000)
    if (isApplicationConfirmed()) {
      log('Application confirmed after security code entry!')
      return 'confirmed'
    }
    return 'submitted'
  }

  return null
}

// ─── Multi-Step Form Navigation ───────────────────────────────────────

async function navigateMultiStepForm() {
  // ── Lever direct submit bypass ──
  // If handleLever() already submitted the application via direct API POST,
  // skip the entire multi-step navigation — the application is done.
  if (window.__leverDirectSubmitted) {
    log('Lever direct submit already completed — skipping navigateMultiStepForm')
    return 'submitted'
  }

  let submitAttempts = 0
  const maxSubmitRetries = 3
  let consecutiveZeroFills = 0  // Stuck detection: count consecutive steps with 0 fields filled

  for (let step = 0; step < ATS_CONFIG.maxAttempts; step++) {
    log(`--- Form step ${step + 1} ---`)

    // Check for confirmation first (might already be on success page)
    if (isApplicationConfirmed()) {
      log('Application confirmed!')
      return 'confirmed'
    }

    // Fill current step
    let filledCount = 0
    try { filledCount = (await fillAllFormFields()) || 0 } catch(e) { warn('navigateMultiStep fillAll error:', e.message) }

    // Upload CV if file input appeared on this step
    const fileInput = document.querySelector('input[type="file"]')
    if (fileInput && (!fileInput.files || fileInput.files.length === 0)) {
      try { await fetchAndUploadCV(fileInput) } catch(e) {}
    }

    // Fill custom questions if on a Greenhouse-like form
    if (document.querySelector('#custom_fields, .custom-field, [class*="custom_field"]')) {
      try { await fillGreenhouseCustomQuestions() } catch(e) {}
    }

    // Fill Lever cards[*] custom questions if on a Lever form
    if (document.querySelector('input[name^="cards["], .custom-question, .application-question')) {
      try { await fillLeverCustomQuestions() } catch(e) {}
    }

    // Label-based scan — fills fields that container-based scanning missed
    try { await fillByLabelScan() } catch(e) { warn('navigateMultiStep labelScan error:', e.message) }

    await sleep(1000)

    // Stuck detection: track consecutive steps with 0 fields filled
    log(`Filled ${filledCount} fields on step ${step + 1}`)
    if (filledCount === 0) {
      consecutiveZeroFills++
    } else {
      consecutiveZeroFills = 0
    }

    // If 3+ consecutive steps filled 0 fields, the "Next" button is likely phantom —
    // skip Next detection entirely and fall through to Submit
    if (consecutiveZeroFills < 3) {
      // Look for Next / Continue button (multi-step forms)
      const nextBtn = findAndClickButton([
        'Next', 'Continue', 'Suivant', 'Continuer',
        'Save and continue', 'Save & continue',
        'Next step', 'Proceed',
      ])
      if (nextBtn && !nextBtn.disabled) {
        log('Clicking next/continue:', nextBtn.textContent?.trim())
        nextBtn.click()
        await randomDelay(ATS_CONFIG.stepDelay.min, ATS_CONFIG.stepDelay.max)

        // Check if page actually changed (button might have triggered validation)
        await sleep(1000)
        const errorsAfterNext = getValidationErrors()
        if (errorsAfterNext.length > 0) {
          log('Validation errors after Next click:', errorsAfterNext.length)
          errorsAfterNext.forEach(e => log('  Error:', e))
          // Try to fill errored fields and retry
          await fillAllFormFields()
          await sleep(500)
        }
        continue
      }
    } else {
      log(`Stuck detected: ${consecutiveZeroFills} consecutive steps with 0 fields filled — skipping Next, trying Submit`)
    }

    // No Next button — look for Submit
    const preSubmitErrors = getValidationErrors()
    if (preSubmitErrors.length > 0) {
      log('Pre-submit validation errors:', preSubmitErrors.length)
      preSubmitErrors.forEach(e => log('  -', e))
    }

    const submitted = await submitForm()
    if (submitted) {
      await sleep(3000)

      // Check for confirmation
      if (isApplicationConfirmed()) {
        return 'confirmed'
      }

      // Check for Greenhouse security code page (email 2FA)
      const securityResult = await handleGreenhouseSecurityCode()
      if (securityResult === 'confirmed') {
        return 'confirmed'
      } else if (securityResult === 'submitted') {
        return 'submitted'
      }

      // Check for validation errors (submit clicked but form stayed on page)
      const postSubmitErrors = getValidationErrors()
      const stillOnForm = !!document.querySelector('form[class*="apply"], form[class*="application"], form')
      const urlChanged = false // Can't easily detect URL changes in content script

      if (postSubmitErrors.length > 0 && stillOnForm && submitAttempts < maxSubmitRetries) {
        submitAttempts++
        log(`Submit attempt ${submitAttempts}/${maxSubmitRetries} — validation errors detected, retrying...`)
        postSubmitErrors.forEach(e => log('  Error:', e))

        // Try to fill the errored fields
        await fillAllFormFields()

        // Specifically try to fill required empty fields highlighted by errors
        const errorFields = document.querySelectorAll(
          '.field--error input, .field-error input, [aria-invalid="true"], ' +
          '.has-error input, .error input:not([type="hidden"])'
        )
        for (const ef of errorFields) {
          if (!ef.value || ef.value.trim() === '') {
            const label = getLabelText(ef)
            const isTA = ef.tagName === 'TEXTAREA'
            const answer = answerCustomQuestion(label, isTA ? 'textarea' : 'text') || matchFieldToValue(label)
            if (answer) {
              setReactValue(ef, answer)
              ef.dispatchEvent(new Event('input', { bubbles: true }))
              ef.dispatchEvent(new Event('change', { bubbles: true }))
              log('Fixed errored field:', label.substring(0, 50))
            }
          }
        }

        await sleep(1000)
        continue // Retry the loop (will try submit again)
      }

      // If no errors or max retries reached
      if (postSubmitErrors.length === 0 || !stillOnForm) {
        return 'submitted' // Likely succeeded — no errors visible
      } else {
        // Last resort: if the only remaining error is the CV "100MB" bug,
        // clear the file input and retry submit WITHOUT the CV.
        // Better to submit without CV than not submit at all.
        const onlyCvError = postSubmitErrors.every(e =>
          e.toLowerCase().includes('file') || e.toLowerCase().includes('upload') || e.toLowerCase().includes('100mb') || e.toLowerCase().includes('size')
        )
        if (onlyCvError && postSubmitErrors.length > 0) {
          log('Only CV upload error remains — clearing file input and retrying submit without CV')
          const fileInputs = document.querySelectorAll('input[type="file"]')
          for (const fi of fileInputs) {
            try {
              fi.value = ''
              fi.files = new DataTransfer().files
              fi.dispatchEvent(new Event('change', { bubbles: true }))
            } catch {}
          }
          await sleep(1000)
          const retrySubmit = await submitForm()
          if (retrySubmit) {
            await sleep(3000)
            if (isApplicationConfirmed()) return 'confirmed'
            return 'submitted' // Submitted without CV — user can add later
          }
        }
        log('Submit failed after retries — still has validation errors')
        return 'validation_errors'
      }
    }

    // No next or submit button found — retry once after a longer wait
    // React re-renders or lazy-loaded components may need extra time
    if (step === 0) {
      log('No Next or Submit button found on first attempt — waiting 3s and retrying...')
      await sleep(3000)
      // Scroll to bottom of form to trigger any lazy rendering
      const formBottom = document.querySelector('.application--submit, [class*="submit"], form')
      if (formBottom) {
        formBottom.scrollIntoView({ behavior: 'smooth', block: 'center' })
        await sleep(1000)
      }
      continue
    }
    log('No Next or Submit button found on this step')
    break
  }

  return 'stuck'
}

// ─── ATS Router ───────────────────────────────────────────────────────

const ATS_HANDLERS = {
  greenhouse: handleGreenhouse,
  lever: handleLever,
  workable: handleWorkable,
  ashby: handleAshby,
  manatal: handleManatal,
  breezy: handleBreezy,
  recruitee: handleRecruitee,
  teamtailor: handleTeamtailor,
  smartrecruiters: handleSmartRecruiters,
  workday: handleWorkday,
  bamboohr: handleGeneric,
  jobvite: handleGeneric,
  icims: handleGeneric,
  pinpoint: handleGeneric,
  dover: handleGeneric,
  rippling: handleGeneric,
  jazz: handleGeneric,
  comeet: handleGeneric,
  freshteam: handleGeneric,
  zohorecruit: handleGeneric,
  personio: handleGeneric,
  join: handleGeneric,
  polymer: handleGeneric,
  welcomekit: handleGeneric,
  homerun: handleGeneric,
  hundred5: handleGeneric,
  generic: handleGeneric,
}

// ─── Main Entry Point ─────────────────────────────────────────────────

;(async () => {
  // Guard against double injection (manifest content_script + background.js programmatic)
  // Uses chrome.storage.local instead of window.* to work across isolated/main worlds.
  const currentUrl = window.location.href
  try {
    const guardData = await chrome.storage.local.get(['atsApplyRunning', 'atsApplyForceRerun'])
    if (guardData.atsApplyRunning === currentUrl && !guardData.atsApplyForceRerun) {
      log('ats-apply.js already running for this URL — skipping duplicate')
      return
    }
    // Clear the force-rerun flag if it was set (we're honoring it now)
    if (guardData.atsApplyForceRerun) {
      log('ats-apply.js force-rerun flag detected — re-running')
      await chrome.storage.local.remove('atsApplyForceRerun')
    }
    // Set the guard for this URL
    await chrome.storage.local.set({ atsApplyRunning: currentUrl })
  } catch (guardErr) {
    warn('Guard check failed, proceeding anyway:', guardErr.message)
  }

  log('ats-apply.js v2.6.0 loaded on:', currentUrl)

  // ─── Early confirmation page detection ──────────────────────────────
  // If we landed on a /confirmation page (e.g. after Greenhouse submit navigated here),
  // immediately write a success result WITHOUT attempting to fill any forms.
  // This prevents the re-injected script from clobbering the original successful result.
  const isConfirmationUrl = /\/(confirmation|thankyou|thank-you|success|applied)\b/i.test(currentUrl)
  if (isConfirmationUrl || isApplicationConfirmed()) {
    log('Confirmation page detected at startup — URL:', currentUrl)
    log('isConfirmationUrl:', isConfirmationUrl, '| isApplicationConfirmed():', isApplicationConfirmed())

    // Read context to populate result metadata (best effort)
    let earlyContext = null
    try {
      const ctxData = await chrome.storage.local.get(['atsApplyContext'])
      earlyContext = ctxData.atsApplyContext
    } catch {}

    // Only write the success result if there's an active apply context
    // (avoids writing spurious results when user manually browses to a confirmation page)
    if (earlyContext && !earlyContext.standalone) {
      const confirmResult = {
        success: true,
        status: 'applied_external',
        company: earlyContext.company || 'Unknown',
        role: earlyContext.role || 'Unknown',
        url: earlyContext.url || '',
        linkedinUrl: earlyContext.linkedinUrl || '',
        atsType: earlyContext.atsType || 'generic',
        atsUrl: currentUrl,
        atsTabId: earlyContext.tabId,
        reason: `Application confirmed — landed on confirmation page (${earlyContext.atsType || 'generic'})`,
        timestamp: new Date().toISOString(),
      }
      log('Early confirmation result:', confirmResult.status, confirmResult.reason)
      await chrome.storage.local.set({ lastApplyResult: confirmResult })
      await chrome.storage.local.remove('atsApplyContext')
      await chrome.storage.local.remove('pendingExternalApply')
      try { await chrome.storage.local.remove('atsApplyRunning') } catch {}
      return // Exit early — do NOT attempt to fill forms on confirmation page
    } else {
      log('Confirmation page detected but no active apply context — continuing normally')
    }
  }

  // Load user profile from storage (overrides hardcoded defaults)
  await loadProfile()

  // Read context from storage — retry up to 10 times (background.js may not have set it yet)
  let context = null
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const data = await chrome.storage.local.get(['atsApplyContext'])
      context = data.atsApplyContext
    } catch (err) {
      warn('Failed to read atsApplyContext:', err.message)
    }
    if (context) break
    log(`Waiting for atsApplyContext... attempt ${attempt + 1}/10`)
    await sleep(1500)
  }

  if (!context) {
    // Standalone mode: no context from background.js, but we're on an ATS page
    // Auto-detect ATS type from URL and fill with defaults
    const url = window.location.href.toLowerCase()
    let detectedAts = 'generic'
    if (url.includes('greenhouse.io')) detectedAts = 'greenhouse'
    else if (url.includes('lever.co')) detectedAts = 'lever'
    else if (url.includes('workable.com')) detectedAts = 'workable'
    else if (url.includes('ashbyhq.com')) detectedAts = 'ashby'
    else if (url.includes('smartrecruiters.com')) detectedAts = 'smartrecruiters'
    else if (url.includes('teamtailor.com')) detectedAts = 'teamtailor'
    else if (url.includes('breezy.hr')) detectedAts = 'breezy'
    else if (url.includes('recruitee.com')) detectedAts = 'recruitee'
    else if (url.includes('careers-page.com')) detectedAts = 'manatal'
    else if (url.includes('workday.com') || url.includes('myworkdayjobs.com')) detectedAts = 'workday'

    log(`Standalone mode — no context, detected ATS: ${detectedAts}`)
    context = { atsType: detectedAts, company: 'Unknown', role: 'Unknown', standalone: true }
  }

  const atsType = context.atsType || 'generic'
  const company = context.company || 'Unknown'
  const role = context.role || 'Unknown'

  log(`ATS Type: ${atsType} | Company: ${company} | Role: ${role}`)
  log(`URL: ${window.location.href}`)

  const result = {
    success: false,
    status: 'pending',
    company,
    role,
    url: context.url || '',
    linkedinUrl: context.linkedinUrl || '',
    atsType,
    atsUrl: window.location.href,
    atsTabId: context.tabId,
    timestamp: new Date().toISOString(),
  }

  try {
    // Route to ATS-specific handler
    const handler = ATS_HANDLERS[atsType] || handleGeneric
    const fillSuccess = await handler(context)

    // Safety net: always run label-based scan after handler completes
    // (handles forms where container-based scanning missed fields)
    try { await fillByLabelScan() } catch(e) { warn('Post-handler fillByLabelScan error:', e.message) }

    if (!fillSuccess) {
      // Handler returned false — mark as needs_manual
      if (atsType === 'ashby') {
        result.status = 'needs_manual'
        result.reason = 'Ashby CSP blocks CV upload — form partially filled, attach CV manually'
      } else if (atsType === 'workday') {
        result.status = 'needs_manual'
        result.reason = 'Workday requires account creation — apply manually'
      } else {
        result.status = 'needs_manual'
        result.reason = 'Form fill incomplete — some fields could not be matched'
      }
    } else {
      // Try multi-step navigation and submission
      const navResult = await navigateMultiStepForm()

      if (navResult === 'confirmed') {
        result.success = true
        result.status = 'applied_external'
        result.reason = `Application submitted via ${atsType} ATS — confirmation detected`
      } else if (navResult === 'submitted') {
        // Submit was clicked and no errors remained — likely succeeded
        result.success = true
        result.status = 'applied_external'
        result.reason = `Submit clicked on ${atsType} — no validation errors, likely submitted`
      } else if (navResult === 'validation_errors') {
        // Submit was clicked but validation errors remain — NOT submitted
        result.success = false
        result.status = 'needs_manual'
        const errors = getValidationErrors()
        result.reason = `Form filled on ${atsType} but validation errors remain (${errors.length} errors) — submit did NOT complete. Errors: ${errors.slice(0, 3).join('; ')}`
      } else {
        // Stuck — no submit button found
        result.success = false
        result.status = 'needs_manual'
        result.reason = `Form filled on ${atsType} but could not find submit/next button — check manually`
      }
    }
  } catch (err) {
    warn('ATS apply error:', err.message, err.stack)
    result.status = 'failed'
    result.reason = `Error on ${atsType}: ${err.message}`
  }

  // Store debug log for diagnostics
  try {
    await chrome.storage.local.set({ atsApplyDebugLog: _debugLog || [] })
  } catch {}

  // Store result for background.js to pick up
  log('Final result:', result.status, result.reason)
  if (!context.standalone) {
    await chrome.storage.local.set({ lastApplyResult: result })
    await chrome.storage.local.remove('atsApplyContext')
    await chrome.storage.local.remove('pendingExternalApply')
  }
  // Clear the execution guard so future navigations can re-run
  try { await chrome.storage.local.remove('atsApplyRunning') } catch {}
})()
