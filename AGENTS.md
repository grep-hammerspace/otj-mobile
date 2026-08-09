# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

This project is pinned to **SDK 54**, not the latest SDK. That is deliberate: the
iOS Expo Go build on the App Store is stuck at 54.0.2 (released 2025-09-23), so
SDK 55+ cannot run in Expo Go on iOS at all. Do not "helpfully" upgrade the SDK —
it will break the phone workflow. Moving off 54 requires a development build,
which on Linux + iPhone means an Apple Developer Program membership.

# What this app is

The mobile client for `otjServices` (sibling repo, `../otjServices`) — a Java REST API
that automates logging off-the-job training hours to OneAdvanced. This app is the only
intended consumer of that API.

`EXPO_PUBLIC_API_URL` points at the backend and has **no fallback in code**: `lib/api.ts`
throws at startup if it is unset. A silent wrong default is worse than a crash in dev.
The backend is reachable over the tailnet, so the URL is a `.ts.net` address (or a tailnet
IP for `npm run start:tailnet`).

# Auth architecture

```
lib/session.ts    token storage + a 401 handler registry. React-free on purpose.
lib/auth.tsx      AuthProvider / useAuth — the single source of truth for signed-in state.
lib/api.ts        fetch wrapper: base URL, Bearer injection, ApiError / NetworkError,
                  clears the token and notifies the provider on 401.
lib/auth-api.ts   signup / login / logout against the backend's /auth endpoints.
app/_layout.tsx   AuthProvider + Stack.Protected guards.
app/signup.tsx    invite-gated account creation.
app/login.tsx     sign in for an existing account.
```

Three things worth not re-litigating:

- **`session.ts` is React-free to break an import cycle.** The auth context needs `api` to
  log out; `api` needs to tell the context about a 401. The handler registry is the seam.
  Don't merge it back into `auth.tsx`.
- **Auth state lives in exactly one provider.** It used to be a bare `useState` inside a
  hook, so every caller got an independent copy and an expired token never bounced the user
  to signup. If you find yourself adding a second `useState` for the token, stop.
- **Nothing navigates by hand after sign-in/sign-out.** The `Stack.Protected` guards in
  `_layout.tsx` do it. A screen that also called `router.replace` would race them.

Signup is **invite-gated**: codes are minted through the backend's admin API, which is
tailnet-only. There is no self-serve signup and no client-side way to get a code.

The server refuses to say whether a failed login was a bad username or a bad password, and
returns one message for invalid/used/expired invite codes alike. Don't infer more specific
messages from status codes — that would undo the point.

# Screens still to build

`(tabs)/index` (Log), `(tabs)/pending` and `(tabs)/submit` are placeholders. They need
backend step 05 (OneAdvanced credentials in request bodies rather than stored server-side)
and the 05.5 list/delete endpoints, which do not exist yet. Build them against real
endpoints, not mocks.

# Checks

```bash
nix-shell --run "node_modules/.bin/tsc --noEmit"   # typecheck
nix-shell --run "npx expo export --platform web"   # catches bundling/resolution errors
```

Adding a route regenerates `.expo/types/router.d.ts`, which only happens when Metro runs —
if `tsc` rejects a `Link href` for a route you just added, start `expo start` once.
