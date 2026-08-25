// src/html/templates.ts
//
// The four built-in templates' CSS character (§8) — font stack, heading
// colour, line spacing and paragraph rhythm — consumed by css.ts to
// parameterise the stylesheet. Mirrors src/docx/templates.ts so DOCX and
// HTML/PDF exports of the same template look alike.

import type { TemplateId } from "../core/options";

export interface HtmlTemplateStyle {
  bodyFont: string;
  headingFont: string;
  headingColor: string;
  lineHeight: string;
  paragraphMargin: string;
  paragraphIndent: string;
}

// CJK fallbacks are appended to every stack for the same reason as the
// original default stack (see css.ts) — Electron's printToPDF doesn't
// reliably fall back to a CJK-capable font on its own.
const CJK_SANS = `"PingFang SC", "PingFang TC", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans CJK TC", "Noto Sans CJK JP", "Noto Sans CJK KR"`;
const CJK_SERIF = `"Songti SC", "Noto Serif CJK SC", "Noto Serif CJK TC", "Noto Serif CJK JP", "Noto Serif CJK KR"`;

const SYSTEM_SANS = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, ${CJK_SANS}, sans-serif`;
const HELVETICA = `Helvetica, Arial, ${CJK_SANS}, sans-serif`;
const SERIF = `Cambria, Georgia, ${CJK_SERIF}, serif`;

const DEFAULT_STYLE: HtmlTemplateStyle = {
  bodyFont: SYSTEM_SANS,
  headingFont: SYSTEM_SANS,
  headingColor: "#1f3864",
  lineHeight: "1.6",
  paragraphMargin: "0 0 1em",
  paragraphIndent: "0",
};

const PROFESSIONAL_STYLE: HtmlTemplateStyle = {
  bodyFont: SYSTEM_SANS,
  headingFont: SYSTEM_SANS,
  headingColor: "#404040",
  lineHeight: "1.45",
  paragraphMargin: "0 0 0.6em",
  paragraphIndent: "0",
};

const ACADEMIC_STYLE: HtmlTemplateStyle = {
  bodyFont: SERIF,
  headingFont: SERIF,
  headingColor: "#000000",
  lineHeight: "2",
  paragraphMargin: "0 0 1em",
  paragraphIndent: "1.5em",
};

const MINIMAL_STYLE: HtmlTemplateStyle = {
  bodyFont: HELVETICA,
  headingFont: HELVETICA,
  headingColor: "#000000",
  lineHeight: "1.8",
  paragraphMargin: "0 0 1.4em",
  paragraphIndent: "0",
};

const TEMPLATE_STYLES: Partial<Record<string, HtmlTemplateStyle>> = {
  professional: PROFESSIONAL_STYLE,
  academic: ACADEMIC_STYLE,
  minimal: MINIMAL_STYLE,
};

/** A built-in template's CSS style, or the Default character for unknown/Pro-custom ids. */
export function htmlTemplateStyle(template: TemplateId): HtmlTemplateStyle {
  return TEMPLATE_STYLES[template] ?? DEFAULT_STYLE;
}
