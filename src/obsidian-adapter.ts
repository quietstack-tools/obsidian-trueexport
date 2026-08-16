// src/obsidian-adapter.ts
//
// The real VaultAdapter (§3.4) implemented against Obsidian's App/Vault, plus
// the canvas-based SVG rasteriser for the DOCX renderer. This is the only file
// besides src/licence/ that may import from "obsidian" directly (R1/R2).

import { App, Component, MarkdownRenderer, TFile, normalizePath } from "obsidian";
import DOMPurify from "dompurify";
import type { VaultAdapter } from "./core/adapter";
import type { RemoteImageFetcher } from "./core/resolver/context";
import { safeRemoteImageUrl } from "./core/util/url";

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

const MAX_REDIRECT_HOPS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * The opt-in remote-image fetch capability (§7.6) — the SECOND documented
 * network call in the codebase, wired only when the user enables remote images.
 *
 * SSRF hardening: `safeRemoteImageUrl` validates the initial target, but that is
 * not enough on its own — a public host can 30x-redirect to an internal address.
 * Obsidian's requestUrl follows redirects blindly with no hook to inspect the
 * chain (its RequestUrlParam has no redirect option), so we drive the request
 * with the platform's fetch using redirect:"manual" and re-validate EVERY hop's
 * target against the same allow-list before following it, up to MAX_REDIRECT_HOPS.
 * Any blocked hop, an un-inspectable (opaque) redirect, or too many hops → null,
 * which the resolver degrades to a placeholder + warning. `fetchImpl` is
 * injectable so tests never touch the network.
 */
export function createRemoteImageFetcher(fetch: typeof globalThis.fetch = globalThis.fetch): RemoteImageFetcher {
  return async (url) => {
    let current = safeRemoteImageUrl(url);
    if (current === null) return null;
    try {
      for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
        const res = await fetch(current, { method: "GET", redirect: "manual" });

        // A cross-origin redirect the runtime won't let us inspect: refuse
        // rather than risk following it to an internal host.
        if (res.type === "opaqueredirect") return null;

        if (REDIRECT_STATUSES.has(res.status)) {
          const location = res.headers.get("location");
          if (!location) return null;
          // Resolve relative Locations against the current URL, then re-validate.
          const next = safeRemoteImageUrl(new URL(location, current).toString());
          if (next === null) return null; // redirect target is blocked → refuse
          current = next;
          continue;
        }

        if (!res.ok) return null;
        const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (!contentType.startsWith("image/")) return null;
        return { data: await res.arrayBuffer(), mimeType: contentType };
      }
      return null; // exceeded the redirect-hop limit
    } catch {
      return null;
    }
  };
}

/**
 * The injected HTML-sanitiser capability. Runs DOMPurify against the real DOM
 * that exists in the Obsidian runtime — src/core and src/html stay DOM-free
 * (R1/R2), so DOMPurify is imported ONLY here and threaded in as a dependency,
 * exactly like the SVG rasteriser and Mermaid renderer. Used to clean raw HTML
 * blocks from a note before they are emitted into an export (which is opened
 * outside Obsidian's own sandbox). The renderer's regex sanitiser remains as an
 * always-on baseline; this is the stronger, DOM-accurate primary pass.
 */
export function createHtmlSanitizer(): (html: string) => string {
  const purify = DOMPurify(window);
  return (html) =>
    purify.sanitize(html, {
      USE_PROFILES: { html: true }, // no <script>, no SVG/MathML passthrough
      FORBID_TAGS: ["form", "iframe", "object", "embed", "base", "meta", "link"],
    });
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
