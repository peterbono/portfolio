/**
 * JobTracker — LinkedIn Easy Apply Content Script (v5.1.0)
 * Injected on linkedin.com/jobs/view/* pages via manifest.
 * Handles both Easy Apply (auto-fill+submit) and external Apply (redirect to ATS).
 * Uses ES5-compatible syntax to avoid Chrome content script issues.
 *
 * v5.4.0: Fix field priority — "years of experience" now checked BEFORE "portfolio/URL" to prevent
 *         "...experience showcased in your portfolio?" from filling a URL into a numeric field.
 * v5.3.0: Review page fast-track — detect "Review your application" and aggressively find Submit.
 *         Fix retry recursion resetting stuck counter. Scroll dialog to reveal Submit.
 * v5.2.0: Add early success detection at every step boundary + stuck detection + max steps.
 *         Prevents false "needs_review" when submit actually went through.
 * v5.1.0: Fix hasValidationErrors() false positive from [role="alert"] "Loading job details"
 *         — scope error detection to modal, filter non-error alerts by keyword.
 * v5.0.0: Stuck-step detection, broader input detection, typeahead handling,
 *         post-click DOM change verification, LinkedIn 2026 obfuscated selectors.
 * v4.0.0: LinkedIn DOM redesign — Easy Apply is now <a> tag (not <button>),
 *         job title is <p> (not <h1>), SDUI apply flow via href navigation.
 *         Also searches <a> tags for Easy Apply and external Apply detection.
 * v3.2.1: handleExternalApply() now calls setResult('pending_external') — final status
 *         comes from ats-apply.js after it actually fills and submits the form.
 * v3.2.0: handleExternalApply() now calls setResult('applied_external') immediately.
 * v3.1.0: Safety-net timeout guarantees setResult is always called.
 * v3.0.0: Multi-step form loop — fills every page, clicks Next/Review until Submit.
 */

// Guard against double injection (manifest content_script + background.js programmatic)
if (window._jobTrackerApplyRan) {
  console.log('[JobTracker] linkedin-apply.js already ran — skipping duplicate');
} else {
window._jobTrackerApplyRan = true;

console.log('[JobTracker] linkedin-apply.js v6.2.0 loaded on:', window.location.href);

// ─── Build stamp for version verification ───
var BUILD_STAMP = '2026-04-06-haiku-v3-wrappers';
try {
  var _mf = chrome.runtime.getManifest();
  console.log('[JobTracker LinkedIn] Loaded v' + _mf.version + ' (' + BUILD_STAMP + ')');
} catch (_mfErr) {
  console.log('[JobTracker LinkedIn] Loaded (' + BUILD_STAMP + ')');
}

// ─── Debug log helper (mirrors ats-apply.js; persisted at flow end) ───
var _debugLog = [];
function log() {
  var args = Array.prototype.slice.call(arguments);
  console.log.apply(console, ['[JobTracker]'].concat(args));
  try {
    _debugLog.push('[LOG] ' + args.map(function (a) {
      return typeof a === 'object' ? JSON.stringify(a) : String(a);
    }).join(' '));
  } catch (e) { /* ignore */ }
}
function warn() {
  var args = Array.prototype.slice.call(arguments);
  console.warn.apply(console, ['[JobTracker]'].concat(args));
  try {
    _debugLog.push('[WARN] ' + args.map(function (a) {
      return typeof a === 'object' ? JSON.stringify(a) : String(a);
    }).join(' '));
  } catch (e) { /* ignore */ }
}
function persistDebugLog() {
  try {
    chrome.storage.local.set({ atsApplyDebugLog: _debugLog.slice(-500) });
  } catch (e) { /* ignore */ }
}

// ─── Profile (synced from dashboard via chrome.storage.local) ───
// Used by the Haiku fallback — populated asynchronously at script start.
var PROFILE_DEFAULTS = {
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
};
var PROFILE = {};
for (var _pk in PROFILE_DEFAULTS) { PROFILE[_pk] = PROFILE_DEFAULTS[_pk]; }
try {
  chrome.storage.local.get(['userProfile'], function (data) {
    if (data && data.userProfile && typeof data.userProfile === 'object') {
      for (var k in data.userProfile) {
        if (data.userProfile[k] != null && data.userProfile[k] !== '') {
          PROFILE[k] = data.userProfile[k];
        }
      }
      log('[profile] Loaded userProfile from storage — keys:', Object.keys(data.userProfile).join(','));
    } else {
      log('[profile] No stored userProfile — using LinkedIn defaults');
    }
  });
} catch (_pErr) { /* ignore */ }

// ─── Haiku Fallback Config ───
// When the pattern bank + hardcoded label scan all miss a field, we POST the
// remaining unfilled fields to /api/fill-field (Haiku 4.5) for a best-effort
// answer. Runs before each Next/Review/Submit click on LinkedIn Easy Apply.
var FILL_FIELD_ENDPOINT = 'https://tracker-app-lyart.vercel.app/api/fill-field';
var FILL_FIELD_MAX_BATCH = 20;
var FILL_FIELD_TIMEOUT_MS = 25000;

// Labels/ids that must NEVER be sent to Haiku — legal-sensitive or EEO fields.
// Mirrors ats-apply.js — keep the two lists in sync.
var HAIKU_SENSITIVE_PATTERNS = [
  'authorized to work', 'authorised to work', 'sponsorship', 'visa',
  'work permit', 'work authorization', 'right to work',
  'eligible to work', 'immigration status', 'citizenship',
  'veteran status', 'disability', 'gender identity', 'race',
  'ethnicity', 'hispanic', 'latino', 'sexual orientation', 'lgbtq',
  'pronouns', 'protected class', 'demographic',
  'self-identify', 'self identify', 'criminal history',
  'conviction', 'felony', 'background check', 'drug test',
];

// ─── Safety-net: guarantee setResult is called within 20s ───
// If the main logic silently fails (async callback error, unexpected DOM state),
// this ensures background.js polling always gets a result instead of timing out.
var _resultWasSet = false;
var _safetyTimeout = setTimeout(function() {
  if (!_resultWasSet) {
    console.warn('[JobTracker] Safety-net timeout (30s) — forcing result');
    var company = 'Unknown';
    var role = 'Unknown';
    try { company = getCompany(); } catch(e) {}
    try { role = getRole(); } catch(e) {}
    setResult({
      success: false,
      status: 'no_easy_apply',
      reason: 'Content script safety-net timeout — no result produced within 20s',
      company: company,
      role: role
    });
  }
}, 90000); // 90s — multi-step form with typeahead retries can take 60s+

// ─── Retry loop to find Easy Apply button (LinkedIn SPA renders late) ───
var _retryCount = 0;
var _maxRetries = 10; // 10 retries × 1.0s = 10 seconds max wait

function findEasyApplyButton() {
  // LinkedIn 2026 redesign: Easy Apply is now an <a> tag, not <button>
  // Check <a> tags first (new LinkedIn), then <button> (legacy)

  // Method 1: <a> with aria-label containing "easy apply"
  var easyLinks = document.querySelectorAll('a[aria-label*="Easy Apply"], a[aria-label*="easy apply"], a[aria-label*="Candidature simplifi"]');
  for (var j = 0; j < easyLinks.length; j++) {
    if (easyLinks[j].offsetHeight > 0) {
      console.log('[JobTracker] Found Easy Apply <a> via aria-label:', easyLinks[j].getAttribute('aria-label'));
      return easyLinks[j];
    }
  }

  // Method 2: <a> with href containing /apply/ and text "Easy Apply"
  var allLinks = document.querySelectorAll('a[href*="/apply/"]');
  for (var k = 0; k < allLinks.length; k++) {
    var linkTxt = (allLinks[k].textContent || '').toLowerCase().trim();
    if ((linkTxt.indexOf('easy apply') >= 0 || linkTxt.indexOf('postuler simplement') >= 0 || linkTxt.indexOf('candidature simplifi') >= 0) && allLinks[k].offsetHeight > 0) {
      console.log('[JobTracker] Found Easy Apply <a> via href+text:', allLinks[k].href);
      return allLinks[k];
    }
  }

  // Method 3: <a> or <button> with text matching Easy Apply (broad search)
  var allClickable = document.querySelectorAll('button, a');
  for (var i = 0; i < allClickable.length; i++) {
    var txt = (allClickable[i].textContent || '').trim().toLowerCase();
    if ((txt === 'easy apply' || txt === 'postuler simplement' || txt.indexOf('candidature simplifi') >= 0) && allClickable[i].offsetHeight > 0) {
      console.log('[JobTracker] Found Easy Apply via text match:', allClickable[i].tagName, txt);
      return allClickable[i];
    }
  }

  return null;
}

function getCompany() {
  try {
    // Try legacy selectors first, then new LinkedIn DOM
    var el = document.querySelector('.job-details-jobs-unified-top-card__company-name a') ||
             document.querySelector('.topcard__org-name-link');
    if (el) return el.textContent.trim();

    // New LinkedIn 2026: company is in <a href="/company/..."> — pick the first short one
    var companyLinks = document.querySelectorAll('a[href*="/company/"]');
    for (var i = 0; i < companyLinks.length; i++) {
      var text = companyLinks[i].textContent.trim();
      if (text.length > 0 && text.length < 80 && companyLinks[i].offsetHeight > 0) {
        return text;
      }
    }
    return 'Unknown';
  } catch(e) { return 'Unknown'; }
}

function getRole() {
  try {
    // Try legacy selectors first
    var el = document.querySelector('.job-details-jobs-unified-top-card__job-title h1') ||
             document.querySelector('.topcard__title') ||
             document.querySelector('h1');
    if (el && el.textContent.trim().length > 0) return el.textContent.trim();

    // New LinkedIn 2026: job title is in document.title (format: "Title | Company")
    // or as a <p> with large font near the top of the page
    var title = document.title.replace(/\s*\|.*$/, '').replace(/^\(\d+\)\s*/, '').trim();
    if (title.length > 0 && title.length < 120) return title;

    return 'Unknown';
  } catch(e) { return 'Unknown'; }
}

// ─── Helper: save diagnostic snapshot to chrome.storage (survives window close) ───
function saveDiagnostics(stepNum, reason) {
  try {
    var dialog = findApplyDialog();
    var container = dialog || document.body;
    var fields = container.querySelectorAll('input, select, textarea');
    var fieldDump = [];
    for (var i = 0; i < fields.length; i++) {
      if (fields[i].offsetHeight > 0) {
        var lbl = getInputLabel(fields[i]);
        fieldDump.push({
          tag: fields[i].tagName,
          type: fields[i].type,
          label: lbl.substring(0, 80),
          value: (fields[i].value || '').substring(0, 30),
          required: isFieldRequired(fields[i]),
          ariaInvalid: fields[i].getAttribute('aria-invalid'),
          name: fields[i].getAttribute('name') || '',
          id: (fields[i].getAttribute('id') || '').substring(0, 30),
        });
      }
    }
    var btns = container.querySelectorAll('button');
    var btnDump = [];
    for (var b = 0; b < btns.length; b++) {
      if (btns[b].offsetHeight > 0) {
        btnDump.push({ text: btns[b].textContent.trim().substring(0, 40), disabled: btns[b].disabled });
      }
    }
    var errors = container.querySelectorAll('.artdeco-inline-feedback--error, [role="alert"], [aria-invalid="true"], [class*="error-message"]');
    var errorDump = [];
    for (var e = 0; e < errors.length; e++) {
      if (errors[e].offsetHeight > 0) {
        errorDump.push({ tag: errors[e].tagName, text: errors[e].textContent.trim().substring(0, 80), role: errors[e].getAttribute('role') || '' });
      }
    }
    var diag = {
      step: stepNum,
      reason: reason,
      url: window.location.href,
      timestamp: new Date().toISOString(),
      containerType: container === document.body ? 'BODY' : container.tagName + '.' + (container.className || '').substring(0, 60),
      dialogText: (container.innerText || '').substring(0, 800),
      fields: fieldDump,
      buttons: btnDump,
      errors: errorDump,
      allDialogsCount: document.querySelectorAll('[role="dialog"]').length,
    };
    chrome.storage.local.set({ lastApplyDiagnostics: diag });
    console.log('[JobTracker] DIAGNOSTICS saved to storage — ' + fieldDump.length + ' fields, ' + errorDump.length + ' errors');
  } catch(diagErr) {
    console.warn('[JobTracker] Failed to save diagnostics:', diagErr.message);
  }
}

// ─── Helper: check if element is in an apply form context ───
function isInApplyContext(el) {
  var isSDUI = window.location.href.toLowerCase().indexOf('/apply') >= 0;
  if (isSDUI) return true; // On SDUI page, all form elements are relevant
  // LinkedIn 2026 may use new modal wrappers — check multiple selectors
  return !!el.closest('.jobs-easy-apply-modal, .artdeco-modal, [role="dialog"], [data-test-modal], .jobs-easy-apply-content, .jobs-apply-form, form[data-easy-apply]');
}

// ─── Helper: find the APPLY dialog specifically (not messaging overlay) ───
function findApplyDialog() {
  // SDUI pages: form is directly on the page, not in a modal
  var isSDUI = window.location.href.toLowerCase().indexOf('/apply') >= 0;
  if (isSDUI) {
    // On SDUI, look for the form container on the page
    var sduiForm = document.querySelector('form[data-easy-apply], .jobs-easy-apply-content, .jobs-apply-form, .application-form, main form, [class*="apply-form"]');
    if (sduiForm) {
      console.log('[JobTracker] findApplyDialog: SDUI form found via selector:', sduiForm.className.substring(0, 60));
      return sduiForm;
    }
    // On SDUI, find the main content area that contains the form
    var mainContent = document.querySelector('main, [role="main"], .scaffold-layout__main');
    if (mainContent) {
      var formInMain = mainContent.querySelector('form');
      if (formInMain) {
        console.log('[JobTracker] findApplyDialog: SDUI form found inside main');
        return formInMain;
      }
      // If no <form> in main, use main itself (SDUI might not use <form>)
      console.log('[JobTracker] findApplyDialog: SDUI using main content area');
      return mainContent;
    }
  }

  // Try specific Easy Apply modal first
  var modal = document.querySelector('.jobs-easy-apply-modal, .jobs-easy-apply-content, .jobs-apply-form');
  if (modal) {
    console.log('[JobTracker] findApplyDialog: found specific modal:', modal.className.substring(0, 60));
    return modal;
  }
  // Try artdeco modals — pick the one containing apply-related content
  // NOTE: removed 'next' keyword — too broad, matched messaging overlays
  var dialogs = document.querySelectorAll('.artdeco-modal, [role="dialog"]');
  var applyKeywords = ['apply to', 'easy apply', 'submit application', 'review your application', 'postuler', 'candidature', 'contact info', 'resume', 'additional questions', 'work experience'];
  for (var d = 0; d < dialogs.length; d++) {
    var text = dialogs[d].innerText.toLowerCase();
    for (var kw = 0; kw < applyKeywords.length; kw++) {
      if (text.indexOf(applyKeywords[kw]) >= 0) {
        console.log('[JobTracker] findApplyDialog: matched dialog via keyword "' + applyKeywords[kw] + '"');
        return dialogs[d];
      }
    }
  }
  // Fallback: return largest dialog (most likely the apply one, not a small tooltip)
  if (dialogs.length > 0) {
    var largest = dialogs[0];
    var largestArea = largest.offsetWidth * largest.offsetHeight;
    for (var dl = 1; dl < dialogs.length; dl++) {
      var area = dialogs[dl].offsetWidth * dialogs[dl].offsetHeight;
      if (area > largestArea) {
        largest = dialogs[dl];
        largestArea = area;
      }
    }
    console.log('[JobTracker] findApplyDialog: fallback to largest dialog (' + largest.offsetWidth + 'x' + largest.offsetHeight + ')');
    return largest;
  }
  console.log('[JobTracker] findApplyDialog: NO dialog found');
  return null;
}

// ─── Helper: compute a content fingerprint for stuck-step detection ───
function getStepFingerprint() {
  // Gather visible text + input states from the form area to detect if page changed
  var modal = findApplyDialog();
  var container = modal || document.body;
  var parts = [];
  var diagLabels = [];
  var diagFields = [];

  // Collect visible labels/headings in the form
  var labels = container.querySelectorAll('label, h3, h2, legend, .t-14, .t-16, .t-bold');
  for (var i = 0; i < labels.length; i++) {
    if (labels[i].offsetHeight > 0) {
      var lt = labels[i].textContent.trim().substring(0, 60);
      parts.push(lt);
      diagLabels.push(lt);
    }
  }

  // Collect input field names/ids to identify which fields are on this step
  // DO NOT include values — typeahead clear/refill would change fingerprint on same page
  var fields = container.querySelectorAll('input, select, textarea');
  for (var f = 0; f < fields.length; f++) {
    if (fields[f].offsetHeight > 0) {
      var fieldSig = (fields[f].getAttribute('name') || '') + '|' + (fields[f].getAttribute('id') || '') + '|' + fields[f].type;
      parts.push(fieldSig);
      diagFields.push(fields[f].type + ':' + (fields[f].getAttribute('name') || fields[f].getAttribute('id') || '?').substring(0, 20) + '=' + (fields[f].value || '').substring(0, 15));
    }
  }

  // Also include button text — different steps show different buttons
  var btns = container.querySelectorAll('button');
  for (var b = 0; b < btns.length; b++) {
    if (btns[b].offsetHeight > 0) {
      var bt = btns[b].textContent.trim().substring(0, 30);
      if (bt.length > 0) parts.push('btn:' + bt);
    }
  }

  // Simple hash: join and take a short fingerprint
  var str = parts.join('::');
  var hash = 0;
  for (var c = 0; c < str.length; c++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(c);
    hash = hash & hash; // Convert to 32bit integer
  }

  // Diagnostic logging
  console.log('[JobTracker] FINGERPRINT DIAG — container: ' + (container === document.body ? 'BODY' : container.tagName + '.' + (container.className || '').substring(0, 40)) +
    ' | labels(' + diagLabels.length + '): ' + diagLabels.slice(0, 3).join(', ') +
    ' | fields(' + diagFields.length + '): ' + diagFields.slice(0, 4).join(', ') +
    ' | hash: ' + hash);

  return hash;
}

// ─── Helper: get label text for any input (robust, multiple strategies) ───
function getInputLabel(inp) {
  var parts = [];
  // Strategy 1: aria-label, placeholder, name attributes
  if (inp.getAttribute('aria-label')) parts.push(inp.getAttribute('aria-label'));
  if (inp.getAttribute('placeholder')) parts.push(inp.getAttribute('placeholder'));
  if (inp.getAttribute('name')) parts.push(inp.getAttribute('name'));
  if (inp.getAttribute('aria-describedby')) {
    var descEl = document.getElementById(inp.getAttribute('aria-describedby'));
    if (descEl) parts.push(descEl.textContent);
  }

  // Strategy 2: <label for="id">
  if (inp.id) {
    var labelEl = document.querySelector('label[for="' + inp.id + '"]');
    if (labelEl) parts.push(labelEl.textContent);
  }

  // Strategy 3: closest label ancestor
  var parentLabel = inp.closest('label');
  if (parentLabel) parts.push(parentLabel.textContent);

  // Strategy 4: LinkedIn-specific — look for preceding sibling or parent's label-like text
  // LinkedIn 2026 uses <div class="..."><label>...</label><div><input></div></div>
  var formGroup = inp.closest('.fb-dash-form-element, .jobs-easy-apply-form-element, [data-test-form-element], .artdeco-text-input, [class*="form-component"]');
  if (formGroup) {
    var groupLabel = formGroup.querySelector('label, .fb-dash-form-element__label, [data-test-form-element-label], .artdeco-text-input--label, [class*="form-element__label"]');
    if (groupLabel) parts.push(groupLabel.textContent);
  }

  // Strategy 5: previous sibling text (some forms use <span>Label</span><input>)
  var prev = inp.previousElementSibling;
  if (prev && (prev.tagName === 'SPAN' || prev.tagName === 'LABEL' || prev.tagName === 'DIV')) {
    var prevText = prev.textContent.trim();
    if (prevText.length > 0 && prevText.length < 100) parts.push(prevText);
  }

  return parts.join(' ').toLowerCase();
}

// ─── Helper: check if an input field is required ───
function isFieldRequired(inp) {
  if (inp.required) return true;
  if (inp.getAttribute('aria-required') === 'true') return true;
  // LinkedIn marks required fields with a * in the label or an asterisk span
  var formGroup = inp.closest('.fb-dash-form-element, .jobs-easy-apply-form-element, [data-test-form-element], [class*="form-component"]');
  if (formGroup) {
    var asterisk = formGroup.querySelector('.required, [class*="required"], .artdeco-text-input--required');
    if (asterisk) return true;
    var labelText = formGroup.textContent || '';
    if (labelText.indexOf('*') >= 0) return true;
  }
  return false;
}

// ─── Helper: handle LinkedIn typeahead/autocomplete components ───
function handleTypeahead(inp, value) {
  // LinkedIn typeaheads REQUIRE: clear → focus → type char by char → wait → select dropdown option.
  // Just setting .value doesn't work — LinkedIn's React needs InputEvent per character.
  window._typeaheadTriggered = true; // Signal to use longer delay before clicking Next
  console.log('[JobTracker] Typeahead: starting for value "' + value + '"');

  // Step 1: Clear existing value
  inp.focus();
  inp.dispatchEvent(new Event('focus', { bubbles: true }));
  inp.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

  // Use native setter to clear
  var descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  if (descriptor && descriptor.set) {
    descriptor.set.call(inp, '');
  } else {
    inp.value = '';
  }
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true }));

  // Step 2: Type characters one at a time with InputEvent (not just KeyboardEvent)
  // This is what LinkedIn's React typeahead listens for
  var currentText = '';
  for (var i = 0; i < value.length; i++) {
    currentText += value[i];
    // Set the value incrementally
    if (descriptor && descriptor.set) {
      descriptor.set.call(inp, currentText);
    } else {
      inp.value = currentText;
    }
    // Dispatch the InputEvent that React typeahead expects
    inp.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: value[i],
      inputType: 'insertText',
      isComposing: false,
    }));
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: value[i], code: 'Key' + value[i].toUpperCase(), bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keyup', { key: value[i], code: 'Key' + value[i].toUpperCase(), bubbles: true }));
  }
  // Also dispatch change event after all characters
  inp.dispatchEvent(new Event('change', { bubbles: true }));

  console.log('[JobTracker] Typeahead: typed "' + value + '" — waiting for dropdown...');

  // Step 3: Wait for dropdown to appear (1.5s — longer than before)
  // Then try to select the best matching option
  setTimeout(function() {
    _selectTypeaheadOption(inp, value, 1);
  }, 1500);
}

