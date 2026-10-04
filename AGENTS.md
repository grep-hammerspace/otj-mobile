# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

This project is on **SDK 57** because that is what the App Store's Expo Go runs. The SDK is
not ours to choose: iOS Expo Go only ever supports one SDK, it cannot be downgraded on a real
device, and the phone is the only way this app gets run. So the rule is **match Expo Go** —
neither ahead of it (an SDK the store build doesn't have yet) nor behind it.

It used to say the opposite. Expo Go sat at 54.0.2 from 2025-09-23 until it jumped straight
to 57, and from then on the SDK 54 project failed to open with "Project is incompatible with
this version of Expo Go". If that error comes back, Expo Go has moved again: step through each
SDK with `npx expo install expo@^N.0.0 --fix` rather than leaping, and check the changelog for
each one. The way out of this treadmill is a development build, which on Linux + iPhone means
an Apple Developer Program membership.

# What this app is

The mobile client for `otjServices` (sibling repo, `../otjServices`) — a Java REST API
that automates logging off-the-job training hours to OneAdvanced. This app is the only
intended consumer of that API.

`EXPO_PUBLIC_API_URL` points at the hosted backend and has **no fallback in code**:
`lib/server.ts` throws at startup if it is unset. A silent wrong default is worse than a crash in
dev. A user running their own backend overrides it from the signup screen (see "Self-hosted mode").

# Auth architecture

```
lib/session.ts    token storage + a 401 handler registry. React-free on purpose.
lib/auth.tsx      AuthProvider / useAuth — the single source of truth for signed-in state.
lib/server.ts     which backend: the built-in URL or a self-hosted one. React-free.
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

# Self-hosted mode

The backend's `tailscale` branch is a single-user copy that someone runs on their own machine,
reachable only through `tailscale serve` on their tailnet. It has no signup, no sessions and no
credential sealing. The link under the signup form ("Hosting the backend yourself?") connects to
one:

- `parseTailnetUrl` accepts only `https://<name>.ts.net`, optionally with a port and a trailing slash.
  That server has no auth and is safe only behind `tailscale serve`, so anything else is refused,
  not trusted.
- `checkSelfHostedServer` then calls `GET /auth/me` with no token. A self-hosted backend answers
  200; the hosted one answers 401. That catches a typo or the wrong server before the user lands on
  screens where every call fails.
- `connectSelfHosted` stores the origin in the secure store. `api()` sends every call there, and the
  root guard treats a stored URL as signed in, so the tabs open on Log with no token at all.
- **Credentials go plain, and only here.** `submit-api.ts` skips `credential-seal.ts` when
  `isSelfHosted()`. TLS ends at the owner's own `tailscale serve`, so the Cloudflare hop sealing
  defends against isn't there, and a self-hosted server can't hold the key this build pins.
  Don't extend the plain path to the hosted backend.
- Sign out clears the URL (and the react-query cache), which returns to signup. `logout()` skips the
  revoke call, since there is no session.
- A fresh self-hosted account has no learner ID. `Profile.learnerId` is `null` until it is set on
  Submit, which shows "Not set", and prepare answers 409 until then.

# Logging activities

```
lib/activities-api.ts             POST /otj-services/log-activities + its response types
lib/pending-api.ts                GET /pending + DELETE /pending/{id}
components/activity-composer.tsx  the "Add activities" sheet
components/result-banner.tsx      red / amber / green outcome box
app/(tabs)/index.tsx              Log screen: the big button + the last outcome
app/(tabs)/pending.tsx            the unposted queue: list, swipe-right to edit, swipe-left to delete
```

`ActivityRow` lives in `activities-api.ts` and is the row shape for **both** endpoints — the
server returns the same `PendingActivity` DTO from each. Define it once; `pending-api.ts` imports
it.

The wire format is a single `content` string, and **one line is one activity** — the server
splits on `\n` and `llm_prompt.txt` tells the model to "process each line of the input
independently". Hence one bordered box per entry in the UI and `normaliseEntry` collapsing every
whitespace run to a space on the way out: a newline the user typed mid-thought would otherwise
become a second, half-formed activity.

**There is no deduplication.** The server keeps no snapshot of previous submissions and diffs
nothing — every line it is given goes to the model, and every line that parses becomes a row. The
`{"status": "no new content"}` response and `DELETE /reset-notes` were both deleted with the
differ; don't rebuild either. So `content` must be the batch currently on screen, never a running
document — a running document would re-log its whole history on every submit.

An identical resubmission therefore creates a real duplicate. The composer's submit button is
disabled while a request is in flight (`busy`, cleared in `finally`) for exactly that reason, and
anything that still gets through is visible and swipeable in the Pending tab. That is the
intended answer to duplicates — not a client-side guard that tries to guess what is a repeat.

A 200 can still be a partial failure: `rowsAdded` counts what was written and `parseErrors`
lists the lines the model refused. Green is reserved for `rowsAdded > 0` with no `parseErrors`.

**Never pad the composer's edges with a `Platform.OS` constant.** A full-screen `Modal` covers the
status bar, and 20pt put the close button under the clock on every Dynamic Island iPhone. No
constant works across notch and home-button iPhones, Android's edge-to-edge gesture bar and web,
so the sheet nests its own `SafeAreaProvider` inside the `Modal` and reads `useSafeAreaInsets()`.
The nesting is load-bearing: an Android `Modal` is a separate native window, and only a provider
inside it measures *that* window. `ComposerBody` is split from `ActivityComposer` solely so it
sits below that provider — while the composer's state stays in the shell, because `Modal` renders
nothing while hidden and body-owned state would discard half-typed entries on close.

# The pending queue

`GET /otj-services/pending` returns unposted rows **newest first**, plus `count` and
`totalMinutes`. Three things not to undo:

- **Don't re-sort.** The order is insertion order, deliberately not `activityDate`: a back-dated
  entry would otherwise appear halfway down a list the user is already reading. Group by date if
  you like, but preserve the order.
- **An empty queue is a 200** with `{"activities": [], "count": 0, "totalMinutes": 0}`, so
  `apiJson` never throws on the happy path. Render an empty state, not an error.
- **Delete with `/pending/{id}`, never `delete-last-row`.** The latter deletes by insertion
  recency, so it cannot address a specific row and two quick swipes race into deleting the wrong
  things. It still exists, for the CLI.

A `DELETE /pending/{id}` 404 means the same thing for "no such id", "someone else's" and "already
posted" — that is by design, so don't try to tell them apart. Treat it as "it's gone" and refetch
rather than reporting a failure.

`_layout.tsx` wraps the app in `GestureHandlerRootView` because of this screen's swipe. It has to
be outermost and `flex: 1`, or gestures below it never fire.

## The two swipes

Drag a row **right** to edit it, **left** to uncover Delete. They are deliberately asymmetric:
edit takes one step because a sheet you can close costs nothing, while delete takes two because
the backend deletes for real and there is no undo.

`ReanimatedSwipeable`'s `direction` argument is the trap here. **It names the way the row was
dragged, not the side whose actions that uncovers** — the source passes `toValue > 0 ? RIGHT :
LEFT`, and a rightward drag uncovers `renderLeftActions`. So the edit branch tests for `"right"`
while rendering into the *left* actions, which reads backwards and is correct. Getting it wrong
does not fail loudly: both gestures keep working, they just swap jobs, and the Delete side becomes
a shortcut into the edit sheet. `onSwipeableWillClose` uses the opposite convention upstream, so
don't reason from one callback to the other — read the source.

# Submitting to OneAdvanced

```
lib/oa-credentials.ts           the OneAdvanced username/password + remembered route, on-device only
lib/credential-seal.ts          encrypts that pair to the backend, and pins the key it seals to
lib/biometric.ts                the Face ID / fingerprint gate
lib/submit-api.ts               prepare + complete for both routes, and SubmitOutcome
lib/profile-api.ts              GET/PATCH /auth/me — the account, for the learner ID
components/credentials-sheet.tsx  where the credentials are entered, changed and forgotten
app/(tabs)/submit.tsx           route picker, the button, the challenge number, the code field,
                                and the learner ID card
```

**All four endpoints are live on `staging`.** Backend step 05 — OneAdvanced credentials in request
bodies rather than stored server-side — landed as otjServices #33, and the two prepare endpoints
stopped being 501 stubs with it.

Read the shipped records, not `steps-04-08-implementation-plan.md`. The plan called the credential
fields `oneAdvancedUsername` / `oneAdvancedPassword`; what shipped is
`OneAdvancedCredentials(String username, String password)`, and this client sent the plan's names
until it was checked against `staging`. That mistake is invisible from the client side — Jackson
drops unknown keys, so both fields arrive null and the call comes back 400 "credentials missing",
which looks exactly like a wrong OneAdvanced password. Two other outcomes are worth knowing before
reading a failure as a bug: a failed login is **401** with a deliberately generic message (the
driver's own text leaks the username through `login_hint` URLs), and an account with no learner ID
is **409**, checked before the login so the Azure route cannot make someone approve a push and wait
two minutes for nothing.

Two routes, two calls each, and they are alternatives rather than steps — an account gets in one
way or the other:

- **Azure** — `POST /azure-id/prepare` sends a Microsoft Authenticator push and answers
  `login_complete` or `push_sent`, the latter sometimes with a `challengeNumber` the user must tap
  in the app. `GET /azure-id/complete` then blocks up to 125 s waiting for the approval.
- **OneAdvanced** — `POST /prepare-browser` stops at the TOTP field; `POST /submit-with-mfa` carries
  the code the user reads off their authenticator. Those codes expire in ~30 s, so the field is
  inline on the screen rather than behind a sheet.

Things not to undo:

- **Posting the queue is the tail of the *second* call, on both routes.** There is no separate
  "now post" endpoint, and `login_complete` still has to call `complete` to get anything sent.
- **`prepare` parks a driver in the server's `UserStateStore`,** one per user. Both calls must reach
  the same backend process, and switching route mid-run resets the screen for that reason.
- **A 502 `{"status": "all_failed"}` is an outcome, not a fault** — the login worked and OneAdvanced
  refused every row. `submit-api.ts` reads that body itself instead of letting `apiJson` throw it as
  "the server had a problem", which would send the user to retry the wrong thing.
- **`complete` retries on a dropped connection.** 125 s of silence outlives some platforms' idle
  timeout, and re-calling just waits on the same background poll. A 408 is *not* retried: that one
  means nobody approved.
- **The biometric gate fails open** when the device has no enrolled biometrics — including Expo Go
  on iOS, where Face ID needs a development build. A phone that cannot show the prompt must still be
  able to submit; the gate is a second lock on top of the device's own, not what makes the
  credentials safe.
- **The code field blurs before it focuses.** Leaving for the authenticator app strands the field
  marked focused in RN's `TextInputState` with no keyboard showing, and RN's `focus()` is a no-op on
  a field it thinks is focused — so every tap on the box did nothing. `CodeEntry` blurs first, both
  on returning to the app and on a tap when no keyboard is up.
- **The keyboard's overlap is measured, not left to `automaticallyAdjustKeyboardInsets`.** That
  prop did not leave room to scroll the code field and "Submit code" above the keypad on a real
  iPhone. The screen pads its content by the measured overlap and scrolls to the end once that
  padding is laid out — the end, not the focused field, because the button sits below the field.

Credentials survive signing out of *this* app: the OneAdvanced password is long, typed on a phone
keyboard, and has nothing to do with an expired session token. The sheet's "Forget these details"
is what clears them.

## The credentials are encrypted before they leave the phone

The API sits behind Cloudflare, which terminates TLS, so a request body is plaintext inside it.
`credential-seal.ts` seals the OneAdvanced pair to the backend process before `submit-api.ts` sends
it, and the backend accepts nothing else. The wire format is `credential-encryption-spec.md` in
`../otjServices`; the two sides are separate implementations, so change the spec first.

Things not to undo:

- **The pinned identity key is the point.** The key to seal to comes over the same Cloudflare hop,
  so its announcement must verify against `EXPO_PUBLIC_CREDENTIAL_IDENTITY_KEY` or the submit
  stops. No plaintext fallback, no "trust this key" prompt, no retry that skips the check.
- **`EXPO_PUBLIC_CREDENTIAL_IDENTITY_KEY` has no default and throws when unset**, like
  `EXPO_PUBLIC_API_URL`. It is the pair of the backend's `CREDENTIAL_IDENTITY_SEED`;
  `IdentityKeyTool generate` prints both.
- **Pure JS (`@noble/*`)**, since Expo Go allows no native crypto module. Randomness is
  `expo-crypto`'s `getRandomBytesAsync`, not the sync `getRandomBytes`, which can fall back to
  `Math.random` in development.
- **`unknown_key` is re-sealed once, never more.** It means the backend restarted after the key
  fetch; unbounded retries would turn a submit loop into a login flood against OneAdvanced.

The MFA code is not sealed (it dies in ~30 s), and the verified key is cached in memory only.

## The learner ID on this screen

`profile-api.ts` calls `GET /auth/me` → `{username, learnerId}` and `PATCH /auth/me` taking
`{learnerId}`. Both are on `staging`, landed as otjServices #32, with `learner-id-api-spec.md`
alongside them explaining the shape. Note that `add-learner-id-endpoint` is still an open PR over
there and is a stale duplicate of that merge — check `origin/staging` itself rather than reading
an open branch as "not landed yet".

Server-side they are on their own `AccountResource`, not `AuthResource` — that class is
deliberately un-`@Authenticated` and the annotation binds per class.

It lives on Submit rather than in a settings screen because a wrong learner ID has exactly one
symptom — OneAdvanced rejecting every row — and this is the screen you are on when that happens.
There is no settings screen to move it to.

Three things not to undo:

- **Editing is inline, not a `Modal`.** One short field does not earn a sheet, and staying on the
  screen is what keeps the queued-rows note visible while the field is open. That also sidesteps
  the whole `SafeAreaProvider`-inside-`Modal` problem the composer documents.
- **`learnerDraft === null` is the display state; `""` is an open, empty field.** Clearing the box
  on the way to retyping must not collapse the card, so "is the editor open" cannot be `!draft`.
- **A correction *does* reach rows already in Pending — the note says so, and it is reassurance
  rather than a warning.** The server copies `learnerId` onto each row as it is written and never
  rewrites those copies, so the obvious guess is that queued rows post under the old value. They do
  not: submission is handed the learner ID read off the account at submit time. This screen said the
  opposite until 2026-08-16, which told people to delete and retype work that would have posted
  fine. Don't restore that. A back-fill of the stored copies is deliberately not done, so a row's
  own `learnerId` can differ from the one it posts under; nothing in this app shows that copy.

Unlike the OneAdvanced credentials, this is server-side account data: nothing about it is stored on
the device, and it is read back through react-query under `profileKey`.

# Publishing (Play internal testing, TestFlight)

The audience is the owner and a few apprenticeship colleagues, so the app goes to each store's
beta channel and no further. On Android that is the Play Console's **internal testing** track: no
review, no production listing, and none of the 12-testers-for-14-days rule that gates production
for a new personal account. On iOS it is **TestFlight**: the owner as an internal tester, colleagues
in an external group through a public link, which costs one Beta App Review per version.

```
eas.json   preview → .apk for sideloading; production → .aab (internal track) / .ipa (TestFlight)
app.json   android.package, ios.bundleIdentifier, runtimeVersion
```

- **`android.package` and `ios.bundleIdentifier` are both `io.github.grephammerspace.otj`, for
  good.** Play never lets a package change once anything is uploaded, and an App Store Connect
  record is tied to its bundle ID. Renaming either means a new listing that nobody has installed.
- **TestFlight builds expire after 90 days.** `eas update` changes the JS inside a build but not
  its expiry, so iOS needs a fresh `eas build` + `eas submit` at least that often.
- **Export compliance is answered in App Store Connect, not hard-coded.** `credential-seal.ts`
  does its own encryption on top of HTTPS, so `ITSAppUsesNonExemptEncryption: false` is a legal
  declaration rather than boilerplate. Only put it in `app.json` once the owner has answered
  Apple's questions and the answer really is "exempt".
- **A store build is the only place Face ID actually prompts.** `expo-local-authentication` is on
  Expo's auto-applied plugin list, so `NSFaceIDUsageDescription` is filled with its default text
  without being listed in `plugins`.
- **`EXPO_PUBLIC_*` must live in EAS, not `.env`.** `.env` is gitignored and cloud builds only upload
  what git tracks, so a build without them crashes on launch through the same throw that guards dev.
  Both profiles use `"environment": "production"`, and `eas update` needs
  `--environment production` too (required since SDK 55).
- **`runtimeVersion` is the `fingerprint` policy** so that an `eas update` only reaches builds whose
  native side it matches. A JS-only change goes out as an update; adding a native module or bumping
  the SDK changes the fingerprint and needs a new build. Don't swap in a fixed string: a
  hand-maintained version that someone forgets to bump ships JS that calls native code the
  installed app doesn't have.
- **`versionCode` is remote** (`appVersionSource: "remote"` + `autoIncrement`). EAS bumps it, so
  don't add one to `app.json`.
- The first `.aab` must be uploaded by hand in the Play Console. Google's API cannot create an app's
  first release, so `eas submit` only works from the second build on.

# Checks

```bash
nix-shell --run "node_modules/.bin/tsc --noEmit"   # typecheck
nix-shell --run "npx expo export --platform web"   # catches bundling/resolution errors
```

Adding a route regenerates `.expo/types/router.d.ts`, which only happens when Metro runs —
if `tsc` rejects a `Link href` for a route you just added, start `expo start` once.
