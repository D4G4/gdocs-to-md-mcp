import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { google } from "googleapis";
import { z } from "zod";
import { getAuthClient } from "./auth.js";
import { docToMarkdown } from "./converter.js";

function extractDocId(urlOrId: string): string {
  // Full URL: https://docs.google.com/document/d/DOC_ID/edit...
  const urlMatch = urlOrId.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];

  // Drive URL: https://drive.google.com/file/d/FILE_ID/...
  const driveMatch = urlOrId.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch) return driveMatch[1];

  // Open URL: https://docs.google.com/open?id=DOC_ID
  const openMatch = urlOrId.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (openMatch) return openMatch[1];

  // Assume it's a raw ID
  return urlOrId.trim();
}

export async function startServer() {
  const authClient = await getAuthClient();
  const auth = authClient as any; // googleapis accepts various auth client types
  const docs = google.docs({ version: "v1", auth });
  const drive = google.drive({ version: "v3", auth });

  const server = new McpServer({
    name: "gdocs-to-md-mcp",
    version: "1.0.0",
  });

  server.tool(
    "read_google_doc",
    "Fetch a Google Doc by URL or document ID and return it as markdown. " +
      "Accepts full Google Docs URLs or just the document ID.",
    {
      url_or_id: z
        .string()
        .describe("Google Docs URL or document ID"),
      include_metadata: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include document metadata (title, last modified, owner) at the top"),
    },
    async ({ url_or_id, include_metadata }) => {
      const docId = extractDocId(url_or_id);

      try {
        const docResponse = await docs.documents.get({ documentId: docId });
        const doc = docResponse.data;
        let markdown = docToMarkdown(doc);

        if (include_metadata) {
          // Fetch Drive metadata for last modified, owner
          try {
            const fileMeta = await drive.files.get({
              fileId: docId,
              fields: "name,modifiedTime,owners,lastModifyingUser",
            });
            const meta = fileMeta.data;
            const header = [
              `> **Title:** ${meta.name ?? doc.title ?? "Untitled"}`,
              meta.modifiedTime
                ? `> **Last modified:** ${meta.modifiedTime}`
                : null,
              meta.lastModifyingUser?.displayName
                ? `> **Last modified by:** ${meta.lastModifyingUser.displayName}`
                : null,
              meta.owners?.[0]?.displayName
                ? `> **Owner:** ${meta.owners[0].displayName}`
                : null,
              "",
            ]
              .filter(Boolean)
              .join("\n");
            markdown = header + "\n" + markdown;
          } catch {
            // Drive metadata is optional, proceed without it
          }
        }

        return {
          content: [{ type: "text" as const, text: markdown }],
        };
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unknown error";
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching document ${docId}: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "search_google_docs",
    "Search Google Drive for Google Docs matching a query. Returns document names, IDs, and URLs.",
    {
      query: z.string().describe("Search query (Drive search syntax supported)"),
      max_results: z
        .number()
        .optional()
        .default(10)
        .describe("Maximum number of results (default 10)"),
    },
    async ({ query, max_results }) => {
      try {
        const response = await drive.files.list({
          q: `mimeType='application/vnd.google-apps.document' and fullText contains '${query.replace(/'/g, "\\'")}'`,
          pageSize: max_results,
          fields: "files(id,name,modifiedTime,owners,webViewLink)",
          orderBy: "modifiedTime desc",
        });

        const files = response.data.files ?? [];
        if (files.length === 0) {
          return {
            content: [
              { type: "text" as const, text: "No documents found." },
            ],
          };
        }

        const lines = files.map((f, i) => {
          const owner = f.owners?.[0]?.displayName ?? "unknown";
          return `${i + 1}. **${f.name}**\n   - ID: \`${f.id}\`\n   - URL: ${f.webViewLink}\n   - Modified: ${f.modifiedTime}\n   - Owner: ${owner}`;
        });

        return {
          content: [
            { type: "text" as const, text: lines.join("\n\n") },
          ],
        };
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unknown error";
        return {
          content: [
            { type: "text" as const, text: `Search error: ${message}` },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "list_recent_docs",
    "List recently modified Google Docs from your Drive.",
    {
      max_results: z
        .number()
        .optional()
        .default(20)
        .describe("Maximum number of results (default 20)"),
      owned_by_me: z
        .boolean()
        .optional()
        .default(false)
        .describe("Only show documents owned by you"),
    },
    async ({ max_results, owned_by_me }) => {
      try {
        let q = "mimeType='application/vnd.google-apps.document'";
        if (owned_by_me) q += " and 'me' in owners";

        const response = await drive.files.list({
          q,
          pageSize: max_results,
          fields: "files(id,name,modifiedTime,owners,webViewLink)",
          orderBy: "modifiedTime desc",
        });

        const files = response.data.files ?? [];
        if (files.length === 0) {
          return {
            content: [
              { type: "text" as const, text: "No documents found." },
            ],
          };
        }

        const lines = files.map((f, i) => {
          const owner = f.owners?.[0]?.displayName ?? "unknown";
          return `${i + 1}. **${f.name}**\n   - ID: \`${f.id}\`\n   - URL: ${f.webViewLink}\n   - Modified: ${f.modifiedTime}\n   - Owner: ${owner}`;
        });

        return {
          content: [
            { type: "text" as const, text: lines.join("\n\n") },
          ],
        };
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unknown error";
        return {
          content: [
            { type: "text" as const, text: `Error: ${message}` },
          ],
          isError: true,
        };
      }
    }
  );

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("gdocs-to-md-mcp server running on stdio");
}

