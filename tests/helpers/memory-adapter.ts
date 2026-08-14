// tests/helpers/memory-adapter.ts
//
// An in-memory VaultAdapter for unit tests. This is the seam described in
// TECH_SPEC §3.4: it lets src/core be exercised with no Obsidian present.
// The real implementation lives in src/obsidian-adapter.ts (Stage 6).

import type { VaultAdapter } from "../../src/core/adapter";

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  svg: "image/svg+xml",
  md: "text/markdown",
  pdf: "application/pdf",
};

export interface MemoryVaultOptions {
  /** note path → raw markdown content. */
  notes?: Record<string, string>;
  /** attachment path → binary content. */
  binaries?: Record<string, ArrayBuffer>;
  /** extension (no dot) → MIME type overrides/additions. */
  mimeTypes?: Record<string, string>;
}

/** Normalise separators and collapse duplicate slashes. */
function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");
}

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

function basenameNoExt(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? base : base.slice(0, dot);
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** Convenience for building binary fixtures from text. */
export function textToArrayBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  // Copy into a standalone ArrayBuffer (not a view over a shared buffer).
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

export class MemoryVaultAdapter implements VaultAdapter {
  private readonly notes = new Map<string, string>();
  private readonly binaries = new Map<string, ArrayBuffer>();
  private readonly mimeTypes: Record<string, string>;

  constructor(options: MemoryVaultOptions = {}) {
    for (const [path, content] of Object.entries(options.notes ?? {})) {
      this.notes.set(normalize(path), content);
    }
    for (const [path, data] of Object.entries(options.binaries ?? {})) {
      this.binaries.set(normalize(path), data);
    }
    this.mimeTypes = { ...MIME_TYPES, ...(options.mimeTypes ?? {}) };
  }

  async readNote(path: string): Promise<string | null> {
    const content = this.notes.get(normalize(path));
    return content ?? null;
  }

  async readBinary(path: string): Promise<ArrayBuffer | null> {
    const data = this.binaries.get(normalize(path));
    return data ?? null;
  }

  resolveLink(linkText: string, fromPath: string): string | null {
    // Strip any subpath (#heading / #^block) and alias (|display); the caller
    // is responsible for those, but be defensive.
    const clean = normalize(linkText.split("#")[0].split("|")[0].trim());
    if (clean === "") return null;

    const paths = [...this.notes.keys()];

    // Path-ish target (contains a slash or an extension): try an exact hit,
    // then the same target with a `.md` extension, then a suffix match.
    if (clean.includes("/") || extensionOf(clean) !== "") {
      if (this.notes.has(clean)) return clean;
      const withMd = `${clean}.md`;
      if (this.notes.has(withMd)) return withMd;
      const suffixMatches = paths.filter(
        (p) => p === clean || p.endsWith(`/${clean}`),
      );
      return this.pickBest(suffixMatches, fromPath);
    }

    // Bare name: match by basename, case-sensitive first, then insensitive.
    const exact = paths.filter((p) => basenameNoExt(p) === clean);
    if (exact.length > 0) return this.pickBest(exact, fromPath);

    const lower = clean.toLowerCase();
    const insensitive = paths.filter(
      (p) => basenameNoExt(p).toLowerCase() === lower,
    );
    return this.pickBest(insensitive, fromPath);
  }

  /**
   * Replicate Obsidian's "shortest unique path" resolution: prefer a candidate
   * in the same folder as the source note, then the shortest path, with a
   * lexicographic tie-break for determinism.
   */
  private pickBest(candidates: string[], fromPath: string): string | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const fromDir = dirOf(normalize(fromPath));
    const sameFolder = candidates.filter((p) => dirOf(p) === fromDir);
    const pool = sameFolder.length > 0 ? sameFolder : candidates;

    return [...pool].sort((a, b) => {
      if (a.length !== b.length) return a.length - b.length;
      return a < b ? -1 : a > b ? 1 : 0;
    })[0];
  }

  getMimeType(path: string): string {
    return this.mimeTypes[extensionOf(path)] ?? "application/octet-stream";
  }

  async listNotesInFolder(folderPath: string): Promise<string[]> {
    const prefix = normalize(folderPath).replace(/\/$/, "");
    const inFolder = [...this.notes.keys()].filter((p) => {
      if (extensionOf(p) !== "md") return false;
      if (prefix === "" || prefix === "/") return true;
      return p === prefix || p.startsWith(`${prefix}/`);
    });
    return inFolder.sort();
  }
}
