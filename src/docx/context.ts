// src/docx/context.ts
//
// Shared state for a single DOCX render pass.

import type { ExportOptions } from "../core/options";
import type { NumberingBuilder } from "./numbering";

export interface DocxDeps {
  /**
   * Rasterise an SVG to PNG at the given scale (§4.9). Word's SVG support is
   * unreliable, so SVGs are rasterised before embedding. Injected because it
   * needs Electron (provided by the Obsidian layer); absent in pure tests
   * and on mobile, where SVGs fall back to a placeholder.
   *
   * `width`/`height` are the intended DISPLAY size — the SVG's own size
   * BEFORE the scale multiplier, not the oversampled PNG's raw pixel
   * dimensions. A 2x-rasterised 279×364 diagram returns a 558×728px PNG but
   * `width: 279, height: 364` here, so the renderer displays it at its
   * intended physical size while still using the sharper pixel data.
   */
  rasterizeSvg?: (svg: ArrayBuffer, scale: number) => Promise<{ data: ArrayBuffer; width: number; height: number }>;
}

export interface RenderContext {
  options: ExportOptions;
  deps: DocxDeps;
  numbering: NumberingBuilder;
  /** Bookmark ids already emitted, to avoid duplicates. */
  bookmarks: Set<string>;
  /**
   * Footnote numbers that already have a real `w:footnoteReference` marker
   * (and its bookmark) emitted. A repeat citation of the same footnote
   * becomes a NOTEREF field targeting that bookmark instead of a second
   * `w:footnoteReference` — Word requires each body reference marker to
   * carry a unique id (see footnoteReferenceRun() in inline.ts).
   */
  footnoteRefs: Set<number>;
  /**
   * Allocates the next globally-unique numeric bookmark `w:id` for this
   * render. docx's own `Bookmark` class generates a fresh id-counter
   * starting from 0 EVERY time it's constructed, so every `new Bookmark(...)`
   * anywhere in the codebase independently produces `w:id="1"` — a library
   * quirk that's invalid OOXML the moment more than one bookmark exists in
   * the same document. Every bookmark-creating call site must go through
   * createBookmark() (inline.ts), which uses this instead of trusting
   * docx's own generator.
   */
  nextBookmarkId(): number;
}
