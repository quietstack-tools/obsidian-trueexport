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
// This sidesteps canvas entirely: render the SVG as the top-level document
// in an off-screen Electron BrowserWindow, then capture a real screenshot
// via webContents.capturePage(). That's a full page capture, not a canvas
// pixel readback, so it has no tainting restriction regardless of what the
// SVG contains.
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
  /** Write `svgText` to a fresh temp .svg file and return its absolute path. */
  writeTempSvg(svgText: string): Promise<string>;
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
    async writeTempSvg(svgText): Promise<string> {
      const os = require("os");
      const path = require("path");
      const fs = require("fs");
      const name = `trueexport-${Date.now()}-${Math.random().toString(36).slice(2)}.svg`;
      const file = path.join(os.tmpdir(), name);
      await fs.promises.writeFile(file, svgText, "utf8");
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
 */
export function createElectronSvgRasterizer(
  runtime: SvgRasterRuntime = defaultSvgRasterRuntime(),
): (svg: ArrayBuffer, scale: number) => Promise<{ data: ArrayBuffer; width: number; height: number }> {
  return async (svg, scale) => {
    const text = new TextDecoder().decode(svg);
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
      tempPath = await runtime.writeTempSvg(text);
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
