import { describe, it, expect, vi } from "vitest";
import { createFsWriter, isValidExportRoot, pickExportFolder, type FsRuntime } from "../../src/fs-writer";
import { exportNote, isAbsoluteOutputPath, type VaultWriter } from "../../src/export";
import { DEFAULT_SETTINGS, type TrueExportSettings } from "../../src/ui/settings";
import { MemoryVaultAdapter } from "../helpers/memory-adapter";

/** A fake runtime backed by an in-memory map, rooted at a fixed absolute path. */
function fakeRuntime(root: string, seedDirectory = true) {
  const files = new Map<string, string | ArrayBuffer>();
  const dirs = new Set<string>(seedDirectory ? [root] : []);
  const runtime: FsRuntime = {
    exists: (path) => files.has(path) || dirs.has(path),
    isDirectory: (path) => dirs.has(path),
    mkdir: vi.fn(async (path: string) => {
      dirs.add(path);
    }),
    writeFile: vi.fn(async (path: string, data: string | ArrayBuffer) => {
      files.set(path, data);
    }),
    join: (r, name) => `${r}/${name}`,
    pickFolder: vi.fn(async () => root),
  };
  return { runtime, files, dirs };
}

describe("isAbsoluteOutputPath", () => {
  it("recognises POSIX and Windows absolute paths", () => {
    expect(isAbsoluteOutputPath("/Users/kesavan/Downloads/foo")).toBe(true);
    expect(isAbsoluteOutputPath("C:\\Users\\kesavan\\Downloads")).toBe(true);
    expect(isAbsoluteOutputPath("C:/Users/kesavan/Downloads")).toBe(true);
  });

  it("rejects vault-relative and traversal-shaped values", () => {
    expect(isAbsoluteOutputPath("Exports")).toBe(false);
    expect(isAbsoluteOutputPath("~/Downloads/foo")).toBe(false);
    expect(isAbsoluteOutputPath("../../../etc/evil")).toBe(false);
    expect(isAbsoluteOutputPath("")).toBe(false);
  });
});

describe("isValidExportRoot", () => {
  it("accepts a real, absolute, existing directory", () => {
    const { runtime } = fakeRuntime("/Users/kesavan/Downloads/exports");
    expect(isValidExportRoot("/Users/kesavan/Downloads/exports", runtime)).toBe(true);
  });

  it("rejects an empty path, a missing directory, or a path that isn't a directory", () => {
    const { runtime } = fakeRuntime("/Users/kesavan/Downloads/exports", /* seedDirectory */ false);
    expect(isValidExportRoot("", runtime)).toBe(false);
    expect(isValidExportRoot("/Users/kesavan/Downloads/exports", runtime)).toBe(false);
  });
});

describe("createFsWriter", () => {
  it("writes files under the chosen root, not the vault", async () => {
    const root = "/Users/kesavan/Downloads/trueexport-testing";
    const { runtime, files } = fakeRuntime(root);
    const writer = createFsWriter(root, runtime);

    await writer.writeText("Note.html", "<p>hi</p>");
    expect(files.get(`${root}/Note.html`)).toBe("<p>hi</p>");
    expect(writer.exists("Note.html")).toBe(true);
    expect(writer.exists("Missing.html")).toBe(false);
  });

  it("drives a full exportNote() through the fs-backed writer when the destination is absolute", async () => {
    const root = "/Users/kesavan/Downloads/trueexport-testing";
    const { runtime, files } = fakeRuntime(root);
    const writer: VaultWriter = createFsWriter(root, runtime);
    const adapter = new MemoryVaultAdapter({ notes: { "folder/Note.md": "# Hi\n\nBody" } });
    const settings: TrueExportSettings = {
      ...DEFAULT_SETTINGS,
      outputLocation: "custom",
      customOutputFolder: root,
    };

    const result = await exportNote({
      adapter,
      writer,
      settings,
      sourcePath: "folder/Note.md",
      format: "html",
      template: "default",
    });

    // Written straight at the chosen root — no vault-relative folder prefix,
    // and no confineToVault mangling of the absolute path.
    expect(result.outputPath).toBe("Note.html");
    expect(files.has(`${root}/Note.html`)).toBe(true);
  });
});

describe("createFsWriter — missing root directory (§D20)", () => {
  it("recreates the root directory and writes the file when it was deleted/unmounted since being picked", async () => {
    const root = "/Users/kesavan/Downloads/trueexport-testing";
    // seedDirectory=false: simulates the picked folder no longer existing.
    const { runtime, files, dirs } = fakeRuntime(root, /* seedDirectory */ false);
    const writer: VaultWriter = createFsWriter(root, runtime);
    const adapter = new MemoryVaultAdapter({ notes: { "folder/Note.md": "# Hi\n\nBody" } });
    const settings: TrueExportSettings = {
      ...DEFAULT_SETTINGS,
      outputLocation: "custom",
      customOutputFolder: root,
    };

    const result = await exportNote({
      adapter,
      writer,
      settings,
      sourcePath: "folder/Note.md",
      format: "html",
      template: "default",
    });

    expect(runtime.mkdir).toHaveBeenCalledWith(root);
    expect(dirs.has(root)).toBe(true);
    expect(files.has(`${root}/Note.html`)).toBe(true);
    expect(result.outputPath).toBe("Note.html");
  });

  it("surfaces an honest error, not a false success, when the root can't be recreated", async () => {
    const root = "/Users/kesavan/Downloads/trueexport-testing";
    const { runtime } = fakeRuntime(root, /* seedDirectory */ false);
    // The parent is read-only: mkdir genuinely fails.
    runtime.mkdir = vi.fn(async () => {
      throw Object.assign(new Error("EACCES: permission denied, mkdir"), { code: "EACCES" });
    });
    const writer: VaultWriter = createFsWriter(root, runtime);
    const adapter = new MemoryVaultAdapter({ notes: { "folder/Note.md": "# Hi\n\nBody" } });
    const settings: TrueExportSettings = {
      ...DEFAULT_SETTINGS,
      outputLocation: "custom",
      customOutputFolder: root,
    };

    await expect(
      exportNote({
        adapter,
        writer,
        settings,
        sourcePath: "folder/Note.md",
        format: "html",
        template: "default",
      }),
    ).rejects.toThrow(/EACCES/);
  });
});

describe("pickExportFolder", () => {
  it("delegates to the runtime's native dialog and returns the chosen path", async () => {
    const { runtime } = fakeRuntime("/Users/kesavan/Downloads/exports");
    await expect(pickExportFolder(runtime)).resolves.toBe("/Users/kesavan/Downloads/exports");
    expect(runtime.pickFolder).toHaveBeenCalledOnce();
  });

  it("returns null when the user cancels", async () => {
    const runtime: FsRuntime = {
      ...fakeRuntime("/unused").runtime,
      pickFolder: vi.fn(async () => null),
    };
    await expect(pickExportFolder(runtime)).resolves.toBeNull();
  });
});
