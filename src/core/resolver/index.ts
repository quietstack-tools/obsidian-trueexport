// src/core/resolver/index.ts
//
// resolveDocument(): turns a parsed note into a fully-resolved IdmDocument.
// This is the only core stage that reads the vault (through VaultAdapter).
//
// Responsibilities:
//   - Expand transclusions, with mandatory cycle detection and a depth limit
//     (§4.3). A self-referencing note terminates rather than hanging.
//   - Resolve wikilinks to internal links or plain text (§4.2).
//   - Load image bytes; missing/remote media degrade with a warning (§4.9).
//   - Number footnotes by order of first reference (§4.5).
//
// Content transcluded from another note is resolved with THAT note's path as
// the resolution base, so its relative links and images resolve correctly.

import type {
  BlockNode,
  FootnoteDefinitionNode,
  InlineNode,
  TableRow,
  UnsupportedNode,
} from "../model/nodes";
import type { IdmDocument } from "../model/document";
import { parseMarkdown, type ParseResult } from "../parser";
import type { ResolveContext } from "./context";
import { resolveLinkNode } from "./wikilink";
import { loadMedia } from "./media";
import { extractSection, cycleMessage, type EmbedTarget } from "./transclusion";

export type { ResolveContext } from "./context";

export async function resolveDocument(
  parsed: ParseResult,
  sourcePath: string,
  ctx: ResolveContext,
): Promise<IdmDocument> {
  const resolved = await resolveNote(parsed.blocks, sourcePath, [sourcePath], ctx);
  const { blocks, footnotes } = numberFootnotes(resolved, parsed.footnotes, sourcePath, ctx);
  return {
    title: parsed.title,
    frontmatter: parsed.frontmatter,
    blocks,
    footnotes,
    warnings: ctx.warnings.list(),
    sourcePath,
  };
}

/** Resolve a note's block list, expanding any block-level transclusions. */
async function resolveNote(
  blocks: BlockNode[],
  fromPath: string,
  chain: string[],
  ctx: ResolveContext,
): Promise<BlockNode[]> {
  const out: BlockNode[] = [];
  for (const block of blocks) {
    const embed = asBlockEmbed(block);
    if (embed) {
      const spliced = await expandTransclusion(embed, fromPath, chain, ctx, block.position?.line);
      out.push(...spliced);
      continue;
    }
    out.push(await resolveBlock(block, fromPath, chain, ctx));
  }
  return out;
}

/** A paragraph whose sole child is an embed link is a block-level transclusion. */
function asBlockEmbed(block: BlockNode): EmbedTarget | null {
  if (block.type !== "paragraph" || block.children.length !== 1) return null;
  const child = block.children[0];
  if (child.type === "link" && child.target.kind === "internal" && child.target.embed) {
    return child.target;
  }
  return null;
}

async function expandTransclusion(
  target: EmbedTarget,
  fromPath: string,
  chain: string[],
  ctx: ResolveContext,
  line?: number,
): Promise<BlockNode[]> {
  const resolvedPath = ctx.adapter.resolveLink(target.notePath, fromPath);
  if (!resolvedPath) {
    ctx.warnings.add({
      construct: "transclusion",
      message: `Transclusion "${target.notePath}" could not be resolved. Check the note exists in your vault.`,
      line,
      sourcePath: fromPath,
    });
    return [];
  }

  // Cycle detection is mandatory — without it a self-referencing note hangs.
  if (chain.includes(resolvedPath)) {
    const reason = `Circular transclusion detected: ${cycleMessage(chain, resolvedPath)}`;
    ctx.warnings.add({ construct: "transclusion", message: reason, line, sourcePath: fromPath });
    return [unsupportedTransclusion(reason, line)];
  }

  if (chain.length > ctx.options.transclusionDepth) {
    const reason = `Transclusion nesting exceeded ${ctx.options.transclusionDepth} levels.`;
    ctx.warnings.add({ construct: "transclusion", message: reason, line, sourcePath: fromPath });
    return [unsupportedTransclusion(reason, line)];
  }

  const content = await ctx.adapter.readNote(resolvedPath);
  if (content === null) {
    ctx.warnings.add({
      construct: "transclusion",
      message: `Transcluded note "${resolvedPath}" could not be read.`,
      line,
      sourcePath: fromPath,
    });
    return [];
  }

  // Frontmatter of the transcluded note is discarded (§4.3.6); parseMarkdown
  // already keeps it out of `blocks`.
  const subParsed = parseMarkdown(content, resolvedPath, ctx.options, ctx.warnings);
  const slice = extractSection(subParsed.blocks, target, resolvedPath, ctx, line);
  return resolveNote(slice, resolvedPath, [...chain, resolvedPath], ctx);
}

function unsupportedTransclusion(reason: string, line?: number): UnsupportedNode {
  const node: UnsupportedNode = { type: "unsupported", reason, raw: "", construct: "transclusion" };
  if (line !== undefined) node.position = { line };
  return node;
}

