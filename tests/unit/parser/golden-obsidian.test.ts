import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { resolve } from "../../helpers/resolve";
import type { ResolveOptions } from "../../helpers/resolve";

// Golden-file regression for Obsidian syntax. Each fixture is parsed AND
// resolved (callouts/footnotes/highlights need no vault; wikilinks needs one).
// Regenerate with: UPDATE_GOLDEN=1 npm test
const ROOT = resolvePath(__dirname, "../../..");

const CASES: Record<string, ResolveOptions> = {
  callouts: {},
  footnotes: {},
  highlights: {},
  wikilinks: {
    sourcePath: "wikilinks.md",
    notes: {
      "wikilinks.md": "", // content is loaded from the fixture, not here
      "Target.md": "# Section\n\nSome text. ^abc\n",
      "Elsewhere.md": "outside the export",
    },
    included: ["wikilinks.md", "Target.md"],
  },
};

async function serialize(name: string): Promise<unknown> {
  const source = readFileSync(resolvePath(ROOT, `tests/fixtures/${name}.md`), "utf8");
  const { doc, warnings } = await resolve(source, CASES[name]);
  return {
    title: doc.title,
    blocks: doc.blocks,
    footnotes: [...doc.footnotes.entries()],
    warnings,
  };
}

describe("golden Obsidian fixtures", () => {
  for (const name of Object.keys(CASES)) {
    it(`${name}.md resolves to its golden IDM`, async () => {
      const actual = await serialize(name);
      const goldenPath = resolvePath(ROOT, `tests/golden/${name}.idm.json`);
      const json = JSON.stringify(actual, null, 2);

      if (process.env.UPDATE_GOLDEN || !existsSync(goldenPath)) {
        writeFileSync(goldenPath, json + "\n");
      }

      const expected = JSON.parse(readFileSync(goldenPath, "utf8"));
      expect(actual).toEqual(expected);
    });
  }

  it("never emits raw [[ or ![[ in rendered text of any fixture", async () => {
    // Collect only rendered string leaves (text / code / raw), not IDM
    // structure, so JSON array nesting doesn't cause false positives.
    const collectText = (value: unknown, sink: string[]): void => {
      if (typeof value !== "object" || value === null) return;
      const node = value as Record<string, unknown>;
      for (const key of ["value", "raw", "content"]) {
        if (typeof node[key] === "string") sink.push(node[key] as string);
      }
      for (const v of Object.values(node)) {
        if (Array.isArray(v)) v.forEach((child) => collectText(child, sink));
        else if (typeof v === "object") collectText(v, sink);
      }
    };

    for (const name of Object.keys(CASES)) {
      const { doc } = await resolve(
        readFileSync(resolvePath(ROOT, `tests/fixtures/${name}.md`), "utf8"),
        CASES[name],
      );
      const texts: string[] = [];
      doc.blocks.forEach((b) => collectText(b, texts));
      for (const t of texts) {
        expect(t.includes("[[")).toBe(false);
        expect(t.includes("![[")).toBe(false);
      }
    }
  });
});
