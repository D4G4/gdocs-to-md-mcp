/**
 * Interactive setup wizard for gdocs-to-md-mcp.
 *
 * Guides the user step-by-step through:
 * 1. Creating/selecting a GCP project
 * 2. Creating OAuth credentials (with clickable link)
 * 3. Enabling required APIs (with clickable links)
 * 4. Running the OAuth consent flow
 * 5. Verifying everything works
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import readline from "node:readline";
import open from "open";
import { google } from "googleapis";
import { CONFIG_DIR } from "./auth.js";

const execAsync = promisify(exec);

const CREDENTIALS_PATH = path.join(CONFIG_DIR, "credentials.json");
const TOKENS_PATH = path.join(CONFIG_DIR, "tokens.json");

const SCOPES = [
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

const REQUIRED_APIS = [
  { id: "docs.googleapis.com", name: "Google Docs API" },
  { id: "drive.googleapis.com", name: "Google Drive API" },
];

// ── Terminal helpers ───────────────────────────────────────────────

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const LINK = (url: string, label?: string) =>
  `\x1b]8;;${url}\x1b\\${CYAN}${label ?? url}${RESET}\x1b]8;;\x1b\\`;

function step(n: number, total: number, msg: string) {
  console.error(`\n${BOLD}[${n}/${total}]${RESET} ${msg}`);
}

function success(msg: string) {
  console.error(`  ${GREEN}✓${RESET} ${msg}`);
}

function warn(msg: string) {
  console.error(`  ${YELLOW}⚠${RESET} ${msg}`);
}

function fail(msg: string) {
  console.error(`  ${RED}✗${RESET} ${msg}`);
}

function info(msg: string) {
  console.error(`  ${DIM}${msg}${RESET}`);
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  return new Promise((resolve) => {
    rl.question(`  ${question} `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function waitForEnter(msg = "Press Enter to continue...") {
  await ask(msg);
}

// ── GCP project detection ─────────────────────────────────────────

async function detectGcloudProject(): Promise<string | null> {
  try {
    const { stdout } = await execAsync("gcloud config get-value project 2>/dev/null");
    const project = stdout.trim();
    return project && project !== "(unset)" ? project : null;
  } catch {
    return null;
  }
}

async function listGcloudProjects(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      "gcloud projects list --format='value(projectId)' 2>/dev/null"
    );
    return stdout
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readProjectFromCredentials(): string | null {
  if (!fs.existsSync(CREDENTIALS_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
    const creds = raw.installed ?? raw.web;
    return creds?.project_id ?? null;
  } catch {
    return null;
  }
}

// ── API enablement check ──────────────────────────────────────────

async function checkApiEnabled(projectId: string, apiId: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `gcloud services list --project="${projectId}" --filter="config.name=${apiId}" --format="value(config.name)" 2>/dev/null`
    );
    return stdout.trim() === apiId;
  } catch {
    return false;
  }
}

async function enableApi(projectId: string, apiId: string): Promise<boolean> {
  try {
    await execAsync(
      `gcloud services enable ${apiId} --project="${projectId}" 2>/dev/null`
    );
    return true;
  } catch {
    return false;
  }
}

// ── OAuth flow ────────────────────────────────────────────────────

function createOAuth2Client() {
  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const creds = raw.installed ?? raw.web;
  return new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    "http://localhost:3456"
  );
}

async function runOAuthFlow(): Promise<void> {
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
        res.end(
          "<h2>Authenticated! You can close this tab.</h2><script>window.close()</script>"
        );
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
      console.error(`\n  Opening browser...`);
      open(authUrl);
    });
    server.on("error", reject);
  });

  const { tokens } = await oauth2Client.getToken(code);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

// ── Verification ──────────────────────────────────────────────────

async function verify(): Promise<boolean> {
  try {
    const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
    const creds = raw.installed ?? raw.web;
    const oauth2Client = new google.auth.OAuth2(
      creds.client_id,
      creds.client_secret,
      "http://localhost:3456"
    );
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf-8"));
    oauth2Client.setCredentials(tokens);

    const drive = google.drive({ version: "v3", auth: oauth2Client });
    const response = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.document'",
      pageSize: 3,
      fields: "files(id,name)",
      orderBy: "modifiedTime desc",
    });

    const files = response.data.files ?? [];
    if (files.length > 0) {
      console.error(`\n  Found ${files.length} docs:`);
      for (const f of files) {
        console.error(`    - ${f.name}`);
      }
    }
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    fail(`Verification failed: ${message}`);
    return false;
  }
}

// ── Gcloud detection ──────────────────────────────────────────────

async function hasGcloudCli(): Promise<boolean> {
  try {
    await execAsync("which gcloud 2>/dev/null");
    return true;
  } catch {
    return false;
  }
}

// ── Credentials file detection ────────────────────────────────────

function findNewestCredentialsInDownloads(): string | null {
  const downloadsDir = path.join(process.env.HOME ?? ".", "Downloads");
  if (!fs.existsSync(downloadsDir)) return null;
  const files = fs
    .readdirSync(downloadsDir)
    .filter((f) => f.startsWith("client_secret") && f.endsWith(".json"));
  if (files.length === 0) return null;
  const newest = files
    .map((f) => ({
      path: path.join(downloadsDir, f),
      mtime: fs.statSync(path.join(downloadsDir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime)[0];
  return newest.path;
}

// ── Main setup flow ───────────────────────────────────────────────

export async function runSetup() {
  const TOTAL_STEPS = 6;
  const gcloudAvailable = await hasGcloudCli();

  console.error(`\n${BOLD}gdocs-to-md-mcp setup${RESET}`);
  console.error(`${DIM}This will configure Google Docs access for your MCP client.${RESET}`);

  // ── Step 1: GCP project ──

  step(1, TOTAL_STEPS, "Google Cloud project");

  let projectId: string | null = readProjectFromCredentials();

  if (projectId) {
    success(`Found project from existing credentials: ${BOLD}${projectId}${RESET}`);
  } else {
    // Try gcloud to list projects
    if (gcloudAvailable) {
      const defaultProject = await detectGcloudProject();
      const projects = await listGcloudProjects();

      if (projects.length > 0) {
        console.error(`\n  Your GCP projects:`);
        projects.slice(0, 15).forEach((p, i) => {
          const marker = p === defaultProject ? ` ${GREEN}(current)${RESET}` : "";
          console.error(`    ${i + 1}. ${p}${marker}`);
        });
        if (projects.length > 15) {
          console.error(`    ... and ${projects.length - 15} more`);
        }

        const defaultHint = defaultProject ? ` [${defaultProject}]` : "";
        while (!projectId) {
          const choice = await ask(`Pick a project (number or ID)${defaultHint}:`);
          if (!choice && defaultProject) {
            projectId = defaultProject;
          } else if (/^\d+$/.test(choice) && parseInt(choice) >= 1 && parseInt(choice) <= projects.length) {
            projectId = projects[parseInt(choice) - 1];
          } else if (choice) {
            projectId = choice;
          } else {
            warn("Please select a project to continue.");
          }
        }
      } else if (defaultProject) {
        projectId = defaultProject;
      }
    }

    // No gcloud or no projects found — ask manually
    if (!projectId) {
      const consoleUrl = "https://console.cloud.google.com/projectselector2/home/dashboard";
      while (!projectId) {
        const input = await ask("Enter your GCP project ID (or press Enter to open Cloud Console):") || "";
        if (input) {
          projectId = input;
        } else {
          await open(consoleUrl);
          info("Opened Cloud Console — find your project ID and paste it below.");
        }
      }
    }

    success(`Using project: ${BOLD}${projectId}${RESET}`);
  }

  // ── Step 2: OAuth credentials ──

  step(2, TOTAL_STEPS, "OAuth credentials");

  if (fs.existsSync(CREDENTIALS_PATH)) {
    success(`Credentials already exist at ${DIM}${CREDENTIALS_PATH}${RESET}`);
    projectId = readProjectFromCredentials() ?? projectId;
  } else {
    // Direct link to create OAuth client in the selected project
    const createUrl =
      `https://console.cloud.google.com/apis/credentials/oauthclient?project=${projectId}`;

    console.error(`\n  Create an OAuth client for this tool:`);
    console.error(`  ${LINK(createUrl, "→ Create OAuth client (Desktop app)")}`);
    console.error(`\n  Settings:`);
    console.error(`    Application type: ${BOLD}Desktop app${RESET}`);
    console.error(`    Name: ${BOLD}gdocs-to-md-mcp${RESET} (or anything)`);
    console.error(`\n  After creating, click ${BOLD}Download JSON${RESET}.`);

    const openIt = await ask("Open this link in your browser? [Y/n]");
    if (!openIt || openIt.toLowerCase() !== "n") {
      await open(createUrl);
    }

    // Wait for user to download, then find the file
    console.error(`\n  Download the JSON, then either:`);
    console.error(`    a) Press Enter — I'll look in ~/Downloads automatically`);
    console.error(`    b) Paste the file path`);

    let credPath = "";
    while (!credPath) {
      const input = await ask("Path (or Enter to auto-detect):");

      if (!input) {
        // Auto-detect from Downloads
        const found = findNewestCredentialsInDownloads();
        if (found) {
          console.error(`  ${DIM}Found: ${found}${RESET}`);
          const useIt = await ask("Use this file? [Y/n]");
          if (!useIt || useIt.toLowerCase() !== "n") {
            credPath = found;
          } else {
            warn("Enter the path manually.");
          }
        } else {
          warn("No client_secret*.json found in ~/Downloads. Paste the path instead.");
        }
      } else {
        const resolved = input.replace(/^~/, process.env.HOME ?? "");
        if (fs.existsSync(resolved)) {
          credPath = resolved;
        } else {
          warn(`File not found: ${input}`);
        }
      }
    }

    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.copyFileSync(credPath, CREDENTIALS_PATH);
    success(`Saved to ${DIM}${CREDENTIALS_PATH}${RESET}`);
    projectId = readProjectFromCredentials() ?? projectId;
  }

  // ── Step 3: Enable APIs ──

  step(3, TOTAL_STEPS, "Enable required APIs");

  for (const api of REQUIRED_APIS) {
    let enabled = false;

    // Try checking via gcloud
    if (gcloudAvailable) {
      enabled = await checkApiEnabled(projectId, api.id);
    }

    if (enabled) {
      success(`${api.name} — already enabled`);
      continue;
    }

    // Try enabling via gcloud
    if (gcloudAvailable) {
      info(`Enabling ${api.name} via gcloud...`);
      const ok = await enableApi(projectId, api.id);
      if (ok) {
        success(`${api.name} — enabled`);
        continue;
      }
    }

    // Fall back to manual with direct link
    const enableUrl = `https://console.cloud.google.com/apis/library/${api.id}?project=${projectId}`;
    console.error(`  Enable ${BOLD}${api.name}${RESET}:`);
    console.error(`  ${LINK(enableUrl, `→ Enable ${api.name}`)}`);

    const openIt = await ask("Open this link? [Y/n]");
    if (!openIt || openIt.toLowerCase() !== "n") {
      await open(enableUrl);
    }
    await waitForEnter("Press Enter after enabling...");
    success(`${api.name} — enabled (user confirmed)`);
  }

  // ── Step 4: OAuth consent ──

  step(4, TOTAL_STEPS, "Google sign-in");

  if (fs.existsSync(TOKENS_PATH)) {
    const ok = await verify();
    if (ok) {
      success("Already authenticated — tokens are valid");
    } else {
      warn("Existing tokens are invalid, re-authenticating...");
      await runOAuthFlow();
      success("Authentication successful");
    }
  } else {
    console.error(`  Your browser will open for Google sign-in.`);
    console.error(`  ${DIM}Grant read-only access to Docs and Drive.${RESET}`);
    await waitForEnter();
    await runOAuthFlow();
    success("Authentication successful");
  }

  // ── Step 5: Verify ──

  step(5, TOTAL_STEPS, "Verify");

  const ok = await verify();
  if (ok) {
    success("Everything works!");
  } else {
    fail("Verification failed. Run 'gdocs-to-md-mcp setup' again to retry.");
    process.exit(1);
  }

  // ── Step 6: Configure MCP clients ──

  step(6, TOTAL_STEPS, "Configure MCP clients");

  // Detect if running from a local dev checkout vs installed globally/via npx
  const cliPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    "cli.js"
  );
  const isLocalDev = !cliPath.includes("node_modules");
  const mcpEntry = isLocalDev
    ? { command: "node", args: [cliPath] }
    : { command: "npx", args: ["-y", "gdocs-to-md-mcp"] };

  // Claude Code — MCP servers live in ~/.claude.json (top-level mcpServers)
  // Permissions live in ~/.claude/settings.json
  const claudeJsonPath = path.join(process.env.HOME ?? ".", ".claude.json");
  const claudeSettingsPath = path.join(process.env.HOME ?? ".", ".claude", "settings.json");
  let claudeConfigured = false;

  if (fs.existsSync(claudeJsonPath)) {
    try {
      const claudeJson = JSON.parse(fs.readFileSync(claudeJsonPath, "utf-8"));
      if (claudeJson.mcpServers?.gdocs) {
        success("Claude Code — already configured");
        claudeConfigured = true;
      } else {
        const addIt = await ask("Add gdocs-to-md-mcp to Claude Code? [Y/n]");
        if (!addIt || addIt.toLowerCase() !== "n") {
          // Add MCP server to ~/.claude.json
          claudeJson.mcpServers = claudeJson.mcpServers ?? {};
          claudeJson.mcpServers.gdocs = { type: "stdio", ...mcpEntry };
          fs.writeFileSync(claudeJsonPath, JSON.stringify(claudeJson, null, 2) + "\n");
          success("Claude Code — MCP server added");
          info(`Updated ${claudeJsonPath}`);

          // Add permission to ~/.claude/settings.json
          if (fs.existsSync(claudeSettingsPath)) {
            try {
              const settings = JSON.parse(fs.readFileSync(claudeSettingsPath, "utf-8"));
              if (settings.permissions?.allow && Array.isArray(settings.permissions.allow)) {
                if (!settings.permissions.allow.includes("mcp__gdocs__*")) {
                  settings.permissions.allow.push("mcp__gdocs__*");
                  fs.writeFileSync(claudeSettingsPath, JSON.stringify(settings, null, 2) + "\n");
                  success("Claude Code — permissions auto-allowed");
                  info(`Updated ${claudeSettingsPath}`);
                }
              }
            } catch {
              info("Could not update permissions — you may need to allow mcp__gdocs__* manually");
            }
          }

          claudeConfigured = true;
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warn(`Could not update Claude Code config: ${msg}`);
    }
  } else {
    info("Claude Code not found (~/.claude.json missing) — skipping");
  }

  // Cursor — check common config locations
  const cursorConfigPaths = [
    path.join(process.env.HOME ?? ".", ".cursor", "mcp.json"),
    path.join(process.env.HOME ?? ".", "Library", "Application Support", "Cursor", "User", "globalStorage", "mcp.json"),
  ];

  for (const cursorPath of cursorConfigPaths) {
    if (fs.existsSync(cursorPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(cursorPath, "utf-8"));
        if (config.mcpServers?.gdocs || config.gdocs) {
          success(`Cursor — already configured`);
          break;
        }
        const addIt = await ask("Add gdocs-to-md-mcp to Cursor? [Y/n]");
        if (!addIt || addIt.toLowerCase() !== "n") {
          config.mcpServers = config.mcpServers ?? {};
          config.mcpServers.gdocs = mcpEntry;
          fs.writeFileSync(cursorPath, JSON.stringify(config, null, 2) + "\n");
          success("Cursor — configured");
          info(`Updated ${cursorPath}`);
        }
      } catch {
        // Skip if can't parse
      }
      break;
    }
  }

  // ── Done ──

  console.error(`\n${GREEN}${BOLD}Setup complete!${RESET}\n`);

  if (claudeConfigured) {
    console.error(`  Restart Claude Code to pick up the new MCP server.\n`);
  } else {
    console.error(`  Add to your MCP client config manually:\n`);
    console.error(`  ${DIM}{${RESET}`);
    console.error(`    ${DIM}"mcpServers": {${RESET}`);
    console.error(`      ${DIM}"gdocs": {${RESET}`);
    console.error(`        ${DIM}"command": "npx",${RESET}`);
    console.error(`        ${DIM}"args": ["-y", "gdocs-to-md-mcp"]${RESET}`);
    console.error(`      ${DIM}}${RESET}`);
    console.error(`    ${DIM}}${RESET}`);
    console.error(`  ${DIM}}${RESET}\n`);
  }
}
