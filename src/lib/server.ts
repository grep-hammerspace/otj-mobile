import { deleteStored, getStored, setStored } from "./tokenStore";

const SELF_HOSTED_KEY = "otj.selfHostedUrl";

const HOSTED = process.env.EXPO_PUBLIC_API_URL;
if (!HOSTED) throw new Error("EXPO_PUBLIC_API_URL is not set");

/**
 * Which backend the app talks to: the hosted one baked in at build time, or a self-hosted one the
 * user typed on the signup screen. React-free like `session.ts`, so `api.ts` can read it.
 *
 * <p>Held in memory once loaded, because `api()` asks on every request. `AuthProvider` loads it
 * before any screen renders.
 */
let selfHosted: string | null = null;

export async function loadSelfHostedUrl(): Promise<string | null> {
  selfHosted = await getStored(SELF_HOSTED_KEY);
  return selfHosted;
}

export async function setSelfHostedUrl(origin: string): Promise<void> {
  await setStored(SELF_HOSTED_KEY, origin);
  selfHosted = origin;
}

export async function clearSelfHostedUrl(): Promise<void> {
  await deleteStored(SELF_HOSTED_KEY);
  selfHosted = null;
}

export function isSelfHosted(): boolean {
  return selfHosted !== null;
}

export function baseUrl(): string {
  return selfHosted ?? HOSTED!;
}

// A regex rather than `URL`, whose React Native implementation has historically lacked getters.
const TAILNET_ORIGIN = /^https:\/\/((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+ts\.net)(:\d{1,5})?\/?$/i;

/**
 * The origin to store, or `null` unless the input is `https://<name>.ts.net`, optionally with a
 * port and a trailing slash. Nothing else: the self-hosted API has no auth and is safe only behind
 * `tailscale serve`, so a plain-http or public address is refused rather than trusted.
 */
export function parseTailnetUrl(input: string): string | null {
  const match = TAILNET_ORIGIN.exec(input.trim());
  if (!match) return null;
  return `https://${match[1].toLowerCase()}${match[2] ?? ""}`;
}

export type ServerCheck = "ok" | "unreachable" | "not_self_hosted";

/**
 * Asks the server for its account without a token. A self-hosted backend answers 200; the hosted
 * one answers 401, which would otherwise land the user on screens where every call fails.
 */
export async function checkSelfHostedServer(origin: string, timeoutMs = 8000): Promise<ServerCheck> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${origin}/auth/me`, { signal: controller.signal });
    return res.ok ? "ok" : "not_self_hosted";
  } catch {
    return "unreachable";
  } finally {
    clearTimeout(timer);
  }
}
