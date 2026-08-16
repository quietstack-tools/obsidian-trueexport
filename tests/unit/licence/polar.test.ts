import { describe, it, expect, vi, afterEach } from "vitest";
import { validateLicence } from "../../../src/licence/polar";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

function mockFetch(impl: (url: string, opts: any) => unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

function okJson(data: unknown) {
  return { ok: true, status: 200, json: async () => data };
}

describe("validateLicence", () => {
  it("returns 'valid' with the device limit (Polar's limit_activations) when granted", async () => {
    // Shape confirmed against the live validate response: the device figure is
    // `limit_activations`; `usage` is an unrelated usage-meter and must be ignored.
    mockFetch(async () => okJson({ status: "granted", limit_activations: 3, usage: 0 }));
    const result = await validateLicence("KEY");
    expect(result.status).toBe("valid");
    expect(result.deviceLimit).toBe(3);
  });

  it("does not mistake the usage-meter for the device limit", async () => {
    mockFetch(async () => okJson({ status: "granted", usage: 7 }));
    const result = await validateLicence("KEY");
    expect(result.status).toBe("valid");
    expect(result.deviceLimit).toBeUndefined();
  });

  it("returns 'invalid' when the server reaches but rejects the key", async () => {
    mockFetch(async () => okJson({ status: "revoked" }));
    const result = await validateLicence("BADKEY");
    expect(result.status).toBe("invalid");
  });

  it("returns 'error' (fail-open) on a non-200 response", async () => {
    mockFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const result = await validateLicence("KEY");
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/Could not reach the licence server/);
  });

  it("returns 'error' (fail-open) on a network error", async () => {
    mockFetch(async () => {
      throw new Error("network down");
    });
    const result = await validateLicence("KEY");
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/Could not reach the licence server/);
    expect(result.message).not.toMatch(/Activation failed/); // specific, not generic
  });

  it("times out after 10 seconds and returns a specific message", async () => {
    vi.useFakeTimers();
    mockFetch(
      (_url, opts) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const pending = validateLicence("KEY");
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/timed out/);
  });

  it("transmits ONLY the licence key and org id — never note content", async () => {
    const fn = mockFetch(async () => okJson({ status: "granted" }));
    await validateLicence("MYKEY-123");
    const [url, opts] = fn.mock.calls[0];
    expect(url).toBe("https://api.polar.sh/v1/customer-portal/license-keys/validate");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body).toEqual({ key: "MYKEY-123", organization_id: "08ae214f-e24b-4ade-8eb8-34bb29517994" });
  });
});
