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

  async getModifiedTime(path: string): Promise<number | null> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? file.stat.mtime : null;
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
 * Render a Mermaid diagram to SVG using Obsidian's own Mermaid instance (§4.11),
 * by rendering a fenced mermaid block via MarkdownRenderer and extracting the
 * SVG. Version-dependent and DOM-based → a manual-verification seam; failure is
 * contained (the export layer degrades to a code block + warning).
 *
 * Obsidian's mermaid post-processing does not always finish inside the
 * `MarkdownRenderer.render()` promise — mermaid.js renders on its own
 * microtask/rAF schedule. Three follow-up findings from manual testing, in
 * order:
 *
 * 1. An early fix polled for "the svg has child elements" — not specific
 *    enough. Direct inspection of the actual embedded PNG showed a generic
 *    broken-image glyph (two overlapping rounded squares — an icon, not a
 *    flowchart), 48×48px, structurally valid as a PNG: consistent with
 *    capturing an SVG-based UI icon shown as a placeholder while mermaid
 *    was still initialising, which has real `<path>` children (satisfying
 *    the old check) but isn't mermaid's own output.
 * 2. Fix: `isMermaidDiagramSvg()` positively identifies real mermaid output
 *    (a mermaid-specific marker AND real content) instead of "has
 *    children". Still failed a re-test with a REAL captured diagram.
 * 3. Ground truth from a live-captured mermaid flowchart svg (Obsidian dev
 *    tools): id `m<hash>`, class `flowchart` — neither contains the
 *    literal substring "mermaid" anywhere (only inside unrelated <style>
 *    CSS variable names). But it DOES carry the node/edge/cluster/label
 *    descendant classes `isMermaidDiagramSvg()` already checked for. What
 *    it does NOT have is native SVG `<text>`/`<tspan>` elements — labels
 *    are HTML `<p>` inside `<foreignObject>` (mermaid.js's default label
 *    rendering strategy since v9), which the original text-content check
 *    didn't look for at all. `isMermaidDiagramSvg()` now checks
 *    `textContent` instead of `querySelector("text, tspan")`, which covers
 *    both rendering strategies. Also stopped assuming
 *    `el.querySelector("svg")` (first match) lands on the diagram rather
 *    than some other svg (e.g. a toolbar/zoom icon) Obsidian may render
 *    into the same container — now checks every svg in the container
 *    against the classifier.
 */
export function createMermaidRenderer(app: App): (source: string) => Promise<string> {
  return async (source) => {
    // Obsidian's Markdown post-processors — including whatever triggers
    // Mermaid's own rendering — only run for elements actually attached to
    // the document. A fully detached container (never appended anywhere)
    // makes MarkdownRenderer.render() fall back to plain syntax-highlighted
    // text for the fenced block, no diagram ever gets rendered, and no
    // classifier can succeed because there's nothing valid to find (root
    // cause confirmed via debug logging: candidateCount was always 1, and
    // that one candidate was the code block's own "copy" button icon, not
    // a placeholder or a mermaid SVG). Positioned off-screen rather than
    // hidden via display:none/visibility:hidden, since some layout-
    // dependent rendering paths skip work entirely for non-rendered
    // elements the same way a detached element does.
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.left = "-99999px";
    el.style.top = "0";
    document.body.appendChild(el);
    const component = new Component();
    try {
      await MarkdownRenderer.render(app, "```mermaid\n" + source + "\n```", el, "", component);
      const svg = await waitForRenderedSvg(el);
      if (!svg) throw new Error("Mermaid produced no SVG");
      return svg.outerHTML;
    } finally {
      component.unload();
      el.remove();
    }
  };
}

/**
 * Positively identify real mermaid diagram output, as opposed to a generic
 * placeholder/error icon that also happens to be an `<svg>` with child
 * elements (see createMermaidRenderer's doc comment for how this was
 * found). Exported for unit testing against synthetic DOM structures —
 * this codebase has no way to drive Obsidian's real mermaid rendering in
 * tests, but the classification logic itself is plain DOM inspection and
 * fully testable with jsdom.
 *
 * Requires BOTH:
 *  - A mermaid-specific marker: `id` or `class` containing "mermaid", OR a
 *    descendant carrying one of the CSS classes mermaid.js's own renderers
 *    always emit (node/edge/cluster/label groups — true across flowchart,
 *    sequence, class, state and other mermaid diagram types). A real
 *    diagram's own `id`/`class` often does NOT contain "mermaid" at all
 *    (e.g. `id="m0cd67588838a1682" class="flowchart"`, confirmed against a
 *    live-captured diagram) — the descendant-class check is what actually
 *    matches in that case, so the id/class substring check alone is not
 *    sufficient and must stay an "or", not the primary signal.
 *  - Non-empty `textContent`: every mermaid diagram element (flowchart
 *    boxes, sequence messages, state labels, …) renders a text label, a
 *    bare icon glyph never does. Checking `textContent` rather than
 *    `querySelector("text, tspan")` matters because mermaid.js's default
 *    label rendering uses HTML `<p>` inside `<foreignObject>`, not native
 *    SVG text elements — confirmed against the same live-captured diagram.
 */
export function isMermaidDiagramSvg(svg: SVGElement): boolean {
  const idAndClass = `${svg.id} ${svg.getAttribute("class") ?? ""}`.toLowerCase();
  const hasMermaidMarker =
    idAndClass.includes("mermaid") ||
    svg.querySelector(
      '[class*="node"], [class*="edge"], [class*="cluster"], [class*="label"], [class*="actor"], [class*="messageText"]',
    ) !== null;
  // NOT svg.querySelector("text, tspan"): confirmed against a real captured
  // mermaid flowchart svg (id="m<hash>", class="flowchart" — no "mermaid"
  // substring anywhere in either) that modern mermaid.js renders labels as
  // HTML <p> elements inside <foreignObject>, not native SVG <text>/<tspan>
  // — so that check rejected genuinely valid output (hasMermaidMarker was
  // true via the node/edge/label descendant classes; hasTextContent was the
  // one that wrongly failed). textContent covers both native SVG text and
  // foreignObject-embedded HTML text, so it doesn't matter which rendering
  // strategy a given mermaid version/diagram type uses.
  const hasTextContent = (svg.textContent ?? "").trim().length > 0;
  return hasMermaidMarker && hasTextContent;
}

/**
 * Poll for a positively-identified mermaid diagram svg, up to ~2s.
 *
 * Checks every `<svg>` in the container, not just the first one found:
 * Obsidian's mermaid block can render more than one svg into the same
 * container (e.g. a small toolbar/zoom-control icon alongside the actual
 * diagram), and `el.querySelector("svg")` — first match in document order —
 * has no guarantee of landing on the real diagram rather than a UI icon.
 */
export async function waitForRenderedSvg(el: HTMLElement): Promise<SVGElement | null> {
  const deadline = Date.now() + 2000;
  for (;;) {
    const match = Array.from(el.querySelectorAll("svg")).find(isMermaidDiagramSvg);
    if (match) return match;
    if (Date.now() >= deadline) return null; // give up — never got real diagram content, not just "nothing at all".
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

