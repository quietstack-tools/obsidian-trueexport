// src/core/resolver/wikilink.ts
//
// Wikilink resolution (§4.2). Turns a parser-emitted unresolved internal link
// into either a working internal link (target also in this export) or plain
// styled text (resolvable elsewhere, or unresolvable + a warning). A raw
// `[[...]]` never survives — the parser already produced a LinkNode, and this
// step only ever yields a LinkNode or a TextNode.

import type { InlineNode, LinkNode, TextNode } from "../model/nodes";
import { toPlainText } from "../parser/inline";
import type { ResolveContext } from "./context";

export function resolveLinkNode(
  node: LinkNode,
  fromPath: string,
  ctx: ResolveContext,
  line?: number,
): InlineNode {
  const target = node.target;
  if (target.kind !== "internal") return node;

  const display: TextNode = { type: "text", value: toPlainText(node.children) };
  const resolvedPath = ctx.adapter.resolveLink(target.notePath, fromPath);

  if (resolvedPath === null) {
    ctx.warnings.add({
      construct: target.embed ? "transclusion" : "wikilink",
      message: `Link to "${target.notePath}" could not be resolved. Check the note exists in your vault.`,
      line,
      sourcePath: fromPath,
    });
    return display;
  }

  if (ctx.includedNotePaths.has(resolvedPath)) {
    const resolvedTarget: Extract<LinkNode["target"], { kind: "internal" }> = {
      kind: "internal",
      notePath: resolvedPath,
      resolved: true,
    };
    if (target.heading) resolvedTarget.heading = target.heading;
    if (target.blockId) resolvedTarget.blockId = target.blockId;
    return { type: "link", target: resolvedTarget, children: node.children };
  }

  // Resolvable, but the target is not part of this export → plain styled text,
  // not a broken link (§4.2.4). No warning: this is expected.
  return display;
}
