// src/core/adapter.ts
//
// The VaultAdapter is the seam that keeps src/core testable without Obsidian
// (rule R1/R2). Core code depends on this interface, never on Obsidian's App or
// Vault. Tests supply an in-memory implementation; the real one lives in
// src/obsidian-adapter.ts.

export interface VaultAdapter {
  /** Raw content of a note. Null if it does not exist. */
  readNote(path: string): Promise<string | null>;

  /** Binary content of an attachment. Null if it does not exist. */
  readBinary(path: string): Promise<ArrayBuffer | null>;

  /**
   * Resolve a wikilink target to a concrete vault path, replicating Obsidian's
   * own resolution (shortest unique path). Null when unresolvable.
   */
  resolveLink(linkText: string, fromPath: string): string | null;

  /** Best-effort MIME type from the file extension. */
  getMimeType(path: string): string;

  /** All Markdown files under a folder, recursively, sorted by path. */
  listNotesInFolder(folderPath: string): Promise<string[]>;

  /**
   * Last-modified time (ms since epoch) of a file, or null if it doesn't exist.
   * Optional: used to cache the parsed reference .docx so it isn't re-read and
   * re-parsed on every export. Absent → callers simply skip the cache.
   */
  getModifiedTime?(path: string): Promise<number | null>;
}
