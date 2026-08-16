import * as LocalAuthentication from "expo-local-authentication";

/**
 * The Face ID / fingerprint check that stands in front of a submit run.
 *
 * <p>What it protects is narrow but real: a submit run takes the OneAdvanced password out of the
 * keychain and logs in to the user's actual institutional account with it. An unlocked, unattended
 * phone should not be one tap away from that.
 *
 * <p>React-free like the rest of `lib/`, and deliberately not wired into `oa-credentials.ts` — the
 * store is also read by the credentials sheet, which prompts for the password anyway.
 */

export type GateResult =
  | { ok: true }
  /** `reason` is written to be shown to the user. */
  | { ok: false; reason: string };

/**
 * Errors that mean *the device cannot ask*, as opposed to *the person said no*.
 *
 * <p>These fall through and allow the run. A phone with no enrolled biometrics would otherwise be
 * locked out of submitting entirely, which is a worse failure than an ungated submit — the gate is
 * a second lock on top of the device's own, not the thing that makes the credentials safe. The
 * credentials are safe because they are in the keychain and the phone is locked.
 */
const UNAVAILABLE = new Set(["not_available", "not_enrolled", "passcode_not_set", "no_space"]);

/**
 * Asks the user to prove they are the phone's owner.
 *
 * <p>Everything that is not an explicit "this device cannot do biometrics" blocks — a cancel, a
 * failed match, a lockout. `disableDeviceFallback` is left at its default, so iOS offers the device
 * passcode after a failed Face ID, and that counts as success; it is the same secret that unlocks
 * the keychain the password is coming out of.
 *
 * <p><b>Face ID does not work in Expo Go on iOS</b> — it needs a development build, which this
 * project has deliberately not moved to (see AGENTS.md). In Expo Go the call reports the feature as
 * unavailable, so the gate falls through and submitting still works on the phone. On web the module
 * is unimplemented and throws, which the try/catch below turns into the same fall-through.
 */
export async function confirmIdentity(promptMessage: string): Promise<GateResult> {
  try {
    const [hasHardware, isEnrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    if (!hasHardware || !isEnrolled) return { ok: true };

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: "Cancel",
    });
    if (result.success) return { ok: true };

    if (UNAVAILABLE.has(result.error)) return { ok: true };
    if (result.error === "user_cancel" || result.error === "app_cancel" || result.error === "system_cancel") {
      return { ok: false, reason: "Cancelled — nothing was sent to OneAdvanced." };
    }
    if (result.error === "lockout") {
      return {
        ok: false,
        reason: "Too many failed attempts. Unlock your phone with its passcode and try again.",
      };
    }
    return { ok: false, reason: "Could not confirm it was you. Try again." };
  } catch {
    // The module is missing or unimplemented on this platform (web, and some Expo Go paths).
    // There is no gate to apply, so there is nothing to refuse.
    return { ok: true };
  }
}
