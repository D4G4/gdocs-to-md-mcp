/**
 * Google authentication — supports two methods:
 *
 * 1. Application Default Credentials (ADC) via gcloud — zero config
 *    $ gcloud auth application-default login --scopes=...
 *
 * 2. OAuth2 client credentials — for users without gcloud
 *    Save credentials.json to ~/.gdocs-to-md-mcp/credentials.json
 *    Run: gdocs-to-md-mcp auth
 */

import { google, type Auth } from "googleapis";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import open from "open";

export const CONFIG_DIR = path.join(
  process.env.GDOCS_MCP_CONFIG_DIR ??
    path.join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".gdocs-to-md-mcp")
);
const CREDENTIALS_PATH = path.join(CONFIG_DIR, "credentials.json");
const TOKENS_PATH = path.join(CONFIG_DIR, "tokens.json");

const SCOPES = [
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

// ── ADC (gcloud) ──────────────────────────────────────────────────

async function tryADC(): Promise<Auth.BaseExternalAccountClient | Auth.GoogleAuth | null> {
  try {
    const auth = new google.auth.GoogleAuth({ scopes: SCOPES });
    // Force a credential fetch to verify ADC is configured
    await auth.getClient();
    return auth;
  } catch {
    return null;
  }
}

// ── OAuth2 (credentials.json) ─────────────────────────────────────

interface OAuthCredentials {
  installed?: { client_id: string; client_secret: string };
  web?: { client_id: string; client_secret: string };
}

function hasOAuthCredentials(): boolean {
  return fs.existsSync(CREDENTIALS_PATH);
}

function createOAuth2Client() {
  const raw: OAuthCredentials = JSON.parse(
    fs.readFileSync(CREDENTIALS_PATH, "utf-8")
  );
  const creds = raw.installed ?? raw.web;
  if (!creds) {
    throw new Error("Invalid credentials.json — expected 'installed' or 'web' key");
  }
  return new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    "http://localhost:3456"
  );
}

function hasCachedTokens(): boolean {
  return fs.existsSync(TOKENS_PATH);
}

async function loadCachedOAuth(): Promise<InstanceType<typeof google.auth.OAuth2> | null> {
  if (!hasOAuthCredentials() || !hasCachedTokens()) return null;
  try {
    const client = createOAuth2Client();
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf-8"));
    client.setCredentials(tokens);

    // Refresh if expired
    if (tokens.expiry_date && Date.now() > tokens.expiry_date - 60_000) {
      const { credentials } = await client.refreshAccessToken();
      client.setCredentials(credentials);
      fs.writeFileSync(TOKENS_PATH, JSON.stringify(credentials, null, 2));
    }
    return client;
  } catch {
    return null;
  }
}

/**
 * Interactive OAuth2 flow — opens browser, catches redirect on localhost:3456.
 * Called by `gdocs-to-md-mcp auth`.
 */
export async function authenticateInteractive(): Promise<void> {
  if (!hasOAuthCredentials()) {
    throw new Error(
      `No credentials file found at ${CREDENTIALS_PATH}\n\n` +
        "To set up OAuth:\n" +
        "  1. Go to https://console.cloud.google.com/apis/credentials\n" +
        "  2. Create OAuth 2.0 Client ID → type: Desktop app\n" +
        "  3. Download JSON → save as:\n" +
        `     ${CREDENTIALS_PATH}\n` +
        "  4. Enable Google Docs API and Google Drive API\n" +
        "  5. Run: gdocs-to-md-mcp auth"
    );
  }

  const oauth2Client = createOAuth2Client();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "", "http://localhost:3456");
      const authCode = url.searchParams.get("code");
      if (authCode) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h2>Authenticated! You can close this tab.</h2><script>window.close()</script>");
        server.close();
        resolve(authCode);
      } else {
        res.writeHead(400);
        res.end("No code in redirect");
        server.close();
        reject(new Error("No auth code received"));
      }
    });
    server.listen(3456, () => {
      console.error("Opening browser for Google OAuth...");
      open(authUrl);
    });
    server.on("error", reject);
  });

  const { tokens } = await oauth2Client.getToken(code);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
  console.error(`Tokens saved to ${TOKENS_PATH}`);
  console.error("Authentication successful!");
}

// ── Main entry point ──────────────────────────────────────────────

/**
 * Returns an authenticated client. Tries in order:
 * 1. Cached OAuth tokens (from `gdocs-to-md-mcp auth`)
 * 2. Application Default Credentials (gcloud)
 * 3. Fails with setup instructions
 */
export async function getAuthClient(): Promise<any> {
  // Try cached OAuth first (fastest, most explicit)
  const oauth = await loadCachedOAuth();
  if (oauth) return oauth;

  // Try ADC (gcloud)
  const adc = await tryADC();
  if (adc) return adc;

  // Nothing works
  throw new Error(
    "No Google credentials found. Set up auth using one of:\n\n" +
      "Option A — gcloud (easiest if you have it):\n" +
      "  $ gcloud auth application-default login \\\n" +
      `    --scopes="${SCOPES.join(",")}"\n\n` +
      "Option B — OAuth credentials:\n" +
      "  1. Download OAuth client credentials from Google Cloud Console\n" +
      `  2. Save as ${CREDENTIALS_PATH}\n` +
      "  3. Run: gdocs-to-md-mcp auth"
  );
}
