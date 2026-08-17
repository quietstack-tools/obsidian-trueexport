// site/build.mjs — generate the published site pages FROM their source markdown.
//
// A hosted legal/policy page must never be a hand-typed copy of its source. If
// the hosted copy and the repo copy diverge, there are two different versions of
// a document in circulation and no way to say which governs. So each page is
// derived from a single source of truth: the markdown files at the repository
// root listed in site/pages.mjs. Run before deploying:
//
//     node site/build.mjs
//
// It is a faithful renderer, not a reformatter: headings, clause numbers, the
// &nbsp;-indented sub-clauses, lists, blockquotes (e.g. the regulation-90 ACL
// wording in the Pro Terms, reproduced exactly including "Our"), links, inline
// emphasis/code, and version-history tables are reproduced as-is. No text is
// reworded, summarised, or "improved".
//
// No dependencies, no framework — plain Node + string handling.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PAGES } from "./pages.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const publicDir = join(here, "public");

// ---- inline rendering -----------------------------------------------------

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Render inline markdown: [text](url) links, `code`, **strong**, *em*, while
// preserving the one intentional HTML entity used in the sources (&nbsp;) and
// escaping everything else (including a literal `<meta>` inside a code span).
function renderInline(text) {
  const links = [];
  const codes = [];
  // 1. Links first — capture before emphasis/escape can touch the URL.
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => {
    links.push('<a href="' + escapeHtml(u) + '">' + escapeHtml(t) + "</a>");
    return " L" + (links.length - 1) + " ";
  });
  // 2. Code spans — contents never touched by emphasis, and HTML-escaped.
  text = text.replace(/`([^`]+)`/g, (_m, c) => {
    codes.push("<code>" + escapeHtml(c) + "</code>");
    return " C" + (codes.length - 1) + " ";
  });
  // 3. Protect the deliberate &nbsp; entity, then escape the rest of the text.
  text = text.replace(/&nbsp;/g, " NB ");
  text = escapeHtml(text);
  text = text.replace(/ NB /g, "&nbsp;");
  // 4. Emphasis: bold before italic. (No nested/triple emphasis in the sources.)
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  // 5. Restore code spans, then links.
  text = text.replace(/ C(\d+) /g, (_m, i) => codes[Number(i)]);
  text = text.replace(/ L(\d+) /g, (_m, i) => links[Number(i)]);
  return text;
}

// ---- block classification -------------------------------------------------

const reHeading = /^(#{1,6})\s+(.*)$/;
const reOrdered = /^\d+\.\s+/;
const reUnordered = /^-\s+/;
const reBlockquote = /^>\s?/;

function isHr(line) {
  return line.trim() === "---";
}
function isTableRow(line) {
  return line.trimStart().startsWith("|");
}
function isTableSep(line) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");
}
function isBlockStart(line) {
  return (
    reHeading.test(line) ||
    isHr(line) ||
    reOrdered.test(line) ||
    reUnordered.test(line) ||
    reBlockquote.test(line) ||
    isTableRow(line)
  );
}

function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

// ---- block rendering ------------------------------------------------------

function renderMarkdown(md) {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  const n = lines.length;

  while (i < n) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Heading
    const h = line.match(reHeading);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${renderInline(h[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (isHr(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    // Blockquote: consecutive `>`-prefixed lines. Soft-wrapped lines fold into
    // one paragraph. The regulation-90 ACL wording in Pro Terms clause 7 lives
    // here and must survive verbatim (including the prescribed word "Our").
    if (reBlockquote.test(line)) {
      let quote = lines[i].replace(reBlockquote, "");
      i++;
      while (i < n && reBlockquote.test(lines[i])) {
        quote += " " + lines[i].replace(reBlockquote, "").trim();
        i++;
      }
      out.push(`<blockquote><p>${renderInline(quote.trim())}</p></blockquote>`);
      continue;
    }

    // Table: header row + separator row + body rows
    if (isTableRow(line) && i + 1 < n && isTableSep(lines[i + 1])) {
      const header = splitTableRow(line);
      i += 2; // consume header + separator
      const rows = [];
      while (i < n && isTableRow(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      let t = "<table>\n<thead><tr>";
      for (const c of header) t += `<th>${renderInline(c)}</th>`;
      t += "</tr></thead>\n<tbody>";
      for (const r of rows) {
        t += "<tr>";
        for (const c of r) t += `<td>${renderInline(c)}</td>`;
        t += "</tr>";
      }
      t += "</tbody>\n</table>";
      out.push(t);
      continue;
    }

    // Ordered / unordered list. Item continuation lines are indented soft-wraps
    // in the source; fold them into the item text.
    if (reOrdered.test(line) || reUnordered.test(line)) {
      const ordered = reOrdered.test(line);
      const startRe = ordered ? reOrdered : reUnordered;
      const items = [];
      while (i < n && startRe.test(lines[i])) {
        let item = lines[i].replace(startRe, "");
        i++;
        while (i < n && lines[i].trim() !== "" && !isBlockStart(lines[i])) {
          item += " " + lines[i].trim();
          i++;
        }
        items.push(item);
      }
      const tag = ordered ? "ol" : "ul";
      let list = `<${tag}>\n`;
      for (const it of items) list += `  <li>${renderInline(it)}</li>\n`;
      list += `</${tag}>`;
      out.push(list);
      continue;
    }

    // Paragraph: gather soft-wrapped lines until a blank line or a new block.
    // Leading &nbsp; sub-clauses ((a),(b),...) are ordinary paragraphs whose
    // indentation is carried by the &nbsp; entities and preserved verbatim.
    let para = line;
    i++;
    while (i < n && lines[i].trim() !== "" && !isBlockStart(lines[i])) {
      para += " " + lines[i].trim();
      i++;
    }
    out.push(`<p>${renderInline(para.trim())}</p>`);
  }

  return out.join("\n");
}

// ---- page template --------------------------------------------------------

// The site footer. This build script adds it to EVERY page, and places it
// OUTSIDE <main> (the rendered document content), so on the generated legal and
// policy pages it can never be mistaken for part of the document text. Defined
// once here so every page carries exactly one, identical footer.
const FOOTER = `  <footer>
    <p>Kesavan Paripurapavan · ABN 94 867 243 153</p>
    <p class="footer-links"><a href="https://github.com/quietstack-tools/obsidian-trueexport/blob/main/LICENSE">Licence</a> · <a href="/trueexport/commitments">Commitments</a> · <a href="/trueexport/terms">Terms</a> · <a href="/privacy">Privacy</a></p>
  </footer>`;

function shell(title, mainHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main>
${mainHtml}
  </main>
${FOOTER}
</body>
</html>
`;
}

