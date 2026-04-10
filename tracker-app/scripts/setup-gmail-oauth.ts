/**
 * setup-gmail-oauth.ts
 * =====================
 * Interactive CLI script that walks you through obtaining a Google OAuth2
 * refresh token for Gmail API (readonly) access.
 *
 * Usage:
 *   npx tsx scripts/setup-gmail-oauth.ts
 *   npx tsx scripts/setup-gmail-oauth.ts <CLIENT_ID> <CLIENT_SECRET>
 *
 * Or via environment variables:
 *   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npx tsx scripts/setup-gmail-oauth.ts
 *
 * Prerequisites:
 *   1. A Google Cloud project with the Gmail API enabled.
 *   2. An OAuth 2.0 "Desktop" or "Web" client credential.
 *      - If using "Web", add http://localhost:3456/oauth/callback as an
 *        authorized redirect URI in the Google Cloud Console.
 *
 * What it does:
 *   1. Prints step-by-step instructions for creating credentials.
 *   2. Reads CLIENT_ID / CLIENT_SECRET from args or env vars.
 *   3. Starts a tiny HTTP server on port 3456.
 *   4. Opens Google's OAuth consent screen in your default browser.
 *   5. Handles the redirect callback, exchanges the auth code for tokens.
 *   6. Prints the refresh_token and instructions for Trigger.dev env vars.
 */

import http from "node:http";
import https from "node:https";
import { URL, URLSearchParams } from "node:url";
import { exec } from "node:child_process";

// ---------------------------------------------------------------------------
// ANSI color helpers for pretty terminal output
// ---------------------------------------------------------------------------
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgGreen: "\x1b[42m",
  bgRed: "\x1b[41m",
  bgYellow: "\x1b[43m",
};

