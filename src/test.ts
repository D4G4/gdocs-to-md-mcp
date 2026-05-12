/**
 * Quick auth verification — lists 5 recent Google Docs.
 */

import { google } from "googleapis";
import { getAuthClient } from "./auth.js";

export async function runTest() {
  console.error("Verifying authentication...\n");

  const auth = await getAuthClient();
  const drive = google.drive({ version: "v3", auth });

  const response = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.document'",
    pageSize: 5,
    fields: "files(id,name,modifiedTime,webViewLink)",
    orderBy: "modifiedTime desc",
  });

  const files = response.data.files ?? [];
  if (files.length === 0) {
    console.error("Auth works but no Google Docs found in your Drive.");
    return;
  }

  console.error("Auth works! Recent docs:\n");
  for (const f of files) {
    console.error(`  ${f.name}`);
    console.error(`    ${f.webViewLink}`);
    console.error(`    Modified: ${f.modifiedTime}\n`);
  }
}
