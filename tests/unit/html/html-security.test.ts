import { describe, it, expect } from "vitest";
import { renderToHtml } from "../../helpers/render-html";

describe("HTML export security", () => {
  it("emits a strict Content-Security-Policy that forbids script and external loads", async () => {
    const { html } = await renderToHtml("# Hi\n\nsome text");
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("img-src data:");
  });

  it("renders a javascript: link as inert text, not an anchor", async () => {
    const { html } = await renderToHtml("[click me](javascript:alert(document.cookie))");
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).toContain("click me");
    expect(html).toContain('class="unsafe-link"');
  });

  it("keeps a normal https link as an anchor", async () => {
    const { html } = await renderToHtml("[site](https://example.com)");
    expect(html).toContain('href="https://example.com"');
  });

  it("sanitises raw HTML blocks (no script survives)", async () => {
    const { html } = await renderToHtml("<div>\n<script>steal()</script>\n</div>");
    expect(html).not.toMatch(/<script>steal/i);
  });
});
