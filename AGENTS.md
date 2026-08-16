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

# Logging activities

```
lib/activities-api.ts             POST /otj-services/log-activities + its response types
lib/pending-api.ts                GET /pending + DELETE /pending/{id}
components/activity-composer.tsx  the "Add activities" sheet
components/result-banner.tsx      red / amber / green outcome box
app/(tabs)/index.tsx              Log screen: the big button + the last outcome
app/(tabs)/pending.tsx            the unposted queue: list + swipe-to-delete
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

# Submitting to OneAdvanced

```
lib/oa-credentials.ts           the OneAdvanced username/password + remembered route, on-device only
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

Credentials survive signing out of *this* app: the OneAdvanced password is long, typed on a phone
keyboard, and has nothing to do with an expired session token. The sheet's "Forget these details"
is what clears them.

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

# Checks

```bash
nix-shell --run "node_modules/.bin/tsc --noEmit"   # typecheck
nix-shell --run "npx expo export --platform web"   # catches bundling/resolution errors
```

Adding a route regenerates `.expo/types/router.d.ts`, which only happens when Metro runs —
if `tsc` rejects a `Link href` for a route you just added, start `expo start` once.
