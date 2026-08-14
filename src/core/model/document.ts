// src/core/model/document.ts
//
// The top-level IDM container. Format-agnostic; consumed by every renderer.

import type { BlockNode, FootnoteDefinitionNode } from "./nodes";
import type { ExportWarning } from "../warnings";

export interface IdmDocument {
  /** Title from frontmatter, else the note's filename (§5.1). */
  title: string;
  frontmatter: Record<string, unknown>;
  blocks: BlockNode[];
  /**
   * Footnote definitions, keyed by their original identifier. Sole source of
   * truth for footnotes — definitions never appear in `blocks` (§4.5.3).
   */
  footnotes: Map<string, FootnoteDefinitionNode>;
  warnings: ExportWarning[];
  sourcePath: string;
}
