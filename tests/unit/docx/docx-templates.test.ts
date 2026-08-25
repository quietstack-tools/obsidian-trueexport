// D19 regression: selecting a built-in template (§8) must actually change the
// rendered DOCX style table, not just be accepted and silently dropped.

import { describe, it, expect } from "vitest";
import { renderToDocx } from "../../helpers/render-docx";
import type { TemplateId } from "../../../src/core/options";

const NOTE = `# Heading One

Body paragraph.
`;

async function stylesXml(template: TemplateId): Promise<string> {
  const { zip } = await renderToDocx(NOTE, { options: { template } });
  return zip.file("word/styles.xml")!.async("string");
}

describe("DOCX template selection (§8)", () => {
  it("Default uses Calibri and the blue heading colour", async () => {
    const xml = await stylesXml("default");
    expect(xml).toContain("Calibri");
    expect(xml).toContain("1F3864");
  });

  it("Professional uses a dark-grey heading colour, not the default blue", async () => {
    const xml = await stylesXml("professional");
    expect(xml).toContain("404040");
    expect(xml).not.toContain("1F3864");
  });

  it("Academic uses Georgia, a 12pt/double-spaced normal style, and black headings", async () => {
    const xml = await stylesXml("academic");
    expect(xml).toContain("Georgia");
    expect(xml).toContain('w:sz w:val="24"'); // 12pt
    expect(xml).toContain('w:line="480"'); // double-spaced
    expect(xml).not.toContain("1F3864");
  });

  it("Minimal uses Arial and black headings, not the default blue", async () => {
    const xml = await stylesXml("minimal");
    expect(xml).toContain('w:ascii="Arial"');
    expect(xml).not.toContain("1F3864");
  });

  it("all four built-ins produce genuinely different style tables", async () => {
    const [d, p, a, m] = await Promise.all(
      (["default", "professional", "academic", "minimal"] as const).map(stylesXml),
    );
    const all = [d, p, a, m];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(all[i]).not.toBe(all[j]);
      }
    }
  });

  it("an unrecognised/Pro-custom template id falls back to the Default character", async () => {
    const xml = await stylesXml("some-custom-template-id");
    const defaultXml = await stylesXml("default");
    expect(xml).toBe(defaultXml);
  });
});
