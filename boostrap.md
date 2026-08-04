# otjMobile — Bootstrap Plan (empty repo → running in Expo Go)

Companion app to `otjServices`. Goal of this plan: from `git init` to the app
booting in Expo Go on your phone and successfully calling the backend's
`/health` over the tailnet. Feature screens come after; this is scaffolding
only. Tools come from Nix, matching the `shell.nix` idiom in otjServices
(pinned channel tarball, `mkShell`, banner shellHook).

---

## 0. Prerequisites (one-time, outside the repo)

- [ ] **Expo Go** installed on your phone (App Store / Play Store)
- [ ] Phone and laptop on the same tailnet (they already are, for the backend)
- [ ] Backend reachable from the phone: open
      `https://<laptop-machine-name>.<tailnet>.ts.net/health` in the phone's
      browser → expect a blank 200. This is the URL the app will use in dev
      (`tailscale serve` is already framed as the dev tunnel in the backend plan).
- [ ] An Expo account (free, expo.dev) — not needed to start, but `--tunnel`
      mode and later EAS builds want a login. Defer if you like.

## 1. Nix shell

`shell.nix` in the new repo root:

```nix
{ pkgs ? import (builtins.fetchTarball {
    url = "https://channels.nixos.org/nixos-25.11/nixexprs.tar.xz";
  }) {} }:

pkgs.mkShell {
  buildInputs = with pkgs; [
    nodejs_22      # RN 0.7x / Expo SDK 53+ want Node >= 20; pin the major
    watchman       # Metro file-watching; avoids the inotify-limit warnings
  ];

  shellHook = ''
    echo ""
    echo "otjMobile dev shell ready"
    echo "  node     $(node --version)"
    echo "  npm      $(npm --version)"
    echo "  watchman $(watchman --version)"
    echo ""
    echo "  npx expo start          start Metro; scan QR with Expo Go"
    echo "  npx expo start --tunnel same, via relay (if LAN discovery fails)"
    echo ""
  '';
}
```

Notes:
- **Everything else is an npm dev-dependency, not a Nix package** — `expo`,
  `eas-cli` later. That's deliberate: Expo's CLI is versioned with the SDK in
  `package.json`, and pinning it in Nix would fight the project's own pin.
  Nix's job here is exactly two things: a reproducible Node and watchman.
- No JDK, no Android SDK, no Xcode in the shell — **Expo Go development needs
  none of them.** The phone runs the native side; the laptop only runs Metro
  (a Node process). Native toolchains enter the picture only at dev-build/EAS
  time (section 7).
- If you ever raise Linux's file-watch limit instead of using watchman:
  `fs.inotify.max_user_watches` — but watchman is the cleaner fix and is why
  it's in the shell.

Optional but nice: a `.envrc` with `use nix` if you install direnv someday;
skip for now (not installed on this machine).

## 2. Scaffold the Expo project

From inside `nix-shell`, in the empty repo root:

```bash
npx create-expo-app@latest . --template default
```

- `.` scaffolds into the current (empty-except-shell.nix) directory; the
  generator tolerates existing non-conflicting files. If it balks, scaffold
  into a temp dir and move contents up.
- The default template is TypeScript + expo-router (file-based routing) —
  exactly the stack the app plan assumes. **Don't pick the blank template**;
  you'd re-add router/TS by hand.
- Then clear the demo screens:

```bash
npm run reset-project    # moves example code to app-example/, leaves clean app/
rm -rf app-example       # don't keep the graveyard
```

## 3. Dependencies

```bash
npx expo install expo-secure-store expo-local-authentication
npm install @tanstack/react-query
```

- `npx expo install` (not plain `npm i`) for anything with native code — it
  picks the version matching your SDK. Both of these are **bundled in Expo Go**,
  so no dev build is needed yet.
