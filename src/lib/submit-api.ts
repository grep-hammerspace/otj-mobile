import { ApiError, NetworkError, api, apiJson, errorMessage } from "./api";
import { forgetServerKey, sealCredentials } from "./credential-seal";
import type { OaCredentials } from "./oa-credentials";

/**
 * Pushing the queue to OneAdvanced — the four endpoints that between them log in as the user and
 * post every unposted row.
 *
 * <p>Both routes are two calls, and both are stateful on the server: `prepare` builds a driver and
 * parks it in the per-user `UserStateStore`, and the second call finds it there. So the two calls
 * must reach the same backend process, and a `prepare` whose second call never comes just leaves a
 * driver to be replaced by the next one.
 *
 * <pre>
 *   azure  POST /azure-id/prepare {creds} → push sent, maybe a number to match
 *          GET  /azure-id/complete        → blocks until the user taps Approve, then posts
 *
 *   otj    POST /prepare-browser  {creds} → stops at the TOTP field
 *          POST /submit-with-mfa  {code}  → finishes the login, then posts
 * </pre>
 *
 * <p>Submitting is the last step of <i>both</i> second calls — there is no separate "now post"
 * endpoint. A login that succeeds and posts nothing is `nothing_to_post`, not a failure.
 *
 * <p>The credentials do not travel as plaintext JSON any more. `otj-services.com` is behind
 * Cloudflare, which terminates the phone's TLS and opens its own connection to the origin, so a
 * password in a request body spends that hop readable inside infrastructure this project does not
 * own. Both prepare calls now send a `SealedEnvelope` from `credential-seal.ts` instead, and the
 * backend accepts nothing else. See that file for the scheme and for why the pinned identity key
 * is the part that makes it meaningful.
 *
 * <p>All four are live on `staging`. The step-05 work that reinstated the two prepare endpoints as
 * POSTs taking credentials in the body — rather than reading a copy stored server-side — landed as
 * otjServices #33, and the learner ID endpoints these run against landed as #32. The shapes below
 * are the ones that shipped, read off `OneAdvancedCredentials`, `PrepareResponse` and
 * `SubmitWithMfaRequest`, not the ones `steps-04-08-implementation-plan.md` §05.1–05.2 proposed:
 * the plan named the credential fields `oneAdvancedUsername` / `oneAdvancedPassword` and the
 * implementation did not. Sending those names is not a type error and not a 404 — it deserialises
 * to two nulls and comes back 400 "credentials missing", which reads like a rejected password.
 */

/** What `POST /azure-id/prepare` answers. `challengeNumber` is present only for number matching. */
export type AzurePrepare =
  /** An existing Microsoft SSO session logged us straight in — there is nothing to approve. */
  | { status: "login_complete"; message: string }
  | { status: "push_sent"; message: string; challengeNumber?: number };

/**
 * How a submit run ended. Four outcomes, because "did it work" genuinely has four answers here and
 * flattening them would lie about at least one:
 *
 * - `posted`  — every queued row is now in OneAdvanced.
 * - `nothing` — the login worked and the queue was empty. Not an error.
 * - `partial` — some rows went, some were rejected. The rejected ones stay queued.
 * - `failed`  — the login worked and OneAdvanced refused every row.
 */
export type SubmitOutcome =
  | { kind: "posted"; posted: number }
  | { kind: "nothing" }
  | { kind: "partial"; posted: number; failed: number }
  | { kind: "failed"; failed: number };

/**
 * Seals the credentials and posts them, re-sealing once if the server has rotated its key.
 *
 * <p>The sealed JSON is still `{username, password}` — the server's `OneAdvancedCredentials` has
 * no OneAdvanced prefix on its components, and the prefixed names the step-05 plan used remain the
 * one wrong guess here that fails quietly rather than loudly. What changed is only the layer
 * around them.
 *
 * <p>`unknown_key` means the backend restarted between this app fetching its key and this request
 * arriving, so the envelope names a key nothing holds any more. That is an ordinary event, not a
 * failure worth showing anyone: forget the key, seal again, send again. Once — a second
 * `unknown_key` would mean something is rotating keys faster than a request takes, and retrying
 * forever is how a submit loop becomes a login-attempt flood against OneAdvanced.
 */
async function postSealed<T>(path: string, creds: OaCredentials): Promise<T> {
  try {
    return await apiJson<T>(path, { method: "POST", body: JSON.stringify(await sealCredentials(creds)) });
  } catch (e) {
    if (!(e instanceof ApiError) || e.code !== "unknown_key") throw e;
    forgetServerKey();
    return apiJson<T>(path, { method: "POST", body: JSON.stringify(await sealCredentials(creds)) });
  }
}

/**
 * Starts the Azure AD login and sends the Microsoft Authenticator push.
 *
 * <p>Returns as soon as the push is out — the server then polls Microsoft in the background, which
 * is what `completeAzure` waits on.
 *
 * <p>Two failures share this shape with `prepareBrowser`, and neither is the driver's own message:
 * a login that fails is **401** with a deliberately generic one, because the driver's text embeds
 * login-chain URLs that carry the username in `login_hint`; an account with no learner ID is
 * **409**, checked before the login precisely so this route does not make the user approve a push
 * and wait two minutes only to find there is nothing to post under. Both arrive as an `ApiError`
 * whose message is worth showing verbatim.
 *
 * <p>A third failure now sits in front of both, and it is not the server's: `sealCredentials`
 * throws a `KeyTrustError` when the server's key announcement does not verify against the pinned
 * identity key. Nothing is sent in that case. Its message is also written to be shown as-is.
 */
