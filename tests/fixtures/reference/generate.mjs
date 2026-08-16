// Regenerate tests/fixtures/reference-styles.docx — a reference "house style"
// .docx with distinctive, known values for every §5.1 style category, used by
// the reference-styles extraction tests. Run: node tests/fixtures/reference/generate.mjs
import { Document, Packer, Paragraph, AlignmentType, LineRuleType } from "docx";
import { writeFileSync } from "fs";

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: "Georgia", size: 24, color: "112233" },
        paragraph: { spacing: { after: 210, line: 288, lineRule: LineRuleType.AUTO } },
      },
      heading1: { run: { font: "Arial Black", size: 52, bold: true, color: "AA0011" },
        paragraph: { spacing: { before: 320, after: 160 } } },
      heading2: { run: { font: "Arial", size: 44, bold: true, color: "BB1122" },
        paragraph: { spacing: { before: 280, after: 140 } } },
      heading3: { run: { font: "Arial", size: 38, bold: true, color: "CC2233" },
        paragraph: { spacing: { before: 240, after: 120 } } },
      heading4: { run: { font: "Arial", size: 32, bold: true, color: "DD3344" },
        paragraph: { spacing: { before: 200, after: 100 } } },
      heading5: { run: { font: "Arial", size: 28, bold: true, color: "EE4455" },
        paragraph: { spacing: { before: 160, after: 80 } } },
      heading6: { run: { font: "Arial", size: 26, bold: true, color: "FF5566" },
        paragraph: { spacing: { before: 120, after: 60 } } },
    },
    paragraphStyles: [
      { id: "Quote", name: "Quote", basedOn: "Normal",
        run: { italics: true, color: "445566" }, paragraph: { indent: { left: 480 } } },
      { id: "Caption", name: "caption", basedOn: "Normal",
        run: { italics: true, size: 19, color: "778899" }, paragraph: { alignment: AlignmentType.CENTER } },
    ],
    characterStyles: [
      { id: "Code", name: "Code", run: { font: "Fira Code", size: 21, color: "006622" } },
    ],
  },
  sections: [{ children: [new Paragraph("reference")] }],
});
const buf = await Packer.toBuffer(doc);
writeFileSync("tests/fixtures/reference-styles.docx", buf);
console.log("wrote tests/fixtures/reference-styles.docx", buf.length, "bytes");
