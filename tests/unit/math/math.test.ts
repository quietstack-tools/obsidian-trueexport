import { describe, it, expect } from "vitest";
import { parseLatex, MathUnsupportedError } from "../../../src/math/parse";
import { toMathml, mathmlDocument } from "../../../src/html/math";

describe("parseLatex", () => {
  it("parses a superscript", () => {
    expect(parseLatex("x^2")).toEqual({
      type: "sup",
      base: { type: "ident", value: "x" },
      sup: { type: "num", value: "2" },
    });
  });

  it("parses a combined sub/superscript", () => {
    const node = parseLatex("x_i^2");
    expect(node.type).toBe("subsup");
  });

  it("parses a fraction, radical and Greek letters", () => {
    expect(parseLatex("\\frac{a}{b}").type).toBe("frac");
    expect(parseLatex("\\sqrt{x}").type).toBe("sqrt");
    expect(parseLatex("\\alpha")).toEqual({ type: "ident", value: "α" });
  });

  it("parses \\left…\\right fences", () => {
    const node = parseLatex("\\left(a+b\\right)");
    expect(node.type).toBe("fenced");
  });

  it("throws MathUnsupportedError on unsupported syntax", () => {
    expect(() => parseLatex("\\begin{matrix}")).toThrow(MathUnsupportedError);
    expect(() => parseLatex("\\weirdcmd{x}")).toThrow(MathUnsupportedError);
  });
});

describe("toMathml", () => {
  it("emits MathML elements", () => {
    expect(toMathml(parseLatex("x^2"))).toBe("<msup><mi>x</mi><mn>2</mn></msup>");
    expect(toMathml(parseLatex("\\frac{a}{b}"))).toBe("<mfrac><mi>a</mi><mi>b</mi></mfrac>");
  });

  it("wraps in <math> and preserves the source LaTeX in data-latex", () => {
    const html = mathmlDocument(parseLatex("x^2"), "x^2", true);
    expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML"');
    expect(html).toContain('display="block"');
    expect(html).toContain('data-latex="x^2"');
  });
});
