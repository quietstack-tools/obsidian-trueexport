// src/docx/blocks.ts
//
// Block IDM → docx paragraphs and tables.
//   - Headings use built-in Heading styles → Word Navigation Pane outline, with
//     a Bookmark so internal links resolve.
//   - Lists use real numbering definitions (numbering.ts), never literal glyphs.
//   - Callouts and code blocks render as single-cell tables (survives Word,
//     Pages, Google Docs, LibreOffice — nested divs do not).

import {
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Bookmark,
  HeadingLevel,
  WidthType,
  BorderStyle,
  ShadingType,
  AlignmentType,
} from "docx";
import type {
  BlockNode,
  ListNode,
  CalloutNode,
  CodeBlockNode,
  ImageBlockNode,
} from "../core/model/nodes";
import { renderInline, buildImage, sanitizeAnchor, type InlineRun } from "./inline";
import { renderTable } from "./table";
import { COLORS, CODE_FONT, RUN_LANGUAGE, calloutColor, tint } from "./styles";
import type { RenderContext } from "./context";

type Rendered = Paragraph | Table;

interface BlockOpts {
  depth?: number;
  quote?: boolean;
}

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "auto" };

export function renderBlocks(blocks: BlockNode[], ctx: RenderContext, opts: BlockOpts = {}): Rendered[] {
  const out: Rendered[] = [];
  for (const block of blocks) out.push(...renderBlock(block, ctx, opts));
  return out;
}

function wrapBookmark(blockId: string | undefined, runs: InlineRun[], ctx: RenderContext): InlineRun[] {
  if (blockId && !ctx.bookmarks.has(blockId)) {
    ctx.bookmarks.add(blockId);
    return [new Bookmark({ id: sanitizeAnchor(blockId), children: runs })];
  }
  return runs;
}

function renderBlock(block: BlockNode, ctx: RenderContext, opts: BlockOpts): Rendered[] {
  switch (block.type) {
    case "heading": {
      const runs = renderInline(block.children, ctx);
      let children: InlineRun[] = runs;
      if (block.id && !ctx.bookmarks.has(block.id)) {
        ctx.bookmarks.add(block.id);
        children = [new Bookmark({ id: sanitizeAnchor(block.id), children: runs })];
      }
      return [new Paragraph({ heading: HEADING_LEVELS[block.level - 1], children })];
    }
    case "paragraph": {
      const runs = wrapBookmark(block.blockId, renderInline(block.children, ctx), ctx);
      return [new Paragraph({ style: opts.quote ? "Quote" : undefined, children: runs })];
    }
    case "list":
      return renderList(block, ctx, opts.depth ?? 0);
    case "table":
      return [renderTable(block, ctx)];
    case "callout":
      return [renderCallout(block, ctx)];
    case "codeBlock":
      return [renderCodeBlock(block, ctx)];
    case "blockquote":
      return renderBlocks(block.children, ctx, { quote: true, depth: opts.depth });
    case "thematicBreak":
      return [
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLORS.tableBorder, space: 1 } },
          children: [],
        }),
      ];
    case "imageBlock":
      return renderImageBlock(block, ctx);
    case "htmlBlock":
      return [
        new Paragraph({
          children: [new TextRun({ text: block.raw, style: "Code", language: RUN_LANGUAGE })],
        }),
      ];
    case "mathBlock":
      return [
        new Paragraph({ children: [new TextRun({ text: block.latex, style: "Code", language: RUN_LANGUAGE })] }),
      ];
    case "unsupported":
      return [
        new Paragraph({
          style: "Caption",
          children: [new TextRun({ text: `⟨${block.reason}⟩`, italics: true, language: RUN_LANGUAGE })],
        }),
      ];
    default:
      return [];
  }
}

