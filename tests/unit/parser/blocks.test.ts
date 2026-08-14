import { describe, it, expect } from "vitest";
import { parse } from "../../helpers/parse";
import type { BlockNode, HeadingNode } from "../../../src/core/model/nodes";

function typesOf(blocks: BlockNode[]): string[] {
  return blocks.map((b) => b.type);
}

describe("headings", () => {
  it("parses levels 1 through 6 and assigns slugs", () => {
    const { blocks } = parse("# One\n\n###### Six");
    const h1 = blocks[0] as HeadingNode;
    const h6 = blocks[1] as HeadingNode;
    expect(h1).toMatchObject({ type: "heading", level: 1, id: "one" });
    expect(h6).toMatchObject({ type: "heading", level: 6, id: "six" });
  });

  it("treats seven hashes as a paragraph (failing case)", () => {
    const { blocks } = parse("####### too deep");
    expect(blocks[0].type).toBe("paragraph");
  });

  it("requires a space after the hashes (failing case)", () => {
    const { blocks } = parse("#tag not a heading");
    expect(blocks[0].type).toBe("paragraph");
  });

  it("strips an optional closing hash sequence", () => {
    const { blocks } = parse("## Title ##");
    expect(blocks[0]).toMatchObject({ level: 2 });
    const heading = blocks[0] as HeadingNode;
    expect(heading.children).toEqual([{ type: "text", value: "Title" }]);
  });
});

describe("block grouping", () => {
  it("splits paragraphs on blank lines and records start lines", () => {
    const { blocks } = parse("one\n\ntwo");
    expect(typesOf(blocks)).toEqual(["paragraph", "paragraph"]);
    expect(blocks[0].position).toEqual({ line: 1 });
    expect(blocks[1].position).toEqual({ line: 3 });
  });

  it("recognises thematic breaks written three ways", () => {
    const { blocks } = parse("a\n\n---\n\n***\n\n___");
    expect(typesOf(blocks)).toEqual([
      "paragraph",
      "thematicBreak",
      "thematicBreak",
      "thematicBreak",
    ]);
  });
});

describe("blockquotes", () => {
  it("nests blockquotes and parses inner blocks", () => {
    const { blocks } = parse("> outer\n>\n> > inner");
    expect(blocks[0].type).toBe("blockquote");
    const outer = blocks[0];
    if (outer.type !== "blockquote") throw new Error("expected blockquote");
    expect(outer.children[0].type).toBe("paragraph");
    expect(outer.children[1].type).toBe("blockquote");
  });
});

describe("html blocks", () => {
  it("captures a block-level HTML element as raw", () => {
    const { blocks } = parse("<div>\n<p>hi</p>\n</div>");
    expect(blocks[0]).toMatchObject({ type: "htmlBlock" });
    const html = blocks[0];
    if (html.type !== "htmlBlock") throw new Error("expected htmlBlock");
    expect(html.raw).toContain("<div>");
  });

  it("does not treat an inline tag at line start as an HTML block (failing case)", () => {
    const { blocks } = parse("<em>hi</em> there");
    expect(blocks[0].type).toBe("paragraph");
  });
});
