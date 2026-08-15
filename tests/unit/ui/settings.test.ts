import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  TEMPLATES,
  availableFormats,
  renderFilename,
  sanitizeFilename,
  settingsToExportOptions,
} from "../../../src/ui/settings";

describe("settings defaults", () => {
  it("default to safe values", () => {
    expect(DEFAULT_SETTINGS.defaultFormat).toBe("docx");
    expect(DEFAULT_SETTINGS.allowRemoteImages).toBe(false);
    expect(DEFAULT_SETTINGS.frontmatterMode).toBe("strip");
    expect(DEFAULT_SETTINGS.licenceActivated).toBe(false);
  });
});

describe("templates", () => {
  it("offers four free built-ins and gates custom behind Pro", () => {
    const free = TEMPLATES.filter((t) => !t.pro).map((t) => t.id);
    expect(free).toEqual(["default", "professional", "academic", "minimal"]);
    expect(TEMPLATES.find((t) => t.id === "custom")?.pro).toBe(true);
  });
});

describe("availableFormats", () => {
  it("hides PDF on mobile, offers all three on desktop", () => {
    expect(availableFormats(true)).toEqual(["docx", "html"]);
    expect(availableFormats(false)).toEqual(["docx", "pdf", "html"]);
  });
});

describe("settingsToExportOptions", () => {
  it("uses Word page size for docx and PDF settings for pdf", () => {
    const s = { ...DEFAULT_SETTINGS, wordPageSize: "Letter" as const, pdfPageSize: "Legal" as const, pdfOrientation: "landscape" as const };
    expect(settingsToExportOptions(s, "docx", "default").pageSize).toBe("Letter");
    const pdf = settingsToExportOptions(s, "pdf", "default");
    expect(pdf.pageSize).toBe("Legal");
    expect(pdf.orientation).toBe("landscape");
  });

  it("carries frontmatter mode, remote-image and depth settings through", () => {
    const s = { ...DEFAULT_SETTINGS, frontmatterMode: "table" as const, allowRemoteImages: true, transclusionDepth: 3 };
    const opts = settingsToExportOptions(s, "html", "minimal");
    expect(opts.frontmatterMode).toBe("table");
    expect(opts.allowRemoteImages).toBe(true);
    expect(opts.transclusionDepth).toBe(3);
    expect(opts.template).toBe("minimal");
  });
});

describe("renderFilename", () => {
  it("expands placeholders", () => {
    expect(renderFilename("{{title}}-{{date}}-{{time}}", { title: "My Note", date: "2026-08-15", time: "0930" })).toBe(
      "My Note-2026-08-15-0930",
    );
  });

  it("sanitises illegal filename characters", () => {
    expect(sanitizeFilename('a/b:c*d?"e<f>g|h')).toBe("a-b-c-d--e-f-g-h");
  });

  it("falls back to Untitled when empty", () => {
    expect(renderFilename("{{title}}", { title: "", date: "", time: "" })).toBe("Untitled");
  });
});
