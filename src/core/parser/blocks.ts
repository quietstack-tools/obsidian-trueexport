// src/core/parser/blocks.ts
//
// Block-level parsing: lines → BlockNode[]. Container blocks (blockquotes,
// callouts, list items) extract their inner lines and recurse, which keeps
// nesting and tight/loose handling local.
//
// Stage 3 adds callouts (blockquotes opening with `[!type]`), footnote
// definition collection, and block-reference ids (`^id`). Wikilinks and embeds
// are handled by the inline scanner; footnote *numbering* and transclusion
// *resolution* are the resolver's job.

import type {
  BlockNode,
  BlockquoteNode,
  CodeBlockNode,
  HeadingNode,
  ImageBlockNode,
  ListItemNode,
  ListNode,
  ParagraphNode,
  UnsupportedNode,
} from "../model/nodes";
import type { WarningConstruct, WarningCollector } from "../warnings";
import type { ExportOptions } from "../options";
import { SlugRegistry } from "../util/slug";
import { parseInline, toPlainText, type InlineContext } from "./inline";
import { isTableStart, parseTable } from "./table";
import { matchCalloutHeader, buildCallout } from "./callout";
import { matchFootnoteDefinition, collectDefinitionBody } from "./footnote";

export interface ParseContext {
  options: ExportOptions;
  warnings: WarningCollector;
  slugs: SlugRegistry;
  sourcePath: string;
  inline: InlineContext;
}

export interface Line {
  text: string;
  /** 1-based source line number. */
  number: number;
}

/** Machine keys + user-facing remedies for constructs we cannot export (§4.13). */
export const UNSUPPORTED_MESSAGES: Record<string, string> = {
  dataview:
    "Dataview queries cannot be exported. TrueExport exports note content, not query results.",
  bases: "Obsidian Bases cannot be exported.",
  excalidraw:
    "Excalidraw drawings are not supported. Export the drawing as PNG and embed the image.",
  tasks: "Tasks queries cannot be exported.",
  templater: "Unprocessed Templater syntax found. Run the template before exporting.",
};

export function makeUnsupported(
  construct: WarningConstruct,
  raw: string,
  line: number,
  ctx: ParseContext,
): UnsupportedNode {
  const reason = UNSUPPORTED_MESSAGES[construct] ?? "This construct cannot be exported.";
  ctx.warnings.add({ construct, message: reason, line, sourcePath: ctx.sourcePath });
  return { type: "unsupported", reason, raw, construct, position: { line } };
}

function isBlank(text: string): boolean {
  return text.trim() === "";
}

function leadingSpaces(text: string): number {
  const m = text.match(/^ */);
  return m ? m[0].length : 0;
}

interface Marker {
  ordered: boolean;
  indent: number;
  markerWidth: number;
  start?: number;
  task?: boolean;
  checked?: boolean;
  content: string;
}

function matchMarker(text: string): Marker | null {
  const bullet = text.match(/^( *)([-*+])( +)(.*)$/);
  if (bullet) {
    return buildMarker(false, bullet[1].length, bullet[0].length - bullet[4].length, undefined, bullet[4]);
  }
  const ordered = text.match(/^( *)(\d{1,9})([.)])( +)(.*)$/);
  if (ordered) {
    const width = ordered[0].length - ordered[5].length;
    return buildMarker(true, ordered[1].length, width, Number(ordered[2]), ordered[5]);
  }
  return null;
}

function buildMarker(
  ordered: boolean,
  indent: number,
  markerWidth: number,
  start: number | undefined,
  content: string,
): Marker {
  const marker: Marker = { ordered, indent, markerWidth, content };
  if (start !== undefined) marker.start = start;
  const task = content.match(/^\[([ xX])\]\s+(.*)$/);
  if (task) {
    marker.task = true;
    marker.checked = task[1].toLowerCase() === "x";
    marker.content = task[2];
  }
  return marker;
}

/** A whole-line `^blockid`, used to tag the preceding block. */
function matchBlockId(text: string): string | null {
  const m = text.match(/^ {0,3}\^([a-zA-Z0-9_-]+) *$/);
  return m ? m[1] : null;
}