function provenance(sourceName) {
  return (
    '<div class="provenance">The canonical source of this document is ' +
    `<code>${escapeHtml(sourceName)}</code> in the TrueExport repository. This ` +
    "page is generated from that file, not maintained by hand — if the two ever " +
    "differ, the repository file governs.</div>"
  );
}

// A generated document page (commitments / terms / privacy): provenance note
// then the rendered markdown, all inside <main>.
function documentPage(title, sourceName, bodyHtml) {
  return shell(title, `${provenance(sourceName)}\n${bodyHtml}`);
}

// The home page. Not from markdown: a short intro plus routes into the three
// published documents. The commitments page is the main trust argument and must
// be reachable from the body here, not only via the footer.
function homePage() {
  const body = `<h1>QuietStack</h1>
    <p class="home-lede">
      TrueExport is an Obsidian plugin that exports your notes to Word, PDF and
      HTML that open correctly everywhere — wikilinks, embeds, callouts, tables
      and footnotes intact.
    </p>
    <div class="home-links">
      <p><a href="/trueexport/commitments">TrueExport Free Feature Commitment</a> — what stays free, permanently.</p>
      <p><a href="/trueexport/terms">TrueExport Pro — Terms of Purchase and Use</a></p>
      <p><a href="/privacy">Privacy Policy</a></p>
    </div>`;
  return shell("QuietStack", body);
}