function info(msg: string) {
  console.log(`${c.cyan}[INFO]${c.reset} ${msg}`);
}
function success(msg: string) {
  console.log(`${c.green}${c.bold}[OK]${c.reset} ${msg}`);
}
function warn(msg: string) {
  console.log(`${c.yellow}[WARN]${c.reset} ${msg}`);
}
function error(msg: string) {
  console.error(`${c.red}${c.bold}[ERROR]${c.reset} ${msg}`);
}
function heading(msg: string) {
  console.log(`\n${c.bold}${c.magenta}${"=".repeat(60)}${c.reset}`);
  console.log(`${c.bold}${c.magenta}  ${msg}${c.reset}`);
  console.log(`${c.magenta}${"=".repeat(60)}${c.reset}\n`);
}
function step(n: number, msg: string) {
  console.log(`  ${c.bold}${c.blue}Step ${n}:${c.reset} ${msg}`);
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = 3456;
const REDIRECT_URI = `http://localhost:${PORT}/oauth/callback`;
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

// ---------------------------------------------------------------------------
// Step 1: Print setup instructions
// ---------------------------------------------------------------------------
function printSetupInstructions(): void {
  heading("Google OAuth Setup for Gmail API");

  console.log(`${c.bold}Before running this script, you need OAuth credentials.${c.reset}`);
  console.log(`If you already have a CLIENT_ID and CLIENT_SECRET, skip ahead.\n`);

  step(1, `Go to ${c.cyan}https://console.cloud.google.com/apis/credentials${c.reset}`);
  step(2, `Create a project (or select an existing one).`);
  step(3, `Enable the ${c.bold}Gmail API${c.reset}:`);
  console.log(`         ${c.dim}APIs & Services > Library > search "Gmail API" > Enable${c.reset}`);
  step(4, `Configure the ${c.bold}OAuth consent screen${c.reset}:`);
  console.log(`         ${c.dim}APIs & Services > OAuth consent screen${c.reset}`);
  console.log(`         ${c.dim}User type: External (or Internal if using Workspace)${c.reset}`);
  console.log(`         ${c.dim}Add your email as a test user if the app is in "Testing" mode.${c.reset}`);
  step(5, `Create ${c.bold}OAuth 2.0 Client ID${c.reset} credentials:`);
  console.log(`         ${c.dim}APIs & Services > Credentials > + Create Credentials > OAuth client ID${c.reset}`);
  console.log(`         ${c.dim}Application type: "Web application"${c.reset}`);
  console.log(`         ${c.dim}Authorized redirect URI: ${c.cyan}${REDIRECT_URI}${c.reset}`);
  step(6, `Copy the ${c.bold}Client ID${c.reset} and ${c.bold}Client Secret${c.reset}.`);
  step(7, `Pass them to this script (see usage below).\n`);

  console.log(`${c.bold}Usage:${c.reset}`);
  console.log(`  ${c.green}npx tsx scripts/setup-gmail-oauth.ts <CLIENT_ID> <CLIENT_SECRET>${c.reset}`);
  console.log(`  ${c.dim}or${c.reset}`);
  console.log(`  ${c.green}GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npx tsx scripts/setup-gmail-oauth.ts${c.reset}\n`);
}

// ---------------------------------------------------------------------------
// Step 2: Resolve credentials from args or environment
// ---------------------------------------------------------------------------
function resolveCredentials(): { clientId: string; clientSecret: string } | null {
  // Priority: CLI args > env vars
  const args = process.argv.slice(2);

  let clientId = args[0] || process.env.GOOGLE_CLIENT_ID || "";
  let clientSecret = args[1] || process.env.GOOGLE_CLIENT_SECRET || "";

  clientId = clientId.trim();
  clientSecret = clientSecret.trim();

  if (!clientId || !clientSecret) {
    return null;
  }

  // Basic validation: Google client IDs end with .apps.googleusercontent.com
  if (!clientId.includes(".apps.googleusercontent.com") && !clientId.includes(".")) {
    warn(
      `Client ID "${clientId.substring(0, 20)}..." does not look like a Google OAuth client ID.`
    );
    warn(`Expected format: xxxx.apps.googleusercontent.com`);
  }

  return { clientId, clientSecret };
}

// ---------------------------------------------------------------------------
// Step 3: Build the Google OAuth authorization URL
// ---------------------------------------------------------------------------
function buildAuthUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // Required to get a refresh_token
    prompt: "consent", // Force consent to ensure refresh_token is returned
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Step 4: Open the URL in the user's default browser (cross-platform)
// ---------------------------------------------------------------------------
function openBrowser(url: string): void {
  const platform = process.platform;
  let command: string;

  if (platform === "darwin") {
    command = `open "${url}"`;
  } else if (platform === "win32") {
    command = `start "" "${url}"`;
  } else {
    // Linux / other
    command = `xdg-open "${url}"`;
  }

  exec(command, (err) => {
    if (err) {
      warn(`Could not open browser automatically.`);
      console.log(`\n${c.bold}Please open this URL manually:${c.reset}`);
      console.log(`${c.cyan}${url}${c.reset}\n`);
    }
  });
}

// ---------------------------------------------------------------------------
// Step 5: Exchange the authorization code for tokens via Google's token endpoint
// ---------------------------------------------------------------------------
function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string
): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}> {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }).toString();

    const tokenUrl = new URL(GOOGLE_TOKEN_URL);

    const options: https.RequestOptions = {
      hostname: tokenUrl.hostname,
      port: 443,
      path: tokenUrl.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let body = "";

      res.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });

      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          if (data.error) {
            reject(
              new Error(
                `Token exchange failed: ${data.error} - ${data.error_description || "unknown"}`
              )
            );
          } else {
            resolve(data);
          }
        } catch (e) {
          reject(new Error(`Failed to parse token response: ${body}`));
        }
      });
    });

    req.on("error", (e) => {
      reject(new Error(`HTTPS request to token endpoint failed: ${e.message}`));
    });

    req.write(postData);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Step 6: Print the final results and Trigger.dev instructions
