// src/docx/inline.ts
//
// Inline IDM → docx run-level elements. Emphasis/strong/etc. are flattened into
// run properties; links become hyperlinks; footnote references become real
// FootnoteReferenceRuns; images become ImageRuns (or a text placeholder). Every
// text run carries w:lang so Word's spellchecker behaves (§5.1/§10).

import {
  TextRun,
  ImageRun,
  ExternalHyperlink,
  InternalHyperlink,
  FootnoteReferenceRun,
  Bookmark,
  BookmarkStart,
  BookmarkEnd,
  Math,
  BuilderElement,
  XmlComponent,
} from "docx";
import type { ParagraphChild } from "docx";
import { latexToMath } from "./math";
import type {
  ImageBlockNode,
  InlineImageNode,
  InlineNode,
  LinkNode,
} from "../core/model/nodes";
import { slugify } from "../core/util/slug";
import { safeExternalUrl } from "../core/util/url";
import { RUN_LANGUAGE } from "./styles";
import { imageType, displaySize } from "./image";
import type { RenderContext } from "./context";

export type InlineRun =
  | TextRun
  | ImageRun
  | ExternalHyperlink
  | InternalHyperlink
  | FootnoteReferenceRun
  | Bookmark
  | Math;

interface Fmt {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  highlight?: boolean;
  subScript?: boolean;
  superScript?: boolean;
  hyperlink?: boolean;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function sanitizeAnchor(id: string): string {
  return id.replace(/[^\w-]/g, "-");
}

/**
 * Build a Bookmark with a numeric w:id that's actually unique across the
 * whole document. docx's own `Bookmark` class calls
 * `bookmarkUniqueNumericIdGen()` in its constructor — but that factory
 * returns a BRAND NEW counter starting from 0 every time it's called, so
 * every single `new Bookmark(...)` anywhere in the codebase independently
 * produces w:id="1". That's invalid OOXML (bookmark ids must be unique
 * document-wide, not just unique per code path) and broke Word's bookmark
 * resolution — including previously-working links — once more than one
 * bookmark existed in the same export.
 *
 * `Bookmark.start`/`.end` are `readonly` in the type declarations but plain
 * mutable fields at runtime, and `Paragraph` reads them directly (not
 * anything captured privately at construction time) when it flattens a
 * Bookmark into `[start, ...children, end]` — see docx's Paragraph
 * constructor. So constructing normally and then replacing `.start`/`.end`
 * with correctly-id'd instances, sourced from this render's single shared
 * counter (RenderContext.nextBookmarkId), is safe and is what every
 * bookmark-creating call site in this codebase must go through.
 */
export function createBookmark(id: string, children: readonly ParagraphChild[], ctx: RenderContext): Bookmark {
  const bookmark = new Bookmark({ id, children });
  const numericId = ctx.nextBookmarkId();
  (bookmark as { start: BookmarkStart }).start = new BookmarkStart(id, numericId);
  (bookmark as { end: BookmarkEnd }).end = new BookmarkEnd(numericId);
  return bookmark;
}

type FieldCharType = "begin" | "separate" | "end";

/** `w:fldChar` — one of the three markers (begin/separate/end) that delimit a complex field. */
function fieldCharElement(type: FieldCharType, dirty?: true): BuilderElement<{ type: FieldCharType; dirty?: true }> {
  return new BuilderElement<{ type: FieldCharType; dirty?: true }>({
    name: "w:fldChar",
    attributes: dirty
      ? { type: { key: "w:fldCharType", value: type }, dirty: { key: "w:dirty", value: dirty } }
      : { type: { key: "w:fldCharType", value: type } },
  });
}

/**
 * `w:instrText` — the field's instruction code (e.g. `NOTEREF x \f \h`). No
 * `xml:space="preserve"` attribute: the instructions this codebase generates
 * never have leading/trailing whitespace, so it isn't needed for correctness
 * here (unlike Word's own generated instrText, which always includes it).
 */
class FieldInstrText extends XmlComponent {
  constructor(instruction: string) {
    super("w:instrText");
    this.root.push(instruction);
  }
}

/**
 * Word's own footnote model requires every `<w:footnoteReference>` marker in
 * the body to carry a unique `w:id` — footnotes.xml is keyed by footnote
 * number, but the body's reference markers are keyed by *occurrence*, not by
 * footnote. Two body markers reusing the same id for the same cited-twice
 * footnote produces a document Word flags as unreadable/needing repair on
 * open, and drops the invalid duplicate during that repair.
 *
 * The first reference to a given footnote number is a plain real
 * `w:footnoteReference`. Any repeat reference is a NOTEREF field instead —
 * the standard OOXML mechanism for a second reference point to an existing
 * footnote: `\f` formats the field like a footnote/endnote reference (small
 * raised number), `\h` makes it a clickable hyperlink to a bookmark.
 *
 * That bookmark (`footnoteref-N`) is NOT on the in-body reference mark —
 * Word's own "Insert Cross-Reference → Footnote" feature bookmarks the mark
 * itself, which means clicking a repeat citation lands back on the ORIGINAL
 * citation point in body text, not the actual footnote content at the page
 * bottom (confirmed by manual test: mechanically correct, but not the
 * reader experience wanted here — "click any marker, see the footnote
 * text"). Word does support bookmarks placed inside footnote/endnote text
 * itself, navigable via an ordinary internal hyperlink — this is a
 * documented (if less common) technique, distinct from what the standard
 * Cross-reference dialog offers. So the bookmark is placed at the START of
 * the footnote's own content in footnotes.xml instead (see
 * renderFootnoteContent() in blocks.ts) — every repeat citation's NOTEREF
 * then jumps straight to the real footnote text, one hop, matching ordinary
 * reader expectations.
 *
 * Built as a genuine OOXML complex field (begin / instrText / separate /
 * cached result / end, each its own `<w:r>` sibling), not `w:fldSimple`.
 * Real Word-authored documents always use this four-part form for fields
 * Word itself inserts — `fldSimple` exists mainly for round-tripping other
 * tools' output. A first attempt used `fldSimple` with a styled cached run
 * and the visible marker didn't render as superscript in Word (confirmed by
 * manual test) despite carrying the right rStyle. Matching Word's own field
 * shape as closely as possible — including giving the cached result its own
 * run with EXPLICIT superscript formatting (not just a style reference,
 * belt-and-suspenders) rather than embedding it inside the field-code run —
 * is the standard, most Word-native construction, but this is inference
 * from documented OOXML/Word field behaviour, not a confirmed re-test: I
 * can't render in Word myself, so treat this as unverified until manually
 * checked.
 */
function footnoteReferenceRun(n: number, ctx: RenderContext): InlineRun[] {
  const bookmarkId = sanitizeAnchor(`footnoteref-${n}`);
  if (!ctx.footnoteRefs.has(n)) {
    ctx.footnoteRefs.add(n);
    return [new FootnoteReferenceRun(n)];
  }
  return [
    new TextRun({ children: [fieldCharElement("begin", true)] }),
    new TextRun({ children: [new FieldInstrText(`NOTEREF ${bookmarkId} \\f \\h`)] }),
    new TextRun({ children: [fieldCharElement("separate")] }),
    new TextRun({ text: String(n), superScript: true, style: "FootnoteReference", language: RUN_LANGUAGE }),
    new TextRun({ children: [fieldCharElement("end")] }),
  ];
}

function textRun(text: string, fmt: Fmt): TextRun {
  return new TextRun({
    text,
    language: RUN_LANGUAGE,
    bold: fmt.bold,
    italics: fmt.italics,
    strike: fmt.strike,
    subScript: fmt.subScript,
    superScript: fmt.superScript,
    highlight: fmt.highlight ? "yellow" : undefined,
    style: fmt.hyperlink ? "Hyperlink" : undefined,
  });
}

/** Build an ImageRun, or a text placeholder when the image can't be embedded. */
export function buildImage(
  node: InlineImageNode | ImageBlockNode,
  _ctx: RenderContext,
): ImageRun | { placeholder: string } {
  const res = node.resource;
  const name = basename(res.originalPath);
  if (res.kind === "missing") return { placeholder: `[Image not found: ${name}]` };
  if (res.kind === "remote-blocked") return { placeholder: `[Remote image not embedded: ${name}]` };
  if (!res.data) return { placeholder: `[Image unavailable: ${name}]` };
  // An SVG that reached here was not rasterised (no rasteriser injected).
  if (res.mimeType === "image/svg+xml") return { placeholder: `[SVG image: ${name}]` };

  const size = displaySize(res.data, res.mimeType, node.width, node.height);
  // SVG was handled above, so the type here is always a raster format.
  const type = imageType(res.mimeType) as "png" | "jpg" | "gif" | "bmp";
  return new ImageRun({ type, data: new Uint8Array(res.data), transformation: size });
}

export function renderInline(nodes: InlineNode[], ctx: RenderContext, fmt: Fmt = {}): InlineRun[] {
  const out: InlineRun[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        out.push(textRun(n.value, fmt));
        break;
      case "emphasis":
        out.push(...renderInline(n.children, ctx, { ...fmt, italics: true }));
        break;
      case "strong":
        out.push(...renderInline(n.children, ctx, { ...fmt, bold: true }));
        break;
      case "strikethrough":
        out.push(...renderInline(n.children, ctx, { ...fmt, strike: true }));
        break;
      case "highlight":
        out.push(...renderInline(n.children, ctx, { ...fmt, highlight: true }));
        break;
      case "subscript":
        out.push(...renderInline(n.children, ctx, { ...fmt, subScript: true, superScript: false }));
        break;
      case "superscript":
        out.push(...renderInline(n.children, ctx, { ...fmt, superScript: true, subScript: false }));
        break;
      case "inlineCode":
        out.push(new TextRun({ text: n.value, style: "Code", language: RUN_LANGUAGE }));
        break;
      case "link":
        out.push(...renderLink(n, ctx, fmt));
        break;
      case "inlineImage": {
        const built = buildImage(n, ctx);
        out.push("placeholder" in built ? textRun(built.placeholder, { ...fmt, italics: true }) : built);
        break;
      }
      case "footnoteReference":
        if (n.assignedNumber !== undefined) out.push(...footnoteReferenceRun(n.assignedNumber, ctx));
        break;
      case "lineBreak":
        // Obsidian's default (non-strict-line-breaks) editor renders a
        // single newline within a paragraph as a real visual line break,
        // not a collapsed space — so both hard (trailing "  " or "\")
        // and soft (plain newline) breaks get a w:br here. `n.hard` still
        // distinguishes them in the IDM for renderers that follow strict
        // CommonMark (see html/index.ts), just not this one.
        out.push(new TextRun({ break: 1, language: RUN_LANGUAGE }));
        break;
      case "mathInline":
        try {
          out.push(latexToMath(n.latex));
        } catch {
          // Conversion failure → raw LaTeX in monospace (§4.10).
          out.push(new TextRun({ text: n.latex, style: "Code", language: RUN_LANGUAGE }));
        }
        break;
    }
  }
  return out;
}

function renderLink(node: LinkNode, ctx: RenderContext, fmt: Fmt): InlineRun[] {
  const t = node.target;
  if (t.kind === "external") {
    const safe = safeExternalUrl(t.url);
    // Unsafe scheme (javascript:, file:, …): Word would honour the hyperlink, so
    // strip it and keep the visible text as plain (non-hyperlink) runs.
    if (safe === null) return renderInline(node.children, ctx, fmt);
    const runs = renderInline(node.children, ctx, { ...fmt, hyperlink: true });
    return [new ExternalHyperlink({ link: safe, children: runs })];
  }
  const runs = renderInline(node.children, ctx, { ...fmt, hyperlink: true });
  if (t.kind === "anchor") {
    return [new InternalHyperlink({ anchor: sanitizeAnchor(t.id), children: runs })];
  }
  const anchor = t.blockId
    ? t.blockId
    : t.heading
      ? slugify(t.heading)
      : slugify(basename(t.notePath));
  return [new InternalHyperlink({ anchor: sanitizeAnchor(anchor), children: runs })];
}
