import { describe, it, expect } from "vitest";
import { resolve } from "../../helpers/resolve";
import type { InlineNode, LinkNode, ParagraphNode } from "../../../src/core/model/nodes";

async function inlinesOf(source: string, opts = {}): Promise<InlineNode[]> {
  const { doc } = await resolve(source, opts);
  const para = doc.blocks[0] as ParagraphNode;
  return para.children;
}

const VAULT = {
  sourcePath: "Note.md",
  notes: { "Note.md": "", "Target.md": "x", "Elsewhere.md": "y" },
  included: ["Note.md", "Target.md"],
};

describe("wikilink resolution", () => {
  it("emits a working internal link when the target is in the export", async () => {
    const [, link] = await inlinesOf("go [[Target]] now", VAULT);
    expect(link).toMatchObject({
      type: "link",
      target: { kind: "internal", notePath: "Target.md", resolved: true },
    });
  });

  it("uses the alias as display text", async () => {
    const [, link] = await inlinesOf("go [[Target|Click here]] now", VAULT);
    expect((link as LinkNode).children).toEqual([{ type: "text", value: "Click here" }]);
  });

  it("degrades to plain text when the target is outside the export", async () => {
    const nodes = await inlinesOf("go [[Elsewhere]] now", VAULT);
    expect(nodes.every((n) => n.type !== "link")).toBe(true);
    expect(nodes.map((n) => (n.type === "text" ? n.value : "")).join("")).toContain("Elsewhere");
  });

  it("degrades to plain text and warns when unresolvable", async () => {
    const { doc, warnings } = await resolve("go [[Ghost]] now", VAULT);
    const para = doc.blocks[0] as ParagraphNode;
    expect(para.children.every((n) => n.type !== "link")).toBe(true);
    expect(warnings.some((w) => w.construct === "wikilink")).toBe(true);
  });

  it("resolves a same-note heading link to an anchor", async () => {
    const [, link] = await inlinesOf("see [[#My Section]] above", VAULT);
    expect((link as LinkNode).target).toEqual({ kind: "anchor", id: "my-section" });
  });

  it("carries heading and block subpaths on an in-export internal link", async () => {
    const [, headingLink] = await inlinesOf("a [[Target#Intro]] b", VAULT);
    expect((headingLink as LinkNode).target).toMatchObject({ heading: "Intro", resolved: true });
    const [, blockLink] = await inlinesOf("a [[Target#^xyz]] b", VAULT);
    expect((blockLink as LinkNode).target).toMatchObject({ blockId: "xyz", resolved: true });
  });

  it("never leaves raw [[ in the resolved text", async () => {
    const nodes = await inlinesOf("many [[Target]] [[Ghost]] [[#Here]] links", VAULT);
    const text = nodes.map((n) => (n.type === "text" ? n.value : "")).join("");
    expect(text.includes("[[")).toBe(false);
  });
});
