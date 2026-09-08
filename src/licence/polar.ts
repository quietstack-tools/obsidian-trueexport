// src/licence/polar.ts
//
// THE SECOND AND LAST NETWORK CALL PERMITTED IN THE ENTIRE CODEBASE.
// (The first is the opt-in, default-off remote-image fetch.) Nothing else may
// call fetch / XMLHttpRequest / requestUrl.
//
// Privacy (§7.2): note content is NEVER transmitted — only the licence key the
// user typed, the (non-secret) organisation id, and (for activation) a fixed,
// generic device label — never a hostname/username/anything else identifying.

const POLAR_ORG_ID = "08ae214f-e24b-4ade-8eb8-34bb29517994"; // not a secret

const VALIDATE_URL = "https://api.polar.sh/v1/customer-portal/license-keys/validate";
const ACTIVATE_URL = "https://api.polar.sh/v1/customer-portal/license-keys/activate";
const DEACTIVATE_URL = "https://api.polar.sh/v1/customer-portal/license-keys/deactivate";
const TIMEOUT_MS = 10_000;

/**
 * A fixed, generic device label sent to Polar's `/activate` endpoint (its
 * `label` field is required). Deliberately NOT a hostname/username/anything
 * device-identifying — just enough for the user to recognise "this came from
 * the Obsidian plugin" in their Polar customer portal.
 */
export const DEVICE_LABEL = "Obsidian";

export interface LicenceResult {
  /**
   * "valid"   — server reached, key accepted → activate.
   * "invalid" — server reached, key genuinely rejected: a 200 response that
   *             isn't granted, a 404 (Polar's documented "key not found"),
   *             or a 403 NotPermitted from /activate (device limit reached
   *             or activation not supported on this key) → do not activate.
   * "error"   — network error / timeout / any other unexpected non-200 →
   *             fail open (§7.2 rule 3).
   */
  status: "valid" | "invalid" | "error";
  message: string;
  /**
   * The key's device/activation limit (§6.4), from Polar's `limit_activations`.
   * Confirmed against the live validate/activate responses — this is the
   * only device figure Polar returns here; there is no current-activation
   * count in the customer-portal payloads. (Not `usage`, an unrelated
   * usage-meter that stays 0.)
   */
  deviceLimit?: number;
  /**
   * Present only on a successful activateLicence() call. The caller MUST
   * persist this and pass it into validateLicence()'s `activationId` param
   * for every later re-check on this device — re-checking without it would
   * mean calling /activate again, which creates a NEW activation and
   * consumes another one of the key's limited device slots for no reason.
   */
  activationId?: string;
}

export interface DeactivationResult {
  /** True once the device slot is genuinely free on Polar's side (204), or
   *  already gone (404 — nothing left to clean up). False on any real
   *  failure — the caller must NOT clear local state in that case, or the
   *  user will believe a slot was freed when it wasn't. */
  ok: boolean;
  message: string;
}

/**
 * Check a licence key's status. Pass `activationId` (from a prior
 * activateLicence() call) to re-check an EXISTING device's activation
 * without creating a new one — omit it only for a key that has no
 * per-device activation concept at all (Polar rejects that combination via
 * activateLicence()'s own 403 case, per its documented "use /validate for
 * licenses without activations" guidance).
 */
