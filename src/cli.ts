#!/usr/bin/env node

/**
 * gdocs-to-md-mcp CLI entry point.
 *
 * Usage:
 *   gdocs-to-md-mcp          — start MCP server (stdio transport)
 *   gdocs-to-md-mcp setup    — interactive setup wizard (recommended for first run)
 *   gdocs-to-md-mcp auth     — run OAuth flow only
 *   gdocs-to-md-mcp test     — verify auth works
 *   gdocs-to-md-mcp --help   — show help
 */

import { authenticateInteractive } from "./auth.js";

const command = process.argv[2];

async function main() {
  switch (command) {
    case "setup": {
      const { runSetup } = await import("./setup.js");
      await runSetup();
      break;
    }

    case "auth":
      await authenticateInteractive();
      break;

    case "test": {
      const { runTest } = await import("./test.js");
      await runTest();
      break;
    }

    case "--help":
    case "-h":
      printHelp();
      break;

    case undefined:
    case "serve":
      // Default: start MCP server
      const { startServer } = await import("./server.js");
      await startServer();
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.error(`gdocs-to-md-mcp — MCP server that reads Google Docs as markdown

Usage:
  gdocs-to-md-mcp              Start MCP server (stdio transport)
  gdocs-to-md-mcp setup        Interactive setup wizard (start here)
  gdocs-to-md-mcp auth         Run OAuth flow only
  gdocs-to-md-mcp test         Verify auth works
  gdocs-to-md-mcp --help       Show this help

Quick start:
  $ npx gdocs-to-md-mcp setup

MCP config (add to your MCP client):
  {
    "mcpServers": {
      "gdocs": {
        "command": "npx",
        "args": ["-y", "gdocs-to-md-mcp"]
      }
    }
  }
`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
