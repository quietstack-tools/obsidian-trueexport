// src/licence/index.ts
//
// Activation flow and Pro gating. The network call (validateLicence) is made
// ONLY from activate(), i.e. only when the user clicks Activate — never on
// load, never on export, never on a timer (§7.2 rule 1). The result is cached
// in plugin data and never automatically revalidated (rule 2).

import { validateLicence, type LicenceResult } from "./polar";

export type { LicenceResult } from "./polar";

/** The subset of plugin settings the licence manager reads/writes. */
export interface LicenceSettings {
  licenceKey: string;
  licenceActivated: boolean;
  deviceCount: number;
}

export interface LicenceHost {
  settings: LicenceSettings;
  saveSettings(): Promise<void>;
}

export interface ActivationOutcome {
  activated: boolean;
  message: string;
}

export type Validator = (key: string) => Promise<LicenceResult>;

export class LicenceManager {
  // The validator is injectable so tests never touch the network.
  constructor(
    private readonly host: LicenceHost,
    private readonly validate: Validator = validateLicence,
  ) {}

  get isActivated(): boolean {
    return this.host.settings.licenceActivated;
  }

  get deviceCount(): number {
    return this.host.settings.deviceCount;
  }

  /** Called only from the Activate button. Performs the one network call. */
  async activate(key: string): Promise<ActivationOutcome> {
    const trimmed = key.trim();
    if (trimmed === "") {
      return { activated: this.isActivated, message: "Enter a licence key first." };
    }

    const result = await this.validate(trimmed);

    if (result.status === "valid") {
      this.host.settings.licenceKey = trimmed;
      this.host.settings.licenceActivated = true;
      this.host.settings.deviceCount = result.deviceCount ?? 0;
      await this.host.saveSettings();
      return { activated: true, message: "TrueExport Pro activated. Thank you!" };
    }

    if (result.status === "invalid") {
      // Server reached, key genuinely rejected: don't change existing state.
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

  /** Manual deactivation (e.g. moving to another device). No network call. */
  async deactivate(): Promise<void> {
    this.host.settings.licenceActivated = false;
    this.host.settings.licenceKey = "";
    this.host.settings.deviceCount = 0;
    await this.host.saveSettings();
  }
}
