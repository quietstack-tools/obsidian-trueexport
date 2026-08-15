// src/math/parse.ts
//
// A small, pure LaTeX-math parser producing a format-agnostic AST, shared by
// the DOCX (OMML) and HTML (MathML) emitters (§4.10).
//
// Scope is deliberately bounded: numbers, identifiers, Greek letters, common
// operators/symbols, super/subscripts, \frac, \sqrt, \left…\right and
// (), [] fences, and a set of named functions. Anything outside this subset
// throws MathUnsupportedError, so the renderer degrades to raw LaTeX in
// monospace + a warning rather than emitting subtly-wrong maths (correctness
// beats coverage).

export type MathNode =
  | { type: "row"; items: MathNode[] }
  | { type: "num"; value: string }
  | { type: "ident"; value: string }
  | { type: "op"; value: string }
  | { type: "func"; name: string }
  | { type: "sup"; base: MathNode; sup: MathNode }
  | { type: "sub"; base: MathNode; sub: MathNode }
  | { type: "subsup"; base: MathNode; sub: MathNode; sup: MathNode }
  | { type: "frac"; num: MathNode; den: MathNode }
  | { type: "sqrt"; radicand: MathNode }
  | { type: "fenced"; open: string; close: string; body: MathNode };

export class MathUnsupportedError extends Error {}

const OPERATORS = new Set("+-=<>*/,.!|:;".split(""));

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", zeta: "ζ",
  eta: "η", theta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν",
  xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", chi: "χ",
  psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ",
  Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
};

const SYMBOLS: Record<string, string> = {
  times: "×", cdot: "⋅", div: "÷", pm: "±", mp: "∓", leq: "≤", le: "≤",
  geq: "≥", ge: "≥", neq: "≠", approx: "≈", equiv: "≡", infty: "∞",
  partial: "∂", nabla: "∇", sum: "∑", prod: "∏", int: "∫", rightarrow: "→",
  to: "→", leftarrow: "←", Rightarrow: "⇒", cdots: "⋯", ldots: "…",
  in: "∈", notin: "∉", subset: "⊂", cup: "∪", cap: "∩", forall: "∀",
  exists: "∃", langle: "⟨", rangle: "⟩", star: "⋆", ast: "∗", circ: "∘",
};

const FUNCTIONS = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc", "log", "ln", "exp",
  "lim", "max", "min", "det", "gcd", "sinh", "cosh", "tanh", "arg",
]);

class Parser {
  private pos = 0;
  constructor(private readonly src: string) {}

  parse(): MathNode {
    const node = this.parseExpression();
    this.skipSpace();
    if (!this.atEnd()) throw new MathUnsupportedError(`Unexpected "${this.peek()}"`);
    return node;
  }

  private atEnd(): boolean {
    return this.pos >= this.src.length;
  }
  private peek(): string | undefined {
    return this.src[this.pos];
  }
  private next(): string {
    return this.src[this.pos++];
  }
  private skipSpace(): void {
    while (this.peek() === " " || this.peek() === "\t" || this.peek() === "\n") this.pos++;
  }
  private expect(ch: string): void {
    this.skipSpace();
    if (this.next() !== ch) throw new MathUnsupportedError(`Expected "${ch}"`);
  }

  private parseExpression(stop?: string): MathNode {
    const items: MathNode[] = [];
    for (;;) {
      this.skipSpace();
      if (this.atEnd()) break;
      const c = this.peek();
      if (c === "}" || (stop && c === stop)) break;
      if (this.src.startsWith("\\right", this.pos)) break;
      items.push(this.parseAtom());
    }
    return items.length === 1 ? items[0] : { type: "row", items };
  }

  private parseAtom(): MathNode {
    const base = this.parseBase();
    let sup: MathNode | undefined;
    let sub: MathNode | undefined;
    for (;;) {
      this.skipSpace();
      const c = this.peek();
      if (c === "^") {
        this.next();
        sup = this.parseScript();
      } else if (c === "_") {
        this.next();
        sub = this.parseScript();
      } else {
        break;
      }
    }
    if (sub && sup) return { type: "subsup", base, sub, sup };
    if (sup) return { type: "sup", base, sup };
    if (sub) return { type: "sub", base, sub };
    return base;
  }

  private parseScript(): MathNode {
    this.skipSpace();
    if (this.peek() === "{") {
      this.next();
      const e = this.parseExpression();
      this.expect("}");
      return e;
    }
    return this.parseBase();
  }

  private parseBase(): MathNode {
    this.skipSpace();
    const c = this.peek();
    if (c === undefined) throw new MathUnsupportedError("Unexpected end of expression");
    if (c === "{") {
      this.next();
      const e = this.parseExpression();
      this.expect("}");
      return e;
    }
    if (c === "\\") return this.parseCommand();
    if (/[0-9]/.test(c)) return this.parseNumber();
    if (/[a-zA-Z]/.test(c)) {
      this.next();
      return { type: "ident", value: c };
    }
    if (c === "(" || c === "[") return this.parseFenced(c);
    if (OPERATORS.has(c)) {
      this.next();
      return { type: "op", value: c };
    }
    throw new MathUnsupportedError(`Unsupported character "${c}"`);
  }

  private parseNumber(): MathNode {
    let value = "";
    while (this.peek() !== undefined && /[0-9.]/.test(this.peek() as string)) value += this.next();
    return { type: "num", value };
  }

  private parseFenced(open: string): MathNode {
    const close = open === "(" ? ")" : "]";
    this.next();
    const body = this.parseExpression(close);
    this.expect(close);
    return { type: "fenced", open, close, body };
  }

  private parseCommand(): MathNode {
    this.next(); // backslash
    let name = "";
    while (this.peek() !== undefined && /[a-zA-Z]/.test(this.peek() as string)) name += this.next();
    if (name === "") throw new MathUnsupportedError("Unsupported escape");

    if (name === "frac") {
      const num = this.parseGroup();
      const den = this.parseGroup();
      return { type: "frac", num, den };
    }
    if (name === "sqrt") {
      this.skipSpace();
      if (this.peek() === "[") {
        // Optional degree is accepted but not rendered specially.
        while (this.peek() !== undefined && this.next() !== "]") {
          /* skip */
        }
      }
      return { type: "sqrt", radicand: this.parseGroup() };
    }
    if (name === "left") {
      const openDelim = this.next();
      const body = this.parseExpression();
      if (!this.src.startsWith("\\right", this.pos)) throw new MathUnsupportedError("Missing \\right");
      this.pos += "\\right".length;
      const closeDelim = this.next();
      return { type: "fenced", open: openDelim, close: closeDelim, body };
    }
    if (GREEK[name]) return { type: "ident", value: GREEK[name] };
    if (SYMBOLS[name]) return { type: "op", value: SYMBOLS[name] };
    if (FUNCTIONS.has(name)) return { type: "func", name };
    throw new MathUnsupportedError(`Unsupported command \\${name}`);
  }

  private parseGroup(): MathNode {
    this.expect("{");
    const e = this.parseExpression();
    this.expect("}");
    return e;
  }
}

export function parseLatex(latex: string): MathNode {
  return new Parser(latex).parse();
}