// Helper: try to select a typeahead option, with retries
function _selectTypeaheadOption(inp, value, attempt) {
  var maxAttempts = 3;
  // LinkedIn typeahead dropdowns use various selectors
  var dropdownOptions = document.querySelectorAll(
    '.basic-typeahead__selectable, .typeahead-results__item, [role="option"], ' +
    '[role="listbox"] li, .jobs-easy-apply-form-element__listbox li, ' +
    '[class*="typeahead"] [role="option"], [class*="autocomplete"] li, ' +
    '.artdeco-typeahead__results-list li, [id*="typeahead-result"], ' +
    '.ember-view [role="option"]'
  );

  // Count visible options
  var visibleCount = 0;
  for (var vc = 0; vc < dropdownOptions.length; vc++) {
    if (dropdownOptions[vc].offsetHeight > 0) visibleCount++;
  }
  console.log('[JobTracker] Typeahead: found ' + dropdownOptions.length + ' options, ' + visibleCount + ' visible (attempt ' + attempt + ')');

  // Strategy 1: Click the first visible option
  var selected = false;
  for (var d = 0; d < dropdownOptions.length; d++) {
    if (dropdownOptions[d].offsetHeight > 0) {
      var optText = dropdownOptions[d].textContent.trim();
      console.log('[JobTracker] Typeahead: clicking option "' + optText.substring(0, 50) + '"');
      // Try multiple click strategies
      dropdownOptions[d].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      dropdownOptions[d].dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      dropdownOptions[d].click();
      selected = true;
      break;
    }
  }

  // Strategy 2: Keyboard navigation — ArrowDown + Enter (works even if click doesn't)
  if (!selected || attempt > 1) {
    console.log('[JobTracker] Typeahead: trying keyboard selection (ArrowDown + Enter)');
    inp.focus();
    // Press ArrowDown to highlight first option
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));
    inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true }));

    // Short delay then press Enter to select
    setTimeout(function() {
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      console.log('[JobTracker] Typeahead: sent ArrowDown + Enter');

      // Wait a bit then blur
      setTimeout(function() {
        inp.dispatchEvent(new Event('blur', { bubbles: true }));
        inp.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      }, 300);
    }, 200);
    selected = true;
  }

  if (!selected && attempt < maxAttempts) {
    // Retry after another delay
    console.log('[JobTracker] Typeahead: no dropdown visible, retry ' + attempt + '/' + maxAttempts);
    setTimeout(function() {
      _selectTypeaheadOption(inp, value, attempt + 1);
    }, 1000);
  } else if (!selected) {
    console.warn('[JobTracker] Typeahead: no dropdown appeared after ' + maxAttempts + ' attempts for "' + value + '"');
    // Last resort: blur to accept whatever was typed
    inp.dispatchEvent(new Event('blur', { bubbles: true }));
    inp.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }
}

// ─── Haiku Field Fallback (port from ats-apply.js) ──────────────────
// Runs BEFORE each Next/Review/Submit click on LinkedIn Easy Apply.
// Scans unfilled, non-sensitive fields → POSTs to /api/fill-field → writes
// answers back via setNativeValue / .click() (same primitives as fillCurrentStep).
//
// Safety:
//  - Legal/EEO-sensitive labels are filtered BEFORE the API call.
//  - Capped at FILL_FIELD_MAX_BATCH fields per call.
//  - On any error we silently return 0 — existing fallback path unchanged.

function _isSensitiveFieldForHaiku(labelInfo, input) {
  var l = (labelInfo || '').toLowerCase();
  for (var i = 0; i < HAIKU_SENSITIVE_PATTERNS.length; i++) {
    if (l.indexOf(HAIKU_SENSITIVE_PATTERNS[i]) >= 0) return true;
  }
  var id = ((input && input.id) || '').toLowerCase();
  if (id.indexOf('4014') === 0 || id.indexOf('4015') === 0) return true;
  var eeoIds = ['gender', 'race', 'ethnicity', 'hispanic_ethnicity', 'veteran_status', 'disability_status'];
  for (var e = 0; e < eeoIds.length; e++) {
    if (id === eeoIds[e]) return true;
  }
  return false;
}

// Simple field classifier (linkedin-apply.js has no classifyFormField helper).
function _classifyHaikuField(input) {
  if (!input) return 'text';
  var tag = input.tagName;
  if (tag === 'TEXTAREA') return 'textarea';
  if (tag === 'SELECT') return 'select';
  var type = (input.type || '').toLowerCase();
  if (type === 'radio') return 'radio';
  if (type === 'checkbox') return 'checkbox';
  return 'text';
}

function _describeFieldForHaiku(input, labelInfo, idx) {
  var fieldType = _classifyHaikuField(input);
  var kind = fieldType; // already one of text/textarea/select/radio/checkbox

  var options;
  if (input.tagName === 'SELECT') {
    options = [];
    var opts = input.options;
    for (var o = 0; o < opts.length; o++) {
      var t = (opts[o].text || '').trim();
      var lc = t.toLowerCase();
      if (t && lc !== 'select...' && lc !== '-- select --' && lc !== 'select an option') {
        options.push(t);
      }
    }
  }

  var maxLength = (input.maxLength && input.maxLength > 0) ? input.maxLength : undefined;
  var label = (labelInfo || '').trim().slice(0, 300);

  return {
    id: 'field-' + idx,
    label: label,
    type: kind,
    options: options,
    context: label.slice(0, 200),
    maxLength: maxLength,
    _el: input,
    _fieldType: fieldType,
  };
}

// LinkedIn-aware label extraction (Haiku candidates).
// Reuses getInputLabel() but ALSO tries fb-dash-form-element wrappers, which
// carry the real question text on LinkedIn custom screening questions.
function _getHaikuFieldLabel(input) {
  var label = '';
  try { label = (getInputLabel(input) || '').trim(); } catch (e) { label = ''; }

  // LinkedIn-specific: fb-dash-form-element__label or data-test-form-element-label
  var linkedinWrapper = input.closest('.fb-dash-form-element, [data-test-form-element]');
  if (linkedinWrapper) {
    var linkedinLabel = linkedinWrapper.querySelector('label.fb-dash-form-element__label, [data-test-form-element-label], label');
    if (linkedinLabel) {
      var text = (linkedinLabel.textContent || '').trim();
      if (text && text.length > label.length) label = text;
    }
  }

  // Generic fieldset/legend fallback
  var fset = input.closest('fieldset');
  if (fset && (!label || label.length < 5)) {
    var legend = fset.querySelector('legend, label');
    if (legend) {
      var lt = (legend.textContent || '').trim();
      if (lt && lt.length > label.length) label = lt;
    }
  }

  return label;
}

function fillUnknownFieldsViaHaiku(fields) {
  if (!Array.isArray(fields) || fields.length === 0) return Promise.resolve(new Map());
  var batch = fields.slice(0, FILL_FIELD_MAX_BATCH);
  if (fields.length > FILL_FIELD_MAX_BATCH) {
    log('[haiku-fallback] Capping batch to ' + FILL_FIELD_MAX_BATCH + ' (had ' + fields.length + ')');
  }
  // Strip DOM refs before sending
  var payloadFields = batch.map(function (f) {
    var obj = { id: f.id, label: f.label, type: f.type };
    if (f.options) obj.options = f.options;
    if (f.context) obj.context = f.context;
    if (f.maxLength) obj.maxLength = f.maxLength;
    return obj;
  });
  log('[haiku-fallback] Sending ' + payloadFields.length + ' fields to Haiku:');
  payloadFields.forEach(function (f) {
    log('  - [' + f.type + '] "' + (f.label || '').slice(0, 60) + '" options=' + ((f.options && f.options.length) || 0));
  });

  var controller = new AbortController();
  var timeoutId = setTimeout(function () { controller.abort(); }, FILL_FIELD_TIMEOUT_MS);

  return fetch(FILL_FIELD_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: PROFILE, fields: payloadFields }),
    signal: controller.signal,
  }).then(function (res) {
    clearTimeout(timeoutId);
    if (!res.ok) {
      log('[haiku-fallback] API returned ' + res.status);
      return new Map();
    }
    return res.json().then(function (data) {
      var answers = (data && Array.isArray(data.answers)) ? data.answers : [];
      var answered = 0;
      for (var ai = 0; ai < answers.length; ai++) {
        if (answers[ai] && answers[ai].answer != null) answered++;
      }
      log('[haiku-fallback] Got ' + answered + '/' + batch.length + ' answers from Haiku');
      var recvSummary = answers.map(function (a) {
        return a && a.answer != null
          ? (a.id + '="' + String(a.answer).slice(0, 30) + '"')
          : (a ? a.id + '=null' : 'null');
      }).join(', ');
      log('[haiku-fallback] Received answers: ' + recvSummary);
      var map = new Map();
      for (var i = 0; i < answers.length; i++) {
        var a = answers[i];
        if (!a || a.answer == null) continue;
        var ans = typeof a.answer === 'string' ? a.answer.trim() : a.answer;
        if (ans === '' || ans === 'null' || ans === 'undefined' || ans === 'N/A') continue;
        map.set(a.id, { answer: ans, confidence: a.confidence || 'unknown' });
      }
      return map;
    });
  }).catch(function (err) {
    clearTimeout(timeoutId);
    log('[haiku-fallback] Error: ' + (err && err.message));
    return new Map();
  });
}

