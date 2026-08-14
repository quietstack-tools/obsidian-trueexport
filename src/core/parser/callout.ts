// src/core/parser/callout.ts
//
// Callout detection (§4.4). A callout is a blockquote whose first line opens
// with `[!type]`, optionally followed by a fold modifier (`+`/`-`) and a title.
// The type is stored lowercased; a missing title is filled by the parser with
// the title-cased type. Fold state is captured but ignored on export.

import type { CalloutNode, InlineNode } from "../model/nodes";

export interface CalloutHead {
  calloutType: string;
  title: string;
  foldable: boolean;
  defaultFolded: boolean;
}

/** Parse a callout header line, or null when the line is a plain blockquote. */
export function matchCalloutHeader(line: string): CalloutHead | null {
  const m = line.match(/^\[!([^\]]+)\]([+-]?)\s*(.*)$/);
  if (!m) return null;
  const calloutType = m[1].trim().toLowerCase();
  const modifier = m[2];
  return {
    calloutType,
    title: m[3].trim(),
    foldable: modifier !== "",
    defaultFolded: modifier === "-",
  };
}

function titleCase(type: string): string {
  return type.length === 0 ? "" : type[0].toUpperCase() + type.slice(1);
}

/** Assemble a CalloutNode from a parsed header, its title inlines and body. */
export function buildCallout(
  head: CalloutHead,
  parseInlineFn: (text: string) => InlineNode[],
  body: CalloutNode["children"],
  line: number,
): CalloutNode {
  const titleText = head.title !== "" ? head.title : titleCase(head.calloutType);
  return {
    type: "callout",
    calloutType: head.calloutType,
    title: parseInlineFn(titleText),
    foldable: head.foldable,
    defaultFolded: head.defaultFolded,
    children: body,
    position: { line },
  };
}
