// src/licence/index.ts
//
// Activation flow and Pro gating. The network call (validateLicence /
// activateLicence / deactivateLicence) is made ONLY from activate()/
// deactivate(), i.e. only when the user clicks Activate/Deactivate — never
// on load, never on export, never on a timer (§7.2 rule 1). Successful
// activation state is cached in plugin data and never automatically
// revalidated (rule 2).

import { validateLicence, activateLicence, deactivateLicence, DEVICE_LABEL, type LicenceResult } from "./polar";

export type { LicenceResult } from "./polar";

/** The subset of plugin settings the licence manager reads/writes. */
export interface LicenceSettings {
  licenceKey: string;
  licenceActivated: boolean;
  deviceLimit: number;
  /**
   * This device's activation id, returned by Polar's /activate endpoint on
   * first activation. Reused on every later check (via validateLicence's
   * activationId param) so re-checking never creates a new activation and
   * never consumes another one of the key's limited device slots. Empty when
   * not activated, or for state persisted before this field existed.
   */
  licenceActivationId: string;
}

export interface LicenceHost {
  settings: LicenceSettings;
  saveSettings(): Promise<void>;
}

export interface ActivationOutcome {
  activated: boolean;
  message: string;
}

export type Validator = (key: string, activationId?: string) => Promise<LicenceResult>;
export type Activator = (key: string, label: string) => Promise<LicenceResult>;
export type Deactivator = (key: string, activationId: string) => Promise<{ ok: boolean; message: string }>;

export class LicenceManager {
  // Each network call is injectable so tests never touch the network.
  constructor(
    private readonly host: LicenceHost,
    private readonly validate: Validator = validateLicence,
    private readonly activateNewDevice: Activator = activateLicence,
    private readonly deactivateDevice: Deactivator = deactivateLicence,
  ) {}

  get isActivated(): boolean {
    return this.host.settings.licenceActivated;
  }

  get deviceLimit(): number {
    return this.host.settings.deviceLimit;
  }

  /**
   * Called only from the Activate button. Performs the one network call —
   * /activate on this device's first-ever activation for this key (creates
   * a new activation slot and stores its id), or /validate with the already-
   * stored activation id on any later check (never creates a new slot).
   */
  async activate(key: string): Promise<ActivationOutcome> {
    const trimmed = key.trim();
    if (trimmed === "") {
      return { activated: this.isActivated, message: "Enter a licence key first." };
    }

    const existingActivationId = this.host.settings.licenceActivationId;
    const result = existingActivationId
      ? await this.validate(trimmed, existingActivationId)
      : await this.activateNewDevice(trimmed, DEVICE_LABEL);

    if (result.status === "valid") {
      this.host.settings.licenceKey = trimmed;
      this.host.settings.licenceActivated = true;
      this.host.settings.deviceLimit = result.deviceLimit ?? 0;
      // Only activateNewDevice() ever returns a fresh activationId; a
      // validate()-only recheck keeps whatever was already stored.
      if (result.activationId) this.host.settings.licenceActivationId = result.activationId;
      await this.host.saveSettings();
      return { activated: true, message: "TrueExport Pro activated. Thank you!" };
    }

    if (result.status === "invalid") {
      // Server reached, key/activation genuinely rejected (includes the
      // device-limit-reached case): don't change existing state.
      return {
        activated: this.isActivated,
        message: result.message,
      };
    }

    // status === "error": network error / timeout / non-200 → FAIL OPEN.
    // A paying customer must not be locked out by an outage: if they were
    // already activated, Pro stays unlocked (§7.2 rule 3).
    if (this.isActivated) {
      return {
        activated: true,
        message: "Could not reach the licence server, so your existing Pro activation was kept.",
      };
    }
    return { activated: false, message: result.message };
  }

  /**
   * Manual deactivation (e.g. moving to another device). Genuinely releases
   * the device's activation slot on Polar's side when one is stored — a
   * network/server failure does NOT clear local state, so the user is never
   * told a slot was freed when it wasn't (which would leave them unable to
   * explain why a later activation elsewhere still hits the device limit).
   */
  async deactivate(): Promise<ActivationOutcome> {
    const { licenceKey, licenceActivationId } = this.host.settings;
    if (licenceActivationId !== "") {
      const result = await this.deactivateDevice(licenceKey, licenceActivationId);
      if (!result.ok) {
        return { activated: this.isActivated, message: `Could not deactivate: ${result.message}` };
      }
    }
    this.host.settings.licenceActivated = false;
    this.host.settings.licenceKey = "";
    this.host.settings.deviceLimit = 0;
    this.host.settings.licenceActivationId = "";
    await this.host.saveSettings();
    return { activated: false, message: "Licence deactivated." };
  }
}
