import { describe, it, expect } from "vitest";
import { App } from "obsidian";
import { formatWarnings, WarningsModal } from "../../../src/ui/warnings-view";
import type { ExportWarning } from "../../../src/core/warnings";

const WARNINGS: ExportWarning[] = [
  { construct: "dataview", message: "Dataview queries cannot be exported. Export note content instead.", line: 45, sourcePath: "N.md" },
  { construct: "image", message: "Image not found: diagram.png. Check the file exists.", line: 78, sourcePath: "N.md" },
];

describe("formatWarnings", () => {
  it("includes the output name, count, line numbers and remedies", () => {
    const text = formatWarnings("Note.docx", WARNINGS);
    expect(text).toContain("Exported to Note.docx");
    expect(text).toContain("2 item(s) need attention");
    expect(text).toContain("(line 45)");
    expect(text).toContain("(line 78)");
    expect(text).toContain("Export note content");
  });
});

describe("WarningsModal", () => {
  it("renders a list with a line number per warning and action buttons", () => {
    const modal = new WarningsModal(new App(), "Note.docx", WARNINGS);
    modal.onOpen();
    const items = modal.contentEl.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(modal.contentEl.textContent).toContain("line 45");
    const buttons = Array.from(modal.contentEl.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons).toContain("Copy details");
    expect(buttons).toContain("Dismiss");
  });
});
