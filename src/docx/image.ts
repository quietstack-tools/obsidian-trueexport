// src/docx/image.ts
//
// Image helpers for the DOCX renderer: map a MIME type to the `docx` ImageRun
// type, and read a raster image's intrinsic pixel dimensions from its header
// (so images without an explicit size can be embedded at a sensible size and
// capped to the content width/height). SVG is handled upstream by
// rasterisation.

import type { Orientation, PageSize } from "../core/options";

export type DocxImageType = "png" | "jpg" | "gif" | "bmp" | "svg";

/** Content width at default 1" margins on A4/Letter, in px at 96 DPI (6.5"). */
export const CONTENT_WIDTH_PX = 624;

/**
 * Page dimensions in twips, at 1" margins — the single source of truth for
 * both the actual page setup (src/docx/index.ts imports this) and the
 * content-height cap below, so the two can never drift apart.
 */
export const PAGE_SIZES_TWIPS: Record<PageSize, { w: number; h: number }> = {
  A4: { w: 11906, h: 16838 },
  Letter: { w: 12240, h: 15840 },
  Legal: { w: 12240, h: 20160 },
};

const MARGIN_TWIPS = 1440; // 1 inch, matching pageProperties() in index.ts.
const TWIPS_PER_PX = 15; // 1440 twips/in ÷ 96 px/in.

/** Usable page height in px at 96 DPI, after margins — the height ceiling for an unresized image. */
export function contentHeightPx(pageSize: PageSize, orientation: Orientation): number {
  const size = PAGE_SIZES_TWIPS[pageSize] ?? PAGE_SIZES_TWIPS.A4;
  const heightTwips = orientation === "landscape" ? size.w : size.h;
  return Math.round((heightTwips - MARGIN_TWIPS * 2) / TWIPS_PER_PX);
}

/**
 * Usable page width in twips, after margins — the single source of truth
 * for `w:tblGrid`/`w:gridCol` on every single- and multi-column table in
 * the DOCX renderer (§9.3). `docx`'s `Table` defaults `columnWidths` to 100
 * twips (~0.07in) per column when not given explicitly; Word treats that as
 * a soft hint and defers to `w:tblW: 100%`, but Apple Pages was confirmed
 * (manual test) to size EVERY table type literally from gridCol regardless
 * of the percentage width — callouts, code blocks, the frontmatter
 * properties table, and ordinary markdown tables all rendered as
 * narrow, character-wrapped columns until each was given explicit,
 * correctly-computed columnWidths (thematicBreak was fixed first, in an
 * earlier round; this is the same fix applied everywhere else).
 */
export function contentWidthTwips(pageSize: PageSize, orientation: Orientation): number {
  const size = PAGE_SIZES_TWIPS[pageSize] ?? PAGE_SIZES_TWIPS.A4;
  const widthTwips = orientation === "landscape" ? size.h : size.w;
  return widthTwips - MARGIN_TWIPS * 2;
}

/**
 * Sniff the raster format from the file's own magic-byte signature, ignoring
 * whatever MIME type string it arrived labelled with (§D25).
 *
 * A declared MIME type isn't trustworthy enough to key sizing/embedding on:
 * a local file's mimeType is a guess from its extension
 * (VaultAdapter.getMimeType), and a remote-fetched image's mimeType is
 * whatever Content-Type header the server happened to send, which real
 * hosts and CDNs sometimes give as a real-but-non-canonical string —
 * `image/x-png` (a legacy alias, still genuinely a PNG), a stray
 * charset/vendor suffix, etc. `imageDimensions`/`imageType` previously
 * matched the declared string EXACTLY against `"image/png"` et al.: a
 * non-canonical-but-valid header silently failed that match, so a real,
 * perfectly readable image's dimensions were never read, and the renderer
 * fell back to its generic 400×300 default — producing a genuinely
 * distorted aspect ratio for an image that was never actually broken.
 * Confirmed exactly reproducing a real-world report this way (a remote PNG
 * served as `image/x-png`; `imageType` separately defaulting to `"png"`
 * regardless is why the image still embedded and displayed, just squashed).
 * The declared mimeType is still consulted as a fallback when the bytes
 * don't match any of the four signatures this renderer supports (e.g. truly
 * malformed/too-short data), so nothing regresses for that case.
 */
