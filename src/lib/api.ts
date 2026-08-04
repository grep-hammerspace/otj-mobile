import { getToken, clearToken } from "./auth";

const BASE = process.env.EXPO_PUBLIC_API_URL;
if (!BASE) throw new Error("EXPO_PUBLIC_API_URL is not set");

export async function api(path: string, init: RequestInit = {}) {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (res.status === 401) { await clearToken(); /* router will bounce to signup */ }
  return res;
}
