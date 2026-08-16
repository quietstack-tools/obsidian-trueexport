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

// Match real call sites — `fetch(` / `requestUrl(` with no space — so prose in
// comments (e.g. "the remote-image fetch (§7.6)") doesn't trip the guard.
const NETWORK_CALL = /(?<![\w.])fetch\(|new\s+XMLHttpRequest|(?<![\w.])requestUrl\(/;

// The ONLY two documented network calls (TECH_SPEC R6/§7.6):
//   1. licence validation (fetch)        — src/licence/polar.ts
//   2. opt-in remote-image fetch (fetch, redirect-validated) — src/obsidian-adapter.ts
const ALLOWED_NETWORK_SITES = ["src/licence/polar.ts", "src/obsidian-adapter.ts"];

describe("network-call compliance (§7.6, R6)", () => {
  it("only the two documented sites perform a network call", () => {
    const root = join(process.cwd(), "src");
    const offenders = walk(root)
      .filter((file) => NETWORK_CALL.test(readFileSync(file, "utf8")))
      .map((file) => relative(process.cwd(), file))
      .sort();
    expect(offenders).toEqual(ALLOWED_NETWORK_SITES);
  });
});
