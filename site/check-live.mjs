// site/check-live.mjs — guard against drift between each source document and its
// live hosted page.
//
// site/public/ is gitignored and deploys are manual, so the repository copy of a
// published document and the copy hosted at quietstack.tools can silently
// diverge with nothing failing. That is the same class of risk verify-license.py
// addresses one layer in: verify-license.py protects the licence text; this
// protects the documents the licence and the terms point at (the commitment, the
// Pro terms, the privacy policy).
//
// It: (1) rebuilds every page from its source, (2) fetches each live page,
// (3) reduces both to visible text, and (4) fails on any difference — strictly.
//
// Exit 0 = all in sync, 1 = drift, 2 = could not check (network/build). No deps.
//
//     node site/check-live.mjs

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PAGES } from "./pages.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "public");

function fail(msg, code) {
  console.error(`\n  FAIL  ${msg}\n`);
  process.exit(code);
}

// Reduce an HTML page to comparable visible text: take the <main>, drop tags,
// decode the entities we emit, and collapse whitespace. The comparison is
// strict — every visible character of each document must match, contact
// addresses included. (Cloudflare's Email Address Obfuscation is disabled on the
// zone so the served HTML is faithful and needs no tolerance here.)
function visibleText(html) {
  const m = html.match(/<main[\s\S]*?>([\s\S]*?)<\/main>/i);
  const body = m ? m[1] : html;
  return body
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// 1. Rebuild every page from its source of truth.
try {
  execSync("node site/build.mjs", { stdio: "inherit" });
} catch (e) {
  fail(`Could not rebuild pages from source: ${e.message}`, 2);
}

let drift = false;

for (const p of PAGES) {
  let local;
  try {
    local = visibleText(readFileSync(join(publicDir, p.out), "utf-8"));
  } catch (e) {
    fail(`Could not read the freshly built page ${p.out}: ${e.message}`, 2);
  }

  let live;
  try {
    const res = await fetch(p.url, { redirect: "follow" });
    if (!res.ok) fail(`Live page returned HTTP ${res.status} for ${p.url}`, 2);
    live = visibleText(await res.text());
  } catch (e) {
    fail(`Could not fetch the live page ${p.url}: ${e.message}\n` +
         "        Check network access, then re-run.", 2);
  }

  if (local === live) {
    console.log(`  PASS  ${p.url}\n        matches ${p.source} (${local.length} visible chars)`);
    continue;
  }

  drift = true;
  const a = local.split(" ");
  const b = live.split(" ");
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  const ctx = (arr) => arr.slice(Math.max(0, k - 5), k + 5).join(" ");
  console.error(`\n  FAIL  ${p.url} has drifted from ${p.source}.`);
  console.error(`        First difference near word ${k}:`);
  console.error(`          repo : ...${ctx(a)}...`);
  console.error(`          live : ...${ctx(b)}...`);
}

if (drift) {
  console.error("\n  Redeploy the site (npm run deploy:site) so the hosted copies match\n" +
                "  the repository copies.\n");
  process.exit(1);
}
console.log("\n  PASS  All published pages match their source documents.\n");
process.exit(0);
