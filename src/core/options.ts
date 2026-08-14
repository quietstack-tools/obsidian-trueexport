// src/core/options.ts
//
// Export options shared across the pipeline. Renderer- and UI-specific settings
// are layered on top elsewhere; these are the format-agnostic knobs core needs.

export type ExportFormat = "docx" | "pdf" | "html";

/** How YAML frontmatter is handled (§4.12). */
export type FrontmatterMode = "strip" | "metadata" | "table";

export type PageSize = "A4" | "Letter" | "Legal";

export type Orientation = "portrait" | "landscape";

/** Built-in template ids, plus user-defined ids (Pro). */
export type TemplateId = "default" | "professional" | "academic" | "minimal" | (string & {});

/** Image embedding quality, in DPI (§6.4 Advanced). */
export type ImageDpi = 72 | 150 | 300;

export interface ExportOptions {
  format: ExportFormat;
  template: TemplateId;
  /** Frontmatter handling; defaults to "strip" (§4.12). */
  frontmatterMode: FrontmatterMode;
  pageSize: PageSize;
  orientation: Orientation;
  /** Fetch remote images. Off by default (§7.6, R6). */
  allowRemoteImages: boolean;
  /** Maximum transclusion nesting depth; default 5 (§4.3). */
  transclusionDepth: number;
  /** Image embedding quality in DPI. */
  imageDpi: ImageDpi;
  /** Optional hard cap on embedded image width, in px. */
  maxImageWidthPx?: number;
  /** Tab-to-space width inside code blocks; default 4 (§4.8). */
  tabWidth: number;
}

/** The safe, privacy-preserving defaults for a fresh export. */
export function defaultExportOptions(): ExportOptions {
  return {
    format: "docx",
    template: "default",
    frontmatterMode: "strip",
    pageSize: "A4",
    orientation: "portrait",
    allowRemoteImages: false,
    transclusionDepth: 5,
    imageDpi: 150,
    tabWidth: 4,
  };
}
