import { describe, it, expect } from "vitest";
import type {
  BlockNode,
  IdmNode,
  InlineNode,
} from "../../../src/core/model/nodes";
import type { IdmDocument } from "../../../src/core/model/document";

/**
 * A trivial visitor that must handle every union member. If a new node type is
 * added without a case here, `never` in the default branch fails to compile —
 * this is the exhaustiveness guard for the IDM.
 */
function describeNode(node: IdmNode): string {
  switch (node.type) {
    case "heading":
    case "paragraph":
    case "list":
    case "listItem":
    case "table":
    case "codeBlock":
    case "blockquote":
    case "callout":
    case "thematicBreak":
    case "imageBlock":
    case "mathBlock":
    case "htmlBlock":
    case "unsupported":
      return `block:${node.type}`;
    case "text":
    case "emphasis":
    case "strong":
    case "strikethrough":
    case "highlight":
    case "inlineCode":
    case "link":
    case "inlineImage":
    case "mathInline":
    case "footnoteReference":
    case "lineBreak":
    case "subscript":
    case "superscript":
      return `inline:${node.type}`;
    default: {
      const _exhaustive: never = node;
      return _exhaustive;
    }
  }
}

describe("IDM node model", () => {
  it("builds a serialisable document and narrows on type", () => {
    const heading: BlockNode = {
      type: "heading",
      level: 2,
      id: "intro",
      children: [{ type: "text", value: "Intro" }],
      position: { line: 1 },
    };
    const paragraph: BlockNode = {
      type: "paragraph",
      children: [
        { type: "text", value: "See " },
        {
          type: "link",
          target: { kind: "anchor", id: "intro" },
          children: [{ type: "text", value: "above" }],
        },
      ],
      blockId: "para-1",
    };

    const doc: IdmDocument = {
      title: "Sample",
      frontmatter: {},
      blocks: [heading, paragraph],
      footnotes: new Map(),
      warnings: [],
      sourcePath: "Sample.md",
    };

    expect(describeNode(heading)).toBe("block:heading");
    expect(describeNode(paragraph.children[1] as InlineNode)).toBe("inline:link");
    expect(doc.blocks).toHaveLength(2);
    // Serialisable: no methods, no cycles.
    expect(() => JSON.stringify(doc.blocks)).not.toThrow();
  });

  it("carries an assigned number on footnote references (resolver-populated)", () => {
    const ref: InlineNode = {
      type: "footnoteReference",
      identifier: "note-a",
      assignedNumber: 1,
    };
    expect(ref).toMatchObject({ identifier: "note-a", assignedNumber: 1 });
  });
});
