import { describe, it, expect } from "vitest";
import { renderToDocx, pngBytes } from "../../helpers/render-docx";
import { textToArrayBuffer } from "../../helpers/memory-adapter";

describe("DOCX content", () => {
  it("renders inline formatting as run properties", async () => {
    const { documentXml } = await renderToDocx("A **bold** and *italic* and `code` word.");
    expect(documentXml).toContain("<w:b/>");
    expect(documentXml).toContain("<w:i/>");
    expect(documentXml).toContain("bold");
  });

  it("renders an external link as a hyperlink", async () => {
    const { documentXml, zip } = await renderToDocx("see [site](https://example.com) now");
    expect(documentXml).toContain("w:hyperlink");
    const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
    expect(rels).toContain("https://example.com");
  });

  it("renders a footnote reference run", async () => {
    const { documentXml } = await renderToDocx("text[^1]\n\n[^1]: note");
    expect(documentXml).toContain("w:footnoteReference");
  });

  it("embeds a local image and a placeholder for a missing one", async () => {
    const { documentXml, entries } = await renderToDocx(
      "![real](pic.png)\n\n![gone](missing.png)",
      { binaries: { "pic.png": pngBytes() } },
    );
    expect(entries.some((e) => e.startsWith("word/media/"))).toBe(true);
    expect(documentXml).toContain("[Image not found: missing.png]");
  });

  it("rasterises SVG via the injected dep instead of a placeholder", async () => {
    const { documentXml, entries } = await renderToDocx(
      "![vec](drawing.svg)",
      { binaries: { "drawing.svg": textToArrayBuffer("<svg/>") } },
      { deps: { rasterizeSvg: async () => ({ data: pngBytes() }) } },
    );
    expect(entries.some((e) => e.startsWith("word/media/"))).toBe(true);
    expect(documentXml).not.toContain("[SVG image");
  });

  it("falls back to an SVG placeholder without a rasteriser", async () => {
    const { documentXml } = await renderToDocx("![vec](drawing.svg)", {
      binaries: { "drawing.svg": textToArrayBuffer("<svg/>") },
    });
    expect(documentXml).toContain("[SVG image: drawing.svg]");
  });

  it("sets document properties: creator TrueExport, title, and free-tier attribution", async () => {
    const { zip } = await renderToDocx("body", { sourcePath: "My Report.md" });
    const core = await zip.file("docProps/core.xml")!.async("string");
    expect(core).toContain("TrueExport");
    expect(core).toContain("My Report");
    expect(core).toContain("quietstack.tools");
  });

  it("omits the attribution on Pro", async () => {
    const { zip } = await renderToDocx("body", {}, { pro: true });
    const core = await zip.file("docProps/core.xml")!.async("string");
    expect(core).not.toContain("quietstack.tools");
  });

  it("keeps attribution out of the visible body", async () => {
    const { documentXml } = await renderToDocx("body");
    expect(documentXml).not.toContain("quietstack.tools");
  });
});

describe("DOCX frontmatter and unsupported rendering", () => {
  it("renders frontmatter as a two-column table in table mode", async () => {
    const { documentXml } = await renderToDocx("---\ntitle: T\nauthor: Jane\n---\n\nbody", {
      options: { frontmatterMode: "table" },
    });
    expect(documentXml).toContain("author");
    expect(documentXml).toContain("Jane");
    expect(documentXml).toContain('w:tblW w:type="pct" w:w="100%"');
  });

  it("maps frontmatter to properties in metadata mode", async () => {
    const { zip } = await renderToDocx("---\ntitle: Meta\ntags: [x, y]\n---\n\nbody", {
      options: { frontmatterMode: "metadata" },
    });
    const core = await zip.file("docProps/core.xml")!.async("string");
    expect(core).toContain("Meta");
    expect(core).toContain("x, y");
  });

  it("renders an unsupported construct as a visible placeholder, not raw", async () => {
    const { documentXml } = await renderToDocx("```dataview\nlist\n```");
    expect(documentXml).toContain("Dataview queries cannot be exported");
    expect(documentXml).not.toContain("```");
  });
});
