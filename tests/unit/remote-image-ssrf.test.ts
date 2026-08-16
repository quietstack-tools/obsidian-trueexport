import { describe, it, expect, afterEach } from "vitest";
import { setRequestUrlHandler } from "../mocks/obsidian";
import { createRemoteImageFetcher } from "../../src/obsidian-adapter";

// A handler that would happily return a valid image for ANY url, so a null
// result can only come from the SSRF guard refusing to fetch.
const okImage = async () => ({
  status: 200,
  headers: { "content-type": "image/png" },
  arrayBuffer: new TextEncoder().encode("PNG").buffer,
  text: "",
});

afterEach(() => setRequestUrlHandler(okImage));

describe("createRemoteImageFetcher SSRF guard", () => {
  it("refuses loopback / private / link-local targets before fetching", async () => {
    setRequestUrlHandler(okImage);
    const fetch = createRemoteImageFetcher();
    expect(await fetch("http://127.0.0.1/x.png")).toBeNull();
    expect(await fetch("http://localhost/x.png")).toBeNull();
    expect(await fetch("http://169.254.169.254/latest/meta-data/")).toBeNull();
    expect(await fetch("http://192.168.0.10/x.png")).toBeNull();
    expect(await fetch("file:///etc/passwd")).toBeNull();
  });

  it("still fetches a public host", async () => {
    setRequestUrlHandler(okImage);
    const result = await createRemoteImageFetcher()("https://cdn.example.com/a.png");
    expect(result).not.toBeNull();
    expect(result?.mimeType).toBe("image/png");
  });
});
