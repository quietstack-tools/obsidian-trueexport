import { describe, it, expect } from "vitest";
import { WarningCollector, type ExportWarning } from "../../src/core/warnings";

function warning(overrides: Partial<ExportWarning> = {}): ExportWarning {
  return {
    construct: "dataview",
    message: "Dataview queries cannot be exported. Export note content instead.",
    sourcePath: "Note.md",
    ...overrides,
  };
}

describe("WarningCollector", () => {
  it("starts empty", () => {
    const collector = new WarningCollector();
    expect(collector.length).toBe(0);
    expect(collector.list()).toEqual([]);
  });

  it("preserves insertion order", () => {
    const collector = new WarningCollector();
    collector.add(warning({ construct: "dataview", line: 1 }));
    collector.add(warning({ construct: "image", line: 2 }));
    collector.add(warning({ construct: "footnote", line: 3 }));

    expect(collector.list().map((w) => w.construct)).toEqual([
      "dataview",
      "image",
      "footnote",
    ]);
  });

  it("reports its length", () => {
    const collector = new WarningCollector();
    collector.add(warning());
    collector.add(warning());
    expect(collector.length).toBe(2);
  });

  it("retains line numbers so warnings stay actionable", () => {
    const collector = new WarningCollector();
    collector.add(warning({ line: 78, construct: "image" }));
    expect(collector.list()[0].line).toBe(78);
  });

  it("returns a defensive copy that cannot mutate internal state", () => {
    const collector = new WarningCollector();
    collector.add(warning());
    const first = collector.list();
    first.push(warning({ construct: "math" }));
    expect(collector.length).toBe(1);
    expect(collector.list()).toHaveLength(1);
  });
});
