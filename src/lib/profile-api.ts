import { apiJson } from "./api";

/**
 * The signed-in account itself — `GET /auth/me` and `PATCH /auth/me`.
 *
 * <p><b>Neither endpoint is on the backend's `staging` yet.</b> Both are implemented on
 * `add-learner-id-endpoint` in `../otjServices`, against the contract in `learner-id-api-spec.md`
 * there; until that merges, these calls 404. Unlike `submit-api.ts`'s two 501s, nothing here is
 * waiting on unwritten code.
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
 * <p><b>This does not touch rows already written.</b> `learnerId` is copied onto every activity log
 * row when the row is created, so a correction applies to what is logged next, not to what is
 * already queued. Anything sitting in Pending still carries the old value and will post under it —
 * which is why the card says so rather than leaving the user to find out from OneAdvanced.
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
