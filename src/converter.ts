/**
 * Converts Google Docs API structured content to Markdown.
 * Handles paragraphs, headings, lists, tables, links, inline formatting.
 */

import type { docs_v1 } from "googleapis";

type Doc = docs_v1.Schema$Document;
type StructuralElement = docs_v1.Schema$StructuralElement;
type ParagraphElement = docs_v1.Schema$ParagraphElement;
type TextRun = docs_v1.Schema$TextRun;
type Table = docs_v1.Schema$Table;
type TableRow = docs_v1.Schema$TableRow;
type TableCell = docs_v1.Schema$TableCell;
type List = docs_v1.Schema$List;
type NestingLevel = docs_v1.Schema$NestingLevel;

export function docToMarkdown(doc: Doc): string {
  const lists = doc.lists ?? {};
  const parts: string[] = [];

  if (doc.title) {
    parts.push(`# ${doc.title}\n`);
  }

  if (doc.body?.content) {
    for (const el of doc.body.content) {
      parts.push(convertStructuralElement(el, lists));
    }
  }

  return parts.join("").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function convertStructuralElement(
  el: StructuralElement,
  lists: Record<string, List>
): string {
  if (el.paragraph) {
    return convertParagraph(el, lists);
  }
  if (el.table) {
    return convertTable(el.table);
  }
  if (el.sectionBreak) {
    return "\n---\n\n";
  }
  if (el.tableOfContents) {
    return ""; // skip TOC
  }
  return "";
}

function convertParagraph(
  el: StructuralElement,
  lists: Record<string, List>
): string {
  const para = el.paragraph!;
  const style = para.paragraphStyle?.namedStyleType ?? "";
  const text = (para.elements ?? []).map(convertParagraphElement).join("");

  // Skip empty paragraphs
  if (!text.trim()) return "\n";

  // Headings
  const headingMatch = style.match(/^HEADING_(\d)$/);
  if (headingMatch) {
    const level = parseInt(headingMatch[1], 10);
    const prefix = "#".repeat(level);
    return `${prefix} ${text.trim()}\n\n`;
  }

  // Lists
  if (para.bullet) {
    const listId = para.bullet.listId ?? "";
    const nestingLevel = para.bullet.nestingLevel ?? 0;
    const indent = "  ".repeat(nestingLevel);
    const listProps = lists[listId];
    const nesting: NestingLevel | undefined =
      listProps?.listProperties?.nestingLevels?.[nestingLevel];

    // Ordered if glyph type looks numeric
    const glyphType = nesting?.glyphType ?? "";
    const isOrdered =
      glyphType === "DECIMAL" ||
      glyphType === "ALPHA" ||
      glyphType === "ROMAN" ||
      glyphType.includes("NUMBER");

    const bullet = isOrdered ? "1." : "-";
    return `${indent}${bullet} ${text.trim()}\n`;
  }

  return `${text}\n\n`;
}

function convertParagraphElement(el: ParagraphElement): string {
  if (el.textRun) {
    return convertTextRun(el.textRun);
  }
  if (el.inlineObjectElement) {
    const id = el.inlineObjectElement.inlineObjectId ?? "";
    return `[image: ${id}]`;
  }
  if (el.horizontalRule) {
    return "\n---\n";
  }
  return "";
}

function convertTextRun(run: TextRun): string {
  let text = run.content ?? "";
  if (!text || text === "\n") return text;

  const style = run.textStyle;
  if (!style) return text;

  // Links
  if (style.link?.url) {
    const trimmed = text.trim();
    if (trimmed) {
      text = text.replace(trimmed, `[${trimmed}](${style.link.url})`);
    }
  }

  // Bold
  if (style.bold) {
    const trimmed = text.trim();
    if (trimmed) {
      text = text.replace(trimmed, `**${trimmed}**`);
    }
  }

  // Italic
  if (style.italic) {
    const trimmed = text.trim();
    if (trimmed) {
      text = text.replace(trimmed, `*${trimmed}*`);
    }
  }

  // Strikethrough
  if (style.strikethrough) {
    const trimmed = text.trim();
    if (trimmed) {
      text = text.replace(trimmed, `~~${trimmed}~~`);
    }
  }

  // Code (monospace font)
  if (
    style.weightedFontFamily?.fontFamily &&
    /mono|courier|consolas/i.test(style.weightedFontFamily.fontFamily)
  ) {
    const trimmed = text.trim();
    if (trimmed) {
      text = text.replace(trimmed, `\`${trimmed}\``);
    }
  }

  return text;
}

function convertTable(table: Table): string {
  const rows = table.tableRows ?? [];
  if (rows.length === 0) return "";

  const matrix = rows.map((row: TableRow) =>
    (row.tableCells ?? []).map((cell: TableCell) => {
      const cellText = (cell.content ?? [])
        .map((el: StructuralElement) => {
          if (el.paragraph) {
            return (el.paragraph.elements ?? [])
              .map(convertParagraphElement)
              .join("")
              .trim();
          }
          return "";
        })
        .join(" ")
        .trim();
      return cellText;
    })
  );

  if (matrix.length === 0) return "";

  const lines: string[] = [];

  // Header row
  lines.push("| " + matrix[0].join(" | ") + " |");
  lines.push("| " + matrix[0].map(() => "---").join(" | ") + " |");

  // Data rows
  for (let i = 1; i < matrix.length; i++) {
    lines.push("| " + matrix[i].join(" | ") + " |");
  }

  return lines.join("\n") + "\n\n";
}
