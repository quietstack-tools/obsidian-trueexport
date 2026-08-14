import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { renderToHtml, pngBytes } from "../../helpers/render-html";
import { textToArrayBuffer } from "../../helpers/memory-adapter";

const TORTURE = readFileSync(resolvePath(__dirname, "../../fixtures/torture.md"), "utf8");

const VAULT = {
  sourcePath: "torture.md",
  notes: {
    "torture.md": "",
    "Target Note.md": "# Target\n\nTarget content.",
    "Included.md": "## Included Section\n\nTranscluded content here.",
  },
  binaries: {
    "pic.png": pngBytes(),
    "diagram.png": pngBytes(),
    "drawing.svg": textToArrayBuffer("<svg xmlns='http://www.w3.org/2000/svg'/>"),
  },
  included: ["torture.md", "Target Note.md"],
};

describe("torture.md → HTML", () => {
  it("produces a parseable document with the transcluded content", async () => {
    const { html } = await renderToHtml(TORTURE, VAULT);
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("article.trueexport")).not.toBeNull();
    expect(html).toContain("Transcluded content here");
  });

  it("contains NO [[ or ]]", async () => {
    const { html } = await renderToHtml(TORTURE, VAULT);
    expect(html.includes("[[")).toBe(false);
    expect(html.includes("]]")).toBe(false);
  });

  it("is self-contained: every image is a data URI, no scripts or stylesheets", async () => {
    const { html } = await renderToHtml(TORTURE, VAULT);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<link");
    const srcs = [...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(0);
    expect(srcs.every((s) => s.startsWith("data:"))).toBe(true);
  });

  it("embeds the SVG inline as a data URI (no rasterisation needed for HTML)", async () => {
    const { html } = await renderToHtml(TORTURE, VAULT);
    expect(html).toContain("data:image/svg+xml;base64,");
  });

  it("renders real footnotes and image placeholders", async () => {
    const { html } = await renderToHtml(TORTURE, VAULT);
    expect(html).toContain('<section class="footnotes">');
    expect(html).toContain("[Image not found: does-not-exist.png]");
  });
});
