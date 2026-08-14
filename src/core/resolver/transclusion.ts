// src/core/resolver/transclusion.ts
//
// Helpers for transclusion resolution (§4.3): extracting the requested slice of
// a target note (whole note, a heading section, or a single block), and the
// human-readable messages for the two failure guards — cycle detection and the
// depth limit. Orchestration (reading, parsing, recursion) lives in index.ts.

import type { BlockNode, HeadingNode, LinkNode } from "../model/nodes";
import { slugify } from "../util/slug";
import { toPlainText } from "../parser/inline";
import type { ResolveContext } from "./context";

export type EmbedTarget = Extract<LinkNode["target"], { kind: "internal" }>;

function noteName(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  return dot === -1 ? file : file.slice(0, dot);
}

/** "A → B → A" style chain description for a circular-transclusion warning. */
export function cycleMessage(chain: string[], repeated: string): string {
  return [...chain, repeated].map(noteName).join(" → ");
}

function headingMatches(heading: HeadingNode, wanted: string): boolean {
  if (heading.id && heading.id === slugify(wanted)) return true;
  return toPlainText(heading.children).trim().toLowerCase() === wanted.trim().toLowerCase();
}

/** Depth-first search for the first block carrying `blockId`. */
function findBlockById(blocks: BlockNode[], blockId: string): BlockNode | null {
  for (const block of blocks) {
    if (block.blockId === blockId) return block;
    const children = childBlocks(block);
    if (children) {
      const found = findBlockById(children, blockId);
      if (found) return found;
    }
  }
  return null;
}

function childBlocks(block: BlockNode): BlockNode[] | null {
  switch (block.type) {
    case "blockquote":
    case "callout":
      return block.children;
    case "list":
      return block.children.flatMap((item) => item.children);
    default:
      return null;
  }
}

/**
 * Extract the slice of `blocks` a transclusion targets. Warns (never throws)
 * when a requested heading or block cannot be found, returning an empty slice.
 */
export function extractSection(
  blocks: BlockNode[],
  target: EmbedTarget,
  fromPath: string,
  ctx: ResolveContext,
  line?: number,
): BlockNode[] {
  if (target.heading) {
    const startIndex = blocks.findIndex(
      (b) => b.type === "heading" && headingMatches(b, target.heading as string),
    );
    if (startIndex === -1) {
      ctx.warnings.add({
        construct: "transclusion",
        message: `Heading "${target.heading}" not found in the transcluded note.`,
        line,
        sourcePath: fromPath,
      });
      return [];
    }
    const startLevel = (blocks[startIndex] as HeadingNode).level;
    const out: BlockNode[] = [blocks[startIndex]];
    for (let i = startIndex + 1; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type === "heading" && b.level <= startLevel) break;
      out.push(b);
    }
    return out;
  }

  if (target.blockId) {
    const block = findBlockById(blocks, target.blockId);
    if (!block) {
      ctx.warnings.add({
        construct: "transclusion",
        message: `Block "^${target.blockId}" not found in the transcluded note.`,
        line,
        sourcePath: fromPath,
      });
      return [];
    }
    return [block];
  }

  // Whole note. Frontmatter is already excluded (it lives outside `blocks`).
  return blocks;
}
