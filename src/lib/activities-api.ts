import { apiJson } from "./api";

/**
 * `POST /otj-services/log-activities` — the LLM-assisted logging endpoint.
 *
 * <p>The wire format is one big `content` string, not a list. The backend splits it on newlines
 * and the prompt tells the model to "process each line of the input independently", so
 * <b>one line == one activity</b>. Everything in this module exists to keep that invariant true
 * no matter how the text was typed on a phone keyboard.
 */

/** A row the model parsed and the backend wrote to Mongo, still unposted to OneAdvanced. */
export type ActivityRow = {
  tailscaleUserId: string;
  learnerId: string;
  /** The activity description — `comments` in the model's output. */
  activityImpact: string;
  unitId: string;
  /** `YYYY/MM/DD`. */
  activityDate: string;
  /** `HH:MM` start time, or `""` when the entry never mentioned one. */
  activityTime: string;
  activityType: number;
  hours: number;
  minutes: number;
  posted: boolean;
  id: string | null;
};

/** A line the model refused: no duration, no description, or hours outside 09:00–18:00. */
export type ParseError = {
  error: string;
  message: string | null;
  /** The offending input line, echoed back. Used to re-populate the box that produced it. */
  raw: string;
};

/**
 * Two 200-shaped answers, told apart by `status`. "no new content" is not a failure — it is the
 * server saying the diff against the previous submission was empty.
 */
export type LogActivitiesResponse =
  | { status: "ok"; rowsAdded: number; rows: ActivityRow[]; parseErrors?: ParseError[] | null }
  | { status: "no new content"; detail: string };

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
 * <p>The server keeps the last `content` it saw and only passes *new* lines to the model, so
 * resending an unchanged line comes back as "no new content" rather than a duplicate row. Sending
 * only the current batch — not a running document — is what makes that dedup line up with what
 * the user sees on screen.
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
