import { describe, it, expect } from "vitest";
import { createRemoteImageFetcher, type RequestUrlLike } from "../../src/obsidian-adapter";

// Minimal requestUrl-response stand-in covering the fields the fetcher reads.
interface FakeRes {
  status?: number;
  headers?: Record<string, string>;
  body?: ArrayBuffer;
}
function res(r: FakeRes = {}): FakeRes & { status: number; headers: Record<string, string>; arrayBuffer: ArrayBuffer } {
  return {
    status: r.status ?? 200,
    headers: r.headers ?? {},
    arrayBuffer: r.body ?? new ArrayBuffer(0),
  };
}

/** A requestUrl impl that always returns the same response, ignoring the URL. */
function constRequest(r: FakeRes): RequestUrlLike {
  return async () => res(r);
}

describe("createRemoteImageFetcher (§7.6)", () => {
  it("returns bytes and MIME type for a 200 image response", async () => {
    const bytes = new TextEncoder().encode("PNGDATA").buffer;
    const fetcher = createRemoteImageFetcher(constRequest({ headers: { "content-type": "image/png" }, body: bytes }));
    const result = await fetcher("https://x.dev/a.png");
    expect(result).not.toBeNull();
    expect(result?.mimeType).toBe("image/png");
    expect(result?.data).toBe(bytes);
  });

  it("reads a mixed-case Content-Type header", async () => {
    const fetcher = createRemoteImageFetcher(constRequest({ headers: { "Content-Type": "image/jpeg" } }));
    const result = await fetcher("https://x.dev/a.jpg");
    expect(result?.mimeType).toBe("image/jpeg");
  });

  it("returns null on a non-200 response", async () => {
    const fetcher = createRemoteImageFetcher(constRequest({ status: 404, headers: { "content-type": "image/png" } }));
    expect(await fetcher("https://x.dev/missing.png")).toBeNull();
  });

  it("returns null when the content type is not an image", async () => {
    const fetcher = createRemoteImageFetcher(constRequest({ headers: { "content-type": "text/html" } }));
    expect(await fetcher("https://x.dev/page.html")).toBeNull();
  });

  it("returns null on a network error (never throws)", async () => {
    const throwing: RequestUrlLike = async () => {
      throw new Error("network down");
    };
    await expect(createRemoteImageFetcher(throwing)("https://x.dev/a.png")).resolves.toBeNull();
  });

  it("refuses an unsafe initial URL before any request is attempted", async () => {
    let called = false;
    const spy: RequestUrlLike = async () => {
      called = true;
      return res({ headers: { "content-type": "image/png" } });
    };
    expect(await createRemoteImageFetcher(spy)("http://127.0.0.1/a.png")).toBeNull();
    expect(called).toBe(false);
  });
});