// ---------------------------------------------------------------------------
function printResults(tokens: {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}): void {
  heading("OAuth Setup Complete");

  if (tokens.refresh_token) {
    success("Refresh token obtained successfully!\n");

    console.log(`${c.bold}${c.bgGreen}${c.white} REFRESH TOKEN ${c.reset}`);
    console.log(`${c.green}${tokens.refresh_token}${c.reset}\n`);

    console.log(`${c.dim}Access token (expires in ${tokens.expires_in}s):${c.reset}`);
    console.log(`${c.dim}${tokens.access_token.substring(0, 40)}...${c.reset}\n`);
  } else {
    warn("No refresh_token was returned.");
    warn("This usually means the user already granted consent previously.");
    warn('Re-run with prompt=consent or revoke access at https://myaccount.google.com/permissions\n');

    if (tokens.access_token) {
      console.log(`${c.dim}Access token (short-lived, expires in ${tokens.expires_in}s):${c.reset}`);
      console.log(`${c.dim}${tokens.access_token.substring(0, 40)}...${c.reset}\n`);
    }
    return;
  }

  heading("Add These to Trigger.dev Environment Variables");

  console.log(`Go to your Trigger.dev project dashboard:\n`);
  console.log(`  ${c.cyan}https://cloud.trigger.dev${c.reset}`);
  console.log(`  ${c.dim}> Your Project > Environment Variables${c.reset}\n`);

  console.log(`Add the following three variables:\n`);

  console.log(
    `  ${c.bold}${c.yellow}GOOGLE_CLIENT_ID${c.reset}      = ${c.dim}<your client ID>${c.reset}`
  );
  console.log(
    `  ${c.bold}${c.yellow}GOOGLE_CLIENT_SECRET${c.reset}  = ${c.dim}<your client secret>${c.reset}`
  );
  console.log(
    `  ${c.bold}${c.yellow}GOOGLE_REFRESH_TOKEN${c.reset}  = ${c.green}${tokens.refresh_token}${c.reset}`
  );

  console.log(`\n${c.dim}Tip: The refresh token does not expire unless revoked or the OAuth`);
  console.log(`consent is removed. The access token is short-lived and will be`);
  console.log(`refreshed automatically using the refresh token in your code.${c.reset}\n`);

  console.log(`${c.bold}Example token refresh code (for reference):${c.reset}`);
  console.log(`${c.dim}  const params = new URLSearchParams({`);
  console.log(`    client_id: process.env.GOOGLE_CLIENT_ID,`);
  console.log(`    client_secret: process.env.GOOGLE_CLIENT_SECRET,`);
  console.log(`    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,`);
  console.log(`    grant_type: "refresh_token",`);
  console.log(`  });`);
  console.log(`  const res = await fetch("https://oauth2.googleapis.com/token", {`);
  console.log(`    method: "POST",`);
  console.log(`    headers: { "Content-Type": "application/x-www-form-urlencoded" },`);
  console.log(`    body: params.toString(),`);
  console.log(`  });`);
  console.log(`  const { access_token } = await res.json();${c.reset}\n`);
}

