// src/core/parser/inline.ts
//
// Inline parsing: a single line of Markdown text → InlineNode[].
//
// Stage 2 scope (standard Markdown): text, emphasis, strong, strikethrough,
// inline code, external links, autolinks, inline images (with Obsidian-style
// size hints in the alt text), and backslash escapes. Obsidian-specific inline
// syntax (wikilinks, highlights, math, footnote refs, sub/superscript) arrives
// in Stage 3.
//
// Line breaks are the caller's responsibility: the block layer knows where
// source lines were joined, so it inserts LineBreakNodes. A line handed here
// never contains a newline.

import type {
  InlineImageNode,
  InlineNode,
  LinkNode,
  MediaResource,
  TextNode,
} from "../model/nodes";

const ASCII_PUNCT = new Set(
  "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~".split(""),
);

function isPunct(ch: string): boolean {
  return ch.length === 1 && ASCII_PUNCT.has(ch);
}

function isWhitespace(ch: string): boolean {
  return ch === "" || /\s/.test(ch);
}

// ---- Chunk model used between scanning and emphasis resolution ----

type Chunk =
  | { kind: "text"; value: string }
  | { kind: "node"; node: InlineNode }
  | {
      kind: "delim";
      char: "*" | "_" | "~";
      count: number;
      canOpen: boolean;
      canClose: boolean;
    };

/** Flatten plain inline text out of a node tree — used for heading slugs. */
export function toPlainText(nodes: InlineNode[]): string {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out += node.value;
        break;
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
      // images, footnote refs and line breaks contribute no heading text
      default:
        break;
    }
  }
  return out;
}

export function parseInline(text: string): InlineNode[] {
  const chunks = scan(text);
  resolveEmphasis(chunks);
  return chunksToNodes(chunks);
}

// ---- Scanning: raw text → chunks ----

function scan(text: string): Chunk[] {
  const chunks: Chunk[] = [];

  const pushText = (value: string): void => {
    if (value === "") return;
    const last = chunks[chunks.length - 1];
    if (last && last.kind === "text") last.value += value;
    else chunks.push({ kind: "text", value });
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
        chunks.push({
          kind: "node",
          node: { type: "inlineCode", value: code.value },
        });
        i = code.end;
        continue;
      }
      pushText("`");
      i += 1;
      continue;
    }

    // Autolink <https://…> or <email>.
    if (c === "<") {
      const auto = matchAutolink(text, i);
      if (auto) {
        chunks.push({ kind: "node", node: auto.node });
        i = auto.end;
        continue;
      }
      pushText("<");
      i += 1;
      continue;
    }

    // Inline image ![alt](dest).
    if (c === "!" && text[i + 1] === "[") {
      const link = matchLink(text, i + 1);
      if (link) {
        chunks.push({ kind: "node", node: makeImage(link.inner, link.dest) });
        i = link.end;
        continue;
      }
      pushText("!");
      i += 1;
      continue;
    }

    // Inline link [text](dest).
    if (c === "[") {
      const link = matchLink(text, i);
      if (link) {
        chunks.push({ kind: "node", node: makeLink(link.inner, link.dest) });
        i = link.end;
        continue;
      }
      pushText("[");
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

    // Strikethrough uses GFM double-tilde only.
    if (c === "~" && text[i + 1] === "~") {
      chunks.push(makeDelim("~", 2, text, i, i + 2));
      i += 2;
      continue;
    }

    pushText(c);
    i += 1;
  }

  return chunks;
}

function makeDelim(
  char: "*" | "_" | "~",
  count: number,
  text: string,
  start: number,
  end: number,
): Chunk {
  const before = start > 0 ? text[start - 1] : "";
  const after = end < text.length ? text[end] : "";

  const leftFlanking =
    !isWhitespace(after) &&
    (!isPunct(after) || isWhitespace(before) || isPunct(before));
  const rightFlanking =
    !isWhitespace(before) &&
    (!isPunct(before) || isWhitespace(after) || isPunct(after));

  let canOpen = leftFlanking;
  let canClose = rightFlanking;
  if (char === "_") {
    canOpen = leftFlanking && (!rightFlanking || isPunct(before));
    canClose = rightFlanking && (!leftFlanking || isPunct(after));
  }

  return { kind: "delim", char, count, canOpen, canClose };
}

function matchCodeSpan(
  text: string,
  start: number,
): { value: string; end: number } | null {
  let n = 0;
  while (text[start + n] === "`") n++;
  const fence = "`".repeat(n);
  const close = text.indexOf(fence, start + n);
  if (close === -1) return null;
  let value = text.slice(start + n, close);
  // Collapse internal runs of whitespace to single spaces, then strip a single
  // surrounding space when the content is not entirely spaces (CommonMark).
  value = value.replace(/\s+/g, " ");
  if (value.length > 2 && value.startsWith(" ") && value.endsWith(" ") && value.trim() !== "") {
    value = value.slice(1, -1);
  }
  return { value, end: close + n };
}

function matchAutolink(
  text: string,
  start: number,
): { node: LinkNode; end: number } | null {
  const rest = text.slice(start);
  const m = rest.match(/^<((?:https?|mailto):[^>\s]+|[^>\s@]+@[^>\s]+\.[^>\s]+)>/);
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

function makeLink(inner: string, dest: string): LinkNode {
  return {
    type: "link",
    target: { kind: "external", url: dest },
    children: parseInline(inner),
  };
}

function unresolvedMedia(path: string): MediaResource {
  // The parser is pure and cannot read the vault; the resolver (Stage 3) reads
  // the bytes and upgrades this to "binary", "remote-blocked", or confirms
  // "missing" with a warning.
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

/** Extract Obsidian-style `|width` / `|widthxheight` size hints from alt text. */
export function parseImageSize(alt: string): {
  alt: string;
  width?: number;
  height?: number;
} {
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
    const result: { alt: string; width?: number; height?: number } = {
      alt: label,
      width: Number(w),
    };
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
