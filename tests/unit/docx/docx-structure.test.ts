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

  it("renders a horizontal rule as a single-cell table with only a bottom border (cross-app compatibility)", async () => {
    // Three paragraph-border attempts (plain w:pBdr; + spacing/rPr size;
    // + an explicit run, first empty then a non-breaking space) all rendered
    // correctly in Word but were confirmed by manual test to leave the rule
    // invisible in Apple Pages. Switched to the same single-cell-table
    // pattern the codebase already uses for callouts/code blocks, which
    // sidesteps paragraph-border rendering entirely.
    const { documentXml } = await renderToDocx("First paragraph.\n\n---\n\nSecond paragraph.");
    const doc = new DOMParser().parseFromString(documentXml, "application/xml");

    const tables = doc.getElementsByTagName("w:tbl");
    expect(tables.length).toBe(1);
    const table = tables[0];

    // Exactly one row, one cell.
    expect(table.getElementsByTagName("w:tr").length).toBe(1);
    expect(table.getElementsByTagName("w:tc").length).toBe(1);

    // Table borders: only bottom is visible; top/left/right/inside are "none".
    const tblBorders = table.getElementsByTagName("w:tblBorders");
    expect(tblBorders.length).toBe(1);
    const bottom = tblBorders[0].getElementsByTagName("w:bottom")[0];
    expect(bottom.getAttribute("w:val")).toBe("single");
    for (const side of ["w:top", "w:left", "w:right", "w:insideH", "w:insideV"]) {
      const el = tblBorders[0].getElementsByTagName(side)[0];
      expect(el.getAttribute("w:val")).toBe("none");
    }

    // Full body-text width, matching the other single-cell tables in this file.
    expect(documentXml).toContain('w:tblW w:type="pct" w:w="100%"');

    // Attempt 4 defined the border only at table level, relying on Word-style
    // inheritance down to the cell — Pages may not replicate that. Attempt 5
    // mirrors the same bottom border at cell level too (belt and suspenders,
    // no reliance on inheritance).
    const cell = table.getElementsByTagName("w:tc")[0];
    const tcBorders = cell.getElementsByTagName("w:tcBorders");
    expect(tcBorders.length).toBe(1);
    const cellBottom = tcBorders[0].getElementsByTagName("w:bottom")[0];
    expect(cellBottom.getAttribute("w:val")).toBe("single");
    expect(cellBottom.getAttribute("w:color")).toBe("CCCCCC");

    // The cell paragraph must carry a real, non-empty run — an empty cell
    // paragraph (attempt 4) risks the same zero-height collapse as the very
    // first paragraph-only attempt, just nested inside a cell.
    const cellPara = cell.getElementsByTagName("w:p")[0];
    const runs = cellPara.getElementsByTagName("w:r");
    expect(runs.length).toBe(1);
    const text = runs[0].getElementsByTagName("w:t")[0];
    expect(text.textContent).toBe(" ");

    // The row has an explicit minimum height, so the cell can't collapse
    // regardless of how an importer infers height from content.
    const trHeight = table.getElementsByTagName("w:trHeight")[0];
    expect(trHeight.getAttribute("w:hRule")).toBe("atLeast");

    // Attempt 6: docx defaults w:tblGrid/w:gridCol to 100 twips (~0.07in)
    // per column when columnWidths isn't set explicitly. Word treats that as
    // a soft hint and defers to w:tblW: 100%, but Pages was observed sizing
    // the rendered rule from gridCol literally, producing a ~15-20px line
    // instead of the full text column. gridCol must reflect a realistic
    // full-width value, not the tiny default.
    const gridCol = table.getElementsByTagName("w:gridCol")[0];
    const width = Number(gridCol.getAttribute("w:w"));
    expect(width).toBeGreaterThan(5000); // nowhere near the 100-twip default
  });

  it("adds after-spacing following the thematicBreak table (regression from paragraph-to-table conversion)", async () => {
    // A Table has no OOXML "spacing after" property of its own — the
    // paragraph-based rule used to carry w:spacing w:after="120" directly,
    // so converting to a table (attempt 4) silently dropped that gap. Fixed
    // by an invisible spacer paragraph (no border, no visible content)
    // immediately after the table, carrying the same 120-twip spacing.
    const { documentXml } = await renderToDocx("First paragraph.\n\n---\n\nSecond paragraph.");
    const doc = new DOMParser().parseFromString(documentXml, "application/xml");

    const table = doc.getElementsByTagName("w:tbl")[0];
    const spacer = table.nextElementSibling as Element;
    expect(spacer.tagName).toBe("w:p");

    const spacing = spacer.getElementsByTagName("w:spacing")[0];
    expect(spacing.getAttribute("w:after")).toBe("120");

    // The spacer carries no run — it exists purely for spacing, not content.
    expect(spacer.getElementsByTagName("w:r").length).toBe(0);
  });

  it("adds after-spacing following a code-block table (same table-spacing gap as thematicBreak/callouts)", async () => {
    const { documentXml } = await renderToDocx("```\ncode\n```\n\nAfter.");
    const doc = new DOMParser().parseFromString(documentXml, "application/xml");
    const table = doc.getElementsByTagName("w:tbl")[0];
    const spacer = table.nextElementSibling as Element;
    expect(spacer.tagName).toBe("w:p");
    const spacing = spacer.getElementsByTagName("w:spacing")[0];
    expect(spacing.getAttribute("w:after")).toBe("120");
  });

  it("renders a soft line break (single newline, no blank line) as a real w:br, not a collapsed space", async () => {
    // Obsidian's default (non-strict-line-breaks) editor treats a plain
    // newline within a paragraph as a visual line break, same as an
    // explicit hard break (trailing "  " or "\") — both must produce a
    // w:br in DOCX. Previously only the hard case did; a soft break
    // rendered as a single joining space, running distinct source lines
    // together into one line of text.
    const four = "Plain: one\nAliased: two\nSection: three\nBroken: four";
    const { documentXml } = await renderToDocx(four);
    const doc = new DOMParser().parseFromString(documentXml, "application/xml");

    // Exactly one paragraph (no blank lines in the source → still one w:p).
    const paragraphs = doc.getElementsByTagName("w:p");
    expect(paragraphs.length).toBe(1);

    // Three line breaks between four lines.
    const breaks = paragraphs[0].getElementsByTagName("w:br");
    expect(breaks.length).toBe(3);

    // No line's text got merged with its neighbour via a plain space.
    expect(documentXml).not.toContain("one Aliased");
    expect(documentXml).not.toContain("two Section");
    expect(documentXml).not.toContain("three Broken");
    expect(documentXml).toContain("Plain: one");
    expect(documentXml).toContain("Aliased: two");
    expect(documentXml).toContain("Section: three");
    expect(documentXml).toContain("Broken: four");
  });

  it("renders an explicit hard break (trailing two spaces) as a w:br too", async () => {
    const { documentXml } = await renderToDocx("first line  \nsecond line");
    const doc = new DOMParser().parseFromString(documentXml, "application/xml");
    const paragraphs = doc.getElementsByTagName("w:p");
    expect(paragraphs.length).toBe(1);
    expect(paragraphs[0].getElementsByTagName("w:br").length).toBe(1);
  });

  it("gives a repeated footnote citation a NOTEREF field, not a duplicate w:footnoteReference id", async () => {
    // Word requires every <w:footnoteReference> in the body to have a
    // unique id — reusing the same id for a second reference point to the
    // SAME footnote produces a document Word flags as needing repair on
    // open, and silently drops/rewrites the invalid duplicate during that
    // repair (losing the correct jump target). The valid mechanism for a
    // second reference point to an existing footnote is a NOTEREF field
    // targeting a bookmark wrapped around the first, real reference.
    const source = [
      "First reference[^1]. Second reference[^2]. Third reference back to the first[^1].",
      "",
      "[^1]: The first footnote's content.",
      "[^2]: The second footnote's content.",
    ].join("\n");
    const { documentXml, zip } = await renderToDocx(source);
    const doc = new DOMParser().parseFromString(documentXml, "application/xml");

    // Exactly two real footnote reference markers (one per distinct
    // footnote) — the repeat citation must NOT be a third one.
    const refs = Array.from(doc.getElementsByTagName("w:footnoteReference"));
    expect(refs.length).toBe(2);
    const ids = refs.map((r) => r.getAttribute("w:id"));
    expect(new Set(ids).size).toBe(2); // no duplicate ids

    // The bookmark lives at the START OF THE FOOTNOTE'S OWN CONTENT in
    // footnotes.xml, not on the in-body reference mark — Word's own
    // "Insert Cross-Reference → Footnote" bookmarks the mark, which sends a
    // repeat citation back to the ORIGINAL citation point in body text
    // rather than the actual footnote text. Confirmed by manual test that
    // readers expect "click any marker, see the footnote text" (one hop),
    // and that Word does support bookmarks placed inside footnote content,
    // navigable via an ordinary internal hyperlink.
    const footnotesXmlForBookmark = await zip.file("word/footnotes.xml")!.async("string");
    const footnotesDocForBookmark = new DOMParser().parseFromString(footnotesXmlForBookmark, "application/xml");
    const footnoteBookmark = Array.from(footnotesDocForBookmark.getElementsByTagName("w:bookmarkStart")).find((b) =>
      (b.getAttribute("w:name") ?? "").includes("footnoteref-1"),
    );
    expect(footnoteBookmark).toBeDefined();
    // Not in the body — only inside the footnote.
    expect(doc.getElementsByTagName("w:bookmarkStart").length).toBe(0);

    // ...and the repeat citation is a real OOXML complex field (begin /
    // instrText / separate / cached result / end), not a second
    // w:footnoteReference and not a w:fldSimple.
    expect(doc.getElementsByTagName("w:fldSimple").length).toBe(0);
    const fieldChars = Array.from(doc.getElementsByTagName("w:fldChar"));
    const types = fieldChars.map((f) => f.getAttribute("w:fldCharType"));
    expect(types).toEqual(["begin", "separate", "end"]);
    expect(fieldChars[0].getAttribute("w:dirty")).toBe("true");

    const instrTexts = Array.from(doc.getElementsByTagName("w:instrText"));
    expect(instrTexts.length).toBe(1);
    const instr = instrTexts[0].textContent ?? "";
    expect(instr).toContain("NOTEREF");
    expect(instr).toContain(footnoteBookmark!.getAttribute("w:name"));
    expect(instr).toContain("\\f");
    expect(instr).toContain("\\h");

    // The cached result run (the visible "1") is explicitly superscript,
    // not relying only on a style reference — direct formatting is more
    // likely to survive Word recomputing the field (unverified: can't
    // render in Word directly).
    const runs = Array.from(doc.getElementsByTagName("w:r"));
    const resultRun = runs.find((r) => (r.getElementsByTagName("w:t")[0]?.textContent ?? "") === "1");
    expect(resultRun).toBeDefined();
    expect(resultRun!.getElementsByTagName("w:vertAlign")[0]?.getAttribute("w:val")).toBe("superscript");
    expect(resultRun!.getElementsByTagName("w:rStyle")[0]?.getAttribute("w:val")).toBe("FootnoteReference");

    // footnotes.xml still has exactly two real footnote entries — no
    // duplication there (the bug was in the body's reference ids, not
    // footnotes.xml itself). Word auto-generates two extra built-in entries
    // (separator + continuation separator, id="-1"/"0"), so filter to
    // positive ids only.
    const footnotesXml = await zip.file("word/footnotes.xml")!.async("string");
    const footnotesDoc = new DOMParser().parseFromString(footnotesXml, "application/xml");
    const realFootnotes = Array.from(footnotesDoc.getElementsByTagName("w:footnote")).filter(
      (f) => Number(f.getAttribute("w:id")) > 0,
    );
    expect(realFootnotes.length).toBe(2);
  });

  it("never emits two bookmarks with the same numeric w:id, across headings, footnotes, and block refs", async () => {
    // docx's own Bookmark class generates a fresh, always-1 id counter per
    // instance — every bookmark anywhere in the doc independently produced
    // w:id="1" regardless of which feature created it (headings, block
    // refs, footnote NOTEREF targets), which is invalid OOXML the moment
    // more than one bookmark exists and broke Word's bookmark/hyperlink
    // resolution generally, including previously-working links.
    const source = [
      "# First Heading",
      "",
      "See [[#^b1]] and [[#Second Heading]].",
      "",
      "Cited once[^1]. Cited again[^1].",
      "",
      "A block with an id. ^b1",
      "",
      "# Second Heading",
      "",
      "[^1]: The footnote content.",
    ].join("\n");
    const { documentXml, zip } = await renderToDocx(source);
    const doc = new DOMParser().parseFromString(documentXml, "application/xml");
    const footnotesXml = await zip.file("word/footnotes.xml")!.async("string");
    const footnotesDoc = new DOMParser().parseFromString(footnotesXml, "application/xml");

    // Bookmark ids must be unique across the WHOLE document — including
    // across parts, since the footnote reference bookmark now lives in
    // footnotes.xml (see the test above) while heading/block-ref bookmarks
    // live in document.xml.
    const bookmarkStarts = [
      ...Array.from(doc.getElementsByTagName("w:bookmarkStart")),
      ...Array.from(footnotesDoc.getElementsByTagName("w:bookmarkStart")),
    ];
    // Sanity: this fixture actually exercises multiple bookmark-creating
    // features (2 headings + 1 block ref + 1 footnote ref), not just one.
    expect(bookmarkStarts.length).toBeGreaterThanOrEqual(4);

    const ids = bookmarkStarts.map((b) => b.getAttribute("w:id"));
    expect(new Set(ids).size).toBe(ids.length); // every id is unique document-wide
  });
});
