// src/core/model/nodes.ts
//
// The Intermediate Document Model (IDM) node definitions — the single,
// format-agnostic source of truth between parsing and rendering.
//
// Design principles (TECH_SPEC §3.1):
//   - Every node is a plain, serialisable object: no classes, no methods,
//     no circular references.
//   - A discriminated union on `type` for exhaustive switching.
//   - Formatting is semantic ("emphasis"), never presentational.
//   - Anything unrepresentable becomes an UnsupportedNode carrying a reason —
//     never dropped silently.
//
// Owner-approved deviations from TECH_SPEC §3.2 (agreed in the §14.1 review):
//   (a) Every node may carry `position` so warnings can cite a source line
//       (line numbers are a MUST in §6.3 / acceptance #6).
//   (b) Every block node may carry `blockId`, so `^blockid` links and
//       transclusions (§4.3, P0) are representable.
//   (c) Footnote references/definitions carry `assignedNumber`, populated by
//       the resolver, so renumber-by-first-reference (§4.5) is computed once
//       and never re-derived per renderer.
//   - FootnoteDefinitionNode is intentionally NOT part of BlockNode: it lives
//     only in IdmDocument.footnotes (resolves the §4.5.3 contradiction).

/** A 1-based location in the source note, used to make warnings actionable. */
export interface SourcePosition {
  /** 1-based line number in the originating note. */
  line: number;
}

/** Fields shared by every IDM node. */
export interface NodeBase {
  /** Where this node began in source. Optional: not every node has a source. */
  position?: SourcePosition;
}

/** Fields shared by every block-level node. */
export interface BlockBase extends NodeBase {
  /** Obsidian block reference id (`^id`) attached to this block, if any. */
  blockId?: string;
}

export type IdmNode = BlockNode | InlineNode;

export type BlockNode =
  | HeadingNode
  | ParagraphNode
  | ListNode
  | ListItemNode
  | TableNode
  | CodeBlockNode
  | BlockquoteNode
  | CalloutNode
  | ThematicBreakNode
  | ImageBlockNode
  | MathBlockNode
  | HtmlBlockNode
  | UnsupportedNode;

export type InlineNode =
  | TextNode
  | EmphasisNode
  | StrongNode
  | StrikethroughNode
  | HighlightNode
  | InlineCodeNode
  | LinkNode
  | InlineImageNode
  | MathInlineNode
  | FootnoteReferenceNode
  | LineBreakNode
  | SubscriptNode
  | SuperscriptNode;

// ---- Block nodes ----

export interface HeadingNode extends BlockBase {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  children: InlineNode[];
  /** Slug for internal anchors; assigned during parsing/resolution. */
  id?: string;
}

export interface ParagraphNode extends BlockBase {
  type: "paragraph";
  children: InlineNode[];
}

export interface ListNode extends BlockBase {
  type: "list";
  ordered: boolean;
  /** Ordered lists only. */
  start?: number;
  /** false → paragraph spacing between items. */
  tight: boolean;
  children: ListItemNode[];
}

export interface ListItemNode extends BlockBase {
  type: "listItem";
  /** undefined = not a task item. */
  checked?: boolean;
  /** Block-level content supports nesting. */
  children: BlockNode[];
}

export interface TableNode extends BlockBase {
  type: "table";
  header: TableRow;
  rows: TableRow[];
  alignments: (TableAlignment | null)[];
}

export type TableAlignment = "left" | "center" | "right";

export interface TableRow {
  cells: TableCell[];
}

export interface TableCell {
  children: InlineNode[];
}

export interface CodeBlockNode extends BlockBase {
  type: "codeBlock";
  language: string | null;
  content: string;
  // "mermaid" is preserved as a language; rendering handled per-format (§4.11).
}

export interface BlockquoteNode extends BlockBase {
  type: "blockquote";
  children: BlockNode[];
}

