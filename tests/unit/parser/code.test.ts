import { describe, it, expect } from "vitest";
import { parse } from "../../helpers/parse";
import type { CodeBlockNode } from "../../../src/core/model/nodes";

function firstCode(src: string): CodeBlockNode {
  const { blocks } = parse(src);
  const code = blocks.find((b) => b.type === "codeBlock");
  if (!code || code.type !== "codeBlock") throw new Error("no code block parsed");
  return code;
}

describe("fenced code blocks", () => {
  it("preserves the language hint", () => {
    expect(firstCode("```ts\nx\n```").language).toBe("ts");
  });

  it("uses null for a fence with no language", () => {
    expect(firstCode("```\nx\n```").language).toBeNull();
  });

  it("keeps mermaid as a language rather than an unsupported node", () => {
    const code = firstCode("```mermaid\ngraph TD; A-->B;\n```");
    expect(code.language).toBe("mermaid");
    expect(code.content).toBe("graph TD; A-->B;");
  });

  it("expands tabs to spaces in content", () => {
    const code = firstCode("```\n\tindented\n```");
    expect(code.content).toBe("    indented");
  });

  it("closes an unterminated fence at end of input", () => {
    const code = firstCode("```js\nnever closed");
    expect(code.content).toBe("never closed");
  });

  it("does not treat indented text as a code fence (failing case)", () => {
    const { blocks } = parse("``not a fence``");
    expect(blocks.some((b) => b.type === "codeBlock")).toBe(false);
  });
});
