import { describe, it, expect } from "vitest";
import { parseInline, parseImageSize, toPlainText } from "../../../src/core/parser/inline";
import type { InlineNode } from "../../../src/core/model/nodes";

function types(nodes: InlineNode[]): string[] {
  return nodes.map((n) => n.type);
}

describe("parseInline emphasis", () => {
  it("parses italic, bold and strikethrough", () => {
    expect(parseInline("*i*")).toEqual([
      { type: "emphasis", children: [{ type: "text", value: "i" }] },
    ]);
    expect(parseInline("**b**")).toEqual([
      { type: "strong", children: [{ type: "text", value: "b" }] },
    ]);
    expect(parseInline("~~s~~")).toEqual([
      { type: "strikethrough", children: [{ type: "text", value: "s" }] },
    ]);
  });

  it("nests emphasis inside strong", () => {
    const [node] = parseInline("**a *b* c**");
    expect(node).toMatchObject({
      type: "strong",
      children: [
        { type: "text", value: "a " },
        { type: "emphasis", children: [{ type: "text", value: "b" }] },
        { type: "text", value: " c" },
      ],
    });
  });

  it("does not emphasize intraword underscores (failing case)", () => {
    expect(parseInline("snake_case_word")).toEqual([
      { type: "text", value: "snake_case_word" },
    ]);
  });

  it("leaves an unterminated delimiter literal (failing case)", () => {
    expect(parseInline("**not bold")).toEqual([
      { type: "text", value: "**not bold" },
    ]);
  });
});

describe("parseInline escapes and code", () => {
  it("treats a backslash-escaped asterisk as literal text", () => {
    expect(parseInline("a \\* b")).toEqual([{ type: "text", value: "a * b" }]);
  });

  it("parses inline code and ignores emphasis inside it", () => {
    expect(parseInline("`a*b*c`")).toEqual([{ type: "inlineCode", value: "a*b*c" }]);
  });

  it("strips a single surrounding space from a code span", () => {
    expect(parseInline("` a `")).toEqual([{ type: "inlineCode", value: "a" }]);
  });
});

describe("parseInline links and images", () => {
  it("parses an inline link, dropping the title", () => {
    expect(parseInline('[t](https://x.dev "title")')).toEqual([
      {
        type: "link",
        target: { kind: "external", url: "https://x.dev" },
        children: [{ type: "text", value: "t" }],
      },
    ]);
  });

  it("parses an autolink and an email autolink", () => {
    const [link, , mail] = parseInline("<https://x.dev> and <a@b.com>");
    expect(link).toMatchObject({ target: { kind: "external", url: "https://x.dev" } });
    expect(mail).toMatchObject({ target: { kind: "external", url: "mailto:a@b.com" } });
  });

  it("parses an inline image with a size hint", () => {
    expect(parseInline("![cap|300](p.png)")).toEqual([
      {
        type: "inlineImage",
        resource: { kind: "missing", originalPath: "p.png" },
        alt: "cap",
        width: 300,
      },
    ]);
  });

  it("does not treat a lone bracket as a link (failing case)", () => {
    expect(types(parseInline("[not a link"))).toEqual(["text"]);
  });
});

describe("parseImageSize", () => {
  it("reads width and height from a hint", () => {
    expect(parseImageSize("a|300x200")).toEqual({ alt: "a", width: 300, height: 200 });
  });
  it("treats a bare number alt as a width", () => {
    expect(parseImageSize("300")).toEqual({ alt: "", width: 300 });
  });
  it("leaves a non-numeric hint alone", () => {
    expect(parseImageSize("caption")).toEqual({ alt: "caption" });
  });
});

describe("toPlainText", () => {
  it("flattens nested inline nodes", () => {
    const nodes = parseInline("a **b `c`** d");
    expect(toPlainText(nodes)).toBe("a b c d");
  });
});
