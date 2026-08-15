import { describe, it, expect } from "vitest";
import { App } from "obsidian";
import { ObsidianVaultAdapter } from "../../src/obsidian-adapter";

// The mock App carries extra test-only fields (vault.notes, metadataCache
// .resolver) that the real Obsidian types don't declare, so it's typed loosely.
function makeApp(): any {
  const app: any = new App();
  app.vault.notes.set("folder/Note.md", "note body");
  app.vault.notes.set("folder/Other.md", "other body");
  app.vault.binaries.set("img/pic.png", new TextEncoder().encode("PNG").buffer);
  // Simulate Obsidian's shortest-unique-path resolution by basename.
  app.metadataCache.resolver = (linkpath: string): string | null => {
    const match = Array.from(app.vault.notes.keys() as string[]).find(
      (p) => p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/, "") === linkpath,
    );
    return match ?? null;
  };
  return app;
}

describe("ObsidianVaultAdapter", () => {
  it("reads a note's content, or null when absent", async () => {
    const adapter = new ObsidianVaultAdapter(makeApp());
    expect(await adapter.readNote("folder/Note.md")).toBe("note body");
    expect(await adapter.readNote("missing.md")).toBeNull();
  });

  it("reads binary content, or null when absent", async () => {
    const adapter = new ObsidianVaultAdapter(makeApp());
    const bytes = await adapter.readBinary("img/pic.png");
    expect(bytes).not.toBeNull();
    expect(await adapter.readBinary("img/nope.png")).toBeNull();
  });

  it("resolves a wikilink via Obsidian's own resolver", () => {
    const adapter = new ObsidianVaultAdapter(makeApp());
    expect(adapter.resolveLink("Note", "folder/Other.md")).toBe("folder/Note.md");
  });

  it("strips subpath and alias before resolving", () => {
    const app = makeApp();
    let received = "";
    app.metadataCache.resolver = (linkpath: string): string | null => {
      received = linkpath;
      return "folder/Note.md";
    };
    const adapter = new ObsidianVaultAdapter(app);
    adapter.resolveLink("Note#Heading|Alias", "folder/Other.md");
    expect(received).toBe("Note");
  });

  it("returns null for an unresolvable or empty link", () => {
    const adapter = new ObsidianVaultAdapter(makeApp());
    expect(adapter.resolveLink("Ghost", "folder/Other.md")).toBeNull();
    expect(adapter.resolveLink("   ", "folder/Other.md")).toBeNull();
  });

  it("maps MIME types by extension", () => {
    const adapter = new ObsidianVaultAdapter(makeApp());
    expect(adapter.getMimeType("a/b.PNG")).toBe("image/png");
    expect(adapter.getMimeType("c.svg")).toBe("image/svg+xml");
    expect(adapter.getMimeType("x.unknown")).toBe("application/octet-stream");
  });

  it("lists markdown files under a folder, sorted", async () => {
    const app = makeApp();
    app.vault.notes.set("elsewhere/Z.md", "z");
    const adapter = new ObsidianVaultAdapter(app);
    expect(await adapter.listNotesInFolder("folder")).toEqual(["folder/Note.md", "folder/Other.md"]);
  });
});
