import { describe, it, expect } from "vitest";
import { parseYaml } from "../../../src/core/parser/frontmatter";

describe("parseYaml prototype-pollution guard", () => {
  it("does not let a __proto__ key mutate an object prototype", () => {
    const { data } = parseYaml(["__proto__:", "  polluted: true", "title: Real"]);
    // The dangerous key is dropped; the real key survives.
    expect(data.title).toBe("Real");
    expect(Object.prototype.hasOwnProperty.call(data, "__proto__")).toBe(false);
    // Nothing leaked onto the global prototype.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("drops constructor / prototype keys too", () => {
    const { data } = parseYaml(["constructor: x", "prototype: y", "keep: z"]);
    expect(data.keep).toBe("z");
    expect(Object.prototype.hasOwnProperty.call(data, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(data, "prototype")).toBe(false);
  });
});
