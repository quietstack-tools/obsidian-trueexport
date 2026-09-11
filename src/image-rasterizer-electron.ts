// src/image-rasterizer-electron.ts
//
// Electron-based transcoding of raster image formats Word can't natively
// embed (AVIF, WebP, …) to PNG (§D25). Same manual-verification category as
// src/svg-rasterizer-electron.ts and src/pdf/electron.ts — depends on
// Electron's renderer process, can't run in the test environment.
//
// Root cause this exists for: a remote/local image can genuinely be a valid,
// perfectly decodable AVIF or WebP file (both are now common DEFAULT formats
// on modern sites/CDNs), but Word's own image support is limited to
// PNG/JPEG/GIF/BMP (plus a few legacy formats) — Mac Word rejects AVIF
// outright, and Windows Word only decodes it if the user separately
// installed an OS-level AV1 codec extension Word doesn't bundle. Embedding
// the raw AVIF/WebP bytes anyway (declared as PNG, since that's this
// renderer's fallback default) hands Word data it may not be able to open
// at all — the visible "squashed aspect ratio" a prior investigation found
// was very likely a broken-image glyph forced into the wrong-sized box, not
// a genuine (if distorted) image render.
//
// Same architecture as the SVG rasterizer: render in a hidden, off-screen
// BrowserWindow and capture a real screenshot via webContents.capturePage()
// — Chromium (Electron's own substrate) already decodes AVIF/WebP natively,
// which is why the browser could download and preview the image at all; this
// just captures that decode as PNG pixels instead of re-embedding the
// original bytes. No new dependency (no WASM decoder library, no native
// bindings) — reuses the exact capture mechanism already proven for SVG.
//
// Unlike the SVG rasterizer, there's no markup to parse a width/height out
// of ahead of time — a raster image's real pixel size is only knowable by
// letting the browser decode it. So the window opens small, loads the
// image, asks the page (via executeJavaScript) for the loaded <img>'s
// naturalWidth/naturalHeight once decoded, resizes the window's content
// area to match exactly, then captures — cropping to precisely the image's
// own bounds with no extra blank space, same end result as the SVG
// rasterizer's pre-computed sizing, just derived after load instead of
// before.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** An off-screen window that loads an image, reports its real size, and captures it. */
export interface ImageRasterWindow {
  loadFile(path: string): Promise<void>;
  /**
   * Wait for the wrapped `<img>` to finish loading (or fail/time out) and
   * report its real decoded pixel size. Null on load failure or timeout —
   * the caller treats that the same as any other transcode failure.
   */
  getNaturalSize(): Promise<{ width: number; height: number } | null>;
  /** Resize the window's CONTENT area to exactly this size, waiting for the resulting repaint before returning. */
  setContentSize(width: number, height: number): Promise<void>;
  capturePNG(): Promise<ArrayBuffer>;
  destroy(): void;
}

/** The Electron/Node capabilities the seam needs, injected for testability. */
export interface ImageRasterRuntime {
  /** Open a hidden, sandboxed off-screen BrowserWindow at a small initial content size. */
  openWindow(initialWidth: number, initialHeight: number): ImageRasterWindow;
  /** Write `html` (an HTML document wrapping the image as a data: URI) to a fresh temp .html file and return its path. */
  writeTempImage(html: string): Promise<string>;
  /** Delete a temp file; must never throw. */
  removeFile(path: string): Promise<void>;
}

function loadRemote(): any {
  // Same fallback as src/svg-rasterizer-electron.ts / src/pdf/electron.ts.
  try {
    return require("@electron/remote");
  } catch {
    return require("electron").remote;
  }
}

function toArrayBuffer(buf: { buffer: ArrayBuffer; byteOffset: number; byteLength: number }): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** Waits for the page to settle on two animation frames — lets Chromium repaint after a resize before capturePage() reads pixels. */
const WAIT_FOR_REPAINT_SCRIPT = "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))";

