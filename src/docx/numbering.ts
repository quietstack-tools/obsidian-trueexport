// src/docx/numbering.ts
//
// Real Word numbering definitions (§4.7). Bullets and ordered lists MUST use
// numbering.xml, never literal glyphs typed into text — only real numbering
// indents and renumbers correctly in Word.
//
// Strategy: one numbering definition per ListNode. Nesting depth maps to the
// numbering level, so indentation increases with depth; giving each list its
// own definition means sibling lists restart numbering independently, which is
// what readers expect. Each definition fills all nine levels so the used level
// always has a valid format, bullet glyph and indent.

import { AlignmentType, LevelFormat } from "docx";
import type { ListNode } from "../core/model/nodes";

const BULLET_GLYPHS = ["•", "◦", "▪"]; // • ◦ ▪ (§4.7)

type LevelConfig = {
  level: number;
  format: (typeof LevelFormat)[keyof typeof LevelFormat];
  text: string;
  alignment: (typeof AlignmentType)[keyof typeof AlignmentType];
  start?: number;
  style: { paragraph: { indent: { left: number; hanging: number } } };
};

export interface NumberingConfigEntry {
  reference: string;
  levels: LevelConfig[];
}

export class NumberingBuilder {
  private counter = 0;
  readonly configs: NumberingConfigEntry[] = [];

  /** Register a list; returns the numbering reference to use for its items. */
  register(list: ListNode, depth: number): string {
    const reference = `te-list-${this.counter++}`;
    const levels: LevelConfig[] = [];
    for (let i = 0; i < 9; i++) {
      const indent = { left: (i + 1) * 720, hanging: 360 };
      if (list.ordered) {
        const level: LevelConfig = {
          level: i,
          format: LevelFormat.DECIMAL,
          text: `%${i + 1}.`,
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent } },
        };
        if (i === depth && list.start !== undefined) level.start = list.start;
        levels.push(level);
      } else {
        levels.push({
          level: i,
          format: LevelFormat.BULLET,
          text: BULLET_GLYPHS[i % BULLET_GLYPHS.length],
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent } },
        });
      }
    }
    this.configs.push({ reference, levels });
    return reference;
  }
}
