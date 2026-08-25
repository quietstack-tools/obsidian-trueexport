// main.ts — TrueExport plugin entry point.
//
// Wires commands, menu items, the ribbon icon and the settings tab to the
// export pipeline. All registrations use Obsidian's auto-cleaned APIs
// (addCommand / registerEvent / addRibbonIcon / addSettingTab), so onunload has
// nothing to leak (§10).

import { Notice, Plugin, Platform, TFile, TFolder, type Menu } from "obsidian";
import {
  ObsidianVaultAdapter,
  createMermaidRenderer,
  createRemoteImageFetcher,
  createHtmlSanitizer,
} from "./src/obsidian-adapter";
import { createElectronHtmlToPdf } from "./src/pdf/electron";
import { createElectronSvgRasterizer } from "./src/svg-rasterizer-electron";
import { createFsWriter } from "./src/fs-writer";
import type { VaultAdapter } from "./src/core/adapter";
import type { ExportFormat, TemplateId } from "./src/core/options";
import type { ExportWarning } from "./src/core/warnings";
import {
  exportNote,
  exportFolder,
  scanNote,
  basename,
  isAbsoluteOutputPath,
  friendlyErrorMessage,
  type BatchResult,
  type ExportDeps,
  type VaultWriter,
} from "./src/export";
import {
  DEFAULT_SETTINGS,
  type TrueExportSettings,
} from "./src/ui/settings";
import { LicenceManager } from "./src/licence";
import { ExportModal, type ExportModalHost, type ExportSource } from "./src/ui/export-modal";
import { BatchModal, type BatchModalHost } from "./src/ui/batch-modal";
import { TrueExportSettingTab } from "./src/ui/settings-tab";
import { WarningsModal } from "./src/ui/warnings-view";

const PRO_URL = "https://quietstack.tools/trueexport";

export default class TrueExportPlugin extends Plugin implements ExportModalHost, BatchModalHost {
  settings: TrueExportSettings = { ...DEFAULT_SETTINGS };
  licence!: LicenceManager;
  private adapter!: VaultAdapter;
  private deps!: ExportDeps;
  private ribbonIconEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.licence = new LicenceManager(this);
    this.adapter = new ObsidianVaultAdapter(this.app);
    this.deps = {
      mermaidToSvg: createMermaidRenderer(this.app),
      // The remote-image fetch capability. It only ever runs when the user has
      // enabled the default-off "Allow remote images" setting (§7.6).
      fetchRemoteImage: createRemoteImageFetcher(),
      // DOM-based sanitiser for raw HTML blocks (defence-in-depth over the
      // renderer's regex baseline and the document CSP).
      sanitizeHtml: createHtmlSanitizer(),
      // PDF and SVG rasterisation are both desktop-only: they need Electron's
      // BrowserWindow (§7.5). Canvas-based rasterisation (drawImage +
      // getImageData/toBlob) was tried first and rejected — it throws a
      // "tainted canvas" SecurityError for any SVG containing <foreignObject>
      // HTML content, which is how Mermaid renders diagram labels by
      // default, so every real Mermaid diagram hit it. The Electron seam
      // captures a real off-screen page render instead, which has no such
      // restriction — see src/svg-rasterizer-electron.ts.
      ...(Platform.isDesktop
        ? { htmlToPdf: createElectronHtmlToPdf(), rasterizeSvg: createElectronSvgRasterizer() }
        : {}),
    };

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
        const folder = this.activeFolder();
        if (!folder) return false;
        if (!checking) this.startFolderExport(folder.path, folder.name);
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
              .onClick(() => this.startFolderExport(file.path, file.name || "vault")),
          );
        }
      }),
    );

    this.updateRibbonIcon();

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
      new Notice(`Export failed: ${friendlyErrorMessage(error)}`);
    }
  }

  // ---- BatchModalHost ----

  async runFolderExport(
    folderPath: string,
    onProgress: (done: number, total: number) => void,
    signal: AbortSignal,
  ): Promise<BatchResult> {
    return exportFolder({
      adapter: this.adapter,
      writer: this.writer(),
      settings: this.settings,
      folderPath,
      format: this.settings.defaultFormat,
      template: this.settings.defaultTemplate,
      deps: this.deps,
      onProgress,
      signal,
    });
  }

  /**
   * Adds or removes the ribbon icon to match the current "Show ribbon icon"
   * setting — called on load and again from the settings tab whenever the
   * toggle changes, so it takes effect immediately without an Obsidian
   * restart. Obsidian has no removeRibbonIcon(); the documented pattern is
   * calling .remove() on the element addRibbonIcon() returned.
   */
  updateRibbonIcon(): void {
    if (this.settings.showRibbonIcon) {
      if (!this.ribbonIconEl) {
        this.ribbonIconEl = this.addRibbonIcon("file-output", "Export with TrueExport", () => {
          const file = this.activeMarkdownFile();
          if (file) this.openExportModal(file);
          else new Notice("Open a note to export it.");
        });
      }
    } else if (this.ribbonIconEl) {
      this.ribbonIconEl.remove();
      this.ribbonIconEl = null;
    }
  }

  // ---- helpers ----

  private activeFolder(): { path: string; name: string } | null {
    const parent = this.app.workspace.getActiveFile()?.parent;
    return parent ? { path: parent.path, name: parent.name || "vault" } : null;
  }

  private startFolderExport(folderPath: string, folderName: string): void {
    if (!this.isPro) {
      this.requireProNotice("Folder export");
      return;
    }
    new BatchModal(this.app, this, folderPath, folderName).open();
  }

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

  /**
   * The vault-backed writer, used for every export except one. Never swap
   * this out anywhere but `writer()` below — it's the only place the
   * fs-backed exception (custom desktop destination) is decided.
   */
  private vaultWriter(): VaultWriter {
    const vault = this.app.vault;
    return {
      exists: (path) => vault.getAbstractFileByPath(path) !== null,
      writeText: async (path, data) => {
        await vault.create(path, data);
      },
      writeBinary: async (path, data) => {
        await vault.createBinary(path, data);
      },
      createFolder: async (path) => {
        try {
          await vault.createFolder(path);
        } catch {
          // Folder already exists (or a race created it) — safe to ignore. A
          // genuine write failure still surfaces from writeText/writeBinary.
        }
      },
    };
  }

  /**
   * The one documented exception to "never write outside the vault"
   * (CLAUDE.md): a custom export destination the user picked via the native
   * OS folder dialog (desktop only — settings-tab.ts never lets mobile store
   * an absolute path). Falls back to the vault-backed writer only when the
   * stored value isn't even a real absolute path (e.g. mobile, or an empty
   * setting). If the folder itself no longer exists — moved, deleted, an
   * unmounted external drive — we do NOT silently reroute the export into
   * the vault (§D20): createFsWriter recreates the missing directory at
   * write time, and a genuine failure to do so surfaces as an honest error
   * instead of a false "exported" success somewhere the user isn't looking.
   */
  private writer(): VaultWriter {
    const { outputLocation, customOutputFolder } = this.settings;
    if (Platform.isDesktop && outputLocation === "custom" && isAbsoluteOutputPath(customOutputFolder)) {
      return createFsWriter(customOutputFolder);
    }
    return this.vaultWriter();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