/** Waits for the wrapped `<img id="i">` to load/fail/time out, then resolves its natural size (or null). */
const NATURAL_SIZE_SCRIPT = `
new Promise((resolve) => {
  var img = document.getElementById('i');
  function done() {
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    } else {
      resolve(null);
    }
  }
  if (img.complete) { done(); return; }
  img.addEventListener('load', done);
  img.addEventListener('error', function () { resolve(null); });
  setTimeout(function () { resolve(null); }, 5000);
})
`;

/** The real runtime: Electron's BrowserWindow plus Node's fs/os/path. */
export function defaultImageRasterRuntime(): ImageRasterRuntime {
  return {
    openWindow(initialWidth, initialHeight): ImageRasterWindow {
      const remote = loadRemote();
      const win = new remote.BrowserWindow({
        width: initialWidth,
        height: initialHeight,
        useContentSize: true,
        show: false,
        transparent: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });
      return {
        loadFile: (path) => win.loadFile(path),
        getNaturalSize: async () => {
          try {
            const result = await win.webContents.executeJavaScript(NATURAL_SIZE_SCRIPT, true);
            return result ?? null;
          } catch {
            return null;
          }
        },
        setContentSize: async (width, height) => {
          win.setContentSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
          // Resizing doesn't synchronously repaint — wait a couple of frames
          // so capturePage() below reads the image at its new, correct size
          // rather than a stale/partial frame from before the resize.
          await win.webContents.executeJavaScript(WAIT_FOR_REPAINT_SCRIPT, true).catch(() => undefined);
        },
        capturePNG: async () => {
          const image = await win.webContents.capturePage();
          return toArrayBuffer(image.toPNG());
        },
        destroy: () => win.destroy(),
      };
    },
    async writeTempImage(html): Promise<string> {
      const os = require("os");
      const path = require("path");
      const fs = require("fs");
      const name = `trueexport-img-${Date.now()}-${Math.random().toString(36).slice(2)}.html`;
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

function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Wrap the image as a data: URI `<img>`, NOT stretched via CSS — unlike the
 * SVG rasterizer's `wrapSvgHtml()`, we deliberately let the image render at
 * its own intrinsic size so `naturalWidth`/`naturalHeight` (read via
 * NATURAL_SIZE_SCRIPT) reflect the image's real decoded dimensions,
 * unaffected by any box we'd otherwise force it into.
 */
function wrapImageHtml(dataUri: string): string {
  return (
    "<!DOCTYPE html><html><head><style>" +
    "html,body{margin:0;padding:0;background:transparent}" +
    "img{display:block}" +
    "</style></head><body>" +
    `<img id="i" src="${dataUri}">` +
    "</body></html>"
  );
}

// A small initial window is enough — naturalWidth/naturalHeight are decoded
// image properties, independent of viewport size or visual clipping, so the
// window doesn't need to be pre-sized to fit the image (unlike the SVG
// rasterizer, which fills a window sized to match its content for capture).
const INITIAL_WINDOW_PX = 16;

/**
 * Create the desktop image→PNG transcoder. Call only on desktop (needs
 * Electron). `runtime` is injectable so the orchestration can be tested
 * without Electron. Throws if the image can't be decoded/captured — the
 * caller (src/docx/index.ts) degrades to a placeholder + warning on failure,
 * exactly like a failed SVG rasterisation.
 */
export function createElectronImageRasterizer(
  runtime: ImageRasterRuntime = defaultImageRasterRuntime(),
): (data: ArrayBuffer, mimeType: string) => Promise<ArrayBuffer> {
  return async (data, mimeType) => {
    const dataUri = `data:${mimeType};base64,${toBase64(data)}`;
    const win = runtime.openWindow(INITIAL_WINDOW_PX, INITIAL_WINDOW_PX);
    let tempPath: string | undefined;
    try {
      tempPath = await runtime.writeTempImage(wrapImageHtml(dataUri));
      await win.loadFile(tempPath);
      const size = await win.getNaturalSize();
      if (!size) throw new Error("Could not decode image data");
      await win.setContentSize(size.width, size.height);
      return await win.capturePNG();
    } finally {
      win.destroy();
      if (tempPath !== undefined) await runtime.removeFile(tempPath);
    }
  };
}
