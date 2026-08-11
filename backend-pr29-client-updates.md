# Client updates for otjServices PR #29

Backend PR: `grep-hammerspace/otjServices#29` — branch `remove-content-differ` → `staging`.

Two backend changes land together: **content diffing was removed**, and the **05.5 pending
list/delete endpoints** now exist. One of them breaks this client.

Every backend contract below was read off the merged Java. Every file/line reference below was
read off this repo at the time of writing — but verify before editing, since the working tree
moves.

---

## Part 1 — breaking: the `log-activities` response shape changed

`POST /otj-services/log-activities` no longer returns raw `ActivityLog` records. **The app will
read `undefined` for removed fields until this is updated.**

| | |
|---|---|
| **Removed from each row** | `tailscaleUserId`, `learnerId`, `unitId`, `activityType`, `posted` |
| **Added to each row** | `createdAt` |
| **Changed** | `id` is now **never null** (was `string \| null`) |

New success body:

```json
{
  "status": "ok",
  "rowsAdded": 1,
  "rows": [
    {
      "id": "68f3c1a49b2e4d0012ab34cd",
      "activityDate": "2026/08/07",
      "activityTime": "14:00",
      "hours": 1,
      "minutes": 30,
      "activityImpact": "Worked through the Kafka consumer-group chapter",
      "createdAt": "2026-08-07T18:22:12Z"
    }
  ],
  "parseErrors": [
    { "error": "missing_duration", "message": "...", "raw": "did some work today" }
  ]
}
```

Notes that matter:

- `parseErrors` is **omitted entirely** when there are none — the server serialises with
  `NON_NULL`. The current type already says `?: ParseError[] | null`, which covers it.
- `error` is exactly one of `missing_duration` | `missing_description` | `outside_working_hours`.
  Narrowing `ParseError.error` from `string` to that union is optional but free.
- `activityTime` is `""` when the line gave no start time — never `null`. Unchanged.
- `createdAt` is RFC 3339 UTC at second precision.

**Edit:** `src/lib/activities-api.ts:13-28` — the `ActivityRow` type. It becomes exactly the row
shape returned by `GET /pending` too, so define it once and use it for both. `id: string` (drop
the `| null`), add `createdAt: string`, delete the five removed fields.

**Worth taking:** rows now come back with real ids, so a row the user just logged can be deleted
via `DELETE /pending/{id}` with no refetch. Optional, and secondary to Part 1 not crashing.

---

## Part 2 — content diffing is gone

The server no longer keeps a `lastContent` snapshot or diffs submissions. Two things vanished:

1. The `{"status": "no new content", "detail": "..."}` 200 response. **Unreachable.**
2. `DELETE /otj-services/reset-notes`. **Route deleted — it now 404s.** (Nothing in `src/`
   calls it; confirmed by grep. Only the docs below mention it.)

Nothing crashes if the dead handling is left in place, so this can lag Part 1. It is dead code:

| File | What |
|---|---|
| `src/lib/activities-api.ts:38-44` | The two-arm union. Collapse to the single `status: "ok"` shape; the `:39-41` docstring describing "two 200-shaped answers" goes with it |
| `src/lib/activities-api.ts:62-69` | `logActivities` docstring — see below |
| `src/app/(tabs)/index.tsx:70-79` | `LastResult`'s `"no new content"` branch |
| `src/components/activity-composer.tsx:300-308` | `Outcome`'s `"no new content"` branch |
| `src/components/result-banner.tsx:7` | Comment cites `"no new content"` as an amber case; `"logged 2 of 3"` still stands |
| `src/components/activity-composer.tsx:135` | `if (res.status === "ok")` — narrowing is redundant once the union is one arm |
| `AGENTS.md:68-71` | Documents the diffing behaviour as current. See Part 4 |

The `logActivities` docstring at `:62-69` currently says sending only the current batch "is what
makes that dedup line up with what the user sees on screen." There is no dedup any more.
**Rewrite rather than delete** — the reason the client sends the current batch rather than a
running document is still worth recording, it just is not about dedup.

### The double-tap question — already handled, do not "fix" it

The backend PR flags that with the differ gone, an identical resubmission now creates a real
duplicate row, and asks the client to confirm the Log button is disabled while a submit is in
flight.

**It already is.** `src/components/activity-composer.tsx` holds `busy` state (`:79`), sets it
before the await and clears it in `finally` (`:118-140`), and the submit button is
`disabled={busy || lineCount === 0}` (`:268`) with a matching `accessibilityState` (`:266`).
Verify it still reads that way, then leave it alone — no work needed.

Duplicates that do get through are now visible and swipeable in the Pending tab, which is the
intended answer.

---

## Part 3 — build the Pending tab

`src/app/(tabs)/pending.tsx` is a placeholder (`:3` — "Needs backend 05.5"). It exists now. The
tab is already registered at `src/app/(tabs)/_layout.tsx:7`.

Both endpoints use the existing bearer token; `apiJson` handles auth, 401 and error messages.

### `GET /otj-services/pending`

Returns the caller's unposted rows, **newest first**.

