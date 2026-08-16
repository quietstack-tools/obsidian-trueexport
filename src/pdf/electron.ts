// src/pdf/electron.ts
//
// The Electron implementation of the HtmlToPdf seam (§5.3). This is the one
// piece that cannot run in the test environment — it depends on Electron's
// renderer process and the Node fs/os APIs — so it lives alone here and is
// flagged as a manual-verification item (same category as the Stage 6 SVG
// rasteriser).
//
// Technique: write the self-contained HTML to a temp file and load it into a
// hidden off-screen BrowserWindow with loadFile(), then call
// webContents.printToPDF. We deliberately do NOT use loadURL with a
// `data:text/html,…` URL: the HTML embeds every image as base64, so a note with
// a few photos can produce a multi-megabyte URL that risks Electron's practical
// loadURL length/perf limits (Finding #5). A file has no such limit. The temp
// file is always cleaned up (success or failure).
//
// The Electron/Node bits are behind an injectable `PdfRuntime` so the
// orchestration (temp file → loadFile → printToPDF → cleanup) is unit-testable
// without Electron; the default runtime lazily requires the real modules and is
// only ever constructed on desktop, where main.ts wires this seam.

import type { HtmlToPdf, PdfPrintOptions } from "./index";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** An off-screen window that can load a local file and print it to PDF. */
export interface PdfWindow {
  loadFile(path: string): Promise<void>;
  printToPDF(options: Record<string, unknown>): Promise<ArrayBufferView>;
  destroy(): void;
}

/** The Electron/Node capabilities the seam needs, injected for testability. */
export interface PdfRuntime {
  /** Open a hidden, sandboxed off-screen BrowserWindow. */
  openWindow(): PdfWindow;
  /** Write `html` to a fresh temp file and return its absolute path. */
  writeTempHtml(html: string): Promise<string>;
  /** Delete a temp file; must never throw. */
  removeFile(path: string): Promise<void>;
}

function loadRemote(): any {
  // Obsidian desktop exposes Electron; @electron/remote provides BrowserWindow
  // from the renderer. Try the modern module, then the legacy `remote` export.
  try {
    return require("@electron/remote");
  } catch {
    return require("electron").remote;
  }
}

function toArrayBuffer(view: ArrayBufferView): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

/** The real runtime: Electron's BrowserWindow plus Node's fs/os/path. */
export function defaultPdfRuntime(): PdfRuntime {
  return {
    openWindow(): PdfWindow {
      const remote = loadRemote();
      const win = new remote.BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });
      return {
        loadFile: (path) => win.loadFile(path),
        printToPDF: (options) => win.webContents.printToPDF(options),
        destroy: () => win.destroy(),
      };
    },
    async writeTempHtml(html): Promise<string> {
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

/**
 * Create the desktop HtmlToPdf seam. Call only on desktop (needs Electron).
 * `runtime` is injectable so the orchestration can be tested without Electron.
 */
export function createElectronHtmlToPdf(runtime: PdfRuntime = defaultPdfRuntime()): HtmlToPdf {
  return async (html: string, options: PdfPrintOptions): Promise<ArrayBuffer> => {
    const win = runtime.openWindow();
    let tempPath: string | undefined;
    try {
      tempPath = await runtime.writeTempHtml(html);
      await win.loadFile(tempPath);
      const pdf = await win.printToPDF(toPrintToPdfOptions(options));
      return toArrayBuffer(pdf);
    } finally {
      win.destroy();
      if (tempPath !== undefined) await runtime.removeFile(tempPath);
    }
  };
}

/** Map our print options onto Electron's printToPDF shape. */
function toPrintToPdfOptions(options: PdfPrintOptions): Record<string, unknown> {
  return {
    landscape: options.landscape,
    printBackground: options.printBackground,
    pageSize: options.pageSize,
    margins: options.margins,
    displayHeaderFooter: options.displayHeaderFooter,
    headerTemplate: options.headerTemplate,
    footerTemplate: options.footerTemplate,
  };
}
