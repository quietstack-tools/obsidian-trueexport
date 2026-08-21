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

  it("gives a top-level blockquote a left border, and a nested blockquote more indent + its own border", async () => {
    const { documentXml } = await renderToDocx(
      "> Outer blockquote.\n> > Nested blockquote.",
    );
    const doc = new DOMParser().parseFromString(documentXml, "application/xml");
    const paragraphs = Array.from(doc.getElementsByTagName("w:p")).filter(
      (p) => p.getElementsByTagName("w:t").length > 0,
    );

    const outerPara = paragraphs.find((p) => (p.textContent ?? "").includes("Outer blockquote"));
    const nestedPara = paragraphs.find((p) => (p.textContent ?? "").includes("Nested blockquote"));
    expect(outerPara).toBeDefined();
    expect(nestedPara).toBeDefined();

    const outerBorder = outerPara!.getElementsByTagName("w:pBdr")[0]?.getElementsByTagName("w:left")[0];
    const nestedBorder = nestedPara!.getElementsByTagName("w:pBdr")[0]?.getElementsByTagName("w:left")[0];
    expect(outerBorder).toBeDefined();
    expect(nestedBorder).toBeDefined();
    expect(outerBorder!.getAttribute("w:val")).toBe("single");
    expect(nestedBorder!.getAttribute("w:val")).toBe("single");

    const outerIndent = Number(outerPara!.getElementsByTagName("w:ind")[0]?.getAttribute("w:left"));
    const nestedIndent = Number(nestedPara!.getElementsByTagName("w:ind")[0]?.getAttribute("w:left"));
    expect(nestedIndent).toBeGreaterThan(outerIndent);
  });

  it("adds a spacer between separate sibling blockquotes so their left borders don't visually touch", async () => {
    // Same root cause as thematicBreak/callout-table spacing this session:
    // three distinct `>` blockquotes (blank line between each — three
    // separate BlockquoteNodes, not one multi-paragraph quote) rendered as
    // one unbroken bar with no gap.
    const { documentXml } = await renderToDocx("> First quote.\n\n> Second quote.\n\n> Third quote.");
    const doc = new DOMParser().parseFromString(documentXml, "application/xml");
    const bodyChildren = Array.from(doc.getElementsByTagName("w:body")[0].children);

    const indexOf = (needle: string): number =>
      bodyChildren.findIndex((el) => (el.textContent ?? "").includes(needle));
    const firstIndex = indexOf("First quote");
    const secondIndex = indexOf("Second quote");
    const thirdIndex = indexOf("Third quote");
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThan(firstIndex);
    expect(thirdIndex).toBeGreaterThan(secondIndex);

    // A spacer paragraph (no border, w:spacing w:after) sits directly
    // between each pair of sibling quote paragraphs.
    const spacerAfterFirst = bodyChildren[firstIndex + 1];
    const spacerAfterSecond = bodyChildren[secondIndex + 1];
    for (const spacer of [spacerAfterFirst, spacerAfterSecond]) {
      expect(spacer.tagName).toBe("w:p");
      expect(spacer.getElementsByTagName("w:pBdr").length).toBe(0);
      expect(spacer.getElementsByTagName("w:spacing")[0]?.getAttribute("w:after")).toBe("120");
    }
  });

  it("does NOT add a spacer after a nested blockquote (only distinct siblings need the gap)", async () => {
    const { documentXml } = await renderToDocx("> Outer start.\n> > Nested.\n> Outer end.");
    const doc = new DOMParser().parseFromString(documentXml, "application/xml");
    const bodyChildren = Array.from(doc.getElementsByTagName("w:body")[0].children);
    const nestedIndex = bodyChildren.findIndex((el) => (el.textContent ?? "").includes("Nested"));
    const nextEl = bodyChildren[nestedIndex + 1];
    // Whatever follows the nested quote's paragraph is NOT a bare spacer —
    // it's the next real content (or, if the nested quote were last, the
    // outer quote's own top-level spacer, which would come after "Outer
    // end." instead). Here it must be the "Outer end." paragraph directly.
    expect(nextEl.textContent ?? "").toContain("Outer end");
  });

  it("shows a right-aligned language label above a labeled code fence, and none for an unlabeled one", async () => {
    const labeled = await renderToDocx("```python\nx = 1\n```");
    expect(labeled.documentXml).toContain(">python<");
    const labelPara = Array.from(
      new DOMParser().parseFromString(labeled.documentXml, "application/xml").getElementsByTagName("w:p"),
    ).find((p) => (p.textContent ?? "").trim() === "python");
    expect(labelPara).toBeDefined();
    expect(labelPara!.getElementsByTagName("w:jc")[0]?.getAttribute("w:val")).toBe("right");

    const unlabeled = await renderToDocx("```\nx = 1\n```");
    expect(unlabeled.documentXml).not.toContain(">python<");
    const noLabelParas = Array.from(
      new DOMParser().parseFromString(unlabeled.documentXml, "application/xml").getElementsByTagName("w:p"),
    ).filter((p) => (p.textContent ?? "").trim() === "");
    // No stray right-aligned label paragraph in the unlabeled case.
    expect(noLabelParas.every((p) => p.getElementsByTagName("w:jc").length === 0)).toBe(true);
  });

  it("colours a recognised language's tokens distinctly; an unrecognised language and no language stay monospace-only", async () => {
    const highlighted = await renderToDocx("```python\ndef greet(name):  # hi\n    return name\n```");
    const doc = new DOMParser().parseFromString(highlighted.documentXml, "application/xml");
    const runs = Array.from(doc.getElementsByTagName("w:r"));
    const colors = new Set(
      runs.map((r) => r.getElementsByTagName("w:color")[0]?.getAttribute("w:val")).filter((c): c is string => !!c),
    );
    // At least keyword (def) and comment (# hi) colours should both appear —
    // i.e. more than just the single flat "code" colour used before this
    // feature existed.
    expect(colors.size).toBeGreaterThan(1);

    const plainSource = "```\ndef greet(name):  # hi\n```";
    const plain = await renderToDocx(plainSource);
    const plainDoc = new DOMParser().parseFromString(plain.documentXml, "application/xml");
    const plainColors = new Set(
      Array.from(plainDoc.getElementsByTagName("w:r"))
        .map((r) => r.getElementsByTagName("w:color")[0]?.getAttribute("w:val"))
        .filter((c): c is string => !!c),
    );
    expect(plainColors.size).toBe(1); // every run the same single colour

    const unrecognized = await renderToDocx("```cobol\nDISPLAY 'HI'.\n```");
    const unrecognizedDoc = new DOMParser().parseFromString(unrecognized.documentXml, "application/xml");
    const unrecognizedColors = new Set(
      Array.from(unrecognizedDoc.getElementsByTagName("w:r"))
        .map((r) => r.getElementsByTagName("w:color")[0]?.getAttribute("w:val"))
        .filter((c): c is string => !!c),
    );
    // The label run has its own (caption) colour, so allow up to 2 distinct
    // colours here — but the code line itself must stay single-colour.
    const codeLinePara = Array.from(unrecognizedDoc.getElementsByTagName("w:p")).find((p) =>
      (p.textContent ?? "").includes("DISPLAY"),
    );
    const codeLineColors = new Set(
      Array.from(codeLinePara!.getElementsByTagName("w:r"))
        .map((r) => r.getElementsByTagName("w:color")[0]?.getAttribute("w:val"))
        .filter((c): c is string => !!c),
    );
    expect(codeLineColors.size).toBe(1);
    expect(unrecognizedColors.size).toBeGreaterThanOrEqual(1);
  });

  it("colours Python True/False/None the same keyword colour as other keywords, not the plain code colour", async () => {
    const { documentXml } = await renderToDocx("```python\nis_admin = True\nfound = False\nx = None\n```");
    const doc = new DOMParser().parseFromString(documentXml, "application/xml");
    const runs = Array.from(doc.getElementsByTagName("w:r"));
    const colorOf = (text: string): string | undefined =>
      runs
        .find((r) => (r.getElementsByTagName("w:t")[0]?.textContent ?? "") === text)
        ?.getElementsByTagName("w:color")[0]
        ?.getAttribute("w:val") ?? undefined;

    expect(colorOf("True")).toBe("0000FF");
    expect(colorOf("False")).toBe("0000FF");
    expect(colorOf("None")).toBe("0000FF");
    // Not the flat "plain code" grey these literals would get if they were
    // mistakenly left untokenized as ordinary identifiers.
    expect(colorOf("True")).not.toBe("333333");
  });
});
