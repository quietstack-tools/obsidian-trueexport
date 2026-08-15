// src/licence/polar.ts
//
// THE SECOND AND LAST NETWORK CALL PERMITTED IN THE ENTIRE CODEBASE.
// (The first is the opt-in, default-off remote-image fetch.) Nothing else may
// call fetch / XMLHttpRequest / requestUrl.
//
// ⚠️⚠️ NOT PRODUCTION READY ⚠️⚠️
// POLAR_ORG_ID below is the literal placeholder from the spec. It MUST be
// replaced with the real Polar organisation ID (a GTM-phase task, outside this
// build) before Stage 8 can be considered complete or any release build is cut.
//
// Privacy (§7.2): note content is NEVER transmitted — only the licence key the
// user typed, plus the (non-secret) organisation id.

// ⚠️ PLACEHOLDER — replace before release. See file header.
const POLAR_ORG_ID = "<your-organization-id>"; // not a secret

const VALIDATE_URL = "https://api.polar.sh/v1/customer-portal/license-keys/validate";
const TIMEOUT_MS = 10_000;

export interface LicenceResult {
  /**
   * "valid"   — server reached, key accepted → activate.
   * "invalid" — server reached, key genuinely rejected → do not activate.
   * "error"   — network error / timeout / non-200 → fail open (§7.2 rule 3).
   */
  status: "valid" | "invalid" | "error";
  message: string;
  /** Activation count for this key, if the API returns it (§6.4 device count). */
  deviceCount?: number;
}

export async function validateLicence(key: string): Promise<LicenceResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(VALIDATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Only the key + org id leave the device. Never note content.
      body: JSON.stringify({ key, organization_id: POLAR_ORG_ID }),
      signal: controller.signal,
    });

    // Any non-200 is treated as "couldn't validate" → fail open (§7.2).
    if (!res.ok) {
      return {
        status: "error",
        message: `Could not reach the licence server (status ${res.status}). Check your connection and try again.`,
      };
    }

    const data = (await res.json()) as Record<string, unknown> | null;
    if (isGranted(data)) {
      return { status: "valid", message: "Licence key accepted.", deviceCount: usageCount(data) };
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

function isGranted(data: Record<string, unknown> | null): boolean {
  if (!data) return false;
  return data["status"] === "granted" || data["valid"] === true;
}

/** Best-effort device/activation count; field shape depends on Polar's response. */
function usageCount(data: Record<string, unknown> | null): number | undefined {
  if (data && typeof data["usage"] === "number") return data["usage"];
  return undefined;
}
