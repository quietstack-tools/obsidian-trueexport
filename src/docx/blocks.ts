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
  HeightRule,
} from "docx";
import type {
  BlockNode,
  ListNode,
  CalloutNode,
  CodeBlockNode,
  ImageBlockNode,
} from "../core/model/nodes";
import { renderInline, buildImage, sanitizeAnchor, type InlineRun } from "./inline";
import { latexToMath } from "./math";
import { renderTable } from "./table";
import { toPlainText } from "../core/parser/inline";
import { hasRtl } from "../core/util/text";
import { COLORS, CODE_FONT, RUN_LANGUAGE, calloutColor, calloutIcon, tint } from "./styles";
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
      return [
        new Paragraph({
          heading: HEADING_LEVELS[block.level - 1],
          bidirectional: hasRtl(toPlainText(block.children)) || undefined,
          children,
        }),
      ];
    }
    case "paragraph": {
      const runs = wrapBookmark(block.blockId, renderInline(block.children, ctx), ctx);
      return [
        new Paragraph({
          style: opts.quote ? "Quote" : undefined,
          bidirectional: hasRtl(toPlainText(block.children)) || undefined,
          children: runs,
        }),
      ];
    }
    case "list":
      return renderList(block, ctx, opts.depth ?? 0);
    case "table":
      return [renderTable(block, ctx)];
    case "callout":
      return renderCallout(block, ctx);
    case "codeBlock":
      return renderCodeBlock(block, ctx);
    case "blockquote":
      return renderBlocks(block.children, ctx, { quote: true, depth: opts.depth });
    case "thematicBreak":
      return renderThematicBreak();
    case "imageBlock":
      return renderImageBlock(block, ctx);
    case "htmlBlock":
      return [
        new Paragraph({
          children: [new TextRun({ text: block.raw, style: "Code", language: RUN_LANGUAGE })],
        }),
      ];
    case "mathBlock":
      try {
        return [new Paragraph({ alignment: AlignmentType.CENTER, children: [latexToMath(block.latex)] })];
      } catch {
        // Conversion failure → raw LaTeX in monospace (§4.10).
        return [
          new Paragraph({ children: [new TextRun({ text: block.latex, style: "Code", language: RUN_LANGUAGE })] }),
        ];
      }
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

/**
 * A horizontal rule, rendered as a 1×1 table with only a bottom border —
 * same pattern as renderCallout/renderCodeBlock below (see the file header
 * comment: single-cell tables survive Word, Pages, Google Docs and
 * LibreOffice; nested constructs don't).
 *
 * Three paragraph-border attempts (a plain w:pBdr/w:bottom on an empty
 * paragraph; the same plus explicit spacing and a paragraph-mark rPr size;
 * the same plus an actual run, first with empty text then with a
 * non-breaking space) were all confirmed by manual testing to render
 * correctly in Word but leave the rule invisible in Apple Pages. A first
 * table attempt (attempt 4, table-level w:tblBorders only, empty cell
 * paragraph) was inspected before manual re-test and had two gaps: no
 * cell-level w:tcBorders (relying on Word-style inheritance from the table,
 * which Pages may not replicate) and an empty cell paragraph with no run
 * (the same zero-height risk as the very first paragraph attempt, just
 * nested inside a cell). Attempt 5 fixes both: the bottom border is set at
 * BOTH table and cell level (belt and suspenders — no reliance on
 * inheritance), the cell paragraph carries a real non-breaking-space run,
 * and the row has an explicit minimum height so the cell can't collapse.
 *
 * Attempt 6: the table rendered in Pages for the first time, but at only
 * ~15-20px wide instead of the full text column. docx's `Table` defaults
 * `columnWidths` (the w:tblGrid/w:gridCol value) to 100 twips (~0.07in)
 * per column when not given explicitly — Word treats that as a soft hint
 * and defers to the w:tblW percentage, but Pages appears to size the
 * column from gridCol literally. `columnWidths` is set explicitly below
 * to the usable page width (A4, 1in margins each side — see the page
 * setup in src/docx/index.ts) so gridCol is realistic even though
 * w:tblW: 100% is what actually determines the rendered width in Word.
 *
 * Known limitation (as of attempt 6, confirmed by manual testing): renders
 * as a full rectangle (all four borders visible) in LibreOffice Writer,
 * despite spec-correct w:val=nil/none border suppression that works
 * correctly in Word, Pages, and Google Docs. Attempted fixes: nil vs none
 * border values (attempt 7), cell shading instead of borders (attempt 8) —
 * neither improved on this without regressing other renderers (attempt 8
 * turned the rule into a thick gray bar in both LibreOffice AND Pages).
 * Accepted as a known LibreOffice-specific limitation, lowest priority
 * among the four target renderers.
 *
 * The paragraph-based version carried its own w:spacing (120 twips/6pt
 * before and after) directly on the rule paragraph. A Table has no
 * equivalent "spacing after" property in OOXML, and the row's own height
 * (60 twips, just enough to keep the cell from collapsing) isn't spacing —
 * converting to a table silently dropped the after-gap, confirmed by manual
 * testing as noticeably tighter than before. Restored by appending an
 * invisible spacer paragraph (no border, no visible content) with the same
 * 120-twip after-spacing right after the table — the standard way to add
 * space after a table in OOXML, since tables can't carry that property
 * themselves.
 */
