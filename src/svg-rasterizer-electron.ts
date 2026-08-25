// src/svg-rasterizer-electron.ts
//
// Electron-based SVG→PNG rasterisation (§4.9). Same manual-verification
// category as src/pdf/electron.ts (depends on Electron's renderer process
// and Node fs/os APIs — can't run in the test environment).
//
// Why this exists instead of the obvious canvas approach (drawImage +
// getImageData/toBlob): confirmed via manual testing with a real Mermaid
// diagram — canvas.getImageData()/toBlob() throw a SecurityError
// ("The canvas has been tainted by cross-origin data" / "Tainted canvases
// may not be exported") for ANY SVG containing <foreignObject> HTML
// content, even one loaded from a same-origin blob: URL with no actual
// cross-origin data. This is a real, documented Chromium restriction
// specific to foreignObject, not an origin problem — and Mermaid's own
// default label rendering (v9+) uses <foreignObject><p>…</p></foreignObject>
// for every node/edge label, so every real diagram hit it.
//
// This sidesteps canvas entirely: render the SVG in an off-screen Electron
// BrowserWindow, then capture a real screenshot via webContents.capturePage().
// That's a full page capture, not a canvas pixel readback, so it has no
// tainting restriction regardless of what the SVG contains. The SVG is
// wrapped in a minimal HTML document (wrapSvgHtml()) rather than loaded as
// the top-level document directly — a raw SVG document renders at its own
// natural size in the corner of the window rather than filling it, which
// left genuine blank space in the captured PNG beyond the diagram's own
// bounds (confirmed by manual test) when the window was sized larger than
// that natural size for the deliberate oversampling scale factor.
//
// Same architecture as src/pdf/electron.ts: write to a temp file (not a
// data: URL — avoids the URL-length concern already flagged there) and
// load it with loadFile(); Electron/Node bits behind an injectable runtime
// so the orchestration is unit-testable without Electron; the default
// runtime lazily requires the real modules and is only ever constructed on
// desktop.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** An off-screen window that can load a local file and capture it as a PNG. */
export interface SvgRasterWindow {
  loadFile(path: string): Promise<void>;
  capturePNG(): Promise<ArrayBuffer>;
  destroy(): void;
}

/** The Electron/Node capabilities the seam needs, injected for testability. */
export interface SvgRasterRuntime {
  /** Open a hidden, sandboxed off-screen BrowserWindow at the given content size. */
  openWindow(width: number, height: number): SvgRasterWindow;
  /**
   * Write `html` (an HTML document wrapping the SVG — see wrapSvgHtml())
   * to a fresh temp .html file and return its absolute path.
   */
  writeTempSvg(html: string): Promise<string>;
  /** Delete a temp file; must never throw. */
  removeFile(path: string): Promise<void>;
}

function loadRemote(): any {
  // Obsidian desktop exposes Electron; @electron/remote provides BrowserWindow
  // from the renderer. Try the modern module, then the legacy `remote` export
  // (same fallback as src/pdf/electron.ts, for consistency).
  try {
    return require("@electron/remote");
  } catch {
    return require("electron").remote;
  }
}

function toArrayBuffer(buf: { buffer: ArrayBuffer; byteOffset: number; byteLength: number }): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** The real runtime: Electron's BrowserWindow plus Node's fs/os/path. */
export function defaultSvgRasterRuntime(): SvgRasterRuntime {
  return {
    openWindow(width, height): SvgRasterWindow {
      const remote = loadRemote();
      const win = new remote.BrowserWindow({
        width,
        height,
        useContentSize: true, // width/height above are the CONTENT area, matching the SVG's own dimensions exactly.
        show: false,
        transparent: true, // preserve the SVG's own transparency, matching the old canvas approach's default-transparent background.
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });
      return {
        loadFile: (path) => win.loadFile(path),
        capturePNG: async () => {
          const image = await win.webContents.capturePage();
          return toArrayBuffer(image.toPNG());
        },
        destroy: () => win.destroy(),
      };
    },
    async writeTempSvg(html): Promise<string> {
      const os = require("os");
      const path = require("path");
      const fs = require("fs");
      const name = `trueexport-${Date.now()}-${Math.random().toString(36).slice(2)}.html`;
      const file = path.join(os.tmpdir(), name);
      await fs.promises.writeFile(file, html, "utf8");
      return file;
    },
    async removeFile(path): Promise<void> {
      const fs = require("fs");
      await fs.promises.unlink(path).catch(() => undefined);
    },
  };
}

