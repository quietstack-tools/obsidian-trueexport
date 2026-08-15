import { describe, it, expect, vi } from "vitest";
import { App } from "obsidian";
import { TrueExportSettingTab, type SettingsHost } from "../../../src/ui/settings-tab";
import { DEFAULT_SETTINGS } from "../../../src/ui/settings";

function makeTab() {
  const host = {
    settings: { ...DEFAULT_SETTINGS },
    saveSettings: vi.fn(async () => {}),
    manifest: { version: "1.2.3" },
  } as unknown as SettingsHost & { manifest: { version: string }; saveSettings: ReturnType<typeof vi.fn> };
  // The mock PluginSettingTab constructor accepts any plugin-like object.
  const tab = new TrueExportSettingTab(new App(), host as never);
  return { tab, host };
}

describe("TrueExportSettingTab", () => {
  it("renders all setting sections", () => {
    const { tab } = makeTab();
    tab.display();
    const headings = Array.from(tab.containerEl.querySelectorAll(".setting-item-heading .setting-item-name")).map(
      (el) => el.textContent,
    );
    expect(headings).toEqual(["General", "Word", "PDF", "HTML", "Advanced", "Licence", "About"]);
  });

  it("shows the plugin version in the About section", () => {
    const { tab } = makeTab();
    tab.display();
    expect(tab.containerEl.textContent).toContain("Version 1.2.3");
  });

  it("persists a change made through a dropdown", () => {
    const { tab, host } = makeTab();
    tab.display();
    // The first <select> is the default-format dropdown.
    const select = tab.containerEl.querySelector("select") as HTMLSelectElement;
    select.value = "html";
    select.dispatchEvent(new Event("change"));
    expect(host.settings.defaultFormat).toBe("html");
    expect(host.saveSettings).toHaveBeenCalled();
  });
});
