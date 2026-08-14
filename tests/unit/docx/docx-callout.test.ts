import { describe, it, expect } from "vitest";
import { renderToDocx } from "../../helpers/render-docx";

describe("DOCX callouts", () => {
  it("renders a single-cell table with a 4pt coloured left border only", async () => {
    const { documentXml } = await renderToDocx("> [!note] Heads Up\n> body text");
    // 4pt (sz=32) single left border in the note colour, other borders none.
    expect(documentXml).toContain('w:left w:val="single" w:color="086DDD" w:sz="32"');
    expect(documentXml).toContain('w:top w:val="none"');
    expect(documentXml).toContain('w:right w:val="none"');
  });

  it("tints the cell background", async () => {
    const { documentXml } = await renderToDocx("> [!note] T\n> b");
    // A light tint of #086DDD.
    expect(documentXml).toContain("e1edfb");
  });

  it("renders the title in bold", async () => {
    const { documentXml } = await renderToDocx("> [!note] Heads Up\n> body");
    expect(documentXml).toContain("Heads Up");
    expect(documentXml).toContain("<w:b/>");
  });

  it("uses the warning colour for warning callouts", async () => {
    const { documentXml } = await renderToDocx("> [!warning] Careful\n> b");
    expect(documentXml).toContain('w:color="EC7500"');
  });

  it("falls back to the note colour for unknown types", async () => {
    const { documentXml } = await renderToDocx("> [!nonsense] X\n> b");
    expect(documentXml).toContain('w:color="086DDD"');
  });

  it("supports a nested callout", async () => {
    const { documentXml } = await renderToDocx(
      "> [!info] Outer\n> > [!danger] Inner\n> > text",
    );
    expect(documentXml).toContain('w:color="E93147"'); // danger
    expect(documentXml).toContain("Inner");
  });
});
