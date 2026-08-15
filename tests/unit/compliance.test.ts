import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const NETWORK_CALL = /(?<![\w.])fetch\s*\(|new\s+XMLHttpRequest|(?<![\w.])requestUrl\s*\(/;

describe("network-call compliance (§7.6, R6)", () => {
  it("only src/licence/polar.ts performs a network call", () => {
    const root = join(process.cwd(), "src");
    const offenders = walk(root)
      .filter((file) => NETWORK_CALL.test(readFileSync(file, "utf8")))
      .map((file) => relative(process.cwd(), file));
    // The licence validation is the only network call in the codebase.
    expect(offenders).toEqual(["src/licence/polar.ts"]);
  });
});
