// src/html/index.ts
//
// renderHtml(): IDM → a single self-contained HTML document (§5.2).
//   - No external requests: images are base64 data URIs, CSS is inlined.
//   - Semantic elements: <article>, <section>, <figure>/<figcaption>,
//     <aside> for callouts.
//   - Consumes the same resolved IDM as the DOCX renderer (R3/R4): no parsing,
//     no vault access, reusing resolved links, transclusions and footnote
//     numbering.

import type { IdmDocument } from "../core/model/document";
import type {
  BlockNode,
  CalloutNode,
  FootnoteDefinitionNode,
  ImageBlockNode,
  InlineImageNode,
  InlineNode,
  LinkNode,
  ListNode,
  MediaResource,
  TableNode,
} from "../core/model/nodes";
import type { ExportOptions } from "../core/options";
import { parseLatex } from "../math/parse";
import { mathmlDocument } from "./math";
import { buildCss } from "./css";

export interface HtmlRenderOptions {
  /** Pro removes the free-tier attribution <meta> (§7.1). */
  pro?: boolean;
  /** Document language for <html lang>. Defaults to "en". */
  lang?: string;
}

const ATTRIBUTION = "TrueExport — quietstack.tools";

export function renderHtml(doc: IdmDocument, options: ExportOptions, render: HtmlRenderOptions = {}): string {
  const lang = render.lang ?? "en";
  const body: string[] = [];

  if (options.frontmatterMode === "table" && Object.keys(doc.frontmatter).length > 0) {
    body.push(renderFrontmatterTable(doc.frontmatter));
  }
  body.push(sectionize(doc.blocks));
  const footnotes = renderFootnotes(doc.footnotes);
  if (footnotes) body.push(footnotes);

  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(doc.title)}</title>`,
    ...metaTags(doc, options),
    render.pro ? "" : `<meta name="generator" content="${ATTRIBUTION}">`,
    `<style>\n${buildCss()}\n</style>`,
  ].filter((line) => line !== "");

  return `<!DOCTYPE html>
