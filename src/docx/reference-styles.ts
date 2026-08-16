// src/docx/reference-styles.ts
//
// Reference DOCX support (Pro; §5.1). A user can supply a .docx "house style";
// TrueExport reads its style definitions and applies them in place of the
// built-in style table. A .docx is a ZIP of XML, and the `docx` library is
// write-only, so we read `word/styles.xml` directly (via JSZip, already a
// dependency) and parse the relevant OOXML ourselves.
//
// Two layers:
//   - extractStylesFromXml(xml): pure OOXML → ReferenceStyles. Only fields that
//     the reference actually defines are returned, so the caller can merge them
//     field-by-field over the built-in defaults (full fidelity where the
//     reference defines a value; built-in everywhere else).
//   - parseReferenceStyles(bytes): unzip + extract. NEVER throws — any failure
//     (not a zip, missing styles.xml, malformed XML) resolves to null, and the
//     caller degrades to built-in styles + a warning (§7.4).
//
// OOXML units: run size w:sz is in half-points (24 → 12pt); paragraph spacing
// is in twips (20 → 1pt); colours are hex without a leading '#'.

import * as JSZip from "jszip";

/** Run-level properties a reference style may override. */
export interface RefRunProps {
  font?: string;
  /** Half-points, as in OOXML w:sz. */
  size?: number;
  bold?: boolean;
  italics?: boolean;
  /** Hex without a leading '#'. */
  color?: string;
}

/** Paragraph-level properties a reference style may override. */
export interface RefParaProps {
  /** Twips. */
  before?: number;
  after?: number;
  line?: number;
  lineRule?: "auto" | "exact" | "atLeast";
  indentLeft?: number;
  alignment?: "left" | "center" | "right" | "both";
}

export interface RefStyle {
  run?: RefRunProps;
  paragraph?: RefParaProps;
}

/**
 * The categories from the §5.1 style table. Each is optional: a reference
 * document that doesn't define a category leaves it undefined, and the renderer
 * keeps the built-in style for it.
 */
export interface ReferenceStyles {
  normal?: RefStyle;
  heading1?: RefStyle;
  heading2?: RefStyle;
  heading3?: RefStyle;
  heading4?: RefStyle;
  heading5?: RefStyle;
  heading6?: RefStyle;
  quote?: RefStyle;
  caption?: RefStyle;
  /** Inline/code style; also informs the code-block run for a consistent look. */
  code?: RefStyle;
}

const STYLES_PART = "word/styles.xml";

// Resource guards (§7.4). A reference .docx is untrusted input, so we bound the
// worst-case work/memory: a real house-style styles.xml is well under 100 KB,
// so anything over these caps degrades to built-in styles + a warning rather
// than freezing the export (e.g. a malformed file with thousands of unclosed
// <w:style> tags, or a decompression bomb).
const MAX_DOCX_BYTES = 50 * 1024 * 1024; // raw .docx we'll even hand to JSZip
const MAX_STYLES_XML_BYTES = 2 * 1024 * 1024; // decompressed word/styles.xml

/**
 * Parse a reference .docx's style definitions. Returns null on ANY problem
 * (too large, not a zip, no styles.xml, unreadable XML) so a bad reference never
 * aborts an export — the caller warns and falls back to the built-in table.
 */
