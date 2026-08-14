// tests/helpers/parse.ts
//
// Convenience wrapper: run the parser with default options and surface both the
// result and the warnings it collected.

import { parseMarkdown, type ParseResult } from "../../src/core/parser";
import { defaultExportOptions } from "../../src/core/options";
import { WarningCollector, type ExportWarning } from "../../src/core/warnings";

export interface ParsedFixture extends ParseResult {
  warningList: ExportWarning[];
}

export function parse(source: string, sourcePath = "Note.md"): ParsedFixture {
  const warnings = new WarningCollector();
  const result = parseMarkdown(source, sourcePath, defaultExportOptions(), warnings);
  return { ...result, warningList: warnings.list() };
}