function renderList(list: ListNode, ctx: RenderContext, depth: number): Rendered[] {
  const reference = ctx.numbering.register(list, depth);
  const out: Rendered[] = [];

  for (const item of list.children) {
    let placed = false;
    for (const child of item.children) {
      if (child.type === "list") {
        out.push(...renderList(child, ctx, depth + 1));
        continue;
      }
      if (child.type === "paragraph") {
        const runs = renderInline(child.children, ctx);
        if (item.checked !== undefined && !placed) {
          out.push(
            new Paragraph({
              indent: { left: (depth + 1) * 720, hanging: 360 },
              children: [new TextRun({ text: `${item.checked ? "☑" : "☐"}  `, language: RUN_LANGUAGE }), ...runs],
            }),
          );
        } else if (!placed) {
          out.push(new Paragraph({ numbering: { reference, level: depth }, children: runs }));
        } else {
          out.push(new Paragraph({ indent: { left: (depth + 1) * 720 }, children: runs }));
        }
        placed = true;
      } else {
        out.push(...renderBlock(child, ctx, { depth }));
      }
    }
    if (!placed) {
      out.push(new Paragraph({ numbering: { reference, level: depth }, children: [] }));
    }
  }

  return out;
}

function renderCallout(node: CalloutNode, ctx: RenderContext): Table {
  const color = calloutColor(node.calloutType);
  const background = tint(color);
  const title = new Paragraph({
    spacing: { after: 60 },
    children: renderInline(node.title, ctx, { bold: true }),
  });
  const body = renderBlocks(node.children, ctx, {});

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: NO_BORDER,
      bottom: NO_BORDER,
      right: NO_BORDER,
      left: { style: BorderStyle.SINGLE, size: 32, color }, // 4pt coloured left border
      insideHorizontal: NO_BORDER,
      insideVertical: NO_BORDER,
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill: background, color: "auto" },
            margins: { top: 120, bottom: 120, left: 160, right: 120 },
            children: [title, ...body],
          }),
        ],
      }),
    ],
  });
}

function renderCodeBlock(node: CodeBlockNode, ctx: RenderContext): Table {
  const lines = node.content.length > 0 ? node.content.split("\n") : [""];
  const paragraphs = lines.map(
    (line) =>
      new Paragraph({
        style: "CodeBlock",
        children: [
          new TextRun({
            text: line.length > 0 ? line : " ",
            font: CODE_FONT,
            size: 18,
            color: COLORS.code,
            language: RUN_LANGUAGE,
          }),
        ],
      }),
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: NO_BORDER,
      bottom: NO_BORDER,
      left: NO_BORDER,
      right: NO_BORDER,
      insideHorizontal: NO_BORDER,
      insideVertical: NO_BORDER,
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill: COLORS.codeFill, color: "auto" },
            margins: { top: 120, bottom: 120, left: 120, right: 120 },
            children: paragraphs,
          }),
        ],
      }),
    ],
  });
}

function renderImageBlock(node: ImageBlockNode, ctx: RenderContext): Paragraph[] {
  const built = buildImage(node, ctx);
  if ("placeholder" in built) {
    const b = { style: BorderStyle.SINGLE, size: 4, color: COLORS.tableBorder, space: 4 };
    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: { top: b, bottom: b, left: b, right: b },
        children: [new TextRun({ text: built.placeholder, italics: true, color: COLORS.caption, language: RUN_LANGUAGE })],
      }),
    ];
  }
  const paragraphs = [new Paragraph({ alignment: AlignmentType.CENTER, children: [built] })];
  if (node.caption) {
    paragraphs.push(new Paragraph({ style: "Caption", children: renderInline(node.caption, ctx) }));
  }
  return paragraphs;
}

/** Frontmatter rendered as a two-column table at the top of the body (§4.12). */
export function renderFrontmatterTable(frontmatter: Record<string, unknown>): Table {
  const b = { style: BorderStyle.SINGLE, size: 4, color: COLORS.tableBorder };
  const stringify = (v: unknown): string => {
    if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
    if (v !== null && typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  const rows = Object.entries(frontmatter).map(
    ([key, value]) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            margins: { top: 60, bottom: 60, left: 80, right: 80 },
            shading: { type: ShadingType.CLEAR, fill: COLORS.tableHeaderFill, color: "auto" },
            children: [new Paragraph({ children: [new TextRun({ text: key, bold: true, language: RUN_LANGUAGE })] })],
          }),
          new TableCell({
            margins: { top: 60, bottom: 60, left: 80, right: 80 },
            children: [new Paragraph({ children: [new TextRun({ text: stringify(value), language: RUN_LANGUAGE })] })],
          }),
        ],
      }),
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b },
    rows,
  });
}
