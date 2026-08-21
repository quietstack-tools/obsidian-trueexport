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

export function imageType(mimeType: string | undefined): DocxImageType {
  switch (mimeType) {
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
export function imageDimensions(data: ArrayBuffer, mimeType: string | undefined): Dimensions | null {
  const view = new DataView(data);
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
): Dimensions {
  const intrinsic = imageDimensions(data, mimeType);

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
