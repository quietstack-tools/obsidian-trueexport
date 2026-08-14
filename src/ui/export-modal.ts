// src/ui/export-modal.ts
//
// The export dialog (§6.2): format radios, template dropdown (Pro items visible
// but disabled with a "Learn more" link), save location, an Advanced section, a
// clickable warnings row shown only when a pre-scan finds issues, Enter/Escape
// keybindings, and last-used format/template memory.

import { App, Modal, Setting } from "obsidian";
import type { ExportFormat, TemplateId } from "../core/options";
import type { ExportWarning } from "../core/warnings";
import {
  TEMPLATES,
  FORMAT_LABELS,
  availableFormats,
  type TrueExportSettings,
} from "./settings";
import { WarningsModal } from "./warnings-view";

export const PRO_URL = "https://quietstack.tools/trueexport";

/** What the modal needs from the plugin — keeps it decoupled and testable. */
export interface ExportModalHost {
  settings: TrueExportSettings;
  isMobile: boolean;
  isPro: boolean;
  saveSettings(): Promise<void>;
  scan(sourcePath: string, format: ExportFormat, template: TemplateId): Promise<ExportWarning[]>;
  runExport(sourcePath: string, format: ExportFormat, template: TemplateId): Promise<void>;
}

export interface ExportSource {
  path: string;
  name: string;
}

export class ExportModal extends Modal {
  private format: ExportFormat;
  private template: TemplateId;
  private warnings: ExportWarning[] = [];
  private warningsRow: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly host: ExportModalHost,
    private readonly source: ExportSource,
  ) {
    super(app);
    const formats = availableFormats(host.isMobile);
    this.format = formats.includes(host.settings.lastFormat) ? host.settings.lastFormat : formats[0];
    this.template = host.settings.lastTemplate;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("trueexport-modal");
    contentEl.createEl("h3", { text: `Export "${this.source.name}"` });

    this.renderFormat(contentEl);
    this.renderTemplate(contentEl);
    this.renderSaveTo(contentEl);
    this.renderAdvanced(contentEl);
    this.warningsRow = contentEl.createEl("div", { cls: "trueexport-warnings-row" });
    this.warningsRow.style.display = "none";
    this.renderButtons(contentEl);

    // Enter exports; Escape is handled by Obsidian's Modal.
    this.contentEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void this.submit();
      }
    });

    void this.rescan();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderFormat(container: HTMLElement): void {
    const setting = new Setting(container).setName("Format");
    const group = setting.controlEl.createEl("div", { cls: "trueexport-format-group" });
    for (const format of availableFormats(this.host.isMobile)) {
      const label = group.createEl("label", { cls: "trueexport-format-option" });
      const input = label.createEl("input", { type: "radio", attr: { name: "te-format", value: format } });
      if (format === this.format) input.setAttribute("checked", "checked");
      label.createSpan({ text: ` ${FORMAT_LABELS[format]}` });
      input.addEventListener("change", () => {
        this.format = format;
        this.host.settings.lastFormat = format;
        void this.host.saveSettings();
        void this.rescan();
      });
    }
  }

  private renderTemplate(container: HTMLElement): void {
    const hasPro = TEMPLATES.some((t) => t.pro);
    const setting = new Setting(container).setName("Template");
    if (hasPro && !this.host.isPro) {
      const frag = document.createDocumentFragment();
      frag.appendChild(document.createTextNode("Custom templates need Pro. "));
      const link = document.createElement("a");
      link.href = PRO_URL;
      link.textContent = "Learn more";
      frag.appendChild(link);
      setting.setDesc(frag);
    }
    setting.addDropdown((dd) => {
      for (const t of TEMPLATES) dd.addOption(t.id, t.name);
      // Pro templates are visible but disabled for free users (§6.2).
      for (const t of TEMPLATES) {
        if (t.pro && !this.host.isPro) {
          const opt = dd.selectEl.querySelector(`option[value="${t.id}"]`);
          if (opt) (opt as HTMLOptionElement).disabled = true;
        }
      }
      const selectable = TEMPLATES.find((t) => t.id === this.template && (!t.pro || this.host.isPro));
      this.template = selectable ? this.template : "default";
      dd.setValue(this.template);
      dd.onChange((value) => {
        this.template = value;
        this.host.settings.lastTemplate = value;
        void this.host.saveSettings();
      });
    });
  }

  private renderSaveTo(container: HTMLElement): void {
    new Setting(container).setName("Save to").addDropdown((dd) => {
      dd.addOption("same-folder", "Same folder as note");
      dd.addOption("vault-root", "Vault root");
      dd.addOption("custom", "Custom folder");
      dd.setValue(this.host.settings.outputLocation);
      dd.onChange((value) => {
        this.host.settings.outputLocation = value as TrueExportSettings["outputLocation"];
        void this.host.saveSettings();
      });
    });
  }

  private renderAdvanced(container: HTMLElement): void {
    const details = container.createEl("details", { cls: "trueexport-advanced" });
    details.createEl("summary", { text: "Advanced" });
    new Setting(details).setName("Frontmatter").addDropdown((dd) => {
      dd.addOption("strip", "Remove");
      dd.addOption("metadata", "Document properties");
      dd.addOption("table", "Table at top");
      dd.setValue(this.host.settings.frontmatterMode);
      dd.onChange((value) => {
        this.host.settings.frontmatterMode = value as TrueExportSettings["frontmatterMode"];
        void this.host.saveSettings();
      });
    });
    new Setting(details).setName("Allow remote images").addToggle((tg) => {
      tg.setValue(this.host.settings.allowRemoteImages).onChange((value) => {
        this.host.settings.allowRemoteImages = value;
        void this.host.saveSettings();
      });
    });
  }

  private renderButtons(container: HTMLElement): void {
    new Setting(container)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Export").setCta().onClick(() => void this.submit()));
  }

  private async rescan(): Promise<void> {
    try {
      this.warnings = await this.host.scan(this.source.path, this.format, this.template);
    } catch {
      this.warnings = [];
    }
    this.updateWarningsRow();
  }

  private updateWarningsRow(): void {
    const row = this.warningsRow;
    if (!row) return;
    row.empty();
    if (this.warnings.length === 0) {
      row.style.display = "none";
      return;
    }
    row.style.display = "";
    row.setText(`⚠ ${this.warnings.length} item${this.warnings.length === 1 ? "" : "s"} need attention`);
    row.addEventListener("click", () => {
      new WarningsModal(this.app, this.source.name, this.warnings).open();
    });
  }

  private async submit(): Promise<void> {
    this.close();
    await this.host.runExport(this.source.path, this.format, this.template);
  }
}