export function sniffImageFormat(data: ArrayBuffer): "image/png" | "image/jpeg" | "image/gif" | "image/bmp" | null {
  const view = new DataView(data);
  if (data.byteLength >= 8 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    return "image/png";
  }
  if (data.byteLength >= 3 && view.getUint8(0) === 0xff && view.getUint8(1) === 0xd8 && view.getUint8(2) === 0xff) {
    return "image/jpeg";
  }
  if (data.byteLength >= 6 && view.getUint32(0) === 0x47494638 /* "GIF8" */) {
    return "image/gif";
  }
  if (data.byteLength >= 2 && view.getUint8(0) === 0x42 && view.getUint8(1) === 0x4d /* "BM" */) {
    return "image/bmp";
  }
  return null;
}

/** The declared or sniffed format, sniffed bytes taking priority (§D25). */
function effectiveMimeType(data: ArrayBuffer, declared: string | undefined): string | undefined {
  return sniffImageFormat(data) ?? declared;
}

export function imageType(data: ArrayBuffer, declaredMimeType: string | undefined): DocxImageType {
  switch (effectiveMimeType(data, declaredMimeType)) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/bmp":
      return "bmp";
    case "image/svg+xml":
      return "svg";
    default:
      return "png";
  }
}

export interface Dimensions {
  width: number;
  height: number;
}

/** Read intrinsic pixel dimensions from a raster image header, or null. */
export function imageDimensions(data: ArrayBuffer, declaredMimeType: string | undefined): Dimensions | null {
  const view = new DataView(data);
  const mimeType = effectiveMimeType(data, declaredMimeType);
  try {
    if (mimeType === "image/png") return pngSize(view);
    if (mimeType === "image/gif") return gifSize(view);
    if (mimeType === "image/bmp") return bmpSize(view);
    if (mimeType === "image/jpeg") return jpegSize(view);
  } catch {
    return null;
  }
  return null;
}

function pngSize(view: DataView): Dimensions | null {
  // 8-byte signature, then IHDR chunk: width @16 (BE32), height @20.
  if (view.byteLength < 24) return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function gifSize(view: DataView): Dimensions | null {
  if (view.byteLength < 10) return null;
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function bmpSize(view: DataView): Dimensions | null {
  if (view.byteLength < 26) return null;
  return { width: view.getInt32(18, true), height: Math.abs(view.getInt32(22, true)) };
}

function jpegSize(view: DataView): Dimensions | null {
  let offset = 2; // skip SOI
  while (offset + 9 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset++;
      continue;
    }
    const marker = view.getUint8(offset + 1);
    // SOF0–SOF3, SOF5–SOF7, SOF9–SOF11, SOF13–SOF15 carry dimensions.
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    const segmentLength = view.getUint16(offset + 2);
    offset += 2 + segmentLength;
  }
  return null;
}

/**
 * Final display size in px, honouring explicit sizes and the content caps.
 *
 * `maxHeightPx` (the page's usable height after margins) only constrains the
 * fully-automatic case — no `|width` and no explicit height in the source.
 * An explicit `|width` (or `|widthxheight`) resize is a deliberate user
 * choice and is left alone even if the result is tall relative to remaining
 * page space: the bug this fixes is that a normal, UNRESIZED image could
 * overflow a page with no way for the user to know why, which doesn't apply
 * once they've already picked a size themselves. Word also still paginates
 * a too-tall image across a page break rather than clipping it, unlike the
 * unresized case's silent bottom cut-off, so an explicit resize overflowing
 * is recoverable in a way the original bug wasn't.
 */
export function displaySize(
  data: ArrayBuffer,
  mimeType: string | undefined,
  width?: number,
  height?: number,
  maxHeightPx?: number,
  intended?: Dimensions,
): Dimensions {
  // `intended` (the pre-scale size a rasteriser reports — see
  // MediaResource.intendedWidth/Height) stands in for the "natural" size a
  // caller would otherwise read from the raw pixel header. A 2x-oversampled
  // rasterised image's own PNG header reports pixel dimensions twice its
  // intended DISPLAY size; using those directly here would make the image
  // display at roughly double its intended physical size.
  const intrinsic = intended ?? imageDimensions(data, mimeType);

  if (width !== undefined && height !== undefined) return { width, height };
  if (width !== undefined) {
    const ratio = intrinsic ? intrinsic.height / intrinsic.width : 0.75;
    return { width, height: Math.round(width * ratio) };
  }
  if (intrinsic) {
    const ratio = intrinsic.height / intrinsic.width;
    let w = intrinsic.width > CONTENT_WIDTH_PX ? CONTENT_WIDTH_PX : intrinsic.width;
    let h = Math.round(w * ratio);
    if (maxHeightPx !== undefined && h > maxHeightPx) {
      h = maxHeightPx;
      w = Math.round(h / ratio);
    }
    return { width: w, height: h };
  }
  return { width: 400, height: 300 };
}
