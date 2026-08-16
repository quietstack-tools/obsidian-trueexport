import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as JSZip from "jszip";
import { exportNote, exportFolder, scanNote, type VaultWriter } from "../../src/export";
import { DEFAULT_SETTINGS, type TrueExportSettings } from "../../src/ui/settings";
import { MemoryVaultAdapter } from "../helpers/memory-adapter";

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
const REFERENCE_DOCX = toArrayBuffer(readFileSync("tests/fixtures/reference-styles.docx"));
async function stylesXmlOf(bytes: string | ArrayBuffer | undefined): Promise<string> {
  const zip = await JSZip.loadAsync(new Uint8Array(bytes as ArrayBuffer));
  return zip.file("word/styles.xml")!.async("string");
}

class FakeWriter implements VaultWriter {
  files = new Map<string, string | ArrayBuffer>();
  folders = new Set<string>();
  exists(path: string): boolean {
    return this.files.has(path) || this.folders.has(path);
  }
  async writeText(path: string, data: string): Promise<void> {
    this.requireParent(path);
    this.files.set(path, data);
  }
  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.requireParent(path);
    this.files.set(path, data);
  }
  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
  }
  /** Mirror Obsidian: creating a file inside a non-existent folder throws. */
  private requireParent(path: string): void {
    const slash = path.lastIndexOf("/");
    if (slash !== -1 && !this.folders.has(path.slice(0, slash))) {
      throw new Error(`Folder does not exist: ${path.slice(0, slash)}`);
    }
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

  it("creates a missing custom output folder instead of failing (§7.4)", async () => {
    const writer = new FakeWriter();
    // "Exports/Word" does not exist yet; without folder creation the write
    // would throw (FakeWriter.requireParent mirrors Obsidian's vault.create).
    const result = await exportNote({
      adapter: adapter(),
      writer,
      settings: settings({ outputLocation: "custom", customOutputFolder: "Exports/Word" }),
      sourcePath: "folder/Note.md",
      format: "html",
      template: "default",
    });
    expect(result.outputPath).toBe("Exports/Word/Note.html");
    expect(writer.folders.has("Exports")).toBe(true);
    expect(writer.folders.has("Exports/Word")).toBe(true);
    expect(writer.files.has(result.outputPath)).toBe(true);
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

  it("never fetches remote images (no network during a pre-scan)", async () => {
    const fetchRemoteImage = vi.fn(async () => ({ data: new ArrayBuffer(1), mimeType: "image/png" }));
    const remoteAdapter = new MemoryVaultAdapter({ notes: { "R.md": "![x](https://e.com/a.png)" } });
    // scanNote takes no deps → the fetcher is never reachable.
    await scanNote(remoteAdapter, { ...settings(), allowRemoteImages: true }, "R.md");
    expect(fetchRemoteImage).not.toHaveBeenCalled();
  });
});

describe("remote images (§7.6) at the export level", () => {
  const remoteAdapter = () => new MemoryVaultAdapter({ notes: { "R.md": "![x](https://e.com/a.png)" } });

  it("does NOT call the fetcher when the setting is off (default)", async () => {
    const fetchRemoteImage = vi.fn(async () => ({ data: new ArrayBuffer(1), mimeType: "image/png" }));
    await exportNote({
      adapter: remoteAdapter(),
      writer: new FakeWriter(),
      settings: settings(), // allowRemoteImages defaults to false
      sourcePath: "R.md",
      format: "html",
      template: "default",
      deps: { fetchRemoteImage },
    });
    expect(fetchRemoteImage).not.toHaveBeenCalled();
  });

  it("calls the fetcher and embeds the image when the setting is on", async () => {
    const fetchRemoteImage = vi.fn(async () => ({ data: new TextEncoder().encode("PNG").buffer, mimeType: "image/png" }));
    const writer = new FakeWriter();
    const result = await exportNote({
      adapter: remoteAdapter(),
      writer,
      settings: { ...settings(), allowRemoteImages: true },
      sourcePath: "R.md",
      format: "html",
      template: "default",
      deps: { fetchRemoteImage },
    });
    expect(fetchRemoteImage).toHaveBeenCalledWith("https://e.com/a.png");
    expect(String(writer.files.get(result.outputPath))).toContain("data:image/png;base64,");
  });
});

describe("exportFolder (batch)", () => {
  const folderAdapter = () =>
    new MemoryVaultAdapter({
      notes: { "proj/A.md": "# A", "proj/B.md": "# B", "proj/sub/C.md": "# C", "other/D.md": "# D" },
    });

  it("exports every markdown note under the folder", async () => {
    const writer = new FakeWriter();
    const result = await exportFolder({
      adapter: folderAdapter(),
      writer,
      settings: settings(),
      folderPath: "proj",
      format: "html",
      template: "default",
    });
    expect(result.total).toBe(3);
    expect(result.outputs.sort()).toEqual(["proj/A.html", "proj/B.html", "proj/sub/C.html"]);
    expect(result.cancelled).toBe(false);
  });

  it("captures a failing note without aborting the rest", async () => {
    class ThrowOnB extends FakeWriter {
      async writeText(path: string, data: string): Promise<void> {
        if (path.includes("B")) throw new Error("disk full");
        return super.writeText(path, data);
      }
    }
    const writer = new ThrowOnB();
    const result = await exportFolder({
      adapter: folderAdapter(),
      writer,
      settings: settings(),
      folderPath: "proj",
      format: "html",
      template: "default",
    });
    expect(result.outputs).toHaveLength(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].path).toBe("proj/B.md");
  });

  it("stops immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const writer = new FakeWriter();
    const result = await exportFolder({
      adapter: folderAdapter(),
      writer,
      settings: settings(),
      folderPath: "proj",
      format: "html",
      template: "default",
      signal: controller.signal,
    });
    expect(result.cancelled).toBe(true);
    expect(result.outputs).toEqual([]);
    expect(writer.files.size).toBe(0);
  });

  it("reports progress after each note", async () => {
    const progress: Array<[number, number]> = [];
    await exportFolder({
      adapter: folderAdapter(),
      writer: new FakeWriter(),
      settings: settings(),
      folderPath: "proj",
      format: "html",
      template: "default",
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });
});

describe("reference DOCX (Pro; §5.1)", () => {
  const refAdapter = (binaries?: Record<string, ArrayBuffer>) =>
    new MemoryVaultAdapter({ notes: { "folder/Note.md": "# Title\n\nBody text." }, binaries });

  it("applies the reference styles for a Pro user with a valid reference doc", async () => {
    const writer = new FakeWriter();
    const result = await exportNote({
      adapter: refAdapter({ "templates/house.docx": REFERENCE_DOCX }),
      writer,
      settings: settings({ licenceActivated: true, referenceDocxPath: "templates/house.docx" }),
      sourcePath: "folder/Note.md",
      format: "docx",
      template: "default",
    });
    const styles = await stylesXmlOf(writer.files.get(result.outputPath));
    expect(styles).toContain("Georgia"); // reference Normal font
    expect(styles).not.toContain("Calibri"); // built-in font replaced
    expect(result.warnings.some((w) => w.construct === "reference")).toBe(false);
  });

  it("ignores the reference for a free-tier user (built-in styles, no read attempted)", async () => {
    const adapter = refAdapter({ "templates/house.docx": REFERENCE_DOCX });
    const spy = vi.spyOn(adapter, "readBinary");
    const writer = new FakeWriter();
    const result = await exportNote({
      adapter,
      writer,
      settings: settings({ licenceActivated: false, referenceDocxPath: "templates/house.docx" }),
      sourcePath: "folder/Note.md",
      format: "docx",
      template: "default",
    });
    const styles = await stylesXmlOf(writer.files.get(result.outputPath));
    expect(styles).toContain("Calibri"); // built-in
    expect(styles).not.toContain("Georgia");
    expect(spy).not.toHaveBeenCalledWith("templates/house.docx");
  });

  it("degrades to built-in styles + a warning when the reference file is missing", async () => {
    const writer = new FakeWriter();
    const result = await exportNote({
      adapter: refAdapter(), // no binaries → path not found
      writer,
      settings: settings({ licenceActivated: true, referenceDocxPath: "templates/missing.docx" }),
      sourcePath: "folder/Note.md",
      format: "docx",
      template: "default",
    });
    const styles = await stylesXmlOf(writer.files.get(result.outputPath));
    expect(styles).toContain("Calibri"); // fell back to built-in
    const warning = result.warnings.find((w) => w.construct === "reference");
    expect(warning?.message).toMatch(/wasn't found.*using default styles instead/);
  });

  it("degrades to built-in styles + a warning when the reference file is corrupted", async () => {
    const garbage = new TextEncoder().encode("this is not a docx").buffer;
    const writer = new FakeWriter();
    const result = await exportNote({
      adapter: refAdapter({ "templates/house.docx": garbage }),
      writer,
      settings: settings({ licenceActivated: true, referenceDocxPath: "templates/house.docx" }),
      sourcePath: "folder/Note.md",
      format: "docx",
      template: "default",
    });
    const styles = await stylesXmlOf(writer.files.get(result.outputPath));
    expect(styles).toContain("Calibri");
    expect(
      result.warnings.some((w) => w.construct === "reference" && /Could not read styles/.test(w.message)),
    ).toBe(true);
  });
});
