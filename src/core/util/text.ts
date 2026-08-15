// src/core/util/text.ts
//
// Small text helpers shared by renderers.

// Hebrew, Arabic, Arabic Supplement/Extended, Syriac, Thaana, N'Ko.
const RTL_CHARS =
  /[֐-׿؀-ۿ܀-ݏݐ-ݿހ-޿߀-߿ࢠ-ࣿיִ-﷽ﹰ-﻿]/;

/** True when the text contains any right-to-left script character (§4.1 RTL). */
export function hasRtl(text: string): boolean {
  return RTL_CHARS.test(text);
}
