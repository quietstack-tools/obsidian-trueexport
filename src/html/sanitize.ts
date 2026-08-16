// src/html/sanitize.ts
//
// Defence-in-depth sanitiser for raw HTML blocks (§4-html). Obsidian's reading
// view runs untrusted note HTML through DOMPurify; an export turns notes into
// files opened OUTSIDE that sandbox, so we must not emit note HTML verbatim.
//
// The primary control is the strict Content-Security-Policy the renderer puts in
// the document <head> (no scripts, no external loads). This sanitiser is the
// second layer: it neutralises the active vectors in the markup itself so a
// pasted export, an old renderer, or a stripped CSP still can't run script or
// phone home. It is deliberately conservative — when in doubt it removes.
//
// Pure string function: no DOM dependency, unit-testable in core-style tests.

// Elements removed entirely, including their content: they execute code or pull
// remote resources with no useful textual fallback.
const DROP_WITH_CONTENT = ["script", "style", "iframe", "object", "embed", "applet", "noscript", "template"];

// Elements whose tags we strip (keeping any inner text), because they can load
// remote content, redirect, or inject markup.
const DROP_TAG_ONLY = ["base", "meta", "link", "frame", "frameset", "form", "svg", "math", "portal"];

// Attribute values with these schemes can run script; blank the attribute.
// data: is allowed only for images (data:image/...) elsewhere; in raw HTML we
// drop it wholesale to avoid data:text/html and friends.
const DANGEROUS_SCHEME = /^\s*(?:javascript|vbscript|data|file|blob):/i;

/** Sanitise a raw HTML block before it is emitted into the exported document. */
export function sanitizeRawHtml(raw: string): string {
  let html = raw;

  // 1. Remove script/style/iframe/etc. elements with their content. The [^]
  //    class matches across newlines.
  for (const tag of DROP_WITH_CONTENT) {
    const el = new RegExp(`<${tag}\\b[^>]*>[^]*?</${tag}\\s*>`, "gi");
    html = html.replace(el, "");
    // …and any unclosed/self-closed opener left behind.
    html = html.replace(new RegExp(`<${tag}\\b[^>]*>`, "gi"), "");
  }

  // 2. Strip the opening/closing tags of remote-loading / redirecting elements
  //    but keep their inner text.
  for (const tag of DROP_TAG_ONLY) {
    html = html.replace(new RegExp(`</?${tag}\\b[^>]*>`, "gi"), "");
  }

  // 3. Remove inline event-handler attributes (onclick, onerror, onload, …).
  html = html.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  html = html.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
  html = html.replace(/\son[a-z]+\s*=\s*[^\s">]+/gi, "");

  // 4. Neutralise dangerous URL schemes in any attribute (href, src, srcset,
  //    formaction, xlink:href, poster, background, …).
  html = html.replace(
    /(\s(?:[a-z-]+:)?[a-z-]+\s*=\s*)("|')([^"']*)\2/gi,
    (match, prefix: string, quote: string, value: string) =>
      DANGEROUS_SCHEME.test(value) ? "" : match,
  );

  return html;
}
