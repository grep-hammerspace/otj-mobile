import { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  formatDuration,
  logActivities,
  normaliseEntry,
  toLines,
  type ActivityRow,
  type LogActivitiesResponse,
} from "../lib/activities-api";
import { ResultBanner, tones } from "./result-banner";

/**
 * The "add activities" sheet: one bordered box per activity, sent as one newline-separated
 * `content` string.
 *
 * <p>Boxes rather than a single free-text area because the server's unit of work is a line, and a
 * phone keyboard makes newlines easy to type by accident. Each box may hold as many sentences as
 * the user likes — `normaliseEntry` flattens whatever they type back to one line on the way out.
 */

type Entry = { id: string; text: string };

export function ActivityComposer({
  visible,
  onClose,
  onLogged,
}: {
  visible: boolean;
  onClose: () => void;
  /** Lets the Log screen keep showing the outcome after the sheet is dismissed. */
  onLogged?: (result: LogActivitiesResponse) => void;
}) {
  const nextId = useRef(1);
  const blank = (): Entry => ({ id: `entry-${nextId.current++}`, text: "" });

  const [entries, setEntries] = useState<Entry[]>(() => [blank()]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LogActivitiesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lineCount = toLines(entries.map((e) => e.text)).length;

  const setText = (id: string, text: string) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, text } : e)));

  const addEntry = () => setEntries((prev) => [...prev, blank()]);

  const removeEntry = (id: string) =>
    setEntries((prev) => (prev.length === 1 ? prev : prev.filter((e) => e.id !== id)));

  const close = () => {
    setError(null);
    setResult(null);
    onClose();
  };

  const submit = async () => {
    if (lineCount === 0) {
      setResult(null);
      setError("Write at least one activity before logging.");
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await logActivities(entries.map((e) => e.text));
      setResult(res);
      onLogged?.(res);
      if (res.status === "ok") keepOnlyRejected(res.parseErrors ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not log those activities.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Clears the boxes that landed and leaves the ones the model refused, so a fix is an edit
   * rather than a retype. If none of them match — the model paraphrased `raw` instead of echoing
   * it — nothing is cleared: losing the user's text is worse than leaving a stale box.
   */
  const keepOnlyRejected = (parseErrors: { raw: string }[]) => {
    if (parseErrors.length === 0) {
      setEntries([blank()]);
      return;
    }
    const rejected = parseErrors.map((p) => normaliseEntry(p.raw ?? ""));
    const kept = entries.filter((e) => rejected.includes(normaliseEntry(e.text)));
    if (kept.length > 0) setEntries(kept);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.sheet}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>New activities</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={close}
            hitSlop={12}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
          >
            <Text style={styles.headerAction}>Close</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.hint}>
            One box per activity — write as many sentences as you like. Say what you did and how
            long it took; each box is sent as its own line.
          </Text>

          <Outcome result={result} error={error} />

          {entries.map((entry, i) => (
            <View key={entry.id} style={styles.entry}>
              <View style={styles.entryHeader}>
                <Text style={styles.entryLabel}>Entry {i + 1}</Text>
                {entries.length > 1 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove entry ${i + 1}`}
                    onPress={() => removeEntry(entry.id)}
                    hitSlop={12}
                    style={({ pressed }) => (pressed ? styles.pressed : null)}
                  >
                    <Text style={styles.entryRemove}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
              <TextInput
                style={styles.entryInput}
                value={entry.text}
                onChangeText={(text) => setText(entry.id, text)}
                placeholder="e.g. Spent 2 hours this morning pairing on the auth filter and writing its tests."
                placeholderTextColor="#9ca3af"
                multiline
                textAlignVertical="top"
                editable={!busy}
              />
            </View>
          ))}

          <Pressable
            accessibilityRole="button"
            onPress={addEntry}
            disabled={busy}
            style={({ pressed }) => [styles.addEntry, pressed ? styles.pressed : null]}
          >
            <Text style={styles.addEntryText}>+ Add another entry</Text>
          </Pressable>
        </ScrollView>

        <View style={styles.footer}>
          <Text style={styles.footerCount}>
            {lineCount === 0
              ? "Nothing to send yet"
              : `${lineCount} ${lineCount === 1 ? "entry" : "entries"} → ${lineCount} ${
                  lineCount === 1 ? "line" : "lines"
                }`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || lineCount === 0, busy }}
            onPress={submit}
            disabled={busy || lineCount === 0}
            style={({ pressed }) => [
              styles.submit,
              busy || lineCount === 0 ? styles.submitInactive : null,
              pressed && !busy && lineCount > 0 ? styles.submitPressed : null,
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.submitText}>
                {lineCount <= 1 ? "Log activity" : `Log ${lineCount} activities`}
              </Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Red for "nothing landed", amber for partials, green only when every line became a row. */
function Outcome({
  result,
  error,
}: {
  result: LogActivitiesResponse | null;
  error: string | null;
}) {
  if (error) return <ResultBanner tone="error" title="Not logged" detail={error} />;
  if (!result) return null;

  if (result.status === "no new content") {
    return (
      <ResultBanner
        tone="warning"
        title="Nothing new to log"
        detail="These lines match your last submission exactly, so the server skipped them. Change the wording if this really is a separate activity."
      />
    );
  }

  const parseErrors = result.parseErrors ?? [];
  const tone = result.rowsAdded === 0 ? "error" : parseErrors.length > 0 ? "warning" : "success";
  const title =
    result.rowsAdded === 0
      ? "Nothing was logged"
      : parseErrors.length > 0
        ? `Logged ${result.rowsAdded} of ${result.rowsAdded + parseErrors.length}`
        : `Logged ${result.rowsAdded} ${result.rowsAdded === 1 ? "activity" : "activities"}`;

  return (
    <ResultBanner tone={tone} title={title}>
      {result.rows.map((row, i) => (
        <LoggedRow key={row.id ?? `row-${i}`} row={row} />
      ))}
      {parseErrors.map((err, i) => (
        <View key={`err-${i}`} style={styles.rejected}>
          <Text style={styles.rejectedReason}>{err.message ?? err.error}</Text>
          <Text style={styles.rejectedRaw}>&ldquo;{err.raw}&rdquo;</Text>
        </View>
      ))}
      {parseErrors.length > 0 ? (
        <Text style={styles.rejectedHelp}>
          The boxes above have been kept — add the missing detail and log again.
        </Text>
      ) : null}
    </ResultBanner>
  );
}

function LoggedRow({ row }: { row: ActivityRow }) {
  const meta = [row.activityDate, formatDuration(row.hours, row.minutes), row.activityTime]
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={styles.row}>
      <Text style={styles.rowMeta}>{meta}</Text>
      <Text style={styles.rowText}>{row.activityImpact}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 20 : 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
  },
  headerAction: {
    fontSize: 16,
    fontWeight: "600",
    color: "#208AEF",
  },
  pressed: {
    opacity: 0.6,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    gap: 16,
  },
  hint: {
    fontSize: 14,
    lineHeight: 20,
    color: "#6b7280",
  },
  entry: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    backgroundColor: "#f9fafb",
    padding: 12,
    gap: 8,
  },
  entryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  entryLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#374151",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  entryRemove: {
    fontSize: 13,
    fontWeight: "600",
    color: "#dc2626",
  },
  entryInput: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    padding: 12,
    fontSize: 16,
    lineHeight: 22,
    color: "#111827",
  },
  addEntry: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#208AEF",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  addEntryText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#208AEF",
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 32 : 20,
    gap: 10,
  },
  footerCount: {
    fontSize: 13,
    color: "#6b7280",
  },
  submit: {
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#208AEF",
    minHeight: 52,
  },
  submitInactive: {
    backgroundColor: "#9cc7f0",
  },
  submitPressed: {
    backgroundColor: "#1a6fbf",
  },
  submitText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  row: {
    borderTopWidth: 1,
    borderTopColor: tones.success.border,
    paddingTop: 8,
    marginTop: 2,
  },
  rowMeta: {
    fontSize: 12,
    fontWeight: "700",
    color: "#166534",
  },
  rowText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#14532d",
  },
  rejected: {
    borderTopWidth: 1,
    borderTopColor: tones.error.border,
    paddingTop: 8,
    marginTop: 2,
  },
  rejectedReason: {
    fontSize: 13,
    fontWeight: "700",
    color: "#b91c1c",
  },
  rejectedRaw: {
    fontSize: 14,
    lineHeight: 20,
    color: "#7f1d1d",
    fontStyle: "italic",
  },
  rejectedHelp: {
    fontSize: 13,
    color: "#92400e",
    marginTop: 4,
  },
});
