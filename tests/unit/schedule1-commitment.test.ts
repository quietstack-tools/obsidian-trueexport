// Schedule 1 consistency test — a LEGAL requirement, not a nicety.
//
// COMMITMENTS.md Schedule 1 lists the features promised free, perpetually and
// irrevocably. If the code ever gates one of them behind a Pro/licence check,
// that breaches a published irrevocable grant (see docs/legal/README.md §3.7 and
// Hybrid_Implementation_Note.md §8). This suite asserts, behaviourally, that
// every Schedule 1 feature is reachable by a NON-activated (free) user, and that
// the only things gating on `licenceActivated` are the four legitimately-Pro
// features: custom templates, reference-DOCX mapping, batch folder export, and
// attribution removal.
//
// It is written to FAIL LOUDLY — the kind of breach that rots silently across a
// refactor.

import { describe, it, expect, vi } from "vitest";
import * as JSZip from "jszip";
import { exportNote, scanNote, type VaultWriter } from "../../src/export";
import { DEFAULT_SETTINGS, TEMPLATES, type TrueExportSettings } from "../../src/ui/settings";
import type { TemplateId } from "../../src/core/options";
import { MemoryVaultAdapter } from "../helpers/memory-adapter";

// A non-activated (free-tier) user. This is the state that matters: nothing a
// free user does may be blocked by the absence of a licence key.
function freeSettings(overrides: Partial<TrueExportSettings> = {}): TrueExportSettings {
  return { ...DEFAULT_SETTINGS, licenceActivated: false, licenceKey: "", ...overrides };
}
function proSettings(overrides: Partial<TrueExportSettings> = {}): TrueExportSettings {
  return { ...DEFAULT_SETTINGS, licenceActivated: true, licenceKey: "PRO-KEY", ...overrides };
}

class FakeWriter implements VaultWriter {
  files = new Map<string, string | ArrayBuffer>();
  folders = new Set<string>();
  exists(path: string): boolean {
    return this.files.has(path) || this.folders.has(path);
  }
  async writeText(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }
  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.files.set(path, data);
  }
  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
  }
}

// A note exercising a broad spread of fidelity constructs, with no external
// vault dependencies so the comparison is deterministic. "All fidelity features"
// (Schedule 1 item 4) is the forward-looking promise; the point of the parity
// checks below is that whatever TrueExport can convert, it converts identically
// for free and paid users.
const RICH_NOTE = [
  "---",
  "title: Fidelity",
  "---",
  "# Heading 1",
  "## Heading 2",
  "",
  "Body with **bold**, *italic*, ~~strike~~, ==highlight==, `code`, H~2~O and x^2^.",
  "",
  "> [!warning] A callout",
  "> with a body.",
  "",
  "- [ ] task",
  "- [x] done",
  "  1. nested ordered",
  "",
  "| A | B |",
  "|:--|--:|",
  "| 1 | 2 |",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
  "A footnote[^1] and inline math $a^2+b^2$.",
  "",
  "$$\\int_0^1 x\\,dx$$",
  "",
  "```dataview",
  "list",
  "```",
  "",
  "[^1]: The footnote body.",
  "",
].join("\n");

const richAdapter = () => new MemoryVaultAdapter({ notes: { "f/Note.md": RICH_NOTE } });
const pdfSeam = () => vi.fn(async () => new TextEncoder().encode("%PDF-1.7").buffer);

// The DOCX free-tier attribution and the HTML free-tier attribution. Both live
// only in metadata (DOCX docProps, HTML <meta>), never in the visible body — so
// stripping them must leave byte-identical output.
const ATTRIBUTION = "TrueExport — quietstack.tools";

async function docxBody(bytes: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(new Uint8Array(bytes));
  return zip.file("word/document.xml")!.async("string");
}

