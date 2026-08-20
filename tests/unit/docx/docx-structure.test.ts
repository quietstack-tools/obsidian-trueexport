import { describe, it, expect } from "vitest";
import { renderToDocx } from "../../helpers/render-docx";

// §9.3 DOCX validation: these are the automated regression tests for the top
// failure modes. They prove structural validity only — not visual correctness.

const SOURCE = [
  "# Heading One",
  "",
  "A paragraph with a footnote[^1].",
  "",
  "- item one",
  "- item two",
  "",
  "[^1]: The footnote text.",
].join("\n");

describe("DOCX structure (§9.3)", () => {
  it("produces a valid ZIP with the required OOXML parts", async () => {
    const { hasEntry } = await renderToDocx(SOURCE);
    expect(hasEntry("word/document.xml")).toBe(true);
    expect(hasEntry("[Content_Types].xml")).toBe(true);
    expect(hasEntry("_rels/.rels")).toBe(true);
  });

  it("emits well-formed XML for document.xml", async () => {
    const { documentXml } = await renderToDocx(SOURCE);
    const doc = new DOMParser().parseFromString(documentXml, "application/xml");
    expect(doc.getElementsByTagName("parsererror").length).toBe(0);
  });

  it("contains the expected content strings", async () => {
    const { documentXml } = await renderToDocx(SOURCE);
    expect(documentXml).toContain("Heading One");
    expect(documentXml).toContain("A paragraph with a footnote");
  });

  it("contains NO [[ or ]] anywhere in document.xml (critical regression)", async () => {
    const { documentXml } = await renderToDocx(
      "See [[Target]] and [[Ghost]] and [[#Heading One]].\n\n# Heading One",
      { notes: { "Note.md": "", "Target.md": "x" }, included: ["Note.md", "Target.md"] },
    );
    expect(documentXml.includes("[[")).toBe(false);
    expect(documentXml.includes("]]")).toBe(false);
  });

  it("includes numbering definitions when the source had lists", async () => {
    const { hasEntry } = await renderToDocx(SOURCE);
    expect(hasEntry("word/numbering.xml")).toBe(true);
  });

  it("includes footnote parts when the source had footnotes", async () => {
    const { hasEntry } = await renderToDocx(SOURCE);
    expect(hasEntry("word/footnotes.xml")).toBe(true);
  });

  it("emits w:lang on runs for spellcheck", async () => {
    const { documentXml } = await renderToDocx(SOURCE);
    expect(documentXml).toContain("w:lang");
  });

  it("renders a horizontal rule as a paragraph-level bottom border with explicit height (cross-app compatibility)", async () => {
    const { documentXml } = await renderToDocx("First paragraph.\n\n---\n\nSecond paragraph.");
    const doc = new DOMParser().parseFromString(documentXml, "application/xml");
    const pBdr = doc.getElementsByTagName("w:pBdr");
    expect(pBdr.length).toBe(1);
    const bottom = pBdr[0].getElementsByTagName("w:bottom");
    expect(bottom.length).toBe(1);
    expect(bottom[0].getAttribute("w:val")).toBe("single");

    // The rule paragraph itself: explicit spacing and a paragraph-mark run
    // size, so the paragraph has real height even with no run content — an
    // otherwise fully empty paragraph is how Apple Pages was observed to
    // drop the rule entirely (the pBdr has no line height to draw against).
    const rulePPr = pBdr[0].parentNode as Element;
    expect(rulePPr.tagName).toBe("w:pPr");
    expect(rulePPr.getElementsByTagName("w:spacing").length).toBe(1);
    const rPr = rulePPr.getElementsByTagName("w:rPr");
    expect(rPr.length).toBe(1);
    expect(rPr[0].getElementsByTagName("w:sz").length).toBe(1);

    // The rule paragraph must carry an actual <w:r> run (not just
    // paragraph-mark rPr) — spacing + rPr alone were not enough to make
    // Apple Pages draw the border (verified by manual test; attempt 2).
    const rulePara = rulePPr.parentNode as Element;
    expect(rulePara.tagName).toBe("w:p");
    const runs = Array.from(rulePara.childNodes).filter((n): n is Element => (n as Element).tagName === "w:r");
    expect(runs.length).toBe(1);

    // The run's text must be genuinely non-empty — a self-closing
    // <w:t xml:space="preserve"/> (empty string) was still not enough
    // (attempt 2, confirmed by inspecting the generated XML). A non-breaking
    // space gives the <w:t> real content that can't be whitespace-collapsed.
    const text = runs[0].getElementsByTagName("w:t")[0];
    expect(text.textContent).toBe(" ");
    expect(text.getAttribute("xml:space")).toBe("preserve");
  });
});
