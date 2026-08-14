import { describe, it, expect } from "vitest";
import { resolve } from "../../helpers/resolve";
import type { BlockNode } from "../../../src/core/model/nodes";

/** Collect all rendered text in a block tree, for content assertions. */
function allText(blocks: BlockNode[]): string {
  let out = "";
  const walkInline = (nodes: { type: string; value?: string; children?: unknown[] }[]): void => {
    for (const n of nodes) {
      if (typeof n.value === "string") out += n.value + " ";
      if (Array.isArray(n.children)) walkInline(n.children as never);
    }
  };
  const walk = (bs: BlockNode[]): void => {
    for (const b of bs) {
      if ("children" in b && Array.isArray(b.children)) {
        if (b.type === "paragraph" || b.type === "heading") walkInline(b.children as never);
        else walk(b.children as BlockNode[]);
      }
      if (b.type === "list") b.children.forEach((it) => walk(it.children));
      if (b.type === "unsupported") out += `[${b.reason}] `;
    }
  };
  walk(blocks);
  return out;
}

function unsupportedReasons(blocks: BlockNode[]): string[] {
  const out: string[] = [];
  const walk = (bs: BlockNode[]): void => {
    for (const b of bs) {
      if (b.type === "unsupported") out.push(b.reason);
      if ("children" in b && Array.isArray(b.children)) walk(b.children as BlockNode[]);
      if (b.type === "list") b.children.forEach((it) => walk(it.children));
    }
  };
  walk(blocks);
  return out;
}

describe("transclusion — basic splicing", () => {
  it("splices a whole note's blocks in place", async () => {
    const { doc } = await resolve("Before\n\n![[Other]]\n\nAfter", {
      sourcePath: "Main.md",
      notes: { "Main.md": "", "Other.md": "# Heading\n\nOther body." },
    });
    const text = allText(doc.blocks);
    expect(text).toContain("Before");
    expect(text).toContain("Heading");
    expect(text).toContain("Other body.");
    expect(text).toContain("After");
  });

  it("includes only a heading section up to the next same-or-higher heading", async () => {
    const target = "# One\n\nfirst\n\n## Two\n\nsecond\n\n# Three\n\nthird";
    const { doc } = await resolve("![[T#Two]]", {
      sourcePath: "M.md",
      notes: { "M.md": "", "T.md": target },
    });
    const text = allText(doc.blocks);
    expect(text).toContain("Two");
    expect(text).toContain("second");
    expect(text).not.toContain("third");
    expect(text).not.toContain("first");
  });

  it("includes only the block carrying a referenced id", async () => {
    const target = "intro para\n\ntarget para ^keep\n\nafter para";
    const { doc } = await resolve("![[T#^keep]]", {
      sourcePath: "M.md",
      notes: { "M.md": "", "T.md": target },
    });
    const text = allText(doc.blocks);
    expect(text).toContain("target para");
    expect(text).not.toContain("intro para");
    expect(text).not.toContain("after para");
  });

  it("discards the transcluded note's frontmatter", async () => {
    const target = "---\ntitle: Secret\nsecret: 42\n---\n\nvisible body";
    const { doc } = await resolve("![[T]]", {
      sourcePath: "M.md",
      notes: { "M.md": "", "T.md": target },
    });
    const text = allText(doc.blocks);
    expect(text).toContain("visible body");
    expect(text).not.toContain("Secret");
    expect(text).not.toContain("42");
  });

  it("treats an inline (mid-text) embed as a link, not a splice", async () => {
    const { doc } = await resolve("see ![[Other]] here", {
      sourcePath: "M.md",
      notes: { "M.md": "", "Other.md": "body" },
      included: ["M.md", "Other.md"],
    });
    const para = doc.blocks[0];
    if (para.type !== "paragraph") throw new Error("expected paragraph");
    expect(para.children.some((c) => c.type === "link")).toBe(true);
    // Not spliced: the body of Other is not present.
    expect(allText(doc.blocks)).not.toContain("body");
  });

  it("warns when a transcluded heading is not found", async () => {
    const { warnings } = await resolve("![[T#Missing]]", {
      sourcePath: "M.md",
      notes: { "M.md": "", "T.md": "# Present\n\nx" },
    });
    expect(warnings.some((w) => w.construct === "transclusion" && /not found/.test(w.message))).toBe(true);
  });
});

describe("transclusion — mandatory cycle detection", () => {
  // These tests completing at all is the proof of termination: a hang would
  // trip vitest's timeout and fail the suite.
  it("terminates on a self-referencing note and reports a cycle", async () => {
    const { doc, warnings } = await resolve("![[A]]", {
      sourcePath: "A.md",
      notes: { "A.md": "![[A]]" },
    });
    expect(unsupportedReasons(doc.blocks).some((r) => /Circular transclusion/.test(r))).toBe(true);
    expect(warnings.some((w) => w.construct === "transclusion")).toBe(true);
  });

  it("terminates on a mutual A → B → A cycle", async () => {
    const { doc } = await resolve("![[B]]", {
      sourcePath: "A.md",
      notes: { "A.md": "![[B]]", "B.md": "![[A]]" },
    });
    const reasons = unsupportedReasons(doc.blocks);
    expect(reasons.some((r) => /Circular transclusion/.test(r))).toBe(true);
    expect(reasons.some((r) => /A → B → A/.test(r))).toBe(true);
  });
});

describe("transclusion — depth limit", () => {
  it("stops after 5 levels and emits an unsupported node", async () => {
    // L0 (source) → L1 → L2 → L3 → L4 → L5 → L6. With a limit of 5, L6 is blocked.
    const notes: Record<string, string> = {};
    for (let i = 1; i <= 5; i++) notes[`L${i}.md`] = `Level ${i}\n\n![[L${i + 1}]]`;
    notes["L6.md"] = "DEEPEST";

    const { doc } = await resolve("![[L1]]", { sourcePath: "L0.md", notes });
    const text = allText(doc.blocks);

    expect(text).toContain("Level 1");
    expect(text).toContain("Level 5");
    expect(text).not.toContain("DEEPEST");
    expect(unsupportedReasons(doc.blocks).some((r) => /exceeded 5 levels/.test(r))).toBe(true);
  });
});
