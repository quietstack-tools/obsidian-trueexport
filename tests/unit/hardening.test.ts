import { describe, it, expect, vi } from "vitest";
import * as JSZip from "jszip";
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
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(result.warnings.some((w) => w.construct === "mermaid")).toBe(true);
  });

  // DOCX-specific regression coverage (D-series bug report): confirmed via
  // diagnostic tracing that export.ts's mermaid handling and the DOCX
  // renderer's image-embedding pipeline (relationship ids, content types,
  // byte embedding, codeBlock fallback) are all correct given a working
  // mermaidToSvg/rasterizeSvg pair — including with two diagrams (one
  // succeeding, one failing) in the same document, no cross-contamination.
  // The actual reported "broken image icon for a working diagram" defect
  // traced to the real DOM-based rasteriser/mermaid-extraction code in
  // src/obsidian-adapter.ts (a manual-verification seam, can't run headless
  // here) — see that file's updated doc comments for the fixes applied
  // there. These tests guard the part that IS testable: this codebase's own
  // plumbing never produces a broken/mismatched image reference, and the
  // fallback path never produces one at all.
  it("DOCX: a working mermaid diagram embeds a real, non-empty image with a matching relationship", async () => {
    const writer = new FakeWriter();
    const fakePng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]).buffer;
    const deps: ExportDeps = {
      mermaidToSvg: vi.fn(async () => "<svg xmlns='http://www.w3.org/2000/svg'><rect/></svg>"),
      rasterizeSvg: vi.fn(async () => ({ data: fakePng, width: 1, height: 1 })),
    };
    const result = await exportNote({
      adapter: noteAdapter(),
      writer,
      settings: settings(),
      sourcePath: "N.md",
      format: "docx",
      template: "default",
      deps,
    });
    expect(deps.rasterizeSvg).toHaveBeenCalled();
    const buf = writer.files.get(result.outputPath) as ArrayBuffer;
    const zip = await JSZip.loadAsync(buf);
    const mediaFiles = Object.keys(zip.files).filter((f) => f.startsWith("word/media/") && !zip.files[f].dir);
    expect(mediaFiles.length).toBe(1);
    const bytes = await zip.file(mediaFiles[0])!.async("uint8array");
    expect(bytes.length).toBeGreaterThan(0);
    expect(Array.from(bytes)).toEqual(Array.from(new Uint8Array(fakePng)));

    const docXml = await zip.file("word/document.xml")!.async("string");
    expect(docXml).toContain("<w:drawing");
    const relId = docXml.match(/r:embed="([^"]*)"/)?.[1];
    expect(relId).toBeDefined();
    const relsXml = await zip.file("word/_rels/document.xml.rels")!.async("string");
    expect(relsXml).toContain(`Id="${relId}"`);
    expect(relsXml).toContain(mediaFiles[0].replace("word/", ""));
  });

  it("DOCX: an invalid mermaid diagram falls back to a code block — no image reference at all, alongside the warning", async () => {
    const writer = new FakeWriter();
    const brokenAdapter = new MemoryVaultAdapter({
      notes: { "N.md": "```mermaid\ngraph TD\n  A[Unclosed bracket -->> B\n```" },
    });
    const deps: ExportDeps = {
      mermaidToSvg: vi.fn(async () => {
        throw new Error("Mermaid parse error");
      }),
      rasterizeSvg: vi.fn(async () => ({ data: new ArrayBuffer(4), width: 1, height: 1 })),
    };
    const result = await exportNote({
      adapter: brokenAdapter,
      writer,
      settings: settings(),
      sourcePath: "N.md",
      format: "docx",
      template: "default",
      deps,
    });
    expect(result.warnings.some((w) => w.construct === "mermaid")).toBe(true);
    expect(deps.rasterizeSvg).not.toHaveBeenCalled();

    const buf = writer.files.get(result.outputPath) as ArrayBuffer;
    const zip = await JSZip.loadAsync(buf);
    const mediaFiles = Object.keys(zip.files).filter((f) => f.startsWith("word/media/") && !zip.files[f].dir);
    expect(mediaFiles.length).toBe(0);

    const docXml = await zip.file("word/document.xml")!.async("string");
    expect(docXml).not.toContain("<w:drawing");
    expect(docXml).toContain("Unclosed bracket");
  });

  it("DOCX: one working and one broken diagram in the same document don't cross-contaminate", async () => {
    const writer = new FakeWriter();
    const source = [
      "```mermaid",
      "graph TD",
      "  A[Start] --> B{Decision}",
      "```",
      "",
      "```mermaid",
      "graph TD",
      "  A[Unclosed bracket -->> B",
      "```",
    ].join("\n");
    const twoDiagramAdapter = new MemoryVaultAdapter({ notes: { "N.md": source } });
    const fakePng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer;
    const deps: ExportDeps = {
      mermaidToSvg: vi.fn(async (src: string) => {
        if (src.includes("Unclosed")) throw new Error("parse error");
        return "<svg xmlns='http://www.w3.org/2000/svg'><rect/></svg>";
      }),
      rasterizeSvg: vi.fn(async () => ({ data: fakePng, width: 1, height: 1 })),
    };
    const result = await exportNote({
      adapter: twoDiagramAdapter,
      writer,
      settings: settings(),
      sourcePath: "N.md",
      format: "docx",
      template: "default",
      deps,
    });
    expect(result.warnings.filter((w) => w.construct === "mermaid").length).toBe(1);
    const buf = writer.files.get(result.outputPath) as ArrayBuffer;
    const zip = await JSZip.loadAsync(buf);
    const mediaFiles = Object.keys(zip.files).filter((f) => f.startsWith("word/media/") && !zip.files[f].dir);
    expect(mediaFiles.length).toBe(1); // only the working diagram
    const docXml = await zip.file("word/document.xml")!.async("string");
    expect((docXml.match(/<w:drawing/g) || []).length).toBe(1);
    expect(docXml).toContain("Unclosed bracket");
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
