import { describe, it, expect, vi } from "vitest";
import {
  createElectronImageRasterizer,
  type ImageRasterRuntime,
  type ImageRasterWindow,
} from "../../src/image-rasterizer-electron";

function fakeRuntime(naturalSize: { width: number; height: number } | null = { width: 1200, height: 675 }) {
  const calls = {
    openedWidth: 0,
    openedHeight: 0,
    writtenHtml: "",
    tempPath: "",
    loadedFile: undefined as string | undefined,
    resizedTo: undefined as { width: number; height: number } | undefined,
    destroyed: false,
    removed: undefined as string | undefined,
  };
  const win: ImageRasterWindow = {
    loadFile: vi.fn(async (p: string) => {
      calls.loadedFile = p;
    }),
    getNaturalSize: vi.fn(async () => naturalSize),
    setContentSize: vi.fn(async (width: number, height: number) => {
      calls.resizedTo = { width, height };
    }),
    capturePNG: vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer),
    destroy: vi.fn(() => {
      calls.destroyed = true;
    }),
  };
  const runtime: ImageRasterRuntime = {
    openWindow: vi.fn((width: number, height: number) => {
      calls.openedWidth = width;
      calls.openedHeight = height;
      return win;
    }),
    writeTempImage: vi.fn(async (html: string) => {
      calls.writtenHtml = html;
      calls.tempPath = "/tmp/trueexport-img-test-abc.html";
      return calls.tempPath;
    }),
    removeFile: vi.fn(async (p: string) => {
      calls.removed = p;
    }),
  };
  return { runtime, win, calls };
}

// Real AVIF bytes aren't needed here — the orchestration is format-agnostic
// (it captures WHATEVER the browser decodes); a stand-in buffer is enough.
const AVIF_BYTES = new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]).buffer;

describe("createElectronImageRasterizer", () => {
  it("wraps the image as a data: URI <img>, loaded via loadFile (not a raw data: URL)", async () => {
    const { runtime, calls } = fakeRuntime();

    await createElectronImageRasterizer(runtime)(AVIF_BYTES, "image/avif");

    expect(calls.writtenHtml).toContain("<!DOCTYPE html>");
    expect(calls.writtenHtml).toContain('<img id="i" src="data:image/avif;base64,');
    expect(calls.loadedFile).toBe(calls.tempPath);
    expect(calls.loadedFile!.startsWith("data:")).toBe(false);
  });

  it("resizes the window to the image's REAL decoded natural size, not a pre-guessed one", async () => {
    const { runtime, calls } = fakeRuntime({ width: 1200, height: 675 });

    await createElectronImageRasterizer(runtime)(AVIF_BYTES, "image/avif");

    expect(calls.resizedTo).toEqual({ width: 1200, height: 675 });
  });

  it("opens a small initial window — natural size isn't known until after load/decode", async () => {
    const { runtime, calls } = fakeRuntime();
    await createElectronImageRasterizer(runtime)(AVIF_BYTES, "image/avif");
    // Small and fixed, unlike the SVG rasterizer which pre-sizes from markup.
    expect(calls.openedWidth).toBeLessThanOrEqual(32);
    expect(calls.openedHeight).toBeLessThanOrEqual(32);
  });

  it("returns the captured PNG bytes", async () => {
    const { runtime } = fakeRuntime();
    const result = await createElectronImageRasterizer(runtime)(AVIF_BYTES, "image/avif");
    expect(new Uint8Array(result).slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  it("throws when the image fails to decode (getNaturalSize returns null)", async () => {
    const { runtime, calls } = fakeRuntime(null);
    await expect(createElectronImageRasterizer(runtime)(AVIF_BYTES, "image/avif")).rejects.toThrow(/decode/i);
    // Still cleans up even on failure.
    expect(calls.destroyed).toBe(true);
    expect(calls.removed).toBe(calls.tempPath);
  });

  it("cleans up the temp file and window on success and on capture failure", async () => {
    const { runtime, calls } = fakeRuntime();
    await createElectronImageRasterizer(runtime)(AVIF_BYTES, "image/avif");
    expect(calls.destroyed).toBe(true);
    expect(calls.removed).toBe(calls.tempPath);

    const { runtime: failingRuntime, win: failingWin, calls: failingCalls } = fakeRuntime();
    (failingWin.capturePNG as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("capture exploded"));
    await expect(createElectronImageRasterizer(failingRuntime)(AVIF_BYTES, "image/avif")).rejects.toThrow(
      /exploded/,
    );
    expect(failingCalls.destroyed).toBe(true);
    expect(failingCalls.removed).toBe(failingCalls.tempPath);
  });
});
