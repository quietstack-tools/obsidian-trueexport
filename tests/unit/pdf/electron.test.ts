import { describe, it, expect, vi } from "vitest";
import {
  createElectronHtmlToPdf,
  type PdfRuntime,
  type PdfWindow,
} from "../../../src/pdf/electron";
import { toPdfPrintOptions, type PdfOptions } from "../../../src/pdf";

const OPTS: PdfOptions = { pageSize: "A4", orientation: "portrait", margins: 1, pageNumbers: false };

/** A fake runtime that records everything, so we can assert the file path is
 *  used (never a data: URL) and that cleanup always runs. */
function fakeRuntime(overrides: Partial<{ printToPDF: () => Promise<ArrayBufferView> }> = {}) {
  const calls = {
    writtenHtml: "" as string,
    tempPath: "",
    loadedFile: undefined as string | undefined,
    printed: false,
    destroyed: false,
    removed: undefined as string | undefined,
  };
  const win: PdfWindow = {
    loadFile: vi.fn(async (p: string) => {
      calls.loadedFile = p;
    }),
    printToPDF: overrides.printToPDF
      ? vi.fn(overrides.printToPDF)
      : vi.fn(async () => {
          calls.printed = true;
          return new TextEncoder().encode("%PDF-1.7 fake");
        }),
    destroy: vi.fn(() => {
      calls.destroyed = true;
    }),
  };
  const runtime: PdfRuntime = {
    openWindow: () => win,
    writeTempHtml: vi.fn(async (html: string) => {
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

describe("createElectronHtmlToPdf", () => {
  it("writes a large HTML payload to a temp file and loadFiles it (never a data: URL)", async () => {
    // ~5 MB of base64-ish image data — the case that would blow a data: URL.
    const bigHtml = `<img src="data:image/png;base64,${"A".repeat(5_000_000)}">`;
    const { runtime, calls } = fakeRuntime();

    const result = await createElectronHtmlToPdf(runtime)(bigHtml, toPdfPrintOptions(OPTS));

    // The full HTML went to a file, not into a URL.
    expect(calls.writtenHtml).toBe(bigHtml);
    expect(calls.writtenHtml.length).toBeGreaterThan(5_000_000);
    // The window loaded that file path — and it is NOT a data: URL.
    expect(calls.loadedFile).toBe(calls.tempPath);
    expect(calls.loadedFile!.startsWith("data:")).toBe(false);
    expect(calls.printed).toBe(true);
    // Returns the printed bytes as an ArrayBuffer.
    expect(new TextDecoder().decode(result)).toContain("%PDF-1.7");
  });

  it("cleans up the temp file and window on success", async () => {
    const { runtime, calls } = fakeRuntime();
    await createElectronHtmlToPdf(runtime)("<p>hi</p>", toPdfPrintOptions(OPTS));
    expect(calls.destroyed).toBe(true);
    expect(calls.removed).toBe(calls.tempPath);
  });

  it("still cleans up when printToPDF fails (try/finally)", async () => {
    const { runtime, calls } = fakeRuntime({
      printToPDF: async () => {
        throw new Error("printToPDF exploded");
      },
    });
    await expect(
      createElectronHtmlToPdf(runtime)("<p>hi</p>", toPdfPrintOptions(OPTS)),
    ).rejects.toThrow(/exploded/);
    // The window is destroyed and the temp file removed despite the failure.
    expect(calls.destroyed).toBe(true);
    expect(calls.removed).toBe(calls.tempPath);
  });
});
