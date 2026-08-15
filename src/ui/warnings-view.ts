// src/ui/warnings-view.ts
//
// The post-export warnings panel (§6.3). Each warning shows its line number and
// remedy; "Copy details" copies a plain-text summary. Warnings MUST include
// line numbers — that's the difference between a solvable problem and a support
// ticket.

import { App, Modal, Notice, Setting } from "obsidian";
import type { ExportWarning } from "../core/warnings";

/** Plain-text summary used by "Copy details" and testable in isolation. */
export function formatWarnings(outputName: string, warnings: ExportWarning[]): string {
  const lines = [`Exported to ${outputName}`, "", `${warnings.length} item(s) need attention:`, ""];
  for (const w of warnings) {
    const where = w.line !== undefined ? ` (line ${w.line})` : "";
    lines.push(`• [${w.construct}]${where} ${w.message}`);
  }
  return lines.join("\n");
}

export class WarningsModal extends Modal {
  constructor(
    app: App,
    private readonly outputName: string,
    private readonly warnings: ExportWarning[],
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("trueexport-warnings");

    contentEl.createEl("h3", { text: `Exported to ${this.outputName}` });
    contentEl.createEl("p", {
      cls: "trueexport-warnings-count",
      text: `⚠ ${this.warnings.length} item${this.warnings.length === 1 ? "" : "s"} need attention`,
    });

    const list = contentEl.createEl("ul", { cls: "trueexport-warnings-list" });
    for (const w of this.warnings) {
      const item = list.createEl("li");
      const where = w.line !== undefined ? ` (line ${w.line})` : "";
      item.createEl("strong", { text: `${w.construct}${where}: ` });
      item.createSpan({ text: w.message });
    }

    new Setting(contentEl)
      .addButton((b) =>
        b.setButtonText("Copy details").onClick(() => {
          const text = formatWarnings(this.outputName, this.warnings);
          void copyToClipboard(text);
          new Notice("Warning details copied");
        }),
      )
      .addButton((b) => b.setButtonText("Dismiss").setCta().onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    }
  } catch {
    // Clipboard access can be denied; the panel still shows the details.
  }
}