export function parseBlocks(lines: Line[], ctx: ParseContext): BlockNode[] {
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line.text)) {
      i++;
      continue;
    }

    // Footnote definition — collected into the map, never emitted (§4.5.3).
    const def = matchFootnoteDefinition(line.text);
    if (def) {
      const texts = lines.map((l) => l.text);
      const { content, consumed } = collectDefinitionBody(texts, i, def.first);
      const contentLines: Line[] = content
        .split("\n")
        .map((text, idx) => ({ text, number: line.number + idx }));
      ctx.inline.footnotes.set(def.identifier, {
        type: "footnoteDefinition",
        identifier: def.identifier,
        children: parseBlocks(contentLines, ctx),
        position: { line: line.number },
      });
      i += consumed;
      continue;
    }

    // A lone `^blockid` tags the previous block.
    const blockId = matchBlockId(line.text);
    if (blockId && blocks.length > 0) {
      blocks[blocks.length - 1].blockId = blockId;
      i++;
      continue;
    }

    const fence = tryFencedCode(lines, i, ctx);
    if (fence) {
      blocks.push(fence.node);
      i += fence.consumed;
      continue;
    }

    if (/^ {0,3}\$\$/.test(line.text)) {
      const math = parseMathBlock(lines, i);
      blocks.push(math.node);
      i += math.consumed;
      continue;
    }

    if (isThematicBreak(line.text)) {
      blocks.push({ type: "thematicBreak", position: { line: line.number } });
      i++;
      continue;
    }

    const heading = tryHeading(line, ctx);
    if (heading) {
      blocks.push(heading);
      i++;
      continue;
    }

    if (/^ {0,3}>/.test(line.text)) {
      const quote = parseBlockquote(lines, i, ctx);
      blocks.push(quote.node);
      i += quote.consumed;
      continue;
    }

    const html = tryHtmlBlock(lines, i);
    if (html) {
      blocks.push({ type: "htmlBlock", raw: html.raw, position: { line: line.number } });
      i += html.consumed;
      continue;
    }

    if (isTableStart(line.text, lines[i + 1]?.text)) {
      const table = parseTable(lines.map((l) => l.text), i, line.number, ctx.inline);
      blocks.push(table.node);
      i += table.consumed;
      continue;
    }

    if (matchMarker(line.text)) {
      const list = parseList(lines, i, ctx);
      blocks.push(list.node);
      i += list.consumed;
      continue;
    }

    const para = collectParagraph(lines, i, ctx);
    blocks.push(...para.nodes);
    i += para.consumed;
  }

  return blocks;
}

// ---- Fenced code ----

