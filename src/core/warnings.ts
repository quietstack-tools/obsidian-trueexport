// src/core/warnings.ts
//
// Export warnings. Every unsupported or degraded construct produces one — the
// export never silently drops content (§4.13). Warnings MUST name a remedy and
// SHOULD cite a source line so the user can act (§6.3, acceptance #6).

/** Machine key identifying which construct produced a warning. */
export type WarningConstruct =
  | "wikilink"
  | "transclusion"
  | "footnote"
  | "image"
  | "math"
  | "mermaid"
  | "dataview"
  | "bases"
  | "excalidraw"
  | "tasks"
  | "templater"
  | "html"
  | "reference"
  | "frontmatter";

export interface ExportWarning {
  /** Which construct triggered this warning. */
  construct: WarningConstruct;
  /** Human-readable message. MUST include an actionable remedy (§4.13). */
  message: string;
  /** 1-based source line, when known (§6.3). */
  line?: number;
  /** Vault path of the note the warning came from. */
  sourcePath: string;
}

/**
 * Accumulates warnings as a document is parsed, resolved and rendered.
 * Insertion order is preserved so the warnings view can present issues in the
 * order they occur.
 */
export class WarningCollector {
  private readonly warnings: ExportWarning[] = [];

  add(warning: ExportWarning): void {
    this.warnings.push(warning);
  }

  /** A defensive copy of the collected warnings, in insertion order. */
  list(): ExportWarning[] {
    return this.warnings.slice();
  }

  get length(): number {
    return this.warnings.length;
  }
}
