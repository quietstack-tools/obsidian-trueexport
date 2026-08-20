import { describe, it, expect } from "vitest";
import { renderToDocx } from "../../helpers/render-docx";

// §9.3 DOCX validation: these are the automated regression tests for the top
// failure modes. They prove structural validity only — not visual correctness.

const SOURCE = [
  "# Heading One",
  "",
  "A paragraph with a footnote[^1].",
  "",
  "- item one",
  "- item two",
  "",
  "[^1]: The footnote text.",
].join("\n");

describe("DOCX structure (§9.3)", () => {
  it("produces a valid ZIP with the required OOXML parts", async () => {
    const { hasEntry } = await renderToDocx(SOURCE);
    expect(hasEntry("word/document.xml")).toBe(true);
    expect(hasEntry("[Content_Types].xml")).toBe(true);
    expect(hasEntry("_rels/.rels")).toBe(true);
  });

  it("emits well-formed XML for document.xml", async () => {
    const { documentXml } = await renderToDocx(SOURCE);
    const doc = new DOMParser().parseFromString(documentXml, "application/xml");
    expect(doc.getElementsByTagName("parsererror").length).toBe(0);
  });

  it("contains the expected content strings", async () => {
    const { documentXml } = await renderToDocx(SOURCE);
    expect(documentXml).toContain("Heading One");
    expect(documentXml).toContain("A paragraph with a footnote");
  });

  it("contains NO [[ or ]] anywhere in document.xml (critical regression)", async () => {
    const { documentXml } = await renderToDocx(
      "See [[Target]] and [[Ghost]] and [[#Heading One]].\n\n# Heading One",
      { notes: { "Note.md": "", "Target.md": "x" }, included: ["Note.md", "Target.md"] },
    );
    expect(documentXml.includes("[[")).toBe(false);
    expect(documentXml.includes("]]")).toBe(false);
  });

  it("includes numbering definitions when the source had lists", async () => {
    const { hasEntry } = await renderToDocx(SOURCE);
    expect(hasEntry("word/numbering.xml")).toBe(true);
  });

  it("includes footnote parts when the source had footnotes", async () => {
    const { hasEntry } = await renderToDocx(SOURCE);
    expect(hasEntry("word/footnotes.xml")).toBe(true);
  });

  it("emits w:lang on runs for spellcheck", async () => {
    const { documentXml } = await renderToDocx(SOURCE);
    expect(documentXml).toContain("w:lang");
  });

  it("renders a horizontal rule as a single-cell table with only a bottom border (cross-app compatibility)", async () => {
    // Three paragraph-border attempts (plain w:pBdr; + spacing/rPr size;
    // + an explicit run, first empty then a non-breaking space) all rendered
    // correctly in Word but were confirmed by manual test to leave the rule
    // invisible in Apple Pages. Switched to the same single-cell-table
    // pattern the codebase already uses for callouts/code blocks, which
    // sidesteps paragraph-border rendering entirely.
    const { documentXml } = await renderToDocx("First paragraph.\n\n---\n\nSecond paragraph.");
    const doc = new DOMParser().parseFromString(documentXml, "application/xml");

    const tables = doc.getElementsByTagName("w:tbl");
    expect(tables.length).toBe(1);
    const table = tables[0];

    // Exactly one row, one cell.
    expect(table.getElementsByTagName("w:tr").length).toBe(1);
    expect(table.getElementsByTagName("w:tc").length).toBe(1);

    // Table borders: only bottom is visible; top/left/right/inside are "none".
    const tblBorders = table.getElementsByTagName("w:tblBorders");
    expect(tblBorders.length).toBe(1);
    const bottom = tblBorders[0].getElementsByTagName("w:bottom")[0];
    expect(bottom.getAttribute("w:val")).toBe("single");
    for (const side of ["w:top", "w:left", "w:right", "w:insideH", "w:insideV"]) {
      const el = tblBorders[0].getElementsByTagName(side)[0];
      expect(el.getAttribute("w:val")).toBe("none");
    }

    // Full body-text width, matching the other single-cell tables in this file.
    expect(documentXml).toContain('w:tblW w:type="pct" w:w="100%"');
  });
});
