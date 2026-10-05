/**
 * Web: expo-secure-store has no web implementation, so this is localStorage — plain text, readable
 * by any script on the origin.
 *
 * <p>Accepted for what goes through here on web: this app's session token, the self-hosted URL,
 * the OneAdvanced username and the remembered login route. The token reaches only this app's own
 * account. The OneAdvanced password deliberately does not come here — see
 * `password-store.web.ts`.
 */
export async function getStored(key: string): Promise<string | null> {
  return localStorage.getItem(key);
}

export async function setStored(key: string, value: string): Promise<void> {
  localStorage.setItem(key, value);
}

export async function deleteStored(key: string): Promise<void> {
  localStorage.removeItem(key);
}
