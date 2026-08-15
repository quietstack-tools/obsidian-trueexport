import { describe, it, expect } from "vitest";
import { exportNote, exportFolder, type VaultWriter } from "../../src/export";
import { DEFAULT_SETTINGS } from "../../src/ui/settings";
import { MemoryVaultAdapter } from "../helpers/memory-adapter";
import { pngBytes } from "../helpers/render-docx";

// Real budgets from §7.3. These measure the JS pipeline (parse → resolve →
// render → serialise); they can't measure Word/PDF opening. Timing varies by
// machine, so budgets have generous headroom by design.

class NullWriter implements VaultWriter {
  count = 0;
  exists() {
    return false;
  }
  async writeText() {
    this.count++;
  }
  async writeBinary() {
    this.count++;
  }
}

function words(n: number): string {
  return "# Heading\n\n" + Array.from({ length: n }, (_, i) => `word${i}`).join(" ") + "\n";
}

const settings = () => ({ ...DEFAULT_SETTINGS });

async function timeExport(source: string, notes: Record<string, string>, binaries = {}): Promise<number> {
  const adapter = new MemoryVaultAdapter({ notes, binaries });
  const t0 = performance.now();
  await exportNote({
    adapter,
    writer: new NullWriter(),
    settings: settings(),
    sourcePath: Object.keys(notes)[0],
    format: "docx",
    template: "default",
  });
  return performance.now() - t0;
}

describe("performance budgets (§7.3)", () => {
  it("1,000-word note → DOCX in < 500ms", async () => {
    const ms = await timeExport(words(1000), { "N.md": words(1000) });
    expect(ms).toBeLessThan(500);
  });

  it("10,000-word note → DOCX in < 3s", async () => {
    const ms = await timeExport(words(10000), { "N.md": words(10000) });
    expect(ms).toBeLessThan(3000);
  });

  it("note with 20 images → DOCX in < 5s", async () => {
    const body = "# Images\n\n" + Array.from({ length: 20 }, (_, i) => `![img${i}](pic${i}.png)`).join("\n\n");
    const binaries: Record<string, ArrayBuffer> = {};
    for (let i = 0; i < 20; i++) binaries[`pic${i}.png`] = pngBytes();
    const ms = await timeExport(body, { "N.md": body }, binaries);
    expect(ms).toBeLessThan(5000);
  });

  it("100-note folder batch → DOCX in < 60s", async () => {
    const notes: Record<string, string> = {};
    for (let i = 0; i < 100; i++) notes[`folder/note-${i}.md`] = words(300);
    const adapter = new MemoryVaultAdapter({ notes });
    const t0 = performance.now();
    const result = await exportFolder({
      adapter,
      writer: new NullWriter(),
      settings: settings(),
      folderPath: "folder",
      format: "docx",
      template: "default",
    });
    const ms = performance.now() - t0;
    expect(result.outputs).toHaveLength(100);
    expect(ms).toBeLessThan(60000);
  });
});
