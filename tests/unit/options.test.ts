import { describe, it, expect } from "vitest";
import { defaultExportOptions } from "../../src/core/options";

describe("defaultExportOptions", () => {
  it("uses safe, privacy-preserving defaults", () => {
    const options = defaultExportOptions();
    // Remote fetching must be off by default (§7.6, R6).
    expect(options.allowRemoteImages).toBe(false);
    // Frontmatter stripped by default (§4.12).
    expect(options.frontmatterMode).toBe("strip");
    // Transclusion depth guard defaults to 5 (§4.3).
    expect(options.transclusionDepth).toBe(5);
    // Tabs expand to 4 spaces in code blocks (§4.8).
    expect(options.tabWidth).toBe(4);
  });

  it("defaults to a DOCX / default-template portrait export", () => {
    const options = defaultExportOptions();
    expect(options.format).toBe("docx");
    expect(options.template).toBe("default");
    expect(options.orientation).toBe("portrait");
    expect(options.pageSize).toBe("A4");
  });

  it("returns an independent object each call", () => {
    const a = defaultExportOptions();
    a.transclusionDepth = 99;
    const b = defaultExportOptions();
    expect(b.transclusionDepth).toBe(5);
  });
});
