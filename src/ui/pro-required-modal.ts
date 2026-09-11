// src/ui/pro-required-modal.ts
//
// Shown when a free user triggers a Pro-only entry point that has no other UI
// of its own to carry the message (e.g. the folder-export context menu item —
// unlike the single-note export modal, there's no already-open dialog to show
// an inline upsell in). A transient Notice built from a plain string can't
// carry a real hyperlink and vanishes before a user can act on it; this modal
// stays open until dismissed and reuses the same "<text> Learn more" pattern
// as the export modal's template upsell (src/ui/export-modal.ts) and the
// settings tab's "Get TrueExport Pro" row, instead of inventing new copy/UI.

import { App, Modal, Setting } from "obsidian";

export class ProRequiredModal extends Modal {
  constructor(
    app: App,
    private readonly feature: string,
    private readonly proUrl: string,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: `${this.feature} requires TrueExport Pro` });

    const frag = document.createDocumentFragment();
    frag.appendChild(document.createTextNode(`${this.feature} is a Pro feature. `));
    const link = document.createElement("a");
    link.href = this.proUrl;
    link.textContent = "Learn more";
    frag.appendChild(link);
    contentEl.createEl("p").appendChild(frag);

    new Setting(contentEl).addButton((b) => b.setButtonText("Close").setCta().onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
