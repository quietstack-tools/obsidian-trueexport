import { describe, it, expect } from "vitest";
import { parse } from "../../helpers/parse";
import type { ImageBlockNode, ParagraphNode } from "../../../src/core/model/nodes";

describe("images", () => {
  it("promotes a standalone image to a block image", () => {
    const { blocks } = parse("![alt](pic.png)");
    expect(blocks[0]).toMatchObject({
      type: "imageBlock",
      alt: "alt",
      resource: { kind: "missing", originalPath: "pic.png" },
    });
  });

  it("reads width and height from a size hint on a block image", () => {
    const { blocks } = parse("![cap|300x200](pic.png)");
    const img = blocks[0] as ImageBlockNode;
    expect(img.width).toBe(300);
    expect(img.height).toBe(200);
  });

  it("keeps an image inline when surrounded by text", () => {
    const { blocks } = parse("before ![x](i.png) after");
    expect(blocks[0].type).toBe("paragraph");
    const para = blocks[0] as ParagraphNode;
    expect(para.children.map((c) => c.type)).toEqual(["text", "inlineImage", "text"]);
  });
});

describe("links", () => {
  it("parses an external link inside a paragraph", () => {
    const { blocks } = parse("see [here](https://x.dev) now");
    const para = blocks[0] as ParagraphNode;
    expect(para.children[1]).toMatchObject({
      type: "link",
      target: { kind: "external", url: "https://x.dev" },
    });
  });

  it("leaves reference-style syntax as text (failing case / documented gap)", () => {
    const { blocks } = parse("a [ref][1] link");
    const para = blocks[0] as ParagraphNode;
    // Stage 2 supports inline links only; reference links are not resolved.
    expect(para.children.every((c) => c.type !== "link")).toBe(true);
  });
});
