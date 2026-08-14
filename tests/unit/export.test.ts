import { describe, it, expect } from "vitest";
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

  it("rejects PDF with an actionable message (not yet implemented)", async () => {
    await expect(
      exportNote({
        adapter: adapter(),
        writer: new FakeWriter(),
        settings: settings(),
        sourcePath: "folder/Note.md",
        format: "pdf",
        template: "default",
      }),
    ).rejects.toThrow(/PDF export isn't available yet/);
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