// Apply a Haiku answer to a LinkedIn form field using linkedin-apply.js primitives.
// linkedin-apply.js has no `fillClassifiedField` — we dispatch on _fieldType directly.
function _applyHaikuAnswer(el, fieldType, answer, groupLabel) {
  try {
    if (fieldType === 'text' || fieldType === 'textarea') {
      setNativeValue(el, String(answer));
      return true;
    }
    if (fieldType === 'select') {
      var target = String(answer).toLowerCase().trim();
      var opts = el.options || [];
      // Exact match first, then contains
      for (var i = 0; i < opts.length; i++) {
        if ((opts[i].text || '').toLowerCase().trim() === target) {
          el.value = opts[i].value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
      }
      for (var j = 0; j < opts.length; j++) {
        if ((opts[j].text || '').toLowerCase().indexOf(target) >= 0) {
          el.value = opts[j].value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
      }
      return false;
    }
    if (fieldType === 'radio') {
      // el is one radio in the group — walk siblings by name
      var name = el.getAttribute('name') || '';
      var radios = name
        ? document.querySelectorAll('input[type="radio"][name="' + name + '"]')
        : [el];
      var target2 = String(answer).toLowerCase().trim();
      for (var r = 0; r < radios.length; r++) {
        var lbl = '';
        try {
          lbl = (radios[r].closest('label') || radios[r].parentElement || {}).textContent || '';
          lbl = lbl.trim().toLowerCase();
        } catch (e) { lbl = ''; }
        if (lbl === target2 || lbl.indexOf(target2) >= 0) {
          radios[r].click();
          return true;
        }
      }
      return false;
    }
    if (fieldType === 'checkbox') {
      var wantTrue = /^(yes|true|on|checked|1)$/i.test(String(answer).trim());
      if (wantTrue && !el.checked) { el.click(); return true; }
      if (!wantTrue && el.checked) { el.click(); return true; }
      return true;
    }
  } catch (err) {
    warn('[haiku-fallback] _applyHaikuAnswer error:', err && err.message);
    return false;
  }
  return false;
}

// Scan page for unfilled fields, ask Haiku, apply answers. Returns fill count.
// Async (returns a Promise<number>) — called via .then() from ES5 callback code.
function runHaikuFieldFallback() {
  log('[haiku-fallback] Scanning for unfilled fields...');

  var candidates = [];
  var idx = 0;
  var skipSensitive = 0;
  var skipShortLabel = 0;
  var skipAlreadyFilled = 0;
  var skipInvisible = 0;

  // Scope to the apply dialog when possible (avoid scraping unrelated LI widgets)
  var container = null;
  try { container = findApplyDialog(); } catch (e) { container = null; }
  var root = container || document;

  // Diagnostic: log what we're scoping to
  var rootInfo = 'document';
  if (container) {
    var cls = (container.className || '').toString().slice(0, 60);
    rootInfo = container.tagName + (cls ? '.' + cls : '') + ' (children=' + container.childElementCount + ')';
  }
  log('[haiku-fallback] Scope root: ' + rootInfo);

  // ── Pass 1: LinkedIn form wrappers (2026 structure) ──
  // Step 2+ of Easy Apply renders custom questions as wrappers containing
  // React-Select or Artdeco components; the underlying <input> is hidden/empty
  // so a native tag scan finds nothing. Enumerate wrappers instead.
  var wrapperSelectors = [
    '.fb-dash-form-element',
    '[data-test-form-element]',
    '[data-test-single-line-text-form-component]',
    '[data-test-text-entity-list-form-component]',
    '[data-test-multi-line-text-form-component]',
    '[data-test-checkbox-form-component]',
    '.jobs-easy-apply-form-element'
  ].join(',');
  var wrappers = root.querySelectorAll(wrapperSelectors);
  log('[haiku-fallback] Wrappers found: ' + wrappers.length);

  // FALLBACK: if the scoped container has NO wrappers but document has some,
  // the container is probably stale (mid-transition between multi-step pages)
  // or findApplyDialog picked the wrong modal. Retry with document scope.
  if (wrappers.length === 0 && container) {
    var docWrappers = document.querySelectorAll(wrapperSelectors);
    if (docWrappers.length > 0) {
      log('[haiku-fallback] Container has 0 wrappers but document has ' + docWrappers.length + ' — falling back to document scope');
      root = document;
      wrappers = docWrappers;
    }
  }

  // Dedup wrappers — nested data-test-* can match twice
  var seenWrappers = (typeof Set !== 'undefined') ? new Set() : { _s: [], has: function(x) { return this._s.indexOf(x) >= 0; }, add: function(x) { this._s.push(x); } };

  for (var wi = 0; wi < wrappers.length; wi++) {
    var wrapper = wrappers[wi];

    // Skip if this wrapper is nested inside another wrapper we'll process
    var hasAncestorWrapper = false;
    var cur = wrapper.parentElement;
    while (cur && cur !== root) {
      if (cur.matches && cur.matches(wrapperSelectors)) { hasAncestorWrapper = true; break; }
      cur = cur.parentElement;
    }
    if (hasAncestorWrapper) continue;
    if (seenWrappers.has(wrapper)) continue;
    seenWrappers.add(wrapper);

    // Skip invisible wrappers
    if (wrapper.offsetHeight === 0) { skipInvisible++; continue; }

    // Find the control inside: priority = select > textarea > radio(group) > contenteditable > text/combobox input
    var control = null;
    var fieldType = 'text';
    var options = null;

    // 1. Native <select>
    var nativeSelect = wrapper.querySelector('select');
    if (nativeSelect && nativeSelect.offsetHeight > 0) {
      control = nativeSelect;
      fieldType = 'select';
      options = [];
      for (var oi = 0; oi < nativeSelect.options.length; oi++) {
        if (oi === 0 && (!nativeSelect.options[oi].value || /select|choose|--/i.test(nativeSelect.options[oi].text))) continue;
        options.push(nativeSelect.options[oi].text);
      }
    }

    // 2. <textarea>
    if (!control) {
      var textarea = wrapper.querySelector('textarea');
      if (textarea && textarea.offsetHeight > 0) {
        control = textarea;
        fieldType = 'textarea';
      }
    }

    // 3. Radio group inside wrapper — handled by Pass 2, skip here
    if (!control) {
      var radioInside = wrapper.querySelector('input[type="radio"]');
      if (radioInside) continue;
    }

    // 4. Checkbox — consent handled elsewhere
    if (!control) {
      var checkbox = wrapper.querySelector('input[type="checkbox"]');
      if (checkbox) continue;
    }

    // 5. Text input / combobox (React-Select / typeahead)
    if (!control) {
      var textInput = wrapper.querySelector('input[type="text"], input:not([type]), input[role="combobox"], input[aria-autocomplete]');
      if (textInput && textInput.offsetHeight > 0) {
        control = textInput;
        // Is it a React-Select / typeahead?
        if (textInput.getAttribute('role') === 'combobox' ||
            textInput.getAttribute('aria-autocomplete') ||
            wrapper.querySelector('[class*="typeahead"], [role="listbox"]')) {
          fieldType = 'select';
          // Options often unavailable until user clicks — leave null, Haiku will produce text
          options = null;
        } else {
          fieldType = 'text';
        }
      }
    }

    // 6. contenteditable (LinkedIn long-form answers)
    if (!control) {
      var editable = wrapper.querySelector('[contenteditable="true"]');
      if (editable && editable.offsetHeight > 0) {
        control = editable;
        fieldType = 'textarea';
      }
    }

    if (!control) continue; // no fillable control in this wrapper

    // Determine if already filled
    var isFilled = false;
    if (fieldType === 'select' && control.tagName === 'SELECT') {
      isFilled = control.value && control.selectedIndex > 0;
    } else if (control.tagName === 'INPUT' || control.tagName === 'TEXTAREA') {
      isFilled = !!(control.value && control.value.trim().length > 0);
      // React-Select shows selected value via sibling, not .value
      if (!isFilled) {
        var singleVal = wrapper.querySelector('.select__single-value, .artdeco-text-input--single-value, [class*="single-value"]');
        if (singleVal && singleVal.textContent && singleVal.textContent.trim().length > 0) {
          isFilled = true;
        }
      }
    } else if (control.isContentEditable) {
      isFilled = !!(control.textContent && control.textContent.trim().length > 0);
    }

    if (isFilled) { skipAlreadyFilled++; continue; }

    // Extract label via the wrapper-aware helper
    var labelInfo = '';
    try { labelInfo = _getHaikuFieldLabel(control) || ''; } catch (e) {}
    if (!labelInfo) {
      // Fallback: use wrapper's own label element
      var wl = wrapper.querySelector('label, legend, .fb-dash-form-element__label, [data-test-form-element-label]');
      if (wl) labelInfo = (wl.textContent || '').replace(/\s+/g, ' ').trim();
    }

    if (!labelInfo || labelInfo.replace(/\s+/g, ' ').trim().length < 3) {
      skipShortLabel++;
      continue;
    }

    // Sensitive filter (EEO/legal)
    if (_isSensitiveFieldForHaiku(labelInfo, control)) {
      skipSensitive++;
      log('[haiku-fallback] SKIP sensitive: "' + labelInfo.slice(0, 60) + '"');
      continue;
    }

    candidates.push({
      id: 'field-' + (idx++),
      label: labelInfo.slice(0, 300),
      type: fieldType,
      options: options,
      context: labelInfo.slice(0, 200),
      _el: control,
      _fieldType: fieldType,
    });
  }

  // ── Pass 2: unanswered radio groups ──
  var radioGroupEls = root.querySelectorAll('fieldset, [role="radiogroup"], [class*="radio-group"], [class*="question"]');
  var seenGroups = {};
  for (var g = 0; g < radioGroupEls.length; g++) {
    var group = radioGroupEls[g];
    var radios = group.querySelectorAll('input[type="radio"]');
    if (radios.length === 0) continue;
    var anyChecked = false;
    for (var rc = 0; rc < radios.length; rc++) { if (radios[rc].checked) { anyChecked = true; break; } }
    if (anyChecked) continue;

    var gname = radios[0].getAttribute('name') || '';
    if (gname && seenGroups[gname]) continue;
    if (gname) seenGroups[gname] = true;

    var legendEl = group.querySelector('legend, .fb-dash-form-element__label, [data-test-form-element-label]');
    var groupLabel = legendEl ? (legendEl.textContent || '').trim() : (group.getAttribute('aria-label') || '').trim();
    var groupText = (groupLabel || (group.textContent || '').trim().slice(0, 200)).replace(/\s+/g, ' ').trim();

    if (groupText.length < 3) { skipShortLabel++; continue; }
    if (_isSensitiveFieldForHaiku(groupText, radios[0])) {
      skipSensitive++;
      log('[haiku-fallback] SKIP sensitive radio: "' + groupText.slice(0, 60) + '"');
      continue;
    }

    var rOptions = [];
    for (var ro = 0; ro < radios.length; ro++) {
      var rLbl = '';
      try {
        rLbl = ((radios[ro].closest('label') || radios[ro].parentElement || {}).textContent || '').trim();
      } catch (e) { rLbl = ''; }
      if (rLbl) rOptions.push(rLbl);
    }

    candidates.push({
      id: 'field-' + (idx++),
      label: groupText.slice(0, 300),
      type: 'radio',
      options: rOptions,
      context: groupText.slice(0, 200),
      _el: radios[0],
      _fieldType: 'radio',
    });
  }

  var passSummary = 'skipped: sensitive=' + skipSensitive + ' shortLabel=' + skipShortLabel + ' alreadyFilled=' + skipAlreadyFilled + ' invisible=' + skipInvisible;
  log('[haiku-fallback] Collection done: ' + candidates.length + ' candidates (' + passSummary + ')');

  // Critical diagnostic: wrappers present but 0 candidates means they were all filtered out.
  // This distinguishes "wrapper-not-found" (LI structure changed again) from "wrapper-found-but-filtered".
  if (wrappers && wrappers.length > 0 && candidates.length === 0) {
    warn('[haiku-fallback] WARN: ' + wrappers.length + ' wrappers found but 0 candidates survived filtering (' + passSummary + ')');
  }

  if (candidates.length === 0) {
    log('[haiku-fallback] No unfilled fields to escalate');

    // Diagnostic DOM dump: when we find nothing, list all visible text/select/textarea
    // on the page with their label + in-apply-context status. This tells us whether
    // fields exist but are being filtered, or whether they're truly not in the DOM.
    try {
      var allPageInputs = document.querySelectorAll('input, textarea, select');
      log('[haiku-fallback] DIAG: total document inputs = ' + allPageInputs.length);
      var dumped = 0;
      for (var di = 0; di < allPageInputs.length && dumped < 20; di++) {
        var dinp = allPageInputs[di];
        if (dinp.offsetHeight === 0) continue;
        var dtype = (dinp.type || '').toLowerCase();
        if (dtype === 'hidden' || dtype === 'submit' || dtype === 'button' || dtype === 'file') continue;
        var dlabel = '';
        try { dlabel = _getHaikuFieldLabel(dinp) || ''; } catch (e) { dlabel = '<err>'; }
        var dval = (dinp.value || '').slice(0, 30);
        var dinCtx = false;
        try { dinCtx = isInApplyContext(dinp); } catch (e) { dinCtx = false; }
        log('[haiku-fallback] DIAG input[' + di + ']: tag=' + dinp.tagName + ' type=' + (dtype || '-') + ' name=' + (dinp.name || '-') + ' inApplyCtx=' + dinCtx + ' val="' + dval + '" label="' + dlabel.slice(0, 60) + '"');
        dumped++;
      }
    } catch (diagErr) {
      log('[haiku-fallback] DIAG error: ' + (diagErr && diagErr.message));
    }

    try { persistDebugLog(); } catch (e) { /* ignore */ }
    return Promise.resolve(0);
  }

  log('[haiku-fallback] Escalating ' + candidates.length + ' unfilled field(s) to Haiku');
  try { persistDebugLog(); } catch (e) { /* ignore */ }
  return fillUnknownFieldsViaHaiku(candidates).then(function (answerMap) {
    if (!answerMap || answerMap.size === 0) {
      log('[haiku-fallback] No answers from Haiku — skipping');
      try { persistDebugLog(); } catch (e) { /* ignore */ }
      return 0;
    }
    var filled = 0;
    var batch = candidates.slice(0, FILL_FIELD_MAX_BATCH);
    for (var bi = 0; bi < batch.length; bi++) {
      var f = batch[bi];
      var entry = answerMap.get(f.id);
      if (!entry) continue;
      var answer = String(entry.answer).trim();
      if (!answer) continue;

      // Verify element is still in the DOM after the Haiku round-trip.
      if (!f._el || !document.contains(f._el)) {
        log('[haiku-fallback] SKIP stale element: "' + (f.label || '').slice(0, 50) + '"');
        continue;
      }
      if (f._el.offsetHeight === 0 && f._el.type !== 'hidden') {
        log('[haiku-fallback] SKIP invisible element: "' + (f.label || '').slice(0, 50) + '"');
        continue;
      }

      try {
        var ok = _applyHaikuAnswer(f._el, f._fieldType, answer, f.label);
        if (ok) {
          filled++;
          log('[haiku-fallback] Filled [' + f._fieldType + '] "' + (f.label || '').slice(0, 50) + '" -> ' + answer.slice(0, 40) + ' (conf=' + entry.confidence + ')');
        } else {
          log('[haiku-fallback] Fill attempt failed for "' + (f.label || '').slice(0, 50) + '"');
        }
      } catch (err) {
        warn('[haiku-fallback] Fill error for "' + (f.label || '').slice(0, 50) + '":', err && err.message);
      }
    }
    log('[haiku-fallback] Filled ' + filled + ' additional fields via Haiku');
    try { persistDebugLog(); } catch (e) { /* ignore */ }
    return filled;
  });
}

// ─── Fill all visible form fields on the current step ───
function fillCurrentStep() {
  var filledCount = 0;

  // Text inputs — broad selector including all text-like types
  var inputs = document.querySelectorAll('input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]):not([type="file"]):not([type="submit"]):not([type="button"])');
  for (var j = 0; j < inputs.length; j++) {
    var inp = inputs[j];
    // Skip invisible inputs
    if (inp.offsetHeight === 0) continue;
    // Skip inputs not inside the modal/form
    if (!isInApplyContext(inp)) continue;
    // Skip inputs that already have a value — but re-confirm React state for required pre-filled fields
    if (inp.value && inp.value.trim().length > 0) {
      if (isFieldRequired(inp)) {
        // LinkedIn pre-fills inputs from profile but React state may lag.
        // Re-dispatch events to sync React form validation.
        var descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') || {};
        if (descriptor.set) {
          descriptor.set.call(inp, inp.value);
        }
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
      continue;
    }

    var label = getInputLabel(inp);

    // Check if this is a typeahead/autocomplete input
    var isTypeahead = !!(inp.getAttribute('role') === 'combobox' ||
      inp.closest('[class*="typeahead"], [class*="autocomplete"], [role="combobox"]') ||
      inp.getAttribute('aria-autocomplete') ||
      inp.getAttribute('aria-haspopup') === 'listbox');

    // Phone number
    if (label.indexOf('phone') >= 0 || label.indexOf('mobile') >= 0 || label.indexOf('tel') >= 0 || label.indexOf('téléphone') >= 0 || inp.type === 'tel') {
      setNativeValue(inp, '+66 618156481');
      filledCount++;
      console.log('[JobTracker] Filled phone number');
    }

    // City / Location — use typeahead if detected
    else if (label.indexOf('city') >= 0 || label.indexOf('location') >= 0 || label.indexOf('ville') >= 0 || label.indexOf('where do you') >= 0) {
      if (isTypeahead) {
        handleTypeahead(inp, 'Bangkok');
      } else {
        setNativeValue(inp, 'Bangkok');
      }
      filledCount++;
      console.log('[JobTracker] Filled city/location' + (isTypeahead ? ' (typeahead)' : ''));
    }

    // LinkedIn URL
    else if (label.indexOf('linkedin') >= 0) {
      setNativeValue(inp, 'https://www.linkedin.com/in/floriangouloubi/');
      filledCount++;
      console.log('[JobTracker] Filled LinkedIn URL');
    }

    // Years of experience — MUST come before Portfolio/URL check because
    // questions like "...experience showcased in your portfolio?" contain "portfolio"
    // but expect a numeric answer, not a URL.
    else if ((label.indexOf('years') >= 0 || label.indexOf('experience') >= 0 || label.indexOf('année') >= 0 || label.indexOf('expérience') >= 0 || label.indexOf('how many') >= 0 || label.indexOf('how long') >= 0) && (inp.type === 'number' || inp.type === 'text' || inp.type === 'tel' || !inp.type)) {
      setNativeValue(inp, '7');
      filledCount++;
      console.log('[JobTracker] Filled years of experience (type=' + inp.type + ')');
    }

    // Website / Portfolio / URL — but NOT if the label also mentions years/experience (those are numeric)
    else if ((label.indexOf('website') >= 0 || label.indexOf('portfolio') >= 0 || label.indexOf('url') >= 0 || label.indexOf('site') >= 0 || label.indexOf('lien') >= 0) && label.indexOf('years') < 0 && label.indexOf('experience') < 0 && label.indexOf('how many') < 0) {
      setNativeValue(inp, 'https://www.floriangouloubi.com/');
      filledCount++;
      console.log('[JobTracker] Filled portfolio URL');
    }

    // Salary / compensation
    else if (label.indexOf('salary') >= 0 || label.indexOf('compensation') >= 0 || label.indexOf('salaire') >= 0 || label.indexOf('rémunération') >= 0 || label.indexOf('pay') >= 0 || label.indexOf('wage') >= 0) {
      setNativeValue(inp, '80000');
      filledCount++;
      console.log('[JobTracker] Filled salary');
    }

    // Email
    else if (label.indexOf('email') >= 0 || label.indexOf('e-mail') >= 0 || label.indexOf('courriel') >= 0 || inp.type === 'email') {
      setNativeValue(inp, 'florian.gouloubi@gmail.com');
      filledCount++;
      console.log('[JobTracker] Filled email');
    }

    // First name
    else if (label.indexOf('first name') >= 0 || label.indexOf('prénom') >= 0 || label.indexOf('given name') >= 0) {
      setNativeValue(inp, 'Florian');
      filledCount++;
      console.log('[JobTracker] Filled first name');
    }

    // Last name
    else if (label.indexOf('last name') >= 0 || label.indexOf('nom de famille') >= 0 || label.indexOf('family name') >= 0 || label.indexOf('surname') >= 0) {
      setNativeValue(inp, 'Gouloubi');
      filledCount++;
      console.log('[JobTracker] Filled last name');
    }

    // Full name
    else if (label.indexOf('full name') >= 0 || (label.indexOf('name') >= 0 && label.indexOf('company') < 0 && label.indexOf('job') < 0 && label.indexOf('school') < 0)) {
      setNativeValue(inp, 'Florian Gouloubi');
      filledCount++;
      console.log('[JobTracker] Filled full name');
    }

    // School / University — typeahead
    else if (label.indexOf('school') >= 0 || label.indexOf('university') >= 0 || label.indexOf('education') >= 0 || label.indexOf('école') >= 0 || label.indexOf('université') >= 0) {
      if (isTypeahead) {
        handleTypeahead(inp, 'ESD');
      } else {
        setNativeValue(inp, 'ESD - Ecole Superieure du Digital');
      }
      filledCount++;
      console.log('[JobTracker] Filled school/university');
    }

    // Headline / title
    else if (label.indexOf('headline') >= 0 || label.indexOf('titre') >= 0 || label.indexOf('current title') >= 0 || label.indexOf('job title') >= 0) {
      setNativeValue(inp, 'Senior Product Designer');
      filledCount++;
      console.log('[JobTracker] Filled headline/title');
    }

    // Company name
    else if (label.indexOf('company') >= 0 || label.indexOf('employer') >= 0 || label.indexOf('entreprise') >= 0 || label.indexOf('organization') >= 0) {
      if (isTypeahead) {
        handleTypeahead(inp, 'ClickOut Media');
      } else {
        setNativeValue(inp, 'ClickOut Media');
      }
      filledCount++;
      console.log('[JobTracker] Filled company name');
    }

    // Start date / date fields — try reasonable defaults
    else if (label.indexOf('start date') >= 0 || label.indexOf('date de début') >= 0) {
      setNativeValue(inp, '2023');
      filledCount++;
      console.log('[JobTracker] Filled start date');
    }

    // GPA — some forms ask for it
    else if (label.indexOf('gpa') >= 0 || label.indexOf('grade') >= 0) {
      setNativeValue(inp, '3.5');
      filledCount++;
      console.log('[JobTracker] Filled GPA');
    }

    // ─── Context-aware detection: check surrounding text for clues ───
    // LinkedIn custom questions (from ATS like PYJAMAHR) may have labels our detection misses
    else if (isFieldRequired(inp) && (!inp.value || inp.value.trim().length === 0)) {
      // Gather broader context: form group text, nearby alerts, question text
      var contextText = label;
      try {
        var ctxGroup = inp.closest('.fb-dash-form-element, .jobs-easy-apply-form-element, [class*="form-component"], [class*="form-element"], [role="group"], .artdeco-modal__content');
        if (ctxGroup) contextText += ' ' + ctxGroup.textContent.toLowerCase();
      } catch(ce) {}

      // Notice period
      if (contextText.indexOf('notice period') >= 0 || contextText.indexOf('préavis') >= 0) {
        setNativeValue(inp, '30');
        filledCount++;
        console.log('[JobTracker] Filled notice period (30 days) via context detection');
      }
      // Expected/current salary / CTC
      else if (contextText.indexOf('current salary') >= 0 || contextText.indexOf('expected salary') >= 0 || contextText.indexOf('ctc') >= 0 || contextText.indexOf('compensation') >= 0) {
        setNativeValue(inp, '80000');
        filledCount++;
        console.log('[JobTracker] Filled salary via context detection');
      }
      // "Whole number" / "number larger than 0" — generic numeric
      else if (contextText.indexOf('whole number') >= 0 || contextText.indexOf('larger than 0') >= 0) {
        setNativeValue(inp, '30');
        filledCount++;
        console.log('[JobTracker] Filled numeric-hinted field (30) via context detection');
      }
      // Availability / start date (text)
      else if (contextText.indexOf('available') >= 0 || contextText.indexOf('start') >= 0 || contextText.indexOf('join') >= 0) {
        setNativeValue(inp, 'Immediately');
        filledCount++;
        console.log('[JobTracker] Filled availability via context detection');
      }
      // Standard type-based fallback
      else if (inp.type === 'number' || inp.type === 'tel') {
        setNativeValue(inp, '7');
        filledCount++;
        console.log('[JobTracker] Filled required numeric field (label: "' + label.substring(0, 40) + '")');
      } else if (inp.type === 'url') {
        setNativeValue(inp, 'https://www.floriangouloubi.com/');
        filledCount++;
        console.log('[JobTracker] Filled required URL field');
      }
      // For required text fields we don't recognize, log but don't fill with garbage
      else {
        console.log('[JobTracker] WARNING: required field unfilled — label: "' + label.substring(0, 60) + '" context: "' + contextText.substring(0, 80) + '"');
      }
    }
  }

  // Handle select dropdowns inside modal
  var selects = document.querySelectorAll('select');
  for (var s = 0; s < selects.length; s++) {
    var sel = selects[s];
    if (sel.offsetHeight === 0) continue;
    if (!isInApplyContext(sel)) continue;
    if (sel.value && sel.selectedIndex > 0) {
      // Already has a non-default selection — but dispatch change event to sync React state
      // LinkedIn pre-fills SELECTs from profile but React form state may not be initialized
      if (isFieldRequired(sel)) {
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        sel.dispatchEvent(new Event('input', { bubbles: true }));
      }
      continue;
    }

    var selLabel = getInputLabel(sel);

    // For "Yes/No" selects — default to Yes for authorization, No for sponsorship
    var options = sel.querySelectorAll('option');
    var matched = false;
    for (var so = 0; so < options.length; so++) {
      var optText = options[so].textContent.trim().toLowerCase();

      // Work authorization / eligibility / remote / relocation → Yes
      if (!matched && (selLabel.indexOf('authorized') >= 0 || selLabel.indexOf('eligible') >= 0 || selLabel.indexOf('right to work') >= 0 || selLabel.indexOf('remote') >= 0 || selLabel.indexOf('relocat') >= 0 || selLabel.indexOf('legally') >= 0 || selLabel.indexOf('permission') >= 0 || selLabel.indexOf('willing') >= 0 || selLabel.indexOf('commut') >= 0) && optText === 'yes') {
        sel.value = options[so].value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        filledCount++;
        matched = true;
        console.log('[JobTracker] Selected "Yes" for: ' + selLabel.substring(0, 40));
        break;
      }
      // Sponsorship / visa → No
      if (!matched && (selLabel.indexOf('sponsor') >= 0 || selLabel.indexOf('visa') >= 0) && optText === 'no') {
        sel.value = options[so].value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        filledCount++;
        matched = true;
        console.log('[JobTracker] Selected "No" for: ' + selLabel.substring(0, 40));
        break;
      }
    }

    // Gender/pronouns — select "Prefer not to say" or "Other" if available
    if (!matched && (selLabel.indexOf('gender') >= 0 || selLabel.indexOf('pronoun') >= 0 || selLabel.indexOf('race') >= 0 || selLabel.indexOf('ethnic') >= 0 || selLabel.indexOf('veteran') >= 0 || selLabel.indexOf('disability') >= 0 || selLabel.indexOf('demographic') >= 0)) {
      for (var dp = 0; dp < options.length; dp++) {
        var dpText = options[dp].textContent.trim().toLowerCase();
        if (dpText.indexOf('prefer not') >= 0 || dpText.indexOf('decline') >= 0 || dpText.indexOf('not to disclose') >= 0 || dpText.indexOf('choose not') >= 0) {
          sel.value = options[dp].value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          filledCount++;
          matched = true;
          console.log('[JobTracker] Selected "Prefer not to say" for: ' + selLabel.substring(0, 40));
          break;
        }
      }
    }

    // If this is a required select and still on the default/empty option, select the first real option
    if (!matched && sel.selectedIndex <= 0 && isFieldRequired(sel) && options.length > 1) {
      // Select first non-placeholder option (skip option with empty value or "Select..." text)
      for (var fo = 1; fo < options.length; fo++) {
        if (options[fo].value && options[fo].value !== '' && options[fo].textContent.trim().toLowerCase().indexOf('select') < 0) {
          sel.value = options[fo].value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          filledCount++;
          console.log('[JobTracker] Auto-selected first option for required dropdown: ' + selLabel.substring(0, 40));
          break;
        }
      }
    }
  }

  // Handle radio buttons (Yes/No) — also look for LinkedIn's custom radio-like components
  var radios = document.querySelectorAll('input[type="radio"]');
  var checkedGroups = {}; // Track which groups we've already handled
  for (var k = 0; k < radios.length; k++) {
    // Check if any radio in this group is already checked
    var groupName = radios[k].getAttribute('name');
    if (groupName) {
      if (checkedGroups[groupName]) continue;
      var groupChecked = document.querySelector('input[type="radio"][name="' + groupName + '"]:checked');
      if (groupChecked) {
        checkedGroups[groupName] = true;
        continue;
      }
    }

    var radioLabel = (radios[k].closest('label') || radios[k].parentElement);
    if (!radioLabel) continue;
    var radioText = radioLabel.textContent.toLowerCase();
    var groupText = '';
    try { groupText = radios[k].closest('fieldset, [role="radiogroup"], [class*="radio-group"]').textContent.toLowerCase(); } catch(e) {}
    // Also try parent container for group context
    if (!groupText) {
      try { groupText = radios[k].closest('[class*="form-element"], [class*="form-component"]').textContent.toLowerCase(); } catch(e2) {}
    }

    if ((groupText.indexOf('authorized') >= 0 || groupText.indexOf('eligible') >= 0 || groupText.indexOf('right to work') >= 0 || groupText.indexOf('legally') >= 0 || groupText.indexOf('permission') >= 0) && radioText.indexOf('yes') >= 0) {
      radios[k].click();
      filledCount++;
      if (groupName) checkedGroups[groupName] = true;
    }
    if ((groupText.indexOf('sponsor') >= 0 || groupText.indexOf('visa') >= 0) && radioText.indexOf('no') >= 0) {
      radios[k].click();
      filledCount++;
      if (groupName) checkedGroups[groupName] = true;
    }
    if (groupText.indexOf('remote') >= 0 && radioText.indexOf('yes') >= 0) {
      radios[k].click();
      filledCount++;
      if (groupName) checkedGroups[groupName] = true;
    }
    if (groupText.indexOf('commut') >= 0 && radioText.indexOf('yes') >= 0) {
      radios[k].click();
      filledCount++;
      if (groupName) checkedGroups[groupName] = true;
    }
    if ((groupText.indexOf('relocat') >= 0 || groupText.indexOf('willing') >= 0) && radioText.indexOf('yes') >= 0) {
      radios[k].click();
      filledCount++;
      if (groupName) checkedGroups[groupName] = true;
    }
    // Gender/race/veteran/disability — prefer "Prefer not to say" / "Decline"
    if ((groupText.indexOf('gender') >= 0 || groupText.indexOf('race') >= 0 || groupText.indexOf('veteran') >= 0 || groupText.indexOf('disability') >= 0 || groupText.indexOf('demographic') >= 0) &&
        (radioText.indexOf('prefer not') >= 0 || radioText.indexOf('decline') >= 0 || radioText.indexOf('choose not') >= 0)) {
      radios[k].click();
      filledCount++;
      if (groupName) checkedGroups[groupName] = true;
    }
  }

  // ─── CATCH-ALL: Default "Yes" for any required, unanswered radio groups ───
  // Custom employer questions (from ATS like PYJAMAHR) often have Yes/No radios
  // that don't match any of our keyword patterns above. Default to "Yes".
  var allRadiosCatchall = document.querySelectorAll('input[type="radio"]');
  var groupsHandled = {};
  for (var rc = 0; rc < allRadiosCatchall.length; rc++) {
    var rca = allRadiosCatchall[rc];
    if (!isInApplyContext(rca)) continue;
    if (rca.offsetHeight === 0) continue;
    var gn = rca.getAttribute('name');
    if (!gn || groupsHandled[gn]) continue;
    // Check if already checked
    var alreadyChecked = document.querySelector('input[type="radio"][name="' + gn + '"]:checked');
    if (alreadyChecked) {
      groupsHandled[gn] = true;
      continue;
    }
    // Not checked — find all options in this group and pick "Yes" or first
    var groupRadios = document.querySelectorAll('input[type="radio"][name="' + gn + '"]');
    var pickedYes = false;
    for (var gr = 0; gr < groupRadios.length; gr++) {
      var grLabel = '';
      try { grLabel = (groupRadios[gr].closest('label') || groupRadios[gr].parentElement).textContent.trim().toLowerCase(); } catch(e) {}
      if (grLabel === 'yes' || grLabel === 'oui') {
        groupRadios[gr].click();
        filledCount++;
        pickedYes = true;
        console.log('[JobTracker] Default "Yes" for unanswered required radio group: ' + gn.substring(0, 40));
        break;
      }
    }
    if (!pickedYes && groupRadios.length > 0) {
      groupRadios[0].click();
      filledCount++;
      console.log('[JobTracker] Default first option for unanswered radio group: ' + gn.substring(0, 40));
    }
    groupsHandled[gn] = true;
  }

  // Handle checkboxes (follow company, share data, etc.)
  var checkboxes = document.querySelectorAll('input[type="checkbox"]');
  for (var cb = 0; cb < checkboxes.length; cb++) {
    if (!isInApplyContext(checkboxes[cb])) continue;
    if (checkboxes[cb].offsetHeight === 0) continue;
    var cbLabel = '';
    try { cbLabel = (checkboxes[cb].closest('label') || checkboxes[cb].parentElement).textContent.toLowerCase(); } catch(e) {}
    // Uncheck "follow company" to avoid spam
    if (checkboxes[cb].checked && (cbLabel.indexOf('follow') >= 0 || cbLabel.indexOf('suivre') >= 0)) {
      checkboxes[cb].click();
    }
    // Check required terms/conditions checkboxes
    if (!checkboxes[cb].checked && isFieldRequired(checkboxes[cb]) && (cbLabel.indexOf('agree') >= 0 || cbLabel.indexOf('terms') >= 0 || cbLabel.indexOf('accept') >= 0 || cbLabel.indexOf('consent') >= 0 || cbLabel.indexOf('acknowledge') >= 0 || cbLabel.indexOf('confirm') >= 0)) {
      checkboxes[cb].click();
      filledCount++;
      console.log('[JobTracker] Checked required agreement checkbox');
    }
  }

  // Handle textareas (cover letter, additional info)
  var textareas = document.querySelectorAll('textarea');
  for (var ta = 0; ta < textareas.length; ta++) {
    var textarea = textareas[ta];
    if (textarea.offsetHeight === 0) continue;
    if (!isInApplyContext(textarea)) continue;
    if (textarea.value && textarea.value.trim().length > 0) continue;

    var taLabel = getInputLabel(textarea);

    // Cover letter or additional info — paste portfolio link
    if (taLabel.indexOf('cover') >= 0 || taLabel.indexOf('lettre') >= 0 || taLabel.indexOf('additional') >= 0 || taLabel.indexOf('message') >= 0 || taLabel.indexOf('note') >= 0 || taLabel.indexOf('summary') >= 0 || taLabel.indexOf('about') >= 0 || taLabel.indexOf('why') >= 0 || taLabel.indexOf('tell us') >= 0) {
      // Try to get cover letter from storage first
      try {
        chrome.storage.local.get(['pendingApplyJob'], function(data) {
          var cl = (data.pendingApplyJob && data.pendingApplyJob.coverLetterSnippet) || '';
          var text = cl || 'Portfolio: https://www.floriangouloubi.com/';
          setNativeValue(textarea, text);
        });
      } catch(e) {
        setNativeValue(textarea, 'Portfolio: https://www.floriangouloubi.com/');
      }
      filledCount++;
      console.log('[JobTracker] Filled cover letter / additional info');
    }
    // If textarea is required and still empty, fill with portfolio link
    else if (isFieldRequired(textarea)) {
      setNativeValue(textarea, 'Portfolio: https://www.floriangouloubi.com/');
      filledCount++;
      console.log('[JobTracker] Filled required textarea with portfolio link');
    }
  }

  // Handle LinkedIn custom components: div[contenteditable], custom dropdowns, etc.
  var editables = document.querySelectorAll('[contenteditable="true"]');
  for (var ed = 0; ed < editables.length; ed++) {
    if (editables[ed].offsetHeight === 0) continue;
    if (!isInApplyContext(editables[ed])) continue;
    if (editables[ed].textContent.trim().length > 0) continue;

    var edLabel = getInputLabel(editables[ed]);
    if (edLabel.indexOf('cover') >= 0 || edLabel.indexOf('message') >= 0 || edLabel.indexOf('note') >= 0 || edLabel.indexOf('additional') >= 0) {
      editables[ed].textContent = 'Portfolio: https://www.floriangouloubi.com/';
      editables[ed].dispatchEvent(new Event('input', { bubbles: true }));
      filledCount++;
      console.log('[JobTracker] Filled contenteditable field');
    }
  }

  // ─── SPECIAL PASS: Fix typeahead fields that have values but show validation errors ───
  // LinkedIn pre-fills city/location from profile but requires a dropdown selection.
  // These fields have values so the main loop skips them, but they show "Please enter a valid answer".
  var typeaheadInputs = document.querySelectorAll('input[role="combobox"], input[aria-autocomplete], [class*="typeahead"] input, [class*="autocomplete"] input');
  for (var ti = 0; ti < typeaheadInputs.length; ti++) {
    var taInp = typeaheadInputs[ti];
    if (taInp.offsetHeight === 0) continue;
    if (!isInApplyContext(taInp)) continue;

    // Check if this typeahead has a validation error
    var taFormGroup = taInp.closest('.fb-dash-form-element, .jobs-easy-apply-form-element, [class*="form-component"], [class*="form-element"]');
    var hasError = false;
    if (taFormGroup) {
      var errorEls = taFormGroup.querySelectorAll('[role="alert"], .artdeco-inline-feedback--error, [class*="error"]');
      for (var ei = 0; ei < errorEls.length; ei++) {
        if (errorEls[ei].offsetHeight > 0 && errorEls[ei].textContent.trim().length > 0) {
          hasError = true;
          break;
        }
      }
    }

    if (hasError || taInp.getAttribute('aria-invalid') === 'true') {
      var taLabel = getInputLabel(taInp);
      console.log('[JobTracker] Typeahead field with error detected — label: "' + taLabel.substring(0, 40) + '" val: "' + taInp.value + '"');

      // Determine value to fill based on label
      var taValue = taInp.value || 'Bangkok'; // preserve existing value as default
      if (taLabel.indexOf('city') >= 0 || taLabel.indexOf('location') >= 0 || taLabel.indexOf('ville') >= 0) {
        taValue = 'Bangkok';
      } else if (taLabel.indexOf('school') >= 0 || taLabel.indexOf('university') >= 0 || taLabel.indexOf('éco') >= 0) {
        taValue = 'ESD';
      } else if (taLabel.indexOf('company') >= 0 || taLabel.indexOf('entreprise') >= 0) {
        taValue = 'ClickOut Media';
      }

      // Clear and re-fill via typeahead to get dropdown selection
      handleTypeahead(taInp, taValue);
      filledCount++;
      console.log('[JobTracker] Re-filling typeahead field via dropdown selection');
    }
  }

  // Also check any input in a form group that has "please enter a valid answer" error
  // (catches typeahead fields that don't have explicit typeahead attributes)
  var allAlerts = document.querySelectorAll('[role="alert"]');
  for (var al = 0; al < allAlerts.length; al++) {
    var alertText = (allAlerts[al].textContent || '').trim().toLowerCase();
    if (alertText.indexOf('please enter a valid answer') >= 0 && allAlerts[al].offsetHeight > 0) {
      // Find the input in the same form group
      var alertGroup = allAlerts[al].closest('.fb-dash-form-element, .jobs-easy-apply-form-element, [class*="form-component"], [class*="form-element"]');
      if (alertGroup) {
        var alertInput = alertGroup.querySelector('input[type="text"]');
        if (alertInput && alertInput.offsetHeight > 0) {
          var alLabel = getInputLabel(alertInput);
          console.log('[JobTracker] "Please enter a valid answer" found — input label: "' + alLabel.substring(0, 40) + '" val: "' + alertInput.value + '"');

          var alValue = alertInput.value || 'Bangkok';
          if (alLabel.indexOf('city') >= 0 || alLabel.indexOf('location') >= 0 || alLabel.indexOf('ville') >= 0 || alLabel.indexOf('where') >= 0) {
            alValue = 'Bangkok';
          }
          handleTypeahead(alertInput, alValue);
          filledCount++;
          console.log('[JobTracker] Re-filling field with error via typeahead');
        }
      }
    }
  }

  return filledCount;
}

// ─── Helper: set input value using native setter (for React-managed inputs) ───
function setNativeValue(el, value) {
  if (!el) return false;
  try {
    // Focus the element first — LinkedIn React inputs need focus to accept changes
    try { el.focus(); } catch (fe) { /* some elements can't focus */ }
    try { el.dispatchEvent(new Event('focus', { bubbles: true })); } catch (e) {}
    try { el.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); } catch (e) {}

    // Use the RIGHT native setter for the element's actual tag — calling
    // HTMLInputElement's value setter on a textarea throws "Illegal invocation"
    // and kills the entire form-fill flow (the Haiku fallback hook included).
    var proto;
    var tag = el.tagName;
    if (tag === 'TEXTAREA') {
      proto = window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype;
    } else if (tag === 'SELECT') {
      proto = window.HTMLSelectElement && window.HTMLSelectElement.prototype;
    } else {
      proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
    }

    var descriptor = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }

    // Fire all the events React might be listening to
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    // Simulate keydown/keyup for the last character (triggers React onChange in some builds)
    if (value && value.length > 0) {
      try {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: value[value.length - 1], bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: value[value.length - 1], bubbles: true }));
      } catch (e) {}
    }
    try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {}
    try { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); } catch (e) {}
    return true;
  } catch (err) {
    // NEVER throw from setNativeValue — a single bad element must not kill
    // the whole form-fill flow. If this throws, the Haiku fallback (which runs
    // AFTER fillCurrentStep) never gets a chance to rescue the form.
    try { warn('setNativeValue error on ' + (el.tagName || '?') + ': ' + (err && err.message)); } catch (e) {}
    return false;
  }
}

