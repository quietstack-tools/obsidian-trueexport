import { Plugin, Notice } from "obsidian";

export default class TrueExportPlugin extends Plugin {
  async onload() {
    console.log("TrueExport: loaded");
    this.addCommand({
      id: "trueexport-smoke-test",
      name: "Smoke test",
      callback: () => {
        new Notice("TrueExport is alive!");
      },
    });
  }

  onunload() {
    console.log("TrueExport: unloaded");
  }
}
