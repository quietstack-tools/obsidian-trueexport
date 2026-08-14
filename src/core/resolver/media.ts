// src/core/resolver/media.ts
//
// Media resolution (§4.9). Reads image bytes through the VaultAdapter and
// produces a concrete MediaResource. Missing files degrade to a placeholder +
// warning; remote images are blocked by default (§7.6).
//
// JUDGMENT CALL: actually fetching a remote image (when the setting is on) is a
// network operation deferred to Stage 9. Stage 3 blocks remote images and warns
// regardless of the setting, so nothing here performs I/O beyond the vault.

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
    ctx.warnings.add({
      construct: "image",
      message: ctx.options.allowRemoteImages
        ? `Remote image "${path}" was not embedded (remote fetching is unavailable).`
        : `Remote image "${path}" was skipped. Enable "Allow remote images" in settings to embed it.`,
      line,
      sourcePath: fromPath,
    });
    return { kind: "remote-blocked", originalPath: path };
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
