import { describe, it, expect, vi } from "vitest";
import { renderToDocx } from "../helpers/render-docx";
import { renderToHtml } from "../helpers/render-html";
import { exportNote, scanNote, type VaultWriter, type ExportDeps } from "../../src/export";
import { DEFAULT_SETTINGS } from "../../src/ui/settings";
import { MemoryVaultAdapter } from "../helpers/memory-adapter";

class FakeWriter implements VaultWriter {
  files = new Map<string, string | ArrayBuffer>();
  exists(p: string) {
    return this.files.has(p);
  }
  async writeText(p: string, d: string) {
    this.files.set(p, d);
  }
  async writeBinary(p: string, d: ArrayBuffer) {
    this.files.set(p, d);
  }
}

describe("Stage 9 — math", () => {
  it("renders real OMML in DOCX and MathML in HTML", async () => {
    const src = "Inline $x^2$ and\n\n$$\\frac{a}{b}$$";
    const docx = await renderToDocx(src);
    expect(docx.documentXml).toContain("m:oMath");
    expect(docx.documentXml).toContain("m:sSup"); // superscript
    expect(docx.documentXml).toContain("m:f"); // fraction

    const html = await renderToHtml(src);
    expect(html.html).toContain("<math");
    expect(html.html).toContain("<mfrac>");
  });

  it("falls back to monospace LaTeX (never aborts) and warns on unsupported math", async () => {
    const src = "Broken: $\\begin{matrix}a\\end{matrix}$ end.";
    const docx = await renderToDocx(src);
    expect(docx.documentXml).not.toContain("m:oMath");
    expect(docx.documentXml).toContain("begin{matrix}"); // shown as text

    // The warning is added during the export pipeline (buildDocument).
    const warnings = await scanNote(new MemoryVaultAdapter({ notes: { "N.md": src } }), DEFAULT_SETTINGS, "N.md");
    expect(warnings.some((w) => w.construct === "math")).toBe(true);
  });
});

describe("Stage 9 — mermaid", () => {
  const noteAdapter = () => new MemoryVaultAdapter({ notes: { "N.md": "```mermaid\ngraph TD; A-->B;\n```" } });
  const settings = () => ({ ...DEFAULT_SETTINGS });

  it("renders a mermaid block to an embedded image when the renderer is available", async () => {
    const writer = new FakeWriter();
    const deps: ExportDeps = { mermaidToSvg: vi.fn(async () => "<svg xmlns='http://www.w3.org/2000/svg'/>") };
    const result = await exportNote({
      adapter: noteAdapter(),
      writer,
      settings: settings(),
      sourcePath: "N.md",
      format: "html",
      template: "default",
      deps,
    });
    expect(deps.mermaidToSvg).toHaveBeenCalled();
    const html = String(writer.files.get(result.outputPath));
    expect(html).toContain("data:image/svg+xml;base64,");
  });

  it("degrades to a code block + warning when no renderer is available", async () => {
    const writer = new FakeWriter();
    const result = await exportNote({
      adapter: noteAdapter(),
      writer,
      settings: settings(),
      sourcePath: "N.md",
      format: "html",
      template: "default",
      deps: {},
    });
    const html = String(writer.files.get(result.outputPath));
    expect(html).toContain("<pre><code");
    expect(result.warnings.some((w) => w.construct === "mermaid")).toBe(true);
  });
});

describe("Stage 9 — RTL", () => {
  it("sets paragraph bidi in DOCX for right-to-left text", async () => {
    const docx = await renderToDocx("שלום עולם this is Hebrew.");
    expect(docx.documentXml).toContain("w:bidi");
  });

  it("does not set bidi for pure LTR text", async () => {
    const docx = await renderToDocx("Plain English paragraph.");
    expect(docx.documentXml).not.toContain("w:bidi");
  });

  it("emits dir=auto on paragraphs and headings in HTML", async () => {
    const html = await renderToHtml("# مرحبا\n\nنص عربي");
    expect(html.html).toMatch(/<h1[^>]*dir="auto"/);
    expect(html.html).toMatch(/<p[^>]*dir="auto"/);
  });
});
