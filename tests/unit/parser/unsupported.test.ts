import { describe, it, expect } from "vitest";
import { parse } from "../../helpers/parse";
import type { UnsupportedNode } from "../../../src/core/model/nodes";

function firstUnsupported(src: string): UnsupportedNode {
  const { blocks } = parse(src);
  const node = blocks.find((b) => b.type === "unsupported");
  if (!node || node.type !== "unsupported") throw new Error("no unsupported node");
  return node;
}

describe("explicitly unsupported constructs", () => {
  it.each([
    ["```dataview\nx\n```", "dataview"],
    ["```dataviewjs\nx\n```", "dataview"],
    ["```base\nx\n```", "bases"],
    ["```tasks\nx\n```", "tasks"],
    ["a <% tp.now() %> b", "templater"],
  ])("detects %s as %s", (src, construct) => {
    const node = firstUnsupported(src);
    expect(node.construct).toBe(construct);
  });

  it("emits a line-numbered warning naming a remedy", () => {
    const { warningList } = parse("intro\n\n```dataview\nq\n```");
    const warning = warningList.find((w) => w.construct === "dataview");
    expect(warning).toBeDefined();
    expect(warning?.line).toBe(3);
    // A remedy, not a bare "not supported".
    expect(warning?.message).toMatch(/exports note content/);
  });

  it("detects Excalidraw via frontmatter and warns", () => {
    const { blocks, warningList } = parse("---\nexcalidraw-plugin: parsed\n---\n\nx");
    expect(blocks[0].type).toBe("unsupported");
    expect((blocks[0] as UnsupportedNode).construct).toBe("excalidraw");
    expect(warningList.some((w) => w.construct === "excalidraw")).toBe(true);
  });

  it("does not flag a normal code block (failing case)", () => {
    const { blocks } = parse("```js\nconst x = 1;\n```");
    expect(blocks.some((b) => b.type === "unsupported")).toBe(false);
  });
});