export async function parseReferenceStyles(bytes: ArrayBuffer): Promise<ReferenceStyles | null> {
  try {
    // Cap the raw input before it ever reaches JSZip.
    if (bytes.byteLength > MAX_DOCX_BYTES) return null;
    // Wrap in a Uint8Array: JSZip's input-type detection is stricter about a
    // bare ArrayBuffer across JS realms, but always accepts a typed-array view.
    const zip = await JSZip.loadAsync(new Uint8Array(bytes));
    const entry = zip.file(STYLES_PART);
    if (!entry) return null;
    // Refuse a decompression bomb BEFORE materialising the entry: the declared
    // uncompressed size is in the zip metadata, so we can bail without expanding.
    const declared = declaredUncompressedSize(entry);
    if (declared !== undefined && declared > MAX_STYLES_XML_BYTES) return null;
    const xml = await entry.async("string");
    if (xml.length > MAX_STYLES_XML_BYTES) return null; // belt-and-braces
    const styles = extractStylesFromXml(xml);
    // A valid styles.xml with nothing we recognise is still a "no-op" reference;
    // treat an empty extraction as null so the caller keeps built-in styles.
    return Object.keys(styles).length > 0 ? styles : null;
  } catch {
    return null;
  }
}

/** The entry's declared uncompressed size from the zip's central directory, if
 *  JSZip exposes it — lets us reject a bomb without decompressing. */
function declaredUncompressedSize(entry: unknown): number | undefined {
  const data = (entry as { _data?: { uncompressedSize?: unknown } })._data;
  return data && typeof data.uncompressedSize === "number" ? data.uncompressedSize : undefined;
}

/** Pure OOXML → ReferenceStyles. Exported for unit testing without a zip. */
export function extractStylesFromXml(xml: string): ReferenceStyles {
  if (xml.length > MAX_STYLES_XML_BYTES) return {};
  const index = indexStyleBlocks(xml);
  const out: ReferenceStyles = {};

  const normal = mergeStyles(defaultsStyle(xml), styleFrom(index, "Normal", "Normal"));
  if (normal) out.normal = normal;

  const headings: (keyof ReferenceStyles)[] = [
    "heading1",
    "heading2",
    "heading3",
    "heading4",
    "heading5",
    "heading6",
  ];
  headings.forEach((key, i) => {
    const n = i + 1;
    const style = styleFrom(index, `Heading${n}`, `Heading ${n}`);
    if (style) out[key] = style;
  });

  const quote = styleFrom(index, "Quote", "Quote");
  if (quote) out.quote = quote;
  const caption = styleFrom(index, "Caption", "Caption");
  if (caption) out.caption = caption;
  const code = styleFrom(index, "Code", "Code");
  if (code) out.code = code;

  return out;
}

// ---- OOXML block extraction ----

interface StyleIndex {
  /** lowercased w:styleId → inner XML of that <w:style> block */
  byId: Map<string, string>;
  /** lowercased display name (<w:name w:val>) → inner XML */
  byName: Map<string, string>;
}

/**
 * Index every <w:style …>…</w:style> block in a SINGLE linear pass, keyed by
 * styleId and by display name. The cursor only ever moves forward (indexOf from
 * a monotonically increasing position), so this is O(n) — replacing the old
 * per-category scan-to-close regexes that were O(n²) on malformed input with
 * many unclosed tags. Built once and reused for all style categories.
 */
function indexStyleBlocks(xml: string): StyleIndex {
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  const OPEN = "<w:style";
  const CLOSE = "</w:style>";
  let cursor = 0;
  while (true) {
    const open = xml.indexOf(OPEN, cursor);
    if (open === -1) break;
    // Match only the <w:style> element — not <w:styles>, <w:styleId>, etc.
    const boundary = xml[open + OPEN.length];
    if (boundary !== undefined && !isTagBoundary(boundary)) {
      cursor = open + OPEN.length;
      continue;
    }
    const gt = xml.indexOf(">", open);
    if (gt === -1) break;
    const openTag = xml.slice(open, gt + 1);
    if (openTag.endsWith("/>")) {
      cursor = gt + 1; // self-closed <w:style/> — no block body
      continue;
    }
    const close = xml.indexOf(CLOSE, gt + 1);
    if (close === -1) break; // no complete block remains → stop (bounds the work)
    const inner = xml.slice(gt + 1, close);

    const styleId = tagAttrRaw(openTag, "w:styleId");
    if (styleId) {
      const key = styleId.toLowerCase();
      if (!byId.has(key)) byId.set(key, inner);
    }
    const name = /<w:name\b[^>]*\bw:val="([^"]*)"/i.exec(inner)?.[1];
    if (name) {
      const key = name.toLowerCase();
      if (!byName.has(key)) byName.set(key, inner);
    }
    cursor = close + CLOSE.length;
  }
  return { byId, byName };
}