<html lang="${escapeAttr(lang)}">
<head>
${head.join("\n")}
</head>
<body>
<article class="trueexport">
${body.join("\n")}
</article>
</body>
</html>
`;
}

// ---- Head metadata ----

function metaTags(doc: IdmDocument, options: ExportOptions): string[] {
  if (options.frontmatterMode !== "metadata") return [];
  const fm = doc.frontmatter;
  const tags: string[] = [];
  if (typeof fm.author === "string") tags.push(`<meta name="author" content="${escapeAttr(fm.author)}">`);
  if (typeof fm.description === "string") tags.push(`<meta name="description" content="${escapeAttr(fm.description)}">`);
  const keywords = Array.isArray(fm.tags) ? fm.tags.map((t) => String(t)).join(", ") : typeof fm.tags === "string" ? fm.tags : "";
  if (keywords) tags.push(`<meta name="keywords" content="${escapeAttr(keywords)}">`);
  return tags;
}

// ---- Sectioning ----

/** Group top-level blocks into <section>s, starting a new one at each heading. */
function sectionize(blocks: BlockNode[]): string {
  const sections: string[] = [];
  let buffer: string[] = [];
  const flush = (): void => {
    if (buffer.length > 0) {
      sections.push(`<section>\n${buffer.join("\n")}\n</section>`);
      buffer = [];
    }
  };
  for (const block of blocks) {
    if (block.type === "heading" && buffer.length > 0) flush();
    buffer.push(renderBlock(block));
  }
  flush();
  return sections.join("\n");
}

// ---- Blocks ----

function renderBlocks(blocks: BlockNode[]): string {
  return blocks.map(renderBlock).join("\n");
}

function renderBlock(block: BlockNode): string {
  switch (block.type) {
    case "heading": {
      const id = block.id ? ` id="${escapeAttr(block.id)}"` : "";
      // dir="auto" lets the browser's bidi algorithm handle RTL text (§4.1).
      return `<h${block.level}${id} dir="auto">${renderInline(block.children)}</h${block.level}>`;
    }
    case "paragraph": {
      const id = block.blockId ? ` id="${escapeAttr(block.blockId)}"` : "";
      return `<p${id} dir="auto">${renderInline(block.children)}</p>`;
    }
    case "list":
      return renderList(block);
    case "table":
      return renderTable(block);
    case "callout":
      return renderCallout(block);
    case "blockquote":
      return `<blockquote>\n${renderBlocks(block.children)}\n</blockquote>`;
    case "codeBlock": {
      const cls = block.language ? ` class="language-${escapeAttr(block.language)}"` : "";
      return `<pre><code${cls}>${escapeHtml(block.content)}</code></pre>`;
    }
    case "thematicBreak":
      return "<hr>";
    case "imageBlock":
      return renderImageBlock(block);
    case "htmlBlock":
      // HTML passes through to HTML (the user's own note content).
      return block.raw;
    case "mathBlock":
      return renderMath(block.latex, true);
    case "unsupported":
      return `<div class="unsupported">${escapeHtml(block.reason)}</div>`;
    default:
      return "";
  }
}

function renderList(list: ListNode): string {
  const tag = list.ordered ? "ol" : "ul";
  const start = list.ordered && list.start !== undefined && list.start !== 1 ? ` start="${list.start}"` : "";
  const items = list.children
    .map((item) => {
      const isTask = item.checked !== undefined;
      const inner = renderItemContent(item.children, list.tight);
      if (isTask) {
        const checked = item.checked ? " checked" : "";
        return `<li class="task"><input type="checkbox" disabled${checked}> ${inner}</li>`;
      }
      return `<li>${inner}</li>`;
    })
    .join("\n");
  return `<${tag}${start}>\n${items}\n</${tag}>`;
}

/** In a tight list a lone paragraph renders inline (no <p>); else render blocks. */
function renderItemContent(blocks: BlockNode[], tight: boolean): string {
  if (tight) {
    return blocks
      .map((b) => (b.type === "paragraph" ? renderInline(b.children) : renderBlock(b)))
      .join("\n");
  }
  return renderBlocks(blocks);
}

function renderTable(table: TableNode): string {
  const alignStyle = (i: number): string => {
    const a = table.alignments[i];
    return a ? ` style="text-align:${a}"` : "";
  };
  const headCells = table.header.cells
    .map((c, i) => `<th${alignStyle(i)}>${renderInline(c.children)}</th>`)
    .join("");
  const bodyRows = table.rows
    .map((row) => {
      const cells = row.cells.map((c, i) => `<td${alignStyle(i)}>${renderInline(c.children)}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("\n");
  return `<table>\n<thead><tr>${headCells}</tr></thead>\n<tbody>\n${bodyRows}\n</tbody>\n</table>`;
}

function renderCallout(callout: CalloutNode): string {
  const typeClass = `callout-${escapeAttr(callout.calloutType.replace(/[^\w-]/g, "-"))}`;
  const title = `<div class="callout-title">${renderInline(callout.title)}</div>`;
  const body = renderBlocks(callout.children);
  return `<aside class="callout ${typeClass}">\n${title}\n${body}\n</aside>`;
}

function renderImageBlock(block: ImageBlockNode): string {
  const src = dataUri(block.resource);
  if (src === null) {
    return `<figure><span class="img-missing">${escapeHtml(placeholder(block.resource))}</span></figure>`;
  }
  const caption = block.caption ? `\n<figcaption>${renderInline(block.caption)}</figcaption>` : "";
  const dims = sizeAttrs(block.width, block.height);
  return `<figure><img src="${src}" alt="${escapeAttr(block.alt)}"${dims}>${caption}</figure>`;
}

// ---- Inline ----

function renderInline(nodes: InlineNode[]): string {
  return nodes.map(renderInlineNode).join("");
}

/** MathML when the LaTeX converts; otherwise raw LaTeX in monospace (§4.10). */
function renderMath(latex: string, block: boolean): string {
  try {
    const ast = parseLatex(latex);
    const mathml = mathmlDocument(ast, latex, block);
    return block ? `<div class="math-block">${mathml}</div>` : mathml;
  } catch {
    const code = `<code class="math-fallback" data-latex="${escapeAttr(latex)}">${escapeHtml(latex)}</code>`;
    return block ? `<div class="math-block">${code}</div>` : code;
  }
}

