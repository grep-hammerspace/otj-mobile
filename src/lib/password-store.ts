import { deleteStored, getStored, setStored } from "./tokenStore";

/**
 * Native: the OneAdvanced password lives in the keychain / keystore alongside the username.
 * `password-store.web.ts` is the browser's counterpart, and the reason this is a seam at all.
 */

const PASSWORD_KEY = "otj.oa.password";

/** Whether a saved password survives the app closing. Drives wording and the web submit flow. */
export const PASSWORD_PERSISTS = true;

export async function getPassword(): Promise<string | null> {
  return getStored(PASSWORD_KEY);
}

export async function setPassword(password: string): Promise<void> {
  await setStored(PASSWORD_KEY, password);
}

export async function deletePassword(): Promise<void> {
  await deleteStored(PASSWORD_KEY);
}
