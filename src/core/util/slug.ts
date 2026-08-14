// src/core/util/slug.ts
//
// Heading-anchor slugs. Used to give HeadingNodes stable ids so that
// same-document anchor links (`[[#Heading]]`, Stage 3) and cross-note links in
// batch mode resolve consistently. Both the heading and the linking side must
// slug identically, so this is the single source of the algorithm.

/**
 * Slugify a heading's plain text: lowercase, drop punctuation (keeping letters,
 * numbers and marks in any script), collapse whitespace to single hyphens.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Assigns document-unique slugs. Repeated headings get a numeric suffix
 * (`intro`, `intro-1`, `intro-2`), matching common Markdown renderers.
 */
export class SlugRegistry {
  private readonly counts = new Map<string, number>();

  unique(text: string): string {
    const base = slugify(text) || "section";
    const seen = this.counts.get(base) ?? 0;
    this.counts.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen}`;
  }
}
