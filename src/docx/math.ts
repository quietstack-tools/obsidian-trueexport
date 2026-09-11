// src/docx/math.ts
//
// MathNode → docx OMML math objects (§4.10). Word renders these as real,
// editable equations — not images. We build the docx Math* component tree
// (which the library serialises to OMML) rather than hand-writing OMML XML.
//
// ⚠️ Known, accepted limitation — math is blank in Apple Pages (manual
// testing, D22): the OMML produced here is spec-compliant, standard Office
// Math Markup Language — the same format Word's own "Insert Equation"
// produces, confirmed rendering correctly (real, editable equations) in
// Word, Google Docs, and LibreOffice's .docx import. Apple Pages is the
// exception: both inline and block equations import as blank space, not
// text, not a placeholder image, nothing. This is a genuine Pages platform
// limitation, not a defect in this codebase's OMML generation:
//   - Apple's own documentation for Pages equation support
//     (support.apple.com/en-us/102138, "About LaTeX and MathML support in
//     Pages, Numbers, and Keynote") describes Pages' native equation engine
//     as LaTeX/MathML-based and never mentions OOXML or OMML anywhere —
//     strong evidence Pages' .docx importer has no code path for it at all.
//   - Independent reports (e.g. Apple Community discussions of importing
//     Word equations into Pages) describe them arriving as static images
//     "if at all", consistent with the blank-space result seen here rather
//     than a parse error.
// An `mc:AlternateContent` fallback (Choice: real OMML: Fallback: plain
// text/LaTeX, so a non-supporting reader shows readable text instead of
// nothing) was investigated and REJECTED: math has always been part of the
// base OOXML schema (unlike the Word-2010-era extensions AlternateContent
// was actually designed for), so there is no real-world precedent for
// gating it this way — the one concrete precedent found (Word wrapping
// math embedded in a drawing/shape) uses a different namespace as the gate
// for a different reason. Whether Word/LibreOffice/Google Docs would even
// respect the Choice branch correctly (vs. regressing to Fallback for
// everyone) is unverifiable without hands-on testing, and LibreOffice has a
// documented history of AlternateContent-related corruption bugs. Not
// worth the risk to the working majority case for one app's import gap.
// Do not re-investigate this without new information (e.g. Apple actually
// shipping OMML import support in Pages).
//
// Practical guidance: users producing math-heavy documents who need Apple
// Pages compatibility should use Word, Google Docs, or LibreOffice instead.

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
