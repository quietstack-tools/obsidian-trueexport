import { describe, it, expect } from "vitest";
import { buildCss } from "../../../src/html/css";

describe("HTML/PDF stylesheet", () => {
  it("lists explicit CJK font fallbacks (Electron's printToPDF doesn't reliably do implicit fallback)", () => {
    const css = buildCss();
    expect(css).toContain("Noto Sans CJK SC");
    expect(css).toContain("PingFang SC");
  });

  it("styles links as blue and underlined in the print/PDF context", () => {
    const css = buildCss();
    const printBlock = css.slice(css.indexOf("@media print"));
    expect(printBlock).toContain("a { color: #0b66c3; text-decoration: underline; }");
  });

  it("hides the footnote back-reference arrow in the print/PDF context", () => {
    const css = buildCss();
    const printBlock = css.slice(css.indexOf("@media print"));
    expect(printBlock).toContain(".footnote-back { display: none; }");
  });

  it("gives embedded content a left border distinct from blockquotes and callouts", () => {
    const css = buildCss();
    expect(css).toContain(".embedded { border-left: 3px solid #8c8c8c; padding-left: 0.75em; }");
  });
});

// D19 regression: selecting a built-in template (§8) must actually change the
// generated stylesheet, not just be accepted and silently dropped.
describe("HTML/PDF template selection (§8)", () => {
  it("Default is sans-serif with the blue heading colour", () => {
    const css = buildCss("default");
    expect(css).toContain("color: #1f3864");
    expect(css).not.toContain("Cambria");
  });

  it("Professional uses a dark-grey heading colour, not the default blue", () => {
    const css = buildCss("professional");
    expect(css).toContain("color: #404040");
    expect(css).not.toContain("#1f3864");
  });

  it("Academic is serif, double-spaced, with indented paragraphs and black headings", () => {
    const css = buildCss("academic");
    expect(css).toContain("Cambria");
    expect(css).toContain("line-height: 2");
    expect(css).toContain("text-indent: 1.5em");
    expect(css).toContain("color: #000000");
  });

  it("Minimal is Helvetica/Arial with black headings and generous paragraph spacing", () => {
    const css = buildCss("minimal");
    expect(css).toContain("Helvetica, Arial");
    expect(css).toContain("color: #000000");
    expect(css).toContain("margin: 0 0 1.4em");
  });

  it("all four built-ins produce genuinely different stylesheets", () => {
    const all = (["default", "professional", "academic", "minimal"] as const).map((t) => buildCss(t));
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(all[i]).not.toBe(all[j]);
      }
    }
  });

  it("resets template heading colour to inherit in dark mode for readable contrast", () => {
    const css = buildCss("minimal");
    const darkBlock = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
    expect(darkBlock).toContain("h1, h2, h3, h4, h5 { color: inherit; }");
  });

  it("an unrecognised/Pro-custom template id falls back to the Default character", () => {
    expect(buildCss("some-custom-template-id")).toBe(buildCss("default"));
  });
});
