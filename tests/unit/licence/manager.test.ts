import { describe, it, expect, vi, afterEach } from "vitest";
import { LicenceManager, type LicenceHost, type Validator, type Activator, type Deactivator } from "../../../src/licence";

function makeHost(
  activated = false,
  activationId = activated ? "ACT-1" : "",
): LicenceHost & { saveSettings: ReturnType<typeof vi.fn> } {
  return {
    settings: {
      licenceKey: activated ? "OLD-KEY" : "",
      licenceActivated: activated,
      deviceLimit: activated ? 1 : 0,
      licenceActivationId: activationId,
    },
    saveSettings: vi.fn(async () => {}),
  };
}

describe("LicenceManager.activate", () => {
  it("does NOT touch the network on construction (never on load)", () => {
    const validate = vi.fn<Validator>();
    const activateNewDevice = vi.fn<Activator>();
    // eslint-disable-next-line no-new
    new LicenceManager(makeHost(), validate, activateNewDevice);
    expect(validate).not.toHaveBeenCalled();
    expect(activateNewDevice).not.toHaveBeenCalled();
  });

  it("on a FRESH device (no stored activationId), calls /activate — not /validate — and persists the returned activationId", async () => {
    const host = makeHost(); // not activated, no activationId
    const validate = vi.fn<Validator>();
    const activateNewDevice = vi.fn<Activator>(async () => ({
      status: "valid",
      message: "ok",
      deviceLimit: 3,
      activationId: "ACT-NEW-99",
    }));
    const mgr = new LicenceManager(host, validate, activateNewDevice);
    const outcome = await mgr.activate(" ABC-123 ");

    expect(outcome.activated).toBe(true);
    expect(activateNewDevice).toHaveBeenCalledWith("ABC-123", "Obsidian");
    expect(validate).not.toHaveBeenCalled();
    expect(host.settings.licenceActivated).toBe(true);
    expect(host.settings.licenceKey).toBe("ABC-123"); // trimmed
    expect(host.settings.deviceLimit).toBe(3);
    expect(host.settings.licenceActivationId).toBe("ACT-NEW-99");
    expect(host.saveSettings).toHaveBeenCalled();
  });

  it("on a RE-CHECK (an activationId is already stored), calls /validate with it — never /activate again", async () => {
    const host = makeHost(true, "ACT-EXISTING"); // already activated, has a stored activationId
    const activateNewDevice = vi.fn<Activator>();
    const validate = vi.fn<Validator>(async () => ({ status: "valid", message: "ok", deviceLimit: 1 }));
    const mgr = new LicenceManager(host, validate, activateNewDevice);
    const outcome = await mgr.activate("OLD-KEY");

    expect(outcome.activated).toBe(true);
    expect(validate).toHaveBeenCalledWith("OLD-KEY", "ACT-EXISTING");
    expect(activateNewDevice).not.toHaveBeenCalled(); // re-checking must never consume another device slot
    // A validate-only recheck returns no activationId of its own — the
    // already-stored one must be left untouched, not blanked.
    expect(host.settings.licenceActivationId).toBe("ACT-EXISTING");
  });

  it("does not unlock on a genuinely invalid key (fresh activation)", async () => {
    const host = makeHost();
    const mgr = new LicenceManager(
      host,
      vi.fn<Validator>(),
      async () => ({ status: "invalid", message: "not recognised" }),
    );
    const outcome = await mgr.activate("BADKEY");
    expect(outcome.activated).toBe(false);
    expect(host.settings.licenceActivated).toBe(false);
  });

  // The actual reported defect: an /activate 403 NotPermitted rejection
  // (device limit reached, a revoked/refunded key, or any other reason —
  // see src/licence/polar.ts, which surfaces Polar's own `detail` text
  // verbatim rather than a single hardcoded guess) must show a message
  // distinct from "key not recognised". This confirms the manager passes
  // whatever specific message it's given through unchanged, rather than
  // genericising it.
  it("surfaces a 403/NotPermitted rejection's specific message distinctly (not the generic invalid-key message)", async () => {
    const host = makeHost();
    const limitMessage = "Activation failed: License key is not active. This license key can not be activated.";
    const mgr = new LicenceManager(host, vi.fn<Validator>(), async () => ({ status: "invalid", message: limitMessage }));
    const outcome = await mgr.activate("REFUNDED-KEY");
    expect(outcome.activated).toBe(false);
    expect(outcome.message).toBe(limitMessage);
    expect(outcome.message).not.toMatch(/wasn't recognised/);
  });

  it("requires a non-empty key", async () => {
    const validate = vi.fn<Validator>();
    const activateNewDevice = vi.fn<Activator>();
    const mgr = new LicenceManager(makeHost(), validate, activateNewDevice);
    const outcome = await mgr.activate("   ");
    expect(outcome.message).toMatch(/Enter a licence key/);
    expect(validate).not.toHaveBeenCalled();
    expect(activateNewDevice).not.toHaveBeenCalled();
  });

  it("FAILS OPEN: a network error on a re-check keeps Pro unlocked", async () => {
    const host = makeHost(true, "ACT-EXISTING"); // previously activated
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
      const host = makeHost(true, "ACT-EXISTING");
      const mgr = new LicenceManager(host); // uses the REAL validateLicence → real fetch (mocked)
      const outcome = await mgr.activate("OLD-KEY");
      expect(outcome.activated).toBe(true);
      expect(host.settings.licenceActivated).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("does not unlock a never-activated user on a network error (fresh activation attempt)", async () => {
    const host = makeHost(false);
    const mgr = new LicenceManager(
      host,
      vi.fn<Validator>(),
      async () => ({ status: "error", message: "Could not reach the licence server." }),
    );
    const outcome = await mgr.activate("KEY");
    expect(outcome.activated).toBe(false);
    expect(host.settings.licenceActivated).toBe(false);
    expect(outcome.message).toMatch(/Could not reach the licence server/);
  });
});

describe("LicenceManager.deactivate", () => {
  it("calls /deactivate with the stored key + activationId, and clears all local state on success", async () => {
    const host = makeHost(true, "ACT-EXISTING");
    const deactivateDevice = vi.fn<Deactivator>(async () => ({ ok: true, message: "Device deactivated." }));
    const mgr = new LicenceManager(host, undefined, undefined, deactivateDevice);
    const outcome = await mgr.deactivate();

    expect(deactivateDevice).toHaveBeenCalledWith("OLD-KEY", "ACT-EXISTING");
    expect(outcome.activated).toBe(false);
    expect(host.settings.licenceActivated).toBe(false);
    expect(host.settings.licenceKey).toBe("");
    expect(host.settings.deviceLimit).toBe(0);
    expect(host.settings.licenceActivationId).toBe("");
  });

  // The earlier in-app deactivate/reactivate manual test only ever exercised
  // LOCAL state — deactivate() previously made NO network call at all. This
  // confirms the new behaviour: a genuine server-side failure must NOT be
  // silently treated as success, or the user has no way to know their device
  // slot on Polar is still occupied.
  it("does NOT clear local state when the server-side deactivation genuinely fails", async () => {
    const host = makeHost(true, "ACT-EXISTING");
    const deactivateDevice = vi.fn<Deactivator>(async () => ({
      ok: false,
      message: "Could not reach the licence server. Check your connection and try again.",
    }));
    const mgr = new LicenceManager(host, undefined, undefined, deactivateDevice);
    const outcome = await mgr.deactivate();

    expect(outcome.activated).toBe(true); // still activated locally
    expect(outcome.message).toMatch(/Could not deactivate/);
    expect(host.settings.licenceActivated).toBe(true);
    expect(host.settings.licenceKey).toBe("OLD-KEY");
    expect(host.settings.licenceActivationId).toBe("ACT-EXISTING");
  });

  it("clears local state without a network call when there was never a stored activationId", async () => {
    // Legacy/edge case: activated state persisted before this field existed,
    // or an activation whose id was never captured. Nothing to release on
    // Polar's side, so deactivate() must not attempt a call it can't make.
    const host = makeHost(true, "");
    const deactivateDevice = vi.fn<Deactivator>();
    const mgr = new LicenceManager(host, undefined, undefined, deactivateDevice);
    const outcome = await mgr.deactivate();

    expect(deactivateDevice).not.toHaveBeenCalled();
    expect(outcome.activated).toBe(false);
    expect(host.settings.licenceActivated).toBe(false);
  });
});