// ─── Find modal/form buttons ───
function findModalButtons() {
  var nextBtn = null;
  var submitBtn = null;
  var reviewBtn = null;
  var isSDUI = window.location.href.toLowerCase().indexOf('/apply') >= 0;
  var btns = document.querySelectorAll('button, a[role="button"], [role="button"]');

  for (var m = 0; m < btns.length; m++) {
    if (btns[m].offsetHeight === 0) continue;
    // In modal mode: only buttons inside the modal/dialog. In SDUI mode: all visible buttons.
    if (!isSDUI && !btns[m].closest('.jobs-easy-apply-modal, .artdeco-modal, [role="dialog"], [data-test-modal], .jobs-easy-apply-content, .jobs-apply-form')) continue;
    var bText = btns[m].textContent.trim().toLowerCase();
    var bAriaLabel = (btns[m].getAttribute('aria-label') || '').toLowerCase();

    // Submit button — multiple variants
    if (bText.indexOf('submit application') >= 0 || bText.indexOf('soumettre la candidature') >= 0 || bText === 'submit' || bText === 'soumettre' || bAriaLabel.indexOf('submit application') >= 0 || bAriaLabel.indexOf('soumettre') >= 0) {
      submitBtn = btns[m];
    }
    // Review button
    else if (bText === 'review' || bText === 'vérifier' || bText === 'réviser' || bText.indexOf('review your application') >= 0 || bAriaLabel.indexOf('review') >= 0) {
      reviewBtn = btns[m];
    }
    // Next button — multiple variants
    else if (bText === 'next' || bText === 'suivant' || bText === 'continue' || bText === 'continuer' || bAriaLabel === 'next' || bAriaLabel === 'continue' || bAriaLabel === 'suivant') {
      nextBtn = btns[m];
    }
  }

  return { nextBtn: nextBtn, submitBtn: submitBtn, reviewBtn: reviewBtn };
}

