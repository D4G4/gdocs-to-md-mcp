# gdocs-to-md-mcp

MCP server that reads Google Docs as clean markdown. Works with Claude Code, Cursor, Windsurf, or any MCP client.

## Why markdown, not JSON?

Google's [Workspace CLI](https://github.com/googleworkspace/cli) returns raw API JSON — a 500-line nested tree of `StructuralElement` objects where bold text is `textStyle.bold: true` buried inside a `TextRun` object. Your LLM can parse it. But it shouldn't have to.

Research backs this up:

- **[Up to 40% performance variance](https://arxiv.org/html/2411.10541v1)** depending on whether input is plain text, Markdown, JSON, or YAML
- **[60.7% table accuracy](https://www.improvingagents.com/blog/best-input-data-format-for-llms/)** with Markdown-KV — 16 points ahead of JSON alternatives
- **[10-15% fewer tokens](https://community.openai.com/t/markdown-is-15-more-token-efficient-than-json/841742)** than JSON for the same content
- [Anthropic](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices), [OpenAI](https://developers.openai.com/api/docs/guides/prompt-engineering), and [Google](https://ai.google.dev/gemini-api/docs/prompting-strategies) all recommend markdown for document input

JSON is great when agents need to *act* on structured data. Markdown is better when they need to *read and understand* content. This tool does the conversion so your LLM gets the format it actually comprehends.

## Quick start

```bash
npx gdocs-to-md-mcp setup
```

The interactive setup wizard will:
1. Help you pick a GCP project (lists yours if you have `gcloud`)
2. Walk you through creating OAuth credentials (opens the right page)
3. Enable the required APIs (auto-enables via `gcloud` or gives you the link)
4. Run the Google sign-in flow
5. Verify everything works
6. Auto-configure Claude Code / Cursor

That's it. One command.

## Manual setup

If you prefer to set things up manually:

### 1. Auth

**Option A — OAuth credentials (recommended):**

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create **OAuth 2.0 Client ID** → type: **Desktop app**
3. Download JSON → save as `~/.gdocs-to-md-mcp/credentials.json`
4. Enable **Google Docs API** and **Google Drive API**
5. Run: `npx gdocs-to-md-mcp auth`

**Option B — gcloud ADC:**

```bash
gcloud auth application-default login \
  --scopes="https://www.googleapis.com/auth/documents.readonly,https://www.googleapis.com/auth/drive.readonly,https://www.googleapis.com/auth/cloud-platform"
```

### 2. Add to your MCP client

**Claude Code** — add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "gdocs": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "gdocs-to-md-mcp"]
    }
  }
}
```

**Cursor / Windsurf** — add to your MCP config:

```json
{
  "gdocs": {
    "command": "npx",
    "args": ["-y", "gdocs-to-md-mcp"]
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `read_google_doc` | Fetch a Google Doc by URL or ID → markdown |
| `search_google_docs` | Search Drive for docs matching a query |
| `list_recent_docs` | List recently modified Google Docs |

## Usage

Just paste a Google Docs URL in your prompt:

> Read this doc: https://docs.google.com/document/d/1abc.../edit

The MCP client will call `read_google_doc` and get the full document as clean markdown with headings, lists, tables, links, and inline formatting preserved.

## What it converts

- Headings (H1-H6)
- Bold, italic, strikethrough
- Ordered and unordered lists (nested)
- Tables
- Links
- Inline code (monospace fonts)
- Horizontal rules
- Document metadata (optional)

## CLI

```bash
gdocs-to-md-mcp              # Start MCP server (stdio)
gdocs-to-md-mcp setup        # Interactive setup wizard
gdocs-to-md-mcp auth         # OAuth flow only
gdocs-to-md-mcp test         # Verify auth works
gdocs-to-md-mcp --help       # Show help
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `GDOCS_MCP_CONFIG_DIR` | Override config directory (default: `~/.gdocs-to-md-mcp`) |

## License

MIT
