/**
 * Web: the OneAdvanced password is held in memory and never written anywhere.
 *
 * <p>A browser has no keychain a page can write to. `tokenStore.web.ts` is `localStorage`, plain
 * text readable by any script on the origin, and this is the user's real institutional password.
 * So the browser's own password manager keeps it instead: the credentials sheet is a real
 * `<form>` with `autocomplete` hints, the browser offers to save on submit and fills it next time
 * — behind Face ID or a fingerprint on most phones, which is the gate `biometric.ts` cannot apply
 * on web.
 *
 * <p>Held for the life of the page rather than one run, so retrying a rejected MFA code or a
 * second submit does not mean filling it again. A reload, or iOS evicting the installed app,
 * forgets it.
 */

export const PASSWORD_PERSISTS = false;

let password: string | null = null;

export async function getPassword(): Promise<string | null> {
  return password;
}

export async function setPassword(next: string): Promise<void> {
  password = next;
}

export async function deletePassword(): Promise<void> {
  password = null;
}
