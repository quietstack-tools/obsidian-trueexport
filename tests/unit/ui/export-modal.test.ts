import { describe, it, expect, vi } from "vitest";
import { App } from "obsidian";
import { ExportModal, type ExportModalHost } from "../../../src/ui/export-modal";
import { DEFAULT_SETTINGS } from "../../../src/ui/settings";
import type { ExportWarning } from "../../../src/core/warnings";

function makeHost(overrides: Partial<ExportModalHost> = {}): ExportModalHost {
  return {
    settings: { ...DEFAULT_SETTINGS },
    isMobile: false,
    isPro: false,
    saveSettings: vi.fn(async () => {}),
    scan: vi.fn(async () => [] as ExportWarning[]),
    runExport: vi.fn(async () => {}),
    ...overrides,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const source = { path: "folder/Note.md", name: "Note" };

describe("ExportModal", () => {
  it("shows one radio per available format on desktop", () => {
    const modal = new ExportModal(new App(), makeHost(), source);
    modal.onOpen();
    const radios = modal.contentEl.querySelectorAll('input[type="radio"]');
    expect(radios.length).toBe(3);
  });

  it("hides the PDF option on mobile", () => {
    const modal = new ExportModal(new App(), makeHost({ isMobile: true }), source);
    modal.onOpen();
    const values = Array.from(modal.contentEl.querySelectorAll('input[type="radio"]')).map((r) => r.getAttribute("value"));
    expect(values).toEqual(["docx", "html"]);
  });

  it("shows the custom (Pro) template but disabled for free users, with a Learn more link", () => {
    const modal = new ExportModal(new App(), makeHost({ isPro: false }), source);
    modal.onOpen();
    const custom = modal.contentEl.querySelector('option[value="custom"]') as HTMLOptionElement;
    expect(custom).not.toBeNull();
    expect(custom.disabled).toBe(true);
    const link = modal.contentEl.querySelector('a[href*="quietstack.tools"]');
    expect(link).not.toBeNull();
  });

  it("enables the custom template for Pro users", () => {
    const modal = new ExportModal(new App(), makeHost({ isPro: true }), source);
    modal.onOpen();
    const custom = modal.contentEl.querySelector('option[value="custom"]') as HTMLOptionElement;
    expect(custom.disabled).toBe(false);
  });

  it("remembers the last-used format when reopening", () => {
    const host = makeHost({ settings: { ...DEFAULT_SETTINGS, lastFormat: "html" } });
    const modal = new ExportModal(new App(), host, source);
    modal.onOpen();
    const checked = modal.contentEl.querySelector('input[type="radio"]:checked') as HTMLInputElement;
    expect(checked.getAttribute("value")).toBe("html");
  });

  it("updates last format and re-scans when a format is chosen", async () => {
    const host = makeHost();
    const modal = new ExportModal(new App(), host, source);
    modal.onOpen();
    const htmlRadio = modal.contentEl.querySelector('input[value="html"]') as HTMLInputElement;
    htmlRadio.dispatchEvent(new Event("change"));
    expect(host.settings.lastFormat).toBe("html");
    expect(host.saveSettings).toHaveBeenCalled();
  });

  it("runs the export when the Export button is clicked", () => {
    const host = makeHost();
    const modal = new ExportModal(new App(), host, source);
    modal.onOpen();
    const exportBtn = Array.from(modal.contentEl.querySelectorAll("button")).find((b) => b.textContent === "Export")!;
    exportBtn.click();
    expect(host.runExport).toHaveBeenCalledWith("folder/Note.md", "docx", "default");
  });

  it("shows a clickable warnings row only when the pre-scan finds issues", async () => {
    const withIssues = makeHost({
      scan: vi.fn(
        async (): Promise<ExportWarning[]> => [
          { construct: "image", message: "Image not found: x.png", line: 3, sourcePath: "folder/Note.md" },
        ],
      ),
    });
    const modal = new ExportModal(new App(), withIssues, source);
    modal.onOpen();
    await flush();
    const row = modal.contentEl.querySelector(".trueexport-warnings-row") as HTMLElement;
    expect(row.style.display).not.toBe("none");
    expect(row.textContent).toContain("need attention");
  });

  it("keeps the warnings row hidden when the pre-scan is clean", async () => {
    const modal = new ExportModal(new App(), makeHost(), source);
    modal.onOpen();
    await flush();
    const row = modal.contentEl.querySelector(".trueexport-warnings-row") as HTMLElement;
    expect(row.style.display).toBe("none");
  });
});
