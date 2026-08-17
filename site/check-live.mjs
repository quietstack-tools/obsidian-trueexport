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
  // The site footer is added to every page OUTSIDE <main>. Exclude it explicitly
  // so it can never enter the comparison. This is a targeted exclusion of the
  // footer only — it does not loosen the strict comparison of the document body.
  html = html.replace(/<footer[\s\S]*?<\/footer>/gi, " ");
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
                "  the repository copies.");
} else {
  console.log("\n  PASS  All published pages match their source documents.");
}

// --- URL status guard ------------------------------------------------------
// Until a 404.html existed, every path returned 200 (the index.html fallback),
// so a status check could never fail. The known-bad assertion below is what
// makes these meaningful: it breaks if the SPA-style fallback is re-enabled.
const OK_URLS = [
  "https://quietstack.tools/",
  "https://quietstack.tools/trueexport",
  "https://quietstack.tools/trueexport/commitments",
  "https://quietstack.tools/trueexport/terms",
  "https://quietstack.tools/privacy",
];
const BAD_URL = "https://quietstack.tools/__not-a-real-page-check-live__";

async function statusOf(url) {
  try {
    // redirect: "manual" so a real page that only 200s via a 3xx would fail the
    // "bare 200" expectation rather than being silently followed.
    return (await fetch(url, { redirect: "manual" })).status;
  } catch (e) {
    fail(`Could not fetch ${url}: ${e.message}`, 2);
  }
}

console.log("\n  URL status guard:");
let statusFail = false;
for (const url of OK_URLS) {
  const s = await statusOf(url);
  if (s === 200) console.log(`    OK  200  ${url}`);
  else { statusFail = true; console.error(`    FAIL     ${url} returned ${s}, expected 200`); }
}
const bad = await statusOf(BAD_URL);
if (bad === 404) console.log(`    OK  404  ${BAD_URL}`);
else {
  statusFail = true;
  console.error(`    FAIL     ${BAD_URL} returned ${bad}, expected 404`);
  console.error("             (200 here means the not-found fallback is serving index.html —");
  console.error("              real 404s are off, so every URL status check is meaningless.)");
}

if (drift || statusFail) {
  console.error("");
  process.exit(1);
}
console.log("\n  PASS  Pages match their sources; all URLs return the expected status.\n");
process.exit(0);
