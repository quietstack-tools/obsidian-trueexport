import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { renderToDocx, pngBytes } from "../../helpers/render-docx";
import { textToArrayBuffer } from "../../helpers/memory-adapter";

// §14.2 Stage 4 completion criterion + acceptance #2: torture.md must export to
// a valid DOCX containing no [[.
const TORTURE = readFileSync(
  resolvePath(__dirname, "../../fixtures/torture.md"),
  "utf8",
);

const VAULT = {
  sourcePath: "torture.md",
  notes: {
    "torture.md": "",
    "Target Note.md": "# Target\n\nTarget content.",
    "Included.md": "## Included Section\n\nTranscluded content here.",
  },
  binaries: {
    "pic.png": pngBytes(),
    "diagram.png": pngBytes(),
    "drawing.svg": textToArrayBuffer("<svg/>"),
  },
  included: ["torture.md", "Target Note.md"],
};

describe("torture.md → DOCX", () => {
  it("produces a valid ZIP with the required parts", async () => {
    const { hasEntry } = await renderToDocx(TORTURE, VAULT);
    expect(hasEntry("word/document.xml")).toBe(true);
    expect(hasEntry("[Content_Types].xml")).toBe(true);
    expect(hasEntry("_rels/.rels")).toBe(true);
    expect(hasEntry("word/numbering.xml")).toBe(true);
    expect(hasEntry("word/footnotes.xml")).toBe(true);
  });

  it("emits well-formed XML", async () => {
    const { documentXml } = await renderToDocx(TORTURE, VAULT);
    const doc = new DOMParser().parseFromString(documentXml, "application/xml");
    expect(doc.getElementsByTagName("parsererror").length).toBe(0);
  });

  it("contains NO [[ or ]] anywhere (the top failure mode)", async () => {
    const { documentXml } = await renderToDocx(TORTURE, VAULT);
    expect(documentXml.includes("[[")).toBe(false);
    expect(documentXml.includes("]]")).toBe(false);
  });

  it("splices transcluded content and renders image placeholders", async () => {
    const { documentXml, entries } = await renderToDocx(TORTURE, VAULT);
    expect(documentXml).toContain("Transcluded content here");
    expect(documentXml).toContain("[Image not found: does-not-exist.png]");
    expect(documentXml).toContain("[SVG image: drawing.svg]");
    expect(entries.some((e) => e.startsWith("word/media/"))).toBe(true);
  });

  it("carries the frontmatter title into document properties", async () => {
    const { zip } = await renderToDocx(TORTURE, VAULT);
    const core = await zip.file("docProps/core.xml")!.async("string");
    expect(core).toContain("Torture Test");
    expect(core).toContain("TrueExport");
  });
});
