import { describe, it, expect } from "vitest";
import { renderToDocx } from "../../helpers/render-docx";

const TABLE = "| Left | Center | Right |\n|:-----|:------:|------:|\n| a | b | c |";

describe("DOCX tables", () => {
  it("uses percentage width at 100% (not fixed width)", async () => {
    const { documentXml } = await renderToDocx(TABLE);
    expect(documentXml).toContain('w:tblW w:type="pct" w:w="100%"');
  });

  it("marks the header row to repeat across pages", async () => {
    const { documentXml } = await renderToDocx(TABLE);
    expect(documentXml).toContain("tblHeader");
  });

  it("shades the header row and uses #CCCCCC borders", async () => {
    const { documentXml } = await renderToDocx(TABLE);
    expect(documentXml).toContain("F5F5F5"); // header fill
    expect(documentXml).toContain("CCCCCC"); // cell borders
  });

  it("applies per-column alignment from the delimiter row", async () => {
    const { documentXml } = await renderToDocx(TABLE);
    expect(documentXml).toContain('w:jc w:val="center"');
    expect(documentXml).toContain('w:jc w:val="right"');
  });

  it("sets explicit, realistic columnWidths (Pages sizes gridCol literally, not just w:tblW)", async () => {
    // docx's Table defaults columnWidths to 100 twips (~0.07in) per column
    // when not given explicitly — Word treats that as a soft hint and
    // defers to w:tblW: 100%, but Apple Pages was confirmed (manual test)
    // to size every table type from gridCol literally, rendering as a
    // narrow, character-wrapped column.
    const { documentXml } = await renderToDocx(TABLE);
    const doc = new DOMParser().parseFromString(documentXml, "application/xml");
    const gridCols = Array.from(doc.getElementsByTagName("w:gridCol"));
    expect(gridCols.length).toBe(3); // Left, Center, Right
    const widths = gridCols.map((c) => Number(c.getAttribute("w:w")));
    for (const w of widths) expect(w).toBeGreaterThan(1000); // nowhere near the 100-twip default
    // Evenly split — no existing convention for uneven columns here.
    expect(new Set(widths).size).toBe(1);
    // Roughly the full usable page width, not some arbitrary total.
    const total = widths.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(8000);
    expect(total).toBeLessThan(9100);
  });
});
