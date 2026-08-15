import { describe, it, expect, afterEach } from "vitest";
// setRequestUrlHandler is a mock-only helper; import it from the mock directly
// (vitest resolves it to the same module the adapter's requestUrl uses).
import { setRequestUrlHandler } from "../mocks/obsidian";
import { createRemoteImageFetcher } from "../../src/obsidian-adapter";

// Restore the default handler after each test.
afterEach(() => setRequestUrlHandler(async () => ({ status: 200, headers: {}, arrayBuffer: new ArrayBuffer(0), text: "" })));

describe("createRemoteImageFetcher (§7.6)", () => {
  it("returns bytes and MIME type for a 200 image response", async () => {
    const bytes = new TextEncoder().encode("PNGDATA").buffer;
    setRequestUrlHandler(async () => ({ status: 200, headers: { "content-type": "image/png" }, arrayBuffer: bytes, text: "" }));
    const result = await createRemoteImageFetcher()("https://x.dev/a.png");
    expect(result).not.toBeNull();
    expect(result?.mimeType).toBe("image/png");
    expect(result?.data).toBe(bytes);
  });

  it("returns null on a non-200 response", async () => {
    setRequestUrlHandler(async () => ({ status: 404, headers: { "content-type": "image/png" }, arrayBuffer: new ArrayBuffer(0), text: "" }));
    expect(await createRemoteImageFetcher()("https://x.dev/missing.png")).toBeNull();
  });

  it("returns null when the content type is not an image", async () => {
    setRequestUrlHandler(async () => ({ status: 200, headers: { "content-type": "text/html" }, arrayBuffer: new ArrayBuffer(0), text: "" }));
    expect(await createRemoteImageFetcher()("https://x.dev/page.html")).toBeNull();
  });

  it("returns null on a network error (never throws)", async () => {
    setRequestUrlHandler(async () => {
      throw new Error("network down");
    });
    await expect(createRemoteImageFetcher()("https://x.dev/a.png")).resolves.toBeNull();
  });
});
