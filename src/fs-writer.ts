// src/fs-writer.ts
//
// The filesystem-backed VaultWriter used ONLY for the one documented
// exception to "never write outside the vault": a user-chosen custom export
// destination, picked via the native OS folder dialog (§6.4, CLAUDE.md). It
// is desktop-only (mobile has no filesystem access) and is never substituted
// for the vault-backed writer anywhere else in the plugin.
//
// Same shape as src/pdf/electron.ts: the Electron/Node bits are behind an
// injectable runtime so orchestration is unit-testable without Electron, and
// the default runtime lazily requires the real modules, only ever
// constructed on desktop.

import type { VaultWriter } from "./export";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The Node/Electron capabilities this seam needs, injected for testability. */
export interface FsRuntime {
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, data: string | ArrayBuffer): Promise<void>;
  join(root: string, name: string): string;
  /** Open the native folder-picker dialog; null if the user cancelled. */
  pickFolder(): Promise<string | null>;
}

function loadRemote(): any {
  // Obsidian desktop exposes Electron; @electron/remote provides `dialog`
  // from the renderer. Try the modern module, then the legacy `remote` export
  // (same fallback as src/pdf/electron.ts, for consistency).
  try {
    return require("@electron/remote");
  } catch {
    return require("electron").remote;
  }
}

/** The real runtime: Node's fs/path plus Electron's folder-picker dialog. */
export function defaultFsRuntime(): FsRuntime {
  return {
    exists(path): boolean {
      const fs = require("fs");
      return fs.existsSync(path);
    },
    isDirectory(path): boolean {
      const fs = require("fs");
      try {
        return fs.statSync(path).isDirectory();
      } catch {
        return false;
      }
    },
    async mkdir(path): Promise<void> {
      const fs = require("fs");
      await fs.promises.mkdir(path, { recursive: true });
    },
    async writeFile(path, data): Promise<void> {
      const fs = require("fs");
      const contents = typeof data === "string" ? data : Buffer.from(data);
      await fs.promises.writeFile(path, contents);
    },
    join(root, name): string {
      const path = require("path");
      return path.join(root, name);
    },
    async pickFolder(): Promise<string | null> {
      const remote = loadRemote();
      const result = await remote.dialog.showOpenDialog({ properties: ["openDirectory"] });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    },
  };
}

/**
 * A folder chosen via the picker is a real, existing, absolute directory by
 * construction (the OS dialog only returns such paths) — but we don't skip
 * the check: settings are persisted and reloaded later, and the folder may
 * have since been moved, renamed or deleted.
 */
export function isValidExportRoot(path: string, runtime: FsRuntime = defaultFsRuntime()): boolean {
  return path.trim() !== "" && runtime.exists(path) && runtime.isDirectory(path);
}

/**
 * Create a VaultWriter rooted at `rootDir`, an absolute OS folder. Every path
 * this receives is a bare filename (export.ts's outputFolder() resolves the
 * "custom" case to "" for an absolute destination — see src/export.ts), so no
 * traversal segments ever reach here; sanitizeFilename() has already stripped
 * path separators from the name.
 */
export function createFsWriter(rootDir: string, runtime: FsRuntime = defaultFsRuntime()): VaultWriter {
  return {
    exists: (path) => runtime.exists(runtime.join(rootDir, path)),
    writeText: async (path, data) => {
      // The root itself may have been deleted/moved/unmounted since it was
      // picked (§D20) — recreate it (and any parent segments) before writing
      // rather than silently falling back elsewhere or failing outright.
      await runtime.mkdir(rootDir);
      await runtime.writeFile(runtime.join(rootDir, path), data);
    },
    writeBinary: async (path, data) => {
      await runtime.mkdir(rootDir);
      await runtime.writeFile(runtime.join(rootDir, path), data);
    },
    createFolder: async (path) => {
      await runtime.mkdir(runtime.join(rootDir, path));
    },
  };
}

/** Open the native folder-picker dialog; call only on desktop (needs Electron). */
export function pickExportFolder(runtime: FsRuntime = defaultFsRuntime()): Promise<string | null> {
  return runtime.pickFolder();
}
