// src/obsidian-adapter.ts
//
// The real VaultAdapter (§3.4) implemented against Obsidian's App/Vault, plus
// the canvas-based SVG rasteriser for the DOCX renderer. This is the only file
// besides src/licence/ that may import from "obsidian" directly (R1/R2).

import { App, Component, MarkdownRenderer, TFile, normalizePath, requestUrl } from "obsidian";
import * as DOMPurifyModule from "dompurify";
import type { VaultAdapter } from "./core/adapter";
import type { RemoteImageFetcher } from "./core/resolver/context";
import { safeRemoteImageUrl } from "./core/util/url";

// DOMPurify ships CJS `export =` types (tsc, classic node resolution, sees the
// namespace AS the callable factory) but an ESM `default` build (what the bundler
// loads, where the namespace is { default: factory }). Reconcile both shapes to
// the callable factory here — no `any`, and no tsconfig relaxation needed.
const createDOMPurify =
  (DOMPurifyModule as unknown as { default?: typeof DOMPurifyModule }).default ?? DOMPurifyModule;

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
 * A structural subset of Obsidian's `requestUrl` — just the request fields we
 * set and the response fields we read. Injectable so tests never touch the
 * network; the real `requestUrl` is assignable to it.
 */
export interface RemoteRequestResponse {
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
}
export type RequestUrlLike = (param: {
  url: string;
  method?: string;
  throw?: boolean;
}) => Promise<RemoteRequestResponse>;

/**
 * The opt-in remote-image fetch capability (§7.6) — the SECOND documented
 * network call in the codebase, wired only when the user enables remote images.
 *
 * Transport: Obsidian's `requestUrl`, which runs in the Electron MAIN process
 * and is therefore free of CORS restrictions. This is deliberate and load-
 * bearing: most image hosts do NOT send an `Access-Control-Allow-Origin` header,
 * so a renderer `fetch` (default mode "cors") is blocked from reading their bytes
 * and every such image silently degrades to a placeholder. requestUrl reads them.
 *
 * SSRF hardening:
 *   - The INITIAL url is always validated against the allow-list
 *     (`safeRemoteImageUrl`: http/https only; loopback / private / link-local
 *     hosts refused) before any request is made.
 *   - Redirects: if requestUrl SURFACES a redirect (a 3xx status with a Location
 *     header, i.e. it does not follow the hop itself) we re-validate that hop's
 *     target against the same allow-list before following it, up to
 *     MAX_REDIRECT_HOPS. A blocked hop, a missing Location, or too many hops
 *     → null, which the resolver degrades to a placeholder + warning.
 *
 * Accepted residual risk (documented tradeoff): requestUrl exposes no per-hop
 * hook, and on current Obsidian it follows redirects internally, returning only
 * the final response with no way to see or veto the intermediate targets and no
 * final-URL field. So a public host that 30x-redirects to an internal address is
 * NOT caught when requestUrl follows the redirect itself. The alternative — a
 * renderer `fetch` with redirect:"manual" that inspects every hop (what a prior
 * hardening pass shipped) — CANNOT read the majority of hosts at all because of
 * CORS, which made the whole feature broken for the common case. We accept the
 * redirect gap to restore a working feature. It is bounded by two facts: only an
 * `image/*` content-type response is embedded (cloud-metadata / admin JSON
 * endpoints are rejected at that gate), and the feature is opt-in and off by
 * default. `requestFn` is injectable so tests never touch the network.
 */
export function createRemoteImageFetcher(requestFn: RequestUrlLike = requestUrl): RemoteImageFetcher {
  return async (url) => {
    let current = safeRemoteImageUrl(url);
    if (current === null) return null;
    try {
      for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
        // throw:false so an HTTP error status resolves (we treat it as a miss)
        // rather than rejecting; genuine network errors still reject → caught.
        const res = await requestFn({ url: current, method: "GET", throw: false });
        const headers = lowerCaseKeys(res.headers);

        if (REDIRECT_STATUSES.has(res.status)) {
          const location = headers["location"];
          if (!location) return null;
          // Resolve relative Locations against the current URL, then re-validate.
          const next = safeRemoteImageUrl(new URL(location, current).toString());
          if (next === null) return null; // redirect target is blocked → refuse
          current = next;
          continue;
        }

        if (res.status < 200 || res.status >= 300) return null;
        const contentType = (headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (!contentType.startsWith("image/")) return null;
        return { data: res.arrayBuffer, mimeType: contentType };
      }
      return null; // exceeded the redirect-hop limit
    } catch {
      return null;
    }
  };
}

/** Header names are case-insensitive; requestUrl casing varies by platform. */
function lowerCaseKeys(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) out[k.toLowerCase()] = v;
  return out;
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
  const purify = createDOMPurify(window);
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
