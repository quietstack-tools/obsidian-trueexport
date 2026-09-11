import { describe, it, expect, vi, afterEach } from "vitest";
import { validateLicence, activateLicence, deactivateLicence, DEVICE_LABEL } from "../../../src/licence/polar";

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

  it("returns 'invalid' with a clear, actionable message on a 404 (Polar's documented 'key not found' response)", async () => {
    // Confirmed against Polar's own API spec and a live request: 404 here
    // means the key genuinely doesn't exist, NOT a broken endpoint or a
    // connectivity problem — it must not show the generic "could not reach
    // the server" message, which is misleading for this specific case.
    mockFetch(async () => ({ ok: false, status: 404, json: async () => ({ error: "ResourceNotFound" }) }));
    const result = await validateLicence("BOGUS-KEY");
    expect(result.status).toBe("invalid");
    expect(result.message).toMatch(/wasn't recognised/);
    expect(result.message).not.toMatch(/Could not reach the licence server/);
  });

  it("returns 'error' (fail-open) on an unexpected non-200 response other than 404", async () => {
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

  it("includes activation_id in the request body when re-checking an existing device", async () => {
    const fn = mockFetch(async () => okJson({ status: "granted" }));
    await validateLicence("MYKEY-123", "ACT-EXISTING-1");
    const body = JSON.parse(fn.mock.calls[0][1].body);
    expect(body).toEqual({
      key: "MYKEY-123",
      organization_id: "08ae214f-e24b-4ade-8eb8-34bb29517994",
      activation_id: "ACT-EXISTING-1",
    });
  });

  it("omits activation_id entirely when none is given (a fresh key with no stored device)", async () => {
    const fn = mockFetch(async () => okJson({ status: "granted" }));
    await validateLicence("MYKEY-123");
    const body = JSON.parse(fn.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("activation_id");
  });
});

describe("activateLicence", () => {
  it("returns 'valid' with a fresh activationId and the key's device limit on success", async () => {
    // Shape confirmed against Polar's documented /activate response:
    // LicenseKeyActivationRead — id is the activation id; the device limit
    // is nested under license_key.limit_activations, not top-level.
    mockFetch(async () =>
      okJson({ id: "ACT-NEW-1", license_key_id: "LK-1", label: DEVICE_LABEL, license_key: { limit_activations: 5 } }),
    );
    const result = await activateLicence("KEY", DEVICE_LABEL);
    expect(result.status).toBe("valid");
    expect(result.activationId).toBe("ACT-NEW-1");
    expect(result.deviceLimit).toBe(5);
  });

  // A 403 NotPermitted covers more than one real reason (confirmed via a
  // live request against a REFUNDED key, which returned a revocation detail,
  // not a device-limit one) — rather than hardcode one guessed message, the
  // fix surfaces Polar's own `detail` text verbatim, whatever it says. These
  // two cases confirm BOTH a device-limit detail AND a revoked-key detail
  // pass through distinctly, rather than collapsing to one canned message.
  it("returns 'invalid' surfacing Polar's own detail text verbatim for a device-limit-reached 403", async () => {
    mockFetch(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: "NotPermitted", detail: "License key activation limit reached." }),
    }));
    const result = await activateLicence("KEY", DEVICE_LABEL);
    expect(result.status).toBe("invalid");
    expect(result.message).toContain("License key activation limit reached.");
    expect(result.message).not.toMatch(/wasn't recognised/);
  });

  it("returns 'invalid' surfacing Polar's own detail text verbatim for a revoked/refunded-key 403 (confirmed via a live request)", async () => {
    mockFetch(async () => ({
      ok: false,
      status: 403,
      json: async () => ({
        error: "NotPermitted",
        detail: "License key is not active. This license key can not be activated.",
      }),
    }));
    const result = await activateLicence("REFUNDED-KEY", DEVICE_LABEL);
    expect(result.status).toBe("invalid");
    expect(result.message).toContain("License key is not active. This license key can not be activated.");
    // Distinct from the device-limit case above — neither message is hardcoded/guessed.
    expect(result.message).not.toMatch(/device limit/i);
    expect(result.message).not.toMatch(/wasn't recognised/);
  });

  it("falls back to a generic-but-honest message on a 403 with no parseable detail", async () => {
    mockFetch(async () => ({ ok: false, status: 403, json: async () => ({ error: "NotPermitted" }) }));
    const result = await activateLicence("KEY", DEVICE_LABEL);
    expect(result.status).toBe("invalid");
    expect(result.message).toMatch(/Activation failed/);
  });

  it("returns 'invalid' with the standard message on a 404 (key not found)", async () => {
    mockFetch(async () => ({ ok: false, status: 404, json: async () => ({ error: "ResourceNotFound" }) }));
    const result = await activateLicence("BOGUS-KEY", DEVICE_LABEL);
    expect(result.status).toBe("invalid");
    expect(result.message).toMatch(/wasn't recognised/);
  });

  it("returns 'error' (fail-open) on an unexpected non-200 response", async () => {
    mockFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const result = await activateLicence("KEY", DEVICE_LABEL);
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/Could not reach the licence server/);
  });

  it("returns 'error' (fail-open) on a network error", async () => {
    mockFetch(async () => {
      throw new Error("network down");
    });
    const result = await activateLicence("KEY", DEVICE_LABEL);
    expect(result.status).toBe("error");
  });

  it("sends the key, org id, and device label — never note content", async () => {
    const fn = mockFetch(async () => okJson({ id: "ACT-1", license_key: {} }));
    await activateLicence("MYKEY-123", DEVICE_LABEL);
    const [url, opts] = fn.mock.calls[0];
    expect(url).toBe("https://api.polar.sh/v1/customer-portal/license-keys/activate");
    const body = JSON.parse(opts.body);
    expect(body).toEqual({
      key: "MYKEY-123",
      organization_id: "08ae214f-e24b-4ade-8eb8-34bb29517994",
      label: DEVICE_LABEL,
    });
  });
});

describe("deactivateLicence", () => {
  it("returns ok:true on a 204 (deactivated)", async () => {
    mockFetch(async () => ({ ok: true, status: 204, json: async () => null }));
    const result = await deactivateLicence("KEY", "ACT-1");
    expect(result.ok).toBe(true);
  });

  it("returns ok:true on a 404 too — the activation is already gone, nothing left to clean up", async () => {
    mockFetch(async () => ({ ok: false, status: 404, json: async () => ({ error: "ResourceNotFound" }) }));
    const result = await deactivateLicence("KEY", "ACT-1");
    expect(result.ok).toBe(true);
  });

  it("returns ok:false on a genuine server error — the caller must not treat this as a freed slot", async () => {
    mockFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const result = await deactivateLicence("KEY", "ACT-1");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Could not reach the licence server/);
  });

  it("returns ok:false on a network error", async () => {
    mockFetch(async () => {
      throw new Error("offline");
    });
    const result = await deactivateLicence("KEY", "ACT-1");
    expect(result.ok).toBe(false);
  });

  it("sends the key, org id, and activation_id — never note content", async () => {
    const fn = mockFetch(async () => ({ ok: true, status: 204, json: async () => null }));
    await deactivateLicence("MYKEY-123", "ACT-42");
    const [url, opts] = fn.mock.calls[0];
    expect(url).toBe("https://api.polar.sh/v1/customer-portal/license-keys/deactivate");
    const body = JSON.parse(opts.body);
    expect(body).toEqual({
      key: "MYKEY-123",
      organization_id: "08ae214f-e24b-4ade-8eb8-34bb29517994",
      activation_id: "ACT-42",
    });
  });
});
