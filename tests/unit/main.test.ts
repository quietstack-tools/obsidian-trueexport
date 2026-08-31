import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { App, Platform, Modal } from "obsidian";
import { noticeLog } from "../mocks/obsidian";
import TrueExportPlugin from "../../main";

function makePlugin(): TrueExportPlugin {
  return new (TrueExportPlugin as unknown as new (app: App, manifest: unknown) => TrueExportPlugin)(
    new App(),
    { version: "1.0.0" },
  );
}

beforeEach(() => {
  Platform.isMobile = false;
  Platform.isDesktop = true;
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

  it("adds/removes the ribbon icon live when the setting is toggled at runtime (no restart needed)", async () => {
    const plugin = makePlugin();
    await plugin.onload();
    const ribbons = (plugin as unknown as { ribbons: unknown[] }).ribbons;
    expect(ribbons.length).toBe(1);

    plugin.settings.showRibbonIcon = false;
    plugin.updateRibbonIcon();
    expect(ribbons.length).toBe(0);

    plugin.settings.showRibbonIcon = true;
    plugin.updateRibbonIcon();
    expect(ribbons.length).toBe(1);

    // Calling it again while already in the desired state doesn't duplicate/leak.
    plugin.updateRibbonIcon();
    expect(ribbons.length).toBe(1);
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

  it("writes to a real filesystem folder when a valid custom desktop destination is set", async () => {
    Platform.isMobile = false;
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trueexport-fswriter-"));
    try {
      const plugin = makePlugin();
      await plugin.onload();
      plugin.settings.outputLocation = "custom";
      plugin.settings.customOutputFolder = tmpRoot;
      plugin.settings.filenamePattern = "Note";
      (plugin.app.vault as unknown as { notes: Map<string, string> }).notes.set("Note.md", "# Hi\n\nBody");
      (plugin.app.workspace as unknown as { activeFile: unknown }).activeFile = {
        path: "Note.md",
        extension: "md",
        basename: "Note",
      };

      await plugin.runExport("Note.md", "html", "default");

      // Landed on real disk at the chosen folder, not in the mock vault.
      expect(fs.existsSync(path.join(tmpRoot, "Note.html"))).toBe(true);
      expect((plugin.app.vault as unknown as { created: Map<string, unknown> }).created.size).toBe(0);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("falls back to the vault-confined writer on mobile even if an absolute custom folder is stored", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trueexport-fswriter-mobile-"));
    try {
      const plugin = makePlugin();
      await plugin.onload();
      plugin.settings.outputLocation = "custom";
      plugin.settings.customOutputFolder = tmpRoot;
      plugin.settings.filenamePattern = "Note";
      (plugin.app.vault as unknown as { notes: Map<string, string> }).notes.set("Note.md", "# Hi\n\nBody");
      (plugin.app.workspace as unknown as { activeFile: unknown }).activeFile = {
        path: "Note.md",
        extension: "md",
        basename: "Note",
      };
      Platform.isMobile = true;
      Platform.isDesktop = false;

      await plugin.runExport("Note.md", "html", "default");

      // Never touched the real folder on disk — confined to the mock vault
      // instead (outputFolder() treats "custom" without a usable fs writer as
      // vault root, same as an empty custom folder).
      expect(fs.existsSync(path.join(tmpRoot, "Note.html"))).toBe(false);
      expect((plugin.app.vault as unknown as { created: Map<string, unknown> }).created.has("Note.html")).toBe(true);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("shows a persistent, clickable Pro-upsell modal (not an unclickable transient Notice) for folder export", async () => {
    const opened: InstanceType<typeof Modal>[] = [];
    const originalOpen = Modal.prototype.open;
    const openSpy = vi.spyOn(Modal.prototype, "open").mockImplementation(function (this: InstanceType<typeof Modal>) {
      opened.push(this);
      return originalOpen.call(this);
    });
    try {
      const plugin = makePlugin();
      await plugin.onload();
      (plugin.app.workspace as unknown as { activeFile: unknown }).activeFile = {
        path: "Folder/Note.md",
        extension: "md",
        basename: "Note",
        parent: { path: "Folder", name: "Folder" },
      };

      const noticesBefore = noticeLog.length;
      const cmd = (
        plugin as unknown as { commands: { id: string; checkCallback: (c: boolean) => boolean }[] }
      ).commands.find((c) => c.id === "export-folder")!;
      expect(cmd.checkCallback(true)).toBe(true);
      cmd.checkCallback(false);

      // No transient Notice was used for the upsell — a modal was opened instead.
      expect(noticeLog.length).toBe(noticesBefore);
      const upsell = opened.find((m) => m.constructor.name === "ProRequiredModal") as unknown as
        | { contentEl: HTMLElement; isOpen: boolean }
        | undefined;
      expect(upsell).toBeDefined();

      // The modal carries a REAL, clickable hyperlink, not just text mentioning a URL.
      const link = upsell!.contentEl.querySelector("a");
      expect(link).not.toBeNull();
      expect(link!.getAttribute("href")).toBe("https://quietstack.tools/trueexport");
      expect(link!.textContent).toBe("Learn more");

      // It stays open until the user dismisses it (no auto-dismiss timer).
      expect(upsell!.isOpen).toBe(true);
    } finally {
      openSpy.mockRestore();
    }
  });

  it("never performs a network call on load (licence is validated only on Activate)", async () => {
    const realFetch = globalThis.fetch;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const plugin = makePlugin();
      await plugin.onload();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
