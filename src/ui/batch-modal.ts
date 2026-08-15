// src/ui/batch-modal.ts
//
// Progress dialog for Pro batch folder export (§6.1, §7.3). Shows progress,
// stays cancellable, and drives the obsidian-free exportFolder() via an
// AbortController. Only opened for Pro users (the command gates first).

import { App, Modal, Setting } from "obsidian";
import type { BatchResult } from "../export";

export interface BatchModalHost {
  runFolderExport(
    folderPath: string,
    onProgress: (done: number, total: number) => void,
    signal: AbortSignal,
  ): Promise<BatchResult>;
}

export class BatchModal extends Modal {
  private readonly controller = new AbortController();
  private progressEl: HTMLElement | null = null;
  private done = false;

  constructor(
    app: App,
    private readonly host: BatchModalHost,
    private readonly folderPath: string,
    private readonly folderName: string,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("trueexport-batch");
    contentEl.createEl("h3", { text: `Export folder "${this.folderName}"` });
    this.progressEl = contentEl.createEl("p", { text: "Preparing…" });

    new Setting(contentEl).addButton((b) =>
      b.setButtonText("Cancel").onClick(() => {
        if (this.done) {
          this.close();
        } else {
          this.controller.abort();
          if (this.progressEl) this.progressEl.setText("Cancelling…");
        }
      }),
    );

    void this.run();
  }

  onClose(): void {
    this.controller.abort();
    this.contentEl.empty();
  }

  private async run(): Promise<void> {
    try {
      const result = await this.host.runFolderExport(
        this.folderPath,
        (done, total) => {
          if (this.progressEl) this.progressEl.setText(`Exported ${done} of ${total}…`);
        },
        this.controller.signal,
      );
      this.showSummary(result);
    } catch (error) {
      this.done = true;
      if (this.progressEl) {
        this.progressEl.setText(`Folder export failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private showSummary(result: BatchResult): void {
    this.done = true;
    if (!this.progressEl) return;
    const parts = [`${result.outputs.length} of ${result.total} exported`];
    if (result.failures.length > 0) parts.push(`${result.failures.length} failed`);
    if (result.cancelled) parts.push("cancelled");
    if (result.warnings.length > 0) parts.push(`${result.warnings.length} warning(s)`);
    this.progressEl.setText(parts.join(" · "));
  }
}
