// src/core/parser/table.ts
//
// GFM pipe tables. Alignment comes from the delimiter row; ragged rows are
// padded (or truncated) to the header width; escaped pipes `\|` are literal
// cell content (§4.6).

import type { TableAlignment, TableCell, TableNode, TableRow } from "../model/nodes";
import { parseInline, type InlineContext } from "./inline";

/**
 * Split a table row into raw cell strings, honouring `\|` escapes and dropping
 * the empty cells produced by leading/trailing pipes.
 */
export function splitCells(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\" && line[i + 1] === "|") {
      cur += "|";
      i++;
      continue;
    }
    if (c === "\\") {
      cur += "\\" + (line[i + 1] ?? "");
      i++;
      continue;
    }
    if (c === "|") {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  cells.push(cur);

  if (cells.length > 0 && cells[0].trim() === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

/** A delimiter row is cells of `:?-+:?` and nothing else. */
export function isDelimiterRow(line: string): boolean {
  if (!line.includes("-")) return false;
  const cells = splitCells(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function alignmentOf(cell: string): TableAlignment | null {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

/**
 * A header line followed by a delimiter row starts a table when both rows have
 * the same number of columns (GFM). Returns false otherwise.
 */
export function isTableStart(headerLine: string, delimiterLine: string | undefined): boolean {
  if (delimiterLine === undefined) return false;
  if (!headerLine.includes("|")) return false;
  if (!isDelimiterRow(delimiterLine)) return false;
  return splitCells(headerLine).length === splitCells(delimiterLine).length;
}

function toRow(cells: string[], width: number, inlineCtx?: InlineContext): TableRow {
  const out: TableCell[] = [];
  for (let i = 0; i < width; i++) {
    const raw = cells[i] ?? "";
    out.push({ children: parseInline(raw, inlineCtx) });
  }
  return { cells: out };
}

export interface ParsedTable {
  node: TableNode;
  /** Number of source lines the table consumed. */
  consumed: number;
}

/**
 * Parse a table beginning at `lines[start]` (the header). Caller guarantees
 * `isTableStart` already held for the header + following delimiter row.
 */
export function parseTable(
  lines: string[],
  start: number,
  sourceLine: number,
  inlineCtx?: InlineContext,
): ParsedTable {
  const headerCells = splitCells(lines[start]);
  const width = headerCells.length;
  const delimCells = splitCells(lines[start + 1]);
  const alignments: (TableAlignment | null)[] = [];
  for (let i = 0; i < width; i++) alignments.push(alignmentOf(delimCells[i] ?? ""));

  const header = toRow(headerCells, width, inlineCtx);
  const rows: TableRow[] = [];
  let i = start + 2;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || !line.includes("|")) break;
    rows.push(toRow(splitCells(line), width, inlineCtx));
  }

  return {
    node: { type: "table", header, rows, alignments, position: { line: sourceLine } },
    consumed: i - start,
  };
}
