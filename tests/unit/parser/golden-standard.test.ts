import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseMarkdown } from "../../../src/core/parser";
import { defaultExportOptions } from "../../../src/core/options";
import { WarningCollector } from "../../../src/core/warnings";

// Golden-file regression: parse each fixture and compare the IDM to a committed
// JSON snapshot (TECH_SPEC §9). Regenerate after an intentional change with:
//   UPDATE_GOLDEN=1 npm test
const FIXTURES = [
  "headings",
  "paragraphs",
  "emphasis",
  "code",
  "lists",
  "tasks",
  "tables",
  "blockquotes",
  "rules",
  "links",
  "images",
  "frontmatter",
  "unsupported",
];

const ROOT = resolve(__dirname, "../../..");

function serialize(name: string): unknown {
  const source = readFileSync(resolve(ROOT, `tests/fixtures/${name}.md`), "utf8");
  const warnings = new WarningCollector();
  const result = parseMarkdown(source, `${name}.md`, defaultExportOptions(), warnings);
  return {
    title: result.title,
    frontmatter: result.frontmatter,
    blocks: result.blocks,
    footnotes: [...result.footnotes.entries()],
    warnings: warnings.list(),
  };
}

describe("golden standard fixtures", () => {
  for (const name of FIXTURES) {
    it(`${name}.md parses to its golden IDM`, () => {
      const actual = serialize(name);
      const goldenPath = resolve(ROOT, `tests/golden/${name}.idm.json`);
      const json = JSON.stringify(actual, null, 2);

      if (process.env.UPDATE_GOLDEN || !existsSync(goldenPath)) {
        writeFileSync(goldenPath, json + "\n");
      }

      const expected = JSON.parse(readFileSync(goldenPath, "utf8"));
      expect(actual).toEqual(expected);
    });
  }
});
