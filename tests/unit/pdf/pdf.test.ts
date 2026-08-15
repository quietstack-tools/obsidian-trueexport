import { describe, it, expect, vi } from "vitest";
import { toPdfPrintOptions, renderPdf, type PdfOptions, type PdfPrintOptions } from "../../../src/pdf";

const base: PdfOptions = { pageSize: "A4", orientation: "portrait", margins: 1, pageNumbers: false };

describe("toPdfPrintOptions", () => {
  it("maps page size and portrait orientation", () => {
    const p = toPdfPrintOptions(base);
    expect(p.pageSize).toBe("A4");
    expect(p.landscape).toBe(false);
    expect(p.printBackground).toBe(true);
  });

  it("maps landscape orientation", () => {
    expect(toPdfPrintOptions({ ...base, orientation: "landscape" }).landscape).toBe(true);
  });

  it("applies a uniform margin on all four sides", () => {
    expect(toPdfPrintOptions({ ...base, margins: 0.5 }).margins).toEqual({
      top: 0.5,
      bottom: 0.5,
      left: 0.5,
      right: 0.5,
    });
  });

  it("clamps negative margins to zero", () => {
    expect(toPdfPrintOptions({ ...base, margins: -3 }).margins.top).toBe(0);
  });

  it("adds a page-number footer only when page numbers are enabled", () => {
    const off = toPdfPrintOptions({ ...base, pageNumbers: false });
    expect(off.displayHeaderFooter).toBe(false);
    expect(off.footerTemplate).not.toContain("pageNumber");

    const on = toPdfPrintOptions({ ...base, pageNumbers: true });
    expect(on.displayHeaderFooter).toBe(true);
    expect(on.footerTemplate).toContain('class="pageNumber"');
    expect(on.footerTemplate).toContain('class="totalPages"');
  });
});

describe("renderPdf", () => {
  it("forwards the HTML and mapped options to the seam and returns its bytes", async () => {
    const out = new TextEncoder().encode("%PDF").buffer;
    const seam = vi.fn(async (_html: string, _opts: PdfPrintOptions) => out);
    const result = await renderPdf("<!DOCTYPE html><html></html>", { ...base, orientation: "landscape" }, seam);

    expect(result).toBe(out);
    expect(seam).toHaveBeenCalledTimes(1);
    const [html, opts] = seam.mock.calls[0];
    expect(html).toContain("<!DOCTYPE html>");
    expect(opts.landscape).toBe(true);
  });
});
