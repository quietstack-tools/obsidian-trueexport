import { describe, it, expect } from "vitest";
import { App } from "obsidian";
import { BatchWarningsModal, formatBatchWarnings, formatWarnings, WarningsModal } from "../../../src/ui/warnings-view";
import type { ExportWarning } from "../../../src/core/warnings";

const WARNINGS: ExportWarning[] = [
  { construct: "dataview", message: "Dataview queries cannot be exported. Export note content instead.", line: 45, sourcePath: "N.md" },
  { construct: "image", message: "Image not found: diagram.png. Check the file exists.", line: 78, sourcePath: "N.md" },
];

const BATCH_WARNINGS: ExportWarning[] = [
  { construct: "math", message: "Equation couldn't be converted and was shown as text.", line: 14, sourcePath: "folder/One.md" },
  { construct: "image", message: "Image not found: diagram.png. Check the file exists.", line: 3, sourcePath: "folder/Two.md" },
  { construct: "dataview", message: "Dataview queries cannot be exported.", line: 9, sourcePath: "folder/One.md" },
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

describe("formatBatchWarnings", () => {
  it("groups warnings by source file, not just an aggregate count", () => {
    const text = formatBatchWarnings("MyFolder", BATCH_WARNINGS);
    expect(text).toContain("3 item(s) need attention");
    expect(text).toContain("folder/One.md");
    expect(text).toContain("folder/Two.md");
    // Each file's own warnings appear under its own heading, in source order.
    const oneIdx = text.indexOf("folder/One.md");
    const twoIdx = text.indexOf("folder/Two.md");
    expect(text.indexOf("(line 14)", oneIdx)).toBeGreaterThan(oneIdx);
    expect(text.indexOf("(line 9)", oneIdx)).toBeGreaterThan(oneIdx);
    expect(text.indexOf("(line 3)", twoIdx)).toBeGreaterThan(twoIdx);
  });
});

describe("BatchWarningsModal", () => {
  it("shows a per-file breakdown (which file, which warning), not just a total", () => {
    const modal = new BatchWarningsModal(new App(), "MyFolder", BATCH_WARNINGS);
    modal.onOpen();

    const headings = Array.from(modal.contentEl.querySelectorAll("h4")).map((h) => h.textContent);
    expect(headings).toEqual(["folder/One.md", "folder/Two.md"]);

    const items = modal.contentEl.querySelectorAll("li");
    expect(items.length).toBe(3);
    expect(modal.contentEl.textContent).toContain("line 14");
    expect(modal.contentEl.textContent).toContain("line 3");

    const buttons = Array.from(modal.contentEl.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons).toContain("Copy details");
    expect(buttons).toContain("Dismiss");
  });
});
