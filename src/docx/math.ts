// src/docx/math.ts
//
// MathNode → docx OMML math objects (§4.10). Word renders these as real,
// editable equations — not images. We build the docx Math* component tree
// (which the library serialises to OMML) rather than hand-writing OMML XML.

import {
  Math,
  MathRun,
  MathFraction,
  MathRadical,
  MathSuperScript,
  MathSubScript,
  MathSubSuperScript,
  MathRoundBrackets,
  MathSquareBrackets,
} from "docx";
import { parseLatex, type MathNode } from "../math/parse";

// docx's MathComponent union isn't exported by name; this is the shape the
// Math children accept.
type MathChild = MathRun | MathFraction | MathRadical | MathSuperScript | MathSubScript | MathSubSuperScript | MathRoundBrackets | MathSquareBrackets;

function emit(node: MathNode): MathChild[] {
  switch (node.type) {
    case "row":
      return node.items.flatMap(emit);
    case "num":
    case "ident":
    case "op":
      return [new MathRun(node.value)];
    case "func":
      return [new MathRun(node.name)];
    case "sup":
      return [new MathSuperScript({ children: emit(node.base), superScript: emit(node.sup) })];
    case "sub":
      return [new MathSubScript({ children: emit(node.base), subScript: emit(node.sub) })];
    case "subsup":
      return [
        new MathSubSuperScript({
          children: emit(node.base),
          subScript: emit(node.sub),
          superScript: emit(node.sup),
        }),
      ];
    case "frac":
      return [new MathFraction({ numerator: emit(node.num), denominator: emit(node.den) })];
    case "sqrt":
      return [new MathRadical({ children: emit(node.radicand) })];
    case "fenced":
      return node.open === "["
        ? [new MathSquareBrackets({ children: emit(node.body) })]
        : [new MathRoundBrackets({ children: emit(node.body) })];
    default:
      return [];
  }
}

/** Build a docx Math object from LaTeX. Throws MathUnsupportedError on failure. */
export function latexToMath(latex: string): Math {
  return new Math({ children: emit(parseLatex(latex)) });
}
