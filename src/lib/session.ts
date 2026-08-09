import { deleteStored, getStored, setStored } from "./tokenStore";

const TOKEN_KEY = "otj.token";

/**
 * Token storage plus a hook for "the server just told us this token is dead".
 *
 * <p>Deliberately React-free so `api.ts` can reach it without importing the auth context, which
 * would be a cycle: the context needs `api` to log out, and `api` needs the context to report a
 * 401. The handler registry breaks that loop.
 */

export async function getToken(): Promise<string | null> {
  return getStored(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await setStored(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await deleteStored(TOKEN_KEY);
}

type UnauthorizedHandler = () => void;

let handler: UnauthorizedHandler | null = null;

/** Registered once by `AuthProvider`. Later registrations replace the earlier one. */
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  handler = fn;
}

/**
 * Called by `api()` on any 401. Without this, clearing the stored token left every mounted
 * `useAuth()` holding a stale value, so an expired session kept rendering the signed-in UI until
 * the app was restarted.
 */
export function notifyUnauthorized(): void {
  handler?.();
}
