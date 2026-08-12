import { useState } from "react";
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
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  normaliseDraft,
  toDraft,
  validateDraft,
  type ActivityDraft,
  type DraftErrors,
} from "../lib/activity-edit";
import { type ActivityRow } from "../lib/activities-api";
import { relativeTime, type ActivityUpdate } from "../lib/pending-api";
import { ResultBanner } from "./result-banner";

/**
 * The edit sheet for one queued activity — the four things a person can reasonably want to fix
 * about the model's reading of their sentence.
 *
 * <p>Opened by swiping a row right in the Pending tab. Closing changes nothing: the sheet is its
 * own confirmation, which is why the gesture can open it outright while delete still needs its
 * two steps.
 */

type EditorProps = {
  /** The row being edited, or null when the sheet is closed. Doubles as the modal's visibility. */
  row: ActivityRow | null;
  onClose: () => void;
  onSave: (update: ActivityUpdate) => void;
  /** Owned by the screen, not the sheet — a save must survive the sheet unmounting. */
  busy: boolean;
  error: string | null;
};

export function ActivityEditor({ row, onClose, onSave, busy, error }: EditorProps) {
  return (
    <Modal
      visible={row !== null}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
      // Android draws the modal in its own window; these make that window edge-to-edge whatever
      // the OS version, so what the provider below measures is what the user sees.
      statusBarTranslucent
      navigationBarTranslucent
    >
      {/*
        A second provider, inside the modal — the same load-bearing nesting as the composer. The
        root provider describes the window *underneath* this one, which on Android is a different
        window with different insets.
      */}
      <SafeAreaProvider>
        {/*
          Keyed by id so the draft is rebuilt whenever a different row is opened.

          This is the opposite of the composer, on purpose. The composer holds its state in the
          shell so closing the sheet cannot discard half-typed entries, because that text exists
          nowhere else. Here the row on the server is the source of truth, and a draft that
          outlived a close would eventually be shown against a row that had changed underneath it.
          Losing an abandoned edit costs a retype; showing a stale one costs a wrong save.
        */}
        {row ? (
          <EditorBody
            key={row.id}
            row={row}
            onClose={onClose}
            onSave={onSave}
            busy={busy}
            error={error}
          />
        ) : null}
      </SafeAreaProvider>
    </Modal>
  );
}

