// src/ui/reference-docx-modal.ts
//
// Vault-scoped fuzzy picker for the "Reference DOCX (house style)" setting
// (§8). Unlike the custom output folder, this path is read via
// VaultAdapter.readBinary() (app.vault.getAbstractFileByPath()) — it MUST
// stay a vault-relative path, never an arbitrary filesystem location, so an
// OS-wide Electron file dialog (the custom-output-folder pattern) is the
// wrong tool here: it would let a user pick a file outside the vault, which
// the reader can never resolve, and reading arbitrary filesystem paths would
// violate "never read/write outside the vault" (CLAUDE.md). A fuzzy picker
// scoped to the vault's own .docx files can never produce an invalid pick,
// and needs no Electron/desktop-only dependency — it works identically on
// mobile.

import { App, FuzzySuggestModal, TFile } from "obsidian";

export class ReferenceDocxModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly onChoose: (file: TFile) => void,
  ) {
    super(app);
    this.setPlaceholder("Choose a reference .docx…");
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((f) => f.extension.toLowerCase() === "docx");
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}