// ─── Helper: click button using CDP trusted events (isTrusted:true) ───
// LinkedIn 2026 ignores synthetic .click() — fires ALL strategies in parallel.
// Whichever one works, the button receives the click.
// 1) CDP mouse click with mouseMoved (trusted, coordinate-based)
// 2) Focus + CDP Enter key (trusted, no coordinates)
// 3) Synthetic .click() + PointerEvents (untrusted fallback)
function clickButtonTrusted(btn, callback) {
  btn.scrollIntoView({ block: 'center', behavior: 'instant' });
  setTimeout(function() {
    var btnText = btn.textContent.trim().substring(0, 25);
    var rect = btn.getBoundingClientRect();
    var x = Math.round(rect.x + rect.width / 2);
    var y = Math.round(rect.y + rect.height / 2);

    console.log('[JobTracker] clickButtonTrusted: "' + btnText + '" at (' + x + ',' + y + ') — firing all strategies in parallel');

    // Strategy A: CDP mouse click (trusted, coordinate-based)
    chrome.runtime.sendMessage({ action: 'trustedClick', x: x, y: y }, function(resp) {
      if (chrome.runtime.lastError) {
        console.warn('[JobTracker] CDP mouse click error:', chrome.runtime.lastError.message);
      } else {
        console.log('[JobTracker] CDP mouse click result:', JSON.stringify(resp));
      }
    });

    // Strategy B: Focus + CDP Enter (trusted, no coordinates)
    try { btn.focus(); } catch(e) {}
    setTimeout(function() {
      // Verify focus landed on the button
      var focused = document.activeElement;
      var focusOk = focused === btn || (focused && focused.contains && focused.contains(btn));
      console.log('[JobTracker] Focus check: activeElement=' + (focused?.tagName || 'null') + ' text="' + (focused?.textContent || '').trim().substring(0, 20) + '" focusOk=' + focusOk);

      chrome.runtime.sendMessage({
        action: 'trustedKeypress',
        key: 'Enter', code: 'Enter', keyCode: 13
      }, function(resp) {
        if (chrome.runtime.lastError) {
          console.warn('[JobTracker] CDP Enter error:', chrome.runtime.lastError.message);
        } else {
          console.log('[JobTracker] CDP Enter result:', JSON.stringify(resp));
        }
      });
    }, 100);

    // Strategy C: Synthetic events (untrusted fallback)
    btn.click();
    try {
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    } catch(pe) {}

    // Callback after all strategies have had time to fire
    setTimeout(function() {
      if (callback) callback();
    }, 400);
  }, 300); // Wait for scroll to settle
}

// ─── Check for validation errors that block Next/Submit ───
function hasValidationErrors() {
  // Scope to the modal/dialog to avoid false positives from page-level alerts
  var container = document.querySelector('.jobs-easy-apply-modal, .artdeco-modal, [role="dialog"], .jobs-easy-apply-content, .jobs-apply-form');
  if (!container) {
    // SDUI page: use body but be more careful
    var isSDUI = window.location.href.toLowerCase().indexOf('/apply') >= 0;
    container = isSDUI ? document.body : null;
  }
  if (!container) return false;

  // Check for actual error feedback elements (NOT generic [role="alert"])
  var errorElements = container.querySelectorAll(
    '.artdeco-inline-feedback--error, .fb-dash-form-element__error-field, ' +
    '[data-test-form-element-error], .jobs-easy-apply-form-element__error, ' +
    '[class*="error-message"], [class*="form-error"], ' +
    '[class*="invalid-feedback"], [class*="field-error"]'
  );
  for (var e = 0; e < errorElements.length; e++) {
    if (errorElements[e].offsetHeight > 0 && errorElements[e].textContent.trim().length > 0) {
      console.log('[JobTracker] Validation error found: "' + errorElements[e].textContent.trim().substring(0, 60) + '"');
      return true;
    }
  }

  // Check [role="alert"] separately — but only if text looks like an actual error
  // (filters out "Loading job details", "Submitting...", etc.)
  var alerts = container.querySelectorAll('[role="alert"]');
  var errorKeywords = ['required', 'invalid', 'error', 'please', 'must', 'cannot', 'missing', 'enter a', 'provide', 'select a', 'obligatoire', 'veuillez'];
  for (var a = 0; a < alerts.length; a++) {
    if (alerts[a].offsetHeight === 0) continue;
    var alertText = alerts[a].textContent.trim().toLowerCase();
    if (alertText.length === 0) continue;
    for (var k = 0; k < errorKeywords.length; k++) {
      if (alertText.indexOf(errorKeywords[k]) >= 0) {
        console.log('[JobTracker] Validation alert found: "' + alerts[a].textContent.trim().substring(0, 60) + '"');
        return true;
      }
    }
  }

  // Check for inputs with aria-invalid="true" inside the form
  var invalidInputs = container.querySelectorAll('[aria-invalid="true"]');
  for (var iv = 0; iv < invalidInputs.length; iv++) {
    if (invalidInputs[iv].offsetHeight > 0) {
      console.log('[JobTracker] Found input with aria-invalid=true');
      return true;
    }
  }
  return false;
}

// ─── Check for required file upload fields (resume already uploaded check) ───
function hasRequiredUnfilledUpload() {
  var uploadSections = document.querySelectorAll('.jobs-document-upload, [data-test-document-upload]');
  for (var u = 0; u < uploadSections.length; u++) {
    if (!uploadSections[u].closest('.jobs-easy-apply-modal, .artdeco-modal, [role="dialog"]')) continue;
    // If there's already an uploaded file name shown, it's fine
    var uploadedFile = uploadSections[u].querySelector('.jobs-document-upload__file-name, .artdeco-inline-feedback');
    if (uploadedFile && uploadedFile.textContent.trim().length > 0) continue;
    // Check if "Upload resume" text is still showing (no file uploaded)
    var uploadText = uploadSections[u].textContent.toLowerCase();
    if (uploadText.indexOf('upload') >= 0 || uploadText.indexOf('télécharger') >= 0) {
      // There's a resume upload button — LinkedIn should auto-fill from profile
      // If it's not filled, we can't upload a file from content script easily
      console.log('[JobTracker] Resume upload section detected — hoping LinkedIn auto-fills');
    }
  }
  return false;
}

