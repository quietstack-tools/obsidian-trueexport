// main.ts — TrueExport plugin entry point.
//
// Wires commands, menu items, the ribbon icon and the settings tab to the
// export pipeline. All registrations use Obsidian's auto-cleaned APIs
// (addCommand / registerEvent / addRibbonIcon / addSettingTab), so onunload has
// nothing to leak (§10).

import { Notice, Plugin, Platform, TFile, TFolder, type Menu } from "obsidian";
import { ObsidianVaultAdapter, createSvgRasterizer } from "./src/obsidian-adapter";
import type { VaultAdapter } from "./src/core/adapter";
import type { DocxDeps } from "./src/docx";
import type { ExportFormat, TemplateId } from "./src/core/options";
import type { ExportWarning } from "./src/core/warnings";
import { exportNote, scanNote, basename, type VaultWriter } from "./src/export";
import {
  DEFAULT_SETTINGS,
  type TrueExportSettings,
} from "./src/ui/settings";
import { ExportModal, type ExportModalHost, type ExportSource } from "./src/ui/export-modal";
import { TrueExportSettingTab } from "./src/ui/settings-tab";
import { WarningsModal } from "./src/ui/warnings-view";

const PRO_URL = "https://quietstack.tools/trueexport";

export default class TrueExportPlugin extends Plugin implements ExportModalHost {
  settings: TrueExportSettings = { ...DEFAULT_SETTINGS };
  private adapter!: VaultAdapter;
  private deps!: DocxDeps;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.adapter = new ObsidianVaultAdapter(this.app);
    this.deps = { rasterizeSvg: createSvgRasterizer() };

    this.addCommand({
      id: "export-docx",
      name: "Export current note to Word (DOCX)",
      checkCallback: (checking) => this.directExport(checking, "docx"),
    });
    this.addCommand({
      id: "export-pdf",
      name: "Export current note to PDF",
      // PDF is desktop-only; the command is hidden on mobile (§7.5).
      checkCallback: (checking) => !Platform.isMobile && this.directExport(checking, "pdf"),
    });
    this.addCommand({
      id: "export-html",
      name: "Export current note to HTML",
      checkCallback: (checking) => this.directExport(checking, "html"),
    });
    this.addCommand({
      id: "export-dialog",
      name: "Export current note…",
      checkCallback: (checking) => {
        const file = this.activeMarkdownFile();
        if (!file) return false;
        if (!checking) this.openExportModal(file);
        return true;
      },
    });
    this.addCommand({
      id: "export-folder",
      name: "Export folder… (Pro)",
      checkCallback: (checking) => {
        if (!checking) this.requireProNotice("Folder export");
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file) => {
        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((item) =>
            item
              .setTitle("Export with TrueExport…")
              .setIcon("file-output")
              .onClick(() => this.openExportModal(file)),
          );
        } else if (file instanceof TFolder) {
          menu.addItem((item) =>
            item
              .setTitle("Export folder with TrueExport…")
              .setIcon("file-output")
              .onClick(() => this.requireProNotice("Folder export")),
          );
        }
      }),
    );

    if (this.settings.showRibbonIcon) {
      this.addRibbonIcon("file-output", "Export with TrueExport", () => {
        const file = this.activeMarkdownFile();
        if (file) this.openExportModal(file);
        else new Notice("Open a note to export it.");
      });
    }

    this.addSettingTab(new TrueExportSettingTab(this.app, this));
  }

  onunload(): void {
    // Nothing to clean up manually: every registration above uses an
    // auto-cleaned Obsidian API.
  }

  // ---- ExportModalHost ----

  get isMobile(): boolean {
    return Platform.isMobile;
  }

  get isPro(): boolean {
    return this.settings.licenceActivated;
  }

  async scan(sourcePath: string, format: ExportFormat, template: TemplateId): Promise<ExportWarning[]> {
    return scanNote(this.adapter, this.settings, sourcePath, format, template);
  }

  async runExport(sourcePath: string, format: ExportFormat, template: TemplateId): Promise<void> {
    try {
      const result = await exportNote({
        adapter: this.adapter,
        writer: this.writer(),
        settings: this.settings,
        sourcePath,
        format,
        template,
        deps: this.deps,
      });
      new Notice(`Exported to ${basename(result.outputPath)}`);
      if (result.warnings.length > 0) {
        new WarningsModal(this.app, basename(result.outputPath), result.warnings).open();
      }
    } catch (error) {
      console.error("[TrueExport]", error);
      new Notice(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ---- helpers ----

  private directExport(checking: boolean, format: ExportFormat): boolean {
    const file = this.activeMarkdownFile();
    if (!file) return false;
    if (!checking) void this.runExport(file.path, format, this.settings.defaultTemplate);
    return true;
  }

  private activeMarkdownFile(): TFile | null {
    const file = this.app.workspace.getActiveFile();
    return file && file.extension === "md" ? file : null;
  }

  private openExportModal(file: TFile): void {
    const source: ExportSource = { path: file.path, name: file.basename };
    new ExportModal(this.app, this, source).open();
  }

  private requireProNotice(feature: string): void {
    new Notice(`${feature} requires TrueExport Pro. Learn more at ${PRO_URL}`);
  }

  private writer(): VaultWriter {
    const vault = this.app.vault;
    return {
      exists: (path) => vault.getAbstractFileByPath(path) !== null,
      writeText: async (path, data) => {
        await vault.create(path, data);
      },
      writeBinary: async (path, data) => {
        await vault.createBinary(path, data);
      },
    };
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
