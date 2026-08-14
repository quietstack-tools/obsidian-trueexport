import { describe, it, expect } from "vitest";
import { parse } from "../../helpers/parse";
import { extractFrontmatter, parseYaml } from "../../../src/core/parser/frontmatter";

describe("parseYaml", () => {
  it("parses scalars, arrays, sequences and nested maps", () => {
    const { data, ok } = parseYaml([
      "title: Hello",
      "count: 3",
      "draft: true",
      "tags: [a, b]",
      "list:",
      "  - one",
      "  - two",
      "meta:",
      "  author: Jane",
    ]);
    expect(ok).toBe(true);
    expect(data).toEqual({
      title: "Hello",
      count: 3,
      draft: true,
      tags: ["a", "b"],
      list: ["one", "two"],
      meta: { author: "Jane" },
    });
  });

  it("reports ok=false on a malformed line but does not throw", () => {
    const { data, ok } = parseYaml(["title: Fine", "this line has no colon"]);
    expect(ok).toBe(false);
    expect(data.title).toBe("Fine");
  });
});

describe("extractFrontmatter", () => {
  it("returns present=false when there is no closing fence (failing case)", () => {
    const result = extractFrontmatter(["---", "title: x", "no close"]);
    expect(result.present).toBe(false);
    expect(result.body).toHaveLength(3);
  });

  it("strips the frontmatter block from the body", () => {
    const result = extractFrontmatter(["---", "a: 1", "---", "body"]);
    expect(result.present).toBe(true);
    expect(result.body).toEqual(["body"]);
    expect(result.consumedLines).toBe(3);
  });
});

describe("parseMarkdown frontmatter integration", () => {
  it("extracts frontmatter and keeps it out of the body", () => {
    const { frontmatter, blocks, title } = parse("---\ntitle: My Note\n---\n\nBody");
    expect(title).toBe("My Note");
    expect(frontmatter.title).toBe("My Note");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
  });

  it("warns but does not throw on malformed frontmatter", () => {
    const { warningList } = parse("---\nbroken line\n---\n\nBody");
    expect(warningList.some((w) => w.construct === "frontmatter")).toBe(true);
  });

  it("falls back to the filename when no title is given", () => {
    const { title } = parse("Body only", "folder/Meeting Notes.md");
    expect(title).toBe("Meeting Notes");
  });
});
