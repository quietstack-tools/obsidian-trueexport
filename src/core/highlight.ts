// src/core/highlight.ts
//
// A small, hand-rolled syntax tokenizer — deliberately not a full grammar
// engine. Scope is a well-supported common subset (Python, JavaScript/
// TypeScript, JSON, bash/shell) rather than every language; anything else
// returns null so callers fall back to plain monospace, no colour. Pure and
// zero-dependency (no new package, per the "check what's already available
// first" note) so both the DOCX and HTML renderers can drive their own
// token→colour mapping from the same token stream without depending on each
// other. Tokenizes line-by-line — a string or comment that spans multiple
// physical lines (rare in these languages outside Python's triple-quoted
// strings) won't be recognised as one token; that's an accepted limitation
// of staying lightweight, not a full lexer.

export type TokenType = "keyword" | "string" | "comment" | "number" | "function" | "plain";

export interface Token {
  type: TokenType;
  text: string;
}

const PY_KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue",
  "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in",
  "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
]);

const JS_KEYWORDS = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "export", "extends", "finally", "for", "function", "get", "if", "import",
  "in", "instanceof", "let", "new", "of", "return", "set", "static", "super", "switch", "this",
  "throw", "try", "typeof", "var", "void", "while", "with", "yield", "null", "true", "false",
  "undefined",
]);

const TS_KEYWORDS = new Set([
  ...JS_KEYWORDS,
  "interface", "type", "enum", "implements", "private", "public", "protected", "readonly",
  "namespace", "declare", "as", "is", "abstract", "keyof", "infer",
]);

const BASH_KEYWORDS = new Set([
  "if", "then", "else", "elif", "fi", "for", "in", "do", "done", "while", "until", "case", "esac",
  "function", "return", "local", "export", "readonly", "declare", "echo", "exit", "break", "continue",
]);

type LanguageKey = "python" | "javascript" | "typescript" | "json" | "bash";

const ALIASES: Record<string, LanguageKey> = {
  python: "python", py: "python", py3: "python",
  javascript: "javascript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  typescript: "typescript", ts: "typescript", tsx: "typescript",
  json: "json", json5: "json",
  bash: "bash", sh: "bash", shell: "bash", zsh: "bash", console: "bash",
};

function normalize(language: string): LanguageKey | null {
  return ALIASES[language.toLowerCase()] ?? null;
}

export function supportsHighlight(language: string | null): boolean {
  return language !== null && normalize(language) !== null;
}

/** Consume a quoted string starting at `line[start]` (the opening quote). */
function scanString(line: string, start: number): string {
  const quote = line[start];
  let j = start + 1;
  while (j < line.length && line[j] !== quote) {
    if (line[j] === "\\") j++;
    j++;
  }
  return line.slice(start, Math.min(j + 1, line.length));
}

function pushPlainChar(tokens: Token[], ch: string): void {
  const last = tokens[tokens.length - 1];
  if (last && last.type === "plain") last.text += ch;
  else tokens.push({ type: "plain", text: ch });
}

function tokenizeCLike(line: string, keywords: Set<string>, commentPrefix: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    if (rest.startsWith(commentPrefix)) {
      tokens.push({ type: "comment", text: rest });
      break;
    }
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const text = scanString(line, i);
      tokens.push({ type: "string", text });
      i += text.length;
      continue;
    }
    const numMatch = /^\d+(\.\d+)?/.exec(rest);
    if (numMatch) {
      tokens.push({ type: "number", text: numMatch[0] });
      i += numMatch[0].length;
      continue;
    }
    const idMatch = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (idMatch) {
      const word = idMatch[0];
      const after = line.slice(i + word.length);
      const isCall = /^\s*\(/.test(after);
      const type: TokenType = keywords.has(word) ? "keyword" : isCall ? "function" : "plain";
      tokens.push({ type, text: word });
      i += word.length;
      continue;
    }
    pushPlainChar(tokens, ch);
    i++;
  }
  return tokens;
}

function tokenizeJson(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"') {
      const text = scanString(line, i);
      const after = line.slice(i + text.length);
      const isKey = /^\s*:/.test(after);
      tokens.push({ type: isKey ? "keyword" : "string", text });
      i += text.length;
      continue;
    }
    const rest = line.slice(i);
    const numMatch = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(rest);
    if (numMatch) {
      tokens.push({ type: "number", text: numMatch[0] });
      i += numMatch[0].length;
      continue;
    }
    const litMatch = /^(true|false|null)\b/.exec(rest);
    if (litMatch) {
      tokens.push({ type: "keyword", text: litMatch[0] });
      i += litMatch[0].length;
      continue;
    }
    pushPlainChar(tokens, ch);
    i++;
  }
  return tokens;
}

/**
 * Tokenize one line of code for the given fence language. Returns null when
 * the language is unset or not in the supported subset — callers should
 * fall back to plain monospace rendering, not error or leave anything
 * blank.
 */
export function tokenizeLine(line: string, language: string | null): Token[] | null {
  if (language === null) return null;
  const key = normalize(language);
  if (key === null) return null;
  switch (key) {
    case "python":
      return tokenizeCLike(line, PY_KEYWORDS, "#");
    case "bash":
      return tokenizeCLike(line, BASH_KEYWORDS, "#");
    case "javascript":
      return tokenizeCLike(line, JS_KEYWORDS, "//");
    case "typescript":
      return tokenizeCLike(line, TS_KEYWORDS, "//");
    case "json":
      return tokenizeJson(line);
  }
}
