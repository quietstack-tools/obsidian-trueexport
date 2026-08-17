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

function provenance(sourceName) {
  return (
    '<div class="provenance">The canonical source of this document is ' +
    `<code>${escapeHtml(sourceName)}</code> in the TrueExport repository. This ` +
    "page is generated from that file, not maintained by hand — if the two ever " +
    "differ, the repository file governs.</div>"
  );
}

function page(title, sourceName, bodyHtml) {
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
${provenance(sourceName)}
${bodyHtml}
  </main>
  <footer>
    Kesavan Paripurapavan · ABN 94 867 243 153
  </footer>
</body>
</html>
`;
}

// ---- build ----------------------------------------------------------------

for (const p of PAGES) {
  const src = join(repoRoot, p.source);
  const md = readFileSync(src, "utf-8");
  const html = page(p.title, p.source, renderMarkdown(md));
  const outFile = join(publicDir, p.out);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, html, "utf-8");
  console.log(`Generated ${outFile} from ${p.source} (${md.length} source bytes).`);
}
