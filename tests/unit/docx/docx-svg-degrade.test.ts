import { describe, it, expect } from "vitest";
import { WarningCollector } from "../../../src/core/warnings";
import { renderToDocx } from "../../helpers/render-docx";
import { textToArrayBuffer } from "../../helpers/memory-adapter";
import type { DocxDeps } from "../../../src/docx";

// Finding #3: a failing SVG rasterisation must NOT abort the whole DOCX export
// (§4.9). It must degrade to a placeholder + warning, like failed media/mermaid.

const SVG = textToArrayBuffer('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');

const SOURCE = `# Report

Intro paragraph.

![[diagram.svg]]

Closing paragraph.
`;

describe("DOCX SVG rasterisation failure", () => {
  it("does not abort the export; other content renders and a warning is added", async () => {
    const warnings = new WarningCollector();
    const failingRasterizer: DocxDeps = {
      rasterizeSvg: async () => {
        throw new Error("canvas exploded");
      },
    };

    // Without the try/catch this call would REJECT; the fix makes it resolve.
    const result = await renderToDocx(
      SOURCE,
      { binaries: { "diagram.svg": SVG } },
      { deps: failingRasterizer, warnings },
    );

    // The rest of the document is intact.
    expect(result.documentXml).toContain("Intro paragraph.");
    expect(result.documentXml).toContain("Closing paragraph.");
    // The failed SVG degrades to the renderer's text placeholder.
    expect(result.documentXml).toContain("SVG image");

    // A single, actionable image warning was recorded.
    const imageWarnings = warnings.list().filter((w) => w.construct === "image");
    expect(imageWarnings).toHaveLength(1);
    expect(imageWarnings[0].message).toContain("diagram.svg");
  });

  it("still embeds the raster PNG when rasterisation succeeds", async () => {
    const warnings = new WarningCollector();
    const okRasterizer: DocxDeps = {
      // A 1x1 PNG stand-in; the renderer only needs valid-ish bytes to embed.
      rasterizeSvg: async () => ({ data: textToArrayBuffer("PNGDATA") }),
    };
    const result = await renderToDocx(
      SOURCE,
      { binaries: { "diagram.svg": SVG } },
      { deps: okRasterizer, warnings },
    );
    // A media entry was embedded and no degradation warning was raised.
    expect(result.entries.some((e) => e.startsWith("word/media/"))).toBe(true);
    expect(warnings.list().some((w) => w.construct === "image")).toBe(false);
  });
});
