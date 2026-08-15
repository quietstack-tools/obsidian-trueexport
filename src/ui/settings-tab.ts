// src/ui/settings-tab.ts
//
// The settings tab (§6.4): General, Word, PDF, HTML, Advanced, Licence and
// About. Licence fields exist here but activation logic lands in Stage 8.

import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { ImageDpi, PageSize } from "../core/options";
import type { TrueExportSettings } from "./settings";
import { PRO_URL } from "./export-modal";

export interface SettingsHost {
  settings: TrueExportSettings;
  saveSettings(): Promise<void>;
}

const PAGE_SIZES: Record<PageSize, string> = { A4: "A4", Letter: "Letter", Legal: "Legal" };

export class TrueExportSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly host: Plugin & SettingsHost,
  ) {
    super(app, host);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.host.settings;
    const save = (): void => void this.host.saveSettings();

    // General
    new Setting(containerEl).setName("General").setHeading();
    new Setting(containerEl)
      .setName("Default format")
      .setDesc("Format selected first in the export dialog.")
      .addDropdown((dd) =>
        dd
          .addOptions({ docx: "Word (.docx)", pdf: "PDF", html: "HTML" })
          .setValue(s.defaultFormat)
          .onChange((v) => {
            s.defaultFormat = v as typeof s.defaultFormat;
            save();
          }),
      );
    new Setting(containerEl).setName("Default template").addDropdown((dd) =>
      dd
        .addOptions({ default: "Default", professional: "Professional", academic: "Academic", minimal: "Minimal" })
        .setValue(String(s.defaultTemplate))
        .onChange((v) => {
          s.defaultTemplate = v;
          save();
        }),
    );
    new Setting(containerEl).setName("Output location").addDropdown((dd) =>
      dd
        .addOptions({ "same-folder": "Same folder as note", "vault-root": "Vault root", custom: "Custom folder" })
        .setValue(s.outputLocation)
        .onChange((v) => {
          s.outputLocation = v as typeof s.outputLocation;
          save();
        }),
    );
    new Setting(containerEl)
      .setName("Custom output folder")
      .setDesc("Used when output location is “Custom folder”.")
      .addText((t) =>
        t.setPlaceholder("Exports").setValue(s.customOutputFolder).onChange((v) => {
          s.customOutputFolder = v;
          save();
        }),
      );
    new Setting(containerEl)
      .setName("Filename pattern")
      .setDesc("Placeholders: {{title}}, {{date}}, {{time}}.")
      .addText((t) =>
        t.setValue(s.filenamePattern).onChange((v) => {
          s.filenamePattern = v;
          save();
        }),
      );
    new Setting(containerEl).setName("Show ribbon icon").addToggle((tg) =>
      tg.setValue(s.showRibbonIcon).onChange((v) => {
        s.showRibbonIcon = v;
        save();
      }),
    );

    // Word
    new Setting(containerEl).setName("Word").setHeading();
    new Setting(containerEl).setName("Page size").addDropdown((dd) =>
      dd
        .addOptions(PAGE_SIZES)
        .setValue(s.wordPageSize)
        .onChange((v) => {
          s.wordPageSize = v as PageSize;
          save();
        }),
    );
    new Setting(containerEl).setName("Frontmatter handling").addDropdown((dd) =>
      dd
        .addOptions({ strip: "Remove", metadata: "Document properties", table: "Table at top" })
        .setValue(s.frontmatterMode)
        .onChange((v) => {
          s.frontmatterMode = v as typeof s.frontmatterMode;
          save();
        }),
    );
    new Setting(containerEl).setName("Embed fonts").addToggle((tg) =>
      tg.setValue(s.embedFonts).onChange((v) => {
        s.embedFonts = v;
        save();
      }),
    );

    // PDF
    new Setting(containerEl).setName("PDF").setHeading();
    new Setting(containerEl).setName("Page size").addDropdown((dd) =>
      dd
        .addOptions(PAGE_SIZES)
        .setValue(s.pdfPageSize)
        .onChange((v) => {
          s.pdfPageSize = v as PageSize;
          save();
        }),
    );
    new Setting(containerEl).setName("Orientation").addDropdown((dd) =>
      dd
        .addOptions({ portrait: "Portrait", landscape: "Landscape" })
        .setValue(s.pdfOrientation)
        .onChange((v) => {
          s.pdfOrientation = v as typeof s.pdfOrientation;
          save();
        }),
    );
    new Setting(containerEl).setName("Page numbers").addToggle((tg) =>
      tg.setValue(s.pdfPageNumbers).onChange((v) => {
        s.pdfPageNumbers = v;
        save();
      }),
    );
    new Setting(containerEl)
      .setName("Margins (inches)")
      .addText((t) =>
        t.setValue(String(s.pdfMargins)).onChange((v) => {
          const n = Number(v);
          if (!Number.isNaN(n) && n >= 0) s.pdfMargins = n;
          save();
        }),
      );

    // HTML
    new Setting(containerEl).setName("HTML").setHeading();
    new Setting(containerEl).setName("Dark mode support").addToggle((tg) =>
      tg.setValue(s.htmlDarkMode).onChange((v) => {
        s.htmlDarkMode = v;
        save();
      }),
    );
    new Setting(containerEl).setName("Max content width (rem)").addText((t) =>
      t.setValue(String(s.htmlMaxWidth)).onChange((v) => {
        const n = Number(v);
        if (!Number.isNaN(n) && n > 0) s.htmlMaxWidth = n;
        save();
      }),
    );

    // Advanced
    new Setting(containerEl).setName("Advanced").setHeading();
    new Setting(containerEl).setName("Image quality (DPI)").addDropdown((dd) =>
      dd
        .addOptions({ "72": "72", "150": "150", "300": "300" })
        .setValue(String(s.imageDpi))
        .onChange((v) => {
          s.imageDpi = Number(v) as ImageDpi;
          save();
        }),
    );
    new Setting(containerEl).setName("Max image width (px)").addText((t) =>
      t.setValue(String(s.maxImageWidthPx)).onChange((v) => {
        const n = Number(v);
        if (!Number.isNaN(n) && n > 0) s.maxImageWidthPx = n;
        save();
      }),
    );
    new Setting(containerEl)
      .setName("Allow remote images")
      .setDesc("When enabled, the plugin fetches external image URLs while exporting.")
      .addToggle((tg) =>
        tg.setValue(s.allowRemoteImages).onChange((v) => {
          s.allowRemoteImages = v;
          save();
        }),
      );
    new Setting(containerEl).setName("Transclusion depth").addText((t) =>
      t.setValue(String(s.transclusionDepth)).onChange((v) => {
        const n = Number(v);
        if (Number.isInteger(n) && n > 0) s.transclusionDepth = n;
        save();
      }),
    );

    // Licence (fields only; activation is Stage 8)
    new Setting(containerEl).setName("Licence").setHeading();
    new Setting(containerEl)
      .setName("Licence key")
      .setDesc(s.licenceActivated ? "Pro is active." : "Enter your TrueExport Pro key.")
      .addText((t) =>
        t.setValue(s.licenceKey).onChange((v) => {
          s.licenceKey = v;
          save();
        }),
      );
    new Setting(containerEl)
      .setName("Get TrueExport Pro")
      .addButton((b) =>
        b.setButtonText("Learn more").onClick(() => {
          window.open(PRO_URL, "_blank");
        }),
      );

    // About
    new Setting(containerEl).setName("About").setHeading();
    new Setting(containerEl)
      .setName("TrueExport")
      .setDesc(`Version ${this.host.manifest.version}`)
      .addButton((b) => b.setButtonText("Docs").onClick(() => window.open(PRO_URL, "_blank")));
  }
}
