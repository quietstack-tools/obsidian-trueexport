// src/docx/table.ts
//
// Data tables (§4.6). Full-width with WidthType.PERCENTAGE 100 — fixed widths
// render inconsistently across Word, Pages and Google Docs. Header row is bold,
// shaded, and marked as a header so it repeats across page breaks.

import {
  Table,
  TableRow,
  TableCell,
  Paragraph,
  WidthType,
  BorderStyle,
  ShadingType,
  AlignmentType,
} from "docx";
import type { TableNode, TableAlignment, TableCell as IdmCell } from "../core/model/nodes";
import { renderInline } from "./inline";
import { COLORS } from "./styles";
import type { RenderContext } from "./context";

const CELL_MARGINS = { top: 80, bottom: 80, left: 80, right: 80 };

function border() {
  return { style: BorderStyle.SINGLE, size: 4, color: COLORS.tableBorder };
}

function alignmentFor(a: TableAlignment | null): (typeof AlignmentType)[keyof typeof AlignmentType] {
  if (a === "center") return AlignmentType.CENTER;
  if (a === "right") return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}

function cell(
  idmCell: IdmCell,
  align: TableAlignment | null,
  ctx: RenderContext,
  header: boolean,
): TableCell {
  return new TableCell({
    margins: CELL_MARGINS,
    shading: header ? { type: ShadingType.CLEAR, fill: COLORS.tableHeaderFill, color: "auto" } : undefined,
    children: [
      new Paragraph({
        alignment: alignmentFor(align),
        children: renderInline(idmCell.children, ctx, header ? { bold: true } : {}),
      }),
    ],
  });
}

export function renderTable(node: TableNode, ctx: RenderContext): Table {
  const b = border();
  const headerRow = new TableRow({
    tableHeader: true,
    children: node.header.cells.map((c, i) => cell(c, node.alignments[i] ?? null, ctx, true)),
  });
  const bodyRows = node.rows.map(
    (row) =>
      new TableRow({
        children: row.cells.map((c, i) => cell(c, node.alignments[i] ?? null, ctx, false)),
      }),
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: b,
      bottom: b,
      left: b,
      right: b,
      insideHorizontal: b,
      insideVertical: b,
    },
    rows: [headerRow, ...bodyRows],
  });
}
