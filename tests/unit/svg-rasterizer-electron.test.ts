import { describe, it, expect, vi } from "vitest";
import {
  createElectronSvgRasterizer,
  type SvgRasterRuntime,
  type SvgRasterWindow,
} from "../../src/svg-rasterizer-electron";

const SVG_279x364 =
  '<svg xmlns="http://www.w3.org/2000/svg" width="278.6953125" height="364.2890625" viewBox="0 0 278.7 364.3"><rect/></svg>';

const SVG_VIEWBOX_ONLY = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect/></svg>';

function fakeRuntime() {
  const calls = {
    openedWidth: 0,
    openedHeight: 0,
    writtenHtml: "",
    tempPath: "",
    loadedFile: undefined as string | undefined,
    destroyed: false,
    removed: undefined as string | undefined,
  };
  const win: SvgRasterWindow = {
    loadFile: vi.fn(async (p: string) => {
      calls.loadedFile = p;
    }),
    capturePNG: vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer),
    destroy: vi.fn(() => {
      calls.destroyed = true;
    }),
  };
  const runtime: SvgRasterRuntime = {
    openWindow: vi.fn((width: number, height: number) => {
      calls.openedWidth = width;
      calls.openedHeight = height;
      return win;
    }),
    writeTempSvg: vi.fn(async (html: string) => {
      calls.writtenHtml = html;
      calls.tempPath = "/tmp/trueexport-test-abc.html";
      return calls.tempPath;
    }),
    removeFile: vi.fn(async (p: string) => {
      calls.removed = p;
    }),
  };
  return { runtime, win, calls };
}

describe("createElectronSvgRasterizer", () => {
  it("sizes the window to the SVG's own intrinsic dimensions × scale (not a default/generic size)", async () => {
    const { runtime, calls } = fakeRuntime();
    const svg = new TextEncoder().encode(SVG_279x364).buffer;

    await createElectronSvgRasterizer(runtime)(svg, 2);

    // 278.6953125 × 2 = 557.390625 → rounds to 557; height likewise.
    expect(calls.openedWidth).toBe(Math.round(278.6953125 * 2));
    expect(calls.openedHeight).toBe(Math.round(364.2890625 * 2));
  });

  it("falls back to viewBox size when there's no explicit width/height attribute", async () => {
    const { runtime, calls } = fakeRuntime();
    const svg = new TextEncoder().encode(SVG_VIEWBOX_ONLY).buffer;

    await createElectronSvgRasterizer(runtime)(svg, 2);

    expect(calls.openedWidth).toBe(400); // 200 × 2
    expect(calls.openedHeight).toBe(200); // 100 × 2
  });

  it("wraps the SVG in an HTML document that stretches it to fill the viewport, instead of loading the raw SVG file directly", async () => {
    // Root cause of the reported whitespace bug: a raw SVG loaded as the
    // top-level document renders at its own natural size in the corner of
    // a larger window, leaving genuine blank space in the capture. Forcing
    // width:100%/height:100% via CSS makes it fill whatever box it's given.
    const { runtime, calls } = fakeRuntime();
    const svg = new TextEncoder().encode(SVG_279x364).buffer;

    await createElectronSvgRasterizer(runtime)(svg, 2);

    expect(calls.writtenHtml).toContain("<!DOCTYPE html>");
    expect(calls.writtenHtml).toContain("width:100%;height:100%");
    expect(calls.writtenHtml).toContain(SVG_279x364);
    // Loaded via loadFile(), not a data: URL (same rationale as pdf/electron.ts).
    expect(calls.loadedFile).toBe(calls.tempPath);
    expect(calls.loadedFile!.startsWith("data:")).toBe(false);
  });

  it("returns the PRE-scale size (intended display size), not the oversampled window/PNG pixel dimensions", async () => {
    const { runtime } = fakeRuntime();
    const svg = new TextEncoder().encode(SVG_279x364).buffer;

    const result = await createElectronSvgRasterizer(runtime)(svg, 2);

    expect(result.width).toBe(Math.round(278.6953125));
    expect(result.height).toBe(Math.round(364.2890625));
  });

  it("cleans up the temp file and window on success and on failure", async () => {
    const { runtime, calls } = fakeRuntime();
    const svg = new TextEncoder().encode(SVG_279x364).buffer;

    await createElectronSvgRasterizer(runtime)(svg, 2);
    expect(calls.destroyed).toBe(true);
    expect(calls.removed).toBe(calls.tempPath);

    const { runtime: failingRuntime, win: failingWin, calls: failingCalls } = fakeRuntime();
    (failingWin.capturePNG as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("capture exploded"));
    await expect(createElectronSvgRasterizer(failingRuntime)(svg, 2)).rejects.toThrow(/exploded/);
    expect(failingCalls.destroyed).toBe(true);
    expect(failingCalls.removed).toBe(failingCalls.tempPath);
  });

  it("rejects invalid/corrupt SVG content instead of silently rendering it as text", async () => {
    // A plain text file renamed to .svg: Chromium would happily render this
    // as literal text with no exception, so this must be caught explicitly
    // (§D20) rather than "succeeding" with a meaningless capture.
    const { runtime, calls } = fakeRuntime();
    const notAnSvg = new TextEncoder().encode("just some plain text, not markup at all").buffer;

    await expect(createElectronSvgRasterizer(runtime)(notAnSvg, 2)).rejects.toThrow(/invalid|corrupt/i);
    // Rejected before ever opening a window / touching the filesystem.
    expect(runtime.openWindow).not.toHaveBeenCalled();
    expect(calls.loadedFile).toBeUndefined();
  });
});
