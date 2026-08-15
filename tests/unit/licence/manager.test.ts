import { describe, it, expect, vi, afterEach } from "vitest";
import { LicenceManager, type LicenceHost, type Validator } from "../../../src/licence";

function makeHost(activated = false): LicenceHost & { saveSettings: ReturnType<typeof vi.fn> } {
  return {
    settings: { licenceKey: activated ? "OLD-KEY" : "", licenceActivated: activated, deviceCount: activated ? 1 : 0 },
    saveSettings: vi.fn(async () => {}),
  };
}

describe("LicenceManager.activate", () => {
  it("does NOT touch the network on construction (never on load)", () => {
    const validate = vi.fn<Validator>();
    // eslint-disable-next-line no-new
    new LicenceManager(makeHost(), validate);
    expect(validate).not.toHaveBeenCalled();
  });

  it("activates and stores state on a valid key", async () => {
    const host = makeHost();
    const mgr = new LicenceManager(host, async () => ({ status: "valid", message: "ok", deviceCount: 3 }));
    const outcome = await mgr.activate(" ABC-123 ");
    expect(outcome.activated).toBe(true);
    expect(host.settings.licenceActivated).toBe(true);
    expect(host.settings.licenceKey).toBe("ABC-123"); // trimmed
    expect(host.settings.deviceCount).toBe(3);
    expect(host.saveSettings).toHaveBeenCalled();
  });

  it("does not unlock on a genuinely invalid key", async () => {
    const host = makeHost();
    const mgr = new LicenceManager(host, async () => ({ status: "invalid", message: "not recognised" }));
    const outcome = await mgr.activate("BADKEY");
    expect(outcome.activated).toBe(false);
    expect(host.settings.licenceActivated).toBe(false);
  });

  it("requires a non-empty key", async () => {
    const validate = vi.fn<Validator>();
    const mgr = new LicenceManager(makeHost(), validate);
    const outcome = await mgr.activate("   ");
    expect(outcome.message).toMatch(/Enter a licence key/);
    expect(validate).not.toHaveBeenCalled();
  });

  it("FAILS OPEN: a network error after activation keeps Pro unlocked", async () => {
    const host = makeHost(true); // previously activated
    const mgr = new LicenceManager(host, async () => ({ status: "error", message: "Could not reach the licence server." }));
    const outcome = await mgr.activate("OLD-KEY");
    expect(outcome.activated).toBe(true);
    expect(host.settings.licenceActivated).toBe(true); // Pro stays unlocked
  });

  it("FAILS OPEN end-to-end: a simulated fetch failure post-activation keeps Pro", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    try {
      const host = makeHost(true);
      const mgr = new LicenceManager(host); // uses the REAL validateLicence → real fetch (mocked)
      const outcome = await mgr.activate("OLD-KEY");
      expect(outcome.activated).toBe(true);
      expect(host.settings.licenceActivated).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("does not unlock a never-activated user on a network error", async () => {
    const host = makeHost(false);
    const mgr = new LicenceManager(host, async () => ({ status: "error", message: "Could not reach the licence server." }));
    const outcome = await mgr.activate("KEY");
    expect(outcome.activated).toBe(false);
    expect(host.settings.licenceActivated).toBe(false);
    expect(outcome.message).toMatch(/Could not reach the licence server/);
  });
});

describe("LicenceManager.deactivate", () => {
  it("clears activation state", async () => {
    const host = makeHost(true);
    const mgr = new LicenceManager(host);
    await mgr.deactivate();
    expect(host.settings.licenceActivated).toBe(false);
    expect(host.settings.licenceKey).toBe("");
    expect(host.settings.deviceCount).toBe(0);
  });
});
