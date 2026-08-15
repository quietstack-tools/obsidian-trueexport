// src/core/resolver/media.ts
//
// Media resolution (§4.9). Reads image bytes through the VaultAdapter and
// produces a concrete MediaResource. Missing files degrade to a placeholder +
// warning; remote images are blocked by default (§7.6).
//
// Remote images (§7.6): OFF by default. When the user enables them AND a fetch
// capability is injected (ctx.fetchRemoteImage), the bytes are fetched; any
// failure degrades to a placeholder + warning and never aborts. The fetch
// itself lives outside core, so this file makes no direct network call (R1).

import type { MediaResource } from "../model/nodes";
import type { ResolveContext } from "./context";

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function candidatePaths(path: string, fromPath: string, ctx: ResolveContext): string[] {
  const candidates = new Set<string>();
  candidates.add(path);
  const dir = dirname(fromPath);
  if (dir !== "") candidates.add(`${dir}/${path}`);
  const resolved = ctx.adapter.resolveLink(path, fromPath);
  if (resolved) candidates.add(resolved);
  return [...candidates];
}

export async function loadMedia(
  path: string,
  fromPath: string,
  ctx: ResolveContext,
  line?: number,
): Promise<MediaResource> {
  if (/^https?:\/\//i.test(path)) {
    return loadRemote(path, ctx, fromPath, line);
  }

  for (const candidate of candidatePaths(path, fromPath, ctx)) {
    const bytes = await ctx.adapter.readBinary(candidate);
    if (bytes) {
      return {
        kind: "binary",
        data: bytes,
        mimeType: ctx.adapter.getMimeType(candidate),
        originalPath: path,
      };
    }
  }

  ctx.warnings.add({
    construct: "image",
    message: `Image not found: ${basename(path)}. Check the file exists in your vault.`,
    line,
    sourcePath: fromPath,
  });
  return { kind: "missing", originalPath: path };
}

/** Remote image handling (§7.6): default-off; fetch only when enabled + wired. */
async function loadRemote(
  path: string,
  ctx: ResolveContext,
  fromPath: string,
  line?: number,
): Promise<MediaResource> {
  // Disabled by default: never fetch; warn with the actionable remedy.
  if (!ctx.options.allowRemoteImages) {
    ctx.warnings.add({
      construct: "image",
      message: `Remote image "${path}" was skipped. Enable "Allow remote images" in settings to embed it.`,
      line,
      sourcePath: fromPath,
    });
    return { kind: "remote-blocked", originalPath: path };
  }

  // Enabled but no fetch capability in this context (e.g. a pre-scan, which
  // must do no network I/O): treat as blocked, silently.
  if (!ctx.fetchRemoteImage) {
    return { kind: "remote-blocked", originalPath: path };
  }

  const fetched = await ctx.fetchRemoteImage(path);
  if (fetched) {
    return { kind: "binary", data: fetched.data, mimeType: fetched.mimeType, originalPath: path };
  }

  // Network error / non-200 / non-image → placeholder + warning, never abort.
  ctx.warnings.add({
    construct: "image",
    message: `Remote image "${path}" could not be fetched and was shown as a placeholder.`,
    line,
    sourcePath: fromPath,
  });
  return { kind: "missing", originalPath: path };
}
