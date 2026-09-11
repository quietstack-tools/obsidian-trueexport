// src/core/util/svg.ts
//
// Shared, dependency-free SVG well-formedness check used by every renderer
// that embeds SVG content (§4.9/§D20): a corrupt/invalid file (e.g. a plain
// text file renamed to .svg) must degrade to a placeholder + warning rather
// than being silently embedded as-is.

/**
 * A minimal well-formedness check: is there an `<svg …>` (or self-closing
 * `<svg …/>`) root tag anywhere in the text? Not a full XML parse — just
 * enough to catch the "this isn't SVG markup at all" case that every export
 * format needs to treat as a failure rather than embedding garbage.
 */
export function isWellFormedSvg(text: string): boolean {
  return /<svg[\s>]/i.test(text);
}
