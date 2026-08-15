// src/html/math.ts
//
// MathNode → MathML string for the HTML renderer (§5.2). The original LaTeX is
// preserved by the caller in a data-latex attribute.

import type { MathNode } from "../math/parse";

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function toMathml(node: MathNode): string {
  switch (node.type) {
    case "row":
      return `<mrow>${node.items.map(toMathml).join("")}</mrow>`;
    case "num":
      return `<mn>${esc(node.value)}</mn>`;
    case "ident":
      return `<mi>${esc(node.value)}</mi>`;
    case "op":
      return `<mo>${esc(node.value)}</mo>`;
    case "func":
      return `<mi>${esc(node.name)}</mi>`;
    case "sup":
      return `<msup>${toMathml(node.base)}${toMathml(node.sup)}</msup>`;
    case "sub":
      return `<msub>${toMathml(node.base)}${toMathml(node.sub)}</msub>`;
    case "subsup":
      return `<msubsup>${toMathml(node.base)}${toMathml(node.sub)}${toMathml(node.sup)}</msubsup>`;
    case "frac":
      return `<mfrac>${toMathml(node.num)}${toMathml(node.den)}</mfrac>`;
    case "sqrt":
      return `<msqrt>${toMathml(node.radicand)}</msqrt>`;
    case "fenced":
      return `<mrow><mo>${esc(node.open)}</mo>${toMathml(node.body)}<mo>${esc(node.close)}</mo></mrow>`;
    default:
      return "";
  }
}

/** Wrap in a <math> element carrying the source LaTeX (§5.2). */
export function mathmlDocument(node: MathNode, latex: string, block: boolean): string {
  const display = block ? ' display="block"' : "";
  return `<math xmlns="http://www.w3.org/1998/Math/MathML"${display} data-latex="${esc(latex).replace(/"/g, "&quot;")}">${toMathml(node)}</math>`;
}
