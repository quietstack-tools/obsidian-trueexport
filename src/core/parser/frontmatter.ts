// src/core/parser/frontmatter.ts
//
// YAML frontmatter extraction. The parser only *extracts* frontmatter into a
// record and strips it from the body; how it is then presented (strip /
// metadata / table, §4.12) is decided downstream from ExportOptions.
//
// JUDGMENT CALL: this is a pragmatic YAML subset, not a full YAML engine. It
// covers the shapes real Obsidian notes use — scalars (string/number/bool/
// null), quoted strings, flow arrays `[a, b]`, block sequences, and nested
// maps by indentation. Anything it cannot confidently parse is reported via
// `ok: false` so the caller can warn, and the offending line is skipped rather
// than throwing. If richer YAML is ever needed, swap in js-yaml (MIT).

export interface FrontmatterExtraction {
  /** Parsed key/value data (best effort). */
  data: Record<string, unknown>;
  /** Body lines with the frontmatter block removed. */
  body: string[];
  /** Number of leading source lines the frontmatter occupied (for line math). */
  consumedLines: number;
  /** True when a frontmatter block was present. */
  present: boolean;
  /** False when the YAML could not be fully parsed. */
  ok: boolean;
}

/**
 * Split leading `---` … `---` frontmatter from `lines` (already newline-split,
 * tab-expanded). When absent, returns the input unchanged with present=false.
 */
export function extractFrontmatter(lines: string[]): FrontmatterExtraction {
  if (lines.length === 0 || lines[0].trim() !== "---") {
    return { data: {}, body: lines, consumedLines: 0, present: false, ok: true };
  }

  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "---" || t === "...") {
      close = i;
      break;
    }
  }

  // No closing fence → not frontmatter; treat the whole thing as body.
  if (close === -1) {
    return { data: {}, body: lines, consumedLines: 0, present: false, ok: true };
  }

  const yamlLines = lines.slice(1, close);
  const { data, ok } = parseYaml(yamlLines);
  return {
    data,
    body: lines.slice(close + 1),
    consumedLines: close + 1,
    present: true,
    ok,
  };
}

function indentOf(line: string): number {
  const m = line.match(/^\s*/);
  return m ? m[0].length : 0;
}

export function parseYaml(rawLines: string[]): {
  data: Record<string, unknown>;
  ok: boolean;
} {
  // Drop blank lines and full-line comments up front.
  const lines = rawLines.filter(
    (l) => l.trim() !== "" && !/^\s*#/.test(l),
  );
  const state = { idx: 0, ok: true };

  function parseMap(indent: number): Record<string, unknown> {
    const map: Record<string, unknown> = {};
    while (state.idx < lines.length) {
      const line = lines[state.idx];
      const ind = indentOf(line);
      if (ind < indent) break;
      if (ind > indent) {
        state.ok = false;
        state.idx++;
        continue;
      }
      const m = line.trim().match(/^([^:]+):\s*(.*)$/);
      if (!m) {
        state.ok = false;
        state.idx++;
        continue;
      }
      const key = m[1].trim();
      const rest = m[2];
      state.idx++;

      if (rest === "") {
        const next = lines[state.idx];
        if (next && indentOf(next) > indent) {
          const nextTrim = next.trim();
          map[key] =
            nextTrim === "-" || nextTrim.startsWith("- ")
              ? parseSeq(indentOf(next))
              : parseMap(indentOf(next));
        } else {
          map[key] = null;
        }
      } else {
        map[key] = parseScalar(rest);
      }
    }
    return map;
  }

  function parseSeq(indent: number): unknown[] {
    const arr: unknown[] = [];
    while (state.idx < lines.length) {
      const line = lines[state.idx];
      const ind = indentOf(line);
      if (ind < indent) break;
      const trim = line.trim();
      if (!trim.startsWith("-")) break;
      const itemText = trim.replace(/^-\s*/, "");
      state.idx++;
      if (itemText === "") {
        const next = lines[state.idx];
        if (next && indentOf(next) > indent) arr.push(parseMap(indentOf(next)));
        else arr.push(null);
      } else {
        arr.push(parseScalar(itemText));
      }
    }
    return arr;
  }

  const base = lines.length > 0 ? indentOf(lines[0]) : 0;
  const data = parseMap(base);
  return { data, ok: state.ok };
}

function parseScalar(raw: string): unknown {
  const value = raw.trim();

  // Flow array [a, b, c].
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (inner === "") return [];
    return splitFlow(inner).map(parseScalar);
  }

  // Quoted string.
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~" || value === "") return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d*\.\d+$/.test(value)) return Number(value);

  return value;
}

/** Split a flow-collection body on top-level commas, respecting quotes. */
function splitFlow(inner: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ",") {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== "") parts.push(cur.trim());
  return parts;
}
