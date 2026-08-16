// src/docx/index.ts
//
// renderDocx(): IDM → a .docx as an ArrayBuffer.
//
// Mobile is a core differentiator, so this MUST stay Buffer-free: we use
// Packer.toBlob() → Blob.arrayBuffer(), never Packer.toBuffer() (which needs
// Node's Buffer). The caller writes the ArrayBuffer via vault.createBinary().
//
// Uses the modern declarative `sections` API — not the obsolete v2
// doc.addParagraph() shape.

import { Document, Packer, Paragraph, PageOrientation } from "docx";
import type { IdmDocument } from "../core/model/document";
import type { MediaResource } from "../core/model/nodes";
import type { BlockNode, InlineNode } from "../core/model/nodes";
import type { ExportOptions, PageSize } from "../core/options";
import type { WarningCollector } from "../core/warnings";
import { NumberingBuilder } from "./numbering";
import { buildStyles } from "./styles";
import { renderBlocks, renderFrontmatterTable } from "./blocks";
import type { DocxDeps, RenderContext } from "./context";
import type { ReferenceStyles } from "./reference-styles";

export type { DocxDeps } from "./context";
export type { ReferenceStyles } from "./reference-styles";

export interface DocxRenderOptions {
  deps?: DocxDeps;
  /** Pro removes the free-tier attribution from document properties (§7.1). */
  pro?: boolean;
  /**
   * Collector for degradation warnings raised during rendering — currently an
   * SVG that couldn't be rasterised for Word (§4.9). Optional so pure-render
   * tests can omit it.
   */
  warnings?: WarningCollector;
  /**
   * Styles extracted from a Pro user's reference .docx (§5.1). When present they
   * override the built-in style table field-by-field; absent → built-in styles.
   */
  referenceStyles?: ReferenceStyles;
}

const FREE_ATTRIBUTION = "(exported with TrueExport — quietstack.tools)";

const PAGE_SIZES: Record<PageSize, { w: number; h: number }> = {
  A4: { w: 11906, h: 16838 },
  Letter: { w: 12240, h: 15840 },
  Legal: { w: 12240, h: 20160 },
};

export async function renderDocx(
  doc: IdmDocument,
  options: ExportOptions,
  render: DocxRenderOptions = {},
): Promise<ArrayBuffer> {
  const deps = render.deps ?? {};

  // Rasterise SVGs to PNG (§4.9) before rendering, so rendering stays sync.
  await rasterizeSvgs(collectResources(doc.blocks, doc.footnotes), deps, render.warnings, doc.sourcePath);

  const ctx: RenderContext = {
    options,
    deps,
    numbering: new NumberingBuilder(),
    bookmarks: new Set(),
  };

  const bodyChildren = [];
  if (options.frontmatterMode === "table" && Object.keys(doc.frontmatter).length > 0) {
    bodyChildren.push(renderFrontmatterTable(doc.frontmatter));
  }
  bodyChildren.push(...renderBlocks(doc.blocks, ctx));

  // Footnotes: real Word footnotes keyed by the resolver-assigned number (§4.5).
  const footnotes: Record<number, { children: Paragraph[] }> = {};
  for (const def of doc.footnotes.values()) {
    if (def.assignedNumber === undefined) continue;
    const children = renderBlocks(def.children, ctx).filter((c): c is Paragraph => c instanceof Paragraph);
    footnotes[def.assignedNumber] = { children };
  }

  const document = new Document({
    creator: "TrueExport",
    title: documentTitle(doc, options),
    description: documentDescription(doc, options, render.pro ?? false),
    keywords: documentKeywords(doc, options),
    styles: buildStyles(render.referenceStyles),
    numbering: { config: ctx.numbering.configs },
    footnotes: Object.keys(footnotes).length > 0 ? footnotes : undefined,
    sections: [{ properties: pageProperties(options), children: bodyChildren }],
  });

  const blob = await Packer.toBlob(document);
  return blob.arrayBuffer();
}

function documentTitle(doc: IdmDocument, options: ExportOptions): string {
  if (options.frontmatterMode === "metadata" && typeof doc.frontmatter.title === "string") {
    return doc.frontmatter.title;
  }
  return doc.title;
}

function documentKeywords(doc: IdmDocument, options: ExportOptions): string | undefined {
  if (options.frontmatterMode !== "metadata") return undefined;
  const tags = doc.frontmatter.tags;
  if (Array.isArray(tags)) return tags.map((t) => String(t)).join(", ");
  if (typeof tags === "string") return tags;
  return undefined;
}

/**
 * Free-tier attribution goes ONLY in the description property — never visible
 * body text (§7.1). In metadata mode a frontmatter description is preserved and
 * the attribution appended.
 */
function documentDescription(doc: IdmDocument, options: ExportOptions, pro: boolean): string {
  let base = "";
  if (options.frontmatterMode === "metadata" && typeof doc.frontmatter.description === "string") {
    base = doc.frontmatter.description;
  }
  if (pro) return base;
  return base ? `${base} ${FREE_ATTRIBUTION}` : FREE_ATTRIBUTION;
}

function pageProperties(options: ExportOptions) {
  const size = PAGE_SIZES[options.pageSize] ?? PAGE_SIZES.A4;
  const landscape = options.orientation === "landscape";
  return {
    page: {
      size: {
        width: landscape ? size.h : size.w,
        height: landscape ? size.w : size.h,
        orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
      },
      margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 }, // 1 inch
    },
  };
}

// ---- SVG rasterisation pass ----

function collectResources(
  blocks: BlockNode[],
  footnotes: IdmDocument["footnotes"],
): MediaResource[] {
  const out: MediaResource[] = [];
  const fromInline = (nodes: InlineNode[]): void => {
    for (const n of nodes) {
      if (n.type === "inlineImage") out.push(n.resource);
      else if ("children" in n && Array.isArray(n.children)) fromInline(n.children);
    }
  };
  const fromBlocks = (bs: BlockNode[]): void => {
    for (const b of bs) {
      switch (b.type) {
        case "imageBlock":
          out.push(b.resource);
          break;
        case "paragraph":
        case "heading":
          fromInline(b.children);
          break;
        case "callout":
          fromInline(b.title);
          fromBlocks(b.children);
          break;
        case "blockquote":
          fromBlocks(b.children);
          break;
        case "list":
          b.children.forEach((it) => fromBlocks(it.children));
          break;
        case "table":
          [b.header, ...b.rows].forEach((r) => r.cells.forEach((c) => fromInline(c.children)));
          break;
        default:
          break;
      }
    }
  };
  fromBlocks(blocks);
  footnotes.forEach((def) => fromBlocks(def.children));
  return out;
}

async function rasterizeSvgs(
  resources: MediaResource[],
  deps: DocxDeps,
  warnings: WarningCollector | undefined,
  sourcePath: string,
): Promise<void> {
  if (!deps.rasterizeSvg) return;
  for (const res of resources) {
    if (res.kind === "binary" && res.mimeType === "image/svg+xml" && res.data) {
      try {
        const { data } = await deps.rasterizeSvg(res.data, 2);
        res.data = data;
        res.mimeType = "image/png";
      } catch {
        // One malformed SVG must never abort the whole export (§4.9). Leave the
        // original SVG bytes in place — the renderer degrades an un-rasterised
        // SVG to a text placeholder — and record a warning, exactly as failed
        // media / mermaid / math do elsewhere.
        warnings?.add({
          construct: "image",
          message: `Couldn't convert the SVG "${svgName(res.originalPath)}" for Word; it was shown as a placeholder.`,
          sourcePath,
        });
      }
    }
  }
}

function svgName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
