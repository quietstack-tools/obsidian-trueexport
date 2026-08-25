import { describe, it, expect } from "vitest";
import { renderToHtml, pngBytes } from "../../helpers/render-html";

describe("HTML content", () => {
  it("maps inline formatting to semantic tags", async () => {
    const { html } = await renderToHtml("**b** *i* ~~s~~ ==h== `c` H<sub>2</sub>O x<sup>2</sup>");
    expect(html).toContain("<strong>b</strong>");
    expect(html).toContain("<em>i</em>");
    expect(html).toContain("<del>s</del>");
    expect(html).toContain("<mark>h</mark>");
    expect(html).toContain("<code>c</code>");
    expect(html).toContain("<sub>2</sub>");
    expect(html).toContain("<sup>2</sup>");
  });

  it("escapes HTML-special characters in text", async () => {
    const { html } = await renderToHtml("a < b & c > d");
    expect(html).toContain("a &lt; b &amp; c &gt; d");
  });

  it("renders an external link with rel=noopener and an internal anchor", async () => {
    const { html } = await renderToHtml("[e](https://x.dev) and [[#Heading]]\n\n# Heading");
    expect(html).toContain('<a href="https://x.dev" rel="noopener noreferrer">e</a>');
    expect(html).toContain('href="#heading"');
  });

  it("renders a callout as an aside with a type class and title", async () => {
    const { html } = await renderToHtml("> [!warning] Careful\n> body");
    expect(html).toContain('<aside class="callout callout-warning">');
    expect(html).toContain('<div class="callout-title">Careful</div>');
  });

  it("renders table alignment via text-align", async () => {
    const { html } = await renderToHtml("| a | b |\n|:--|--:|\n| 1 | 2 |");
    expect(html).toContain('style="text-align:left"');
    expect(html).toContain('style="text-align:right"');
    expect(html).toContain("<thead>");
  });

  it("renders task items with disabled checkboxes", async () => {
    const { html } = await renderToHtml("- [ ] todo\n- [x] done");
    expect(html).toContain('<input type="checkbox" disabled>');
    expect(html).toContain('<input type="checkbox" disabled checked>');
  });

  it("renders an ordered list with a non-default start", async () => {
    const { html } = await renderToHtml("3. three\n4. four");
    expect(html).toContain('<ol start="3">');
  });

  it("renders a code block with no language as plain, escaped, no label", async () => {
    const { html } = await renderToHtml("```\nif (a < b) {}\n```");
    expect(html).toContain("<pre><code>");
    expect(html).toContain("if (a &lt; b) {}");
    expect(html).not.toContain('<div class="code-lang">');
    expect(html).not.toContain("<span class=\"tok-");
  });

  it("falls back to plain, escaped rendering for an unrecognised language, but still shows its label", async () => {
    const { html } = await renderToHtml("```cobol\nDISPLAY 'HI'.\n```");
    expect(html).toContain('<div class="code-lang">cobol</div>');
    expect(html).toContain("DISPLAY 'HI'."); // plain text, no token spans
    expect(html).not.toContain("<span class=\"tok-");
  });

  it("highlights a recognised language into distinct token spans, with a language label", async () => {
    const { html } = await renderToHtml("```js\nconst x = 1; // hi\n```");
    expect(html).toContain('<div class="code-lang">js</div>');
    expect(html).toContain('<span class="tok-keyword">const</span>');
    expect(html).toContain('<span class="tok-comment">// hi</span>');
  });

  it("renders an unsupported construct as a visible marker", async () => {
    const { html } = await renderToHtml("```dataview\nx\n```");
    expect(html).toContain('<div class="unsupported">');
    expect(html).toContain("Dataview queries cannot be exported");
  });

  it("shows a placeholder for a missing image", async () => {
    const { html } = await renderToHtml("![gone](missing.png)");
    expect(html).toContain('class="img-missing"');
    expect(html).toContain("[Image not found: missing.png]");
  });

  it("passes a raw HTML block through", async () => {
    const { html } = await renderToHtml("<div>raw</div>");
    expect(html).toContain("<div>raw</div>");
  });

  it("preserves CJK text in the rendered HTML", async () => {
    const { html } = await renderToHtml("Café 中文 🎉");
    expect(html).toContain("中文");
  });

  it("gives embedded/transcluded content an 'embedded' class distinct from native content", async () => {
    const { html } = await renderToHtml("Native paragraph.\n\n![[Other]]", {
      notes: { "Main.md": "", "Other.md": "# Embedded Heading\n\nEmbedded body." },
    });
    expect(html).toContain('<p dir="auto">Native paragraph.</p>');
    expect(html).toContain('class="embedded" dir="auto">Embedded Heading');
    expect(html).toContain('<p class="embedded" dir="auto">Embedded body.</p>');
  });
});

describe("HTML frontmatter and attribution", () => {
  it("adds the free-tier attribution as a meta tag only, never body", async () => {
    const { html } = await renderToHtml("body");
    expect(html).toContain('<meta name="generator" content="TrueExport — quietstack.tools">');
    const bodyPart = html.slice(html.indexOf("<body>"));
    expect(bodyPart).not.toContain("quietstack.tools");
  });

  it("omits attribution on Pro", async () => {
    const { html } = await renderToHtml("body", {}, { pro: true });
    expect(html).not.toContain("quietstack.tools");
  });

  it("maps frontmatter to meta tags in metadata mode", async () => {
    const { html } = await renderToHtml("---\nauthor: Jane\ntags: [x, y]\n---\n\nbody", {
      options: { frontmatterMode: "metadata" },
    });
    expect(html).toContain('<meta name="author" content="Jane">');
    expect(html).toContain('<meta name="keywords" content="x, y">');
  });

  it("renders frontmatter as a table in table mode", async () => {
    const { html } = await renderToHtml("---\ntitle: T\nauthor: Jane\n---\n\nbody", {
      options: { frontmatterMode: "table" },
    });
    expect(html).toContain('<table class="frontmatter">');
    expect(html).toContain("<th>author</th>");
    expect(html).toContain("<td>Jane</td>");
  });

  it("renders a soft line break (single newline, no blank line) as a visible <br>, not collapsed whitespace", async () => {
    // Obsidian's default (non-strict-line-breaks) editor treats a plain
    // newline within a paragraph as a real line break, same as an explicit
    // hard break — a raw "\n" in HTML source collapses to whitespace when
    // rendered, so consecutive non-blank-line-separated lines need an
    // actual <br> each, same root cause and fix as the DOCX renderer.
    const { html } = await renderToHtml("Plain: one\nAliased: two\nSection: three\nBroken: four");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const p = doc.querySelector("p");
    expect(p).not.toBeNull();
    expect(p!.querySelectorAll("br").length).toBe(3);
    expect(html).toContain("Plain: one<br>");
    expect(html).toContain("Aliased: two<br>");
    expect(html).toContain("Section: three<br>");
    expect(html).toContain("Broken: four");
  });

  it("renders an explicit hard break (trailing two spaces) as a <br> too", async () => {
    const { html } = await renderToHtml("first line  \nsecond line");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const p = doc.querySelector("p");
    expect(p!.querySelectorAll("br").length).toBe(1);
  });
});
