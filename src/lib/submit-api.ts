import { ApiError, NetworkError, api, apiJson, errorMessage } from "./api";
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
 * <p><b>These endpoints answer 501 on staging today.</b> `/prepare-browser` and
 * `/azure-id/prepare` were turned into stubs when OneAdvanced credentials stopped being stored
 * server-side, and the step-05 work that reinstates them as POSTs taking credentials in the body
 * has not landed. The request shapes below are that plan's (`steps-04-08-implementation-plan.md`,
 * §05.1–05.2 in the otjServices repo); the response shapes are the ones the pre-501 code actually
 * returned. Until it ships, a submit run ends with the 501's own message on screen.
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

const CREDS_BODY = (creds: OaCredentials) =>
  JSON.stringify({
    oneAdvancedUsername: creds.username,
    oneAdvancedPassword: creds.password,
  });

/**
 * Starts the Azure AD login and sends the Microsoft Authenticator push.
 *
 * <p>Returns as soon as the push is out — the server then polls Microsoft in the background, which
 * is what `completeAzure` waits on. Answers 400 with the driver's own message when the login itself
 * fails (a wrong password, a changed login page), and that message is worth showing verbatim.
 */
export async function prepareAzure(creds: OaCredentials): Promise<AzurePrepare> {
  return apiJson<AzurePrepare>("/otj-services/azure-id/prepare", {
    method: "POST",
    body: CREDS_BODY(creds),
  });
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
 * <p>Answers `{"status": "ready"}`, which carries no information the caller does not already have,
 * so the return is `void`: reaching here without throwing *is* the result. The code the user is
 * about to type expires in about 30 s, so the field wants to be on screen the moment this resolves.
 */
export async function prepareBrowser(creds: OaCredentials): Promise<void> {
  await apiJson<{ status: string }>("/otj-services/prepare-browser", {
    method: "POST",
    body: CREDS_BODY(creds),
  });
}

/**
 * Finishes the OneAdvanced login with a TOTP code, then posts the queue.
 *
 * <p>A rejected code is a 400 whose message says so; it is the one error here a user can fix on the
 * spot, by reading a fresh code and trying again.
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
