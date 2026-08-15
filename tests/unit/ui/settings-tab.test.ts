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

  it("rejects an invalid PDF margin and snaps the field back to the stored value", () => {
    const { tab, host } = makeTab();
    tab.display();
    const items = Array.from(tab.containerEl.querySelectorAll(".setting-item"));
    const marginsItem = items.find(
      (el) => el.querySelector(".setting-item-name")?.textContent === "Margins (inches)",
    )!;
    const input = marginsItem.querySelector("input") as HTMLInputElement;

    input.value = "-1";
    input.dispatchEvent(new Event("input"));

    expect(host.settings.pdfMargins).toBe(1); // never stored
    expect(input.value).toBe("1"); // field snapped back, no visible divergence
  });
});
