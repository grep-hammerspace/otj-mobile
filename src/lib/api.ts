import { clearToken, getToken, notifyUnauthorized } from "./session";

const BASE = process.env.EXPO_PUBLIC_API_URL;
if (!BASE) throw new Error("EXPO_PUBLIC_API_URL is not set");

/** A response the server rejected, carrying the status and whatever reason it gave. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The request never got an answer — no signal, wrong URL, backend down, off the tailnet. */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super("Could not reach the server. Check your connection and try again.");
    this.name = "NetworkError";
    this.cause = cause;
  }
}

export async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getToken();

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch (e) {
    // fetch only rejects when the request never completed; a 4xx/5xx resolves normally.
    throw new NetworkError(e);
  }

  if (res.status === 401) {
    await clearToken();
    notifyUnauthorized();
  }
  return res;
}

/**
 * `api()` plus "throw unless it worked". Returns `undefined` for 204, which is what logout and
 * the delete endpoints answer with.
 */
export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await api(path, init);
  const body = await res.text();

  if (!res.ok) throw new ApiError(res.status, errorMessage(res.status, body));
  if (!body) return undefined as T;

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new ApiError(res.status, "The server sent a response the app could not read.");
  }
}

/**
 * Prefers the server's own `{"error": "..."}` message — those are written to be shown to a
 * person, and are the only place that knows *why* something was refused. Bean-validation
 * failures don't use that shape, hence the per-status fallbacks.
 */
function errorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.error === "string" && parsed.error.length > 0) return parsed.error;
  } catch {
    // not JSON — fall through
  }

  if (status === 400) return "Please check the details you entered and try again.";
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status >= 500) return "The server had a problem. Try again in a moment.";
  return `Something went wrong (HTTP ${status}).`;
}
