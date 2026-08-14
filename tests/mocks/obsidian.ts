// Minimal stand-in for the Obsidian API so tests can run outside the app.
// Extend this as more API surface is used later.

export class Plugin {
  app: any;
  manifest: any;
  addCommand() {}
  addRibbonIcon() { return document.createElement("div"); }
  addSettingTab() {}
  registerEvent() {}
  async loadData() { return {}; }
  async saveData(_: any) {}
}

export class Modal {
  app: any;
  contentEl: HTMLElement = document.createElement("div");
  constructor(app?: any) { this.app = app; }
  open() {}
  close() {}
  onOpen() {}
  onClose() {}
}

export class Notice {
  constructor(public message: string, public timeout?: number) {}
}

export class TFile {
  path = "";
  name = "";
  basename = "";
  extension = "md";
}

export class TFolder {
  path = "";
  name = "";
  children: any[] = [];
}

export class PluginSettingTab {
  app: any;
  containerEl: HTMLElement = document.createElement("div");
  display() {}
}

export class Setting {
  constructor(public containerEl: HTMLElement) {}
  setName() { return this; }
  setDesc() { return this; }
  addText() { return this; }
  addToggle() { return this; }
  addDropdown() { return this; }
  addButton() { return this; }
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export const Platform = {
  isMobile: false,
  isDesktop: true,
  isIosApp: false,
  isAndroidApp: false,
};