// ─── Multi-step form handler — loops through all pages until Submit ───
// Tracks fingerprints to detect stuck steps (same page after clicking Next)
var _stepFingerprints = [];
var _consecutiveStuckCount = 0;
var _MAX_STUCK_RETRIES = 5; // Stop after 5 consecutive identical steps (was 3, increased to reduce false negatives)
var _noFieldPageCount = 0; // Track consecutive no-field transitional pages
var _MAX_NO_FIELD_PAGES = 5; // Cap no-field loops to prevent infinite cycling

function handleMultiStepForm(company, role, stepNum, maxSteps, callback) {
  if (stepNum > maxSteps) {
    // Check for success before giving up
    var maxStepBody = (document.body.innerText || '').toLowerCase();
    var maxStepSuccess = maxStepBody.indexOf('application was sent') >= 0 ||
                         maxStepBody.indexOf('application submitted') >= 0 ||
                         maxStepBody.indexOf('candidature envoy') >= 0;
    if (maxStepSuccess) {
      console.log('[JobTracker] SUCCESS detected at max steps — application submitted!');
      callback({ success: true, status: 'applied', reason: 'Application submitted (detected at max steps)' });
      return;
    }
    console.log('[JobTracker] Max steps (' + maxSteps + ') reached — giving up');
    saveDiagnostics(stepNum, 'Max steps exceeded');
    callback({ success: false, status: 'needs_review', reason: 'Multi-step form exceeded ' + maxSteps + ' steps' });
    return;
  }

  // ─── Early success check: did the page already show submission confirmation? ───
  var bodyTextCheck = (document.body.innerText || '').toLowerCase();
  var earlySuccess = bodyTextCheck.indexOf('application was sent') >= 0 ||
                     bodyTextCheck.indexOf('application submitted') >= 0 ||
                     bodyTextCheck.indexOf('candidature envoy') >= 0 ||
                     bodyTextCheck.indexOf('your application was sent') >= 0;
  if (earlySuccess) {
    console.log('[JobTracker] SUCCESS detected at start of step ' + stepNum + ' — application submitted!');
    callback({ success: true, status: 'applied', reason: 'Application submitted successfully (detected at step ' + stepNum + ')' });
    return;
  }

  // ─── Review page detection: if we see "Review your application" or 100%, fast-track Submit ───
  var dialogContainer = findApplyDialog();
  if (dialogContainer) {
    var dialogText = dialogContainer.innerText.toLowerCase();
    var isReviewPage = dialogText.indexOf('review your application') >= 0 || dialogText.indexOf('review') >= 0 && dialogText.indexOf('100%') >= 0;
    if (isReviewPage && stepNum > 1) {
      console.log('[JobTracker] REVIEW PAGE detected at step ' + stepNum + ' — fast-tracking Submit');
      // Scroll dialog to bottom to reveal Submit button
      var scrollEl = dialogContainer.querySelector('.artdeco-modal__content, .jobs-easy-apply-content') || dialogContainer;
      scrollEl.scrollTop = scrollEl.scrollHeight;

      // Uncheck "Follow company" before submitting
      var cbs = dialogContainer.querySelectorAll('input[type="checkbox"]');
      for (var cbi = 0; cbi < cbs.length; cbi++) {
        var cblbl = '';
        try { cblbl = (cbs[cbi].closest('label') || cbs[cbi].parentElement).textContent.toLowerCase(); } catch(e) {}
        if (cbs[cbi].checked && (cblbl.indexOf('follow') >= 0 || cblbl.indexOf('suivre') >= 0)) {
          cbs[cbi].click();
        }
      }

      // Wait for scroll, then look for Submit aggressively
      setTimeout(function() {
        var submitBtns = dialogContainer.querySelectorAll('button');
        var submitBtn = null;
        for (var sb = 0; sb < submitBtns.length; sb++) {
          var sbt = submitBtns[sb].textContent.trim().toLowerCase();
          var sba = (submitBtns[sb].getAttribute('aria-label') || '').toLowerCase();
          if (sbt.indexOf('submit') >= 0 || sba.indexOf('submit') >= 0 || sbt.indexOf('soumettre') >= 0) {
            submitBtn = submitBtns[sb];
            break;
          }
        }
        // Also check outside dialog as fallback
        if (!submitBtn) {
          var allPageBtns = document.querySelectorAll('button');
          for (var apb = 0; apb < allPageBtns.length; apb++) {
            var apbt = allPageBtns[apb].textContent.trim().toLowerCase();
            if ((apbt.indexOf('submit application') >= 0 || apbt.indexOf('soumettre la candidature') >= 0) && allPageBtns[apb].offsetHeight > 0) {
              submitBtn = allPageBtns[apb];
              break;
            }
          }
        }

        if (submitBtn) {
          console.log('[JobTracker] Submit button found on review page — clicking!');
          submitBtn.scrollIntoView({ block: 'center' });
          submitBtn.click();

          // Poll for confirmation (up to 10s)
          var confirmAttempts2 = 0;
          var confirmInterval2 = setInterval(function() {
            var bt = (document.body.innerText || '').toLowerCase();
            var confirmed2 = bt.indexOf('application was sent') >= 0 || bt.indexOf('application submitted') >= 0 || bt.indexOf('candidature envoy') >= 0;
            var modalGone2 = !document.querySelector('.jobs-easy-apply-modal, .artdeco-modal[role="dialog"], [role="dialog"]');
            if (confirmed2 || (modalGone2 && confirmAttempts2 > 2)) {
              clearInterval(confirmInterval2);
              callback({ success: true, status: 'applied', reason: 'Application submitted from review page!' });
              return;
            }
            confirmAttempts2++;
            if (confirmAttempts2 >= 10) {
              clearInterval(confirmInterval2);
              callback({ success: true, status: 'applied', reason: 'Submit clicked on review page, confirmation pending' });
            }
          }, 1000);
        } else {
          console.log('[JobTracker] Review page detected but Submit button NOT found — continuing normal flow');
          // Fall through to normal handling (stuck detection etc.)
          _consecutiveStuckCount = 0; // Reset to avoid false stuck detection on review page
          fillCurrentStep();
          setTimeout(function() {
            var buttons = findModalButtons();
            if (buttons.submitBtn) {
              buttons.submitBtn.click();
              setTimeout(function() {
                callback({ success: true, status: 'applied', reason: 'Submit clicked from review page (delayed find)' });
              }, 5000);
            } else if (buttons.nextBtn || buttons.reviewBtn) {
              handleMultiStepForm(company, role, stepNum + 1, maxSteps, callback);
            } else {
              callback({ success: false, status: 'needs_review', reason: 'Review page but no Submit button found on step ' + stepNum });
            }
          }, 1000);
        }
      }, 500); // Wait for scroll to settle
      return; // Skip normal flow — review page handler takes over
    }
  }

  // ─── Handle consent page checkboxes / custom toggles ───
  // Some LinkedIn Easy Apply forms have a GDPR/data consent page with custom
  // role="checkbox" divs or unchecked input checkboxes that must be checked
  // before the "Next" button will work.
  try {
    var consentContainer = findApplyDialog() || document.body;
    // Check for role="checkbox" custom elements (LinkedIn's React UI)
    var roleCheckboxes = consentContainer.querySelectorAll('[role="checkbox"][aria-checked="false"]');
    for (var rc = 0; rc < roleCheckboxes.length; rc++) {
      if (roleCheckboxes[rc].offsetHeight > 0) {
        var rcLabel = '';
        try { rcLabel = (roleCheckboxes[rc].closest('label') || roleCheckboxes[rc].parentElement).textContent.toLowerCase().substring(0, 60); } catch(e) {}
        // Don't uncheck "Follow company" — only check consent-related ones
        if (rcLabel.indexOf('follow') < 0 && rcLabel.indexOf('suivre') < 0) {
          console.log('[JobTracker] Checking custom role=checkbox: "' + rcLabel + '"');
          roleCheckboxes[rc].click();
        }
      }
    }
    // Also check any standard unchecked checkboxes that are required or consent-related
    var stdCheckboxes = consentContainer.querySelectorAll('input[type="checkbox"]:not(:checked)');
    for (var sc = 0; sc < stdCheckboxes.length; sc++) {
      if (stdCheckboxes[sc].offsetHeight === 0) continue;
      var scLabel = '';
      try { scLabel = (stdCheckboxes[sc].closest('label') || stdCheckboxes[sc].parentElement).textContent.toLowerCase().substring(0, 80); } catch(e) {}
      // Check consent/agree/terms checkboxes, skip "follow" ones
      if (scLabel.indexOf('follow') < 0 && scLabel.indexOf('suivre') < 0) {
        if (stdCheckboxes[sc].required || scLabel.indexOf('agree') >= 0 || scLabel.indexOf('consent') >= 0 ||
            scLabel.indexOf('accept') >= 0 || scLabel.indexOf('terms') >= 0 || scLabel.indexOf('data') >= 0 ||
            scLabel.indexOf('policy') >= 0 || scLabel.indexOf('j\'accepte') >= 0 || scLabel.indexOf('condition') >= 0) {
          console.log('[JobTracker] Checking consent checkbox: "' + scLabel + '"');
          stdCheckboxes[sc].click();
        }
      }
    }
  } catch(consentErr) {
    console.warn('[JobTracker] Consent checkbox detection error:', consentErr.message);
  }

  // ─── Stuck-step detection ───
  var currentFingerprint = getStepFingerprint();
  var lastFingerprint = _stepFingerprints.length > 0 ? _stepFingerprints[_stepFingerprints.length - 1] : null;

  // Check if this is a transitional/loading page with no form fields
  var dialogForFieldCheck = findApplyDialog();
  var fieldCheckContainer = dialogForFieldCheck || document.body;
  var visibleFields = fieldCheckContainer.querySelectorAll('input:not([type="hidden"]), select, textarea');
  var hasVisibleFields = false;
  for (var vf = 0; vf < visibleFields.length; vf++) {
    if (visibleFields[vf].offsetHeight > 0) { hasVisibleFields = true; break; }
  }

  if (lastFingerprint !== null && currentFingerprint === lastFingerprint) {
    // If this is a consent/loading page with NO fields, don't count as stuck
    // — just keep clicking Next (the page might still be loading)
    if (!hasVisibleFields) {
      _noFieldPageCount++;
      if (_noFieldPageCount >= _MAX_NO_FIELD_PAGES) {
        console.log('[JobTracker] No-field page repeated ' + _noFieldPageCount + ' times — waiting 5s for late success');
        saveDiagnostics(stepNum, 'No-field page loop (' + _noFieldPageCount + ' times)');
        var noFieldCount = _noFieldPageCount;
        setTimeout(function() {
          var lateBody2 = (document.body.innerText || '').toLowerCase();
          var lateSuccess2 = lateBody2.indexOf('application was sent') >= 0 ||
                             lateBody2.indexOf('application submitted') >= 0 ||
                             lateBody2.indexOf('candidature envoy') >= 0 ||
                             lateBody2.indexOf('your application was sent') >= 0;
          if (lateSuccess2) {
            console.log('[JobTracker] LATE SUCCESS after no-field loop — application actually submitted!');
            callback({ success: true, status: 'applied', reason: 'Application submitted (late detection after no-field loop)' });
            return;
          }
          callback({ success: false, status: 'needs_review', reason: 'Form stuck on consent/loading page with no fields for ' + noFieldCount + ' iterations' });
        }, 5000);
        return;
      }
      console.log('[JobTracker] Same fingerprint but NO visible fields — transitional page (' + _noFieldPageCount + '/' + _MAX_NO_FIELD_PAGES + ')');
      _consecutiveStuckCount = 0; // Reset stuck counter for no-field pages
    } else {
      _noFieldPageCount = 0; // Reset no-field counter when fields appear
      _consecutiveStuckCount++;
    }
    console.log('[JobTracker] STUCK DETECTION: same page fingerprint (' + currentFingerprint + ') — stuck count: ' + _consecutiveStuckCount + '/' + _MAX_STUCK_RETRIES + ' | hasFields: ' + hasVisibleFields);

    if (_consecutiveStuckCount >= _MAX_STUCK_RETRIES) {
      // Before declaring stuck, check one more time for success indicators
      var stuckBodyText = (document.body.innerText || '').toLowerCase();
      var stuckSuccess = stuckBodyText.indexOf('application was sent') >= 0 ||
                         stuckBodyText.indexOf('application submitted') >= 0 ||
                         stuckBodyText.indexOf('candidature envoy') >= 0 ||
                         stuckBodyText.indexOf('your application was sent') >= 0;
      if (stuckSuccess) {
        console.log('[JobTracker] SUCCESS detected during stuck check — application actually submitted!');
        callback({ success: true, status: 'applied', reason: 'Application submitted (confirmed during stuck detection at step ' + stepNum + ')' });
        return;
      }

      // ─── DIAGNOSTIC DUMP: capture everything visible when stuck ───
      var stuckDialog = findApplyDialog();
      var stuckContainer = stuckDialog || document.body;
      var stuckDialogText = (stuckContainer.innerText || '').substring(0, 500);
      var stuckInputs = stuckContainer.querySelectorAll('input, select, textarea');
      var stuckFieldDump = [];
      for (var si = 0; si < stuckInputs.length; si++) {
        if (stuckInputs[si].offsetHeight > 0) {
          var sLabel = getInputLabel(stuckInputs[si]);
          stuckFieldDump.push(stuckInputs[si].tagName + '(' + stuckInputs[si].type + ') label="' + sLabel.substring(0, 40) + '" val="' + (stuckInputs[si].value || '').substring(0, 20) + '" req=' + isFieldRequired(stuckInputs[si]));
        }
      }
      var stuckBtns = stuckContainer.querySelectorAll('button');
      var stuckBtnDump = [];
      for (var sbi = 0; sbi < stuckBtns.length; sbi++) {
        if (stuckBtns[sbi].offsetHeight > 0) {
          stuckBtnDump.push('"' + stuckBtns[sbi].textContent.trim().substring(0, 30) + '" disabled=' + stuckBtns[sbi].disabled);
        }
      }
      var validationErrors = hasValidationErrors();
      console.error('[JobTracker] ═══ STUCK DIAGNOSTIC DUMP (step ' + stepNum + ') ═══');
      console.error('[JobTracker] Container: ' + (stuckContainer === document.body ? 'BODY (no dialog found!)' : stuckContainer.tagName + '.' + (stuckContainer.className || '').substring(0, 50)));
      console.error('[JobTracker] Dialog text (first 500 chars): ' + stuckDialogText);
      console.error('[JobTracker] Visible fields (' + stuckFieldDump.length + '): ' + stuckFieldDump.join(' | '));
      console.error('[JobTracker] Visible buttons (' + stuckBtnDump.length + '): ' + stuckBtnDump.join(' | '));
      console.error('[JobTracker] Has validation errors: ' + validationErrors);
      console.error('[JobTracker] URL: ' + window.location.href);
      console.error('[JobTracker] All dialogs on page: ' + document.querySelectorAll('[role="dialog"]').length);
      // ─── END DIAGNOSTIC DUMP ───

      console.log('[JobTracker] STUCK: ' + _MAX_STUCK_RETRIES + ' consecutive identical steps — waiting 5s for late success before aborting');
      saveDiagnostics(stepNum, 'Stuck for ' + _MAX_STUCK_RETRIES + ' attempts');
      // Wait 5s before declaring failure — in-flight clicks may have advanced the form
      // (confirmed: Samba TV + Miracle Software submitted despite stuck detection)
      var stuckFieldDumpStr = stuckFieldDump.join(' | ').substring(0, 200);
      setTimeout(function() {
        // Final success check after waiting
        var lateBody = (document.body.innerText || '').toLowerCase();
        var lateSuccess = lateBody.indexOf('application was sent') >= 0 ||
                          lateBody.indexOf('application submitted') >= 0 ||
                          lateBody.indexOf('candidature envoy') >= 0 ||
                          lateBody.indexOf('your application was sent') >= 0;
        if (lateSuccess) {
          console.log('[JobTracker] LATE SUCCESS after stuck detection — application actually submitted!');
          callback({ success: true, status: 'applied', reason: 'Application submitted (late detection after stuck at step ' + stepNum + ')' });
          return;
        }
        callback({
          success: false,
          status: 'needs_review',
          reason: 'Form stuck on same page for ' + _MAX_STUCK_RETRIES + ' attempts (step ' + stepNum + ') — unfilled required fields likely blocking advancement. Fields: ' + stuckFieldDumpStr
        });
      }, 5000);
      return;
    }
  } else {
    _consecutiveStuckCount = 0; // Reset — page changed
  }
  _stepFingerprints.push(currentFingerprint);

  console.log('[JobTracker] Step ' + stepNum + '/' + maxSteps + ' — filling fields... (fingerprint: ' + currentFingerprint + ')');

  // Fill all fields on current step — wrapped in try/catch so a single bad
  // field (e.g. Illegal invocation on textarea native setter) does NOT crash
  // the whole apply flow before the Haiku fallback hook has a chance to run.
  window._typeaheadTriggered = false; // Reset before fill
  var filled = 0;
  try {
    filled = fillCurrentStep();
  } catch (fillErr) {
    warn('[JobTracker] fillCurrentStep threw on step ' + stepNum + ': ' + (fillErr && fillErr.message) + ' — continuing to Haiku fallback');
  }
  console.log('[JobTracker] Filled ' + filled + ' fields on step ' + stepNum + (window._typeaheadTriggered ? ' (typeahead triggered)' : ''));

  // Adaptive delay: 4s if typeahead was triggered (needs dropdown selection), 1s otherwise
  var stepDelay = window._typeaheadTriggered ? 4000 : 1000;
  setTimeout(function() {
    // ─── Haiku fallback: fill LinkedIn custom questions BEFORE advancing ───
    // Runs once per step, before Next/Review/Submit. Critical for screening
    // questions on step 2-3 that our hardcoded label matcher misses.
    var haikuPromise;
    try {
      haikuPromise = runHaikuFieldFallback();
    } catch (hErr) {
      log('[haiku-fallback] sync error:', hErr && hErr.message);
      haikuPromise = Promise.resolve(0);
    }

    haikuPromise.then(function (haikuFilled) {
      if (haikuFilled > 0) {
        log('[haiku-fallback] Filled ' + haikuFilled + ' custom field(s) before advancing on step ' + stepNum);
      }
    }).catch(function (hErr2) {
      log('[haiku-fallback] error:', hErr2 && hErr2.message);
    }).then(function () {
      _runStepNavigation(company, role, stepNum, maxSteps, hasVisibleFields, callback);
    });
  }, stepDelay); // Adaptive: 4s for typeahead, 1s for normal fills
}

