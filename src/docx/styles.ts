// src/docx/styles.ts
//
// Word style definitions. Every style in the §5.1 table is defined explicitly —
// relying on Word's defaults is exactly what breaks cross-renderer consistency
// in competing tools. Sizes are in half-points (11pt → 22); spacing in twips
// (1pt → 20); colours are hex without the leading '#'.

import { AlignmentType, LineRuleType, type IStylesOptions } from "docx";

export const BODY_FONT = "Calibri";
export const HEADING_FONT = "Calibri Light";
export const CODE_FONT = "Consolas";

/** w:lang so Word's spellchecker behaves (§5.1). Applied per run. */
export const RUN_LANGUAGE = { value: "en-US" };

export const COLORS = {
  text: "000000",
  heading1: "1F3864",
  heading: "2E5496",
  code: "333333",
  quote: "555555",
  caption: "666666",
  tableBorder: "CCCCCC",
  tableHeaderFill: "F5F5F5",
  codeFill: "F5F5F5",
} as const;

export function buildStyles(): IStylesOptions {
  return {
    default: {
      document: {
        run: { font: BODY_FONT, size: 22, color: COLORS.text, language: RUN_LANGUAGE },
        paragraph: { spacing: { after: 160, line: 276, lineRule: LineRuleType.AUTO } },
      },
      heading1: {
        run: { font: HEADING_FONT, size: 40, bold: true, color: COLORS.heading1 },
        paragraph: { spacing: { before: 240, after: 120 } },
      },
      heading2: {
        run: { font: HEADING_FONT, size: 32, bold: true, color: COLORS.heading },
        paragraph: { spacing: { before: 200, after: 80 } },
      },
      heading3: {
        run: { font: HEADING_FONT, size: 28, bold: true, color: COLORS.heading },
        paragraph: { spacing: { before: 160, after: 80 } },
      },
      heading4: {
        run: { font: BODY_FONT, size: 24, bold: true, color: COLORS.heading },
        paragraph: { spacing: { before: 120, after: 40 } },
      },
      heading5: {
        run: { font: BODY_FONT, size: 22, bold: true, color: COLORS.heading },
        paragraph: { spacing: { before: 120, after: 40 } },
      },
      heading6: {
        run: { font: BODY_FONT, size: 22, bold: true, color: COLORS.heading },
        paragraph: { spacing: { before: 120, after: 40 } },
      },
    },
    paragraphStyles: [
      {
        id: "Quote",
        name: "Quote",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { italics: true, color: COLORS.quote },
        paragraph: { indent: { left: 240 } },
      },
      {
        id: "Caption",
        name: "Caption",
        basedOn: "Normal",
        next: "Normal",
        run: { italics: true, size: 18, color: COLORS.caption },
        paragraph: { alignment: AlignmentType.CENTER, spacing: { before: 40, after: 160 } },
      },
      {
        id: "CodeBlock",
        name: "Code Block",
        basedOn: "Normal",
        run: { font: CODE_FONT, size: 18, color: COLORS.code },
        paragraph: { spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO } },
      },
    ],
    characterStyles: [
      {
        id: "Code",
        name: "Code",
        run: { font: CODE_FONT, size: 18, color: COLORS.code },
      },
    ],
  };
}

// ---- Callout colours (§4.4) ----

const CALLOUT_COLORS: Record<string, string> = {
  note: "086DDD",
  tip: "00BFBC",
  success: "08B94E",
  question: "EC7500",
  warning: "EC7500",
  danger: "E93147",
  example: "7852EE",
  quote: "9E9E9E",
};

// Every known type maps onto one of the eight colours; unknown → note (§4.4).
const CALLOUT_ALIASES: Record<string, keyof typeof CALLOUT_COLORS> = {
  note: "note", info: "note", todo: "note",
  abstract: "tip", summary: "tip", tldr: "tip", tip: "tip", hint: "tip", important: "tip",
  success: "success", check: "success", done: "success",
  question: "question", help: "question", faq: "question",
  warning: "warning", caution: "warning", attention: "warning",
  failure: "danger", fail: "danger", missing: "danger", danger: "danger", error: "danger", bug: "danger",
  example: "example",
  quote: "quote", cite: "quote",
};

export function calloutColor(type: string): string {
  const key = CALLOUT_ALIASES[type] ?? "note";
  return CALLOUT_COLORS[key];
}

/** A light tint of a callout colour for the cell background (§4.4). */
export function tint(hex: string): string {
  const factor = 0.88; // 88% toward white
  const channel = (i: number): string => {
    const c = parseInt(hex.slice(i, i + 2), 16);
    const mixed = Math.round(c + (255 - c) * factor);
    return mixed.toString(16).padStart(2, "0");
  };
  return `${channel(0)}${channel(2)}${channel(4)}`;
}
