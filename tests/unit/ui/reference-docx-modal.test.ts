import { describe, it, expect, vi } from "vitest";
import { App } from "obsidian";
import type { TFile } from "obsidian";
import { ReferenceDocxModal } from "../../../src/ui/reference-docx-modal";

describe("ReferenceDocxModal", () => {
  it("sets a placeholder that makes clear this searches the vault, not the whole filesystem", () => {
    const app = new App();
    const modal = new ReferenceDocxModal(app, vi.fn());
    expect(modal.inputEl.placeholder).toBe("Search .docx files in your vault…");
  });

  it("sets an empty-state message explaining no .docx files were found in the vault", () => {
    const app = new App();
    const modal = new ReferenceDocxModal(app, vi.fn());
    expect(modal.emptyStateText).toContain("No .docx files found in your vault");
    expect(modal.emptyStateText).toContain("Add a reference document to your vault first");
  });

  it("lists only .docx files already in the vault", () => {
    const app = new App();
    (app.vault as unknown as { notes: Map<string, string> }).notes.set("Note.md", "# Hi");
    (app.vault as unknown as { binaries: Map<string, ArrayBuffer> }).binaries.set(
      "templates/house.docx",
      new ArrayBuffer(0),
    );
    (app.vault as unknown as { binaries: Map<string, ArrayBuffer> }).binaries.set("images/logo.png", new ArrayBuffer(0));
    const modal = new ReferenceDocxModal(app, vi.fn());
    expect(modal.getItems().map((f) => f.path)).toEqual(["templates/house.docx"]);
  });

  it("reports an empty list, driving the empty-state message, when the vault has no .docx files", () => {
    const app = new App();
    const modal = new ReferenceDocxModal(app, vi.fn());
    expect(modal.getItems()).toEqual([]);
  });

  it("calls the onChoose callback with the chosen file when an item is selected", () => {
    const onChoose = vi.fn();
    const app = new App();
    const modal = new ReferenceDocxModal(app, onChoose);
    const file = { path: "templates/house.docx" } as unknown as TFile;
    modal.onChooseItem(file);
    expect(onChoose).toHaveBeenCalledWith(file);
  });
});