// ─── Step navigation (extracted to allow awaiting Haiku fallback) ───
function _runStepNavigation(company, role, stepNum, maxSteps, hasVisibleFields, callback) {
  (function () {
    var buttons = findModalButtons();

    if (buttons.submitBtn) {
      console.log('[JobTracker] Submit button found on step ' + stepNum + ' — submitting!');

      // Uncheck "Follow company" before submitting
      var checkboxes = document.querySelectorAll('input[type="checkbox"]');
      for (var cb = 0; cb < checkboxes.length; cb++) {
        if (checkboxes[cb].offsetHeight === 0) continue;
        var cbLabel = '';
        try { cbLabel = (checkboxes[cb].closest('label') || checkboxes[cb].parentElement).textContent.toLowerCase(); } catch(e) {}
        if (checkboxes[cb].checked && (cbLabel.indexOf('follow') >= 0 || cbLabel.indexOf('suivre') >= 0)) {
          checkboxes[cb].click();
        }
      }

      // Use trusted click for Submit — LinkedIn 2026 modal buttons need isTrusted:true
      clickButtonTrusted(buttons.submitBtn, function() {
        console.log('[JobTracker] Submit trusted click sent');
      });

      // Poll for confirmation (up to 10s)
      var confirmAttempts = 0;
      var confirmInterval = setInterval(function() {
        var bodyText = (document.body.innerText || '').toLowerCase();
        var confirmed = bodyText.indexOf('application was sent') >= 0 ||
                       bodyText.indexOf('application submitted') >= 0 ||
                       bodyText.indexOf('candidature envoy') >= 0 ||
                       bodyText.indexOf('your application was sent') >= 0 ||
                       bodyText.indexOf('already applied') >= 0;

        // Also check if the modal closed (another sign of success)
        var modalGone = !document.querySelector('.jobs-easy-apply-modal, .artdeco-modal[role="dialog"] .jobs-easy-apply-content, [role="dialog"]');

        if (confirmed || (modalGone && confirmAttempts > 2)) {
          clearInterval(confirmInterval);
          console.log('[JobTracker] Application submitted successfully!');
          callback({ success: true, status: 'applied', reason: 'Application submitted successfully!' });
          return;
        }

        confirmAttempts++;
        if (confirmAttempts >= 10) {
          clearInterval(confirmInterval);
          // Modal might still be open with errors
          if (hasValidationErrors()) {
            console.log('[JobTracker] Submit clicked but validation errors remain');
            callback({ success: false, status: 'needs_review', reason: 'Validation errors on submit — manual review needed' });
          } else {
            console.log('[JobTracker] Submit clicked — assuming success (no confirmation detected)');
            callback({ success: true, status: 'applied', reason: 'Submit clicked, confirmation unclear but modal processing' });
          }
        }
      }, 1000);

    } else if (buttons.reviewBtn) {
      console.log('[JobTracker] Review button found on step ' + stepNum + ' — trusted clicking review');
      clickButtonTrusted(buttons.reviewBtn, function() {
        // After clicking Review, wait and then look for Submit on the review page
        setTimeout(function() {
          handleMultiStepForm(company, role, stepNum + 1, maxSteps, callback);
        }, 2500);
      });

    } else if (buttons.nextBtn) {
      // STRATEGY: Always click Next FIRST. If the page doesn't change (validation blocks it),
      // THEN check for errors and try to fill missing fields. This avoids false positives
      // from pre-existing aria-invalid or inline feedback that doesn't actually block navigation.
      console.log('[JobTracker] Next button found on step ' + stepNum + ' — trusted clicking Next... (hasFields: ' + hasVisibleFields + ')');
      var preClickFingerprint = getStepFingerprint();

      // Use CDP trusted click — synthetic .click() doesn't work on LinkedIn 2026 modal buttons
      clickButtonTrusted(buttons.nextBtn, function() {
        // Wait for next page to render — longer wait for no-field/transitional pages
        var verifyDelay = hasVisibleFields ? 3000 : 4000;
        setTimeout(function() {
          verifyAndAdvance(company, role, stepNum, maxSteps, preClickFingerprint, callback);
        }, verifyDelay);
      });

    } else {
      // No button found — check if modal/form is still open
      var isSDUIPage = window.location.href.toLowerCase().indexOf('/apply') >= 0;
      var modal = findApplyDialog();
      if (!modal && !isSDUIPage) {
        // Modal closed — check if it was a successful 1-click auto-submit
        var pageText = (document.body.innerText || '').toLowerCase();
        var wasAutoSubmitted = pageText.indexOf('application was sent') >= 0 ||
                               pageText.indexOf('application submitted') >= 0 ||
                               pageText.indexOf('candidature envoy') >= 0 ||
                               pageText.indexOf('your application') >= 0;
        if (wasAutoSubmitted) {
          console.log('[JobTracker] 1-click auto-submit detected — application sent!');
          callback({ success: true, status: 'applied', reason: 'Application auto-submitted (1-click Easy Apply)' });
        } else {
          console.log('[JobTracker] Modal closed without submit or confirmation');
          callback({ success: false, status: 'needs_review', reason: 'Modal closed without submit — check manually' });
        }
      } else {
        // No buttons found — might be on review page with Submit not yet rendered.
        // Try scrolling the modal to make the Submit button visible, then retry.
        console.log('[JobTracker] No buttons found on step ' + stepNum + ' — scrolling modal + retrying in 2s');
        // Scroll the modal container to bottom to reveal Submit button
        var scrollContainer = document.querySelector('.jobs-easy-apply-modal .jobs-easy-apply-content, .artdeco-modal .artdeco-modal__content, [role="dialog"] .artdeco-modal__content, [role="dialog"]');
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
          console.log('[JobTracker] Scrolled modal to bottom');
        }

        setTimeout(function() {
          var retryButtons = findModalButtons();
          if (retryButtons.submitBtn || retryButtons.nextBtn || retryButtons.reviewBtn) {
            // FIX: Reset stuck counter before recursing with same step number
            // Without this, the retry loop triggers stuck detection falsely
            _consecutiveStuckCount = 0;
            handleMultiStepForm(company, role, stepNum, maxSteps, callback);
          } else {
            // Last resort: check if maybe the dialog is actually a review page with the Submit
            // button hidden behind a specific LinkedIn element structure
            var allBtns = document.querySelectorAll('button');
            var foundSubmit = null;
            for (var fb = 0; fb < allBtns.length; fb++) {
              var fbText = allBtns[fb].textContent.trim().toLowerCase();
              if (fbText.indexOf('submit') >= 0 && fbText.indexOf('application') >= 0) {
                foundSubmit = allBtns[fb];
                break;
              }
            }
            if (foundSubmit) {
              console.log('[JobTracker] Found Submit button outside modal scope — clicking it');
              foundSubmit.scrollIntoView({ block: 'center' });
              setTimeout(function() { foundSubmit.click(); }, 300);
              // Poll for confirmation
              setTimeout(function() {
                var confirmText = (document.body.innerText || '').toLowerCase();
                if (confirmText.indexOf('application was sent') >= 0 || confirmText.indexOf('application submitted') >= 0) {
                  callback({ success: true, status: 'applied', reason: 'Application submitted (found Submit outside modal)' });
                } else {
                  callback({ success: true, status: 'applied', reason: 'Submit clicked (found outside modal scope)' });
                }
              }, 5000);
            } else {
              callback({ success: false, status: 'needs_review', reason: 'No navigation buttons found in modal on step ' + stepNum });
            }
          }
        }, 2000);
      }
    }
  })(); // end IIFE inside _runStepNavigation
}

// ─── Verify DOM changed after clicking Next, retry fill if stuck ───
function verifyAndAdvance(company, role, stepNum, maxSteps, preClickFingerprint, callback) {
  var postClickFingerprint = getStepFingerprint();

  if (postClickFingerprint === preClickFingerprint) {
    // Page did NOT change — likely a required field wasn't filled
    console.log('[JobTracker] WARNING: Next clicked but page did not change (fingerprint unchanged: ' + postClickFingerprint + ')');

    // Check for validation errors that appeared after clicking Next
    if (hasValidationErrors()) {
      console.log('[JobTracker] Validation errors appeared after Next click — trying to fill unfilled required fields');
      var extraFilled = fillRequiredFieldsFallback();
      console.log('[JobTracker] Fallback filled ' + extraFilled + ' fields');

      if (extraFilled > 0) {
        // Re-try: wait for React, then try Next again
        setTimeout(function() {
          var retryButtons = findModalButtons();
          if (retryButtons.nextBtn) {
            retryButtons.nextBtn.click();
            setTimeout(function() {
              // Don't increment step — this is still the same step
              handleMultiStepForm(company, role, stepNum + 1, maxSteps, callback);
            }, 1500);
          } else {
            handleMultiStepForm(company, role, stepNum + 1, maxSteps, callback);
          }
        }, 800);
        return;
      }
    }

    // Page didn't change and we couldn't fill more — let stuck detection handle it
    console.log('[JobTracker] Could not resolve stuck step — continuing with same step number');
    handleMultiStepForm(company, role, stepNum + 1, maxSteps, callback);
  } else {
    // Page changed — advance to next step
    console.log('[JobTracker] Page changed after Next click (old: ' + preClickFingerprint + ', new: ' + postClickFingerprint + ')');
    handleMultiStepForm(company, role, stepNum + 1, maxSteps, callback);
  }
}

// ─── Fallback: aggressively try to fill any remaining required fields ───
function fillRequiredFieldsFallback() {
  var filledCount = 0;
  var allInputs = document.querySelectorAll('input, select, textarea');

  for (var i = 0; i < allInputs.length; i++) {
    var field = allInputs[i];
    if (field.offsetHeight === 0) continue;
    if (!isInApplyContext(field)) continue;

    // Skip if already has value
    if (field.tagName === 'SELECT') {
      if (field.selectedIndex > 0) continue;
    } else {
      if (field.value && field.value.trim().length > 0) continue;
    }

    // Skip non-required fields in fallback
    if (!isFieldRequired(field)) continue;
    // Skip radios/checkboxes/hidden/file
    if (field.type === 'radio' || field.type === 'checkbox' || field.type === 'hidden' || field.type === 'file') continue;

    var label = getInputLabel(field);
    console.log('[JobTracker] Fallback: trying to fill required field — label: "' + label.substring(0, 60) + '", type: ' + field.type + ', tag: ' + field.tagName);

    if (field.tagName === 'SELECT') {
      // For required selects still on default, pick the first real option
      var opts = field.querySelectorAll('option');
      for (var o = 1; o < opts.length; o++) {
        if (opts[o].value && opts[o].value !== '') {
          field.value = opts[o].value;
          field.dispatchEvent(new Event('change', { bubbles: true }));
          filledCount++;
          console.log('[JobTracker] Fallback: selected first option "' + opts[o].textContent.trim().substring(0, 30) + '"');
          break;
        }
      }
    } else if (field.tagName === 'TEXTAREA') {
      setNativeValue(field, 'Portfolio: https://www.floriangouloubi.com/');
      filledCount++;
      console.log('[JobTracker] Fallback: filled textarea with portfolio link');
    } else if (field.type === 'number' || field.type === 'tel') {
      setNativeValue(field, '7');
      filledCount++;
      console.log('[JobTracker] Fallback: filled numeric field with 7');
    } else if (field.type === 'email') {
      setNativeValue(field, 'florian.gouloubi@gmail.com');
      filledCount++;
      console.log('[JobTracker] Fallback: filled email');
    } else if (field.type === 'url') {
      setNativeValue(field, 'https://www.floriangouloubi.com/');
      filledCount++;
      console.log('[JobTracker] Fallback: filled URL');
    } else {
      // Last resort for text fields: try to infer from label + surrounding context
      // Also check for nearby text (dialog/question text that label detection misses)
      var contextText = label;
      try {
        var nearbyGroup = field.closest('.fb-dash-form-element, .jobs-easy-apply-form-element, [class*="form-component"], [class*="form-element"], [role="group"]');
        if (nearbyGroup) contextText += ' ' + nearbyGroup.textContent.toLowerCase();
        // Also check nearby [role="alert"] for validation hints
        var nearbyAlert = nearbyGroup ? nearbyGroup.querySelector('[role="alert"]') : null;
        if (nearbyAlert) contextText += ' ' + nearbyAlert.textContent.toLowerCase();
      } catch(ctxErr) {}

      if (label.indexOf('phone') >= 0 || label.indexOf('tel') >= 0 || label.indexOf('mobile') >= 0) {
        setNativeValue(field, '+66 618156481');
        filledCount++;
      } else if (label.indexOf('name') >= 0 && label.indexOf('company') < 0) {
        setNativeValue(field, 'Florian Gouloubi');
        filledCount++;
      } else if (label.indexOf('city') >= 0 || label.indexOf('location') >= 0) {
        setNativeValue(field, 'Bangkok');
        filledCount++;
      } else if (label.indexOf('year') >= 0 || label.indexOf('experience') >= 0) {
        setNativeValue(field, '7');
        filledCount++;
      } else if (contextText.indexOf('notice period') >= 0 || contextText.indexOf('préavis') >= 0) {
        // Notice period in days
        setNativeValue(field, '30');
        filledCount++;
        console.log('[JobTracker] Fallback: filled notice period with 30 days');
      } else if (contextText.indexOf('whole number') >= 0 || contextText.indexOf('larger than 0') >= 0 || contextText.indexOf('numeric') >= 0 || contextText.indexOf('enter a number') >= 0) {
        // Unknown numeric field — fill with a reasonable number
        setNativeValue(field, '7');
        filledCount++;
        console.log('[JobTracker] Fallback: filled numeric-hinted field with 7');
      } else if (contextText.indexOf('salary') >= 0 || contextText.indexOf('compensation') >= 0 || contextText.indexOf('ctc') >= 0 || contextText.indexOf('pay') >= 0) {
        setNativeValue(field, '80000');
        filledCount++;
        console.log('[JobTracker] Fallback: filled salary field with 80000');
      } else {
        // Absolute last resort: fill with "N/A" to unblock the form
        setNativeValue(field, 'N/A');
        filledCount++;
        console.log('[JobTracker] Fallback: filled unknown required text field with "N/A" — context: "' + contextText.substring(0, 80) + '"');
      }
    }
  }

  // Also handle required radio groups that haven't been answered
  var radioGroups = {};
  var allRadios = document.querySelectorAll('input[type="radio"]');
  for (var r = 0; r < allRadios.length; r++) {
    if (!isInApplyContext(allRadios[r])) continue;
    var gn = allRadios[r].getAttribute('name');
    if (!gn) continue;
    if (!radioGroups[gn]) radioGroups[gn] = [];
    radioGroups[gn].push(allRadios[r]);
  }
  var groupKeys = Object.keys(radioGroups);
  for (var g = 0; g < groupKeys.length; g++) {
    var group = radioGroups[groupKeys[g]];
    var hasChecked = false;
    for (var gc = 0; gc < group.length; gc++) {
      if (group[gc].checked) { hasChecked = true; break; }
    }
    if (hasChecked) continue;
    // No radio selected in this group — check if any is required
    var anyRequired = false;
    for (var gr = 0; gr < group.length; gr++) {
      if (isFieldRequired(group[gr])) { anyRequired = true; break; }
    }
    if (!anyRequired) continue;
    // Select the first "Yes" option, or the first option as fallback
    var selectedOne = false;
    for (var gy = 0; gy < group.length; gy++) {
      var rLabel = '';
      try { rLabel = (group[gy].closest('label') || group[gy].parentElement).textContent.toLowerCase(); } catch(e3) {}
      if (rLabel.indexOf('yes') >= 0 || rLabel.indexOf('oui') >= 0) {
        group[gy].click();
        filledCount++;
        selectedOne = true;
        console.log('[JobTracker] Fallback: selected "Yes" for radio group ' + groupKeys[g]);
        break;
      }
    }
    if (!selectedOne && group.length > 0) {
      group[0].click();
      filledCount++;
      console.log('[JobTracker] Fallback: selected first radio option for group ' + groupKeys[g]);
    }
  }

  return filledCount;
}