const FULL_WIDTH_TWIPS = 9026; // A4 (11906 twips) minus 1in (1440 twips) margins each side.
// Matches the original paragraph-based rule's before/after spacing. Also
// used for callout/code-block tables below — none of docx's Table types
// carry an OOXML "spacing after" property, so every single-cell table in
// this file needs the same invisible-spacer-paragraph treatment to get
// after-spacing at all (see tableSpacer()).
const TABLE_AFTER_SPACING_TWIPS = 120;

/**
 * An invisible paragraph (no border, no visible content) that exists only to
 * carry w:spacing w:after — the standard OOXML way to add space after a
 * table, since Table itself has no equivalent property.
 */
function tableSpacer(afterTwips: number = TABLE_AFTER_SPACING_TWIPS): Paragraph {
  return new Paragraph({ spacing: { before: 0, after: afterTwips }, children: [] });
}

function renderThematicBreak(): Rendered[] {
  const bottom = { style: BorderStyle.SINGLE, size: 6, color: COLORS.tableBorder };
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [FULL_WIDTH_TWIPS],
    borders: {
      top: NO_BORDER,
      left: NO_BORDER,
      right: NO_BORDER,
      bottom,
      insideHorizontal: NO_BORDER,
      insideVertical: NO_BORDER,
    },
    rows: [
      new TableRow({
        height: { value: 60, rule: HeightRule.ATLEAST },
        children: [
          new TableCell({
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
            borders: { top: NO_BORDER, left: NO_BORDER, right: NO_BORDER, bottom },
            children: [
              new Paragraph({
                spacing: { before: 0, after: 0 },
                children: [new TextRun({ text: "\u00A0", size: 2 })],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  return [table, tableSpacer()];
}

/**
 * Callouts and code blocks are single-cell tables (see the file header
 * comment), which means they share the thematicBreak table's "no OOXML
 * spacing-after property" gap: rendered flush against whatever follows,
 * with no equivalent of the visible gap Obsidian's own editor shows between
 * adjacent callouts. Both get the same tableSpacer() fix.
 */
function renderCallout(node: CalloutNode, ctx: RenderContext): Rendered[] {
  const color = calloutColor(node.calloutType);
  const icon = calloutIcon(node.calloutType);
  const background = tint(color);
  const title = new Paragraph({
    spacing: { after: 60 },
    children: [
      new TextRun({ text: `${icon} `, bold: true, color, language: RUN_LANGUAGE }),
      ...renderInline(node.title, ctx, { bold: true }),
    ],
  });
  const body = renderBlocks(node.children, ctx, {});

  const table = new Table({
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

  return [table, tableSpacer()];
}

function renderCodeBlock(node: CodeBlockNode, ctx: RenderContext): Rendered[] {
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

  const table = new Table({
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

  return [table, tableSpacer()];
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
