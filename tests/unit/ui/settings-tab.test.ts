import { describe, it, expect, vi } from "vitest";
import { App } from "obsidian";
import { TrueExportSettingTab, type SettingsHost } from "../../../src/ui/settings-tab";
import { DEFAULT_SETTINGS } from "../../../src/ui/settings";

function makeTab(activated = false) {
  const licence = {
    isActivated: activated,
    deviceLimit: activated ? 2 : 0,
    activate: vi.fn(async () => ({ activated: true, message: "TrueExport Pro activated. Thank you!" })),
    deactivate: vi.fn(async () => {}),
  };
  const host = {
    settings: { ...DEFAULT_SETTINGS },
    saveSettings: vi.fn(async () => {}),
    manifest: { version: "1.2.3" },
    licence,
  } as unknown as SettingsHost & {
    manifest: { version: string };
    saveSettings: ReturnType<typeof vi.fn>;
    licence: typeof licence;
  };
  // The mock PluginSettingTab constructor accepts any plugin-like object.
  const tab = new TrueExportSettingTab(new App(), host as never);
  return { tab, host, licence };
}

function findSetting(tab: TrueExportSettingTab, name: string): Element {
  return Array.from(tab.containerEl.querySelectorAll(".setting-item")).find(
    (el) => el.querySelector(".setting-item-name")?.textContent === name,
  )!;
}

function hasSetting(tab: TrueExportSettingTab, name: string): boolean {
  return Array.from(tab.containerEl.querySelectorAll(".setting-item")).some(
    (el) => el.querySelector(".setting-item-name")?.textContent === name,
  );
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

  function fieldInput(tab: TrueExportSettingTab, name: string): HTMLInputElement {
    const item = Array.from(tab.containerEl.querySelectorAll(".setting-item")).find(
      (el) => el.querySelector(".setting-item-name")?.textContent === name,
    )!;
    return item.querySelector("input") as HTMLInputElement;
  }

  it.each([
    ["Margins (inches)", "pdfMargins", 1, "-1"],
    ["Max content width (rem)", "htmlMaxWidth", 45, "abc"],
    ["Max image width (px)", "maxImageWidthPx", 1200, "-5"],
    ["Transclusion depth", "transclusionDepth", 5, "2.5"],
  ] as const)(
    "rejects invalid input for %s and snaps the field back to the stored value",
    (name, key, defaultValue, invalid) => {
      const { tab, host } = makeTab();
      tab.display();
      const input = fieldInput(tab, name);

      input.value = invalid;
      input.dispatchEvent(new Event("input"));

      expect(host.settings[key]).toBe(defaultValue); // never stored
      expect(input.value).toBe(String(defaultValue)); // field snapped back
    },
  );

  it("still persists a valid numeric change", () => {
    const { tab, host } = makeTab();
    tab.display();
    const input = fieldInput(tab, "Transclusion depth");
    input.value = "3";
    input.dispatchEvent(new Event("input"));
    expect(host.settings.transclusionDepth).toBe(3);
    expect(host.saveSettings).toHaveBeenCalled();
  });
});

describe("TrueExportSettingTab — licence + Pro gating", () => {
  it("shows Activate and disables the reference-DOCX field when not activated", () => {
    const { tab } = makeTab(false);
    tab.display();
    const buttons = Array.from(tab.containerEl.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons).toContain("Activate");
    const refInput = findSetting(tab, "Reference DOCX (house style)").querySelector("input") as HTMLInputElement;
    expect(refInput.disabled).toBe(true);
  });

  it("shows Deactivate, device limit, and enables reference-DOCX when activated", () => {
    const { tab } = makeTab(true);
    tab.display();
    const buttons = Array.from(tab.containerEl.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons).toContain("Deactivate");
    expect(findSetting(tab, "Licence key").textContent).toContain("up to 2 device(s)");
    const refInput = findSetting(tab, "Reference DOCX (house style)").querySelector("input") as HTMLInputElement;
    expect(refInput.disabled).toBe(false);
  });

  it("calls licence.activate when Activate is clicked", () => {
    const { tab, host, licence } = makeTab(false);
    host.settings.licenceKey = "MY-KEY";
    tab.display();
    const activateBtn = Array.from(tab.containerEl.querySelectorAll("button")).find(
      (b) => b.textContent === "Activate",
    )!;
    activateBtn.click();
    expect(licence.activate).toHaveBeenCalledWith("MY-KEY");
  });

  it("shows the 'Get TrueExport Pro' upsell only when not activated", () => {
    const free = makeTab(false);
    free.tab.display();
    expect(hasSetting(free.tab, "Get TrueExport Pro")).toBe(true);
    expect(hasSetting(free.tab, "Manage licence")).toBe(false);
  });

  it("shows 'Manage licence' (not the upsell) when activated", () => {
    const pro = makeTab(true);
    pro.tab.display();
    expect(hasSetting(pro.tab, "Manage licence")).toBe(true);
    expect(hasSetting(pro.tab, "Get TrueExport Pro")).toBe(false);
    const portalLink = Array.from(pro.tab.containerEl.querySelectorAll("button")).find(
      (b) => b.textContent === "Open portal",
    );
    expect(portalLink).toBeDefined();
  });
});
