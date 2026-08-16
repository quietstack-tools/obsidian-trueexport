import { describe, it, expect } from "vitest";
import { sanitizeRawHtml } from "../../../src/html/sanitize";

describe("sanitizeRawHtml", () => {
  it("removes <script> elements and their content", () => {
    const out = sanitizeRawHtml("<div>ok<script>steal()</script>done</div>");
    expect(out).not.toMatch(/script/i);
    expect(out).toContain("ok");
    expect(out).toContain("done");
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

  it("strips remote-loading / redirecting tags but keeps inner text", () => {
    expect(sanitizeRawHtml('<iframe src="https://evil.tld"></iframe>')).not.toMatch(/iframe/i);
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
