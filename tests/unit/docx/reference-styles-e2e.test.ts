import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderToDocx } from "../../helpers/render-docx";
import { parseReferenceStyles } from "../../../src/docx/reference-styles";

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
});

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
