import { describe, it, expect } from "vitest";
import { renderHtml } from "../../../src/html";
import { defaultExportOptions } from "../../../src/core/options";
import { WarningCollector } from "../../../src/core/warnings";
import { resolve } from "../../helpers/resolve";
import { textToArrayBuffer } from "../../helpers/memory-adapter";

// Warning parity with the DOCX renderer's corrupt-SVG degradation (§D20):
// HTML/PDF embed SVGs directly (no rasterisation step), so this is the only
// place in this renderer that ever inspects the SVG's actual content.

const CORRUPT_SVG = textToArrayBuffer("this is just plain text, not an SVG");
const VALID_SVG = textToArrayBuffer('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');

const SOURCE = `# Report

Intro paragraph.

![[diagram.svg]]

Closing paragraph.
`;

describe("HTML/PDF corrupt embedded SVG", () => {
  it("degrades to a placeholder and records a warning, without aborting the rest of the document", async () => {
    const options = defaultExportOptions();
    const { doc } = await resolve(SOURCE, { binaries: { "diagram.svg": CORRUPT_SVG } });
    const warnings = new WarningCollector();

    const html = renderHtml(doc, options, { warnings, sourcePath: "Note.md" });

    expect(html).toContain("Intro paragraph.");
    expect(html).toContain("Closing paragraph.");
    expect(html).toContain("[SVG image: diagram.svg]");
    expect(html).not.toContain("data:image/svg+xml");

    const imageWarnings = warnings.list().filter((w) => w.construct === "image");
    expect(imageWarnings).toHaveLength(1);
    expect(imageWarnings[0].message).toContain("diagram.svg");
    expect(imageWarnings[0].message.toLowerCase()).toMatch(/invalid|corrupt/);
  });

  it("embeds a well-formed SVG normally, with no warning", async () => {
    const options = defaultExportOptions();
    const { doc } = await resolve(SOURCE, { binaries: { "diagram.svg": VALID_SVG } });
    const warnings = new WarningCollector();

    const html = renderHtml(doc, options, { warnings, sourcePath: "Note.md" });

    expect(html).toContain("data:image/svg+xml");
    expect(warnings.list().some((w) => w.construct === "image")).toBe(false);
  });
});
