import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearToken,
  getToken,
  setToken,
  setUnauthorizedHandler,
} from "./session";

type AuthValue = {
  /** `undefined` while the secure store is being read, `null` when signed out. */
  token: string | null | undefined;
  loading: boolean;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

/**
 * Single source of truth for whether we are signed in.
 *
 * <p>This used to be a bare `useState` inside a hook, which meant every caller got its own copy:
 * the root layout's guard could not see a sign-in that happened on the signup screen, and nothing
 * saw `api()` discarding a rejected token. One provider, one state, and a handler registered with
 * `session.ts` so a 401 anywhere signs out everywhere.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    getToken().then(setTokenState);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setTokenState(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  const signIn = useCallback(async (next: string) => {
    await setToken(next);
    setTokenState(next);
  }, []);

  const signOut = useCallback(async () => {
    await clearToken();
    setTokenState(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ token, loading: token === undefined, signIn, signOut }),
    [token, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside an AuthProvider");
  return value;
}
