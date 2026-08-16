import { deleteStored, getStored, setStored } from "./tokenStore";

/**
 * The OneAdvanced username and password, on the device only.
 *
 * <p>These are the user's <b>real</b> institutional credentials — the ones that log in to
 * OneAdvanced itself, not the account they hold with this app. The backend deliberately stopped
 * storing them (that was the point of the step-05 work): they now live in the keychain / keystore
 * here and travel in the body of a `prepare` request when a submit run needs them, and nowhere
 * else. Nothing writes them to a log, a query string, or react-query's cache.
 *
 * <p>React-free, and for the same reason `session.ts` is: this is storage, and a screen that wants
 * it can call it without dragging a provider along.
 *
 * <p><b>Web is not secure storage.</b> `tokenStore.web.ts` falls back to `localStorage` because
 * `expo-secure-store` has no web implementation, so on a web build these sit in plain text — the
 * same posture the session token already has there, and the same reason web is a bundling check
 * rather than a way to run this app for real.
 */

const USERNAME_KEY = "otj.oa.username";
const PASSWORD_KEY = "otj.oa.password";
const DRIVER_KEY = "otj.oa.driver";

export type OaCredentials = {
  username: string;
  password: string;
};

/**
 * Which login route to drive OneAdvanced through. They are alternatives, not steps — an account
 * gets in one way or the other:
 *
 * - `azure` — the QMUL Azure AD federation path. Sends a push to Microsoft Authenticator, and the
 *   approval happens on the phone, so there is no code to type. Often a number to match.
 * - `otj` — OneAdvanced's own Keycloak login, which stops at a TOTP field. The user reads the code
 *   out of their authenticator app and types it in.
 */
export type DriverChoice = "azure" | "otj";

const DEFAULT_DRIVER: DriverChoice = "azure";

/**
 * Both halves or nothing.
 *
 * <p>A half-saved pair could only come from a write that failed between the two keys, and there is
 * nothing useful to do with a username and no password — treating it as "not set up" sends the user
 * to the sheet that fixes it, which is where a partial state should land them anyway.
 */
export async function getCredentials(): Promise<OaCredentials | null> {
  const [username, password] = await Promise.all([
    getStored(USERNAME_KEY),
    getStored(PASSWORD_KEY),
  ]);
  if (!username || !password) return null;
  return { username, password };
}

export async function saveCredentials({ username, password }: OaCredentials): Promise<void> {
  await Promise.all([
    setStored(USERNAME_KEY, username),
    setStored(PASSWORD_KEY, password),
  ]);
}

/**
 * Forgets both. Signing out of *this* app does not call it — the OneAdvanced password is long,
 * typed on a phone keyboard, and unrelated to the session token that expired. Clearing it is a
 * thing the user asks for, from the credentials sheet.
 */
export async function clearCredentials(): Promise<void> {
  await Promise.all([deleteStored(USERNAME_KEY), deleteStored(PASSWORD_KEY)]);
}

/**
 * The remembered login route, so the choice survives a restart — most people have exactly one that
 * works for their account and would otherwise re-pick it every time.
 *
 * <p>Not a secret, and it sits in the secure store only because that is the storage seam this app
 * already has; there is no plain key-value dependency to reach for, and one small extra entry is
 * cheaper than adding one.
 */
export async function getDriverChoice(): Promise<DriverChoice> {
  const stored = await getStored(DRIVER_KEY);
  return stored === "azure" || stored === "otj" ? stored : DEFAULT_DRIVER;
}

export async function setDriverChoice(choice: DriverChoice): Promise<void> {
  await setStored(DRIVER_KEY, choice);
}
