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
import { renderDocx, type DocxDeps } from "./docx";
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
}

/**
 * Renderer dependencies. `htmlToPdf` is present only on desktop; its absence is
 * how the export path enforces "PDF is desktop-only" (§7.5).
 */
export interface ExportDeps extends DocxDeps {
  htmlToPdf?: HtmlToPdf;
  /** Render a Mermaid diagram to SVG via Obsidian's Mermaid instance (§4.11). */
  mermaidToSvg?: (source: string) => Promise<string>;
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

export async function exportNote(params: ExportParams): Promise<ExportResult> {
  const { adapter, writer, settings, sourcePath, format, template, deps } = params;
  const now = params.now ?? new Date();
  const options = settingsToExportOptions(settings, format, template);
  const warnings = new WarningCollector();
  const doc = await buildDocument(adapter, sourcePath, options, warnings);
  doc.blocks = await resolveMermaid(doc.blocks, deps, warnings, sourcePath);
  const pro = settings.licenceActivated;

  // Render fully in memory first; only then write, so a failure never leaves a
  // partial file on disk (§7.4).
  let binary: boolean;
  let text = "";
  let bytes: ArrayBuffer = new ArrayBuffer(0);
  if (format === "docx") {
    bytes = await renderDocx(doc, options, { deps, pro });
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

  if (binary) await writer.writeBinary(outputPath, bytes);
  else await writer.writeText(outputPath, text);

  return { outputPath, warnings: warnings.list() };
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
      return normalize(settings.customOutputFolder);
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
