import { describe, it, expect } from "vitest";
import {
  imageDimensions,
  displaySize,
  imageType,
  sniffImageFormat,
  sniffAnyImageFormat,
  isEmbeddableRasterFormat,
  imageFormatLabel,
  CONTENT_WIDTH_PX,
  contentHeightPx,
} from "../../../src/docx/image";

// Real AVIF signature bytes (matches a live report this session: an AVIF
// photo whose first bytes were exactly `00 00 00 1c 66 74 79 70 61 76 69 66`
// — box size, "ftyp", major brand "avif").
function avifHeader(): ArrayBuffer {
  return new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]).buffer;
}
function avisHeader(): ArrayBuffer {
  return new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x73]).buffer;
}
function webpHeader(): ArrayBuffer {
  // "RIFF"<4-byte size>"WEBP"
  return new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]).buffer;
}

// Deliberately NOT a real PNG signature (bytes 0-7 are left zeroed) — these
// headers exist purely to exercise the IHDR-offset size-reading logic, and
// their lack of a real signature means sniffImageFormat() can't identify them
// either, so imageDimensions()/imageType() fall back to the declared
// mimeType argument, exactly like before sniffing was added (§D25).
function pngHeader(w: number, h: number): ArrayBuffer {
  const buf = new ArrayBuffer(24);
  const v = new DataView(buf);
  v.setUint32(16, w);
  v.setUint32(20, h);
  return buf;
}
// A REAL PNG signature (bytes 0-7) followed by an IHDR carrying w/h — used
// specifically to exercise sniffImageFormat() and the declared-mimeType-is-
// wrong scenario, which pngHeader() above can't (no real signature).
function realPngHeader(w: number, h: number): ArrayBuffer {
  const buf = new ArrayBuffer(24);
  const v = new DataView(buf);
  v.setUint32(0, 0x89504e47);
  v.setUint32(4, 0x0d0a1a0a);
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
    expect(imageType(new ArrayBuffer(0), "image/jpeg")).toBe("jpg");
    expect(imageType(new ArrayBuffer(0), "image/svg+xml")).toBe("svg");
    expect(imageType(new ArrayBuffer(0), undefined)).toBe("png");
  });

  it("D25: uses the SNIFFED format over a mismatched declared mimeType", () => {
    // Real JPEG bytes mislabelled as image/png — the sniffed signature wins.
    expect(imageType(jpegHeader(10, 10), "image/png")).toBe("jpg");
  });
});

describe("sniffImageFormat", () => {
  it("identifies PNG, JPEG, GIF and BMP from their magic bytes", () => {
    expect(sniffImageFormat(realPngHeader(1, 1))).toBe("image/png");
    expect(sniffImageFormat(jpegHeader(1, 1))).toBe("image/jpeg");
    expect(sniffImageFormat(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]).buffer)).toBe("image/gif");
    expect(sniffImageFormat(Uint8Array.from([0x42, 0x4d, 0, 0, 0, 0]).buffer)).toBe("image/bmp");
  });

  it("returns null for data with no recognisable signature", () => {
    expect(sniffImageFormat(new ArrayBuffer(4))).toBeNull();
    expect(sniffImageFormat(pngHeader(1, 1))).toBeNull(); // no real signature, see pngHeader()'s doc comment
  });

  it("D25: does NOT identify AVIF/WebP as one of the four embeddable formats", () => {
    // sniffImageFormat() is scoped to what Word can actually embed —
    // sniffAnyImageFormat() below is the superset that also recognises these.
    expect(sniffImageFormat(avifHeader())).toBeNull();
    expect(sniffImageFormat(webpHeader())).toBeNull();
  });
});

describe("sniffAnyImageFormat (§D25)", () => {
  it("identifies AVIF (still image and image-sequence major brands) from its ISOBMFF ftyp box", () => {
    expect(sniffAnyImageFormat(avifHeader())).toBe("image/avif");
    expect(sniffAnyImageFormat(avisHeader())).toBe("image/avif");
  });

  it("identifies WebP from its RIFF/WEBP container header", () => {
    expect(sniffAnyImageFormat(webpHeader())).toBe("image/webp");
  });

  it("still identifies the four embeddable formats too (superset of sniffImageFormat)", () => {
    expect(sniffAnyImageFormat(realPngHeader(1, 1))).toBe("image/png");
    expect(sniffAnyImageFormat(jpegHeader(1, 1))).toBe("image/jpeg");
  });

  it("returns null for genuinely unrecognisable data", () => {
    expect(sniffAnyImageFormat(new ArrayBuffer(4))).toBeNull();
  });
});

describe("isEmbeddableRasterFormat (§D25)", () => {
  it("is true for the four natively-embeddable raster formats", () => {
    expect(isEmbeddableRasterFormat(realPngHeader(1, 1), "image/png")).toBe(true);
    expect(isEmbeddableRasterFormat(jpegHeader(1, 1), "image/jpeg")).toBe(true);
  });

  it("is false for AVIF and WebP — Word can't natively embed either", () => {
    expect(isEmbeddableRasterFormat(avifHeader(), "image/avif")).toBe(false);
    expect(isEmbeddableRasterFormat(webpHeader(), "image/webp")).toBe(false);
  });

  it("trusts the sniffed bytes over a wrong declared mimeType either way", () => {
    // Real PNG bytes mislabelled as AVIF — still embeddable, because sniffing wins.
    expect(isEmbeddableRasterFormat(realPngHeader(1, 1), "image/avif")).toBe(true);
    // Real AVIF bytes mislabelled as PNG — NOT embeddable; the mislabel doesn't help.
    expect(isEmbeddableRasterFormat(avifHeader(), "image/png")).toBe(false);
  });
});

describe("imageFormatLabel", () => {
  it("gives AVIF/WebP a friendly name for warnings/placeholders", () => {
    expect(imageFormatLabel("image/avif")).toBe("AVIF");
    expect(imageFormatLabel("image/webp")).toBe("WebP");
  });

  it("passes an unrecognised format string through unchanged", () => {
    expect(imageFormatLabel("image/heic")).toBe("image/heic");
  });
});

describe("imageDimensions", () => {
  it("reads PNG, GIF, BMP and JPEG headers", () => {
    expect(imageDimensions(pngHeader(120, 80), "image/png")).toEqual({ width: 120, height: 80 });
    expect(imageDimensions(gifHeader(64, 32), "image/gif")).toEqual({ width: 64, height: 32 });
    expect(imageDimensions(bmpHeader(200, 100), "image/bmp")).toEqual({ width: 200, height: 100 });
    expect(imageDimensions(jpegHeader(300, 150), "image/jpeg")).toEqual({ width: 300, height: 150 });
  });

  // D25: root cause of the reported remote-image distortion. A remote host
  // can send a real-but-non-canonical Content-Type (e.g. the legacy alias
  // "image/x-png" for a genuinely valid PNG) — the exact scenario that
  // reproduced the reported bug byte-for-byte (a 1200x675 PNG squashed to
  // the generic 400x300/4:3 fallback because "image/x-png" !== "image/png").
  it("reads real dimensions from the ACTUAL bytes even when the declared mimeType is non-canonical/wrong", () => {
    expect(imageDimensions(realPngHeader(1200, 675), "image/x-png")).toEqual({ width: 1200, height: 675 });
    // Local vault images go through the exact same function — same fix,
    // same code path, not a remote-only patch.
    expect(imageDimensions(realPngHeader(1200, 675), "application/octet-stream")).toEqual({
      width: 1200,
      height: 675,
    });
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
