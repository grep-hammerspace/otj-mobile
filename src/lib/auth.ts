import { useCallback, useEffect, useState } from "react";
import { getStored, setStored, deleteStored } from "./tokenStore";

const TOKEN_KEY = "otj.token";

export async function getToken(): Promise<string | null> {
  return getStored(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await setStored(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await deleteStored(TOKEN_KEY);
}

/** undefined while the token store is being read, null when signed out. */
export function useToken() {
  const [token, setTokenState] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    getToken().then(setTokenState);
  }, []);

  const signIn = useCallback(async (t: string) => {
    await setToken(t);
    setTokenState(t);
  }, []);

  const signOut = useCallback(async () => {
    await clearToken();
    setTokenState(null);
  }, []);

  return { token, loading: token === undefined, signIn, signOut };
}
