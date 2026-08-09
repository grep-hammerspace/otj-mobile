import { api, apiJson } from "./api";

type TokenResponse = { token: string };

/**
 * The `/auth` endpoints. All three are anonymous on the server — signup and login are what you
 * reach before holding a token, and logout reads the token off the header rather than a session.
 */

/**
 * Creates the account and signs in, in one round trip.
 *
 * `learnerId` is the OneAdvanced learner identifier, not anything this app issues; it is captured
 * once here because every activity log row carries it.
 */
export async function signup(input: {
  inviteCode: string;
  username: string;
  password: string;
  learnerId: string;
}): Promise<string> {
  const { token } = await apiJson<TokenResponse>("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      inviteCode: input.inviteCode.trim(),
      username: input.username.trim(),
      password: input.password,
      learnerId: input.learnerId.trim(),
    }),
  });
  return token;
}

export async function login(username: string, password: string): Promise<string> {
  const { token } = await apiJson<TokenResponse>("/auth/session", {
    method: "POST",
    body: JSON.stringify({ username: username.trim(), password }),
  });
  return token;
}

/**
 * Best-effort revocation. The local token is cleared by the caller regardless — a user who taps
 * sign out should end up signed out even if the request never lands, and an unrevoked token
 * expires on its own.
 */
export async function logout(): Promise<void> {
  try {
    await api("/auth/session", { method: "DELETE" });
  } catch {
    // offline, or the server is down; nothing here is worth blocking sign-out for.
  }
}
