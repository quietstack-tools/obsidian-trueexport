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

  it("renders a horizontal rule as a single-cell table with shading, not a border (cross-app compatibility)", async () => {
    // Attempts 1-3 (paragraph w:pBdr, in various forms) rendered in Word but
    // not Apple Pages. Attempts 4-5 (table w:tblBorders/w:tcBorders) fixed
    // Pages but LibreOffice Writer rendered all four sides of the table as a
    // rectangle despite explicit "none" (attempt 6 width fix aside).
    // Attempt 7 switched "none" to the spec-preferred "nil" (what Word
    // itself emits for "no border") — LibreOffice still drew all four
    // sides even with textbook-correct border XML. Attempt 8 abandons
    // border properties for this element entirely: no border definitions
    // anywhere, and a solid cell shading (w:shd) in the same gray instead —
    // a different OOXML code path than table borders.
    const { documentXml } = await renderToDocx("First paragraph.\n\n---\n\nSecond paragraph.");
    const doc = new DOMParser().parseFromString(documentXml, "application/xml");

    const tables = doc.getElementsByTagName("w:tbl");
    expect(tables.length).toBe(1);
    const table = tables[0];

    // Exactly one row, one cell.
    expect(table.getElementsByTagName("w:tr").length).toBe(1);
    expect(table.getElementsByTagName("w:tc").length).toBe(1);

    // No border is visible anywhere — every side, at both table and cell
    // level, is "nil".
    const tblBorders = table.getElementsByTagName("w:tblBorders");
    expect(tblBorders.length).toBe(1);
    const cell = table.getElementsByTagName("w:tc")[0];
    const tcBorders = cell.getElementsByTagName("w:tcBorders");
    expect(tcBorders.length).toBe(1);
    for (const borders of [tblBorders[0], tcBorders[0]]) {
      for (const side of ["w:top", "w:left", "w:right", "w:bottom"]) {
        const el = borders.getElementsByTagName(side)[0];
        if (el) expect(el.getAttribute("w:val")).toBe("nil");
      }
    }

    // The visible line comes from cell shading instead: a solid fill in the
    // same gray previously used for the border color.
    const shd = cell.getElementsByTagName("w:shd")[0];
    expect(shd).toBeDefined();
    expect(shd.getAttribute("w:val")).toBe("clear");
    expect(shd.getAttribute("w:fill")).toBe("CCCCCC");

    // Full body-text width, matching the other single-cell tables in this file.
    expect(documentXml).toContain('w:tblW w:type="pct" w:w="100%"');

    // The cell paragraph must carry a real, non-empty run so the cell can't
    // collapse to zero height (attempt 4/5's lesson still applies here).
    const cellPara = cell.getElementsByTagName("w:p")[0];
    const runs = cellPara.getElementsByTagName("w:r");
    expect(runs.length).toBe(1);
    const text = runs[0].getElementsByTagName("w:t")[0];
    expect(text.textContent).toBe("\u00A0");

    // The row has an explicit minimum height, so the cell can't collapse
    // regardless of how an importer infers height from content.
    const trHeight = table.getElementsByTagName("w:trHeight")[0];
    expect(trHeight.getAttribute("w:hRule")).toBe("atLeast");

    // gridCol must reflect a realistic full-width value, not docx's tiny
    // 100-twip default (attempt 6).
    const gridCol = table.getElementsByTagName("w:gridCol")[0];
    const width = Number(gridCol.getAttribute("w:w"));
    expect(width).toBeGreaterThan(5000);
  });
});
