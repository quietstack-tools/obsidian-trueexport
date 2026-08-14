import { describe, it, expect } from "vitest";
import { renderToHtml, pngBytes } from "../../helpers/render-html";

const SOURCE = [
  "# Heading",
  "",
  "A paragraph with a footnote[^1].",
  "",
  "- one",
  "- two",
  "",
  "[^1]: The note.",
].join("\n");

describe("HTML structure (§5.2)", () => {
  it("is a complete document with the required head tags", async () => {
    const { html } = await renderToHtml(SOURCE);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toMatch(/<html lang="en">/);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('name="viewport"');
  });

  it("parses as HTML with the expected semantic elements", async () => {
    const { html } = await renderToHtml("# H\n\n> [!note] T\n> body\n\n![x](p.png)", {
      binaries: { "p.png": pngBytes() },
    });
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("article.trueexport")).not.toBeNull();
    expect(doc.querySelector("section")).not.toBeNull();
    expect(doc.querySelector("aside.callout")).not.toBeNull();
    expect(doc.querySelector("figure")).not.toBeNull();
  });

  it("inlines CSS in a single <style> block", async () => {
    const { html } = await renderToHtml(SOURCE);
    expect((html.match(/<style>/g) ?? []).length).toBe(1);
    expect(html).not.toContain("<link");
  });

  it("makes no external requests (self-contained)", async () => {
    const { html } = await renderToHtml("![i](p.png)\n\n[link](https://example.com)", {
      binaries: { "p.png": pngBytes() },
    });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<link");
    // Every <img> src is a data: URI, never a remote URL.
    const srcs = [...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(0);
    expect(srcs.every((s) => s.startsWith("data:"))).toBe(true);
    // No external url() in the CSS.
    expect(html).not.toContain("url(http");
  });

  it("base64-embeds images", async () => {
    const { html } = await renderToHtml("![pic](p.png)", { binaries: { "p.png": pngBytes() } });
    expect(html).toContain("data:image/png;base64,");
  });

  it("contains NO [[ or ]] (same regression as DOCX)", async () => {
    const { html } = await renderToHtml("[[Target]] [[Ghost]] [[#Heading]]\n\n# Heading", {
      notes: { "Note.md": "", "Target.md": "x" },
      included: ["Note.md", "Target.md"],
    });
    expect(html.includes("[[")).toBe(false);
    expect(html.includes("]]")).toBe(false);
  });

  it("includes dark-mode and print CSS", async () => {
    const { html } = await renderToHtml(SOURCE);
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain("@media print");
  });

  it("renders footnotes with bidirectional links", async () => {
    const { html } = await renderToHtml(SOURCE);
    expect(html).toContain('<section class="footnotes">');
    expect(html).toContain('id="fnref-1"');
    expect(html).toContain('href="#fn-1"');
    expect(html).toContain('id="fn-1"');
    expect(html).toContain('href="#fnref-1"');
  });
});