export async function prepareAzure(creds: OaCredentials): Promise<AzurePrepare> {
  return postSealed<AzurePrepare>("/otj-services/azure-id/prepare", creds);
}

/**
 * Waits for the user to approve the push, then posts the queue.
 *
 * <p>The server blocks for up to 125 s. That is longer than the idle timeout some platforms put on
 * a request that sends nothing while it waits, so a dropped connection here is expected rather than
 * exceptional and is retried instead of reported: re-calling simply waits on the same background
 * poll again.
 *
 * <p>The retry is safe but not free of ambiguity — if the connection died *after* the server had
 * already posted, the retry finds an empty queue and reports `nothing`. That reads as "there was
 * nothing to send" when in truth it had just been sent. The Pending tab is the tiebreaker, and it
 * is refreshed either way.
 *
 * <p>A 408 is not retried here: it means two minutes passed with no approval, which is a person to
 * prompt, not a connection to retry.
 */
export async function completeAzure(attempts = 3): Promise<SubmitOutcome> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await readOutcome("/otj-services/azure-id/complete");
    } catch (e) {
      if (!(e instanceof NetworkError) || attempt >= attempts) throw e;
    }
  }
}

/**
 * Logs in far enough to reach the TOTP field and leaves the session open there.
 *
 * <p>Answers `{"status": "otp_required"}`, which carries no information the caller does not already
 * have, so the return is `void`: reaching here without throwing *is* the result. The code the user
 * is about to type expires in about 30 s, so the field wants to be on screen the moment this
 * resolves. The 401 and 409 described on `prepareAzure` apply here too.
 */
export async function prepareBrowser(creds: OaCredentials): Promise<void> {
  await postSealed<{ status: string }>("/otj-services/prepare-browser", creds);
}

/**
 * Finishes the OneAdvanced login with a TOTP code, then posts the queue.
 *
 * <p>A rejected code is a 400 whose message says so; it is the one error here a user can fix on the
 * spot, by reading a fresh code and trying again.
 *
 * <p>The code is <b>not</b> sealed, unlike the credentials. It is a six-digit number that expires
 * in about thirty seconds and cannot be replayed after that, so a copy taken at the edge is worth
 * nothing by the time anyone could use it — while sealing it would put a key fetch in front of the
 * most time-critical call in the app, against a code that is already half spent.
 */
export async function submitWithMfa(mfaCode: string): Promise<SubmitOutcome> {
  return readOutcome("/otj-services/submit-with-mfa", {
    method: "POST",
    body: JSON.stringify({ mfaCode }),
  });
}

/**
 * Reads the shared outcome body that both second calls answer with.
 *
 * <p>Not `apiJson`, because of one status: `all_failed` comes back as a 502 with a
 * `{"status": ...}` body and no `error` key, so `apiJson` would throw it as "the server had a
 * problem" — when what actually happened is that the server worked fine and OneAdvanced rejected
 * every row. That distinction is the difference between "try again in a moment" and "look at your
 * rows". Every other non-2xx keeps the standard treatment.
 */
async function readOutcome(path: string, init: RequestInit = {}): Promise<SubmitOutcome> {
  const res = await api(path, init);
  const body = await res.text();

  let parsed: { status?: string; posted?: number; failed?: number } | null = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Not JSON. `parsed` stays null and the checks below fall through to the error path.
  }

  if (res.status === 502 && parsed?.status === "all_failed") {
    return { kind: "failed", failed: parsed.failed ?? 0 };
  }
  if (!res.ok) throw new ApiError(res.status, errorMessage(res.status, body));

  if (parsed?.status === "nothing_to_post") return { kind: "nothing" };
  if (parsed?.status === "partial") {
    return { kind: "partial", posted: parsed.posted ?? 0, failed: parsed.failed ?? 0 };
  }
  if (parsed?.status === "ok") return { kind: "posted", posted: parsed.posted ?? 0 };

  throw new ApiError(res.status, "The server sent a response the app could not read.");
}

/** One line for the result banner, and the thing the user actually wants to know. */
export function describeOutcome(outcome: SubmitOutcome): string {
  switch (outcome.kind) {
    case "posted":
      return `${outcome.posted} ${outcome.posted === 1 ? "activity" : "activities"} submitted to OneAdvanced.`;
    case "nothing":
      return "You were signed in successfully, but there was nothing queued to send.";
    case "partial":
      return `${outcome.posted} sent, ${outcome.failed} refused by OneAdvanced. The refused ${
        outcome.failed === 1 ? "one is" : "ones are"
      } still in Pending.`;
    case "failed":
      return `OneAdvanced refused all ${outcome.failed} ${
        outcome.failed === 1 ? "activity" : "activities"
      }. They are still in Pending.`;
  }
}
