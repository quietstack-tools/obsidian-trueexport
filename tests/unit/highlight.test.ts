import { describe, it, expect } from "vitest";
import { tokenizeLine, supportsHighlight } from "../../src/core/highlight";

describe("supportsHighlight", () => {
  it("recognises the supported subset and its common aliases", () => {
    expect(supportsHighlight("python")).toBe(true);
    expect(supportsHighlight("py")).toBe(true);
    expect(supportsHighlight("js")).toBe(true);
    expect(supportsHighlight("ts")).toBe(true);
    expect(supportsHighlight("json")).toBe(true);
    expect(supportsHighlight("bash")).toBe(true);
    expect(supportsHighlight("sh")).toBe(true);
  });

  it("returns false for an unrecognised language or no language", () => {
    expect(supportsHighlight("cobol")).toBe(false);
    expect(supportsHighlight(null)).toBe(false);
  });
});

describe("tokenizeLine", () => {
  it("returns null (fall back to plain monospace) for an unsupported language", () => {
    expect(tokenizeLine("PRINT 'hi'", "cobol")).toBeNull();
  });

  it("returns null when no language is specified", () => {
    expect(tokenizeLine("some text", null)).toBeNull();
  });

  it("tokenizes a Python line into distinct keyword/string/comment/number/function types", () => {
    const tokens = tokenizeLine('def greet(name):  # say hi', "python");
    expect(tokens).not.toBeNull();
    const types = new Set(tokens!.map((t) => t.type));
    expect(types.has("keyword")).toBe(true); // def
    expect(types.has("function")).toBe(true); // greet(
    expect(types.has("comment")).toBe(true); // # say hi
    expect(tokens!.find((t) => t.type === "comment")!.text).toBe("# say hi");

    const numberTokens = tokenizeLine("x = 42", "python")!;
    expect(numberTokens.some((t) => t.type === "number" && t.text === "42")).toBe(true);

    const stringTokens = tokenizeLine("s = 'hello'", "python")!;
    expect(stringTokens.some((t) => t.type === "string" && t.text === "'hello'")).toBe(true);
  });

  it("tokenizes JavaScript/TypeScript keywords and // comments", () => {
    const tokens = tokenizeLine("const x = 1; // comment", "javascript")!;
    expect(tokens.some((t) => t.type === "keyword" && t.text === "const")).toBe(true);
    expect(tokens.some((t) => t.type === "comment" && t.text === "// comment")).toBe(true);

    const tsTokens = tokenizeLine("interface Foo {}", "ts")!;
    expect(tsTokens.some((t) => t.type === "keyword" && t.text === "interface")).toBe(true);
  });

  it("tokenizes JSON keys as keyword-typed and values as string/number/keyword", () => {
    const tokens = tokenizeLine('"name": "Ada", "age": 36, "active": true', "json")!;
    const key = tokens.find((t) => t.text === '"name"');
    expect(key?.type).toBe("keyword");
    const value = tokens.find((t) => t.text === '"Ada"');
    expect(value?.type).toBe("string");
    expect(tokens.some((t) => t.type === "number" && t.text === "36")).toBe(true);
    expect(tokens.some((t) => t.type === "keyword" && t.text === "true")).toBe(true);
  });

  it("tokenizes bash keywords and # comments", () => {
    const tokens = tokenizeLine("if [ -f x ]; then echo hi; fi # done", "bash")!;
    expect(tokens.some((t) => t.type === "keyword" && t.text === "if")).toBe(true);
    expect(tokens.some((t) => t.type === "comment" && t.text === "# done")).toBe(true);
  });
});