function tryFencedCode(
  lines: Line[],
  start: number,
  ctx: ParseContext,
): { node: BlockNode; consumed: number } | null {
  const open = lines[start].text.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
  if (!open) return null;
  const indent = open[1].length;
  const fenceChar = open[2][0];
  const fenceLen = open[2].length;
  const info = open[3].trim();
  const language = info.split(/\s+/)[0] || "";

  const contentLines: string[] = [];
  let i = start + 1;
  for (; i < lines.length; i++) {
    const t = lines[i].text;
    const closeMatch = t.match(/^( {0,3})(`{3,}|~{3,})\s*$/);
    if (closeMatch && closeMatch[2][0] === fenceChar && closeMatch[2].length >= fenceLen) {
      i++;
      break;
    }
    contentLines.push(indent > 0 ? t.replace(new RegExp(`^ {0,${indent}}`), "") : t);
  }
  const consumed = i - start;
  const content = contentLines.join("\n");
  const raw = lines.slice(start, i).map((l) => l.text).join("\n");
  const lang = language.toLowerCase();
  const startLine = lines[start].number;

  if (lang === "dataview" || lang === "dataviewjs") {
    return { node: makeUnsupported("dataview", raw, startLine, ctx), consumed };
  }
  if (lang === "base") {
    return { node: makeUnsupported("bases", raw, startLine, ctx), consumed };
  }
  if (lang === "tasks") {
    return { node: makeUnsupported("tasks", raw, startLine, ctx), consumed };
  }

  const node: CodeBlockNode = {
    type: "codeBlock",
    language: language === "" ? null : language,
    content,
    position: { line: startLine },
  };
  return { node, consumed };
}

// ---- Block math ($$…$$) ----

function parseMathBlock(lines: Line[], start: number): { node: BlockNode; consumed: number } {
  const startLine = lines[start].number;
  const first = lines[start].text.replace(/^ {0,3}/, "");
  const afterOpen = first.slice(2);

  // Single line: $$ … $$
  const closeIdx = afterOpen.indexOf("$$");
  if (closeIdx !== -1) {
    return {
      node: { type: "mathBlock", latex: afterOpen.slice(0, closeIdx).trim(), position: { line: startLine } },
      consumed: 1,
    };
  }

  // Multi-line: $$ then lines until a line containing $$.
  const content: string[] = [];
  if (afterOpen.trim() !== "") content.push(afterOpen);
  let i = start + 1;
  for (; i < lines.length; i++) {
    const t = lines[i].text;
    const idx = t.indexOf("$$");
    if (idx !== -1) {
      if (t.slice(0, idx).trim() !== "") content.push(t.slice(0, idx));
      i++;
      break;
    }
    content.push(t);
  }
  return {
    node: { type: "mathBlock", latex: content.join("\n").trim(), position: { line: startLine } },
    consumed: i - start,
  };
}

// ---- Thematic break ----

function isThematicBreak(text: string): boolean {
  return /^ {0,3}([-*_])( *\1){2,} *$/.test(text);
}

// ---- Headings ----

function tryHeading(line: Line, ctx: ParseContext): HeadingNode | null {
  const m = line.text.match(/^ {0,3}(#{1,6})(?: +(.*?))?(?: +#+)? *$/);
  if (!m) return null;
  const level = m[1].length as 1 | 2 | 3 | 4 | 5 | 6;
  const text = (m[2] ?? "").trim();
  const children = parseInline(text, ctx.inline);
  const id = ctx.slugs.unique(toPlainText(children));
  return { type: "heading", level, children, id, position: { line: line.number } };
}

// ---- Blockquotes and callouts ----

function parseBlockquote(
  lines: Line[],
  start: number,
  ctx: ParseContext,
): { node: BlockNode; consumed: number } {
  const inner: Line[] = [];
  let i = start;
  for (; i < lines.length; i++) {
    const t = lines[i].text;
    if (!/^ {0,3}>/.test(t)) break;
    inner.push({ text: t.replace(/^ {0,3}> ?/, ""), number: lines[i].number });
  }
  const consumed = i - start;
  const startLine = lines[start].number;

  const head = inner.length > 0 ? matchCalloutHeader(inner[0].text) : null;
  if (head) {
    const body = parseBlocks(inner.slice(1), ctx);
    const node = buildCallout(head, (t) => parseInline(t, ctx.inline), body, startLine);
    return { node, consumed };
  }

  const node: BlockquoteNode = {
    type: "blockquote",
    children: parseBlocks(inner, ctx),
    position: { line: startLine },
  };
  return { node, consumed };
}

// ---- HTML blocks (minimal) ----

const BLOCK_HTML_TAGS = new Set([
  "address", "article", "aside", "blockquote", "canvas", "dd", "details",
  "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "iframe", "li", "main",
  "nav", "ol", "p", "pre", "section", "summary", "table", "tbody", "td",
  "tfoot", "th", "thead", "tr", "ul", "video", "audio",
]);

function tryHtmlBlock(lines: Line[], start: number): { raw: string; consumed: number } | null {
  const text = lines[start].text;
  const comment = /^ {0,3}<!--/.test(text);
  const tagMatch = text.match(/^ {0,3}<\/?([a-zA-Z][a-zA-Z0-9-]*)/);
  const isBlockTag = tagMatch && BLOCK_HTML_TAGS.has(tagMatch[1].toLowerCase());
  if (!comment && !isBlockTag) return null;

  const collected: string[] = [];
  let i = start;
  for (; i < lines.length; i++) {
    if (isBlank(lines[i].text)) break;
    collected.push(lines[i].text);
    if (comment && lines[i].text.includes("-->")) {
      i++;
      break;
    }
  }
  return { raw: collected.join("\n"), consumed: i - start };
}

// ---- Lists ----

function parseList(
  lines: Line[],
  start: number,
  ctx: ParseContext,
): { node: ListNode; consumed: number } {
  const first = matchMarker(lines[start].text) as Marker;
  const ordered = first.ordered;
  const markerIndent = first.indent;
  const items: ListItemNode[] = [];
  let loose = false;
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line.text)) {
      i++;
      continue;
    }
    const marker = matchMarker(line.text);
    if (!marker || marker.indent !== markerIndent || marker.ordered !== ordered) {
      break;
    }

    const contentIndent = marker.indent + marker.markerWidth;
    const itemLines: Line[] = [];
    if (marker.content !== "") {
      itemLines.push({ text: marker.content, number: line.number });
    }
    i++;

    while (i < lines.length) {
      const l = lines[i];
      if (isBlank(l.text)) {
        let j = i;
        while (j < lines.length && isBlank(lines[j].text)) j++;
        if (j >= lines.length) {
          i = j;
          break;
        }
        const nextIndent = leadingSpaces(lines[j].text);
        const nextMarker = matchMarker(lines[j].text);
        const nextIsSibling =
          nextMarker && nextMarker.indent === markerIndent && nextMarker.ordered === ordered;
        if (nextIndent >= contentIndent) {
          loose = true;
          for (let k = i; k < j; k++) itemLines.push({ text: "", number: lines[k].number });
          i = j;
          continue;
        }
        if (nextIsSibling) loose = true;
        i = j;
        break;
      }
      if (leadingSpaces(l.text) >= contentIndent) {
        itemLines.push({ text: l.text.slice(contentIndent), number: l.number });
        i++;
      } else {
        break;
      }
    }

    const children = parseBlocks(itemLines, ctx);
    const item: ListItemNode = { type: "listItem", children, position: { line: line.number } };
    if (marker.task) item.checked = marker.checked ?? false;
    items.push(item);
  }

  const node: ListNode = {
    type: "list",
    ordered,
    tight: !loose,
    children: items,
    position: { line: lines[start].number },
  };
  if (ordered && first.start !== undefined && first.start !== 1) node.start = first.start;
  return { node, consumed: i - start };
}

// ---- Paragraphs (and paragraph-level unsupported constructs) ----

function startsBlock(text: string, next: string | undefined): boolean {
  if (isBlank(text)) return true;
  if (/^ {0,3}(`{3,}|~{3,})/.test(text)) return true;
  if (isThematicBreak(text)) return true;
  if (/^ {0,3}#{1,6}(?: |$)/.test(text)) return true;
  if (/^ {0,3}\$\$/.test(text)) return true;
  if (/^ {0,3}>/.test(text)) return true;
  if (matchMarker(text)) return true;
  if (matchBlockId(text) !== null) return true;
  if (matchFootnoteDefinition(text) !== null) return true;
  if (isTableStart(text, next)) return true;
  return false;
}

function collectParagraph(
  lines: Line[],
  start: number,
  ctx: ParseContext,
): { nodes: BlockNode[]; consumed: number } {
  const plines: Line[] = [lines[start]];
  let i = start + 1;
  for (; i < lines.length; i++) {
    if (startsBlock(lines[i].text, lines[i + 1]?.text)) break;
    plines.push(lines[i]);
  }
  const consumed = i - start;

  const joined = plines.map((l) => l.text).join("\n");
  if (joined.includes("<%")) {
    return {
      nodes: [makeUnsupported("templater", joined, plines[0].number, ctx)],
      consumed,
    };
  }

  return { nodes: buildParagraph(plines, ctx), consumed };
}

function buildParagraph(plines: Line[], ctx: ParseContext): BlockNode[] {
  // A trailing `^blockid` on the final line tags this block.
  let trailingBlockId: string | undefined;
  const lastRaw = plines[plines.length - 1].text;
  const trailing = lastRaw.match(/^(.*\S)\s+\^([a-zA-Z0-9_-]+)\s*$/);
  if (trailing) {
    trailingBlockId = trailing[2];
    plines[plines.length - 1] = {
      text: trailing[1],
      number: plines[plines.length - 1].number,
    };
  }

  // Single line: parse the inlines exactly once (parsing has side effects —
  // inline footnotes register definitions — so a second parse would duplicate
  // them). A standalone image becomes a block image.
  if (plines.length === 1) {
    const inline = parseInline(plines[0].text.trim(), ctx.inline);
    if (inline.length === 1 && inline[0].type === "inlineImage") {
      const img = inline[0];
      const block: ImageBlockNode = {
        type: "imageBlock",
        resource: img.resource,
        alt: img.alt,
        position: { line: plines[0].number },
      };
      if (img.width !== undefined) block.width = img.width;
      if (img.height !== undefined) block.height = img.height;
      if (trailingBlockId) block.blockId = trailingBlockId;
      return [block];
    }
    const single: ParagraphNode = {
      type: "paragraph",
      children: inline,
      position: { line: plines[0].number },
    };
    if (trailingBlockId) single.blockId = trailingBlockId;
    return [single];
  }

  const children = [];
  for (let k = 0; k < plines.length; k++) {
    const raw = plines[k].text;
    let hard = / {2,}$/.test(raw);
    let t = raw.replace(/[ \t]+$/, "");
    if (t.endsWith("\\")) {
      hard = true;
      t = t.slice(0, -1);
    }
    children.push(...parseInline(t.trim(), ctx.inline));
    if (k < plines.length - 1) children.push({ type: "lineBreak" as const, hard });
  }

  const node: ParagraphNode = {
    type: "paragraph",
    children,
    position: { line: plines[0].number },
  };
  if (trailingBlockId) node.blockId = trailingBlockId;
  return [node];
}
