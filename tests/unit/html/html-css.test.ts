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
