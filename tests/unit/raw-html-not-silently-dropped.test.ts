import { describe, it, expect } from "vitest";
import * as JSZip from "jszip";
import { exportNote, type VaultWriter } from "../../src/export";
import { createHtmlSanitizer } from "../../src/obsidian-adapter";
import { DEFAULT_SETTINGS, type TrueExportSettings } from "../../src/ui/settings";
import { MemoryVaultAdapter } from "../helpers/memory-adapter";

// §D27: a raw-HTML block whose ENTIRE content is a dangerous element (e.g. a
// standalone <iframe>) must never vanish without a trace once sanitised — it
// must degrade to visible, escaped, inert text plus a warning, the same way
// every other unrepresentable construct in this codebase does. Confirmed via
// a real manual-QA report: the <iframe> line disappeared completely (no
// escaped text, no placeholder, no warning) while sibling <script>/<img>
// lines correctly survived as escaped text.

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

const NOTE = `<script>alert('should never execute or appear as a live script tag')</script>

<img src=x onerror="alert('should be neutralised')">

<iframe src="https://example.com"></iframe>
`;

describe("D27: raw HTML sanitisation never silently drops content", () => {
  it("HTML export: the iframe line survives as visible escaped text, plus a warning", async () => {
    const adapter = new MemoryVaultAdapter({ notes: { "N.md": NOTE } });
    const writer = new FakeWriter();
    const result = await exportNote({
      adapter,
      writer,
      settings: settings(),
      sourcePath: "N.md",
      format: "html",
      template: "default",
      deps: { sanitizeHtml: createHtmlSanitizer() },
    });

    const html = String(writer.files.get(result.outputPath));
    // Never a live, loadable <iframe> element.
    expect(html).not.toContain("<iframe");
    // But the original markup is still traceable, as visible escaped text
    // (only &/</> need escaping for safe TEXT content — quotes are fine).
    expect(html).toContain('&lt;iframe src="https://example.com"&gt;&lt;/iframe&gt;');

    const htmlWarnings = result.warnings.filter((w) => w.construct === "html");
    expect(htmlWarnings).toHaveLength(1);
    expect(htmlWarnings[0].message).toContain("iframe");
    expect(htmlWarnings[0].line).toBe(5);
  });

  it("DOCX export: the iframe line survives as visible literal text in the document body, plus the same warning", async () => {
    const adapter = new MemoryVaultAdapter({ notes: { "N.md": NOTE } });
    const writer = new FakeWriter();
    const result = await exportNote({
      adapter,
      writer,
      settings: settings(),
      sourcePath: "N.md",
      format: "docx",
      template: "default",
      deps: { sanitizeHtml: createHtmlSanitizer() },
    });

    const bytes = writer.files.get(result.outputPath) as ArrayBuffer;
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")!.async("string");

    // The original iframe markup appears as literal, visible text — Word
    // never interprets it as markup, so no separate "escaping" is needed
    // for DOCX; it just must not be ABSENT.
    expect(documentXml).toContain("iframe");
    expect(documentXml).toContain("https://example.com");

    const htmlWarnings = result.warnings.filter((w) => w.construct === "html");
    expect(htmlWarnings).toHaveLength(1);
  });

  it("script and img lines are untouched by this fix — still ordinary escaped paragraph text, no warning", async () => {
    const adapter = new MemoryVaultAdapter({ notes: { "N.md": NOTE } });
    const writer = new FakeWriter();
    const result = await exportNote({
      adapter,
      writer,
      settings: settings(),
      sourcePath: "N.md",
      format: "html",
      template: "default",
      deps: { sanitizeHtml: createHtmlSanitizer() },
    });

    const html = String(writer.files.get(result.outputPath));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    // The onerror text is visible (harmless, escaped paragraph text — same
    // as script's source above) but never a real, functioning attribute.
    expect(html).not.toContain("<img");
    expect(html).toContain("onerror=");

    // Only the iframe line produced a warning — script/img were never
    // classified as raw-HTML blocks in the first place (they're ordinary
    // paragraph text), so this fix doesn't add a warning for them.
    expect(result.warnings.filter((w) => w.construct === "html")).toHaveLength(1);
  });

  it("a block with SOME safe content alongside a dangerous tag keeps the safe content live, not just escaped", async () => {
    // Contrast case: only a block that sanitises down to NOTHING gets the
    // escape-and-warn treatment. A block with real surviving content (e.g. a
    // <div> wrapping an <iframe> plus its own text) keeps rendering normally.
    const note = `<div>Before<iframe src="https://example.com"></iframe>After</div>\n`;
    const adapter = new MemoryVaultAdapter({ notes: { "N.md": note } });
    const writer = new FakeWriter();
    const result = await exportNote({
      adapter,
      writer,
      settings: settings(),
      sourcePath: "N.md",
      format: "html",
      template: "default",
      deps: { sanitizeHtml: createHtmlSanitizer() },
    });

    const html = String(writer.files.get(result.outputPath));
    expect(html).toContain("<div>Before");
    expect(html).toContain("After</div>");
    expect(html).not.toContain("<iframe");
    // The block wasn't blanked entirely, so it's not converted to the
    // escape-whole-block fallback — no "html" warning for this case.
    expect(result.warnings.filter((w) => w.construct === "html")).toHaveLength(0);
  });
});
