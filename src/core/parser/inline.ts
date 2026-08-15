// src/core/parser/inline.ts
//
// Inline parsing: a single line of Markdown text → InlineNode[].
//
// Covers standard Markdown (text, emphasis/strong/strikethrough, inline code,
// links, autolinks, images) plus Obsidian inline syntax added in Stage 3:
// wikilinks `[[...]]`, transclusions `![[...]]`, highlights `==x==`, footnote
// references `[^id]`, inline footnotes `^[...]`, and `<sub>`/`<sup>`.
//
// R1: pure. Wikilinks and embeds are recognised here but NOT resolved — that
// needs the vault and happens in the resolver. Crucially, a recognised wikilink
// or embed is always turned into a real IDM node; raw `[[` / `![[` never leaks
// into the output (§4.2, the top failure mode).
//
// Line breaks are the caller's responsibility (the block layer inserts them);
// a line handed here never contains a newline.

import type {
  FootnoteDefinitionNode,
  InlineImageNode,
  InlineNode,
  LinkNode,
  MediaResource,
  TextNode,
} from "../model/nodes";
import { slugify } from "../util/slug";

/**
 * State threaded through inline parsing so footnotes can be collected. When
 * absent (e.g. Stage 2 callers), footnote syntax is left as literal text.
 */
export interface InlineContext {
  footnotes: Map<string, FootnoteDefinitionNode>;
  counter: { inline: number };
}

const ASCII_PUNCT = new Set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~".split(""));
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"]);

function isPunct(ch: string): boolean {
  return ch.length === 1 && ASCII_PUNCT.has(ch);
}

function isWhitespace(ch: string): boolean {
  return ch === "" || /\s/.test(ch);
}

function isImagePath(path: string): boolean {
  const clean = path.split("|")[0].split("#")[0].trim();
  const dot = clean.lastIndexOf(".");
  return dot !== -1 && IMAGE_EXTENSIONS.has(clean.slice(dot + 1).toLowerCase());
}

function basename(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  return dot === -1 ? file : file.slice(0, dot);
}

// ---- Chunk model used between scanning and emphasis resolution ----

type DelimChar = "*" | "_" | "~" | "=";

type Chunk =
  | { kind: "text"; value: string }
  | { kind: "node"; node: InlineNode }
  | { kind: "delim"; char: DelimChar; count: number; canOpen: boolean; canClose: boolean };

/** Flatten plain inline text out of a node tree — used for heading slugs etc. */
export function toPlainText(nodes: InlineNode[]): string {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
      case "inlineCode":
        out += node.value;
        break;
      case "emphasis":
      case "strong":
      case "strikethrough":
      case "highlight":
      case "subscript":
      case "superscript":
      case "link":
        out += toPlainText(node.children);
        break;
      case "mathInline":
        out += node.latex;
        break;
      default:
        break;
    }
  }
  return out;
}

export function parseInline(text: string, ctx?: InlineContext): InlineNode[] {
  const chunks = scan(text, ctx);
  resolveEmphasis(chunks);
  return chunksToNodes(chunks);
}

// ---- Scanning: raw text → chunks ----