export async function validateLicence(key: string, activationId?: string): Promise<LicenceResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(VALIDATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Only the key + org id (+ this device's own activation id) leave the
      // device. Never note content.
      body: JSON.stringify({
        key,
        organization_id: POLAR_ORG_ID,
        ...(activationId ? { activation_id: activationId } : {}),
      }),
      signal: controller.signal,
    });

    // Polar's own API spec documents 404 on this endpoint as "License key not
    // found" — a genuine response, not a connectivity problem, so it must NOT
    // be lumped in with the generic fail-open "couldn't reach server" case
    // below (confirmed via a live request with a real, valid key: 200, no
    // redirect, correct URL — the endpoint itself is fine; only an actual
    // nonexistent/mistyped key produces this 404).
    if (res.status === 404) {
      return {
        status: "invalid",
        message:
          "That licence key wasn't recognised. Check that you copied it correctly, or contact support if you believe this is an error.",
      };
    }

    // Any other non-200 (e.g. a transient 5xx, or a 422 the client-side
    // request shape should never actually trigger) is a genuine "couldn't
    // validate" case → fail open (§7.2).
    if (!res.ok) {
      return {
        status: "error",
        message: `Could not reach the licence server (status ${res.status}). Check your connection and try again.`,
      };
    }

    const data = (await res.json()) as Record<string, unknown> | null;
    if (isGranted(data)) {
      return { status: "valid", message: "Licence key accepted.", deviceLimit: activationLimit(data) };
    }
    return {
      status: "invalid",
      message: "That licence key wasn't recognised. Check the key and try again.",
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      status: "error",
      message: aborted
        ? "The licence server timed out. Check your connection and try again."
        : "Could not reach the licence server. Check your connection and try again.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Activate a NEW device slot for this licence key (§6.4). Distinct from
 * validateLicence(): this CONSUMES one of the key's limit_activations slots
 * and returns a fresh `activationId` that must be persisted and reused (via
 * validateLicence()'s `activationId` param) for every later check on this
 * device. Call this only when the caller has no stored activationId yet for
 * the current key — never on every re-check, or every re-check would burn
 * through the device limit on its own.
 */
export async function activateLicence(key: string, label: string): Promise<LicenceResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ACTIVATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, organization_id: POLAR_ORG_ID, label }),
      signal: controller.signal,
    });

    // Polar's documented response for this endpoint specifically: "License
    // key activation not supported or limit reached." A genuine, confirmed
    // rejection — not a connectivity problem — so (like the 404 case below)
    // this must NOT be lumped into the generic fail-open "error" status, and
    // it must be a message DISTINCT from "key not recognised": the key is
    // perfectly valid, there's just no room left for another device.
    if (res.status === 403) {
      return {
        status: "invalid",
        message:
          "You've reached this key's device limit. Deactivate a device in the Polar customer portal, or contact support.",
      };
    }
    if (res.status === 404) {
      return {
        status: "invalid",
        message:
          "That licence key wasn't recognised. Check that you copied it correctly, or contact support if you believe this is an error.",
      };
    }
    if (!res.ok) {
      return {
        status: "error",
        message: `Could not reach the licence server (status ${res.status}). Check your connection and try again.`,
      };
    }

    // A 200 here always means a new activation was created — there's no
    // granted/revoked status field on this response shape the way /validate
    // has; success is the status code itself.
    const data = (await res.json()) as Record<string, unknown> | null;
    const activationId = data && typeof data["id"] === "string" ? data["id"] : undefined;
    const licenseKey =
      data && typeof data["license_key"] === "object" && data["license_key"] !== null
        ? (data["license_key"] as Record<string, unknown>)
        : null;
    return {
      status: "valid",
      message: "Licence key accepted.",
      deviceLimit: activationLimit(licenseKey),
      activationId,
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      status: "error",
      message: aborted
        ? "The licence server timed out. Check your connection and try again."
        : "Could not reach the licence server. Check your connection and try again.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Release a device's activation slot (§6.4 — "Deactivate", e.g. moving to
 * another device). Requires the activationId a prior activateLicence() call
 * returned. A genuine failure (network/server error) MUST NOT be treated as
 * success by the caller — claiming a slot was freed when it wasn't would
 * leave the user unable to explain why a later 6th-device activation still
 * fails.
 */
export async function deactivateLicence(key: string, activationId: string): Promise<DeactivationResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(DEACTIVATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, organization_id: POLAR_ORG_ID, activation_id: activationId }),
      signal: controller.signal,
    });

    // 204 = deactivated. 404 = the key/activation is already gone (e.g.
    // deactivated some other way already) — nothing left to clean up, so
    // this counts as success too, not a failure.
    if (res.status === 204 || res.status === 404) {
      return { ok: true, message: "Device deactivated." };
    }
    return {
      ok: false,
      message: `Could not reach the licence server (status ${res.status}). Check your connection and try again.`,
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      message: aborted
        ? "The licence server timed out. Check your connection and try again."
        : "Could not reach the licence server. Check your connection and try again.",
    };
  } finally {
    clearTimeout(timer);
  }
}

function isGranted(data: Record<string, unknown> | null): boolean {
  if (!data) return false;
  return data["status"] === "granted" || data["valid"] === true;
}

/**
 * The key's activation (device) limit. Both validate's response AND
 * activate's nested `license_key` object return `limit_activations` (e.g. 3);
 * neither returns a current-activation COUNT, so this is a limit, not a
 * usage figure. Verified against the live API.
 */
function activationLimit(data: Record<string, unknown> | null): number | undefined {
  if (data && typeof data["limit_activations"] === "number") return data["limit_activations"];
  return undefined;
}
