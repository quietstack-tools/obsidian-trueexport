import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as JSZip from "jszip";
import { extractStylesFromXml, parseReferenceStyles } from "../../../src/docx/reference-styles";

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const FIXTURE = toArrayBuffer(readFileSync("tests/fixtures/reference-styles.docx"));

// A compact but realistic styles.xml for string-level unit tests.
const XML = `<?xml version="1.0"?>
<w:styles xmlns:w="x">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/>
      <w:color w:val="112233"/><w:sz w:val="24"/><w:szCs w:val="24"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr>
      <w:spacing w:after="210" w:line="288" w:lineRule="auto"/>
    </w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:spacing w:before="320" w:after="160"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Arial Black"/><w:b/><w:bCs/><w:color w:val="AA0011"/><w:sz w:val="52"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Quote">
    <w:name w:val="Quote"/>
    <w:pPr><w:ind w:left="480"/></w:pPr>
    <w:rPr><w:i/><w:iCs/><w:color w:val="445566"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Caption">
    <w:name w:val="caption"/>
    <w:pPr><w:jc w:val="center"/></w:pPr>
    <w:rPr><w:i/><w:color w:val="778899"/><w:sz w:val="19"/></w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="Code">
    <w:name w:val="Code"/>
    <w:rPr><w:rFonts w:ascii="Fira Code"/><w:color w:val="006622"/><w:sz w:val="21"/></w:rPr>
  </w:style>
</w:styles>`;

describe("extractStylesFromXml", () => {
  it("extracts Normal from docDefaults (font, colour, size, spacing)", () => {
    const s = extractStylesFromXml(XML);
    expect(s.normal?.run).toEqual({ font: "Georgia", color: "112233", size: 24 });
    expect(s.normal?.paragraph).toEqual({ after: 210, line: 288, lineRule: "auto" });
  });

  it("extracts a heading's font, weight, colour, size and spacing", () => {
    const s = extractStylesFromXml(XML);
    expect(s.heading1).toEqual({
      run: { font: "Arial Black", bold: true, color: "AA0011", size: 52 },
      paragraph: { before: 320, after: 160 },
    });
  });

  it("extracts Quote (italics, colour, indent) and Caption (alignment, size)", () => {
    const s = extractStylesFromXml(XML);
    expect(s.quote).toEqual({ run: { italics: true, color: "445566" }, paragraph: { indentLeft: 480 } });
    expect(s.caption).toEqual({ run: { italics: true, color: "778899", size: 19 }, paragraph: { alignment: "center" } });
  });

  it("extracts the character Code style", () => {
    const s = extractStylesFromXml(XML);
    expect(s.code).toEqual({ run: { font: "Fira Code", color: "006622", size: 21 } });
  });

  it("leaves categories the reference doesn't define undefined (field-by-field fallback)", () => {
    const only = `<w:styles xmlns:w="x"><w:docDefaults><w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Verdana"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`;
    const s = extractStylesFromXml(only);
    expect(s.normal?.run).toEqual({ font: "Verdana" });
    expect(s.heading1).toBeUndefined();
    expect(s.quote).toBeUndefined();
    expect(s.caption).toBeUndefined();
    expect(s.code).toBeUndefined();
  });

  it("treats <w:b/> as bold but never matches <w:bCs/>, and honours w:val=false", () => {
    const bold = `<w:styles xmlns:w="x"><w:style w:styleId="Heading1"><w:rPr><w:b/><w:bCs/></w:rPr></w:style></w:styles>`;
    expect(extractStylesFromXml(bold).heading1?.run?.bold).toBe(true);

    const notBold = `<w:styles xmlns:w="x"><w:style w:styleId="Heading2"><w:rPr><w:bCs/><w:color w:val="111111"/></w:rPr></w:style></w:styles>`;
    expect(extractStylesFromXml(notBold).heading2?.run?.bold).toBeUndefined();

    const off = `<w:styles xmlns:w="x"><w:style w:styleId="Heading3"><w:rPr><w:b w:val="false"/><w:color w:val="222222"/></w:rPr></w:style></w:styles>`;
    expect(extractStylesFromXml(off).heading3?.run?.bold).toBeUndefined();
  });

  it("ignores an 'auto' colour and maps line rules", () => {
    const xml = `<w:styles xmlns:w="x"><w:docDefaults><w:rPrDefault><w:rPr>
      <w:color w:val="auto"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>
      <w:spacing w:line="240" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`;
    const s = extractStylesFromXml(xml);
    expect(s.normal?.run?.color).toBeUndefined();
    expect(s.normal?.paragraph?.lineRule).toBe("exact");
  });

  it("matches a heading by display name when the styleId differs", () => {
    const xml = `<w:styles xmlns:w="x"><w:style w:styleId="CustomBigHead">
      <w:name w:val="Heading 1"/><w:rPr><w:color w:val="123456"/></w:rPr></w:style></w:styles>`;
    expect(extractStylesFromXml(xml).heading1?.run?.color).toBe("123456");
  });

  it("returns an empty object for junk XML (never throws)", () => {
    expect(extractStylesFromXml("not xml at all <<<")).toEqual({});
    expect(extractStylesFromXml("")).toEqual({});
  });
});

describe("parseReferenceStyles", () => {
  it("parses the committed reference .docx fixture end-to-end", async () => {
    const s = await parseReferenceStyles(FIXTURE);
    expect(s).not.toBeNull();
    expect(s?.normal?.run?.font).toBe("Georgia");
    expect(s?.heading1?.run).toMatchObject({ font: "Arial Black", size: 52, bold: true, color: "AA0011" });
    expect(s?.heading6?.run?.color).toBe("FF5566");
    expect(s?.quote?.paragraph?.indentLeft).toBe(480);
    expect(s?.caption?.paragraph?.alignment).toBe("center");
    expect(s?.code?.run?.font).toBe("Fira Code");
  });

  it("returns null for corrupted (non-zip) bytes without throwing", async () => {
    const junk = new TextEncoder().encode("this is definitely not a zip file").buffer;
    await expect(parseReferenceStyles(junk)).resolves.toBeNull();
  });

  it("returns null for an empty buffer", async () => {
    await expect(parseReferenceStyles(new ArrayBuffer(0))).resolves.toBeNull();
  });

  it("returns null for a valid zip that has no word/styles.xml", async () => {
    // Build a real zip by editing a copy of the fixture (avoids `new JSZip()`).
    const zip = await JSZip.loadAsync(new Uint8Array(FIXTURE));
    zip.remove("word/styles.xml");
    const bytes = await zip.generateAsync({ type: "arraybuffer" });
    await expect(parseReferenceStyles(bytes)).resolves.toBeNull();
  });

  it("returns null for a styles.xml that defines nothing we recognise", async () => {
    const zip = await JSZip.loadAsync(new Uint8Array(FIXTURE));
    zip.file("word/styles.xml", `<w:styles xmlns:w="x"><w:style w:styleId="Unrelated"><w:rPr/></w:style></w:styles>`);
    const bytes = await zip.generateAsync({ type: "arraybuffer" });
    await expect(parseReferenceStyles(bytes)).resolves.toBeNull();
  });
});
