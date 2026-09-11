import { describe, it, expect, vi } from "vitest";
import { WarningCollector } from "../../../src/core/warnings";
import { renderToDocx } from "../../helpers/render-docx";
import type { DocxDeps } from "../../../src/docx";

// D25: a raster image format Word can't natively embed (AVIF, WebP) must
// NOT be embedded as raw, undecodable bytes — it's transcoded to PNG via the
// injected Electron capture capability (rasterizeImage), or degrades to a
// placeholder + warning when that capability is absent (mobile) or fails —
// mirroring the SVG-rasterisation-failure pattern exactly.

// Real AVIF signature: box size, "ftyp", major brand "avif" (matches a live
// report this session byte-for-byte).
const AVIF_BYTES = new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]).buffer;
// Real WebP signature: "RIFF"<size>"WEBP".
const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]).buffer;

function realPng(width: number, height: number): ArrayBuffer {
  const buf = new ArrayBuffer(33);
  const view = new DataView(buf);
  view.setUint32(0, 0x89504e47);
  view.setUint32(4, 0x0d0a1a0a);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return buf;
}

function extent(documentXml: string): { cx: number; cy: number } {
  const m = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(documentXml);
  if (!m) throw new Error("no <wp:extent> found in rendered document.xml");
  return { cx: Number(m[1]), cy: Number(m[2]) };
}

describe("DOCX unsupported raster image formats (AVIF/WebP, §D25)", () => {
  it("transcodes a remote AVIF image to real PNG bytes and embeds it at its correct dimensions", async () => {
    const warnings = new WarningCollector();
    const rasterizeImage = vi.fn(async (_data: ArrayBuffer, mimeType: string) => {
      expect(mimeType).toBe("image/avif"); // sniffed format fed to the transcoder, not a guess
      return realPng(1200, 675);
    });
    const deps: DocxDeps = { rasterizeImage };

    const { documentXml, entries } = await renderToDocx(
      "![x](https://example.com/photo.avif)\n",
      { options: { allowRemoteImages: true }, fetchRemoteImage: async () => ({ data: AVIF_BYTES, mimeType: "image/avif" }) },
      { deps, warnings },
    );

    expect(rasterizeImage).toHaveBeenCalledOnce();
    expect(entries.some((e) => e.startsWith("word/media/"))).toBe(true);
    const { cx, cy } = extent(documentXml);
    expect(cx / cy).toBeCloseTo(1200 / 675, 3);
    expect(warnings.list().some((w) => w.construct === "image")).toBe(false);
  });

  it("transcodes a local WebP vault image the same way", async () => {
    const warnings = new WarningCollector();
    const rasterizeImage = vi.fn(async () => realPng(400, 300));
    const deps: DocxDeps = { rasterizeImage };

    const { documentXml, entries } = await renderToDocx(
      "![[photo.webp]]\n",
      { binaries: { "photo.webp": WEBP_BYTES } },
      { deps, warnings },
    );

    expect(rasterizeImage).toHaveBeenCalledOnce();
    expect(entries.some((e) => e.startsWith("word/media/"))).toBe(true);
    const { cx, cy } = extent(documentXml);
    expect(cx / cy).toBeCloseTo(400 / 300, 3);
    expect(warnings.list().some((w) => w.construct === "image")).toBe(false);
  });

  it("degrades to a placeholder + warning on MOBILE (no rasterizeImage capability), never embedding raw undecodable bytes", async () => {
    const warnings = new WarningCollector();
    // No deps at all -- the mobile/no-Electron case.
    const { documentXml, entries } = await renderToDocx(
      "![[photo.webp]]\n",
      { binaries: { "photo.webp": WEBP_BYTES } },
      { warnings },
    );

    // No media entry was embedded -- the raw WebP bytes were never written in.
    expect(entries.some((e) => e.startsWith("word/media/"))).toBe(false);
    expect(documentXml).toContain("WebP image not supported by Word");

    const imageWarnings = warnings.list().filter((w) => w.construct === "image");
    expect(imageWarnings).toHaveLength(1);
    expect(imageWarnings[0].message).toContain("photo.webp");
    expect(imageWarnings[0].message).toContain("WebP");
  });

  it("degrades to a placeholder + warning when the transcode itself fails, never crashing the export", async () => {
    const warnings = new WarningCollector();
    const rasterizeImage = vi.fn(async () => {
      throw new Error("could not decode image data");
    });
    const deps: DocxDeps = { rasterizeImage };

    // Must not throw / abort the export.
    const { documentXml, entries } = await renderToDocx(
      "![[photo.webp]]\n",
      { binaries: { "photo.webp": WEBP_BYTES } },
      { deps, warnings },
    );

    expect(rasterizeImage).toHaveBeenCalledOnce();
    expect(entries.some((e) => e.startsWith("word/media/"))).toBe(false);
    expect(documentXml).toContain("WebP image not supported by Word");

    const imageWarnings = warnings.list().filter((w) => w.construct === "image");
    expect(imageWarnings).toHaveLength(1);
    expect(imageWarnings[0].message).toContain("photo.webp");
  });

  it("does not touch ordinary PNG/JPEG images at all -- no transcode attempted", async () => {
    const rasterizeImage = vi.fn(async () => realPng(1, 1));
    const deps: DocxDeps = { rasterizeImage };

    await renderToDocx("![[photo.png]]\n", { binaries: { "photo.png": realPng(100, 50) } }, { deps });

    expect(rasterizeImage).not.toHaveBeenCalled();
  });
});
