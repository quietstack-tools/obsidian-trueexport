// src/export.ts
//
// Export orchestration: read → parse → resolve → render → write. Kept free of
// "obsidian" imports so it is unit-testable; vault writes go through the small
// VaultWriter seam, which main.ts implements against app.vault.

import type { IdmDocument } from "./core/model/document";
import type { VaultAdapter } from "./core/adapter";
import type { ExportFormat, ExportOptions, TemplateId } from "./core/options";
import { WarningCollector, type ExportWarning } from "./core/warnings";
import type { BlockNode, InlineNode } from "./core/model/nodes";
import { parseMarkdown } from "./core/parser";
import { resolveDocument } from "./core/resolver";
import { parseLatex } from "./math/parse";
import type { RemoteImageFetcher } from "./core/resolver/context";
import { renderDocx, type DocxDeps } from "./docx";
import { parseReferenceStyles, type ReferenceStyles } from "./docx/reference-styles";
import { renderHtml } from "./html";
import { renderPdf, type HtmlToPdf } from "./pdf";
import {
  FORMAT_EXTENSIONS,
  renderFilename,
  settingsToExportOptions,
  type TrueExportSettings,
} from "./ui/settings";

export interface VaultWriter {
  exists(path: string): boolean;
  writeText(path: string, data: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  /**
   * Create a folder, treating "already exists" as success. Optional so the
   * write seam stays minimal; when present, exportNote creates any missing
   * parent folders of the output path before writing (§7.4), so a custom
   * destination that doesn't exist yet doesn't fail the export.
   */
  createFolder?(path: string): Promise<void>;
}

/**
 * Renderer dependencies. `htmlToPdf` is present only on desktop; its absence is
 * how the export path enforces "PDF is desktop-only" (§7.5).
 */
export interface ExportDeps extends DocxDeps {
  htmlToPdf?: HtmlToPdf;
  /** Render a Mermaid diagram to SVG via Obsidian's Mermaid instance (§4.11). */
  mermaidToSvg?: (source: string) => Promise<string>;
  /** Opt-in, default-off remote-image fetch (§7.6). Only used when enabled. */
  fetchRemoteImage?: RemoteImageFetcher;
  /**
   * DOM-based HTML sanitiser (DOMPurify), injected from the Obsidian layer where
   * a real DOM exists. Present → raw HTML blocks are cleaned with it before
   * rendering; absent (e.g. tests, mobile-less contexts) → the renderer's
   * regex sanitiser is the sole pass. Kept out of src/core / src/html (R1/R2).
   */
  sanitizeHtml?: (html: string) => string;
}

export interface ExportResult {
  outputPath: string;
  warnings: ExportWarning[];
}

export interface ExportParams {
  adapter: VaultAdapter;
  writer: VaultWriter;
  settings: TrueExportSettings;
  sourcePath: string;
  format: ExportFormat;
  template: TemplateId;
  deps?: ExportDeps;
  /** Injectable clock for deterministic filenames in tests. */
  now?: Date;
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");
}

/**
 * Confine a user-supplied output folder to the vault: drop leading slashes and
 * any ".." segments so an export can never be aimed above the vault root (§7.4).
 */
function confineToVault(path: string): string {
  return normalize(path)
    .split("/")
    .filter((seg) => seg !== "" && seg !== "." && seg !== "..")
    .join("/");
}

function dirname(path: string): string {
  const slash = normalize(path).lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

async function buildDocument(
  adapter: VaultAdapter,
  sourcePath: string,
  options: ExportOptions,
  warnings: WarningCollector,
  deps?: ExportDeps,
): Promise<IdmDocument> {
  const content = await adapter.readNote(sourcePath);
  if (content === null) {
    throw new Error(`Could not read note "${sourcePath}". Make sure it still exists.`);
  }
  const parsed = parseMarkdown(content, sourcePath, options, warnings);
  const doc = await resolveDocument(parsed, sourcePath, {
    adapter,
    options,
    warnings,
    includedNotePaths: new Set([sourcePath]),
    // Only fetch remote images during a real export (deps present) and only
    // when the user enabled them; the pre-scan passes no deps → no network.
    fetchRemoteImage: options.allowRemoteImages ? deps?.fetchRemoteImage : undefined,
  });
  // Warn for any equation that can't be converted (it renders as text; §4.10).
  collectMathWarnings(doc.blocks, warnings, sourcePath);
  return doc;
}

function truncate(text: string): string {
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

function collectMathWarnings(blocks: BlockNode[], warnings: WarningCollector, sourcePath: string): void {
  const check = (latex: string, line?: number): void => {
    try {
      parseLatex(latex);
    } catch {
      warnings.add({
        construct: "math",
        message: `Equation "${truncate(latex)}" couldn't be converted and was shown as text.`,
        line,
        sourcePath,
      });
    }
  };
  const inlineWalk = (nodes: InlineNode[], line?: number): void => {
    for (const n of nodes) {
      if (n.type === "mathInline") check(n.latex, line);
      else if ("children" in n && Array.isArray(n.children)) inlineWalk(n.children, line);
    }
  };
  const blockWalk = (bs: BlockNode[]): void => {
    for (const b of bs) {
      const line = b.position?.line;
      if (b.type === "mathBlock") check(b.latex, line);
      else if (b.type === "paragraph" || b.type === "heading") inlineWalk(b.children, line);
      else if (b.type === "callout") {
        inlineWalk(b.title, line);
        blockWalk(b.children);
      } else if (b.type === "blockquote") blockWalk(b.children);
      else if (b.type === "list") b.children.forEach((it) => blockWalk(it.children));
      else if (b.type === "table")
        [b.header, ...b.rows].forEach((r) => r.cells.forEach((c) => inlineWalk(c.children, line)));
    }
  };
  blockWalk(blocks);
}

/** Render Mermaid code blocks to SVG images; failure/absence → code + warning (§4.11). */
async function resolveMermaid(
  blocks: BlockNode[],
  deps: ExportDeps | undefined,
  warnings: WarningCollector,
  sourcePath: string,
): Promise<BlockNode[]> {
  const convert = async (node: BlockNode): Promise<BlockNode> => {
    if (node.type !== "codeBlock" || (node.language ?? "").toLowerCase() !== "mermaid") return node;
    if (deps?.mermaidToSvg) {
      try {
        const svg = await deps.mermaidToSvg(node.content);
        const bytes = new TextEncoder().encode(svg);
        return {
          type: "imageBlock",
          resource: {
            kind: "binary",
            data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
            mimeType: "image/svg+xml",
            originalPath: "mermaid.svg",
          },
          alt: "Mermaid diagram",
          position: node.position,
        };
      } catch {
        // fall through to the code-block fallback
      }
    }
    warnings.add({
      construct: "mermaid",
      message: "Mermaid diagram couldn't be rendered and was shown as its source.",
      line: node.position?.line,
      sourcePath,
    });
    return node;
  };

  const walk = async (bs: BlockNode[]): Promise<BlockNode[]> => {
    const out: BlockNode[] = [];
    for (const b of bs) {
      if (b.type === "blockquote" || b.type === "callout") out.push({ ...b, children: await walk(b.children) });
      else if (b.type === "list")
        out.push({
          ...b,
          children: await Promise.all(b.children.map(async (it) => ({ ...it, children: await walk(it.children) }))),
        });
      else out.push(await convert(b));
    }
    return out;
  };

  return walk(blocks);
}

/**
 * Clean every raw HTML block with the injected DOM sanitiser (DOMPurify) before
 * rendering. This is the primary defence for untrusted note HTML; the renderer
 * keeps a regex sanitiser as an always-on baseline. No-op when no sanitiser is
 * injected (e.g. tests) — the renderer still applies its baseline.
 */
function sanitizeHtmlBlocks(blocks: BlockNode[], deps?: ExportDeps): BlockNode[] {
  const sanitize = deps?.sanitizeHtml;
  if (!sanitize) return blocks;
  const walk = (bs: BlockNode[]): BlockNode[] =>
    bs.map((b) => {
      if (b.type === "htmlBlock") return { ...b, raw: sanitize(b.raw) };
      if (b.type === "blockquote" || b.type === "callout") return { ...b, children: walk(b.children) };
      if (b.type === "list")
        return { ...b, children: b.children.map((it) => ({ ...it, children: walk(it.children) })) };
      return b;
    });
  return walk(blocks);
}

/** Pre-scan a note for warnings without rendering (drives the modal's row). */
export async function scanNote(
  adapter: VaultAdapter,
  settings: TrueExportSettings,
  sourcePath: string,
  format: ExportFormat = settings.defaultFormat,
  template: TemplateId = settings.defaultTemplate,
): Promise<ExportWarning[]> {
  const options = settingsToExportOptions(settings, format, template);
  const warnings = new WarningCollector();
  await buildDocument(adapter, sourcePath, options, warnings);
  return warnings.list();
}

/**
 * Load and parse a Pro user's reference .docx (§5.1). Pro-gated and best-effort:
 * a missing, unreadable, or unparseable reference never aborts the export — it
 * degrades to built-in styles with a specific, actionable warning (§7.4).
 */
async function loadReferenceStyles(
  adapter: VaultAdapter,
  settings: TrueExportSettings,
  pro: boolean,
  warnings: WarningCollector,
  sourcePath: string,
): Promise<ReferenceStyles | undefined> {
  const path = settings.referenceDocxPath.trim();
  if (!pro || path === "") return undefined;

  const bytes = await adapter.readBinary(path);
  if (!bytes) {
    warnings.add({
      construct: "reference",
      message: `Reference document "${path}" wasn't found — using default styles instead. Check the path in TrueExport settings.`,
      sourcePath,
    });
    return undefined;
  }

  const styles = await parseReferenceStyles(bytes);
  if (!styles) {
    warnings.add({
      construct: "reference",
      message: `Could not read styles from the reference document "${path}" — using default styles instead.`,
      sourcePath,
    });
    return undefined;
  }
  return styles;
}

export async function exportNote(params: ExportParams): Promise<ExportResult> {
  const { adapter, writer, settings, sourcePath, format, template, deps } = params;
  const now = params.now ?? new Date();
  const options = settingsToExportOptions(settings, format, template);
  const warnings = new WarningCollector();
  const doc = await buildDocument(adapter, sourcePath, options, warnings, deps);
  doc.blocks = await resolveMermaid(doc.blocks, deps, warnings, sourcePath);
  doc.blocks = sanitizeHtmlBlocks(doc.blocks, deps);
  const pro = settings.licenceActivated;

  // Render fully in memory first; only then write, so a failure never leaves a
  // partial file on disk (§7.4).
  let binary: boolean;
  let text = "";
  let bytes: ArrayBuffer = new ArrayBuffer(0);
  if (format === "docx") {
    const referenceStyles = await loadReferenceStyles(adapter, settings, pro, warnings, sourcePath);
    bytes = await renderDocx(doc, options, { deps, pro, warnings, referenceStyles });
    binary = true;
  } else if (format === "html") {
    text = renderHtml(doc, options, { pro });
    binary = false;
  } else if (format === "pdf") {
    // The seam is only provided on desktop, so its absence means mobile (§7.5).
    if (!deps?.htmlToPdf) {
      throw new Error("PDF export is only available on desktop. Use Word or HTML on mobile.");
    }
    const html = renderHtml(doc, options, { pro });
    bytes = await renderPdf(
      html,
      {
        pageSize: settings.pdfPageSize,
        orientation: settings.pdfOrientation,
        margins: settings.pdfMargins,
        pageNumbers: settings.pdfPageNumbers,
      },
      deps.htmlToPdf,
    );
    binary = true;
  } else {
    throw new Error(`Unknown export format: ${format}`);
  }

  const base = renderFilename(settings.filenamePattern, {
    title: doc.title,
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}${pad(now.getMinutes())}`,
  });
  const outputPath = uniqueOutputPath(writer, outputFolder(settings, sourcePath), base, FORMAT_EXTENSIONS[format]);

  await ensureParentFolders(writer, outputPath);
  if (binary) await writer.writeBinary(outputPath, bytes);
  else await writer.writeText(outputPath, text);

  return { outputPath, warnings: warnings.list() };
}

/**
 * Create any missing parent folders of `outputPath` (§7.4). A custom output
 * folder that doesn't exist yet must not fail the export with a generic error —
 * it's a fixable situation, so we create the folder chain first.
 */
async function ensureParentFolders(writer: VaultWriter, outputPath: string): Promise<void> {
  if (!writer.createFolder) return;
  const segments = normalize(outputPath).split("/");
  segments.pop(); // drop the filename
  let dir = "";
  for (const seg of segments) {
    dir = dir ? `${dir}/${seg}` : seg;
    if (!writer.exists(dir)) await writer.createFolder(dir);
  }
}

// ---- Batch folder export (Pro; §6.1, §7.3) ----

export interface BatchExportParams {
  adapter: VaultAdapter;
  writer: VaultWriter;
  settings: TrueExportSettings;
  folderPath: string;
  format: ExportFormat;
  template: TemplateId;
  deps?: ExportDeps;
  /** Abort to cancel mid-run (§7.3). */
  signal?: AbortSignal;
  /** Progress callback, fired after each note. */
  onProgress?: (done: number, total: number) => void;
}

export interface BatchResult {
  outputs: string[];
  warnings: ExportWarning[];
  failures: { path: string; error: string }[];
  total: number;
  cancelled: boolean;
}

/** Yield to the UI thread between notes so a big batch never blocks it (§7.3). */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function exportFolder(params: BatchExportParams): Promise<BatchResult> {
  const { adapter, writer, settings, folderPath, format, template, deps, signal, onProgress } = params;
  const notePaths = await adapter.listNotesInFolder(folderPath);

  const outputs: string[] = [];
  const warnings: ExportWarning[] = [];
  const failures: { path: string; error: string }[] = [];
  let cancelled = false;

  for (let i = 0; i < notePaths.length; i++) {
    if (signal?.aborted) {
      cancelled = true;
      break;
    }
    const sourcePath = notePaths[i];
    try {
      const result = await exportNote({ adapter, writer, settings, sourcePath, format, template, deps });
      outputs.push(result.outputPath);
      warnings.push(...result.warnings);
    } catch (error) {
      // One bad note must not abort the whole batch.
      failures.push({ path: sourcePath, error: error instanceof Error ? error.message : String(error) });
    }
    onProgress?.(i + 1, notePaths.length);
    await yieldToUi();
  }

  return { outputs, warnings, failures, total: notePaths.length, cancelled };
}

function outputFolder(settings: TrueExportSettings, sourcePath: string): string {
  switch (settings.outputLocation) {
    case "vault-root":
      return "";
    case "custom":
      return confineToVault(settings.customOutputFolder);
    default:
      return dirname(sourcePath);
  }
}

/** Never overwrite: append " (1)", " (2)", … on collision (§7.4). */
function uniqueOutputPath(writer: VaultWriter, folder: string, base: string, ext: string): string {
  const dir = folder ? `${folder.replace(/\/$/, "")}/` : "";
  let candidate = normalize(`${dir}${base}.${ext}`);
  let n = 1;
  while (writer.exists(candidate)) {
    candidate = normalize(`${dir}${base} (${n}).${ext}`);
    n++;
  }
  return candidate;
}
