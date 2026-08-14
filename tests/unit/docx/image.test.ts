import { describe, it, expect } from "vitest";
import { imageDimensions, displaySize, imageType, CONTENT_WIDTH_PX } from "../../../src/docx/image";

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
});