function scan(text: string, ctx?: InlineContext): Chunk[] {
  const chunks: Chunk[] = [];

  const pushText = (value: string): void => {
    if (value === "") return;
    const last = chunks[chunks.length - 1];
    if (last && last.kind === "text") last.value += value;
    else chunks.push({ kind: "text", value });
  };
  const pushNode = (node: InlineNode): void => {
    chunks.push({ kind: "node", node });
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i];

    // Backslash escape of ASCII punctuation → literal character.
    if (c === "\\" && i + 1 < text.length && isPunct(text[i + 1])) {
      pushText(text[i + 1]);
      i += 2;
      continue;
    }

    // Inline code span.
    if (c === "`") {
      const code = matchCodeSpan(text, i);
      if (code) {
        pushNode({ type: "inlineCode", value: code.value });
        i = code.end;
        continue;
      }
      pushText("`");
      i += 1;
      continue;
    }

    // Inline math $…$ (no space after the opening $, matching Obsidian; §4.10).
    if (c === "$") {
      const math = matchInlineMath(text, i);
      if (math) {
        pushNode({ type: "mathInline", latex: math.latex });
        i = math.end;
        continue;
      }
      pushText("$");
      i += 1;
      continue;
    }

    // Transclusion ![[ ... ]] before image ![alt](dest).
    if (c === "!" && text[i + 1] === "[" && text[i + 2] === "[") {
      const wiki = matchWiki(text, i + 1);
      if (wiki) {
        pushNode(buildEmbed(wiki.inner, ctx));
        i = wiki.end;
        continue;
      }
    }

    // Inline image ![alt](dest).
    if (c === "!" && text[i + 1] === "[") {
      const link = matchLink(text, i + 1);
      if (link) {
        pushNode(makeImage(link.inner, link.dest));
        i = link.end;
        continue;
      }
      pushText("!");
      i += 1;
      continue;
    }

    // Wikilink [[ ... ]] before footnote ref and normal link.
    if (c === "[" && text[i + 1] === "[") {
      const wiki = matchWiki(text, i);
      if (wiki) {
        pushNode(buildWikilink(wiki.inner));
        i = wiki.end;
        continue;
      }
    }

    // Footnote reference [^id].
    if (c === "[" && text[i + 1] === "^" && ctx) {
      const m = text.slice(i).match(/^\[\^([^\]\s]+)\]/);
      if (m) {
        pushNode({ type: "footnoteReference", identifier: m[1] });
        i += m[0].length;
        continue;
      }
    }

    // Inline link [text](dest).
    if (c === "[") {
      const link = matchLink(text, i);
      if (link) {
        pushNode(makeLink(link.inner, link.dest, ctx));
        i = link.end;
        continue;
      }
      pushText("[");
      i += 1;
      continue;
    }

    // Inline footnote ^[text].
    if (c === "^" && text[i + 1] === "[" && ctx) {
      const inner = matchBracket(text, i + 1);
      if (inner) {
        pushNode(makeInlineFootnote(inner.value, ctx));
        i = inner.end;
        continue;
      }
    }

    // <sub> / <sup>, then autolink <url>.
    if (c === "<") {
      const sub = matchHtmlPair(text, i, "sub");
      if (sub) {
        pushNode({ type: "subscript", children: parseInline(sub.inner, ctx) });
        i = sub.end;
        continue;
      }
      const sup = matchHtmlPair(text, i, "sup");
      if (sup) {
        pushNode({ type: "superscript", children: parseInline(sup.inner, ctx) });
        i = sup.end;
        continue;
      }
      const auto = matchAutolink(text, i);
      if (auto) {
        pushNode(auto.node);
        i = auto.end;
        continue;
      }
      pushText("<");
      i += 1;
      continue;
    }

    // Emphasis / strong delimiters.
    if (c === "*" || c === "_") {
      let n = 0;
      while (text[i + n] === c) n++;
      chunks.push(makeDelim(c, n, text, i, i + n));
      i += n;
      continue;
    }

    // Strikethrough ~~ and highlight == use double delimiters only.
    if (c === "~" && text[i + 1] === "~") {
      chunks.push(makeDelim("~", 2, text, i, i + 2));
      i += 2;
      continue;
    }
    if (c === "=" && text[i + 1] === "=") {
      chunks.push(makeDelim("=", 2, text, i, i + 2));
      i += 2;
      continue;
    }

    pushText(c);
    i += 1;
  }

  return chunks;
}

function makeDelim(
  char: DelimChar,
  count: number,
  text: string,
  start: number,
  end: number,
): Chunk {
  const before = start > 0 ? text[start - 1] : "";
  const after = end < text.length ? text[end] : "";

  const leftFlanking =
    !isWhitespace(after) && (!isPunct(after) || isWhitespace(before) || isPunct(before));
  const rightFlanking =
    !isWhitespace(before) && (!isPunct(before) || isWhitespace(after) || isPunct(after));

  let canOpen = leftFlanking;
  let canClose = rightFlanking;
  if (char === "_") {
    canOpen = leftFlanking && (!rightFlanking || isPunct(before));
    canClose = rightFlanking && (!leftFlanking || isPunct(after));
  }

  return { kind: "delim", char, count, canOpen, canClose };
}