describe("Schedule 1 — free features are never behind a Pro/licence check", () => {
  // --- Item 5: all four built-in templates are free -----------------------
  describe("built-in templates (item 5)", () => {
    const BUILT_INS: TemplateId[] = ["default", "professional", "academic", "minimal"];

    it("marks the four built-ins free and only 'custom' as Pro", () => {
      const free = TEMPLATES.filter((t) => !t.pro).map((t) => t.id).sort();
      const pro = TEMPLATES.filter((t) => t.pro).map((t) => t.id);
      expect(free).toEqual([...BUILT_INS].sort());
      // If anyone ever flips a built-in to Pro, this fails: only user-defined
      // custom templates may be gated (Schedule 1 "Not Free Features").
      expect(pro).toEqual(["custom"]);
    });

    it("names the built-ins exactly as Schedule 1 promises", () => {
      const names = TEMPLATES.filter((t) => !t.pro).map((t) => t.name).sort();
      expect(names).toEqual(["Academic", "Default", "Minimal", "Professional"]);
    });

    it.each(BUILT_INS)("a free user can export with the %s template", async (template) => {
      const writer = new FakeWriter();
      const result = await exportNote({
        adapter: richAdapter(),
        writer,
        settings: freeSettings(),
        sourcePath: "f/Note.md",
        format: "docx",
        template,
      });
      expect(writer.files.has(result.outputPath)).toBe(true);
    });
  });

  // --- Items 1–3: DOCX / HTML / PDF export are free -----------------------
  it("a free user can export DOCX, HTML and PDF (items 1–3)", async () => {
    for (const format of ["docx", "html"] as const) {
      const writer = new FakeWriter();
      const result = await exportNote({
        adapter: richAdapter(),
        writer,
        settings: freeSettings(),
        sourcePath: "f/Note.md",
        format,
        template: "default",
      });
      expect(writer.files.has(result.outputPath)).toBe(true);
    }
    // PDF, where the platform supports it (desktop seam present).
    const writer = new FakeWriter();
    const result = await exportNote({
      adapter: richAdapter(),
      writer,
      settings: freeSettings(),
      sourcePath: "f/Note.md",
      format: "pdf",
      template: "default",
      deps: { htmlToPdf: pdfSeam() },
    });
    expect(writer.files.has(result.outputPath)).toBe(true);
  });

  // --- Item 4: all fidelity features — identical free vs Pro --------------
  it("produces byte-identical DOCX body content for free and Pro users (item 4)", async () => {
    const write = async (settings: TrueExportSettings) => {
      const writer = new FakeWriter();
      const r = await exportNote({
        adapter: richAdapter(),
        writer,
        settings,
        sourcePath: "f/Note.md",
        format: "docx",
        template: "default",
      });
      return docxBody(writer.files.get(r.outputPath) as ArrayBuffer);
    };
    const free = await write(freeSettings());
    const pro = await write(proSettings());
    // The visible document is the fidelity output. It must not depend on Pro.
    // (Attribution differs only in docProps, never in word/document.xml.)
    expect(free).toEqual(pro);
    expect(free).not.toContain(ATTRIBUTION); // never in the visible body
  });

  it("produces identical HTML for free and Pro users apart from the attribution meta (item 4)", async () => {
    const write = async (settings: TrueExportSettings) => {
      const writer = new FakeWriter();
      const r = await exportNote({
        adapter: richAdapter(),
        writer,
        settings,
        sourcePath: "f/Note.md",
        format: "html",
        template: "default",
      });
      return String(writer.files.get(r.outputPath));
    };
    const free = await write(freeSettings());
    const pro = await write(proSettings());
    // Free carries the attribution in a <meta> tag; Pro removes it. That single
    // metadata line is the ONLY permitted difference — the rendered body,
    // callouts, tables, footnotes, math, etc. must be identical.
    const strip = (html: string) => html.split("\n").filter((l) => !l.includes(ATTRIBUTION)).join("\n");
    expect(strip(free)).toEqual(strip(pro));
  });

  // --- Item 7: warnings and diagnostics are free -------------------------
  it("gives a free user export warnings and diagnostics (item 7)", async () => {
    const result = await exportNote({
      adapter: richAdapter(),
      writer: new FakeWriter(),
      settings: freeSettings(),
      sourcePath: "f/Note.md",
      format: "html",
      template: "default",
    });
    expect(result.warnings.some((w) => w.construct === "dataview")).toBe(true);
    // The pre-scan diagnostic is likewise ungated.
    const scan = await scanNote(richAdapter(), freeSettings(), "f/Note.md");
    expect(scan.some((w) => w.construct === "dataview")).toBe(true);
  });

  // --- Item 8: fully offline operation -----------------------------------
  it("a free user's export needs no network capability (item 8)", async () => {
    const fetchRemoteImage = vi.fn(async () => ({ data: new ArrayBuffer(1), mimeType: "image/png" }));
    const writer = new FakeWriter();
    // Even with a fetcher injected and (crucially) remote images left OFF as they
    // default, nothing reaches the network during a free export.
    const result = await exportNote({
      adapter: richAdapter(),
      writer,
      settings: freeSettings(),
      sourcePath: "f/Note.md",
      format: "html",
      template: "default",
      deps: { fetchRemoteImage },
    });
    expect(writer.files.has(result.outputPath)).toBe(true);
    expect(fetchRemoteImage).not.toHaveBeenCalled();
  });
});

describe("Pro gating is confined to the four 'Not Free Features'", () => {
  // These four MAY be gated (COMMITMENTS.md Schedule 1, "Not Free Features").
  // The tests confirm the gate is real, so we know the free-tier parity above
  // isn't simply because gating was removed everywhere.

  it("attribution removal is Pro-only: free keeps it, Pro drops it", async () => {
    const html = async (settings: TrueExportSettings) => {
      const writer = new FakeWriter();
      const r = await exportNote({
        adapter: richAdapter(),
        writer,
        settings,
        sourcePath: "f/Note.md",
        format: "html",
        template: "default",
      });
      return String(writer.files.get(r.outputPath));
    };
    expect(await html(freeSettings())).toContain(ATTRIBUTION);
    expect(await html(proSettings())).not.toContain(ATTRIBUTION);
  });

  it("reference-DOCX mapping is Pro-only, and its absence never degrades free fidelity", async () => {
    // Covered in depth in export.test.ts; asserted here as a Schedule 1 guard:
    // a free user with a referenceDocxPath set still gets the built-in styles
    // (the Pro feature is inert), not a downgraded export.
    const adapter = new MemoryVaultAdapter({ notes: { "f/Note.md": "# T\n\nBody." } });
    const spy = vi.spyOn(adapter, "readBinary");
    const writer = new FakeWriter();
    const r = await exportNote({
      adapter,
      writer,
      settings: freeSettings({ referenceDocxPath: "templates/house.docx" }),
      sourcePath: "f/Note.md",
      format: "docx",
      template: "default",
    });
    const zip = await JSZip.loadAsync(new Uint8Array(writer.files.get(r.outputPath) as ArrayBuffer));
    const styles = await zip.file("word/styles.xml")!.async("string");
    expect(styles).toContain("Calibri"); // built-in styles, undiminished
    expect(spy).not.toHaveBeenCalledWith("templates/house.docx");
  });
});