// ─── Main logic ───
function runApplyLogic() {
  try {
    // ─── FIX: Early auth wall / error detection ───
    var currentUrl = window.location.href.toLowerCase();
    if (currentUrl.indexOf('/login') >= 0 || currentUrl.indexOf('/checkpoint') >= 0 || currentUrl.indexOf('/authwall') >= 0) {
      console.warn('[JobTracker] Page is a login/auth wall — aborting');
      setResult({ success: false, status: 'auth_wall', reason: 'LinkedIn login page — session expired', company: 'Unknown', role: 'Unknown' });
      return;
    }

    // ─── SDUI Apply Page Detection (LinkedIn 2026) ───
    // If we're on /jobs/view/{id}/apply/, we're on the SDUI apply form page.
    // Skip button search — go directly to form filling.
    if (currentUrl.indexOf('/apply') >= 0 && currentUrl.indexOf('opensdui') >= 0) {
      console.log('[JobTracker] SDUI apply page detected — starting form fill directly');
      // Try to get company/role from stored data
      chrome.storage.local.get(['pendingSDUIApply', 'pendingApplyJob'], function(data) {
        var sdui = data.pendingSDUIApply || {};
        var pending = data.pendingApplyJob || {};
        var company = sdui.company || pending.company || getCompany();
        var role = sdui.role || pending.role || getRole();
        console.log('[JobTracker] SDUI apply for:', company, '-', role);

        // The SDUI page may have the form directly visible (no modal)
        // Use the same multi-step handler but look for form elements on the page itself
        startMultiStep(company, role);
      });
      return;
    }

    var easyApplyBtn = findEasyApplyButton();
    var company = getCompany();
    var role = getRole();

    // If no button found yet and we haven't exhausted retries, wait and try again
    if (!easyApplyBtn && _retryCount < _maxRetries) {
      _retryCount++;

      // Check: is there text saying "already applied" or "application submitted"?
      var bodyText = (document.body.innerText || '').toLowerCase();
      if (bodyText.indexOf('application submitted') >= 0 || bodyText.indexOf('application was sent') >= 0 ||
          bodyText.indexOf('candidature envoy') >= 0) {
        console.log('[JobTracker] Already applied to this job — skipping');
        setResult({ success: false, status: 'already_applied', reason: 'Already applied to this job', company: company, role: role });
        return;
      }

      // Check: is the job posting expired / removed / not valid?
      if (bodyText.indexOf('not be valid') >= 0 || bodyText.indexOf('has been removed') >= 0 ||
          bodyText.indexOf('no longer accepting') >= 0 || bodyText.indexOf('no longer available') >= 0 ||
          bodyText.indexOf('unable to load') >= 0 || bodyText.indexOf('page not found') >= 0 ||
          bodyText.indexOf('this job is no longer') >= 0 || bodyText.indexOf('posting has expired') >= 0) {
        console.log('[JobTracker] Job posting expired/removed — skipping');
        setResult({ success: false, status: 'expired', reason: 'Job posting removed or no longer available', company: company, role: role });
        return;
      }

      // Check if page has a regular Apply button/link (non-Easy Apply) — meaning this is external
      var hasRegularApply = false;
      var btnsCheck = document.querySelectorAll('button, a');
      for (var c = 0; c < btnsCheck.length; c++) {
        var btnTxt = (btnsCheck[c].textContent || '').trim().toLowerCase();
        if ((btnTxt === 'apply' || btnTxt === 'postuler' || btnTxt === 'apply now') &&
            btnTxt.indexOf('easy') < 0 && btnsCheck[c].offsetHeight > 0) {
          hasRegularApply = true;
          break;
        }
      }

      // If we see a regular "Apply" but no "Easy Apply" after 3 retries, it's external
      if (hasRegularApply && _retryCount > 3) {
        console.log('[JobTracker] Regular Apply found (not Easy Apply) — this is external');
        // Fall through to external apply handling below
      } else {
        console.log('[JobTracker] Retry ' + _retryCount + '/' + _maxRetries + ' — waiting for Easy Apply to render');
        setTimeout(runApplyLogic, 1000);
        return;
      }
    }

    console.log('[JobTracker] Job:', company, '-', role, '| Easy Apply:', !!easyApplyBtn, '| Retries:', _retryCount);

    if (easyApplyBtn) {
      console.log('[JobTracker] Clicking Easy Apply — tag:', easyApplyBtn.tagName, 'href:', easyApplyBtn.getAttribute('href') || 'none');

      // New LinkedIn 2026: Easy Apply is an <a> that navigates to /apply/?openSDUIApplyFlow=true
      // The page will navigate away from the job detail page to the apply form page.
      // We need to detect whether it opens a modal (legacy) or navigates (SDUI).
      var isSDUILink = easyApplyBtn.tagName === 'A' && (easyApplyBtn.getAttribute('href') || '').indexOf('/apply/') >= 0;

      if (isSDUILink) {
        console.log('[JobTracker] SDUI apply flow detected — using CDP trusted click');
        // LinkedIn 2026 requires isTrusted:true mouse events. Content script .click()
        // produces isTrusted:false which React ignores. Use CDP Input.dispatchMouseEvent
        // via background.js trustedClick handler for a real browser-level click.

        // Scroll element into view first — button may be below the fold in the 800x600 window
        easyApplyBtn.scrollIntoView({ block: 'center', behavior: 'instant' });

        // Store pending state before the click (in case page navigates)
        chrome.storage.local.set({
          pendingSDUIApply: {
            company: company,
            role: role,
            linkedinUrl: window.location.href,
            applyUrl: easyApplyBtn.href,
            timestamp: Date.now(),
          }
        });

        // Small delay after scroll for layout to settle, then get coordinates and click
        setTimeout(function() {
          var rect = easyApplyBtn.getBoundingClientRect();
          var clickX = Math.round(rect.x + rect.width / 2);
          var clickY = Math.round(rect.y + rect.height / 2);

          console.log('[JobTracker] Requesting trustedClick at (' + clickX + ',' + clickY + ') — rect:', JSON.stringify({x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height)}));

          // First attach debugger, then click (avoids info bar offset issues)
          chrome.runtime.sendMessage({ action: 'debuggerAttach' }, function(attachResp) {
            if (chrome.runtime.lastError) {
              console.warn('[JobTracker] debuggerAttach error:', chrome.runtime.lastError.message);
            }
            // Re-measure after debugger attach (info bar shifts content down ~40px)
            setTimeout(function() {
              var rect2 = easyApplyBtn.getBoundingClientRect();
              var finalX = Math.round(rect2.x + rect2.width / 2);
              var finalY = Math.round(rect2.y + rect2.height / 2);
              console.log('[JobTracker] Post-attach coords: (' + finalX + ',' + finalY + ')');

              chrome.runtime.sendMessage({ action: 'trustedClick', x: finalX, y: finalY }, function(resp) {
                if (chrome.runtime.lastError) {
                  console.warn('[JobTracker] trustedClick failed:', chrome.runtime.lastError.message);
                } else {
                  console.log('[JobTracker] trustedClick response:', JSON.stringify(resp));
                }
              });
            }, 500); // Wait for debugger info bar to render
          });
        }, 300); // Wait for scroll to settle

        // After trusted click, wait for either: modal opens, page navigates, or form appears
        setTimeout(function() {
          if (_resultWasSet) return;

          // Check 1: Did a modal/dialog open?
          var modal = document.querySelector('.jobs-easy-apply-modal, .artdeco-modal, [role="dialog"]');
          if (modal) {
            console.log('[JobTracker] Easy Apply modal opened after trusted click');
            startMultiStep(company, role);
            return;
          }

          // Check 2: Did the URL change to /apply/?
          if (window.location.href.indexOf('/apply') >= 0) {
            console.log('[JobTracker] Page navigated to apply URL after trusted click');
            startMultiStep(company, role);
            return;
          }

          // Check 3: Are there new form inputs (inline apply flow)?
          var formInputs = document.querySelectorAll('input[type="text"], input[type="tel"], input[type="email"], select, textarea');
          var applyInputs = 0;
          for (var fi = 0; fi < formInputs.length; fi++) {
            if (formInputs[fi].offsetHeight > 0) applyInputs++;
          }
          if (applyInputs > 3) {
            console.log('[JobTracker] Apply form detected inline (' + applyInputs + ' inputs)');
            startMultiStep(company, role);
            return;
          }

          // Nothing happened after 5s — fallback: try direct navigation
          console.log('[JobTracker] Trusted click had no visible effect — trying direct navigation');
          window.location.href = easyApplyBtn.href;
        }, 5000);
      } else {
        // Legacy flow: button click opens a modal
        easyApplyBtn.click();

        // Wait for modal to open, then start multi-step form handling
        setTimeout(function() {
          try {
            var modal = document.querySelector('.jobs-easy-apply-modal, .artdeco-modal, [role="dialog"]');
            if (!modal) {
              console.log('[JobTracker] Easy Apply modal did not open — retrying click');
              easyApplyBtn.click();
              setTimeout(function() {
                startMultiStep(company, role);
              }, 2000);
              return;
            }

            startMultiStep(company, role);

          } catch(fillErr) {
            console.error('[JobTracker] Form fill error:', fillErr.message);
            setResult({ success: false, status: 'error', reason: 'Form fill error: ' + fillErr.message, company: company, role: role });
          }
        }, 2500);
      }

    } else {
      // ─── External Apply handling ───
      console.log('[JobTracker] No Easy Apply — trying external Apply button');
      handleExternalApply(company, role);
    }

  } catch(err) {
    console.error('[JobTracker] Critical error:', err.message);
    setResult({ success: false, status: 'error', reason: 'Critical error: ' + err.message, company: 'Unknown', role: 'Unknown' });
  }
}

function startMultiStep(company, role) {
  handleMultiStepForm(company, role, 1, 15, function(result) {
    console.log('[JobTracker] Final result:', result.status, '-', result.reason);
    setResult({
      success: result.success,
      status: result.status,
      reason: result.reason,
      company: company,
      role: role,
    });
  });
}

// ─── Set result in chrome.storage.local ───
function setResult(result) {
  // Cancel safety-net timeout — we have a real result
  _resultWasSet = true;
  if (_safetyTimeout) { clearTimeout(_safetyTimeout); _safetyTimeout = null; }

  // ─── ULTIMATE FIX: Before reporting any failure, check if the application actually submitted ───
  // The form flow sometimes reports "stuck" or "needs_review" even when the submit went through.
  // This final guard prevents false negatives by checking the page text one last time.
  if (!result.success && result.status !== 'already_applied' && result.status !== 'expired' && result.status !== 'auth_wall' && result.status !== 'pending_external') {
    try {
      var finalBodyText = (document.body.innerText || '').toLowerCase();
      var actuallySubmitted = finalBodyText.indexOf('application was sent') >= 0 ||
                              finalBodyText.indexOf('application submitted') >= 0 ||
                              finalBodyText.indexOf('candidature envoy') >= 0 ||
                              finalBodyText.indexOf('your application was sent') >= 0;
      if (actuallySubmitted) {
        console.log('[JobTracker] OVERRIDE: Was about to report "' + result.status + '" but page shows application submitted!');
        result = {
          success: true,
          status: 'applied',
          reason: 'Application submitted (overridden from ' + result.status + ': ' + (result.reason || '').substring(0, 60) + ')',
          company: result.company,
          role: result.role,
        };
      }
    } catch(checkErr) { /* ignore */ }
  }

  try {
    chrome.storage.local.set({
      lastApplyResult: {
        success: result.success,
        status: result.status,
        reason: result.reason,
        company: result.company || 'Unknown',
        role: result.role || 'Unknown',
        url: window.location.href,
        timestamp: new Date().toISOString(),
      }
    }, function() {
      console.log('[JobTracker] Result saved to storage:', result.status);
    });
  } catch(e) {
    console.error('[JobTracker] Failed to save result:', e.message);
  }
}

// ─── External Apply handling ───
function handleExternalApply(company, role) {
  var externalApplyBtn = null;
  var allBtnsExt = document.querySelectorAll('button, a');
  for (var n = 0; n < allBtnsExt.length; n++) {
    var el = allBtnsExt[n];
    var elText = (el.textContent || '').trim().toLowerCase();
    var elHref = (el.getAttribute('href') || '').toLowerCase();

    // Match "Apply" button that's NOT Easy Apply
    if ((elText === 'apply' || elText === 'postuler' || elText === 'apply now') &&
        elText.indexOf('easy') < 0 && elText.indexOf('simplement') < 0 &&
        el.offsetHeight > 0) {
      externalApplyBtn = el;
      break;
    }
    // Check for links to known ATS domains
    if (elHref && elHref.indexOf('linkedin.com') < 0 &&
        (elHref.indexOf('greenhouse.io') >= 0 || elHref.indexOf('lever.co') >= 0 ||
         elHref.indexOf('workable.com') >= 0 || elHref.indexOf('ashbyhq.com') >= 0 ||
         elHref.indexOf('smartrecruiters.com') >= 0 || elHref.indexOf('teamtailor.com') >= 0 ||
         elHref.indexOf('breezy.hr') >= 0 || elHref.indexOf('recruitee.com') >= 0 ||
         elHref.indexOf('bamboohr.com') >= 0 || elHref.indexOf('applytojob.com') >= 0 ||
         elHref.indexOf('jobvite.com') >= 0 || elHref.indexOf('icims.com') >= 0)) {
      externalApplyBtn = el;
      break;
    }
  }

  if (externalApplyBtn) {
    console.log('[JobTracker] Found external Apply button — setting pendingExternalApply and clicking');
    try {
      chrome.storage.local.get(['pendingApplyJob'], function(data) {
        var coverLetter = (data.pendingApplyJob && data.pendingApplyJob.coverLetterSnippet) || '';
        chrome.storage.local.set({
          pendingExternalApply: {
            company: company, role: role,
            linkedinUrl: window.location.href,
            coverLetter: coverLetter,
            timestamp: Date.now(),
          }
        }, function() {
          console.log('[JobTracker] pendingExternalApply set — clicking external apply');
          externalApplyBtn.click();
          console.log('[JobTracker] Redirecting to external ATS — setting pending_external result');
          // Set pending_external so background.js knows we're waiting for ats-apply.js
          // to fill the form and report the real result (applied_external, needs_manual, or failed).
          // Do NOT report applied_external here — that would be a false positive.
          setResult({
            success: false,
            status: 'pending_external',
            reason: 'External ATS apply button clicked — waiting for ats-apply.js to fill and submit the form',
            company: company,
            role: role,
          });
        });
      });
    } catch(e) {
      chrome.storage.local.set({
        pendingExternalApply: {
          company: company, role: role,
          linkedinUrl: window.location.href,
          timestamp: Date.now(),
        }
      });
      externalApplyBtn.click();
      setResult({
        success: false,
        status: 'pending_external',
        reason: 'External ATS apply button clicked (fallback path) — waiting for ats-apply.js',
        company: company,
        role: role,
      });
    }
  } else {
    console.log('[JobTracker] No external Apply button found either');
    setResult({ success: false, status: 'no_easy_apply', reason: 'No Easy Apply button found and no external apply link detected', company: company, role: role });
  }
}

// Start after initial page render delay (2s — LinkedIn SPA renders fast on repeat views)
setTimeout(runApplyLogic, 2000);

} // end of double-injection guard
