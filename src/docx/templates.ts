// src/docx/templates.ts
//
// The four built-in templates' style overrides (§8), expressed in the same
// RefStyle shape as a reference-.docx extraction so they merge through the
// existing buildStyles() layering: BUILTIN -> template -> reference .docx.
//
// "Subtle rules" (Professional) and true first-line indents (Academic) aren't
// representable in the current RefParaProps shape (no border/first-line-indent
// fields) — Academic instead uses a left indent on body paragraphs, and
// Professional is expressed via tighter spacing + a distinct heading colour.
// Both stay within font/colour/spacing, which is what §8 actually specifies.

import type { TemplateId } from "../core/options";
import type { ReferenceStyles } from "./reference-styles";

const PROFESSIONAL_HEADING_COLOR = "404040";

const PROFESSIONAL: ReferenceStyles = {
  normal: { paragraph: { after: 120, line: 252, lineRule: "auto" } },
  heading1: { run: { color: PROFESSIONAL_HEADING_COLOR }, paragraph: { before: 200, after: 100 } },
  heading2: { run: { color: PROFESSIONAL_HEADING_COLOR }, paragraph: { before: 160, after: 60 } },
  heading3: { run: { color: PROFESSIONAL_HEADING_COLOR } },
  heading4: { run: { color: PROFESSIONAL_HEADING_COLOR } },
  heading5: { run: { color: PROFESSIONAL_HEADING_COLOR } },
  heading6: { run: { color: PROFESSIONAL_HEADING_COLOR } },
};

const ACADEMIC_FONT = "Georgia";

const ACADEMIC: ReferenceStyles = {
  // 12pt (size 24 half-points), double-spaced, paragraphs indented.
  normal: {
    run: { font: ACADEMIC_FONT, size: 24 },
    paragraph: { line: 480, lineRule: "auto", indentLeft: 360 },
  },
  heading1: { run: { font: ACADEMIC_FONT, color: "000000" } },
  heading2: { run: { font: ACADEMIC_FONT, color: "000000" } },
  heading3: { run: { font: ACADEMIC_FONT, color: "000000" } },
  heading4: { run: { font: ACADEMIC_FONT, color: "000000" } },
  heading5: { run: { font: ACADEMIC_FONT, color: "000000" } },
  heading6: { run: { font: ACADEMIC_FONT, color: "000000" } },
  quote: { run: { font: ACADEMIC_FONT } },
};

const MINIMAL_FONT = "Arial";

const MINIMAL: ReferenceStyles = {
  // Generous whitespace: looser line spacing and more space after paragraphs.
  normal: { run: { font: MINIMAL_FONT }, paragraph: { after: 280, line: 300, lineRule: "auto" } },
  heading1: { run: { font: MINIMAL_FONT, color: "000000" }, paragraph: { before: 320, after: 160 } },
  heading2: { run: { font: MINIMAL_FONT, color: "000000" }, paragraph: { before: 280, after: 120 } },
  heading3: { run: { font: MINIMAL_FONT, color: "000000" } },
  heading4: { run: { font: MINIMAL_FONT, color: "000000" } },
  heading5: { run: { font: MINIMAL_FONT, color: "000000" } },
  heading6: { run: { font: MINIMAL_FONT, color: "000000" } },
};

const TEMPLATE_STYLES: Partial<Record<string, ReferenceStyles>> = {
  // "default" has no overrides — the BUILTIN table in styles.ts already is
  // the documented Default character (Calibri, blue headings).
  professional: PROFESSIONAL,
  academic: ACADEMIC,
  minimal: MINIMAL,
};

/** A built-in template's style overrides, or {} for "default"/unknown/Pro-custom ids. */
export function templateStyles(template: TemplateId): ReferenceStyles {
  return TEMPLATE_STYLES[template] ?? {};
}