/**
 * Look up a style by styleId (preferred) or, failing that, by display name —
 * Word uses ids like "Heading1" with names like "heading 1", but custom
 * templates vary, so we accept either.
 */
function styleFrom(index: StyleIndex, styleId: string, name: string): RefStyle | undefined {
  const inner = index.byId.get(styleId.toLowerCase()) ?? index.byName.get(name.toLowerCase());
  return inner === undefined ? undefined : styleProps(inner);
}

/** The document defaults (<w:docDefaults>) → the Normal style's base. */
function defaultsStyle(xml: string): RefStyle | undefined {
  const block = firstBlock(xml, "w:docDefaults");
  return block ? styleProps(block) : undefined;
}

/**
 * Extract run + paragraph properties from a style block (a <w:style> body or
 * <w:docDefaults>). Paragraph props come from <w:pPr>; run props MUST come from
 * the <w:rPr> that is a direct child of the style — NOT the paragraph-mark
 * <w:rPr> that OOXML nests inside <w:pPr> (which Word/LibreOffice emit). So we
 * locate the pPr span and exclude it before searching for the run <w:rPr>.
 */
function styleProps(inner: string): RefStyle | undefined {
  const pPr = locateBlock(inner, "w:pPr");
  const paragraph = paraProps(pPr?.inner);
  const runScope = pPr ? inner.slice(0, pPr.start) + inner.slice(pPr.end) : inner;
  const run = runProps(firstBlock(runScope, "w:rPr"));
  return toStyle(run, paragraph);
}

interface LocatedBlock {
  inner: string;
  /** Index in the source where the opening tag begins. */
  start: number;
  /** Index in the source just past the closing tag. */
  end: number;
}

/**
 * Locate the first complete <tag …>…</tag> in `xml` — its inner text and span.
 * Linear (indexOf-based) and boundary-aware, so <w:pPr> is not matched by a
 * longer name and <w:rPr> is not matched by <w:rPrDefault>.
 */
function locateBlock(xml: string | undefined, tag: string): LocatedBlock | undefined {
  if (!xml) return undefined;
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let cursor = 0;
  while (true) {
    const start = xml.indexOf(open, cursor);
    if (start === -1) return undefined;
    const boundary = xml[start + open.length];
    if (boundary !== undefined && !isTagBoundary(boundary)) {
      cursor = start + open.length;
      continue;
    }
    const gt = xml.indexOf(">", start);
    if (gt === -1) return undefined;
    if (xml[gt - 1] === "/") {
      cursor = gt + 1; // self-closed → no inner block; keep looking
      continue;
    }
    const end = xml.indexOf(close, gt + 1);
    if (end === -1) return undefined;
    return { inner: xml.slice(gt + 1, end), start, end: end + close.length };
  }
}

/** Inner text of the first complete <tag …>…</tag>, or undefined. */
function firstBlock(xml: string | undefined, tag: string): string | undefined {
  return locateBlock(xml, tag)?.inner;
}

/** A character that ends an element name (so we don't match a longer tag). */
function isTagBoundary(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "/" || ch === ">";
}

// ---- Property extraction ----

