import { normaliseEntry, type ActivityRow } from "./activities-api";
import type { ActivityUpdate } from "./pending-api";

/**
 * Normalisation and validation for the edit sheet — `PUT /otj-services/pending/{id}`.
 *
 * <p>React-free and side-effect-free so the rules can be read, tested and changed without going
 * near the modal that renders them. The split matters because these rules are a *mirror*: the
 * server enforces the same set, and it does not trust a byte of what happens here. All of this
 * exists so a mistyped date shows an error under the field instead of after a round trip.
 *
 * <p>Every rule traces to something that already existed before this screen did — the JSON schema
 * the model is constrained to (`ParsedActivities.Entry`), the working-hours rule in
 * `llm_prompt.txt`, or the payload `OtjDriver` builds for OneAdvanced. Nothing here is a new
 * policy, deliberately: an edited row must not be able to end up less valid than a parsed one, and
 * a rule the edit screen enforced alone would be a rule the main logging path silently allowed.
 */

/**
 * The sheet's fields as typed, all strings.
 *
 * <p>`hours` and `minutes` are strings rather than numbers because that is what a `TextInput`
 * hands back, and because "" mid-edit is a state a number cannot hold. They become numbers exactly
 * once, in the `ActivityUpdate` that goes on the wire.
 */
export type ActivityDraft = {
  activityDate: string;
  activityTime: string;
  hours: string;
  minutes: string;
  activityImpact: string;
};

/** Per-field messages, shown under the field they belong to. Absent key means that field is fine. */
export type DraftErrors = Partial<Record<keyof ActivityDraft, string>>;

/** 09:00–18:00, from `llm_prompt.txt` rule 5. Inclusive at both ends. */
const DAY_START_MINUTES = 9 * 60;
const DAY_END_MINUTES = 18 * 60;

/** `YYYY/MM/DD`, the format the OneAdvanced payload is built from. */
const DATE_PATTERN = /^\d{4}\/\d{2}\/\d{2}$/;
/** `HH:MM`, two-digit hour, 00:00–23:59. Working hours are checked separately. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The row as the sheet first shows it. Numbers become strings; nothing is reformatted. */
export function toDraft(row: ActivityRow): ActivityDraft {
  return {
    activityDate: row.activityDate,
    activityTime: row.activityTime,
    hours: String(row.hours),
    minutes: String(row.minutes),
    activityImpact: row.activityImpact,
  };
}

/**
 * The canonical form of what was typed: padded, carried and collapsed.
 *
 * <p>Runs before validation so the user gets the benefit of the doubt on formatting — `2026-8-9`
 * and `9:5` are unambiguous, and rejecting them would be pedantry. Only what is genuinely
 * unresolvable reaches `validateDraft` as an error.
 *
 * <p>The sheet writes the result back into its own state on submit, so the fields visibly snap to
 * what is about to be sent. Showing "90" in the minutes box while storing 1h 30m would be a small
 * lie about what the server holds.
 */
export function normaliseDraft(draft: ActivityDraft): ActivityDraft {
  return {
    activityDate: normaliseDate(draft.activityDate),
    activityTime: normaliseTime(draft.activityTime),
    ...carryMinutes(draft.hours, draft.minutes),
    activityImpact: normaliseEntry(draft.activityImpact),
  };
}

/**
 * Normalises, then checks every rule the server checks.
 *
 * <p>Returns the errors *and* the payload: `update` is non-null exactly when `errors` is empty, so
 * the caller has one thing to branch on and cannot send a draft it failed to check.
 */
