import { apiJson } from "./api";
import type { ActivityRow } from "./activities-api";

/**
 * The unposted queue — `GET /otj-services/pending`, `PUT /otj-services/pending/{id}` and
 * `DELETE /otj-services/pending/{id}`.
 *
 * <p>These are rows the backend has written but not yet pushed to OneAdvanced. The row shape is
 * `ActivityRow`, the same one `POST /log-activities` answers with, so a row can be deleted
 * straight from a log response without a refetch.
 */

export type { ActivityRow };

/**
 * The react-query key for the pending list. Exported so the composer can invalidate it after a
 * successful log — the rows it just created belong to this list.
 */
export const pendingKey = ["pending"] as const;

export type PendingResponse = {
  /** Newest first. The server's order is deliberate — see `getPending`. */
  activities: ActivityRow[];
  /** Always `activities.length`. */
  count: number;
  /** `sum(hours * 60 + minutes)`, computed server-side so the header need not re-derive it. */
  totalMinutes: number;
};

/**
 * The caller's unposted rows, newest first.
 *
 * <p><b>Do not re-sort.</b> The server orders by insertion, not by `activityDate`, so that
 * back-dating an entry cannot make it appear halfway down a list the user is reading. Grouping by
 * date is fine as long as it preserves this order.
 *
 * <p>An empty queue is a 200 with an empty array, not a 404 — an empty queue is the normal steady
 * state, so `apiJson` never throws on it. 401 is the only error, and an unregistered user just
 * gets an empty list.
 */
export async function getPending(): Promise<PendingResponse> {
  return apiJson<PendingResponse>("/otj-services/pending");
}

/**
 * The editable subset of a row, as `PUT /pending/{id}` takes it.
 *
 * <p>Everything else about a row — `id`, `createdAt`, and the server-side `learnerId`, `unitId`,
 * `activityType`, `posted` and `tailscaleUserId` the client never sees — is not the user's to set.
 * `activityTime` may be `""`; that is a value, not an omission.
 */
export type ActivityUpdate = {
  activityDate: string;
  activityTime: string;
  hours: number;
  minutes: number;
  activityImpact: string;
};

/**
 * Replaces the editable fields of one unposted row. Answers with the row as it now stands.
 *
 * <p>A full replacement rather than a partial update: the sheet has every editable field on screen
 * anyway, so there is never a reason to distinguish "unset this" from "leave this alone".
 *
 * <p>404 means what it means on `deletePending` — unknown id, someone else's, or posted while the
 * sheet was open — and the server refuses to say which. So it is "the row is gone", not "the save
 * failed": close the sheet and refetch rather than reporting an error the user can do nothing with.
 *
 * <p>Sanitise with `normaliseDraft` before calling. The server re-checks everything regardless;
 * the client-side pass exists to put the error under the field instead of after a round trip.
 */
export async function updatePending(id: string, update: ActivityUpdate): Promise<ActivityRow> {
  return apiJson<ActivityRow>(`/otj-services/pending/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(update),
  });
}

/**
 * Deletes one row by id. 204, no body.
 *
 * <p>Answers 404 identically for "no such id", "belongs to someone else" and "already posted" —
 * distinguishing them would confirm the existence of an id the caller does not own. So a 404 here
 * means "it's gone" and the right response is to refresh, not to report a failure.
 *
 * <p>Not `DELETE /delete-last-row`: that one deletes by insertion recency, so it cannot address a
 * specific row, and two quick swipes race into deleting the wrong things.
 */
export async function deletePending(id: string): Promise<void> {
  await apiJson<void>(`/otj-services/pending/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** `3h 45m queued` — `totalMinutes` split back into hours and minutes. */
export function formatTotalMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  return parts.length > 0 ? parts.join(" ") : "0m";
}

/**
 * `just now` / `5 minutes ago` / `3 days ago` from an RFC 3339 timestamp.
 *
 * <p>Falls back to the raw string if it will not parse: a wrong-looking date is better than
 * "NaN minutes ago".
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;

  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "just now";

  const units: [limit: number, per: number, name: string][] = [
    [3600, 60, "minute"],
    [86400, 3600, "hour"],
    [604800, 86400, "day"],
  ];
  for (const [limit, per, name] of units) {
    if (seconds < limit) {
      const n = Math.floor(seconds / per);
      return `${n} ${name}${n === 1 ? "" : "s"} ago`;
    }
  }

  const weeks = Math.floor(seconds / 604800);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}
