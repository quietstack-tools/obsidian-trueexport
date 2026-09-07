import { describe, it, expect } from "vitest";
import { renderToDocx } from "../../helpers/render-docx";

// D25: a remote-fetched image displayed with a distorted aspect ratio in
// Word. Root cause: imageDimensions()/imageType() matched the declared MIME
// type string EXACTLY against "image/png" et al. — a real host can send a
// real-but-non-canonical Content-Type for a genuinely valid image (the
// legacy alias "image/x-png" is what reproduced this byte-for-byte), which
// silently failed that match and fell back to the renderer's generic
// 400x300 default, producing a real, measurable distortion for an image
// that was never actually broken. Fixed in src/docx/image.ts by sniffing
// the format from the file's own magic bytes first, falling back to the
// declared mimeType only when sniffing is inconclusive — the same shared
// sizing function local vault images already went through correctly.

function fakePng(width: number, height: number): ArrayBuffer {
  const buf = new ArrayBuffer(33);
  const view = new DataView(buf);
  view.setUint8(0, 0x89);
  view.setUint8(1, 0x50);
  view.setUint8(2, 0x4e);
  view.setUint8(3, 0x47);
  view.setUint8(4, 0x0d);
  view.setUint8(5, 0x0a);
  view.setUint8(6, 0x1a);
  view.setUint8(7, 0x0a);
  view.setUint32(8, 13);
  view.setUint8(12, 0x49);
  view.setUint8(13, 0x48);
  view.setUint8(14, 0x44);
  view.setUint8(15, 0x52);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return buf;
}

function extent(documentXml: string): { cx: number; cy: number } {
  const m = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(documentXml);
  if (!m) throw new Error("no <wp:extent> found in rendered document.xml");
  return { cx: Number(m[1]), cy: Number(m[2]) };
}

const NOTE = "![x](https://example.com/photo.png)\n";

describe("DOCX remote image sizing (§7.6, §D25)", () => {
  it("preserves aspect ratio for a remote image served with the canonical image/png Content-Type", async () => {
    const fetchRemoteImage = async () => ({ data: fakePng(1200, 675), mimeType: "image/png" });
    const { documentXml } = await renderToDocx(NOTE, { options: { allowRemoteImages: true }, fetchRemoteImage }, {});
    const { cx, cy } = extent(documentXml);
    expect(cx / cy).toBeCloseTo(1200 / 675, 3);
  });

  it("D25: preserves aspect ratio even when the server declares a non-canonical MIME type for a real PNG", async () => {
    // "image/x-png" is a real, valid legacy alias some hosts/CDNs still send
    // for genuinely valid PNGs — this exact input reproduced the reported
    // distortion (a 1200x675 image squashed to the 400x300/4:3 fallback).
    const fetchRemoteImage = async () => ({ data: fakePng(1200, 675), mimeType: "image/x-png" });
    const { documentXml } = await renderToDocx(NOTE, { options: { allowRemoteImages: true }, fetchRemoteImage }, {});
    const { cx, cy } = extent(documentXml);
    expect(cx / cy).toBeCloseTo(1200 / 675, 3);
    // Specifically NOT the generic default-size fallback this bug produced.
    expect({ cx, cy }).not.toEqual({ cx: 3810000, cy: 2857500 });
  });

  it("matches local-vault-image behaviour exactly for the same real bytes and dimensions", async () => {
    const png = fakePng(1200, 675);
    const remote = await renderToDocx(
      NOTE,
      { options: { allowRemoteImages: true }, fetchRemoteImage: async () => ({ data: png, mimeType: "image/x-png" }) },
      {},
    );
    const local = await renderToDocx("![[photo.png]]\n", { binaries: { "photo.png": png } }, {});
    expect(extent(remote.documentXml)).toEqual(extent(local.documentXml));
  });
});
