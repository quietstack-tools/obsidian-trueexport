// src/obsidian-adapter.ts
//
// The real VaultAdapter (§3.4) implemented against Obsidian's App/Vault, plus
// the canvas-based SVG rasteriser for the DOCX renderer. This is the only file
// besides src/licence/ that may import from "obsidian" directly (R1/R2).

import { App, Component, MarkdownRenderer, TFile, normalizePath, requestUrl } from "obsidian";
import type { VaultAdapter } from "./core/adapter";
import type { RemoteImageFetcher } from "./core/resolver/context";

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  svg: "image/svg+xml",
  md: "text/markdown",
  pdf: "application/pdf",
};

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

/** Strip a wikilink subpath/alias, leaving just the note linkpath. */
function linkpathOf(linkText: string): string {
  return linkText.split("#")[0].split("|")[0].trim();
}

export class ObsidianVaultAdapter implements VaultAdapter {
  constructor(private readonly app: App) {}

  async readNote(path: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? this.app.vault.cachedRead(file) : null;
  }

  async readBinary(path: string): Promise<ArrayBuffer | null> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? this.app.vault.readBinary(file) : null;
  }

  resolveLink(linkText: string, fromPath: string): string | null {
    const linkpath = linkpathOf(linkText);
    if (linkpath === "") return null;
    // Obsidian's own shortest-unique-path resolution (matches the in-memory
    // test adapter's behaviour by delegating to the source of truth).
    const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, fromPath);
    return dest ? dest.path : null;
  }

  getMimeType(path: string): string {
    return MIME_TYPES[extensionOf(path)] ?? "application/octet-stream";
  }

  async listNotesInFolder(folderPath: string): Promise<string[]> {
    const prefix = normalizePath(folderPath).replace(/\/$/, "");
    return this.app.vault
      .getMarkdownFiles()
      .map((f) => f.path)
      .filter((p) => prefix === "" || prefix === "/" || p === prefix || p.startsWith(`${prefix}/`))
      .sort();
  }
}

/**
 * The opt-in remote-image fetch capability (§7.6) — the SECOND documented
 * network call in the codebase, wired only when the user enables remote images.
 * Uses Obsidian's requestUrl (CORS-free, works on mobile). Returns null on any
 * failure (network error, non-200, or a non-image content type) so the resolver
 * degrades to a placeholder + warning rather than aborting.
 */
export function createRemoteImageFetcher(): RemoteImageFetcher {
  return async (url) => {
    try {
      const res = await requestUrl({ url, method: "GET", throw: false });
      if (res.status < 200 || res.status >= 300) return null;
      const contentType = (res.headers?.["content-type"] ?? res.headers?.["Content-Type"] ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (!contentType.startsWith("image/")) return null;
      return { data: res.arrayBuffer, mimeType: contentType };
    } catch {
      return null;
    }
  };
}

/**
 * Rasterise an SVG to PNG using a canvas (§4.9). Word's SVG support is
 * unreliable, so DOCX embeds a raster copy. This can only exist in the Obsidian
 * environment (needs DOM/canvas), which is why it is injected into renderDocx
 * rather than living in pure core.
 */
export function createSvgRasterizer(): (svg: ArrayBuffer, scale: number) => Promise<{ data: ArrayBuffer }> {
  return async (svg, scale) => {
    const text = new TextDecoder().decode(svg);
    const blob = new Blob([text], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    try {
      const image = await loadImage(url);
      const width = Math.max(1, Math.round((image.naturalWidth || 300) * scale));
      const height = Math.max(1, Math.round((image.naturalHeight || 150) * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context unavailable");
      ctx.drawImage(image, 0, 0, width, height);
      const png = await canvasToPng(canvas);
      return { data: png };
    } finally {
      URL.revokeObjectURL(url);
    }
  };
}

/**
 * Render a Mermaid diagram to SVG using Obsidian's own Mermaid instance (§4.11),
 * by rendering a fenced mermaid block via MarkdownRenderer and extracting the
 * SVG. Version-dependent and DOM-based → a manual-verification seam; failure is
 * contained (the export layer degrades to a code block + warning).
 */
export function createMermaidRenderer(app: App): (source: string) => Promise<string> {
  return async (source) => {
    const el = document.createElement("div");
    const component = new Component();
    try {
      await MarkdownRenderer.render(app, "```mermaid\n" + source + "\n```", el, "", component);
      const svg = el.querySelector("svg");
      if (!svg) throw new Error("Mermaid produced no SVG");
      return svg.outerHTML;
    } finally {
      component.unload();
    }
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load SVG for rasterisation"));
    image.src = url;
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Canvas toBlob returned null"));
        return;
      }
      blob.arrayBuffer().then(resolve, reject);
    }, "image/png");
  });
}
