// tests/helpers/resolve.ts
//
// Convenience wrapper: parse a note and resolve it against an in-memory vault.

import { parseMarkdown } from "../../src/core/parser";
import { resolveDocument } from "../../src/core/resolver";
import type { RemoteImageFetcher } from "../../src/core/resolver/context";
import { defaultExportOptions, type ExportOptions } from "../../src/core/options";
import { WarningCollector, type ExportWarning } from "../../src/core/warnings";
import type { IdmDocument } from "../../src/core/model/document";
import { MemoryVaultAdapter } from "./memory-adapter";

export interface ResolveOptions {
  sourcePath?: string;
  notes?: Record<string, string>;
  binaries?: Record<string, ArrayBuffer>;
  /** Note paths considered part of this export. Defaults to [sourcePath]. */
  included?: string[];
  options?: Partial<ExportOptions>;
  /** Inject the remote-image fetch capability (§7.6). */
  fetchRemoteImage?: RemoteImageFetcher;
}

export interface ResolvedFixture {
  doc: IdmDocument;
  warnings: ExportWarning[];
}

export async function resolve(source: string, opts: ResolveOptions = {}): Promise<ResolvedFixture> {
  const sourcePath = opts.sourcePath ?? "Note.md";
  const options = { ...defaultExportOptions(), ...opts.options };
  const adapter = new MemoryVaultAdapter({ notes: opts.notes, binaries: opts.binaries });
  const warnings = new WarningCollector();
  const parsed = parseMarkdown(source, sourcePath, options, warnings);
  const includedNotePaths = new Set(opts.included ?? [sourcePath]);
  const doc = await resolveDocument(parsed, sourcePath, {
    adapter,
    options,
    warnings,
    includedNotePaths,
    fetchRemoteImage: opts.fetchRemoteImage,
  });
  return { doc, warnings: warnings.list() };
}