- React Query is pure JS; plain npm is fine.
- That's the whole list. No navigation lib (router is in), no state lib
  (React Query + one token hook is the state), no UI kit yet — decide that
  when the first screen exists, not before.

## 4. Configuration — API base URL

Expo inlines any env var prefixed `EXPO_PUBLIC_` at bundle time.

`.env` (gitignored), laptop dev against the tailnet:

```
EXPO_PUBLIC_API_URL=https://<laptop-machine-name>.<tailnet>.ts.net
```

`.env.example` (committed):

```
EXPO_PUBLIC_API_URL=https://example.ts.net
```

Rule: **no fallback URL in code.** `lib/api.ts` throws at startup if
`process.env.EXPO_PUBLIC_API_URL` is unset — a wrong silent default against
prod-someday is worse than a crash in dev. When step 09 lands a real domain,
prod builds get their URL the same way via EAS build profiles.

## 5. Skeleton structure

Commit this shape before writing real features:

```
app/
  _layout.tsx        # root: QueryClientProvider + auth gate (token? tabs : signup)
  signup.tsx         # req 1/4 — shown only when SecureStore has no token
  (tabs)/
    _layout.tsx      # bottom tabs
    index.tsx        # Log — the big text box (req 2)
    pending.tsx      # unposted list, swipe-to-delete (req 3 — needs backend 05.5)
    submit.tsx       # MFA flow (biometric -> prepare -> challenge -> complete)
lib/
  api.ts             # fetch wrapper: base URL, Bearer injection, 401 -> signOut
  auth.ts            # SecureStore get/set/clear token; useToken() hook
shell.nix
.env.example
```

`lib/api.ts` starting stub (the only "real" code in the bootstrap):

```ts
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
```

For the bootstrap, `(tabs)/index.tsx` just renders a button that calls
`api("/health")` and shows the status code — that's the end-to-end proof.

## 6. Repo hygiene + first run

```bash
# the template's .gitignore already covers node_modules/, .expo/; add:
echo ".env" >> .gitignore

git add -A && git commit -m "Bootstrap: Expo scaffold + nix shell + api skeleton"

npx expo start
```

Scan the QR with Expo Go. Connection modes, in order of preference:
1. **LAN** (default) — works when phone and laptop share a network. Over
   tailscale it can work too (Metro on the tailnet IP), but Expo's QR encodes
   the LAN IP; if the phone can't reach it, use:
2. **`npx expo start --tunnel`** — relays through Expo's servers, always works,
   slightly slower reloads. Needs the Expo login.

**Definition of done for the bootstrap:** app opens in Expo Go, Health button
returns 200 from the backend over HTTPS. At that point every hard unknown
(toolchain, networking, TLS, phone↔laptop path) is retired, and what remains
is ordinary feature work.

## 7. Explicitly deferred (don't do these now)

| Thing | When |
|---|---|
| Signup/Log/Pending/Submit screens | after backend steps 04–05 (+ the 05.5 list/delete endpoints) merge — build against real endpoints, not mocks |
| `eas-cli`, `eas init`, build profiles | when the app works end-to-end in Expo Go |
| Dev build (`expo-dev-client`) | before trusting the Submit flow — Keychain + biometrics behave most faithfully outside Expo Go |
| Apple Developer account / TestFlight | when someone other than you needs the iOS app |
| Android SDK in Nix (`androidenv`) | only if you ever want *local* `eas build --local` for Android; cloud EAS builds need nothing local |

## Order of execution, condensed

```
1. git init, add shell.nix, nix-shell
2. npx create-expo-app@latest . --template default && npm run reset-project
3. npx expo install expo-secure-store expo-local-authentication
   npm install @tanstack/react-query
4. .env with EXPO_PUBLIC_API_URL -> your .ts.net URL; .env.example committed
5. Skeleton: lib/api.ts, lib/auth.ts, app/ routes with placeholder screens
6. Commit. npx expo start. Scan. Health button -> 200. Done.
```
