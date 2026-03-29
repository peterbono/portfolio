/**
 * JobTracker — LinkedIn Easy Apply Content Script (v2.5.0)
 * Injected on linkedin.com/jobs/view/* pages via manifest.
 * Handles both Easy Apply (auto-fill+submit) and external Apply (redirect to ATS).
 * Uses ES5-compatible syntax to avoid Chrome content script issues.
 */

console.log('[JobTracker] linkedin-apply.js v2.5.0 loaded on:', window.location.href);
document.title = '[JT] ' + document.title;

setTimeout(function() {
  try {
    // Find Easy Apply button
    var easyApplyBtn = null;
    var allButtons = document.querySelectorAll('button');
    for (var i = 0; i < allButtons.length; i++) {
      var txt = (allButtons[i].textContent || '').toLowerCase();
      if (txt.indexOf('easy apply') >= 0 || txt.indexOf('postuler simplement') >= 0 || txt.indexOf('candidature simplifi') >= 0) {
        easyApplyBtn = allButtons[i];
        break;
      }
    }

    var company = 'Unknown';
    try {
      company = (document.querySelector('.job-details-jobs-unified-top-card__company-name a') ||
                 document.querySelector('.topcard__org-name-link') ||
                 document.querySelector('a[href*="/company/"]')).textContent.trim();
    } catch(e) {}

    var role = 'Unknown';
    try {
      role = (document.querySelector('.job-details-jobs-unified-top-card__job-title h1') ||
              document.querySelector('.topcard__title') ||
              document.querySelector('h1')).textContent.trim();
    } catch(e) {}

    console.log('[JobTracker] Job:', company, '-', role, '| Easy Apply:', !!easyApplyBtn);

    if (easyApplyBtn) {
      console.log('[JobTracker] Clicking Easy Apply...');
      easyApplyBtn.click();

      // Wait for modal to open, then fill fields
      setTimeout(function() {
        try {
          // Fill phone number if empty
          var inputs = document.querySelectorAll('input');
          for (var j = 0; j < inputs.length; j++) {
            var inp = inputs[j];
            var label = ((inp.getAttribute('aria-label') || '') + ' ' + (inp.getAttribute('placeholder') || '')).toLowerCase();

            if (!inp.value && (label.indexOf('phone') >= 0 || label.indexOf('mobile') >= 0 || label.indexOf('tel') >= 0)) {
              inp.focus();
              inp.value = '+66 618156481';
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
              console.log('[JobTracker] Filled phone number');
            }

            if (!inp.value && (label.indexOf('city') >= 0 || label.indexOf('location') >= 0)) {
              inp.focus();
              inp.value = 'Bangkok';
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
              console.log('[JobTracker] Filled city');
            }

            if (!inp.value && label.indexOf('linkedin') >= 0) {
              inp.focus();
              inp.value = 'https://www.linkedin.com/in/floriangouloubi/';
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
              console.log('[JobTracker] Filled LinkedIn URL');
            }

            if (!inp.value && (label.indexOf('website') >= 0 || label.indexOf('portfolio') >= 0 || label.indexOf('url') >= 0)) {
              inp.focus();
              inp.value = 'https://www.floriangouloubi.com/';
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
              console.log('[JobTracker] Filled portfolio URL');
            }
          }

          // Handle radio buttons (Yes/No)
          var radios = document.querySelectorAll('input[type="radio"]');
          for (var k = 0; k < radios.length; k++) {
            var radioLabel = (radios[k].closest('label') || radios[k].parentElement);
            if (!radioLabel) continue;
            var radioText = radioLabel.textContent.toLowerCase();
            var groupText = '';
            try { groupText = radios[k].closest('fieldset').textContent.toLowerCase(); } catch(e) {}

            if ((groupText.indexOf('authorized') >= 0 || groupText.indexOf('eligible') >= 0 || groupText.indexOf('right to work') >= 0) && radioText.indexOf('yes') >= 0) {
              radios[k].click();
            }
            if ((groupText.indexOf('sponsor') >= 0 || groupText.indexOf('visa') >= 0) && radioText.indexOf('no') >= 0) {
              radios[k].click();
            }
            if (groupText.indexOf('remote') >= 0 && radioText.indexOf('yes') >= 0) {
              radios[k].click();
            }
          }

          // Find Next/Review/Submit button
          var nextBtn = null;
          var submitBtn = null;
          var btns = document.querySelectorAll('button');
          for (var m = 0; m < btns.length; m++) {
            var bText = btns[m].textContent.trim().toLowerCase();
            if (bText === 'next' || bText === 'suivant' || bText === 'continue' || bText === 'review') {
              nextBtn = btns[m];
            }
            if (bText.indexOf('submit application') >= 0 || bText.indexOf('submit') >= 0 || bText.indexOf('soumettre') >= 0) {
              submitBtn = btns[m];
            }
          }

          if (submitBtn) {
            console.log('[JobTracker] Submit button found — clicking to submit application');
            submitBtn.click();

            setTimeout(function() {
              var confirmed = document.body.textContent.toLowerCase().indexOf('application was sent') >= 0 ||
                             document.body.textContent.toLowerCase().indexOf('application submitted') >= 0 ||
                             document.body.textContent.toLowerCase().indexOf('candidature envoy') >= 0;
              console.log('[JobTracker] Application submitted:', confirmed ? 'SUCCESS' : 'checking...');

              try {
                chrome.storage.local.set({
                  lastApplyResult: {
                    success: confirmed,
                    status: confirmed ? 'applied' : 'needs_review',
                    reason: confirmed ? 'Application submitted successfully!' : 'Submit clicked but confirmation not detected',
                    company: company,
                    role: role,
                    url: window.location.href,
                    timestamp: new Date().toISOString(),
                  }
                });
              } catch(e) {}
            }, 3000);

          } else if (nextBtn) {
            console.log('[JobTracker] Next button found — advancing form');
            nextBtn.click();
            // User will continue from here
          } else {
            console.log('[JobTracker] No Next/Submit button found in Easy Apply modal');
          }

        } catch(fillErr) {
          console.error('[JobTracker] Form fill error:', fillErr.message);
        }
      }, 2000);

    } else {
      console.log('[JobTracker] No Easy Apply — trying external Apply button');

      // Try to find and click the external "Apply" button to redirect to ATS
      var externalApplyBtn = null;
      var allBtnsExt = document.querySelectorAll('button, a');
      for (var n = 0; n < allBtnsExt.length; n++) {
        var el = allBtnsExt[n];
        var elText = (el.textContent || '').trim().toLowerCase();
        var elHref = (el.getAttribute('href') || '').toLowerCase();
        // Match "Apply" button that's NOT Easy Apply, or links to external ATS
        if ((elText === 'apply' || elText === 'postuler' || elText === 'apply now') &&
            elText.indexOf('easy') < 0 && elText.indexOf('simplement') < 0) {
          externalApplyBtn = el;
          break;
        }
        // Also check for links with external apply URLs
        if (elHref && (elHref.indexOf('greenhouse') >= 0 || elHref.indexOf('lever') >= 0 ||
            elHref.indexOf('workable') >= 0 || elHref.indexOf('ashby') >= 0 ||
            elHref.indexOf('careers') >= 0 || elHref.indexOf('jobs.') >= 0)) {
          externalApplyBtn = el;
          break;
        }
      }

      if (externalApplyBtn) {
        console.log('[JobTracker] Found external Apply button — setting pendingExternalApply and clicking');
        try {
          chrome.storage.local.set({
            pendingExternalApply: {
              company: company,
              role: role,
              linkedinUrl: window.location.href,
              timestamp: Date.now(),
            }
          });
        } catch(e) {}

        // Click to redirect to ATS — background.js will detect and inject ats-apply.js
        externalApplyBtn.click();

        // Don't store result yet — let ats-apply.js handle it
        console.log('[JobTracker] Redirecting to external ATS...');
      } else {
        console.log('[JobTracker] No external Apply button found either');
        try {
          chrome.storage.local.set({
            lastApplyResult: {
              success: false,
              status: 'no_easy_apply',
              reason: 'No Easy Apply button found and no external apply link detected',
              company: company,
              role: role,
              url: window.location.href,
              timestamp: new Date().toISOString(),
            }
          });
        } catch(e) {}
      }
    }

  } catch(err) {
    console.error('[JobTracker] Critical error:', err.message);
  }
}, 3000);
