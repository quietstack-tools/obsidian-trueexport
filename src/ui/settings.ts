// src/ui/settings.ts
//
// Plugin settings (§6.4): the persisted shape, defaults, and the pure helpers
// that map settings onto core ExportOptions, expand filename patterns, and
// describe the built-in templates. Kept free of Obsidian imports so the logic
// is unit-testable in isolation.

import type {
  ExportFormat,
  ExportOptions,
  FrontmatterMode,
  ImageDpi,
  Orientation,
  PageSize,
  TemplateId,
} from "../core/options";

export type OutputLocation = "same-folder" | "vault-root" | "custom";

export interface TrueExportSettings {
  // General
  defaultFormat: ExportFormat;
  defaultTemplate: TemplateId;
  outputLocation: OutputLocation;
  customOutputFolder: string;
  filenamePattern: string;
  showRibbonIcon: boolean;
  // Word
  wordPageSize: PageSize;
  frontmatterMode: FrontmatterMode;
  embedFonts: boolean;
  // PDF
  pdfPageSize: PageSize;
  pdfOrientation: Orientation;
  pdfPageNumbers: boolean;
  /** Uniform page margin for PDF, in inches. */
  pdfMargins: number;
  // HTML
  htmlDarkMode: boolean;
  htmlMaxWidth: number;
  // Advanced
  imageDpi: ImageDpi;
  maxImageWidthPx: number;
  allowRemoteImages: boolean;
  transclusionDepth: number;
  // Licence (activation logic lands in Stage 8)
  licenceKey: string;
  licenceActivated: boolean;
  deviceCount: number;
  // Remembered choices
  lastFormat: ExportFormat;
  lastTemplate: TemplateId;
}

export const DEFAULT_SETTINGS: TrueExportSettings = {
  defaultFormat: "docx",
  defaultTemplate: "default",
  outputLocation: "same-folder",
  customOutputFolder: "",
  filenamePattern: "{{title}}",
  showRibbonIcon: true,
  wordPageSize: "A4",
  frontmatterMode: "strip",
  embedFonts: false,
  pdfPageSize: "A4",
  pdfOrientation: "portrait",
  pdfPageNumbers: false,
  pdfMargins: 1,
  htmlDarkMode: true,
  htmlMaxWidth: 45,
  imageDpi: 150,
  maxImageWidthPx: 1200,
  allowRemoteImages: false,
  transclusionDepth: 5,
  licenceKey: "",
  licenceActivated: false,
  deviceCount: 0,
  lastFormat: "docx",
  lastTemplate: "default",
};

export interface TemplateInfo {
  id: TemplateId;
  name: string;
  /** Pro-only templates are shown but disabled for free users (§6.2). */
  pro: boolean;
}

/** The four built-ins are all free; custom templates are Pro (§7.1). */
export const TEMPLATES: TemplateInfo[] = [
  { id: "default", name: "Default", pro: false },
  { id: "professional", name: "Professional", pro: false },
  { id: "academic", name: "Academic", pro: false },
  { id: "minimal", name: "Minimal", pro: false },
  { id: "custom", name: "Custom…", pro: true },
];

/** Formats offered on a platform — PDF is desktop-only (§7.5). */
export function availableFormats(isMobile: boolean): ExportFormat[] {
  return isMobile ? ["docx", "html"] : ["docx", "pdf", "html"];
}

export const FORMAT_LABELS: Record<ExportFormat, string> = {
  docx: "Word (.docx)",
  pdf: "PDF",
  html: "HTML",
};

export const FORMAT_EXTENSIONS: Record<ExportFormat, string> = {
  docx: "docx",
  pdf: "pdf",
  html: "html",
};

/** Build core ExportOptions from settings for a chosen format/template. */
export function settingsToExportOptions(
  settings: TrueExportSettings,
  format: ExportFormat,
  template: TemplateId,
): ExportOptions {
  return {
    format,
    template,
    frontmatterMode: settings.frontmatterMode,
    pageSize: format === "pdf" ? settings.pdfPageSize : settings.wordPageSize,
    orientation: format === "pdf" ? settings.pdfOrientation : "portrait",
    allowRemoteImages: settings.allowRemoteImages,
    transclusionDepth: settings.transclusionDepth,
    imageDpi: settings.imageDpi,
    maxImageWidthPx: settings.maxImageWidthPx,
    tabWidth: 4,
  };
}

export interface FilenameContext {
  title: string;
  date: string;
  time: string;
}

const ILLEGAL_FILENAME = /[/\\:*?"<>|]/g;

export function sanitizeFilename(name: string): string {
  return name.replace(ILLEGAL_FILENAME, "-").replace(/\s+/g, " ").trim();
}

/** Expand {{title}}, {{date}}, {{time}} in a filename pattern (§6.4). */
export function renderFilename(pattern: string, ctx: FilenameContext): string {
  const raw = pattern
    .replace(/\{\{title\}\}/g, ctx.title)
    .replace(/\{\{date\}\}/g, ctx.date)
    .replace(/\{\{time\}\}/g, ctx.time);
  return sanitizeFilename(raw) || "Untitled";
}
