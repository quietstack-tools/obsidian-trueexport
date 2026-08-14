import { describe, it, expect } from "vitest";
import { parse } from "../../helpers/parse";
import type { ListNode } from "../../../src/core/model/nodes";

function firstList(src: string): ListNode {
  const { blocks } = parse(src);
  const list = blocks.find((b) => b.type === "list");
  if (!list || list.type !== "list") throw new Error("no list parsed");
  return list;
}

describe("lists", () => {
  it("parses an ordered list and preserves a non-default start", () => {
    const list = firstList("3. three\n4. four");
    expect(list.ordered).toBe(true);
    expect(list.start).toBe(3);
  });

  it("omits start for lists beginning at 1", () => {
    const list = firstList("1. one\n2. two");
    expect(list.start).toBeUndefined();
  });

  it("nests a sublist under an item", () => {
    const list = firstList("- a\n  - a1\n  - a2");
    const first = list.children[0];
    expect(first.children.map((c) => c.type)).toEqual(["paragraph", "list"]);
  });

  it("marks a list loose when items are blank-separated", () => {
    const tight = firstList("- a\n- b");
    const loose = firstList("- a\n\n- b");
    expect(tight.tight).toBe(true);
    expect(loose.tight).toBe(false);
  });

  it("sets checked from task markers, undefined otherwise", () => {
    const list = firstList("- [ ] a\n- [x] b\n- c");
    expect(list.children[0].checked).toBe(false);
    expect(list.children[1].checked).toBe(true);
    expect(list.children[2].checked).toBeUndefined();
  });

  it("does not fold a following paragraph into the list (failing case)", () => {
    const { blocks } = parse("- a\n\nnot in list");
    expect(blocks.map((b) => b.type)).toEqual(["list", "paragraph"]);
  });
});
