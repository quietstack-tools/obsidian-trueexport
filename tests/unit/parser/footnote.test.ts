import { describe, it, expect } from "vitest";
import { parse } from "../../helpers/parse";
import { resolve } from "../../helpers/resolve";
import {
  matchFootnoteDefinition,
  collectDefinitionBody,
} from "../../../src/core/parser/footnote";
import type { FootnoteReferenceNode, ParagraphNode } from "../../../src/core/model/nodes";

function refs(blocks: ParagraphNode[]): FootnoteReferenceNode[] {
  const out: FootnoteReferenceNode[] = [];
  for (const b of blocks) {
    for (const c of b.children) if (c.type === "footnoteReference") out.push(c);
  }
  return out;
}

describe("footnote definition matching", () => {
  it("matches a definition line", () => {
    expect(matchFootnoteDefinition("[^a]: content")).toEqual({ identifier: "a", first: "content" });
  });
  it("rejects a non-definition (failing case)", () => {
    expect(matchFootnoteDefinition("[^a] reference only")).toBeNull();
  });
  it("collects indented continuation lines", () => {
    const { content, consumed } = collectDefinitionBody(
      ["[^a]: line one", "    line two", "not part"],
      0,
      "line one",
    );
    expect(content).toBe("line one\nline two");
    expect(consumed).toBe(2);
  });
});

describe("parser: footnote collection", () => {
  it("collects definitions into the map and keeps them out of the body", () => {
    const { blocks, footnotes } = parse("Text[^a].\n\n[^a]: The note.");
    expect(footnotes.has("a")).toBe(true);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
  });

  it("turns an inline footnote into a reference plus a generated definition", () => {
    const { blocks, footnotes } = parse("Look^[inline note] here.");
    const ref = refs(blocks as ParagraphNode[])[0];
    expect(ref.identifier).toBe("inline-1");
    expect(footnotes.get("inline-1")).toBeDefined();
  });
});

describe("resolver: footnote numbering", () => {
  it("numbers by order of first reference and reuses numbers", async () => {
    const { doc } = await resolve("A[^x] B[^y] C[^x].\n\n[^x]: one\n[^y]: two");
    const nums = refs(doc.blocks as ParagraphNode[]).map((r) => r.assignedNumber);
    expect(nums).toEqual([1, 2, 1]);
  });

  it("removes a reference with no definition and warns", async () => {
    const { doc, warnings } = await resolve("Dangling[^none] ref.");
    expect(refs(doc.blocks as ParagraphNode[])).toHaveLength(0);
    expect(warnings.some((w) => w.construct === "footnote" && /no definition/.test(w.message))).toBe(true);
  });

  it("omits an unreferenced definition and warns", async () => {
    const { doc, warnings } = await resolve("Body only.\n\n[^ghost]: never used");
    expect(doc.footnotes.has("ghost")).toBe(false);
    expect(warnings.some((w) => w.construct === "footnote" && /never referenced/.test(w.message))).toBe(true);
  });

  it("assigns the same number to the definition as its reference", async () => {
    const { doc } = await resolve("A[^b] first[^a].\n\n[^a]: a\n[^b]: b");
    // [^b] is referenced first → 1, [^a] second → 2.
    expect(doc.footnotes.get("b")?.assignedNumber).toBe(1);
    expect(doc.footnotes.get("a")?.assignedNumber).toBe(2);
  });
});
