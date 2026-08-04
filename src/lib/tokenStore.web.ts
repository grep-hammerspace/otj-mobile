/**
 * Web: expo-secure-store has no web implementation, so fall back to
 * localStorage. This is NOT encrypted — dev convenience only, not for
 * shipping real tokens to a browser build.
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
