import { describe, it, expect } from "vitest";
import { resolve } from "../../helpers/resolve";
import { textToArrayBuffer } from "../../helpers/memory-adapter";
import type { ImageBlockNode } from "../../../src/core/model/nodes";

async function firstImage(source: string, opts = {}): Promise<ImageBlockNode> {
  const { doc } = await resolve(source, opts);
  const img = doc.blocks.find((b) => b.type === "imageBlock");
  if (!img || img.type !== "imageBlock") throw new Error("no image block");
  return img;
}

describe("media resolution", () => {
  it("loads local image bytes and a MIME type", async () => {
    const img = await firstImage("![alt](pic.png)", {
      binaries: { "pic.png": textToArrayBuffer("PNGDATA") },
    });
    expect(img.resource.kind).toBe("binary");
    expect(img.resource.mimeType).toBe("image/png");
    expect(img.resource.data).toBeDefined();
  });

  it("resolves an embedded image through the vault adapter", async () => {
    const img = await firstImage("![[folder/diagram.png]]", {
      sourcePath: "note.md",
      notes: { "note.md": "" },
      binaries: { "folder/diagram.png": textToArrayBuffer("X") },
    });
    expect(img.resource.kind).toBe("binary");
  });

  it("marks a missing image and warns without aborting", async () => {
    const { doc, warnings } = await resolve("![gone](missing.png)");
    const img = doc.blocks.find((b) => b.type === "imageBlock");
    expect(img && img.type === "imageBlock" && img.resource.kind).toBe("missing");
    expect(warnings.some((w) => w.construct === "image" && /not found/.test(w.message))).toBe(true);
  });

  it("blocks remote images by default and names the setting", async () => {
    const img = await firstImage("![remote](https://example.com/a.png)");
    expect(img.resource.kind).toBe("remote-blocked");
    const { warnings } = await resolve("![remote](https://example.com/a.png)");
    expect(warnings.some((w) => w.construct === "image" && /Allow remote images/.test(w.message))).toBe(true);
  });

  it("still does not fetch remote images when the setting is on (Stage 3 limitation)", async () => {
    const { doc, warnings } = await resolve("![remote](https://example.com/a.png)", {
      options: { allowRemoteImages: true },
    });
    const img = doc.blocks.find((b) => b.type === "imageBlock");
    expect(img && img.type === "imageBlock" && img.resource.kind).toBe("remote-blocked");
    expect(warnings.some((w) => w.construct === "image")).toBe(true);
  });
});
