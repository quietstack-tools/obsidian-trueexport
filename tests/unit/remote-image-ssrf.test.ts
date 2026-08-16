import { describe, it, expect } from "vitest";
import { createRemoteImageFetcher } from "../../src/obsidian-adapter";

const IMG = new TextEncoder().encode("PNG").buffer;

function makeRes(fields: { status?: number; type?: string; headers?: Record<string, string>; body?: ArrayBuffer }): Response {
  const status = fields.status ?? 200;
  const headers = fields.headers ?? {};
  return {
    status,
    type: fields.type ?? "basic",
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    arrayBuffer: async () => fields.body ?? new ArrayBuffer(0),
  } as unknown as Response;
}

/**
 * A fetch that models a redirect graph: `routes[url]` is the response for that
 * URL. A 30x response carries a Location header pointing to the next hop. Also
 * records every URL that was actually requested, so a test can prove a blocked
 * hop was never fetched.
 */
function routedFetch(routes: Record<string, { status?: number; location?: string; contentType?: string }>) {
  const requested: string[] = [];
  const fn = (async (url: string) => {
    requested.push(url);
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch of ${url}`);
    const status = route.status ?? 200;
    const headers: Record<string, string> = {};
    if (route.location) headers.location = route.location;
    if (route.contentType) headers["content-type"] = route.contentType;
    return makeRes({ status, headers, body: IMG });
  }) as unknown as typeof fetch;
  return { fn, requested };
}

describe("remote-image redirect SSRF guard", () => {
  it("refuses a public host that redirects to an internal address, and never fetches it", async () => {
    const { fn, requested } = routedFetch({
      "https://cdn.example.com/logo.png": { status: 302, location: "http://169.254.169.254/latest/meta-data/" },
      // The internal target has a route too, so if the guard wrongly followed it
      // the test would see it in `requested` (it must NOT).
      "http://169.254.169.254/latest/meta-data/": { status: 200, contentType: "image/png" },
    });
    const result = await createRemoteImageFetcher(fn)("https://cdn.example.com/logo.png");
    expect(result).toBeNull();
    expect(requested).toEqual(["https://cdn.example.com/logo.png"]);
    expect(requested).not.toContain("http://169.254.169.254/latest/meta-data/");
  });

  it("follows a redirect to another public host and returns the image", async () => {
    const { fn } = routedFetch({
      "https://a.example.com/x.png": { status: 301, location: "https://b.example.com/x.png" },
      "https://b.example.com/x.png": { status: 200, contentType: "image/png" },
    });
    const result = await createRemoteImageFetcher(fn)("https://a.example.com/x.png");
    expect(result).not.toBeNull();
    expect(result?.mimeType).toBe("image/png");
  });

  it("re-validates a relative-Location redirect against the resolved host", async () => {
    // Relative Location resolves to the SAME (public) host → allowed.
    const { fn } = routedFetch({
      "https://a.example.com/x.png": { status: 302, location: "/real/x.png" },
      "https://a.example.com/real/x.png": { status: 200, contentType: "image/png" },
    });
    const result = await createRemoteImageFetcher(fn)("https://a.example.com/x.png");
    expect(result).not.toBeNull();
  });

  it("refuses an opaque (un-inspectable) redirect", async () => {
    const fn = (async () => makeRes({ status: 0, type: "opaqueredirect" })) as unknown as typeof fetch;
    expect(await createRemoteImageFetcher(fn)("https://a.example.com/x.png")).toBeNull();
  });

  it("refuses when the redirect-hop limit is exceeded", async () => {
    // Each hop bounces to the next public host; more than MAX_REDIRECT_HOPS (3).
    const routes: Record<string, { status?: number; location?: string; contentType?: string }> = {};
    for (let i = 0; i < 6; i++) {
      routes[`https://h${i}.example.com/x.png`] = { status: 302, location: `https://h${i + 1}.example.com/x.png` };
    }
    routes["https://h6.example.com/x.png"] = { status: 200, contentType: "image/png" };
    const { fn } = routedFetch(routes);
    expect(await createRemoteImageFetcher(fn)("https://h0.example.com/x.png")).toBeNull();
  });
});
