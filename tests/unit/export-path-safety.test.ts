import { describe, it, expect } from "vitest";
import { exportNote, type VaultWriter } from "../../src/export";
import { DEFAULT_SETTINGS, type TrueExportSettings } from "../../src/ui/settings";
import { MemoryVaultAdapter } from "../helpers/memory-adapter";

class FakeWriter implements VaultWriter {
  files = new Map<string, string | ArrayBuffer>();
  exists(path: string): boolean {
    return this.files.has(path);
  }
  async writeText(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }
  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.files.set(path, data);
  }
}

const adapter = () => new MemoryVaultAdapter({ notes: { "folder/Note.md": "# Hi\n\nBody" } });

describe("export output-path confinement", () => {
  it("strips .. segments from a custom output folder so writes stay in the vault", async () => {
    const writer = new FakeWriter();
    const settings: TrueExportSettings = {
      ...DEFAULT_SETTINGS,
      outputLocation: "custom",
      customOutputFolder: "../../../etc/evil",
    };
    const result = await exportNote({
      adapter: adapter(),
      writer,
      settings,
      sourcePath: "folder/Note.md",
      format: "html",
      template: "default",
    });
    expect(result.outputPath).not.toContain("..");
    expect(result.outputPath).toBe("etc/evil/Note.html");
  });
});