export function validateDraft(draft: ActivityDraft): {
  errors: DraftErrors;
  update: ActivityUpdate | null;
} {
  const clean = normaliseDraft(draft);
  const errors: DraftErrors = {};

  if (!DATE_PATTERN.test(clean.activityDate)) {
    errors.activityDate = "Use YYYY/MM/DD, e.g. 2026/08/12.";
  } else if (!isRealDate(clean.activityDate)) {
    errors.activityDate = "There is no such date.";
  } else if (isFuture(clean.activityDate)) {
    // Prompt rule 1: relative dates resolve to the most recent match in the past, never a future
    // one. An edit that could back-date forwards would be the one way round that.
    errors.activityDate = "Pick today or a day already past.";
  }

  // An empty start time is legitimate and common — the model only sets one when the entry gave a
  // time or a range, so most rows have none.
  if (clean.activityTime !== "") {
    if (!TIME_PATTERN.test(clean.activityTime)) {
      errors.activityTime = "Use HH:MM, e.g. 09:00 — or leave it blank.";
    } else {
      const atMinute = minutesOfDay(clean.activityTime);
      if (atMinute < DAY_START_MINUTES || atMinute > DAY_END_MINUTES) {
        errors.activityTime = "Start times run from 09:00 to 18:00.";
      }
    }
  }

  const hours = wholeNumber(clean.hours);
  const minutes = wholeNumber(clean.minutes);
  if (hours === null) errors.hours = "Whole hours only.";
  if (minutes === null) errors.minutes = "Whole minutes only.";

  if (hours !== null && minutes !== null) {
    const total = hours * 60 + minutes;
    if (total === 0) {
      errors.hours = "Add how long it took.";
    } else if (hours > 24) {
      // A sanity bound, not a working-day rule: the parser caps no duration at all, so neither
      // does this. See the note in pending-edit-api-spec.md.
      errors.hours = "That is longer than a day.";
    }
  }

  if (clean.activityImpact === "") errors.activityImpact = "Say what you did.";

  if (Object.keys(errors).length > 0) return { errors, update: null };

  return {
    errors,
    update: {
      activityDate: clean.activityDate,
      activityTime: clean.activityTime,
      hours: Number(clean.hours),
      minutes: Number(clean.minutes),
      activityImpact: clean.activityImpact,
    },
  };
}

/** `2026-8-9` and `2026/8/9` both become `2026/08/09`. Anything else is returned to be rejected. */
function normaliseDate(input: string): string {
  const parts = input.trim().split(/[/\-.]/);
  if (parts.length !== 3) return input.trim();

  const [year, month, day] = parts;
  if (!/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day)) {
    return input.trim();
  }
  return `${year}/${month.padStart(2, "0")}/${day.padStart(2, "0")}`;
}

/** `9:5` and `9.5` both become `09:05`. Blank stays blank — that is a valid value, not a gap. */
function normaliseTime(input: string): string {
  const time = input.trim();
  if (time === "") return "";

  const parts = time.split(/[:.]/);
  if (parts.length !== 2) return time;

  const [hour, minute] = parts;
  if (!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute)) return time;
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

/**
 * Carries minutes into hours, so "90 minutes" is stored as 1h 30m.
 *
 * <p>The schema tells the model "Never 60 or more — carry into hours", and `OtjDriver` formats
 * minutes `%02d` into the OneAdvanced payload. A hand-typed 90 has to land in the same shape the
 * parser would have produced. Either field failing to parse leaves both alone, so the error can
 * point at the one the user actually got wrong.
 */
function carryMinutes(hoursInput: string, minutesInput: string): { hours: string; minutes: string } {
  const hours = wholeNumber(hoursInput);
  const minutes = wholeNumber(minutesInput);
  if (hours === null || minutes === null) {
    return { hours: hoursInput.trim(), minutes: minutesInput.trim() };
  }

  const total = hours * 60 + minutes;
  return { hours: String(Math.floor(total / 60)), minutes: String(total % 60) };
}

/** A non-negative integer, or null. Blank counts as 0 — an empty hours box means "no hours". */
function wholeNumber(input: string): number | null {
  const text = input.trim();
  if (text === "") return 0;
  if (!/^\d+$/.test(text)) return null;

  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

/** Rejects 2026/02/31: `Date` rolls it forward, so the parts have to survive the round trip. */
function isRealDate(date: string): boolean {
  const [year, month, day] = date.split("/").map(Number);
  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
  );
}

/** Compared in local time, because "today" to the person holding the phone is a local-time idea. */
function isFuture(date: string): boolean {
  const [year, month, day] = date.split("/").map(Number);
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return new Date(year, month - 1, day).getTime() > midnight.getTime();
}

function minutesOfDay(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}
