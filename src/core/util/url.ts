// src/core/util/url.ts
//
// URL safety helpers, shared by the HTML and DOCX renderers and the remote-image
// fetcher. Pure functions, zero I/O, zero Obsidian imports (R1) so they are unit
// testable without a DOM or a network.
//
// Two distinct concerns:
//   1. safeExternalUrl()  — hyperlink hrefs in exported HTML/DOCX. Blocks active
//      schemes (javascript:, vbscript:, data:, file: …) that would run script or
//      read local files when the exported document is opened outside Obsidian.
//   2. safeRemoteImageUrl() — the opt-in remote-image fetch (§7.6). Adds SSRF
//      protection on top of the scheme check by refusing hosts that resolve to
//      loopback / private / link-local space (e.g. cloud metadata at
//      169.254.169.254, http://localhost admin panels).

/** Schemes we allow to appear as a hyperlink target in exported documents. */
const LINK_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

// C0 control chars + space. Browsers strip these before resolving a URL scheme,
// so we strip them for detection too (defeats "java\tscript:" tricks).
const IGNORED_IN_SCHEME = /[\u0000-\u0020]/g;

/**
 * Return a safe href for an external link, or null if the URL uses a scheme that
 * could execute script or reach local resources. A URL with no scheme (a
 * relative path or a bare "#anchor") is treated as safe and returned as-is.
 */
export function safeExternalUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed === "") return null;
  const probe = trimmed.replace(IGNORED_IN_SCHEME, "");
  const scheme = probe.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  // No scheme → relative URL or fragment; safe.
  if (!scheme) return trimmed;
  return LINK_SCHEMES.has(scheme[1].toLowerCase()) ? trimmed : null;
}

/**
 * Validate a remote-image URL before fetching. Requires http/https and rejects
 * hosts in loopback / private / link-local ranges to blunt SSRF. Returns the URL
 * (normalised by the URL parser) or null if it must not be fetched.
 *
 * Residual risk: a public host that HTTP-redirects to an internal one is not
 * caught here (the redirect is followed by the platform's requestUrl). This is
 * documented next to the "Allow remote images" setting.
 */
export function safeRemoteImageUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") return null;
  if (isBlockedHost(parsed.hostname)) return null;
  return parsed.toString();
}

/** True for hosts that must never be the target of a remote fetch. */
export function isBlockedHost(hostname: string): boolean {
  // URL parser wraps IPv6 literals in brackets.
  const host = hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (host === "") return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  // Common internal / metadata pseudo-TLDs.
  if (host.endsWith(".internal") || host.endsWith(".local")) return true;

  if (isIpv4(host)) return isBlockedIpv4(host);
  if (host.includes(":")) return isBlockedIpv6(host);
  return false;
}

function isIpv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function isBlockedIpv4(host: string): boolean {
  const parts = host.split(".").map((p) => Number(p));
  if (parts.some((p) => p > 255)) return true; // malformed → treat as unsafe
  const [a, b] = parts;
  if (a === 0 || a === 127 || a === 10) return true; // this-host, loopback, private
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (RFC 6598)
  return false;
}

function isBlockedIpv6(host: string): boolean {
  if (host === "::1" || host === "::") return true; // loopback, unspecified
  if (host.startsWith("fe80")) return true; // link-local
  if (host.startsWith("fc") || host.startsWith("fd")) return true; // unique-local (fc00::/7)
  // IPv4-mapped (::ffff:127.0.0.1) — defer to the IPv4 rules.
  const mapped = host.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return false;
}