/** Read explicit width/height attributes off the root <svg> element, if present. */
function explicitSize(svgText: string): { width: number; height: number } | null {
  const w = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)(?:px)?["']/.exec(svgText);
  const h = /<svg[^>]*\sheight\s*=\s*["']([\d.]+)(?:px)?["']/.exec(svgText);
  if (!w || !h) return null;
  const width = Number(w[1]);
  const height = Number(h[1]);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Read width/height from an SVG's viewBox (`minX minY width height`), if present. */
function viewBoxSize(svgText: string): { width: number; height: number } | null {
  const match = /viewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/.exec(svgText);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Wrap the SVG in a minimal HTML document that forces it to fill the whole
 * viewport, rather than loading the raw .svg file directly as the top-level
 * document.
 *
 * Confirmed by manual test: loading a raw SVG file directly renders it at
 * its OWN natural/intrinsic size in the top-left of the BrowserWindow's
 * viewport — it does NOT stretch to fill a larger window even when the
 * window is deliberately sized bigger (for the 2× oversampling scale
 * factor). capturePage() then captured the whole (larger) viewport,
 * including the genuinely blank remainder beyond the SVG's own bounds — a
 * diagram that should fill the frame instead occupied only its top-left
 * portion. `width:100%;height:100%` on the svg element makes it fill
 * whatever box CSS gives it; the svg's own `viewBox` (unaffected by CSS
 * sizing) still controls internal scaling, and since the window's aspect
 * ratio is deliberately set to match the SVG's own aspect ratio, the
 * default `preserveAspectRatio` ("meet"/contain-fit) fills the box exactly
 * with no letterboxing.
 */
function wrapSvgHtml(svgText: string): string {
  return (
    "<!DOCTYPE html><html><head><style>" +
    "html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent}" +
    "svg{display:block;width:100%;height:100%}" +
    "</style></head><body>" +
    svgText +
    "</body></html>"
  );
}

/**
 * Create the desktop SVG→PNG rasteriser. Call only on desktop (needs
 * Electron). `runtime` is injectable so the orchestration can be tested
 * without Electron.
 *
 * Returns the intended DISPLAY size alongside the PNG bytes, not just the
 * data. The PNG is rasterised at `scale`× the SVG's own size for sharpness
 * (2× is used for Mermaid diagrams) — its raw pixel dimensions are
 * therefore `scale` times larger than the size it should actually display
 * at. Without `width`/`height` here, a caller reading the PNG's own pixel
 * dimensions (the only signal otherwise available) would render it at its
 * oversampled pixel size read as 96dpi — e.g. a 279×364 diagram rasterised
 * at 2× (558×728px) would display at roughly double its intended physical
 * size, filling most of a page instead of reading as a compact diagram
 * (confirmed by manual test).
 *
 * Note on absolute captured pixel count: capturePage() captures at the
 * host display's own device pixel ratio (e.g. 2× on a Retina Mac), which
 * compounds with the `scale` requested here — a 279×364 diagram at
 * `scale: 2` on a Retina host produces a ~1114×1458px PNG, not exactly
 * 558×728px (confirmed by manual test). Not fixed here: aspect ratio and
 * frame-filling are both still correct regardless of the exact multiplier,
 * and forcing a specific device scale factor would need a global Electron
 * command-line switch affecting the whole app, not a targeted per-window
 * setting — judged not worth that trade-off for a cosmetic sharpness
 * variance across host machines.
 */
/**
 * A minimal well-formedness check: is there an `<svg …>` (or self-closing
 * `<svg …/>`) root tag anywhere in the text? Loading arbitrary non-SVG
 * content (e.g. a plain text file renamed to .svg) into the off-screen
 * window below doesn't throw — Chromium happily renders it as literal text
 * — so without this check a corrupt/invalid SVG silently "succeeds",
 * producing a meaningless captured image with none of the
 * warning-and-placeholder degradation the rest of the pipeline expects for
 * a failed rasterisation (§4.9). This mirrors that same requirement for the
 * genuinely-corrupt-file case, not just genuine rendering/canvas failures.
 */
function isWellFormedSvg(text: string): boolean {
  return /<svg[\s>]/i.test(text);
}

export function createElectronSvgRasterizer(
  runtime: SvgRasterRuntime = defaultSvgRasterRuntime(),
): (svg: ArrayBuffer, scale: number) => Promise<{ data: ArrayBuffer; width: number; height: number }> {
  return async (svg, scale) => {
    const text = new TextDecoder().decode(svg);
    if (!isWellFormedSvg(text)) {
      throw new Error("Invalid or corrupt SVG content");
    }
    // No <img>/naturalWidth available in this approach (there's no <img>
    // element at all) — size comes entirely from the SVG's own markup:
    // explicit width/height attributes first (most authoritative), then
    // viewBox, then a sane default.
    const size = explicitSize(text) ?? viewBoxSize(text) ?? { width: 300, height: 150 };
    const pixelWidth = Math.max(1, Math.round(size.width * scale));
    const pixelHeight = Math.max(1, Math.round(size.height * scale));

    const win = runtime.openWindow(pixelWidth, pixelHeight);
    let tempPath: string | undefined;
    try {
      tempPath = await runtime.writeTempSvg(wrapSvgHtml(text));
      await win.loadFile(tempPath);
      const png = await win.capturePNG();
      // Intended DISPLAY size — size.width/height BEFORE the scale
      // multiplier, not the oversampled pixelWidth/pixelHeight the window
      // and PNG actually used.
      return { data: png, width: Math.max(1, Math.round(size.width)), height: Math.max(1, Math.round(size.height)) };
    } finally {
      win.destroy();
      if (tempPath !== undefined) await runtime.removeFile(tempPath);
    }
  };
}
