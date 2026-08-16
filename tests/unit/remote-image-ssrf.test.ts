import { describe, it, expect } from "vitest";
import { createRemoteImageFetcher, type RequestUrlLike } from "../../src/obsidian-adapter";

// These tests model the transport (Obsidian's requestUrl) as SURFACING redirects
// — a 3xx status with a Location header — so the per-hop SSRF guard can be
// exercised. Note the accepted residual documented in createRemoteImageFetcher:
// when requestUrl instead FOLLOWS a redirect internally (returning only the final
// response), the intermediate hop is invisible and cannot be vetoed here. The
// initial-URL allow-list check and the image/* content-type gate still apply.

const IMG = new TextEncoder().encode("PNG").buffer;

interface Route {
  status?: number;
  location?: string;
  contentType?: string;
}

/**
 * A requestUrl impl that models a redirect graph: `routes[url]` is the response
 * for that URL. A 3xx response carries a Location header pointing to the next
 * hop. Records every URL actually requested, so a test can prove a blocked hop
 * was never fetched.
 */
function routedRequest(routes: Record<string, Route>): { fn: RequestUrlLike; requested: string[] } {
  const requested: string[] = [];
  const fn: RequestUrlLike = async ({ url }) => {
    requested.push(url);
    const route = routes[url];
    if (!route) throw new Error(`unexpected request of ${url}`);
    const headers: Record<string, string> = {};
    if (route.location) headers.location = route.location;
    if (route.contentType) headers["content-type"] = route.contentType;
    return { status: route.status ?? 200, headers, arrayBuffer: IMG };
  };
  return { fn, requested };
}

describe("remote-image redirect SSRF guard", () => {
  it("refuses a surfaced redirect to an internal address, and never fetches it", async () => {
    const { fn, requested } = routedRequest({
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

  it("follows a surfaced redirect to another public host and returns the image", async () => {
    const { fn } = routedRequest({
      "https://a.example.com/x.png": { status: 301, location: "https://b.example.com/x.png" },
      "https://b.example.com/x.png": { status: 200, contentType: "image/png" },
    });
    const result = await createRemoteImageFetcher(fn)("https://a.example.com/x.png");
    expect(result).not.toBeNull();
    expect(result?.mimeType).toBe("image/png");
  });

  it("re-validates a relative-Location redirect against the resolved host", async () => {
    // Relative Location resolves to the SAME (public) host → allowed.
    const { fn } = routedRequest({
      "https://a.example.com/x.png": { status: 302, location: "/real/x.png" },
      "https://a.example.com/real/x.png": { status: 200, contentType: "image/png" },
    });
    const result = await createRemoteImageFetcher(fn)("https://a.example.com/x.png");
    expect(result).not.toBeNull();
  });

  it("refuses a redirect with no Location header", async () => {
    const { fn } = routedRequest({
      "https://a.example.com/x.png": { status: 302 },
    });
    expect(await createRemoteImageFetcher(fn)("https://a.example.com/x.png")).toBeNull();
  });

  it("refuses when the redirect-hop limit is exceeded", async () => {
    // Each hop bounces to the next public host; more than MAX_REDIRECT_HOPS (3).
    const routes: Record<string, Route> = {};
    for (let i = 0; i < 6; i++) {
      routes[`https://h${i}.example.com/x.png`] = { status: 302, location: `https://h${i + 1}.example.com/x.png` };
    }
    routes["https://h6.example.com/x.png"] = { status: 200, contentType: "image/png" };
    const { fn } = routedRequest(routes);
    expect(await createRemoteImageFetcher(fn)("https://h0.example.com/x.png")).toBeNull();
  });
});
