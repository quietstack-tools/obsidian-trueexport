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

  it("renders a code block without highlighting, escaping content", async () => {
    const { html } = await renderToHtml("```js\nif (a < b) {}\n```");
    expect(html).toContain('<pre><code class="language-js">');
    expect(html).toContain("if (a &lt; b) {}");
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
});
