// tests/helpers/render-docx.ts
//
// Resolve a note, render it to DOCX, and unzip the result for structural
// assertions (TECH_SPEC §9.3).

// jszip's types use `export =`; a namespace import is the ESM-correct way to
// consume it without relaxing esModuleInterop project-wide. We only use the
// static JSZip.loadAsync here.
import * as JSZip from "jszip";
import { renderDocx, type DocxRenderOptions } from "../../src/docx";
import { defaultExportOptions, type ExportOptions } from "../../src/core/options";
import { resolve, type ResolveOptions } from "./resolve";

/** A valid 1×1 PNG, for image-embedding tests. */
export function pngBytes(): ArrayBuffer {
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

export interface RenderResult {
  buffer: ArrayBuffer;
  zip: JSZip;
  documentXml: string;
  entries: string[];
  hasEntry(path: string): boolean;
}

export async function renderToDocx(
  source: string,
  resolveOpts: ResolveOptions = {},
  renderOpts: DocxRenderOptions = {},
): Promise<RenderResult> {
  const options: ExportOptions = { ...defaultExportOptions(), ...resolveOpts.options };
  const { doc } = await resolve(source, resolveOpts);
  const buffer = await renderDocx(doc, options, renderOpts);
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml")!.async("string");
  return {
    buffer,
    zip,
    documentXml,
    entries: Object.keys(zip.files),
    hasEntry: (path: string) => zip.file(path) !== null,
  };
}
