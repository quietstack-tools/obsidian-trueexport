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

  it("prepends a plain-Unicode icon to the title, matching the callout's colour group", async () => {
    // Icons are a deliberate deviation from TECH_SPEC.md's original §4.4
    // (updated alongside this) — grouped the same 8 ways as calloutColor().
    // The icon is its own run (so it can carry the accent colour separately
    // from the title's default text colour), so it's a distinct <w:t> just
    // before the title text rather than part of the same run.
    const note = await renderToDocx("> [!note] Heads Up\n> b");
    expect(note.documentXml).toContain(">✎ <");
    expect(note.documentXml).toContain("Heads Up");

    const warning = await renderToDocx("> [!warning] Careful\n> b");
    expect(warning.documentXml).toContain(">⚠ <");
    expect(warning.documentXml).toContain("Careful");

    const danger = await renderToDocx("> [!danger] Watch Out\n> b");
    expect(danger.documentXml).toContain(">⚡ <");
    expect(danger.documentXml).toContain("Watch Out");
  });

  it("uses the note icon (✎) as the default for unknown callout types", async () => {
    const { documentXml } = await renderToDocx("> [!nonsense] X\n> b");
    expect(documentXml).toContain(">✎ <");
  });

  it("adds after-spacing following a callout table, same as thematicBreak (§4.4 tables carry no OOXML spacing-after)", async () => {
    const { documentXml } = await renderToDocx("> [!note] Heads Up\n> body\n\nAfter.");
    const doc = new DOMParser().parseFromString(documentXml, "application/xml");
    const table = doc.getElementsByTagName("w:tbl")[0];
    const spacer = table.nextElementSibling as Element;
    expect(spacer.tagName).toBe("w:p");
    const spacing = spacer.getElementsByTagName("w:spacing")[0];
    expect(spacing.getAttribute("w:after")).toBe("120");
  });
});
