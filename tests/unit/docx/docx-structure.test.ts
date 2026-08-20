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

    // Attempt 4 defined the border only at table level, relying on Word-style
    // inheritance down to the cell — Pages may not replicate that. Attempt 5
    // mirrors the same bottom border at cell level too (belt and suspenders,
    // no reliance on inheritance).
    const cell = table.getElementsByTagName("w:tc")[0];
    const tcBorders = cell.getElementsByTagName("w:tcBorders");
    expect(tcBorders.length).toBe(1);
    const cellBottom = tcBorders[0].getElementsByTagName("w:bottom")[0];
    expect(cellBottom.getAttribute("w:val")).toBe("single");
    expect(cellBottom.getAttribute("w:color")).toBe("CCCCCC");

    // The cell paragraph must carry a real, non-empty run — an empty cell
    // paragraph (attempt 4) risks the same zero-height collapse as the very
    // first paragraph-only attempt, just nested inside a cell.
    const cellPara = cell.getElementsByTagName("w:p")[0];
    const runs = cellPara.getElementsByTagName("w:r");
    expect(runs.length).toBe(1);
    const text = runs[0].getElementsByTagName("w:t")[0];
    expect(text.textContent).toBe(" ");

    // The row has an explicit minimum height, so the cell can't collapse
    // regardless of how an importer infers height from content.
    const trHeight = table.getElementsByTagName("w:trHeight")[0];
    expect(trHeight.getAttribute("w:hRule")).toBe("atLeast");

    // Attempt 6: docx defaults w:tblGrid/w:gridCol to 100 twips (~0.07in)
    // per column when columnWidths isn't set explicitly. Word treats that as
    // a soft hint and defers to w:tblW: 100%, but Pages was observed sizing
    // the rendered rule from gridCol literally, producing a ~15-20px line
    // instead of the full text column. gridCol must reflect a realistic
    // full-width value, not the tiny default.
    const gridCol = table.getElementsByTagName("w:gridCol")[0];
    const width = Number(gridCol.getAttribute("w:w"));
    expect(width).toBeGreaterThan(5000); // nowhere near the 100-twip default
  });

  it("adds after-spacing following the thematicBreak table (regression from paragraph-to-table conversion)", async () => {
    // A Table has no OOXML "spacing after" property of its own — the
    // paragraph-based rule used to carry w:spacing w:after="120" directly,
    // so converting to a table (attempt 4) silently dropped that gap. Fixed
    // by an invisible spacer paragraph (no border, no visible content)
    // immediately after the table, carrying the same 120-twip spacing.
    const { documentXml } = await renderToDocx("First paragraph.\n\n---\n\nSecond paragraph.");
    const doc = new DOMParser().parseFromString(documentXml, "application/xml");

    const table = doc.getElementsByTagName("w:tbl")[0];
    const spacer = table.nextElementSibling as Element;
    expect(spacer.tagName).toBe("w:p");

    const spacing = spacer.getElementsByTagName("w:spacing")[0];
    expect(spacing.getAttribute("w:after")).toBe("120");

    // The spacer carries no run — it exists purely for spacing, not content.
    expect(spacer.getElementsByTagName("w:r").length).toBe(0);
  });
});