/** Match `$…$` inline math starting at the opening `$`. */
function matchInlineMath(text: string, start: number): { latex: string; end: number } | null {
  const next = text[start + 1];
  // Obsidian: no space right after the opening $, and $$ is block-level.
  if (next === undefined || next === " " || next === "$") return null;
  let i = start + 1;
  let latex = "";
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length) {
      latex += ch + text[i + 1];
      i += 2;
      continue;
    }
    if (ch === "$") return { latex, end: i + 1 };
    latex += ch;
    i += 1;
  }
  return null;
}

function matchCodeSpan(text: string, start: number): { value: string; end: number } | null {
  let n = 0;
  while (text[start + n] === "`") n++;
  const fence = "`".repeat(n);
  const close = text.indexOf(fence, start + n);
  if (close === -1) return null;
  let value = text.slice(start + n, close).replace(/\s+/g, " ");
  if (value.length > 2 && value.startsWith(" ") && value.endsWith(" ") && value.trim() !== "") {
    value = value.slice(1, -1);
  }
  return { value, end: close + n };
}

/** Match a `<tag>…</tag>` pair, returning inner text. */
function matchHtmlPair(
  text: string,
  start: number,
  tag: string,
): { inner: string; end: number } | null {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  if (text.slice(start, start + open.length).toLowerCase() !== open) return null;
  const contentStart = start + open.length;
  const closeIdx = text.toLowerCase().indexOf(close, contentStart);
  if (closeIdx === -1) return null;
  return { inner: text.slice(contentStart, closeIdx), end: closeIdx + close.length };
}

function matchAutolink(text: string, start: number): { node: LinkNode; end: number } | null {
  const m = text.slice(start).match(/^<((?:https?|mailto):[^>\s]+|[^>\s@]+@[^>\s]+\.[^>\s]+)>/);
  if (!m) return null;
  const raw = m[1];
  const url = raw.includes("@") && !raw.includes(":") ? `mailto:${raw}` : raw;
  return {
    node: {
      type: "link",
      target: { kind: "external", url },
      children: [{ type: "text", value: raw }],
    },
    end: start + m[0].length,
  };
}

/** Match `[[ inner ]]` starting at the first `[`. */
function matchWiki(text: string, start: number): { inner: string; end: number } | null {
  if (text[start] !== "[" || text[start + 1] !== "[") return null;
  const close = text.indexOf("]]", start + 2);
  if (close === -1) return null;
  return { inner: text.slice(start + 2, close), end: close + 2 };
}

