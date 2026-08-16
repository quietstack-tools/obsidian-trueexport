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
  Math,
} from "docx";
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
        if (n.assignedNumber !== undefined) out.push(new FootnoteReferenceRun(n.assignedNumber));
        break;
      case "lineBreak":
        out.push(n.hard ? new TextRun({ break: 1, language: RUN_LANGUAGE }) : textRun(" ", fmt));
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
