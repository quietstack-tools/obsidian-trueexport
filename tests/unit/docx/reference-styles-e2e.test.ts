import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderToDocx } from "../../helpers/render-docx";
import { parseReferenceStyles, extractStylesFromXml } from "../../../src/docx/reference-styles";

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
const FIXTURE = toArrayBuffer(readFileSync("tests/fixtures/reference-styles.docx"));

const NOTE = `# Heading One

Body paragraph with \`inline code\`.

> A quoted line.

\`\`\`
code block
\`\`\`
`;

async function stylesXml(zip: Awaited<ReturnType<typeof renderToDocx>>["zip"]): Promise<string> {
  return zip.file("word/styles.xml")!.async("string");
}

describe("reference DOCX end-to-end", () => {
  it("applies the reference's fonts/colours in place of the built-in style table", async () => {
    const ref = await parseReferenceStyles(FIXTURE);
    expect(ref).not.toBeNull();

    const withRef = await renderToDocx(NOTE, {}, { referenceStyles: ref! });
    const without = await renderToDocx(NOTE, {}, {});
    const styledWith = await stylesXml(withRef.zip);
    const styledWithout = await stylesXml(without.zip);

    // The two style tables genuinely differ.
    expect(styledWith).not.toBe(styledWithout);

    // Built-in output uses the built-in fonts/colours...
    expect(styledWithout).toContain("Calibri"); // BODY_FONT
    expect(styledWithout).toContain("1F3864"); // built-in Heading 1 colour
    expect(styledWithout).not.toContain("Georgia");

    // ...and the reference output uses the reference's values instead.
    expect(styledWith).toContain("Georgia"); // Normal font
    expect(styledWith).toContain("Arial Black"); // Heading 1 font
    expect(styledWith).toContain("AA0011"); // Heading 1 colour
    expect(styledWith).toContain("Fira Code"); // Code font
    expect(styledWith).not.toContain("1F3864"); // built-in Heading 1 colour is gone
  });

  it("with a reference that defines only Normal, headings/quote/code fall back to built-in", async () => {
    // A reference whose styles.xml defines just docDefaults (Normal).
    const normalOnly = await parseReferenceStyles(await onlyNormalDocx());
    expect(normalOnly?.normal?.run?.font).toBe("Papyrus");
    expect(normalOnly?.heading1).toBeUndefined();

    const { zip } = await renderToDocx(NOTE, {}, { referenceStyles: normalOnly! });
    const styles = await stylesXml(zip);
    expect(styles).toContain("Papyrus"); // Normal overridden
    expect(styles).toContain("Calibri Light"); // built-in HEADING_FONT retained
    expect(styles).toContain("1F3864"); // built-in Heading 1 colour retained
  });
  it("D24: applies ALL six heading levels from a realistic, hand-authored Word styles.xml, not just Heading 1", async () => {
    // Hand-authored to match REAL Word "Modify Style" output structurally
    // (w:link/w:uiPriority/w:qFormat, keepNext/keepLines/outlineLvl in pPr,
    // BOTH a literal w:color/w:val AND a theme fallback on the same element)
    // rather than a docx.js-library-generated fixture — the existing test
    // above only exercises styles.xml as OUR OWN renderer would produce it,
    // which is a narrower shape than what real Word/LibreOffice write.
    const REAL_WORD_XML = `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults>
  <w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${headingBlock(1, "Verdana", "C55A11")}
${headingBlock(2, "Verdana", "D56A21")}
${headingBlock(3, "Verdana", "E57A31")}
${headingBlock(4, "Verdana", "F58A41")}
${headingBlock(5, "Verdana", "165A51")}
${headingBlock(6, "Verdana", "265A61")}
</w:styles>`;

    const ref = extractStylesFromXml(REAL_WORD_XML);
    for (const n of [1, 2, 3, 4, 5, 6] as const) {
      expect(ref[`heading${n}` as const]?.run?.font).toBe("Verdana");
    }

    const { zip } = await renderToDocx(NOTE, {}, { referenceStyles: ref });
    const styles = await stylesXml(zip);

    // Every heading level got ITS OWN reference colour...
    expect(styles).toContain("C55A11");
    expect(styles).toContain("D56A21");
    expect(styles).toContain("E57A31");
    expect(styles).toContain("F58A41");
    expect(styles).toContain("165A51");
    expect(styles).toContain("265A61");

    // ...and NONE of docx's own internal per-heading default colours leaked
    // through (confirmed present in node_modules/docx/dist/index.mjs's
    // DefaultStylesFactory: Heading1/2 default to "2E74B5", Heading3/6 to
    // "1F4D78" — the exact class of value this test guards against).
    expect(styles).not.toContain("2E74B5");
    expect(styles).not.toContain("1F4D78");
  });
});

function headingBlock(n: number, font: string, color: string): string {
  return `<w:style w:type="paragraph" w:styleId="Heading${n}">
  <w:name w:val="heading ${n}"/>
  <w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:link w:val="Heading${n}Char"/>
  <w:uiPriority w:val="9"/><w:qFormat/>
  <w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="0"/><w:outlineLvl w:val="${n - 1}"/></w:pPr>
  <w:rPr>
    <w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>
    <w:b/><w:bCs/>
    <w:color w:val="${color}" w:themeColor="accent6" w:themeShade="BF"/>
    <w:sz w:val="32"/><w:szCs w:val="32"/>
  </w:rPr>
</w:style>`;
}

/** Build a minimal .docx whose only style info is a Normal font override. */
async function onlyNormalDocx(): Promise<ArrayBuffer> {
  const JSZip = await import("jszip");
  const zip = await JSZip.loadAsync(new Uint8Array(FIXTURE));
  zip.file(
    "word/styles.xml",
    `<w:styles xmlns:w="x"><w:docDefaults><w:rPrDefault><w:rPr>` +
      `<w:rFonts w:ascii="Papyrus"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
  );
  return zip.generateAsync({ type: "arraybuffer" });
}
