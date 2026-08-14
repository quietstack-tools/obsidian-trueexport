// src/core/parser/footnote.ts
//
// Footnote *definition* collection (§4.5). A definition looks like
// `[^id]: content`, with optional indented continuation lines. Definitions are
// gathered into the footnotes map regardless of position and never emitted into
// the body. Numbering by order of first reference is the resolver's job.

/** Matches the opening of a footnote definition; captures id and first line. */
const DEFINITION = /^\[\^([^\]\s]+)\]:\s?(.*)$/;

export function matchFootnoteDefinition(line: string): { identifier: string; first: string } | null {
  const m = line.match(DEFINITION);
  if (!m) return null;
  return { identifier: m[1], first: m[2] };
}

/**
 * Given the source lines and the index of a definition's first line, collect
 * that line plus any indented continuation lines. Returns the joined content
 * text and the number of lines consumed.
 */
export function collectDefinitionBody(
  lines: string[],
  start: number,
  first: string,
): { content: string; consumed: number } {
  const collected = [first];
  let i = start + 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") break;
    if (/^ {2,}/.test(line) || /^\t/.test(line)) {
      collected.push(line.replace(/^\s+/, ""));
    } else {
      break;
    }
  }
  return { content: collected.join("\n"), consumed: i - start };
}
