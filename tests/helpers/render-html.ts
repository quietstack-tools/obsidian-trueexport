// tests/helpers/render-html.ts
//
// Resolve a note and render it to a single self-contained HTML string.

import { renderHtml, type HtmlRenderOptions } from "../../src/html";
import { defaultExportOptions, type ExportOptions } from "../../src/core/options";
import { resolve, type ResolveOptions } from "./resolve";
import type { ExportWarning } from "../../src/core/warnings";

export { pngBytes } from "./render-docx";

export interface HtmlResult {
  html: string;
  warnings: ExportWarning[];
}

export async function renderToHtml(
  source: string,
  resolveOpts: ResolveOptions = {},
  renderOpts: HtmlRenderOptions = {},
): Promise<HtmlResult> {
  const options: ExportOptions = { ...defaultExportOptions(), ...resolveOpts.options };
  const { doc, warnings } = await resolve(source, resolveOpts);
  const html = renderHtml(doc, options, renderOpts);
  return { html, warnings };
}