function renderInlineNode(node: InlineNode): string {
  switch (node.type) {
    case "text":
      return escapeHtml(node.value);
    case "emphasis":
      return `<em>${renderInline(node.children)}</em>`;
    case "strong":
      return `<strong>${renderInline(node.children)}</strong>`;
    case "strikethrough":
      return `<del>${renderInline(node.children)}</del>`;
    case "highlight":
      return `<mark>${renderInline(node.children)}</mark>`;
    case "subscript":
      return `<sub>${renderInline(node.children)}</sub>`;
    case "superscript":
      return `<sup>${renderInline(node.children)}</sup>`;
    case "inlineCode":
      return `<code>${escapeHtml(node.value)}</code>`;
    case "link":
      return renderLink(node);
    case "inlineImage":
      return renderInlineImage(node);
    case "footnoteReference":
      if (node.assignedNumber === undefined) return "";
      return `<sup class="footnote-ref" id="fnref-${node.assignedNumber}"><a href="#fn-${node.assignedNumber}">${node.assignedNumber}</a></sup>`;
    case "lineBreak":
      return node.hard ? "<br>\n" : "\n";
    case "mathInline":
      return renderMath(node.latex, false);
    default:
      return "";
  }
}

function renderLink(node: LinkNode): string {
  const inner = renderInline(node.children);
  const t = node.target;
  if (t.kind === "external") {
    return `<a href="${escapeAttr(t.url)}" rel="noopener noreferrer">${inner}</a>`;
  }
  if (t.kind === "anchor") {
    return `<a href="#${escapeAttr(sanitizeAnchor(t.id))}">${inner}</a>`;
  }
  const anchor = t.blockId ?? t.heading ?? t.notePath;
  return `<a href="#${escapeAttr(sanitizeAnchor(anchor))}">${inner}</a>`;
}

function renderInlineImage(node: InlineImageNode): string {
  const src = dataUri(node.resource);
  if (src === null) return `<span class="img-missing">${escapeHtml(placeholder(node.resource))}</span>`;
  const dims = sizeAttrs(node.width, node.height);
  return `<img class="inline" src="${src}" alt="${escapeAttr(node.alt)}"${dims}>`;
}

// ---- Footnotes (§5.2: a <section> with bidirectional links) ----

function renderFootnotes(footnotes: Map<string, FootnoteDefinitionNode>): string {
  const defs = [...footnotes.values()]
    .filter((d) => d.assignedNumber !== undefined)
    .sort((a, b) => (a.assignedNumber as number) - (b.assignedNumber as number));
  if (defs.length === 0) return "";

  const items = defs
    .map((def) => {
      const n = def.assignedNumber as number;
      const content = renderBlocks(def.children);
      const back = ` <a href="#fnref-${n}" class="footnote-back" aria-label="Back to reference">↩</a>`;
      return `<li id="fn-${n}">${content}${back}</li>`;
    })
    .join("\n");
  return `<section class="footnotes">\n<hr>\n<ol>\n${items}\n</ol>\n</section>`;
}

// ---- Frontmatter table (§4.12) ----

function renderFrontmatterTable(frontmatter: Record<string, unknown>): string {
  const stringify = (v: unknown): string => {
    if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
    if (v !== null && typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  const rows = Object.entries(frontmatter)
    .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(stringify(v))}</td></tr>`)
    .join("\n");
  return `<table class="frontmatter">\n<tbody>\n${rows}\n</tbody>\n</table>`;
}

// ---- Media / helpers ----

function dataUri(resource: MediaResource): string | null {
  if (resource.kind !== "binary" || !resource.data) return null;
  const mime = resource.mimeType ?? "application/octet-stream";
  return `data:${mime};base64,${toBase64(resource.data)}`;
}

function placeholder(resource: MediaResource): string {
  const name = resource.originalPath.slice(resource.originalPath.lastIndexOf("/") + 1);
  if (resource.kind === "remote-blocked") return `[Remote image not embedded: ${name}]`;
  return `[Image not found: ${name}]`;
}

function sizeAttrs(width?: number, height?: number): string {
  let out = "";
  if (width !== undefined) out += ` width="${width}"`;
  if (height !== undefined) out += ` height="${height}"`;
  return out;
}

/** Base64 without Node's Buffer (mobile-safe), via btoa over a binary string. */
function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function sanitizeAnchor(id: string): string {
  return id.replace(/[^\w-]/g, "-");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}
