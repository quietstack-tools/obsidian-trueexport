// Runs in jsdom (vitest default env), which gives createHtmlSanitizer the real
// DOM DOMPurify needs. These payloads target the weaknesses of a regex-only
// sanitiser — malformed/nested tags and mutation XSS — to prove the DOM-based
// pass catches what string matching would miss.
import { describe, it, expect } from "vitest";
import { createHtmlSanitizer } from "../../../src/obsidian-adapter";

const clean = createHtmlSanitizer();

/** Parse sanitised output and return the live elements of a given tag. */
function elements(html: string, selector: string): number {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return holder.querySelectorAll(selector).length;
}

describe("createHtmlSanitizer (DOMPurify)", () => {
  it("neutralises nested/split <script> that a naive regex would miss", () => {
    const out = clean("<scr<script>ipt>alert(1)</script>");
    // No live <script> element survives; any leftover payload is inert text.
    expect(out).not.toMatch(/<script/i);
    expect(elements(out, "script")).toBe(0);
  });

  it("strips event-handler attributes", () => {
    expect(clean("<img src=x onerror=alert(1)>")).not.toMatch(/onerror/i);
    expect(clean('<div onmouseover="steal()">hi</div>')).not.toMatch(/onmouseover/i);
  });

  it("removes javascript: URLs from hrefs", () => {
    const out = clean('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain("x");
  });

  it("drops SVG/MathML script vectors (html profile only)", () => {
    const out = clean("<svg><script>alert(1)</script></svg>");
    expect(out).not.toMatch(/<svg/i);
    expect(elements(out, "script, svg")).toBe(0);
  });

  it("removes iframe/object/embed and other remote-loading tags", () => {
    expect(clean('<iframe src="https://evil.tld"></iframe>')).not.toMatch(/iframe/i);
    expect(clean('<object data="https://evil.tld"></object>')).not.toMatch(/object/i);
    expect(clean('<embed src="https://evil.tld">')).not.toMatch(/embed/i);
  });

  it("defeats a mutation-XSS payload", () => {
    // Classic mXSS shape: parser re-nesting has historically resurrected the
    // onerror handler. DOMPurify's DOM round-trip must leave none behind.
    const payload =
      '<form><math><mtext></form><form><mglyph><style></math><img src=x onerror=alert(1)>';
    const out = clean(payload);
    expect(out).not.toMatch(/onerror/i);
    expect(elements(out, "[onerror], script")).toBe(0);
  });

  it("keeps benign inline markup", () => {
    const out = clean("<strong>Bold</strong> and <em>italic</em>");
    expect(out).toContain("<strong>Bold</strong>");
    expect(out).toContain("<em>italic</em>");
  });
});
