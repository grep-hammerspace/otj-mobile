import { useCallback, useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "otj.token";

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

/** undefined while SecureStore is being read, null when signed out. */
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