export interface CalloutNode extends BlockBase {
  type: "callout";
  /** "note", "warning", "tip", ... lowercased (§4.4). */
  calloutType: string;
  /** Title inlines. Parser fills a title-cased type when none is given. */
  title: InlineNode[];
  foldable: boolean;
  defaultFolded: boolean;
  /** Nesting supported. */
  children: BlockNode[];
}

export interface ThematicBreakNode extends BlockBase {
  type: "thematicBreak";
}

export interface ImageBlockNode extends BlockBase {
  type: "imageBlock";
  resource: MediaResource;
  alt: string;
  /** px, from the `|300` syntax. */
  width?: number;
  height?: number;
  caption?: InlineNode[];
}

export interface MathBlockNode extends BlockBase {
  type: "mathBlock";
  latex: string;
}

export interface HtmlBlockNode extends BlockBase {
  type: "htmlBlock";
  raw: string;
}

export interface UnsupportedNode extends BlockBase {
  type: "unsupported";
  /** Human-readable, shown in warnings. MUST name a remedy (§4.13). */
  reason: string;
  /** Original source text. */
  raw: string;
  /** Machine key, e.g. "dataview". */
  construct: string;
}

/**
 * A footnote definition. Not a member of BlockNode: definitions live only in
 * IdmDocument.footnotes and are never spliced into the body (§4.5.3).
 */
export interface FootnoteDefinitionNode extends NodeBase {
  type: "footnoteDefinition";
  /** Original label from source, e.g. "1" or "note-a". */
  identifier: string;
  /** Sequential number by order of first reference; set by the resolver. */
  assignedNumber?: number;
  children: BlockNode[];
}

// ---- Inline nodes ----

export interface TextNode extends NodeBase {
  type: "text";
  value: string;
}

export interface EmphasisNode extends NodeBase {
  type: "emphasis";
  children: InlineNode[];
}

export interface StrongNode extends NodeBase {
  type: "strong";
  children: InlineNode[];
}

export interface StrikethroughNode extends NodeBase {
  type: "strikethrough";
  children: InlineNode[];
}

export interface HighlightNode extends NodeBase {
  type: "highlight";
  children: InlineNode[];
}

export interface SubscriptNode extends NodeBase {
  type: "subscript";
  children: InlineNode[];
}

export interface SuperscriptNode extends NodeBase {
  type: "superscript";
  children: InlineNode[];
}

export interface InlineCodeNode extends NodeBase {
  type: "inlineCode";
  value: string;
}

export interface LinkNode extends NodeBase {
  type: "link";
  target: LinkTarget;
  children: InlineNode[];
}

export type LinkTarget =
  | { kind: "external"; url: string }
  | {
      kind: "internal";
      notePath: string;
      heading?: string;
      blockId?: string;
      resolved: boolean;
      /**
       * True for a transclusion (`![[...]]`) rather than a link (`[[...]]`).
       * The parser sets this; the resolver either splices the target (when the
       * embed is a whole paragraph) or, for an inline embed, resolves it as a
       * plain link. No `internal` embed target ever survives into the rendered
       * IDM as an unresolved embed.
       */
      embed?: boolean;
    }
  | { kind: "anchor"; id: string };

export interface InlineImageNode extends NodeBase {
  type: "inlineImage";
  resource: MediaResource;
  alt: string;
  width?: number;
  height?: number;
}

export interface MathInlineNode extends NodeBase {
  type: "mathInline";
  latex: string;
}

export interface FootnoteReferenceNode extends NodeBase {
  type: "footnoteReference";
  /** Original label from source. */
  identifier: string;
  /** Sequential number by order of first reference; set by the resolver. */
  assignedNumber?: number;
}

export interface LineBreakNode extends NodeBase {
  type: "lineBreak";
  hard: boolean;
}

// ---- Media ----

export interface MediaResource {
  kind: "binary" | "missing" | "remote-blocked";
  data?: ArrayBuffer;
  mimeType?: string;
  originalPath: string;
}
