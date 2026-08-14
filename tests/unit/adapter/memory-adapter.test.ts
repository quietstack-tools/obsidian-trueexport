import { describe, it, expect } from "vitest";
import {
  MemoryVaultAdapter,
  textToArrayBuffer,
} from "../../helpers/memory-adapter";

describe("MemoryVaultAdapter.readNote", () => {
  it("returns content for a known path", async () => {
    const vault = new MemoryVaultAdapter({ notes: { "Notes/A.md": "hello" } });
    expect(await vault.readNote("Notes/A.md")).toBe("hello");
  });

  it("returns null for a missing note", async () => {
    const vault = new MemoryVaultAdapter({ notes: { "A.md": "x" } });
    expect(await vault.readNote("Missing.md")).toBeNull();
  });

  it("normalises separators and leading ./ when reading", async () => {
    const vault = new MemoryVaultAdapter({ notes: { "Notes/A.md": "hello" } });
    expect(await vault.readNote("./Notes\\A.md")).toBe("hello");
  });
});

describe("MemoryVaultAdapter.readBinary", () => {
  it("returns bytes for a known attachment", async () => {
    const data = textToArrayBuffer("PNGDATA");
    const vault = new MemoryVaultAdapter({ binaries: { "img/a.png": data } });
    const out = await vault.readBinary("img/a.png");
    expect(out).not.toBeNull();
    expect(new TextDecoder().decode(out as ArrayBuffer)).toBe("PNGDATA");
  });

  it("returns null when the attachment is absent", async () => {
    const vault = new MemoryVaultAdapter();
    expect(await vault.readBinary("nope.png")).toBeNull();
  });
});

describe("MemoryVaultAdapter.resolveLink", () => {
  it("resolves a bare name to its unique note", () => {
    const vault = new MemoryVaultAdapter({
      notes: { "folder/Target.md": "", "Other.md": "" },
    });
    expect(vault.resolveLink("Target", "Other.md")).toBe("folder/Target.md");
  });

  it("returns null when unresolvable", () => {
    const vault = new MemoryVaultAdapter({ notes: { "A.md": "" } });
    expect(vault.resolveLink("Ghost", "A.md")).toBeNull();
  });

  it("ignores subpath and alias when matching", () => {
    const vault = new MemoryVaultAdapter({ notes: { "Target.md": "" } });
    expect(vault.resolveLink("Target#Heading|Alias", "A.md")).toBe("Target.md");
  });

  it("prefers a candidate in the same folder as the source note", () => {
    const vault = new MemoryVaultAdapter({
      notes: { "a/Note.md": "", "b/Note.md": "", "c/deep/Note.md": "" },
    });
    expect(vault.resolveLink("Note", "b/Source.md")).toBe("b/Note.md");
  });

  it("falls back to the shortest path when no same-folder match exists", () => {
    const vault = new MemoryVaultAdapter({
      notes: { "aa/Note.md": "", "a/very/deep/Note.md": "" },
    });
    expect(vault.resolveLink("Note", "elsewhere/Source.md")).toBe("aa/Note.md");
  });

  it("resolves a path-ish target, appending .md when needed", () => {
    const vault = new MemoryVaultAdapter({
      notes: { "folder/Target.md": "", "Target.md": "" },
    });
    expect(vault.resolveLink("folder/Target", "A.md")).toBe("folder/Target.md");
  });

  it("resolves case-insensitively as a fallback", () => {
    const vault = new MemoryVaultAdapter({ notes: { "Target.md": "" } });
    expect(vault.resolveLink("target", "A.md")).toBe("Target.md");
  });

  it("returns null for an empty link text", () => {
    const vault = new MemoryVaultAdapter({ notes: { "A.md": "" } });
    expect(vault.resolveLink("   ", "A.md")).toBeNull();
  });
});

describe("MemoryVaultAdapter.getMimeType", () => {
  it("maps known extensions", () => {
    const vault = new MemoryVaultAdapter();
    expect(vault.getMimeType("a/b/pic.PNG")).toBe("image/png");
    expect(vault.getMimeType("d.svg")).toBe("image/svg+xml");
  });

  it("falls back to octet-stream for unknown extensions", () => {
    const vault = new MemoryVaultAdapter();
    expect(vault.getMimeType("archive.xyz")).toBe("application/octet-stream");
  });

  it("honours caller-supplied MIME overrides", () => {
    const vault = new MemoryVaultAdapter({ mimeTypes: { xyz: "application/x-xyz" } });
    expect(vault.getMimeType("file.xyz")).toBe("application/x-xyz");
  });
});

describe("MemoryVaultAdapter.listNotesInFolder", () => {
  it("returns markdown files under a folder, recursively and sorted", async () => {
    const vault = new MemoryVaultAdapter({
      notes: {
        "proj/b.md": "",
        "proj/a.md": "",
        "proj/sub/c.md": "",
        "other/d.md": "",
      },
      binaries: { "proj/image.png": textToArrayBuffer("x") },
    });
    expect(await vault.listNotesInFolder("proj")).toEqual([
      "proj/a.md",
      "proj/b.md",
      "proj/sub/c.md",
    ]);
  });

  it("returns every note for the vault root", async () => {
    const vault = new MemoryVaultAdapter({
      notes: { "a.md": "", "x/b.md": "" },
    });
    expect(await vault.listNotesInFolder("")).toEqual(["a.md", "x/b.md"]);
  });

  it("does not match a sibling folder sharing a name prefix", async () => {
    const vault = new MemoryVaultAdapter({
      notes: { "proj/a.md": "", "project/b.md": "" },
    });
    expect(await vault.listNotesInFolder("proj")).toEqual(["proj/a.md"]);
  });
});
