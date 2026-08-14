import { describe, it, expect } from "vitest";
import { parse } from "../../helpers/parse";
import { splitCells, isDelimiterRow, isTableStart } from "../../../src/core/parser/table";
import type { TableNode } from "../../../src/core/model/nodes";

function firstTable(src: string): TableNode {
  const { blocks } = parse(src);
  const table = blocks.find((b) => b.type === "table");
  if (!table || table.type !== "table") throw new Error("no table parsed");
  return table;
}

describe("table cell splitting", () => {
  it("keeps escaped pipes as literal content", () => {
    expect(splitCells("| a \\| b | c |")).toEqual(["a | b", "c"]);
  });

  it("recognises a delimiter row", () => {
    expect(isDelimiterRow("|:--|:-:|--:|")).toBe(true);
    expect(isDelimiterRow("| not | delim |")).toBe(false);
  });

  it("only starts a table when header and delimiter widths match", () => {
    expect(isTableStart("| a | b |", "|---|---|")).toBe(true);
    expect(isTableStart("| a | b |", "|---|")).toBe(false);
  });
});

describe("tables", () => {
  it("reads alignment from the delimiter row", () => {
    const table = firstTable("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |");
    expect(table.alignments).toEqual(["left", "center", "right"]);
  });

  it("pads ragged rows to the header width", () => {
    const table = firstTable("| a | b | c |\n|---|---|---|\n| 1 |");
    expect(table.rows[0].cells).toHaveLength(3);
    expect(table.rows[0].cells[1].children).toEqual([]);
  });

  it("parses inline content inside cells", () => {
    const table = firstTable("| a |\n|---|\n| **x** |");
    expect(table.rows[0].cells[0].children[0].type).toBe("strong");
  });

  it("is not a table without a delimiter row (failing case)", () => {
    const { blocks } = parse("| a | b |\njust text");
    expect(blocks.some((b) => b.type === "table")).toBe(false);
  });
});