```json
{
  "activities": [ /* same row shape as Part 1 */ ],
  "count": 1,
  "totalMinutes": 90
}
```

- **An empty queue is a 200**, not a 404: `{"activities": [], "count": 0, "totalMinutes": 0}`.
  This was deliberate so `apiJson` does not throw an `ApiError` on the happy path.
- `totalMinutes` is `sum(hours * 60 + minutes)`, provided so the header can show "3h 45m queued"
  without re-deriving it. Use it.
- `count` always equals `activities.length`.
- `401` is the only error. An unregistered user simply gets an empty list.

### `DELETE /otj-services/pending/{id}`

- **204** — deleted, no body. `apiJson` already returns `undefined` for 204 (`src/lib/api.ts:60`),
  so this types as `Promise<void>`.
- **404** — `{"error": "..."}`, returned identically for "doesn't exist", "belongs to someone
  else" and "already posted". You cannot tell them apart, by design. Treat as "it's gone" and
  refresh.
- **400** — `{"error": "..."}` for a malformed id. Should not happen if you only send ids the
  server gave you.

`errorMessage` in `src/lib/api.ts:74-80` already prefers the server's `{"error": ...}` string, so
both surface a readable message with no extra work.

### What to build

- **`src/lib/pending-api.ts`** — `getPending()` / `deletePending(id)` over `apiJson`. Export the
  shared row type from here or from `activities-api.ts`, not both.
- **`src/app/(tabs)/pending.tsx`** — list + swipe-to-delete, pull-to-refresh, empty state.

Available and already wired:

- **`@tanstack/react-query` v5** — `QueryClientProvider` is mounted in `src/app/_layout.tsx:9`
  but **nothing uses it yet**. This screen is its natural first consumer: `useQuery` for the
  list, `useMutation` + invalidate for the delete, and pull-to-refresh comes from `refetch`.
- **`react-native-gesture-handler` ~2.28** — has `ReanimatedSwipeable` for swipe-to-delete.
- **`react-native-reanimated` ~4.1**.

Constraints that are deliberate — do not "correct" them client-side:

- Ordering is newest-first from the server. **Do not re-sort.** If you want date grouping, group
  without reordering: the server deliberately does not sort by `activityDate`, because a
  back-dated entry would make the list jump.
- `createdAt` is there for relative timestamps ("added 5 minutes ago").
- Reuse `formatDuration` from `src/lib/activities-api.ts:81` rather than reimplementing it.
- `DELETE /otj-services/delete-last-row` still exists and is unchanged, but **do not use it for
  swipe-to-delete** — it deletes by insertion recency, so it cannot address a specific row and
  two quick swipes race into deleting the wrong things. Always `/pending/{id}`.

---

## Part 4 — update `AGENTS.md`

It currently teaches the old behaviour, which is how the removed machinery gets rebuilt by
accident.

- **`:68-71`** — "The server diffs `content` against the **previous** submission … answers
  `{"status": "no new content"}` … That is amber in the UI, not green and not red." All false
  now. Replace with: no diffing, every submission is logged, duplicates show up in Pending and
  are swipeable.
- **`:72-74`** — the partial-failure paragraph (`rowsAdded` / `parseErrors`, green reserved for
  `rowsAdded > 0` with no errors) is **still correct**. Keep it.
- **`:84-88`** — "Screens still to build" says `(tabs)/pending` needs "the 05.5 list/delete
  endpoints, which do not exist yet". They exist. `(tabs)/submit` still needs step 05.
- **`:53-60`** — the file map for logging; add `lib/pending-api.ts` and the Pending screen.

---

## Sequencing

Part 1 is a **breaking wire change**. The backend cannot deploy until a client build carrying it
is ready to ship alongside. Parts 2–4 are additive and can follow.

If you only do one thing, do Part 1.

## Checks

```bash
nix-shell --run "node_modules/.bin/tsc --noEmit"   # typecheck
nix-shell --run "npx expo export --platform web"   # bundling/resolution errors
```

Adding a route regenerates `.expo/types/router.d.ts`, which only happens when Metro runs — if
`tsc` rejects a `Link href` for a route you just added, start `expo start` once.

## Done when

- [ ] `ActivityRow` matches the new shape; nothing reads a removed field
- [ ] `LogActivitiesResponse` is a single shape; no code path expects `"no new content"`
- [ ] Pending tab lists rows newest-first, shows the queued total, and swipe-to-delete removes
      exactly the swiped row
- [ ] Empty pending queue renders an empty state, not an error
- [ ] `AGENTS.md` no longer describes content diffing
- [ ] Typecheck and web export clean

## Ask rather than guess

- If the shared row type wants to live somewhere other than `activities-api.ts` /
  `pending-api.ts`, say so before restructuring — it is consumed by the composer, the Log screen
  and the new list.
- Row-level delete from the composer (Part 1's "worth taking") is optional. Skip it if there is
  no natural place for it rather than forcing one in.

---

*Note: this repo was on branch `delete-activities` with an uncommitted copy edit in
`src/app/(tabs)/index.tsx` when this was written. Unrelated; left alone.*
