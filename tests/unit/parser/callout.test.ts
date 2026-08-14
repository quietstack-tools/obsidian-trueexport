import { describe, it, expect } from "vitest";
import { parse } from "../../helpers/parse";
import { matchCalloutHeader } from "../../../src/core/parser/callout";
import type { CalloutNode } from "../../../src/core/model/nodes";

function firstCallout(src: string): CalloutNode {
  const { blocks } = parse(src);
  const callout = blocks.find((b) => b.type === "callout");
  if (!callout || callout.type !== "callout") throw new Error("no callout parsed");
  return callout;
}

describe("matchCalloutHeader", () => {
  it("parses type, modifier and title", () => {
    expect(matchCalloutHeader("[!WARNING]- Heads up")).toEqual({
      calloutType: "warning",
      title: "Heads up",
      foldable: true,
      defaultFolded: true,
    });
  });

  it("returns null for a plain blockquote line (failing case)", () => {
    expect(matchCalloutHeader("just a quote")).toBeNull();
  });
});

describe("callouts", () => {
  it("lowercases the type and title-cases a missing title", () => {
    const callout = firstCallout("> [!Note]\n> body");
    expect(callout.calloutType).toBe("note");
    expect(callout.title).toEqual([{ type: "text", value: "Note" }]);
  });

  it("captures fold modifiers", () => {
    expect(firstCallout("> [!tip]+ T\n> b")).toMatchObject({ foldable: true, defaultFolded: false });
    expect(firstCallout("> [!tip]- T\n> b")).toMatchObject({ foldable: true, defaultFolded: true });
    expect(firstCallout("> [!tip] T\n> b")).toMatchObject({ foldable: false, defaultFolded: false });
  });

  it("supports block content and nested callouts in the body", () => {
    const callout = firstCallout("> [!info] Outer\n> - item\n>\n> > [!warning] Inner\n> > text");
    expect(callout.children.some((c) => c.type === "list")).toBe(true);
    expect(callout.children.some((c) => c.type === "callout")).toBe(true);
  });

  it("accepts an unknown type without error", () => {
    const callout = firstCallout("> [!totally-made-up] X\n> y");
    expect(callout.calloutType).toBe("totally-made-up");
  });
});
