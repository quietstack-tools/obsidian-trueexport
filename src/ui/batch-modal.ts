// src/ui/batch-modal.ts
//
// Progress dialog for Pro batch folder export (§6.1, §7.3). Shows progress,
// stays cancellable, and drives the obsidian-free exportFolder() via an
// AbortController. Only opened for Pro users (the command gates first).

import { App, ButtonComponent, Modal, Notice, Setting } from "obsidian";
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
  private cancelButton: ButtonComponent | null = null;
  private done = false;
  /**
   * True once the modal's DOM has gone away (Cancel/Close clicked, Escape,
   * or Obsidian's own default backdrop-click dismissal — there is no public
   * Modal API to suppress that). The export itself keeps running regardless
   * (see onClose's doc comment); this only decides whether the eventual
   * result needs a Notice fallback since there's no modal left to show it in.
   */
  private dismissed = false;

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

    new Setting(contentEl).addButton((b) => {
      this.cancelButton = b;
      b.setButtonText("Cancel").onClick(() => {
        if (this.done) {
          this.close();
        } else {
          this.controller.abort();
          if (this.progressEl) this.progressEl.setText("Cancelling…");
        }
      });
    });

    void this.run();
  }

  /**
   * Runs whenever the modal's DOM goes away — including Obsidian's own
   * default click-outside-to-dismiss behaviour (there's no public Modal API
   * to disable that), not just an explicit Cancel/Close click. D22: it must
   * NOT abort the run as a side effect of the modal closing. Cancellation is
   * only ever explicit, via the Cancel button's own onClick above — an
   * ordinary action like switching notes in the sidebar (which can trigger
   * this the same way a backdrop click would) must never silently truncate
   * an in-progress batch export.
   */
  onClose(): void {
    this.dismissed = true;
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
      console.error("[TrueExport]", error);
      this.markDone();
      const message = `Folder export failed: ${error instanceof Error ? error.message : String(error)}`;
      if (this.dismissed) {
        // No modal left to show this in — the export still ran to whatever
        // point it failed at, so surface it rather than going silent.
        new Notice(message);
      } else if (this.progressEl) {
        this.progressEl.setText(message);
      }
    }
  }

  /**
   * Once the batch has finished (success, failure, or cancelled) there is
   * nothing left to cancel — relabel the button so it reads as a plain
   * dismissal ("Close") rather than implying an in-progress action can still
   * be stopped ("Cancel"). The click handler already special-cases `done` to
   * just close the modal; this only fixes the label to match.
   */
  private markDone(): void {
    this.done = true;
    this.cancelButton?.setButtonText("Close");
  }

  private showSummary(result: BatchResult): void {
    this.markDone();
    const parts = [`${result.outputs.length} of ${result.total} exported`];
    if (result.failures.length > 0) parts.push(`${result.failures.length} failed`);
    if (result.cancelled) parts.push("cancelled");
    if (result.warnings.length > 0) parts.push(`${result.warnings.length} warning(s)`);
    const summary = parts.join(" · ");
    if (this.dismissed) {
      // The modal was already dismissed (e.g. the user navigated away) before
      // the export finished running in the background — surface the result
      // via a Notice instead of silently finishing with nothing shown.
      new Notice(`Folder export: ${summary}`);
    } else if (this.progressEl) {
      this.progressEl.setText(summary);
    }
  }
}