/** Match a balanced `[ ... ]` starting at the opening bracket. */
function matchBracket(text: string, start: number): { value: string; end: number } | null {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return { value: text.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;
}

/** Parse a `[inner](dest)` starting at the opening bracket. */
function matchLink(
  text: string,
  start: number,
): { inner: string; dest: string; end: number } | null {
  let depth = 0;
  let i = start;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i += 1;
      continue;
    }
    if (c === "`") {
      const m = text.slice(i).match(/^(`+)/);
      const n = m ? m[1].length : 0;
      const close = text.indexOf("`".repeat(n), i + n);
      if (n > 0 && close !== -1) {
        i = close + n - 1;
        continue;
      }
    }
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (i >= text.length || text[i] !== "]" || text[i + 1] !== "(") return null;

  const inner = text.slice(start + 1, i);
  let j = i + 2;
  while (j < text.length && text[j] === " ") j++;

  let dest = "";
  if (text[j] === "<") {
    const e = text.indexOf(">", j + 1);
    if (e === -1) return null;
    dest = text.slice(j + 1, e);
    j = e + 1;
  } else {
    let paren = 0;
    while (j < text.length) {
      const c = text[j];
      if (c === "\\") {
        dest += text[j + 1] ?? "";
        j += 2;
        continue;
      }
      if (c === " " || c === "\t") break;
      if (c === "(") {
        paren++;
        dest += c;
        j++;
        continue;
      }
      if (c === ")") {
        if (paren === 0) break;
        paren--;
        dest += c;
        j++;
        continue;
      }
      dest += c;
      j++;
    }
  }

  while (j < text.length && (text[j] === " " || text[j] === "\t")) j++;
  if (text[j] === '"' || text[j] === "'" || text[j] === "(") {
    const close = text[j] === "(" ? ")" : text[j];
    const e = text.indexOf(close, j + 1);
    if (e === -1) return null;
    j = e + 1;
    while (j < text.length && (text[j] === " " || text[j] === "\t")) j++;
  }
  if (text[j] !== ")") return null;

  return { inner, dest, end: j + 1 };
}

function makeLink(inner: string, dest: string, ctx?: InlineContext): LinkNode {
  return {
    type: "link",
    target: { kind: "external", url: dest },
    children: parseInline(inner, ctx),
  };
}

function makeInlineFootnote(inner: string, ctx: InlineContext): InlineNode {
  ctx.counter.inline += 1;
  const identifier = `inline-${ctx.counter.inline}`;
  ctx.footnotes.set(identifier, {
    type: "footnoteDefinition",
    identifier,
    children: [{ type: "paragraph", children: parseInline(inner, ctx) }],
  });
  return { type: "footnoteReference", identifier };
}

// ---- Wikilinks and embeds ----

interface WikiTarget {
  notePath: string;
  heading?: string;
  blockId?: string;
  alias?: string;
  sameNote: boolean;
}

function parseWikiTarget(inner: string): WikiTarget {
  const pipe = inner.indexOf("|");
  const linkPart = pipe === -1 ? inner : inner.slice(0, pipe);
  const alias = pipe === -1 ? undefined : inner.slice(pipe + 1).trim();

  const hash = linkPart.indexOf("#");
  const notePath = (hash === -1 ? linkPart : linkPart.slice(0, hash)).trim();
  const sub = hash === -1 ? "" : linkPart.slice(hash + 1).trim();

  const target: WikiTarget = { notePath, sameNote: notePath === "" };
  if (alias) target.alias = alias;
  if (sub.startsWith("^")) target.blockId = sub.slice(1);
  else if (sub !== "") target.heading = sub;
  return target;
}

function wikiDisplay(t: WikiTarget): string {
  if (t.alias) return t.alias;
  if (t.sameNote) return t.heading ?? (t.blockId ? `^${t.blockId}` : "");
  return basename(t.notePath);
}

function buildWikilink(inner: string): LinkNode {
  const t = parseWikiTarget(inner);
  const children: InlineNode[] = [{ type: "text", value: wikiDisplay(t) }];

  if (t.sameNote) {
    const id = t.heading ? slugify(t.heading) : (t.blockId ?? "");
    return { type: "link", target: { kind: "anchor", id }, children };
  }

  const target: Extract<LinkNode["target"], { kind: "internal" }> = {
    kind: "internal",
    notePath: t.notePath,
    resolved: false,
  };
  if (t.heading) target.heading = t.heading;
  if (t.blockId) target.blockId = t.blockId;
  return { type: "link", target, children };
}

function buildEmbed(inner: string, ctx?: InlineContext): InlineNode {
  const pipe = inner.indexOf("|");
  const targetPart = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
  const suffix = pipe === -1 ? "" : inner.slice(pipe + 1).trim();

  if (isImagePath(targetPart)) {
    const node: InlineImageNode = {
      type: "inlineImage",
      resource: unresolvedMedia(targetPart),
      alt: basename(targetPart),
    };
    const size = suffix.match(/^(\d+)(?:x(\d+))?$/);
    if (size) {
      node.width = Number(size[1]);
      if (size[2]) node.height = Number(size[2]);
    }
    return node;
  }

  // Note embed: a valid IDM link the resolver either splices (block-level) or
  // resolves as a plain link (inline). Never a raw ![[...]].
  const t = parseWikiTarget(inner);
  const children: InlineNode[] = [{ type: "text", value: wikiDisplay(t) }];
  const target: Extract<LinkNode["target"], { kind: "internal" }> = {
    kind: "internal",
    notePath: t.notePath,
    resolved: false,
    embed: true,
  };
  if (t.heading) target.heading = t.heading;
  if (t.blockId) target.blockId = t.blockId;
  return { type: "link", target, children };
}

// ---- Images ----

function unresolvedMedia(path: string): MediaResource {
  return { kind: "missing", originalPath: path };
}

function makeImage(alt: string, dest: string): InlineImageNode {
  const size = parseImageSize(alt);
  const node: InlineImageNode = {
    type: "inlineImage",
    resource: unresolvedMedia(dest),
    alt: size.alt,
  };
  if (size.width !== undefined) node.width = size.width;
  if (size.height !== undefined) node.height = size.height;
  return node;
}

export function parseImageSize(alt: string): { alt: string; width?: number; height?: number } {
  const pipe = alt.lastIndexOf("|");
  let sizePart: string | null = null;
  let label = alt;
  if (pipe !== -1) {
    sizePart = alt.slice(pipe + 1).trim();
    label = alt.slice(0, pipe);
  } else if (/^\d+(x\d+)?$/.test(alt.trim())) {
    sizePart = alt.trim();
    label = "";
  }

  if (sizePart && /^\d+(x\d+)?$/.test(sizePart)) {
    const [w, h] = sizePart.split("x");
    const result: { alt: string; width?: number; height?: number } = { alt: label, width: Number(w) };
    if (h !== undefined) result.height = Number(h);
    return result;
  }
  return { alt };
}

// ---- Emphasis resolution (delimiter stack) ----

function resolveEmphasis(chunks: Chunk[]): void {
  let closerIdx = 0;
  while (closerIdx < chunks.length) {
    const closer = chunks[closerIdx];
    if (closer.kind !== "delim" || !closer.canClose) {
      closerIdx++;
      continue;
    }

    let openerIdx = -1;
    for (let k = closerIdx - 1; k >= 0; k--) {
      const o = chunks[k];
      if (o.kind === "delim" && o.canOpen && o.char === closer.char) {
        openerIdx = k;
        break;
      }
    }
    if (openerIdx === -1) {
      closerIdx++;
      continue;
    }

    const opener = chunks[openerIdx] as Extract<Chunk, { kind: "delim" }>;
    const take = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
    const inner = chunks.slice(openerIdx + 1, closerIdx);
    const children = chunksToNodes(inner);

    let node: InlineNode;
    if (closer.char === "~") node = { type: "strikethrough", children };
    else if (closer.char === "=") node = { type: "highlight", children };
    else if (take === 2) node = { type: "strong", children };
    else node = { type: "emphasis", children };

    opener.count -= take;
    closer.count -= take;

    const replacement: Chunk[] = [{ kind: "node", node }];
    if (closer.count > 0) replacement.push(closer);
    chunks.splice(openerIdx + 1, closerIdx - openerIdx, ...replacement);

    if (opener.count === 0) chunks.splice(openerIdx, 1);

    closerIdx = Math.max(openerIdx, 0);
  }
}

function chunksToNodes(chunks: Chunk[]): InlineNode[] {
  const out: InlineNode[] = [];
  let buffer = "";
  const flush = (): void => {
    if (buffer !== "") {
      out.push({ type: "text", value: buffer } as TextNode);
      buffer = "";
    }
  };
  for (const ch of chunks) {
    if (ch.kind === "text") buffer += ch.value;
    else if (ch.kind === "delim") buffer += ch.char.repeat(ch.count);
    else {
      flush();
      out.push(ch.node);
    }
  }
  flush();
  return out;
}
