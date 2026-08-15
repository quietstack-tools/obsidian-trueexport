import { describe, it, expect, vi } from "vitest";
import * as JSZip from "jszip";
import { exportNote, scanNote, type VaultWriter } from "../../src/export";
import { DEFAULT_SETTINGS, type TrueExportSettings } from "../../src/ui/settings";
import { MemoryVaultAdapter } from "../helpers/memory-adapter";

class FakeWriter implements VaultWriter {
  files = new Map<string, string | ArrayBuffer>();
  exists(path: string): boolean {
    return this.files.has(path);
  }
  async writeText(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }
  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.files.set(path, data);
  }
}

function settings(overrides: Partial<TrueExportSettings> = {}): TrueExportSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

const NOTE = "# Hello World\n\nBody text.\n\n```dataview\nlist\n```";
const adapter = () => new MemoryVaultAdapter({ notes: { "folder/Note.md": NOTE } });

describe("exportNote", () => {
  it("writes a valid DOCX binary and returns the output path", async () => {
    const writer = new FakeWriter();
    const result = await exportNote({
      adapter: adapter(),
      writer,
      settings: settings(),
      sourcePath: "folder/Note.md",
      format: "docx",
      template: "default",
    });
    expect(result.outputPath).toBe("folder/Note.docx");
    const bytes = writer.files.get(result.outputPath) as ArrayBuffer;
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file("word/document.xml")).not.toBeNull();
  });

  it("writes HTML as text", async () => {
    const writer = new FakeWriter();
    const result = await exportNote({
      adapter: adapter(),
      writer,
      settings: settings(),
      sourcePath: "folder/Note.md",
      format: "html",
      template: "default",
    });
    expect(result.outputPath).toBe("folder/Note.html");
    expect(String(writer.files.get(result.outputPath))).toContain("<!DOCTYPE html>");
  });

  it("returns the export warnings", async () => {
    const result = await exportNote({
      adapter: adapter(),
      writer: new FakeWriter(),
      settings: settings(),
      sourcePath: "folder/Note.md",
      format: "html",
      template: "default",
    });
    expect(result.warnings.some((w) => w.construct === "dataview")).toBe(true);
  });

  it("never overwrites: appends (1) on filename collision", async () => {
    const writer = new FakeWriter();
    writer.files.set("folder/Note.docx", new ArrayBuffer(0));
    const result = await exportNote({
      adapter: adapter(),
      writer,
      settings: settings(),
      sourcePath: "folder/Note.md",
      format: "docx",
      template: "default",
    });
    expect(result.outputPath).toBe("folder/Note (1).docx");
  });

  it("honours output location and filename pattern", async () => {
    const writer = new FakeWriter();
    const result = await exportNote({
      adapter: adapter(),
      writer,
      settings: settings({ outputLocation: "vault-root", filenamePattern: "{{title}}-{{date}}" }),
      sourcePath: "folder/Note.md",
      format: "html",
      template: "default",
      now: new Date(2026, 7, 15),
    });
    expect(result.outputPath).toBe("Note-2026-08-15.html");
  });

  it("renders PDF through the injected seam and writes the bytes", async () => {
    const writer = new FakeWriter();
    const htmlToPdf = vi.fn(async (_html: string, _opts: unknown) => new TextEncoder().encode("%PDF-1.7").buffer);
    const result = await exportNote({
      adapter: adapter(),
      writer,
      settings: settings(),
      sourcePath: "folder/Note.md",
      format: "pdf",
      template: "default",
      deps: { htmlToPdf },
    });
    expect(result.outputPath).toBe("folder/Note.pdf");
    expect(htmlToPdf).toHaveBeenCalledTimes(1);
    // The seam receives the self-contained HTML output.
    expect(htmlToPdf.mock.calls[0][0]).toContain("<!DOCTYPE html>");
    expect(writer.files.has("folder/Note.pdf")).toBe(true);
  });

  it("rejects PDF as desktop-only when no seam is provided (mobile)", async () => {
    const writer = new FakeWriter();
    await expect(
      exportNote({
        adapter: adapter(),
        writer,
        settings: settings(),
        sourcePath: "folder/Note.md",
        format: "pdf",
        template: "default",
        deps: {},
      }),
    ).rejects.toThrow(/desktop/);
    expect(writer.files.size).toBe(0);
  });

  it("throws (and writes nothing) when the note cannot be read", async () => {
    const writer = new FakeWriter();
    await expect(
      exportNote({
        adapter: adapter(),
        writer,
        settings: settings(),
        sourcePath: "missing.md",
        format: "docx",
        template: "default",
      }),
    ).rejects.toThrow(/Could not read note/);
    expect(writer.files.size).toBe(0);
  });
});

describe("scanNote", () => {
  it("returns warnings without writing anything", async () => {
    const warnings = await scanNote(adapter(), settings(), "folder/Note.md");
    expect(warnings.some((w) => w.construct === "dataview")).toBe(true);
  });
});
