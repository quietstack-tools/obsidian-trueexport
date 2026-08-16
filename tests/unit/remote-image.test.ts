import { describe, it, expect } from "vitest";
import { createRemoteImageFetcher } from "../../src/obsidian-adapter";

// Minimal fetch-response stand-in covering the fields the fetcher reads.
interface FakeRes {
  status?: number;
  type?: string;
  headers?: Record<string, string>;
  body?: ArrayBuffer;
}
function res(r: FakeRes = {}): Response {
  const status = r.status ?? 200;
  const headers = r.headers ?? {};
  return {
    status,
    type: r.type ?? "basic",
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    arrayBuffer: async () => r.body ?? new ArrayBuffer(0),
  } as unknown as Response;
}

/** A fetch impl that always returns the same response, ignoring the URL. */
function constFetch(r: FakeRes): typeof fetch {
  return (async () => res(r)) as unknown as typeof fetch;
}

describe("createRemoteImageFetcher (§7.6)", () => {
  it("returns bytes and MIME type for a 200 image response", async () => {
    const bytes = new TextEncoder().encode("PNGDATA").buffer;
    const fetcher = createRemoteImageFetcher(constFetch({ headers: { "content-type": "image/png" }, body: bytes }));
    const result = await fetcher("https://x.dev/a.png");
    expect(result).not.toBeNull();
    expect(result?.mimeType).toBe("image/png");
    expect(result?.data).toBe(bytes);
  });

  it("returns null on a non-200 response", async () => {
    const fetcher = createRemoteImageFetcher(constFetch({ status: 404, headers: { "content-type": "image/png" } }));
    expect(await fetcher("https://x.dev/missing.png")).toBeNull();
  });

  it("returns null when the content type is not an image", async () => {
    const fetcher = createRemoteImageFetcher(constFetch({ headers: { "content-type": "text/html" } }));
    expect(await fetcher("https://x.dev/page.html")).toBeNull();
  });

  it("returns null on a network error (never throws)", async () => {
    const throwing = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(createRemoteImageFetcher(throwing)("https://x.dev/a.png")).resolves.toBeNull();
  });

  it("refuses an unsafe initial URL before any fetch is attempted", async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return res({ headers: { "content-type": "image/png" } });
    }) as unknown as typeof fetch;
    expect(await createRemoteImageFetcher(spy)("http://127.0.0.1/a.png")).toBeNull();
    expect(called).toBe(false);
  });
});
