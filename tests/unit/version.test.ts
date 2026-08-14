import { describe, it, expect } from "vitest";
import { getVersionLabel } from "@/core/version";

describe("getVersionLabel", () => {
  it("formats a version string", () => {
    expect(getVersionLabel("0.1.0")).toBe("TrueExport v0.1.0");
  });
});