async function resolveBlock(
  block: BlockNode,
  fromPath: string,
  chain: string[],
  ctx: ResolveContext,
): Promise<BlockNode> {
  const line = block.position?.line;
  switch (block.type) {
    case "paragraph":
    case "heading":
      return { ...block, children: await resolveInlineArray(block.children, fromPath, ctx, line) };
    case "imageBlock":
      return { ...block, resource: await loadMedia(block.resource.originalPath, fromPath, ctx, line) };
    case "table":
      return {
        ...block,
        header: await resolveRow(block.header, fromPath, ctx, line),
        rows: await Promise.all(block.rows.map((r) => resolveRow(r, fromPath, ctx, line))),
      };
    case "blockquote":
      return { ...block, children: await resolveNote(block.children, fromPath, chain, ctx) };
    case "callout":
      return {
        ...block,
        title: await resolveInlineArray(block.title, fromPath, ctx, line),
        children: await resolveNote(block.children, fromPath, chain, ctx),
      };
    case "list":
      return {
        ...block,
        children: await Promise.all(
          block.children.map(async (item) => ({
            ...item,
            children: await resolveNote(item.children, fromPath, chain, ctx),
          })),
        ),
      };
    default:
      return block;
  }
}

async function resolveRow(
  row: TableRow,
  fromPath: string,
  ctx: ResolveContext,
  line?: number,
): Promise<TableRow> {
  return {
    cells: await Promise.all(
      row.cells.map(async (c) => ({
        children: await resolveInlineArray(c.children, fromPath, ctx, line),
      })),
    ),
  };
}

async function resolveInlineArray(
  nodes: InlineNode[],
  fromPath: string,
  ctx: ResolveContext,
  line?: number,
): Promise<InlineNode[]> {
  const out: InlineNode[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "link":
        out.push(resolveLinkNode(node, fromPath, ctx, line));
        break;
      case "inlineImage":
        out.push({ ...node, resource: await loadMedia(node.resource.originalPath, fromPath, ctx, line) });
        break;
      case "emphasis":
      case "strong":
      case "strikethrough":
      case "highlight":
      case "subscript":
      case "superscript":
        out.push({ ...node, children: await resolveInlineArray(node.children, fromPath, ctx, line) });
        break;
      default:
        out.push(node);
    }
  }
  return out;
}

// ---- Footnote numbering (§4.5) ----

function hasChildren(n: InlineNode): n is Extract<InlineNode, { children: InlineNode[] }> {
  return "children" in n;
}

function numberFootnotes(
  blocks: BlockNode[],
  defs: Map<string, FootnoteDefinitionNode>,
  sourcePath: string,
  ctx: ResolveContext,
): { blocks: BlockNode[]; footnotes: Map<string, FootnoteDefinitionNode> } {
  const order = new Map<string, number>();
  const unresolved = new Set<string>();

  function visitInlines(nodes: InlineNode[]): InlineNode[] {
    const out: InlineNode[] = [];
    for (const n of nodes) {
      if (n.type === "footnoteReference") {
        if (defs.has(n.identifier)) {
          if (!order.has(n.identifier)) order.set(n.identifier, order.size + 1);
          out.push({ ...n, assignedNumber: order.get(n.identifier) });
        } else {
          unresolved.add(n.identifier);
          // Reference with no definition → rendered as nothing (§4.5.4).
        }
      } else if (hasChildren(n)) {
        out.push({ ...n, children: visitInlines(n.children) });
      } else {
        out.push(n);
      }
    }
    return out;
  }

  function visitRow(r: TableRow): TableRow {
    return { cells: r.cells.map((c) => ({ children: visitInlines(c.children) })) };
  }

  function visitBlocks(bs: BlockNode[]): BlockNode[] {
    return bs.map((b) => {
      switch (b.type) {
        case "paragraph":
        case "heading":
          return { ...b, children: visitInlines(b.children) };
        case "callout":
          return { ...b, title: visitInlines(b.title), children: visitBlocks(b.children) };
        case "blockquote":
          return { ...b, children: visitBlocks(b.children) };
        case "list":
          return {
            ...b,
            children: b.children.map((it) => ({ ...it, children: visitBlocks(it.children) })),
          };
        case "table":
          return { ...b, header: visitRow(b.header), rows: b.rows.map(visitRow) };
        default:
          return b;
      }
    });
  }

  const newBlocks = visitBlocks(blocks);

  for (const id of unresolved) {
    ctx.warnings.add({
      construct: "footnote",
      message: `Footnote reference [^${id}] has no definition and was removed. Add a "[^${id}]: ..." definition.`,
      sourcePath,
    });
  }

  const footnotes = new Map<string, FootnoteDefinitionNode>();
  for (const [id, num] of [...order.entries()].sort((a, b) => a[1] - b[1])) {
    const def = defs.get(id) as FootnoteDefinitionNode;
    footnotes.set(id, { ...def, assignedNumber: num });
  }
  for (const id of defs.keys()) {
    if (!order.has(id)) {
      ctx.warnings.add({
        construct: "footnote",
        message: `Footnote definition [^${id}] is never referenced and was omitted.`,
        sourcePath,
      });
    }
  }

  return { blocks: newBlocks, footnotes };
}
