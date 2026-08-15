// src/pdf/index.ts
//
// PDF export (§5.3). Deliberately unambitious: render the existing HTML output
// (Stage 5) and convert it to PDF via Electron's printToPDF. No new parsing or
// IDM handling.
//
// The actual printToPDF call needs Electron's renderer and cannot run in the
// test environment, so it is isolated behind the injectable `HtmlToPdf` seam
// (implemented in ./electron.ts, wired by main.ts on desktop). Everything up to
// the seam — options mapping, the footer template, forwarding the HTML — is
// pure and unit-testable.

import type { Orientation, PageSize } from "../core/options";

/** App-level PDF choices, mapped from settings by the caller. */
export interface PdfOptions {
  pageSize: PageSize;
  orientation: Orientation;
  /** Uniform page margin, in inches. */
  margins: number;
  /** Show page numbers in the footer. */
  pageNumbers: boolean;
}

/** Options passed to Electron's webContents.printToPDF. */
export interface PdfPrintOptions {
  pageSize: PageSize;
  landscape: boolean;
  printBackground: boolean;
  margins: { top: number; bottom: number; left: number; right: number };
  displayHeaderFooter: boolean;
  headerTemplate: string;
  footerTemplate: string;
}

/** The seam: HTML + print options → PDF bytes. Injected; never runs in tests. */
export type HtmlToPdf = (html: string, options: PdfPrintOptions) => Promise<ArrayBuffer>;

const EMPTY_TEMPLATE = "<div></div>";
const PAGE_NUMBER_FOOTER =
  '<div style="font-size:9px;width:100%;text-align:center;color:#666;">' +
  '<span class="pageNumber"></span> / <span class="totalPages"></span></div>';

export function toPdfPrintOptions(options: PdfOptions): PdfPrintOptions {
  const margin = Math.max(0, options.margins);
  return {
    pageSize: options.pageSize,
    landscape: options.orientation === "landscape",
    printBackground: true,
    margins: { top: margin, bottom: margin, left: margin, right: margin },
    displayHeaderFooter: options.pageNumbers,
    headerTemplate: EMPTY_TEMPLATE,
    footerTemplate: options.pageNumbers ? PAGE_NUMBER_FOOTER : EMPTY_TEMPLATE,
  };
}

/**
 * Convert already-rendered HTML to a PDF through the injected seam. Thin by
 * design — the differentiator is DOCX, and two free plugins already cover PDF.
 */
export async function renderPdf(html: string, options: PdfOptions, htmlToPdf: HtmlToPdf): Promise<ArrayBuffer> {
  return htmlToPdf(html, toPdfPrintOptions(options));
}
