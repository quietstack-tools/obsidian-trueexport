import { describe, it, expect } from "vitest";
import { parseInline } from "../../../src/core/parser/inline";
import type { InlineNode } from "../../../src/core/model/nodes";

function types(nodes: InlineNode[]): string[] {
  return nodes.map((n) => n.type);
}

describe("highlights", () => {
  it("parses ==text== into a highlight node", () => {
    expect(parseInline("==hi==")).toEqual([
      { type: "highlight", children: [{ type: "text", value: "hi" }] },
    ]);
  });

  it("allows nested emphasis inside a highlight", () => {
    const [node] = parseInline("==a **b** c==");
    expect(node).toMatchObject({
      type: "highlight",
      children: [
        { type: "text", value: "a " },
        { type: "strong", children: [{ type: "text", value: "b" }] },
        { type: "text", value: " c" },
      ],
    });
  });

  it("leaves a single = as literal text (failing case)", () => {
    expect(parseInline("a = b")).toEqual([{ type: "text", value: "a = b" }]);
  });
});

describe("sub/superscript", () => {
  it("parses <sub> and <sup> tags", () => {
    expect(parseInline("H<sub>2</sub>O")).toEqual([
      { type: "text", value: "H" },
      { type: "subscript", children: [{ type: "text", value: "2" }] },
      { type: "text", value: "O" },
    ]);
    expect(types(parseInline("x<sup>2</sup>"))).toEqual(["text", "superscript"]);
  });

  it("leaves an unclosed tag as text (failing case)", () => {
    expect(types(parseInline("a <sub>b"))).toEqual(["text"]);
  });
});