// ---------------------------------------------------------------------------
// Main: orchestrate the entire flow
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  printSetupInstructions();

  // Resolve credentials
  const creds = resolveCredentials();

  if (!creds) {
    error("Missing GOOGLE_CLIENT_ID and/or GOOGLE_CLIENT_SECRET.");
    console.log(`\n${c.bold}Provide them as arguments:${c.reset}`);
    console.log(
      `  ${c.green}npx tsx scripts/setup-gmail-oauth.ts <CLIENT_ID> <CLIENT_SECRET>${c.reset}\n`
    );
    console.log(`${c.bold}Or as environment variables:${c.reset}`);
    console.log(
      `  ${c.green}GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npx tsx scripts/setup-gmail-oauth.ts${c.reset}\n`
    );
    process.exit(1);
  }

  const { clientId, clientSecret } = creds;

  info(`Client ID: ${clientId.substring(0, 20)}...`);
  info(`Redirect URI: ${REDIRECT_URI}`);
  info(`Scopes: ${SCOPES.join(", ")}\n`);

  // Build the authorization URL
  const authUrl = buildAuthUrl(clientId);

  // Create a promise that resolves when the callback is received
  const tokenPromise = new Promise<void>((resolve, reject) => {
    // Start the local HTTP server to handle the OAuth callback
    const server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url || "/", `http://localhost:${PORT}`);

      // ---------------------------------------------------------------
      // Handle the OAuth callback at /oauth/callback
      // ---------------------------------------------------------------
      if (reqUrl.pathname === "/oauth/callback") {
        const authCode = reqUrl.searchParams.get("code");
        const authError = reqUrl.searchParams.get("error");

        // Handle errors from Google (user denied, etc.)
        if (authError) {
          const errorMsg = `Authorization failed: ${authError}`;
          error(errorMsg);
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(buildHtmlPage("Authorization Failed", errorMsg, false));
          server.close();
          reject(new Error(errorMsg));
          return;
        }

        // No code received
        if (!authCode) {
          const errorMsg = "No authorization code received in the callback.";
          error(errorMsg);
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(buildHtmlPage("Missing Code", errorMsg, false));
          server.close();
          reject(new Error(errorMsg));
          return;
        }

        info("Authorization code received. Exchanging for tokens...");

        try {
          // Exchange the authorization code for tokens
          const tokens = await exchangeCodeForTokens(authCode, clientId, clientSecret);

          // Send a success page to the browser
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            buildHtmlPage(
              "Authorization Successful",
              "You can close this tab and return to the terminal.",
              true
            )
          );

          // Print the results in the terminal
          printResults(tokens);

          // Shut down the server
          server.close();
          resolve();
        } catch (exchangeError: any) {
          error(exchangeError.message);
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          res.end(buildHtmlPage("Token Exchange Failed", exchangeError.message, false));
          server.close();
          reject(exchangeError);
        }
        return;
      }

      // ---------------------------------------------------------------
      // For any other path, show a simple waiting page
      // ---------------------------------------------------------------
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        buildHtmlPage(
          "Gmail OAuth Setup",
          "Waiting for Google authorization... If the browser did not open, check the terminal for the URL.",
          true
        )
      );
    });

    // Handle server errors
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        error(`Port ${PORT} is already in use. Kill the process using it and try again.`);
        error(`  lsof -ti:${PORT} | xargs kill -9`);
      } else {
        error(`Server error: ${err.message}`);
      }
      reject(err);
    });

    // Start listening
    server.listen(PORT, () => {
      success(`Local server listening on http://localhost:${PORT}`);
      info("Opening Google OAuth consent screen in your browser...\n");

      // Open the browser
      openBrowser(authUrl);

      // Also print the URL in case the browser doesn't open
      console.log(`${c.bold}If the browser did not open, visit this URL:${c.reset}`);
      console.log(`${c.cyan}${authUrl}${c.reset}\n`);
      console.log(`${c.dim}Waiting for authorization callback...${c.reset}\n`);
    });

    // Safety timeout: close after 5 minutes if no callback is received
    const timeout = setTimeout(() => {
      warn("Timed out after 5 minutes waiting for the OAuth callback.");
      server.close();
      reject(new Error("Timeout waiting for OAuth callback"));
    }, 5 * 60 * 1000);

    // Clean up the timeout when the server closes
    server.on("close", () => {
      clearTimeout(timeout);
    });
  });

  try {
    await tokenPromise;
    success("Setup complete. You can now use the Gmail API with these credentials.");
    process.exit(0);
  } catch (err: any) {
    error(`Setup failed: ${err.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Helper: build a simple HTML page for browser responses
// ---------------------------------------------------------------------------
function buildHtmlPage(title: string, message: string, isSuccess: boolean): string {
  const bgColor = isSuccess ? "#f0fdf4" : "#fef2f2";
  const borderColor = isSuccess ? "#22c55e" : "#ef4444";
  const textColor = isSuccess ? "#166534" : "#991b1b";
  const icon = isSuccess ? "&#10003;" : "&#10007;";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Gmail OAuth Setup</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #f9fafb;
    }
    .card {
      background: ${bgColor};
      border: 2px solid ${borderColor};
      border-radius: 12px;
      padding: 48px;
      max-width: 480px;
      text-align: center;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
    }
    .icon {
      font-size: 48px;
      color: ${borderColor};
      margin-bottom: 16px;
    }
    h1 {
      color: ${textColor};
      font-size: 24px;
      margin-bottom: 12px;
    }
    p {
      color: #4b5563;
      font-size: 16px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
main();
