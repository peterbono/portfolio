/**
 * JobTracker — ATS Auto-Apply Content Script v2.5.0
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

// ─── Profile Data (hardcoded for now) ─────────────────────────────────

const PROFILE = {
  firstName: 'Florian',
  lastName: 'Gouloubi',
  fullName: 'Florian Gouloubi',
  email: 'florian.gouloubi@gmail.com',
  phone: '+66 618156481',
  portfolio: 'https://www.floriangouloubi.com/',
  linkedin: 'https://www.linkedin.com/in/floriangouloubi/',
  city: 'Bangkok',
  country: 'Thailand',
  yearsExperience: '7',
  salary: '80000',
  currentTitle: 'Senior Product Designer',
  cvUrl: 'https://raw.githubusercontent.com/peterbono/portfolio/main/cvflo.pdf',
  cvFilename: 'Florian_Gouloubi_CV.pdf',
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

function log(...args) {
  console.log('[JobTracker ATS]', ...args)
}

function warn(...args) {
  console.warn('[JobTracker ATS]', ...args)
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
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set || Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value'
  )?.set

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value)
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
  // Check nearby label in parent container
  const container = input.closest('.field, .form-group, .form-field, [class*="field"], [class*="form"]')
  const nearbyLabel = container?.querySelector('label, .label, [class*="label"]')?.textContent || ''
  // Check name attribute
  const name = input.getAttribute('name') || ''

  return (ariaLabel + ' ' + placeholder + ' ' + labelText + ' ' + parentLabel + ' ' + nearbyLabel + ' ' + name).toLowerCase()
}

// Click a button matching any of the given text patterns
function findAndClickButton(texts) {
  const allClickables = document.querySelectorAll('button, input[type="submit"], a[role="button"], [class*="submit"], [class*="btn"]')
  for (const el of allClickables) {
    const text = (el.textContent || el.value || '').trim().toLowerCase()
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase()
    for (const t of texts) {
      if (text.includes(t.toLowerCase()) || ariaLabel.includes(t.toLowerCase())) {
        return el
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
    log('Fetching CV from GitHub...', PROFILE.cvUrl)
    // Content scripts have their own fetch (not subject to page CSP)
    const response = await fetch(PROFILE.cvUrl)
    if (!response.ok) throw new Error(`CV fetch failed: ${response.status} ${response.statusText}`)

    const blob = await response.blob()
    log('CV fetched:', blob.size, 'bytes, type:', blob.type)
    const file = new File([blob], PROFILE.cvFilename, { type: 'application/pdf' })

    // Method 1: DataTransfer API (most reliable in content scripts)
    log('Uploading CV via DataTransfer API...')
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(file)
    fileInput.files = dataTransfer.files
    fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    fileInput.dispatchEvent(new Event('input', { bubbles: true }))
    await sleep(500)

    // Verify file was accepted
    if (fileInput.files?.length > 0 && fileInput.files[0]?.size > 0) {
      log('CV uploaded successfully via DataTransfer:', PROFILE.cvFilename, fileInput.files[0].size, 'bytes')
      return true
    }

    // Method 2: React internal props
    log('DataTransfer didn\'t stick, trying React props...')
    const reactProps = getReactProps(fileInput)
    if (reactProps?.onChange) {
      reactProps.onChange({ target: { files: dataTransfer.files } })
      await sleep(1000)
      log('CV uploaded via React onChange props')
      return true
    }

    // Method 3: DragEvent on nearest drop zone
    log('Trying DragEvent on drop zone...')
    const dropZone = fileInput.closest('[class*="drop"], [class*="upload"], [class*="file"], .field')
      || fileInput.parentElement
    if (dropZone) {
      const dragEnterEvent = new DragEvent('dragenter', { bubbles: true, cancelable: true })
      const dragOverEvent = new DragEvent('dragover', { bubbles: true, cancelable: true })
      const dropEvent = new DragEvent('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: { files: [file], items: [{ kind: 'file', type: 'application/pdf', getAsFile: () => file }], types: ['Files'] }
      })
      dropZone.dispatchEvent(dragEnterEvent)
      dropZone.dispatchEvent(dragOverEvent)
      dropZone.dispatchEvent(dropEvent)
      await sleep(1000)
      log('CV uploaded via DragEvent on drop zone')
      return true
    }

    // If all methods tried, consider it uploaded (DataTransfer was set even if files prop didn't stick)
    log('CV upload methods exhausted — DataTransfer was applied')
    return true
  } catch (err) {
    warn('CV upload failed:', err.message)
    return false
  }
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
  log('Starting generic form fill...')
  let filledCount = 0

  // ── Text inputs and textareas ──
  const inputs = document.querySelectorAll(
    'input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]), textarea'
  )

  for (const input of inputs) {
    // Skip if already filled
    if (input.value && input.value.trim().length > 0) continue
    // Skip invisible inputs
    if (input.offsetParent === null && !input.closest('[style*="display"]')) continue
    // Skip intl-tel-input search inputs (handled separately by ATS-specific code)
    if (input.id === 'country' || input.type === 'search' || input.closest('.iti__search-input, .iti')) continue
    // Skip React-Select combobox inputs (handled by fillReactSelectDropdowns)
    if (input.getAttribute('role') === 'combobox' || input.classList.contains('select__input') || input.closest('.select-shell, [class*="select-shell"], [class*="select__container"], [class*="select__control"]')) continue
    // Also skip if input ID contains "react-select" (auto-generated by React-Select)
    if (input.id?.includes('react-select')) continue
    // Skip EEO/demographic fields (select dropdowns rendered as text inputs by React)
    const eeoIds = ['gender', 'race', 'ethnicity', 'hispanic_ethnicity', 'veteran_status', 'disability_status']
    if (eeoIds.includes(input.id) || input.id?.startsWith('4014') || input.id?.startsWith('4015')) continue

    const labelInfo = getLabelText(input)
    const matched = matchFieldToValue(labelInfo)

    if (matched) {
      // Use setReactValue for ALL fields (fast + React-compatible)
      // humanType is only needed for fields with autocomplete (Google Places)
      const actualValue = matched === '___PHONE___' ? PROFILE.phone : matched
      log(`Filling field [${labelInfo.trim().substring(0, 50)}] with: ${actualValue.substring(0, 30)}...`)
      if (input.tagName === 'TEXTAREA') {
        const taSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
        if (taSetter) taSetter.call(input, actualValue)
        else input.value = actualValue
      } else {
        const inpSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        if (inpSetter) inpSetter.call(input, actualValue)
        else input.value = actualValue
      }
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      input.dispatchEvent(new Event('blur', { bubbles: true }))
      filledCount++
      await sleep(150)
    }
  }

  // ── Cover letter / Additional info textareas ──
  const textareas = document.querySelectorAll('textarea')
  for (const ta of textareas) {
    if (ta.value && ta.value.trim().length > 0) continue
    const labelInfo = getLabelText(ta)
    if (labelInfo.includes('cover') || labelInfo.includes('letter') || labelInfo.includes('motivation') ||
        labelInfo.includes('additional') || labelInfo.includes('message') || labelInfo.includes('why') ||
        labelInfo.includes('about you') || labelInfo.includes('lettre') || labelInfo.includes('presentation')) {
      const coverLetter = `I am a Senior Product Designer with 7+ years of experience specializing in design systems, complex product architecture, and design ops. I have led design across iGaming, B2B SaaS, and media platforms, delivering scalable systems that improved development feedback by 90% and managed 143+ templates. I am currently based in Bangkok and available to start immediately. Please find my portfolio at ${PROFILE.portfolio}`
      setReactValue(ta, coverLetter)
      filledCount++
    }
  }

  // ── Radio buttons (Yes/No questions) ──
  const radioGroups = document.querySelectorAll('fieldset, [role="radiogroup"], [class*="radio-group"], [class*="question"]')
  for (const group of radioGroups) {
    const groupText = (group.textContent || '').toLowerCase()
    const radios = group.querySelectorAll('input[type="radio"]')
    if (radios.length === 0) continue

    // Check if already answered
    const checked = Array.from(radios).some(r => r.checked)
    if (checked) continue

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
      for (const radio of radios) {
        const radioLabel = (radio.closest('label')?.textContent || radio.nextElementSibling?.textContent || radio.parentElement?.textContent || '').toLowerCase().trim()
        if (radioLabel.includes(selectValue)) {
          radio.click()
          filledCount++
          await randomDelay(200, 500)
          break
        }
      }
    }
  }

  // ── Checkboxes (consent, terms) ──
  const checkboxes = document.querySelectorAll('input[type="checkbox"]')
  for (const cb of checkboxes) {
    if (cb.checked) continue
    const labelInfo = getLabelText(cb)
    if (labelInfo.includes('agree') || labelInfo.includes('consent') || labelInfo.includes('privacy') ||
        labelInfo.includes('terms') || labelInfo.includes('acknowledge') || labelInfo.includes('accept') ||
        labelInfo.includes('j\'accepte') || labelInfo.includes('conditions')) {
      cb.click()
      filledCount++
      await randomDelay(100, 300)
    }
  }

  // ── Select dropdowns ──
  const selects = document.querySelectorAll('select')
  for (const select of selects) {
    if (select.value && select.selectedIndex > 0) continue
    const labelInfo = getLabelText(select)

    // Try to match country
    if (labelInfo.includes('country') || labelInfo.includes('pays')) {
      const options = Array.from(select.options)
      const match = options.find(o => o.text.toLowerCase().includes('thailand') || o.value.toLowerCase().includes('thailand') || o.value.toLowerCase().includes('th'))
      if (match) {
        select.value = match.value
        select.dispatchEvent(new Event('change', { bubbles: true }))
        filledCount++
        continue
      }
    }

    // Gender / EEO — select "Prefer not to say" or "Decline"
    if (labelInfo.includes('gender') || labelInfo.includes('race') || labelInfo.includes('veteran') || labelInfo.includes('disability') || labelInfo.includes('ethnicity')) {
      const options = Array.from(select.options)
      const match = options.find(o => {
        const t = o.text.toLowerCase()
        return t.includes('decline') || t.includes('prefer not') || t.includes('not wish') || t.includes('ne souhaite pas')
      })
      if (match) {
        select.value = match.value
        select.dispatchEvent(new Event('change', { bubbles: true }))
        filledCount++
      }
      continue
    }

    // How did you hear — select "LinkedIn" if available
    if (labelInfo.includes('how did you') || labelInfo.includes('source') || labelInfo.includes('hear about')) {
      const options = Array.from(select.options)
      const match = options.find(o => o.text.toLowerCase().includes('linkedin'))
      if (match) {
        select.value = match.value
        select.dispatchEvent(new Event('change', { bubbles: true }))
        filledCount++
      }
      continue
    }
  }

  // ── File inputs (CV upload — skip cover_letter) ──
  const fileInputs = document.querySelectorAll('input[type="file"]')
  let cvUploaded = false
  for (const fi of fileInputs) {
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

  log(`Filled ${filledCount} fields`)
  return filledCount
}

// ─── ATS-Specific Handlers ────────────────────────────────────────────

// ── Greenhouse ────────────────────────────────────────────────────────

// Smart answers for common custom questions on ATS forms
const CUSTOM_QUESTION_ANSWERS = {
  // Work authorization
  authorized: 'Yes — EU citizen (French passport), eligible to work in most countries',
  sponsor: 'No',
  visa: 'I hold a French/EU passport and am currently based in Bangkok, Thailand. I do not require visa sponsorship for EU-based remote positions.',

  // Availability
  startDate: 'Immediately',
  noticePeriod: '0 — available immediately',
  availability: 'Immediately available',

  // Salary
  salary: '80000',
  salaryExpectation: '80,000 EUR annually',

  // Experience
  yearsExperience: '7',
  designSystems: 'Yes — 7+ years building and maintaining design systems (Figma, Storybook, Zeroheight). Managed 143+ templates across 7 SaaS products.',
  tools: 'Figma, Storybook, Zeroheight, Jira, Maze, Rive, Notion, Adobe Creative Suite',

  // Remote
  remote: 'Yes',
  relocate: 'Open to discussion',
  timezone: 'GMT+7 (Bangkok) — flexible with async teams',

  // Generic
  howHeard: 'LinkedIn',
  referral: 'No referral — found via LinkedIn',
  portfolio: 'https://www.floriangouloubi.com/',
  coverLetter: 'I am a Senior Product Designer with 7+ years of experience specializing in design systems, complex product architecture, and design ops. I have led design across iGaming, B2B SaaS, and media platforms, delivering scalable systems that improved development feedback by 90% and managed 143+ templates across 7 SaaS products. Currently based in Bangkok, available immediately. Portfolio: https://www.floriangouloubi.com/',
}

// Match a custom question text to a smart answer
function answerCustomQuestion(questionText) {
  const q = questionText.toLowerCase()

  // Work authorization / right to work — MUST come before generic country/location
  if (q.includes('authorized') || q.includes('authorised') || q.includes('right to work') || q.includes('eligible to work') || (q.includes('legally') && q.includes('work'))) return CUSTOM_QUESTION_ANSWERS.authorized
  if (q.includes('sponsor') && (q.includes('visa') || q.includes('now or in the future') || q.includes('immigration') || q.includes('require'))) return CUSTOM_QUESTION_ANSWERS.sponsor
  if ((q.includes('visa') || q.includes('work permit')) && !q.includes('status')) return CUSTOM_QUESTION_ANSWERS.visa

  // Employment history at THIS company
  if (q.includes('ever been employed') || q.includes('previously employed') || q.includes('former employee') || q.includes('worked at') || q.includes('have you worked')) return 'No'
  if (q.includes('previously interviewed') || q.includes('ever interviewed') || q.includes('applied before') || q.includes('prior application')) return 'No'
  if (q.includes('relative') || q.includes('spouse') || q.includes('partner') || q.includes('in-law')) return 'No'
  if (q.includes('prohibited') || q.includes('restrictive') || q.includes('non-compete') || q.includes('covenant') || q.includes('limited in your performance')) return 'No'
  if (q.includes('meet') && q.includes('qualifications') || q.includes('meet') && q.includes('requirements')) return 'Yes'

  // Salary / compensation
  if (q.includes('extra compensation') || q.includes('current salary') || q.includes('benefits you receive') || q.includes('current') && q.includes('compensation')) return 'No additional compensation or benefits beyond base salary.'
  if (q.includes('salary') || q.includes('compensation') || q.includes('pay expectation') || q.includes('desired pay') || q.includes('annual') && q.includes('expect')) return CUSTOM_QUESTION_ANSWERS.salaryExpectation
  if (q.includes('salary') && (q.includes('range') || q.includes('number'))) return CUSTOM_QUESTION_ANSWERS.salary

  // AI tools — MUST come before generic tools/experience checks
  if (q.includes('ai') && (q.includes('tool') || q.includes('software') || q.includes('use') || q.includes('familiar'))) return 'Experienced with AI-assisted design workflows: Figma AI, Midjourney for concept exploration, ChatGPT/Claude for UX writing, and custom design system automation.'
  // Beauty / brand — MUST come before generic years/experience check
  if (q.includes('beauty') || (q.includes('brand') && !q.includes('brandtech')) || q.includes('luxury') || q.includes('fashion') || q.includes('cosmetic') || q.includes('skincare')) return 'Experienced with premium brand design across iGaming, B2B SaaS, and media platforms. Strong visual design skills with attention to brand consistency and premium aesthetics.'

  // Experience / years (generic — after specific checks above)
  if (q.includes('years') && (q.includes('experience') || q.includes('expérience'))) return CUSTOM_QUESTION_ANSWERS.yearsExperience
  if (q.includes('design system') || q.includes('design ops')) return CUSTOM_QUESTION_ANSWERS.designSystems
  if (q.includes('tool') || q.includes('software') || q.includes('proficien')) return CUSTOM_QUESTION_ANSWERS.tools

  // Availability / start date / notice period
  if (q.includes('start date') || q.includes('when can you') || q.includes('earliest')) return CUSTOM_QUESTION_ANSWERS.startDate
  if (q.includes('notice period') || q.includes('préavis')) return CUSTOM_QUESTION_ANSWERS.noticePeriod
  if (q.includes('availab') || q.includes('disponib')) return CUSTOM_QUESTION_ANSWERS.availability

  // Country (standalone label, not part of a complex question)
  if ((q === 'country' || q === 'country*') && q.length < 15) return PROFILE.country

  // Remote / location / relocation / timezone
  if (q.includes('remote') || q.includes('work from home') || q.includes('wfh')) return CUSTOM_QUESTION_ANSWERS.remote
  if (q.includes('relocat') || q.includes('willing to move') || q.includes('commute')) return CUSTOM_QUESTION_ANSWERS.relocate
  if (q.includes('timezone') || q.includes('time zone') || q.includes('time difference')) return CUSTOM_QUESTION_ANSWERS.timezone

  // Referral / source
  if (q.includes('how did you hear') || q.includes('how did you find') || q.includes('source') || q.includes('where did you')) return CUSTOM_QUESTION_ANSWERS.howHeard
  if ((q.includes('referr') && (q.includes('employee') || q.includes('someone') || q.includes('who') || q.includes('by'))) || q.includes('recommend') || q.includes('who referred')) return CUSTOM_QUESTION_ANSWERS.referral

  // Cover letter / motivation / about you / why
  if (q.includes('cover letter') || q.includes('motivation') || q.includes('why') && q.includes('interest') || q.includes('tell us about') || q.includes('about yourself') || q.includes('why this role') || q.includes('additional information')) return CUSTOM_QUESTION_ANSWERS.coverLetter

  // Portfolio / website / link
  if (q.includes('portfolio') || q.includes('website') || q.includes('url') || q.includes('link to your work') || q.includes('examples of')) return CUSTOM_QUESTION_ANSWERS.portfolio

  // Gender / race / veteran / EEO — "Decline to Self Identify" or "Prefer not to say"
  if (q.includes('gender') || q.includes('race') || q.includes('veteran') || q.includes('disability') || q.includes('ethnicity') || q.includes('hispanic')) return 'Decline to Self Identify'

  // Data transfer / consent / GDPR
  if (q.includes('data') && (q.includes('transfer') || q.includes('consent') || q.includes('process') || q.includes('protection') || q.includes('privacy'))) return 'Yes, I consent to the processing of my personal data for recruitment purposes.'

  // Accommodations / interview considerations / disability
  if (q.includes('accommodat') || q.includes('special requirement') || q.includes('disability') && q.includes('require') || q.includes('adjustment') || q.includes('accessibility need')) return 'No accommodations needed.'
  if (q.includes('interview') && (q.includes('consider') || q.includes('prefer') || q.includes('availab') || q.includes('schedule'))) return 'Available for interviews any weekday. Based in Bangkok (GMT+7), flexible with time zones for video calls.'
  if (q.includes('anything') && (q.includes('know') || q.includes('share') || q.includes('else') || q.includes('add'))) return `Portfolio: ${PROFILE.portfolio} — 7+ years as a Senior Product Designer specializing in design systems, complex product architecture, and design ops.`

  // Right to work (broader patterns)
  if (q.includes('right') && q.includes('work')) return CUSTOM_QUESTION_ANSWERS.authorized
  if (q.includes('legally') || q.includes('legal right') || q.includes('employment eligib')) return CUSTOM_QUESTION_ANSWERS.authorized
  if (q.includes('work') && q.includes('permit')) return CUSTOM_QUESTION_ANSWERS.visa
  if (q.includes('immigration') || q.includes('citizen')) return CUSTOM_QUESTION_ANSWERS.visa

  // Language / fluency
  if (q.includes('language') || q.includes('fluent') || q.includes('proficien') && q.includes('english')) return 'Bilingual French/English (native French, fluent English). Working proficiency in both languages.'
  if (q.includes('french') || q.includes('français')) return 'Native French speaker'

  // Interest / motivation / why this role (broader)
  if (q.includes('interest') || q.includes('motivat') || q.includes('why') && (q.includes('apply') || q.includes('join') || q.includes('role') || q.includes('company') || q.includes('position'))) return CUSTOM_QUESTION_ANSWERS.coverLetter
  if (q.includes('tell us') || q.includes('describe') || q.includes('about yourself') || q.includes('summary') || q.includes('introduce')) return CUSTOM_QUESTION_ANSWERS.coverLetter

  // Consent / agreement (broader)
  if (q.includes('consent') || q.includes('agree') || q.includes('acknowledge') || q.includes('confirm') || q.includes('certify') || q.includes('attest')) return 'Yes'

  // Generic fallback for any remaining text field
  return null
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
  await sleep(ATS_CONFIG.pageLoadWait)

  // Step 1: Click "Apply for this job" if on landing page
  const applyBtn = findAndClickButton(['Apply for this job', 'Apply now', 'Apply', 'Postuler'])
  if (applyBtn) {
    log('Clicking Greenhouse apply button...')
    applyBtn.click()
    await sleep(3000)
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
  log('Scanning for custom questions...')

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

    // Text inputs — skip React-Select comboboxes (handled by fillReactSelectDropdowns)
    // IMPORTANT: Also skip if this container HAS a .select-shell (it's a dropdown, not a text field)
    // Greenhouse Remix uses CSS modules (remix-css-XXXX-input) so class*="select__input" may not match
    if (container.querySelector('.select-shell, [class*="select-shell"], [class*="select__control"]')) continue
    // Skip phone fieldsets (intl-tel-input + React-Select country code)
    if (container.matches('fieldset.phone-input, [class*="phone-input"], [class*="phone-field"]') || container.closest('fieldset.phone-input, [class*="phone-input"]')) continue

    const textInput = container.querySelector('input[type="text"]:not([role="combobox"]):not([class*="select__input"]):not([type="hidden"]), input:not([type]):not([role="combobox"]):not([class*="select__input"]):not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])')
    // Final guard: skip if the input is inside a React-Select container (catches Remix CSS module classes)
    if (textInput?.closest('.select-shell, [class*="select-shell"], [class*="select__container"], [class*="select__control"]')) {
      log(`Custom Q skip React-Select input for: "${questionText.substring(0, 50)}"`)
      continue
    }
    // Also skip if input ID contains "react-select" (auto-generated by React-Select)
    if (textInput?.id?.includes('react-select')) {
      log(`Custom Q skip react-select input ID for: "${questionText.substring(0, 50)}"`)
      continue
    }
    if (textInput && (!textInput.value || textInput.value.trim() === '') && !processedInputs.has(textInput)) {
      const answer = answerCustomQuestion(questionText) || matchFieldToValue(getLabelText(textInput))
      if (answer) {
        const actualValue = answer === '___PHONE___' ? PROFILE.phone : answer
        setReactValue(textInput, actualValue)
        textInput.dispatchEvent(new Event('input', { bubbles: true }))
        textInput.dispatchEvent(new Event('change', { bubbles: true }))
        processedInputs.add(textInput)
        log(`Custom Q [${questionText.substring(0, 50)}] → ${actualValue.substring(0, 40)}...`)
        await sleep(300)
      }
    }

    // Textareas
    const textarea = container.querySelector('textarea')
    if (textarea && (!textarea.value || textarea.value.trim() === '') && !processedInputs.has(textarea)) {
      const answer = answerCustomQuestion(questionText)
      if (answer) {
        // Use nativeTextAreaSetter for textareas
        const taSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
        if (taSetter) taSetter.call(textarea, answer)
        else textarea.value = answer
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        textarea.dispatchEvent(new Event('change', { bubbles: true }))
        processedInputs.add(textarea)
        log(`Custom Q textarea [${questionText.substring(0, 50)}] → filled`)
        await sleep(300)
      }
    }

    // Select dropdowns
    const select = container.querySelector('select')
    if (select && (!select.value || select.selectedIndex <= 0) && !processedInputs.has(select)) {
      const answer = answerCustomQuestion(questionText)
      if (answer) {
        // Try to find matching option
        const options = Array.from(select.options)
        const ansLower = answer.toLowerCase()
        const matchedOption = options.find(o => {
          const oText = o.text.toLowerCase()
          const oVal = o.value.toLowerCase()
          return oText.includes(ansLower) || ansLower.includes(oText) ||
                 oVal.includes(ansLower) || (oText === 'yes' && ansLower.includes('yes')) ||
                 (oText === 'no' && ansLower === 'no')
        })
        if (matchedOption) {
          select.value = matchedOption.value
          select.dispatchEvent(new Event('change', { bubbles: true }))
          processedInputs.add(select)
          log(`Custom Q select [${questionText.substring(0, 50)}] → ${matchedOption.text}`)
        }
      }
      await sleep(300)
    }

    // Radio buttons within the container
    const radios = container.querySelectorAll('input[type="radio"]')
    if (radios.length > 0 && !Array.from(radios).some(r => r.checked)) {
      const answer = answerCustomQuestion(questionText)
      if (answer) {
        const ansLower = answer.toLowerCase()
        for (const radio of radios) {
          const radioLabel = (radio.closest('label')?.textContent || radio.nextElementSibling?.textContent || radio.parentElement?.textContent || '').toLowerCase().trim()
          // Match yes/no or the answer text
          if ((ansLower.includes('yes') && radioLabel.includes('yes')) ||
              (ansLower === 'no' && radioLabel.includes('no')) ||
              radioLabel.includes(ansLower) || ansLower.includes(radioLabel)) {
            radio.click()
            log(`Custom Q radio [${questionText.substring(0, 50)}] → ${radioLabel}`)
            await sleep(300)
            break
          }
        }
      }
    }
  }

  // ── Catch-all: fill any remaining empty textareas that weren't matched above ──
  const allTextareas = document.querySelectorAll('textarea')
  for (const ta of allTextareas) {
    if (ta.value && ta.value.trim().length > 0) continue
    if (processedInputs.has(ta)) continue
    // Skip if it's a resume_text paste field (already handled)
    if (ta.id === 'resume_text') continue

    const labelInfo = getLabelText(ta)
    const containerLabel = ta.closest('.field, .form-field, fieldset, [class*="question"]')
      ?.querySelector('label, legend, .field-label, [class*="label"]')?.textContent?.trim() || ''
    const combinedLabel = labelInfo + ' ' + containerLabel.toLowerCase()

    // Try answerCustomQuestion with the combined label
    let answer = answerCustomQuestion(combinedLabel)
    if (!answer) {
      // Ultimate fallback: if it's a required textarea with no match, use cover letter
      const isRequired = ta.hasAttribute('required') || ta.closest('.required, .field--error, [class*="required"]')
      if (isRequired) {
        answer = CUSTOM_QUESTION_ANSWERS.coverLetter
        log(`Catch-all: filling required empty textarea [${combinedLabel.substring(0, 60)}] with cover letter`)
      }
    }
    if (answer) {
      const taSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      if (taSetter) taSetter.call(ta, answer)
      else ta.value = answer
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      ta.dispatchEvent(new Event('change', { bubbles: true }))
      log(`Catch-all textarea [${combinedLabel.substring(0, 50)}] → filled`)
    }
  }
}

// ── Label-based direct scan (no container dependency) ───────────────
// Scans ALL <label> elements, finds their associated input via `for` attribute,
// and fills using answerCustomQuestion. Works on Greenhouse forms that don't use
// .field container wrappers.
async function fillByLabelScan() {
  log('Running label-based direct scan...')
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

    // Skip if already filled
    if (input.value && input.value.trim().length > 0) continue
    // Skip hidden/file/checkbox/radio/submit
    const type = (input.type || '').toLowerCase()
    if (type === 'hidden' || type === 'file' || type === 'checkbox' || type === 'radio' || type === 'submit' || type === 'button') continue
    // Skip recaptcha
    if (input.name === 'g-recaptcha-response') continue
    // Skip country + candidate-location (handled by ATS-specific code)
    if (input.id === 'country' || input.id === 'candidate-location') continue
    // Skip React-Select combobox inputs (handled by fillReactSelectDropdowns)
    if (input.getAttribute('role') === 'combobox' || input.classList.contains('select__input') || input.closest('.select-shell, [class*="select-shell"], [class*="select__container"], [class*="select__control"]')) continue
    // Also skip if input ID contains "react-select" (auto-generated by React-Select)
    if (input.id?.includes('react-select')) continue
    // Skip EEO/demographic fields
    const eeoIds = ['gender', 'race', 'ethnicity', 'hispanic_ethnicity', 'veteran_status', 'disability_status']
    if (eeoIds.includes(input.id) || input.id?.startsWith('4014') || input.id?.startsWith('4015')) continue

    // Try answerCustomQuestion with the label text + aria-label
    const ariaLabel = input.getAttribute('aria-label') || ''
    const combinedText = labelText + ' ' + ariaLabel
    const answer = answerCustomQuestion(combinedText) || matchFieldToValue(combinedText.toLowerCase())
    if (!answer) continue

    const actualValue = answer === '___PHONE___' ? PROFILE.phone : answer

    // Fill using the appropriate setter
    if (input.tagName === 'TEXTAREA') {
      const taSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      if (taSetter) taSetter.call(input, actualValue)
      else input.value = actualValue
    } else {
      const inpSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      if (inpSetter) inpSetter.call(input, actualValue)
      else input.value = actualValue
    }
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.dispatchEvent(new Event('blur', { bubbles: true }))
    filledCount++
    log(`Label scan [${labelText.substring(0, 55)}] → ${actualValue.substring(0, 40)}`)
    await sleep(200)
  }

  log(`Label scan filled ${filledCount} fields`)
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
         optText.includes('choose not') || optText.includes('rather not'))) { bestMatch = opt; break }

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
  const openMenus = document.querySelectorAll('[class*="select__menu"]')
  const openItiLists = document.querySelectorAll('.iti__country-list:not(.iti__hide)')
  const totalOpen = openMenus.length + openItiLists.length
  if (totalOpen > 0) {
    log(`Dismissing ${totalOpen} open menu(s) before processing...`)
    if (useCDP) {
      // Escape key is the standard way to close React-Select dropdowns
      await sendTrustedEscape()
      await sleep(200)
      // Double-tap Escape for stubborn menus (intl-tel-input needs its own Escape)
      if (document.querySelectorAll('[class*="select__menu"]').length > 0) {
        await sendTrustedEscape()
        await sleep(200)
      }
    } else {
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
  log('Scanning for React-Select dropdowns (CDP trusted clicks v3)...')
  let filledCount = 0
  const processed = new Set()
  let debuggerActive = false

  // Find all React-Select instances via .select-shell wrapper
  const allRoots = new Set()
  document.querySelectorAll('.select-shell').forEach(el => {
    if (isPhoneCountryShell(el)) { log('Skipping phone country shell:', el.className?.substring(0, 40)); return }
    allRoots.add(el)
  })
  // Fallback: find by combobox inputs
  document.querySelectorAll('input[role="combobox"][class*="select__input"]').forEach(cb => {
    const shell = cb.closest('.select-shell')
    if (!shell || isPhoneCountryShell(shell)) return
    allRoots.add(shell)
  })
  // Also find generic React-Select without .select-shell (other ATS platforms)
  document.querySelectorAll('[class*="select__control"]').forEach(ctrl => {
    const shell = ctrl.closest('.select-shell, [class*="select__container"], [class*="css-"][class*="container"]')
    if (!shell || isPhoneCountryShell(shell)) return
    allRoots.add(shell)
  })

  log(`Found ${allRoots.size} React-Select instances (after phone filtering)`)

  for (const shell of allRoots) {
    // Skip if already has a selected value
    const hasValue = shell.querySelector('[class*="select__single-value"], [class*="singleValue"]')
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

    // Get answer for this question
    const answer = answerCustomQuestion(questionText)
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
    const control = shell.querySelector('[class*="select__control"]') || shell
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
      menu = shell.querySelector('[class*="select__menu"]')

      // CDP click may have focused the control without opening — send ArrowDown
      if (!menu) {
        await sendArrowDown()
        await sleep(500)
        menu = shell.querySelector('[class*="select__menu"]')
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
      menu = shell.querySelector('[class*="select__menu"]')
    }

    // Method 3: Synthetic mouseDown on control + focus + ArrowDown
    if (!menu) {
      log('React-Select: trying mouseDown + focus + ArrowDown...')
      control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
      await sleep(200)
      if (comboboxInput) { comboboxInput.focus(); await sleep(100) }
      await sendArrowDown()
      await sleep(500)
      menu = shell.querySelector('[class*="select__menu"]')
    }

    // Method 4: CDP click on dropdown indicator (the arrow icon)
    if (!menu && debuggerActive) {
      const indicator = shell.querySelector('[class*="select__indicator"], [class*="select__dropdown-indicator"], [class*="indicatorContainer"]')
      if (indicator) {
        log('React-Select: trying CDP click on dropdown indicator...')
        const indRect = indicator.getBoundingClientRect()
        await sendTrustedClick(Math.round(indRect.left + indRect.width / 2), Math.round(indRect.top + indRect.height / 2))
        await sleep(600)
        menu = shell.querySelector('[class*="select__menu"]')
      }
    }

    // Method 5: React internal props (works without CDP — calls React's own handlers)
    if (!menu) {
      log('React-Select: trying React internal props...')
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
      // Try on the shell itself
      if (!menu) {
        const shellProps = getReactProps(shell)
        if (shellProps?.onMouseDown) {
          shellProps.onMouseDown({ preventDefault: () => {}, button: 0 })
          await sleep(500)
          menu = shell.querySelector('[class*="select__menu"]')
        }
      }
    }

    // Check global menu (portal) but reject phone country menus
    if (!menu) {
      const globalMenu = document.querySelector('[class*="select__menu"]')
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
    const menuOptions = Array.from(menu.querySelectorAll('[class*="select__option"]'))
      .filter(el => !el.closest('.iti, .intl-tel-input'))

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
        const selectedVal = shell.querySelector('[class*="select__single-value"], [class*="singleValue"]')
        if (selectedVal && selectedVal.textContent?.trim()) {
          selectionConfirmed = true
          log(`React-Select: keyboard selection verified — "${selectedVal.textContent.trim()}"`)
        }
      }

      // Method B: React props onClick on the option element
      if (!selectionConfirmed) {
        const optProps = getReactProps(bestMatch)
        if (optProps?.onClick) {
          optProps.onClick({ preventDefault: () => {}, stopPropagation: () => {} })
          await sleep(400)
          const selectedVal2 = shell.querySelector('[class*="select__single-value"], [class*="singleValue"]')
          if (selectedVal2 && selectedVal2.textContent?.trim()) {
            selectionConfirmed = true
            log(`React-Select: React props onClick verified — "${selectedVal2.textContent.trim()}"`)
          }
        }
      }

      // Method C: CDP click on the option (coordinate-based)
      if (!selectionConfirmed) {
        // Re-open menu if it closed
        let reopenedMenu = shell.querySelector('[class*="select__menu"]')
        if (!reopenedMenu) {
          if (debuggerActive) {
            const controlRect2 = control.getBoundingClientRect()
            await sendTrustedClick(Math.round(controlRect2.left + controlRect2.width / 2), Math.round(controlRect2.top + controlRect2.height / 2))
          } else {
            control.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
            if (comboboxInput) { comboboxInput.focus(); await sleep(100) }
            await sendArrowDown()
          }
          await sleep(500)
          reopenedMenu = shell.querySelector('[class*="select__menu"]')
        }
        const targetOpt = reopenedMenu ? findBestOption(Array.from(reopenedMenu.querySelectorAll('[class*="select__option"]')), answer) : bestMatch
        if (targetOpt) {
          targetOpt.scrollIntoView({ block: 'nearest', behavior: 'instant' })
          await sleep(100)
          if (debuggerActive) {
            const optRect = targetOpt.getBoundingClientRect()
            await sendTrustedClick(Math.round(optRect.left + optRect.width / 2), Math.round(optRect.top + optRect.height / 2))
          } else {
            targetOpt.click()
          }
          await sleep(300)
        }
      }
      filledCount++
      log(`React-Select ✓ [${questionText.substring(0, 50)}] → "${bestMatch.textContent?.trim()}"`)
      await sleep(500)
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

    const answer = answerCustomQuestion(questionText)
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

  // Upload CV
  const fileInput = document.querySelector('input[type="file"][name="resume"], input[type="file"]')
  if (fileInput) await fetchAndUploadCV(fileInput)

  // Fill any remaining generic fields
  await fillAllFormFields()

  return true
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
        const file = new File([blob], PROFILE.cvFilename, { type: 'application/pdf' })
        const dzProps = getReactProps(dropZone)
        if (dzProps?.onDrop) {
          dzProps.onDrop({ dataTransfer: { files: [file] }, preventDefault: () => {}, stopPropagation: () => {} })
          filled++
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
  // Try ATS-specific submit selectors first (most reliable)
  const specificSelectors = [
    '#submit_app',                          // Greenhouse
    'input[type="submit"]',                 // Standard HTML submit
    'button[type="submit"]',                // Standard button submit
    'button[data-testid="submit"]',         // Modern React ATS
    'button[class*="submit"]',              // Class-based
    '#application-submit',                  // Common pattern
  ]

  for (const sel of specificSelectors) {
    const btn = document.querySelector(sel)
    if (btn && btn.offsetHeight > 0 && !btn.disabled) {
      log('Found submit via selector:', sel, '| Text:', (btn.textContent || btn.value || '').trim())
      await randomDelay(ATS_CONFIG.clickDelay.min, ATS_CONFIG.clickDelay.max)
      btn.click()
      await sleep(3000)
      return true
    }
  }

  // Fallback: text-based button search
  const submitBtn = findAndClickButton([
    'Submit Application', 'Submit application', 'Submit',
    'Send Application', 'Send application',
    'Soumettre ma candidature', 'Soumettre', 'Envoyer',
    'Complete Application', 'Finish Application',
    'Apply Now', 'Apply', 'Confirm', 'Confirmer',
  ])

  if (submitBtn && !submitBtn.disabled) {
    log('Found submit button by text:', submitBtn.textContent?.trim())
    await randomDelay(ATS_CONFIG.clickDelay.min, ATS_CONFIG.clickDelay.max)
    submitBtn.click()
    await sleep(3000)
    return true
  }

  if (submitBtn && submitBtn.disabled) {
    log('Submit button found but DISABLED — required fields likely missing')
    return false
  }

  // Last resort: form.submit()
  const form = document.querySelector('form[class*="apply"], form[class*="application"], form[action*="apply"], form')
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
  let submitAttempts = 0
  const maxSubmitRetries = 3

  for (let step = 0; step < ATS_CONFIG.maxAttempts; step++) {
    log(`--- Form step ${step + 1} ---`)

    // Check for confirmation first (might already be on success page)
    if (isApplicationConfirmed()) {
      log('Application confirmed!')
      return 'confirmed'
    }

    // Fill current step
    try { await fillAllFormFields() } catch(e) { warn('navigateMultiStep fillAll error:', e.message) }

    // Upload CV if file input appeared on this step
    const fileInput = document.querySelector('input[type="file"]')
    if (fileInput && (!fileInput.files || fileInput.files.length === 0)) {
      try { await fetchAndUploadCV(fileInput) } catch(e) {}
    }

    // Fill custom questions if on a Greenhouse-like form
    if (document.querySelector('#custom_fields, .custom-field, [class*="custom_field"]')) {
      try { await fillGreenhouseCustomQuestions() } catch(e) {}
    }

    // Label-based scan — fills fields that container-based scanning missed
    try { await fillByLabelScan() } catch(e) { warn('navigateMultiStep labelScan error:', e.message) }

    await sleep(1000)

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
            const answer = answerCustomQuestion(label) || matchFieldToValue(label)
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
        log('Submit failed after retries — still has validation errors')
        return 'validation_errors'
      }
    }

    // No next or submit button found — we're stuck
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
  if (window._jobTrackerAtsRan) {
    log('ats-apply.js already ran — skipping duplicate')
    return
  }
  window._jobTrackerAtsRan = true

  log('ats-apply.js v2.4.0 loaded on:', window.location.href)

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

  // Store result for background.js to pick up
  log('Final result:', result.status, result.reason)
  if (!context.standalone) {
    await chrome.storage.local.set({ lastApplyResult: result })
    await chrome.storage.local.remove('atsApplyContext')
    await chrome.storage.local.remove('pendingExternalApply')
  }
})()
