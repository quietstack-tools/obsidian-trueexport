import { describe, it, expect } from "vitest";
import { sanitizeRawHtml } from "../../../src/html/sanitize";

describe("sanitizeRawHtml", () => {
  it("neutralises <script> elements — escaped to inert text, not deleted (§D27)", () => {
    const out = sanitizeRawHtml("<div>ok<script>steal()</script>done</div>");
    // No longer a live, parseable <script> tag...
    expect(out).not.toContain("<script>");
    // ...but the source text is still visible/traceable, just HTML-escaped.
    expect(out).toContain("&lt;script&gt;steal()&lt;/script&gt;");
    expect(out).toContain("ok");
    expect(out).toContain("done");
  });

  // D27: a note whose ENTIRE htmlBlock is just a dangerous element (no other
  // content around it) must not vanish without a trace. Confirmed via a real
  // report: <iframe src="..."></iframe> alone on its own line disappeared
  // completely -- no escaped text, no placeholder, no warning.
  it("D27: never reduces a dangerous element to nothing — always leaves escaped, visible text behind", () => {
    for (const raw of [
      `<script>alert('should never execute or appear as a live script tag')</script>`,
      `<iframe src="https://example.com"></iframe>`,
      `<style>body{display:none}</style>`,
      `<object data="evil.swf"></object>`,
    ]) {
      const out = sanitizeRawHtml(raw);
      expect(out.trim()).not.toBe("");
      expect(out).toContain(raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    }
  });

  it("strips inline event handlers", () => {
    expect(sanitizeRawHtml('<div onclick="evil()">x</div>')).not.toMatch(/onclick/i);
    expect(sanitizeRawHtml("<img src=x onerror=alert(1)>")).not.toMatch(/onerror/i);
    expect(sanitizeRawHtml("<div onmouseover='a()'>x</div>")).not.toMatch(/onmouseover/i);
  });

  it("neutralises javascript: and data: URLs in attributes", () => {
    expect(sanitizeRawHtml('<a href="javascript:alert(1)">x</a>')).not.toMatch(/javascript:/i);
    expect(sanitizeRawHtml('<img src="data:text/html,<script>">')).not.toMatch(/data:text/i);
  });

  it("neutralises <iframe> — escaped to inert text, never a live/loadable element", () => {
    const out = sanitizeRawHtml('<iframe src="https://evil.tld"></iframe>');
    expect(out).not.toContain("<iframe"); // never a real, parseable element
    expect(out).toContain("&lt;iframe"); // but still visible, as escaped text
  });

  it("strips remote-loading / redirecting TAG-ONLY elements but keeps inner text", () => {
    const form = sanitizeRawHtml('<form action="https://evil.tld">hello</form>');
    expect(form).not.toMatch(/<form/i);
    expect(form).toContain("hello");
    expect(sanitizeRawHtml('<link rel="stylesheet" href="https://evil.tld/x.css">')).not.toMatch(/<link/i);
  });

  it("leaves benign markup intact", () => {
    const html = '<div class="note"><strong>Bold</strong> and <em>italic</em></div>';
    expect(sanitizeRawHtml(html)).toBe(html);
  });
});
