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
});
