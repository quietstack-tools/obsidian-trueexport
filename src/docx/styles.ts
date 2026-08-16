// src/docx/styles.ts
//
// Word style definitions. Every style in the §5.1 table is defined explicitly —
// relying on Word's defaults is exactly what breaks cross-renderer consistency
// in competing tools. Sizes are in half-points (11pt → 22); spacing in twips
// (1pt → 20); colours are hex without the leading '#'.

import {
  AlignmentType,
  LineRuleType,
  type IStylesOptions,
  type IRunStylePropertiesOptions,
  type ISpacingProperties,
} from "docx";
import type { RefParaProps, RefRunProps, RefStyle, ReferenceStyles } from "./reference-styles";

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

/**
 * The built-in §5.1 style table, expressed in the neutral RefStyle shape so a
 * reference document's overrides can be merged in field-by-field.
 */
const BUILTIN = {
  normal: {
    run: { font: BODY_FONT, size: 22, color: COLORS.text },
    paragraph: { after: 160, line: 276, lineRule: "auto" },
  },
  heading1: {
    run: { font: HEADING_FONT, size: 40, bold: true, color: COLORS.heading1 },
    paragraph: { before: 240, after: 120 },
  },
  heading2: {
    run: { font: HEADING_FONT, size: 32, bold: true, color: COLORS.heading },
    paragraph: { before: 200, after: 80 },
  },
  heading3: {
    run: { font: HEADING_FONT, size: 28, bold: true, color: COLORS.heading },
    paragraph: { before: 160, after: 80 },
  },
  heading4: {
    run: { font: BODY_FONT, size: 24, bold: true, color: COLORS.heading },
    paragraph: { before: 120, after: 40 },
  },
  heading5: {
    run: { font: BODY_FONT, size: 22, bold: true, color: COLORS.heading },
    paragraph: { before: 120, after: 40 },
  },
  heading6: {
    run: { font: BODY_FONT, size: 22, bold: true, color: COLORS.heading },
    paragraph: { before: 120, after: 40 },
  },
  quote: {
    run: { italics: true, color: COLORS.quote },
    paragraph: { indentLeft: 240 },
  },
  caption: {
    run: { italics: true, size: 18, color: COLORS.caption },
    paragraph: { alignment: "center", before: 40, after: 160 },
  },
  codeBlock: {
    run: { font: CODE_FONT, size: 18, color: COLORS.code },
    paragraph: { after: 0, line: 240, lineRule: "auto" },
  },
  code: {
    run: { font: CODE_FONT, size: 18, color: COLORS.code },
  },
} satisfies Record<string, RefStyle>;

/**
 * Build the Word style table. When `ref` (extracted from a reference .docx) is
 * supplied, its values override the built-in table field-by-field; anything the
 * reference doesn't define keeps its built-in value (§5.1).
 */
export function buildStyles(ref: ReferenceStyles = {}): IStylesOptions {
  const normal = resolve(BUILTIN.normal, ref.normal);
  // A reference "Code" style informs both the inline Code run and the code block.
  const codeRun = { run: { ...BUILTIN.code.run, ...ref.code?.run } };
  const codeBlock = resolve(BUILTIN.codeBlock, codeRun);

  return {
    default: {
      document: {
        run: docxRun(normal.run, true),
        paragraph: { spacing: docxSpacing(normal.paragraph) },
      },
      heading1: headingStyle(BUILTIN.heading1, ref.heading1),
      heading2: headingStyle(BUILTIN.heading2, ref.heading2),
      heading3: headingStyle(BUILTIN.heading3, ref.heading3),
      heading4: headingStyle(BUILTIN.heading4, ref.heading4),
      heading5: headingStyle(BUILTIN.heading5, ref.heading5),
      heading6: headingStyle(BUILTIN.heading6, ref.heading6),
    },
    paragraphStyles: [
      {
        id: "Quote",
        name: "Quote",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        ...styleProps(resolve(BUILTIN.quote, ref.quote)),
      },
      {
        id: "Caption",
        name: "Caption",
        basedOn: "Normal",
        next: "Normal",
        ...styleProps(resolve(BUILTIN.caption, ref.caption)),
      },
      {
        id: "CodeBlock",
        name: "Code Block",
        basedOn: "Normal",
        ...styleProps(codeBlock),
      },
    ],
    characterStyles: [
      {
        id: "Code",
        name: "Code",
        run: docxRun(resolve(BUILTIN.code, ref.code).run),
      },
    ],
  };
}

/** Merge a reference override over a built-in style, field-by-field. */
function resolve(base: RefStyle, over: RefStyle | undefined): RefStyle {
  return {
    run: { ...base.run, ...over?.run },
    paragraph: { ...base.paragraph, ...over?.paragraph },
  };
}

function headingStyle(base: RefStyle, over: RefStyle | undefined) {
  const merged = resolve(base, over);
  const spacing = docxSpacing(merged.paragraph);
  return {
    run: docxRun(merged.run),
    ...(spacing ? { paragraph: { spacing } } : {}),
  };
}

/** The run + paragraph fields shared by the named paragraph styles. */
function styleProps(merged: RefStyle) {
  const spacing = docxSpacing(merged.paragraph);
  const paragraph = {
    ...(spacing ? { spacing } : {}),
    ...(merged.paragraph?.indentLeft !== undefined ? { indent: { left: merged.paragraph.indentLeft } } : {}),
    ...(merged.paragraph?.alignment !== undefined ? { alignment: alignment(merged.paragraph.alignment) } : {}),
  };
  return {
    run: docxRun(merged.run),
    ...(Object.keys(paragraph).length > 0 ? { paragraph } : {}),
  };
}

function docxRun(r: RefRunProps | undefined, withLang = false): IRunStylePropertiesOptions {
  return {
    ...(r?.font !== undefined ? { font: r.font } : {}),
    ...(r?.size !== undefined ? { size: r.size } : {}),
    ...(r?.bold !== undefined ? { bold: r.bold } : {}),
    ...(r?.italics !== undefined ? { italics: r.italics } : {}),
    ...(r?.color !== undefined ? { color: r.color } : {}),
    ...(withLang ? { language: RUN_LANGUAGE } : {}),
  };
}

function docxSpacing(p: RefParaProps | undefined): ISpacingProperties | undefined {
  if (!p) return undefined;
  const s = {
    ...(p.before !== undefined ? { before: p.before } : {}),
    ...(p.after !== undefined ? { after: p.after } : {}),
    ...(p.line !== undefined ? { line: p.line } : {}),
    ...(p.lineRule !== undefined ? { lineRule: mapLineRule(p.lineRule) } : {}),
  };
  return Object.keys(s).length > 0 ? s : undefined;
}

function mapLineRule(rule: "auto" | "exact" | "atLeast") {
  if (rule === "exact") return LineRuleType.EXACT;
  if (rule === "atLeast") return LineRuleType.AT_LEAST;
  return LineRuleType.AUTO;
}

function alignment(a: "left" | "center" | "right" | "both") {
  if (a === "center") return AlignmentType.CENTER;
  if (a === "right") return AlignmentType.RIGHT;
  if (a === "both") return AlignmentType.JUSTIFIED;
  return AlignmentType.LEFT;
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
