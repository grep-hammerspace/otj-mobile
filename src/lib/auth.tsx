import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { clearSelfHostedUrl, loadSelfHostedUrl, setSelfHostedUrl } from "./server";
import {
  clearToken,
  getToken,
  setToken,
  setUnauthorizedHandler,
} from "./session";

type AuthValue = {
  /** `undefined` while the secure store is being read, `null` when signed out. */
  token: string | null | undefined;
  /** The user's own backend, when they connected one instead of signing in. */
  selfHostedUrl: string | null | undefined;
  /** Signed in to the hosted backend, or connected to a self-hosted one. */
  signedIn: boolean;
  loading: boolean;
  signIn: (token: string) => Promise<void>;
  connectSelfHosted: (origin: string) => Promise<void>;
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
  const queryClient = useQueryClient();
  const [token, setTokenState] = useState<string | null | undefined>(undefined);
  const [selfHostedUrl, setSelfHostedState] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    getToken().then(setTokenState);
    loadSelfHostedUrl().then(setSelfHostedState);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setTokenState(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  const signIn = useCallback(async (next: string) => {
    await setToken(next);
    setTokenState(next);
  }, []);

  const connectSelfHosted = useCallback(
    async (origin: string) => {
      await setSelfHostedUrl(origin);
      queryClient.clear();
      setSelfHostedState(origin);
    },
    [queryClient],
  );

  // Clears the query cache too, so one server's queue and account never show against another's.
  const signOut = useCallback(async () => {
    await clearToken();
    await clearSelfHostedUrl();
    queryClient.clear();
    setTokenState(null);
    setSelfHostedState(null);
  }, [queryClient]);

  const value = useMemo<AuthValue>(
    () => ({
      token,
      selfHostedUrl,
      signedIn: !!token || !!selfHostedUrl,
      loading: token === undefined || selfHostedUrl === undefined,
      signIn,
      connectSelfHosted,
      signOut,
    }),
    [token, selfHostedUrl, signIn, connectSelfHosted, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside an AuthProvider");
  return value;
}
