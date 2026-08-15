// src/pdf/electron.ts
//
// The Electron implementation of the HtmlToPdf seam (§5.3). This is the one
// piece that cannot run in the test environment — it depends on Electron's
// renderer process — so it lives alone here and is flagged as a
// manual-verification item (same category as the Stage 6 SVG rasteriser).
//
// Technique: load the self-contained HTML into a hidden off-screen
// BrowserWindow via @electron/remote and call webContents.printToPDF. The HTML
// is fully self-contained (base64 images, inlined CSS), so no server or file
// access is needed. `electron` is marked external in the esbuild config, and
// the require is lazy so importing this module on mobile is harmless.

import type { HtmlToPdf, PdfPrintOptions } from "./index";

/* eslint-disable @typescript-eslint/no-explicit-any */

function loadRemote(): any {
  // Obsidian desktop exposes Electron; @electron/remote provides BrowserWindow
  // from the renderer. Try the modern module, then the legacy `remote` export.
  try {
    return require("@electron/remote");
  } catch {
    return require("electron").remote;
  }
}

function toArrayBuffer(buffer: { buffer: ArrayBuffer; byteOffset: number; byteLength: number }): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/** Create the desktop HtmlToPdf seam. Call only on desktop (needs Electron). */
export function createElectronHtmlToPdf(): HtmlToPdf {
  return async (html: string, options: PdfPrintOptions): Promise<ArrayBuffer> => {
    const remote = loadRemote();
    const win = new remote.BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    try {
      const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
      await win.loadURL(dataUrl);
      const pdf = await win.webContents.printToPDF(toPrintToPdfOptions(options));
      return toArrayBuffer(pdf);
    } finally {
      win.destroy();
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
