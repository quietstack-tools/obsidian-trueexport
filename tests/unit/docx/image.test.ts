import { describe, it, expect } from "vitest";
import {
  imageDimensions,
  displaySize,
  imageType,
  CONTENT_WIDTH_PX,
  contentHeightPx,
} from "../../../src/docx/image";

function pngHeader(w: number, h: number): ArrayBuffer {
  const buf = new ArrayBuffer(24);
  const v = new DataView(buf);
  v.setUint32(16, w);
  v.setUint32(20, h);
  return buf;
}
function gifHeader(w: number, h: number): ArrayBuffer {
  const buf = new ArrayBuffer(10);
  const v = new DataView(buf);
  v.setUint16(6, w, true);
  v.setUint16(8, h, true);
  return buf;
}
function bmpHeader(w: number, h: number): ArrayBuffer {
  const buf = new ArrayBuffer(26);
  const v = new DataView(buf);
  v.setInt32(18, w, true);
  v.setInt32(22, h, true);
  return buf;
}
function jpegHeader(w: number, h: number): ArrayBuffer {
  // SOI, then a SOF0 segment: FF C0, len(2), precision(1), height(2), width(2)
  const bytes = [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 0xff, w >> 8, w & 0xff];
  return Uint8Array.from(bytes).buffer;
}

describe("imageType", () => {
  it("maps MIME types, defaulting to png", () => {
    expect(imageType("image/jpeg")).toBe("jpg");
    expect(imageType("image/svg+xml")).toBe("svg");
    expect(imageType(undefined)).toBe("png");
  });
});

describe("imageDimensions", () => {
  it("reads PNG, GIF, BMP and JPEG headers", () => {
    expect(imageDimensions(pngHeader(120, 80), "image/png")).toEqual({ width: 120, height: 80 });
    expect(imageDimensions(gifHeader(64, 32), "image/gif")).toEqual({ width: 64, height: 32 });
    expect(imageDimensions(bmpHeader(200, 100), "image/bmp")).toEqual({ width: 200, height: 100 });
    expect(imageDimensions(jpegHeader(300, 150), "image/jpeg")).toEqual({ width: 300, height: 150 });
  });

  it("returns null for unknown or truncated data", () => {
    expect(imageDimensions(new ArrayBuffer(4), "image/png")).toBeNull();
    expect(imageDimensions(pngHeader(1, 1), "image/tiff")).toBeNull();
  });
});

describe("displaySize", () => {
  it("honours an explicit width and height", () => {
    expect(displaySize(pngHeader(100, 100), "image/png", 40, 20)).toEqual({ width: 40, height: 20 });
  });

  it("derives height from width using the intrinsic aspect ratio", () => {
    expect(displaySize(pngHeader(200, 100), "image/png", 50)).toEqual({ width: 50, height: 25 });
  });

  it("caps an oversized intrinsic width to the content width", () => {
    const size = displaySize(pngHeader(2000, 1000), "image/png");
    expect(size.width).toBe(CONTENT_WIDTH_PX);
    expect(size.height).toBe(Math.round(CONTENT_WIDTH_PX * 0.5));
  });

  it("falls back to a default when dimensions are unknown", () => {
    expect(displaySize(new ArrayBuffer(2), undefined)).toEqual({ width: 400, height: 300 });
  });

  it("caps a normal-proportioned but very tall unresized image to both the width AND height ceilings", () => {
    // 3000x6500 is normal-ish proportions (not a resize), just large enough
    // that width-only capping still leaves it far taller than a page —
    // the bug: 6.5"w x 14.06"h against an ~11" tall Letter page.
    const maxHeight = contentHeightPx("Letter", "portrait");
    const size = displaySize(pngHeader(3000, 6500), "image/png", undefined, undefined, maxHeight);
    expect(size.height).toBeLessThanOrEqual(maxHeight);
    expect(size.width).toBeLessThanOrEqual(CONTENT_WIDTH_PX);
    // Aspect ratio preserved (within rounding).
    expect(size.width / size.height).toBeCloseTo(3000 / 6500, 2);
  });

  it("does not shrink an image that already fits within both caps", () => {
    const maxHeight = contentHeightPx("Letter", "portrait");
    const size = displaySize(pngHeader(200, 100), "image/png", undefined, undefined, maxHeight);
    expect(size).toEqual({ width: 200, height: 100 });
  });

  it("uses the `intended` size instead of the raw PNG header, when given (2x-oversampled rasterised images)", () => {
    // The PNG's own header (read via imageDimensions()) reports 558x728 —
    // what a 279x364 diagram rasterised at 2x for sharpness actually
    // produces as pixel data. `intended` (279x364) is the physical size it
    // should DISPLAY at; using the raw header directly here is the exact
    // bug this fix addresses — it would show at roughly double size.
    const size = displaySize(pngHeader(558, 728), "image/png", undefined, undefined, undefined, {
      width: 279,
      height: 364,
    });
    expect(size).toEqual({ width: 279, height: 364 });
  });

  it("still applies the content-width cap to an `intended` size, same as an ordinary intrinsic size", () => {
    const oversizedIntended = { width: 3000, height: 1500 }; // 2:1 ratio, well over CONTENT_WIDTH_PX
    const size = displaySize(pngHeader(6000, 3000), "image/png", undefined, undefined, undefined, oversizedIntended);
    expect(size.width).toBe(CONTENT_WIDTH_PX);
    expect(size.height).toBe(Math.round(CONTENT_WIDTH_PX * 0.5));
  });

  it("leaves an explicit |width resize alone even if the result is tall relative to the page", () => {
    // Deliberate user choice — see displaySize()'s doc comment for why this
    // differs from the fully-automatic case.
    const maxHeight = contentHeightPx("Letter", "portrait");
    const size = displaySize(pngHeader(100, 5000), "image/png", 100, undefined, maxHeight);
    expect(size).toEqual({ width: 100, height: 5000 });
    expect(size.height).toBeGreaterThan(maxHeight);
  });

  it("leaves an explicit width+height resize alone too", () => {
    const maxHeight = contentHeightPx("Letter", "portrait");
    const size = displaySize(pngHeader(100, 100), "image/png", 50, 5000, maxHeight);
    expect(size).toEqual({ width: 50, height: 5000 });
  });
});

describe("contentHeightPx", () => {
  it("computes usable page height in px (page height minus 1in top+bottom margins, at 96 DPI)", () => {
    // Letter: 15840 twips tall, minus 2*1440 margin = 12960 twips = 9in = 864px.
    expect(contentHeightPx("Letter", "portrait")).toBe(864);
  });

  it("swaps to the page WIDTH as the height ceiling in landscape orientation", () => {
    // Letter landscape means an 11"x8.5" page — the usable HEIGHT ceiling
    // comes from the page's twips WIDTH (12240 = 8.5in), not its twips
    // height, so it's smaller than the portrait ceiling (11in tall page).
    const portrait = contentHeightPx("Letter", "portrait");
    const landscape = contentHeightPx("Letter", "landscape");
    expect(landscape).not.toBe(portrait);
    expect(landscape).toBeLessThan(portrait);
  });

  it("differs by page size (A4 vs Letter vs Legal), not a hardcoded assumption", () => {
    const a4 = contentHeightPx("A4", "portrait");
    const letter = contentHeightPx("Letter", "portrait");
    const legal = contentHeightPx("Legal", "portrait");
    expect(new Set([a4, letter, legal]).size).toBe(3);
  });
});