function runProps(block: string | undefined): RefRunProps | undefined {
  if (!block) return undefined;
  const props: RefRunProps = {};
  const font = attr(block, "w:rFonts", "w:ascii");
  if (font) props.font = font;
  const color = attr(block, "w:color", "w:val");
  // OOXML w:color is a 6-hex RRGGBB or "auto"; accept only a real hex value and
  // drop anything else (incl. "auto") so a junk colour falls back to built-in.
  if (color && /^[0-9A-Fa-f]{6}$/.test(color)) props.color = color;
  const size = attr(block, "w:sz", "w:val");
  if (size && /^\d+$/.test(size)) props.size = Number(size);
  if (toggle(block, "w:b")) props.bold = true;
  if (toggle(block, "w:i")) props.italics = true;
  return Object.keys(props).length > 0 ? props : undefined;
}

function paraProps(block: string | undefined): RefParaProps | undefined {
  if (!block) return undefined;
  const props: RefParaProps = {};
  const spacing = firstTag(block, "w:spacing");
  if (spacing) {
    const before = tagAttr(spacing, "w:before");
    const after = tagAttr(spacing, "w:after");
    const line = tagAttr(spacing, "w:line");
    const lineRule = tagAttrRaw(spacing, "w:lineRule");
    if (before && /^\d+$/.test(before)) props.before = Number(before);
    if (after && /^\d+$/.test(after)) props.after = Number(after);
    if (line && /^\d+$/.test(line)) props.line = Number(line);
    if (lineRule === "auto" || lineRule === "exact" || lineRule === "atLeast") props.lineRule = lineRule;
  }
  const indent = attr(block, "w:ind", "w:left");
  if (indent && /^\d+$/.test(indent)) props.indentLeft = Number(indent);
  const jc = attr(block, "w:jc", "w:val");
  if (jc === "left" || jc === "center" || jc === "right" || jc === "both") props.alignment = jc;
  return Object.keys(props).length > 0 ? props : undefined;
}

function toStyle(run: RefRunProps | undefined, paragraph: RefParaProps | undefined): RefStyle | undefined {
  if (!run && !paragraph) return undefined;
  const style: RefStyle = {};
  if (run) style.run = run;
  if (paragraph) style.paragraph = paragraph;
  return style;
}

/** Merge two RefStyles field-by-field; `over` wins where it defines a value. */
function mergeStyles(base: RefStyle | undefined, over: RefStyle | undefined): RefStyle | undefined {
  if (!base) return over;
  if (!over) return base;
  const run = { ...base.run, ...over.run };
  const paragraph = { ...base.paragraph, ...over.paragraph };
  const style: RefStyle = {};
  if (Object.keys(run).length > 0) style.run = run;
  if (Object.keys(paragraph).length > 0) style.paragraph = paragraph;
  return style.run || style.paragraph ? style : undefined;
}

// ---- Low-level OOXML helpers ----

/** Value of `attr` on the FIRST `<tag …>` element found in `block`. */
function attr(block: string, tag: string, attribute: string): string | undefined {
  const el = firstTag(block, tag);
  return el ? tagAttr(el, attribute) : undefined;
}

/** The opening `<tag …>` element text (attributes only), or undefined. */
function firstTag(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${escapeRe(tag)}\\b[^>]*/?>`, "i");
  return re.exec(block)?.[0];
}

function tagAttr(el: string, attribute: string): string | undefined {
  return tagAttrRaw(el, attribute);
}

function tagAttrRaw(el: string, attribute: string): string | undefined {
  const re = new RegExp(`\\b${escapeRe(attribute)}="([^"]*)"`, "i");
  return re.exec(el)?.[1];
}

/**
 * A boolean toggle element (<w:b/>, <w:i/>). Present → true, unless explicitly
 * switched off (w:val of false/0/off). Must not match e.g. <w:bCs/>.
 */
function toggle(block: string, tag: string): boolean {
  const re = new RegExp(`<${escapeRe(tag)}(?=[\\s/>])([^>]*)>`, "i");
  const m = re.exec(block);
  if (!m) return false;
  const val = /\bw:val="([^"]*)"/i.exec(m[1])?.[1];
  if (val && /^(false|0|off)$/i.test(val)) return false;
  return true;
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
