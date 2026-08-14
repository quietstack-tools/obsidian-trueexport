// src/core/resolver/context.ts
//
// Shared state for resolution. The resolver is the only core layer that touches
// the vault, and it does so exclusively through the injected VaultAdapter
// (R1/R2) — never Obsidian's API.

import type { VaultAdapter } from "../adapter";
import type { ExportOptions } from "../options";
import type { WarningCollector } from "../warnings";

export interface ResolveContext {
  adapter: VaultAdapter;
  options: ExportOptions;
  warnings: WarningCollector;
  /**
   * Paths of every note included in this export. A wikilink to a note in this
   * set becomes a working internal link; a link to a note outside it degrades
   * to plain text (§4.2.3–4).
   */
  includedNotePaths: ReadonlySet<string>;
}
