import { describe, it, expect, beforeEach } from "vitest";
import { App, Platform } from "obsidian";
import TrueExportPlugin from "../../main";

function makePlugin(): TrueExportPlugin {
  return new (TrueExportPlugin as unknown as new (app: App, manifest: unknown) => TrueExportPlugin)(
    new App(),
    { version: "1.0.0" },
  );
}

beforeEach(() => {
  Platform.isMobile = false;
});

describe("TrueExportPlugin.onload", () => {
  it("registers all five commands", async () => {
    const plugin = makePlugin();
    await plugin.onload();
    const ids = (plugin as unknown as { commands: { id: string }[] }).commands.map((c) => c.id);
    expect(ids).toEqual(["export-docx", "export-pdf", "export-html", "export-dialog", "export-folder"]);
  });

  it("adds a settings tab and a file-menu handler", async () => {
    const plugin = makePlugin();
    await plugin.onload();
    const p = plugin as unknown as { settingTabs: unknown[]; events: unknown[] };
    expect(p.settingTabs.length).toBe(1);
    expect(p.events.length).toBeGreaterThanOrEqual(1);
  });

  it("adds the ribbon icon only when the setting is on", async () => {
    const on = makePlugin();
    await on.onload();
    expect((on as unknown as { ribbons: unknown[] }).ribbons.length).toBe(1);

    const off = makePlugin();
    await off.saveData({ showRibbonIcon: false });
    await off.onload();
    expect((off as unknown as { ribbons: unknown[] }).ribbons.length).toBe(0);
  });

  it("merges saved settings over defaults", async () => {
    const plugin = makePlugin();
    await plugin.onload();
    expect(plugin.settings.transclusionDepth).toBe(5);
    expect(plugin.settings.defaultFormat).toBe("docx");
  });

  it("hides the PDF command on mobile, shows it on desktop", async () => {
    const plugin = makePlugin();
    (plugin.app.workspace as unknown as { activeFile: unknown }).activeFile = {
      path: "Note.md",
      extension: "md",
      basename: "Note",
    };
    await plugin.onload();
    const pdf = (plugin as unknown as { commands: { id: string; checkCallback: (c: boolean) => boolean }[] }).commands.find(
      (c) => c.id === "export-pdf",
    )!;
    expect(pdf.checkCallback(true)).toBe(true);
    Platform.isMobile = true;
    expect(pdf.checkCallback(true)).toBe(false);
  });

  it("unloads without throwing", async () => {
    const plugin = makePlugin();
    await plugin.onload();
    expect(() => plugin.onunload()).not.toThrow();
  });
});
