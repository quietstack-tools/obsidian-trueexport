import { describe, it, expect } from "vitest";
import { slugify, SlugRegistry } from "../../../src/core/util/slug";

describe("slugify", () => {
  it("lowercases and hyphenates words", () => {
    expect(slugify("Hello World Title")).toBe("hello-world-title");
  });

  it("drops punctuation but keeps letters and numbers", () => {
    expect(slugify("Section 2: Results!")).toBe("section-2-results");
  });

  it("keeps non-Latin letters", () => {
    expect(slugify("日本語 見出し")).toBe("日本語-見出し");
  });

  it("returns an empty string for punctuation-only input", () => {
    expect(slugify("!!!")).toBe("");
  });
});

describe("SlugRegistry", () => {
  it("disambiguates repeated headings with numeric suffixes", () => {
    const reg = new SlugRegistry();
    expect(reg.unique("Intro")).toBe("intro");
    expect(reg.unique("Intro")).toBe("intro-1");
    expect(reg.unique("Intro")).toBe("intro-2");
  });

  it("falls back to 'section' for empty slugs", () => {
    const reg = new SlugRegistry();
    expect(reg.unique("###")).toBe("section");
    expect(reg.unique("***")).toBe("section-1");
  });
});
