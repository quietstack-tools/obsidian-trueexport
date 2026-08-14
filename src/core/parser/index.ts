// src/core/parser/index.ts
//
// parseMarkdown(): the pure, Obsidian-free entry point to the parser. It turns
// note source into the block-level portion of the IDM. Link/transclusion/media
// resolution — anything needing the vault — is the resolver's job (Stage 3);
// this stage never touches I/O.

import type { BlockNode, FootnoteDefinitionNode } from "../model/nodes";
import type { ExportOptions } from "../options";
import type { WarningCollector } from "../warnings";
import { SlugRegistry } from "../util/slug";
import { extractFrontmatter } from "./frontmatter";
import { makeUnsupported, parseBlocks, type Line } from "./blocks";

export interface ParseResult {
  /** Title from frontmatter `title`, else the note's basename. */
  title: string;
  frontmatter: Record<string, unknown>;
  blocks: BlockNode[];
  /** Footnote definitions, keyed by identifier. Empty until Stage 3. */
  footnotes: Map<string, FootnoteDefinitionNode>;
}

function basename(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  return dot === -1 ? file : file.slice(0, dot);
}

export function parseMarkdown(
  source: string,
  sourcePath: string,
  options: ExportOptions,
  warnings: WarningCollector,
): ParseResult {
  const normalized = source
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ".repeat(options.tabWidth));
  const rawLines = normalized.split("\n");

  const fm = extractFrontmatter(rawLines);
  if (fm.present && !fm.ok) {
    warnings.add({
      construct: "frontmatter",
      message: "Frontmatter could not be fully parsed; some properties may be missing.",
      line: 1,
      sourcePath,
    });
  }

  const ctx = { options, warnings, slugs: new SlugRegistry(), sourcePath };
  const blocks: BlockNode[] = [];

  // An Excalidraw note is a drawing, not exportable prose (§4.13).
  if (fm.present && Object.prototype.hasOwnProperty.call(fm.data, "excalidraw-plugin")) {
    blocks.push(makeUnsupported("excalidraw", "", 1, ctx));
  }

  const bodyLines: Line[] = fm.body.map((text, idx) => ({
    text,
    number: fm.consumedLines + idx + 1,
  }));
  blocks.push(...parseBlocks(bodyLines, ctx));

  const fmTitle = fm.data.title;
  const title = typeof fmTitle === "string" && fmTitle.trim() !== "" ? fmTitle : basename(sourcePath);

  return {
    title,
    frontmatter: fm.data,
    blocks,
    footnotes: new Map(),
  };
}
