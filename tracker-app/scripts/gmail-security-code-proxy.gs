/**
 * Gmail Security Code Proxy — Google Apps Script
 *
 * This script runs as a Google Apps Script web app that acts as a proxy
 * for the Trigger.dev worker to read Greenhouse security codes from Gmail.
 *
 * SETUP:
 * 1. Go to https://script.google.com
 * 2. Create a new project named "Greenhouse Code Proxy"
 * 3. Paste this code
 * 4. Deploy → New deployment → Web app
 *    - Execute as: Me (florian.gouloubi@gmail.com)
 *    - Who has access: Anyone (so Trigger.dev can call it)
 * 5. Copy the web app URL
 * 6. Add as GMAIL_PROXY_URL in Trigger.dev env vars
 *
 * SECURITY: The web app URL contains a unique deployment ID that acts as
 * a secret. Don't share it publicly. For extra security, add a shared
 * secret via the AUTH_TOKEN constant below.
 */

const AUTH_TOKEN = 'greenhouse-code-proxy-2026'; // Change this to your own secret

function doGet(e) {
  // Verify auth token
  const token = e.parameter.token;
  if (token !== AUTH_TOKEN) {
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      error: 'Unauthorized'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  const company = e.parameter.company;
  const maxAge = parseInt(e.parameter.maxAge || '10'); // minutes

  if (!company) {
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      error: 'Missing "company" parameter'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const code = findSecurityCode(company, maxAge);
    return ContentService.createTextOutput(JSON.stringify({
      ok: true,
      code: code,
      company: company,
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      ok: false,
      error: err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Search Gmail for a Greenhouse security code email for a specific company.
 * Returns the code string or null if not found.
 */
function findSecurityCode(company, maxAgeMinutes) {
  // Search for security code emails from Greenhouse
  const query = 'from:greenhouse subject:"security code" subject:"' + company + '" newer_than:' + maxAgeMinutes + 'm';

  const threads = GmailApp.search(query, 0, 1);
  if (threads.length === 0) {
    return null;
  }

  const messages = threads[0].getMessages();
  // Get the most recent message in the thread
  const message = messages[messages.length - 1];
  const body = message.getPlainBody();

  // Extract code: "...security code field on your application: XXXXXXXX After you enter..."
  const codeMatch = body.match(/application:\s*(\S+)\s+After/i);
  if (codeMatch) {
    return codeMatch[1];
  }

  // Fallback: look for 6-10 character alphanumeric code after "code:"
  const fallback = body.match(/code[:\s]+([A-Za-z0-9]{6,10})\b/i);
  if (fallback) {
    return fallback[1];
  }

  return null;
}

/**
 * Test function — run this in the script editor to verify it works
 */
function testFindCode() {
  const code = findSecurityCode('Glean', 60);
  Logger.log('Code found: ' + code);
}
