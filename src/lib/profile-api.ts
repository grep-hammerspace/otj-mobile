import { apiJson } from "./api";

/**
 * The signed-in account itself — `GET /auth/me` and `PATCH /auth/me`.
 *
 * <p>Both are on the backend's `staging`, landed as otjServices #32 against the contract in
 * `learner-id-api-spec.md`. Server-side they sit on their own `AccountResource` rather than
 * `AuthResource`, because that class is deliberately un-`@Authenticated` and the annotation binds
 * per class.
 *
 * <p>Separate from `auth-api.ts` on purpose. That file is the three anonymous calls you make
 * *around* a token; these two are authenticated reads and writes of the account behind one, and
 * only they need a Bearer header to mean anything.
 */

/**
 * The account as the server holds it.
 *
 * <p>`username` is this app's own login — `appUsername` server-side — and is read-only here; it is
 * carried so the card can say whose learner ID is on screen without a second call. It is not the
 * OneAdvanced username, which never reaches the server at all (see `oa-credentials.ts`).
 */
export type Profile = {
  username: string;
  learnerId: string;
};

/**
 * The signed-in account. 401 is the only expected failure, and `api()` has already cleared the
 * token and bounced the user by the time it surfaces.
 */
export async function getProfile(): Promise<Profile> {
  return apiJson<Profile>("/auth/me");
}

/**
 * Corrects the learner ID captured at signup. Answers with the account as it now stands.
 *
 * <p>A `PATCH` with the one field rather than a `PUT` of the whole profile: `username` is not the
 * user's to change here and `password` has no business in this shape, so there is nothing else a
 * full replacement could carry.
 *
 * <p><b>A correction does reach rows already queued.</b> `learnerId` is copied onto every activity
 * log row as the row is created and those copies are left alone, so the stored value records what
 * was intended at the time. But submission does not read them: `Driver#submitPendingOtjs` is handed
 * the learner ID looked up on the account at submit time, so everything in Pending posts under the
 * corrected one. Without that, a typo noticed after logging could not be repaired at all.
 *
 * <p>A true back-fill, rewriting the stored rows, is deliberately not done — so a row's own copy
 * and the value it posts under can differ, and it is the row's copy that is out of date. Nothing in
 * this app shows that copy, so the distinction stays invisible to the user.
 *
 * <p>Trimmed here as well as server-side because the server stores `learnerId` verbatim and the
 * drivers `strip()` it only on the way out; a trailing space saved now is a mismatch that survives
 * in the database.
 */
export async function updateLearnerId(learnerId: string): Promise<Profile> {
  return apiJson<Profile>("/auth/me", {
    method: "PATCH",
    body: JSON.stringify({ learnerId: learnerId.trim() }),
  });
}

/** The react-query key for `getProfile`. One account, so no id in the key. */
export const profileKey = ["profile"] as const;
