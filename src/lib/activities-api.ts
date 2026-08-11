import { apiJson } from "./api";

/**
 * `POST /otj-services/log-activities` — the LLM-assisted logging endpoint.
 *
 * <p>The wire format is one big `content` string, not a list. The backend splits it on newlines
 * and the prompt tells the model to "process each line of the input independently", so
 * <b>one line == one activity</b>. Everything in this module exists to keep that invariant true
 * no matter how the text was typed on a phone keyboard.
 */

/**
 * One unposted activity row, as both `POST /log-activities` and `GET /pending` return it.
 *
 * <p>Narrower than the record the server stores: no `tailscaleUserId` (the client never receives
 * the server-minted userId), no `posted` (false by construction on any endpoint that returns
 * this), no `learnerId` / `unitId` / `activityType`. Defined here rather than in `pending-api.ts`
 * only because this module had it first — it belongs to neither endpoint in particular.
 */
export type ActivityRow = {
  /** Mongo's ObjectId, always present. The handle `deletePending` takes. */
  id: string;
  /** `YYYY/MM/DD`. */
  activityDate: string;
  /** `HH:MM` start time, or `""` when the entry never mentioned one. Never null. */
  activityTime: string;
  hours: number;
  minutes: number;
  /** The activity description — `comments` in the model's output. */
  activityImpact: string;
  /** RFC 3339 UTC, second precision. Derived server-side from the ObjectId's timestamp. */
  createdAt: string;
};

/** A line the model refused: no duration, no description, or hours outside 09:00–18:00. */
export type ParseError = {
  /** Mirrors the server's `ParsedActivities.ErrorCode` enum, which is closed. */
  error: "missing_duration" | "missing_description" | "outside_working_hours";
  message: string | null;
  /** The offending input line, echoed back. Used to re-populate the box that produced it. */
  raw: string;
};

/**
 * The only 200 shape. `parseErrors` is absent rather than empty when every line parsed — the
 * server serialises with `NON_NULL`.
 */
export type LogActivitiesResponse = {
  status: "ok";
  rowsAdded: number;
  rows: ActivityRow[];
  parseErrors?: ParseError[] | null;
};

/**
 * Flattens one entry to a single line.
 *
 * <p>A newline the user typed mid-entry would silently become a second, half-formed activity on
 * the server, so every whitespace run collapses to one space. The box is the entry boundary; the
 * newline belongs to the request format, not to the text.
 */
export function normaliseEntry(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The entries as they will actually be sent, blanks dropped. */
export function toLines(entries: string[]): string[] {
  return entries.map(normaliseEntry).filter((line) => line.length > 0);
}

/**
 * Sends the entries as newline-separated lines.
 *
 * <p>`content` is the batch on screen right now, never a running document of everything logged so
 * far. The server passes whatever it is given straight to the model and writes a row for every
 * line that parses — it keeps no snapshot and does no deduplication — so a running document would
 * re-log its whole history on each submit. The rule is: one request is one batch, and every line
 * in it is meant to become a row.
 *
 * <p>Which also means an identical resubmission produces a genuine duplicate. The composer's
 * submit button is disabled while this is in flight for exactly that reason; anything that still
 * gets through is visible and deletable in the Pending tab.
 */
export async function logActivities(entries: string[]): Promise<LogActivitiesResponse> {
  const lines = toLines(entries);
  if (lines.length === 0) throw new Error("Nothing to log — every entry is empty.");

  return apiJson<LogActivitiesResponse>("/otj-services/log-activities", {
    method: "POST",
    body: JSON.stringify({ content: lines.join("\n") }),
  });
}

/** `1h 30m`, `45m`, `2h` — whichever parts are non-zero. */
export function formatDuration(hours: number, minutes: number): string {
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  return parts.length > 0 ? parts.join(" ") : "0m";
}
