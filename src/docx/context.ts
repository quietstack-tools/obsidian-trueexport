// src/docx/context.ts
//
// Shared state for a single DOCX render pass.

import type { ExportOptions } from "../core/options";
import type { NumberingBuilder } from "./numbering";

export interface DocxDeps {
  /**
   * Rasterise an SVG to PNG at the given scale (§4.9). Word's SVG support is
   * unreliable, so SVGs are rasterised before embedding. Injected because it
   * needs a canvas/DOM (provided by the Obsidian layer); absent in pure tests,
   * where SVGs fall back to a placeholder.
   */
  rasterizeSvg?: (svg: ArrayBuffer, scale: number) => Promise<{ data: ArrayBuffer }>;
}

export interface RenderContext {
  options: ExportOptions;
  deps: DocxDeps;
  numbering: NumberingBuilder;
  /** Bookmark ids already emitted, to avoid duplicates. */
  bookmarks: Set<string>;
}