/** Everything below the nested provider — a component cannot read a context it renders itself. */
function EditorBody({
  row,
  onClose,
  onSave,
  busy,
  error,
}: EditorProps & { row: ActivityRow }) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<ActivityDraft>(() => toDraft(row));
  const [errors, setErrors] = useState<DraftErrors>({});

  // Floors keep the spacing sane where an inset is 0 — web, older Android, some iPhone states.
  const gutter = { paddingLeft: 20 + insets.left, paddingRight: 20 + insets.right };
  const headerPad = { ...gutter, paddingTop: Math.max(insets.top + 12, 16) };
  const footerPad = { ...gutter, paddingBottom: Math.max(insets.bottom + 12, 20) };

  const set = (field: keyof ActivityDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    // Clearing on edit rather than re-validating on every keystroke: a message that disappears
    // the moment you start fixing the field is less noisy than one that rewrites itself as you type.
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  /**
   * Normalises into the fields first, so what is about to be sent is what is on screen — a padded
   * date, a carried 90 minutes — and only then validates.
   */
  const submit = () => {
    const clean = normaliseDraft(draft);
    setDraft(clean);

    const { errors: found, update } = validateDraft(clean);
    setErrors(found);
    if (update) onSave(update);
  };

  return (
    <KeyboardAvoidingView
      style={styles.sheet}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, headerPad]}>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Edit activity</Text>
          <Text style={styles.headerMeta}>added {relativeTime(row.createdAt)}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close without saving"
          onPress={onClose}
          style={({ pressed }) => [styles.closeButton, pressed ? styles.pressed : null]}
        >
          <Text style={styles.closeButtonText}>Close</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, gutter]}
        keyboardShouldPersistTaps="handled"
      >
        {error ? <ResultBanner tone="error" title="Not saved" detail={error} /> : null}

        <EditField
          label="Date"
          value={draft.activityDate}
          onChangeText={(text) => set("activityDate", text)}
          error={errors.activityDate}
          placeholder="2026/08/12"
          keyboardType="numbers-and-punctuation"
          editable={!busy}
          hint="Today or any day already past."
        />

        <EditField
          label="Start time"
          value={draft.activityTime}
          onChangeText={(text) => set("activityTime", text)}
          error={errors.activityTime}
          placeholder="09:00"
          keyboardType="numbers-and-punctuation"
          editable={!busy}
          hint="24-hour, between 09:00 and 18:00. Leave blank if it had no set start."
        />

        <View style={styles.durationRow}>
          <View style={styles.durationField}>
            <EditField
              label="Hours"
              value={draft.hours}
              onChangeText={(text) => set("hours", text)}
              error={errors.hours}
              placeholder="0"
              keyboardType="number-pad"
              editable={!busy}
            />
          </View>
          <View style={styles.durationField}>
            <EditField
              label="Minutes"
              value={draft.minutes}
              onChangeText={(text) => set("minutes", text)}
              error={errors.minutes}
              placeholder="0"
              keyboardType="number-pad"
              editable={!busy}
            />
          </View>
        </View>
        <Text style={styles.hint}>Over 59 minutes rolls into hours when you save.</Text>

        <EditField
          label="What you did"
          value={draft.activityImpact}
          onChangeText={(text) => set("activityImpact", text)}
          error={errors.activityImpact}
          placeholder="e.g. Paired on the auth filter and wrote its tests"
          editable={!busy}
          multiline
        />
      </ScrollView>

      <View style={[styles.footer, footerPad]}>
        {/* The second way out: the top corner is hard to reach one-handed on a tall phone, and
            Android's back gesture is the third. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel without saving"
          onPress={onClose}
          style={({ pressed }) => [styles.cancel, pressed ? styles.pressed : null]}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy, busy }}
          onPress={submit}
          // Disabled while in flight for the same reason the composer's is: nothing in this system
          // deduplicates, so a double-tap is two real writes.
          disabled={busy}
          style={({ pressed }) => [
            styles.save,
            busy ? styles.saveInactive : null,
            pressed && !busy ? styles.savePressed : null,
          ]}
        >
          {busy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.saveText}>Save changes</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * A labelled field with an optional hint and error.
 *
 * <p>Not `components/form.tsx`'s `Field`: that one is built for the auth screens, where every
 * field is full-width and stacked with a fixed bottom margin. These sit in a gap-spaced column and
 * two of them share a row, so the margin fights the layout.
 */
function EditField({
  label,
  hint,
  error,
  multiline,
  ...inputProps
}: React.ComponentProps<typeof TextInput> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[
          styles.input,
          multiline ? styles.inputMultiline : null,
          error ? styles.inputInvalid : null,
        ]}
        placeholderTextColor="#9ca3af"
        autoCapitalize="none"
        autoCorrect={false}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        {...inputProps}
      />
      {error ? (
        <Text style={styles.fieldError}>{error}</Text>
      ) : hint ? (
        <Text style={styles.fieldHint}>{hint}</Text>
      ) : null}
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
    gap: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  headerText: {
    flexShrink: 1,
    gap: 2,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
  },
  headerMeta: {
    fontSize: 13,
    color: "#9ca3af",
  },
  /** 44pt/48dp minimum: Apple's and Android's floor for a target you must be able to hit. */
  closeButton: {
    minWidth: 72,
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 22,
  },
  closeButtonText: {
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
    paddingTop: 20,
    paddingBottom: 20,
    gap: 16,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: "#111827",
    backgroundColor: "#ffffff",
  },
  inputMultiline: {
    minHeight: 96,
    lineHeight: 22,
  },
  inputInvalid: {
    borderColor: "#dc2626",
  },
  fieldError: {
    fontSize: 13,
    color: "#dc2626",
  },
  fieldHint: {
    fontSize: 13,
    color: "#6b7280",
  },
  hint: {
    fontSize: 13,
    color: "#6b7280",
    marginTop: -8,
  },
  durationRow: {
    flexDirection: "row",
    gap: 12,
  },
  durationField: {
    flex: 1,
  },
  footer: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 16,
  },
  cancel: {
    minWidth: 96,
    minHeight: 52,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
  },
  cancelText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
  },
  save: {
    flex: 1,
    minHeight: 52,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#208AEF",
  },
  saveInactive: {
    backgroundColor: "#9cc7f0",
  },
  savePressed: {
    backgroundColor: "#1a6fbf",
  },
  saveText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
