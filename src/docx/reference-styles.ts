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

/**
 * Parse a reference .docx's style definitions. Returns null on ANY problem
 * (not a zip, no styles.xml, unreadable XML) so a bad reference never aborts an
 * export — the caller warns and falls back to the built-in table.
 */
export async function parseReferenceStyles(bytes: ArrayBuffer): Promise<ReferenceStyles | null> {
  try {
    // Wrap in a Uint8Array: JSZip's input-type detection is stricter about a
    // bare ArrayBuffer across JS realms, but always accepts a typed-array view.
    const zip = await JSZip.loadAsync(new Uint8Array(bytes));
    const entry = zip.file(STYLES_PART);
    if (!entry) return null;
    const xml = await entry.async("string");
    const styles = extractStylesFromXml(xml);
    // A valid styles.xml with nothing we recognise is still a "no-op" reference;
    // treat an empty extraction as null so the caller keeps built-in styles.
    return Object.keys(styles).length > 0 ? styles : null;
  } catch {
    return null;
  }
}

/** Pure OOXML → ReferenceStyles. Exported for unit testing without a zip. */
export function extractStylesFromXml(xml: string): ReferenceStyles {
  const out: ReferenceStyles = {};

  const normal = mergeStyles(defaultsStyle(xml), namedStyle(xml, "Normal", "Normal"));
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
    const style = namedStyle(xml, `Heading${n}`, `Heading ${n}`);
    if (style) out[key] = style;
  });

  const quote = namedStyle(xml, "Quote", "Quote");
  if (quote) out.quote = quote;
  const caption = namedStyle(xml, "Caption", "Caption");
  if (caption) out.caption = caption;
  const code = namedStyle(xml, "Code", "Code");
  if (code) out.code = code;

  return out;
}

// ---- OOXML block extraction ----

/** The document defaults (<w:docDefaults>) → the Normal style's base. */
function defaultsStyle(xml: string): RefStyle | undefined {
  const block = firstBlock(xml, "w:docDefaults");
  if (!block) return undefined;
  const run = runProps(firstBlock(block, "w:rPr"));
  const paragraph = paraProps(firstBlock(block, "w:pPr"));
  return toStyle(run, paragraph);
}

/**
 * A named <w:style> by styleId (preferred) or, failing that, by w:name — Word
 * uses ids like "Heading1" with display names like "heading 1", but custom
 * templates vary, so we accept either.
 */
function namedStyle(xml: string, styleId: string, name: string): RefStyle | undefined {
  const block = styleBlockById(xml, styleId) ?? styleBlockByName(xml, name);
  if (!block) return undefined;
  const run = runProps(firstBlock(block, "w:rPr"));
  const paragraph = paraProps(firstBlock(block, "w:pPr"));
  return toStyle(run, paragraph);
}

function styleBlockById(xml: string, styleId: string): string | undefined {
  const re = new RegExp(
    `<w:style\\b[^>]*\\bw:styleId="${escapeRe(styleId)}"[^>]*>([\\s\\S]*?)</w:style>`,
    "i",
  );
  return re.exec(xml)?.[1];
}

function styleBlockByName(xml: string, name: string): string | undefined {
  // Scan each <w:style> block and match its <w:name w:val="..."> case-insensitively.
  const re = /<w:style\b[^>]*>([\s\S]*?)<\/w:style>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const nameVal = /<w:name\b[^>]*\bw:val="([^"]*)"/i.exec(m[1])?.[1];
    if (nameVal && nameVal.toLowerCase() === name.toLowerCase()) return m[1];
  }
  return undefined;
}

/** The first <tag>…</tag> block within `xml`, or undefined. */
function firstBlock(xml: string | undefined, tag: string): string | undefined {
  if (!xml) return undefined;
  const re = new RegExp(`<${escapeRe(tag)}\\b[^>]*>([\\s\\S]*?)</${escapeRe(tag)}>`, "i");
  return re.exec(xml)?.[1];
}

// ---- Property extraction ----

function runProps(block: string | undefined): RefRunProps | undefined {
  if (!block) return undefined;
  const props: RefRunProps = {};
  const font = attr(block, "w:rFonts", "w:ascii");
  if (font) props.font = font;
  const color = attr(block, "w:color", "w:val");
  if (color && color.toLowerCase() !== "auto") props.color = color;
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