// The four Pro features, extracted VERBATIM from PRO_TERMS.md clause 3 so the
// landing page's Pro list is derived from the binding terms and can never
// contradict them. Throws if clause 3 can't be found — better a failed build
// than a marketing page that drifts from the terms.
function extractProFeatures(proTermsMd) {
  const lines = proTermsMd.split("\n");
  const start = lines.findIndex((l) => /^#{1,6}\s+3\.\s+Pro Features\s*$/.test(l));
  if (start === -1) throw new Error("PRO_TERMS.md: could not locate clause 3 (Pro Features)");
  const items = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) break; // next heading ends the clause
    const m = lines[i].match(/^-\s+(.*)$/);
    if (m) items.push(m[1].trim());
  }
  if (items.length === 0) throw new Error("PRO_TERMS.md clause 3: no Pro features found");
  return items;
}

// The product landing page at /trueexport (the plugin's PRO_URL target). It
// SUMMARISES and LINKS rather than restating the free/Pro split as authoritative:
// the free tier defers to Schedule 1 in COMMITMENTS.md, and the Pro list is taken
// from PRO_TERMS.md clause 3. It is not itself a source of what is free.
function landingPage(proFeatures) {
  const proList = proFeatures.map((f) => `        <li>${renderInline(f)}</li>`).join("\n");
  const body = `<h1>TrueExport</h1>
    <p class="home-lede">
      TrueExport is an Obsidian plugin that exports your notes to Word (DOCX),
      PDF and HTML that open correctly everywhere — wikilinks, embeds, callouts,
      tables and footnotes intact. No Pandoc, no LaTeX, no command line.
    </p>

    <h2>Free, permanently</h2>
    <p>
      Everything you need for correct output is free, and always will be —
      DOCX, HTML and PDF export, all four built-in templates, export warnings and
      diagnostics, and fully offline operation. Correctness of output is never
      behind a paywall.
    </p>
    <p>
      This is a binding, perpetual commitment, not a marketing line. The full and
      authoritative list is the
      <a href="/trueexport/commitments">TrueExport Free Feature Commitment</a>
      (Schedule 1) — that document, not this page, governs what is free.
    </p>

    <h2>TrueExport Pro — one-time USD $25</h2>
    <p>A one-time purchase (not a subscription) unlocks:</p>
    <ul>
${proList}
    </ul>
    <p>
      Buying Pro is never necessary to get correct output. The full terms are in
      the <a href="/trueexport/terms">Pro Terms of Purchase</a>.
    </p>
    <p><a href="https://polar.sh/quietstack">Get TrueExport Pro on Polar</a></p>

    <h2>More</h2>
    <ul>
      <li><a href="/trueexport/commitments">Free Feature Commitment</a></li>
      <li><a href="/trueexport/terms">Pro Terms of Purchase</a></li>
      <li><a href="/privacy">Privacy Policy</a></li>
      <li><a href="https://github.com/quietstack-tools/obsidian-trueexport/blob/main/LICENSE">Licence — PolyForm Shield 1.0.0</a></li>
      <li><a href="https://github.com/quietstack-tools/obsidian-trueexport">Source on GitHub</a></li>
    </ul>`;
  return shell("TrueExport — Obsidian export to Word, PDF and HTML", body);
}

// ---- build ----------------------------------------------------------------

// The three document pages, each derived from its markdown source of truth.
for (const p of PAGES) {
  const src = join(repoRoot, p.source);
  const md = readFileSync(src, "utf-8");
  const outFile = join(publicDir, p.out);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, documentPage(p.title, p.source, renderMarkdown(md)), "utf-8");
  console.log(`Generated ${outFile} from ${p.source} (${md.length} source bytes).`);
}

// The home page.
const indexFile = join(publicDir, "index.html");
writeFileSync(indexFile, homePage(), "utf-8");
console.log(`Generated ${indexFile} (home page).`);

// The product landing page at /trueexport (flat file → bare 200 at the no-slash
// URL). Its Pro list is derived from PRO_TERMS.md clause 3.
const proTermsMd = readFileSync(join(repoRoot, "PRO_TERMS.md"), "utf-8");
const landingFile = join(publicDir, "trueexport.html");
writeFileSync(landingFile, landingPage(extractProFeatures(proTermsMd)), "utf-8");
console.log(`Generated ${landingFile} (product landing page).`);
