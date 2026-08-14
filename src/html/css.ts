// src/html/css.ts
//
// The single inlined stylesheet for exported HTML. No external requests: a
// system font stack, a 45rem centred column, dark-mode via prefers-color-scheme
// and print rules so browser-print produces a decent result (§5.2). Colours and
// spacing are TrueExport's judgment — only the structural rules above are fixed.

/** Callout colours (§4.4); every known type maps onto one of the eight. */
const CALLOUT_COLORS: Record<string, string> = {
  note: "#086DDD",
  tip: "#00BFBC",
  success: "#08B94E",
  question: "#EC7500",
  warning: "#EC7500",
  danger: "#E93147",
  example: "#7852EE",
  quote: "#9E9E9E",
};

const CALLOUT_ALIASES: Record<string, keyof typeof CALLOUT_COLORS> = {
  note: "note", info: "note", todo: "note",
  abstract: "tip", summary: "tip", tldr: "tip", tip: "tip", hint: "tip", important: "tip",
  success: "success", check: "success", done: "success",
  question: "question", help: "question", faq: "question",
  warning: "warning", caution: "warning", attention: "warning",
  failure: "danger", fail: "danger", missing: "danger", danger: "danger", error: "danger", bug: "danger",
  example: "example",
  quote: "quote", cite: "quote",
};

function rgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function calloutRules(): string {
  return Object.entries(CALLOUT_ALIASES)
    .map(([type, key]) => {
      const color = CALLOUT_COLORS[key];
      return `.callout-${type}{--cl:${color};--cl-bg:${rgba(color, 0.1)}}`;
    })
    .join("\n");
}

export function buildCss(): string {
  return `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #ffffff;
  color: #1a1a1a;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.6;
}
article.trueexport { max-width: 45rem; margin: 0 auto; padding: 2.5rem 1.25rem; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 0.5em; font-weight: 600; }
h1 { font-size: 2rem; }
h2 { font-size: 1.6rem; }
h3 { font-size: 1.3rem; }
h4 { font-size: 1.1rem; }
h5 { font-size: 1rem; }
h6 { font-size: 0.9rem; color: #666; }
p { margin: 0 0 1em; }
a { color: #0b66c3; text-decoration: none; }
a:hover { text-decoration: underline; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; background: rgba(0,0,0,0.06); padding: 0.1em 0.3em; border-radius: 3px; }
pre { background: #f5f5f5; padding: 1rem; overflow: auto; border-radius: 6px; }
pre code { background: none; padding: 0; font-size: 0.85em; }
blockquote { margin: 1em 0; padding: 0.2em 1em; border-left: 4px solid #ccc; color: #555; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid #ccc; padding: 0.4em 0.6em; }
th { background: #f5f5f5; }
mark { background: #fff3a3; padding: 0 0.1em; }
hr { border: none; border-top: 1px solid #ccc; margin: 2em 0; }
figure { margin: 1.5em 0; text-align: center; }
figure img { max-width: 100%; height: auto; }
figcaption { font-size: 0.85em; color: #666; margin-top: 0.4em; }
img { max-width: 100%; }
img.inline { vertical-align: middle; }
.img-missing { border: 1px solid #ccc; padding: 0.6em 1em; color: #666; font-style: italic; display: inline-block; }
.callout { border-left: 4px solid var(--cl, #086DDD); background: var(--cl-bg, rgba(8,109,221,0.1)); padding: 0.75em 1em; margin: 1em 0; border-radius: 4px; }
.callout-title { font-weight: 700; margin-bottom: 0.3em; }
.callout > :last-child { margin-bottom: 0; }
${calloutRules()}
li.task { list-style: none; margin-left: -1.25em; }
li.task input { margin-right: 0.4em; }
.unsupported { color: #999; font-style: italic; border: 1px dashed #ccc; padding: 0.4em 0.6em; margin: 1em 0; }
.frontmatter th { text-align: left; width: 30%; }
.footnotes { margin-top: 3em; font-size: 0.9em; color: #444; }
.footnotes hr { margin-bottom: 1em; }
.footnote-ref a, .footnote-back { text-decoration: none; }
@media (prefers-color-scheme: dark) {
  body { background: #1e1e1e; color: #e0e0e0; }
  a { color: #5aa9ff; }
  code { background: rgba(255,255,255,0.1); }
  pre { background: #2a2a2a; }
  blockquote { border-left-color: #555; color: #aaa; }
  th, td { border-color: #444; }
  th { background: #2a2a2a; }
  hr { border-top-color: #444; }
  h6, figcaption, .footnotes { color: #999; }
  mark { background: #5a531f; color: #fff; }
  .img-missing { border-color: #555; color: #999; }
}
@media print {
  body { background: #fff; color: #000; }
  article.trueexport { max-width: none; padding: 0; }
  a { color: #000; }
  pre, blockquote, .callout, figure, table { break-inside: avoid; }
  h1, h2, h3, h4, h5, h6 { break-after: avoid; }
}
`.trim();
}
