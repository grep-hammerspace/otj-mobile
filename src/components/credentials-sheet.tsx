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
import type { OaCredentials } from "../lib/oa-credentials";
import { ResultBanner } from "./result-banner";

/**
 * Where the OneAdvanced username and password are entered, and the only place they can be changed
 * or forgotten.
 *
 * <p>It exists as a sheet rather than fields on the Submit screen because these are typed rarely —
 * once, then again after a password change or a typo — while the button next to them is pressed
 * every week. Leaving a password box on the main screen invites typing into it out of habit.
 *
 * <p>The password is masked as it is typed, with a Show toggle: masking is right for a password
 * being entered near other people, and the toggle is what makes a 20-character institutional
 * password correctable without clearing the field and starting over. Which is the entire point of
 * being able to edit these.
 */

type SheetProps = {
  visible: boolean;
  /** What is already stored, so the sheet opens on the current username rather than empty. */
  current: OaCredentials | null;
  onClose: () => void;
  onSave: (creds: OaCredentials) => void;
  /** Only offered when something is stored — there is nothing to forget otherwise. */
  onForget: () => void;
  /** Owned by the screen: the write outlives the sheet, same as the activity editor's save. */
  busy: boolean;
  error: string | null;
};

export function CredentialsSheet({ visible, current, ...rest }: SheetProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={rest.onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      {/* The nested provider the composer and editor both need: on Android this modal is its own
          native window, and only a provider inside it measures that window's insets. */}
      <SafeAreaProvider>
        {/*
          Mounted only while open, which is what rebuilds the fields from what is actually stored
          each time. Deliberately unlike the composer, whose state sits in the shell so a close
          cannot discard half-typed entries: here a draft that survived a close would be a
          half-typed password left on screen, and retyping one is cheap.
        */}
        {visible ? <CredentialsBody current={current} {...rest} /> : null}
      </SafeAreaProvider>
    </Modal>
  );
}

/** Everything below the nested provider — a component cannot read a context it renders itself. */
function CredentialsBody({
  current,
  onClose,
  onSave,
  onForget,
  busy,
  error,
}: Omit<SheetProps, "visible">) {
  const insets = useSafeAreaInsets();
  // The username is prefilled; the password never is. Round-tripping a stored secret through a
  // text input to display it as dots gains nothing — retyping it is the confirmation that the
  // thing being saved is the thing the user meant.
  const [username, setUsername] = useState(current?.username ?? "");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [invalid, setInvalid] = useState<{ username?: string; password?: string }>({});

  const gutter = { paddingLeft: 20 + insets.left, paddingRight: 20 + insets.right };
  const headerPad = { ...gutter, paddingTop: Math.max(insets.top + 12, 16) };
  const footerPad = { ...gutter, paddingBottom: Math.max(insets.bottom + 12, 20) };

  const submit = () => {
    // Trim the username only. A password's leading or trailing space is a character the user chose,
    // and silently eating it would produce a login failure with nothing on screen to explain it.
    const cleanUsername = username.trim();
    const found = {
      username: cleanUsername ? undefined : "Enter your OneAdvanced username or email.",
      password: password ? undefined : "Enter your OneAdvanced password.",
    };
    setInvalid(found);
    if (found.username || found.password) return;

    setUsername(cleanUsername);
    onSave({ username: cleanUsername, password });
  };

  return (
    <KeyboardAvoidingView
      style={styles.sheet}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, headerPad]}>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>
            {current ? "Update login details" : "OneAdvanced login"}
          </Text>
          <Text style={styles.headerMeta}>Stored on this phone only</Text>
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

        <Text style={styles.blurb}>
          These are your real OneAdvanced credentials — the ones you use on the website, not the
          ones you use to sign in to this app. They are kept in this phone&apos;s encrypted storage
          and sent to the server only while a submission is running.
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>Username or email</Text>
          <TextInput
            style={[styles.input, invalid.username ? styles.inputInvalid : null]}
            value={username}
            onChangeText={(text) => {
              setUsername(text);
              setInvalid((prev) => (prev.username ? { ...prev, username: undefined } : prev));
            }}
            placeholder="you@se24.qmul.ac.uk"
            placeholderTextColor="#9ca3af"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            editable={!busy}
          />
          {invalid.username ? <Text style={styles.fieldError}>{invalid.username}</Text> : null}
        </View>

        <View style={styles.field}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>Password</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={reveal ? "Hide password" : "Show password"}
              onPress={() => setReveal((prev) => !prev)}
              hitSlop={12}
            >
              <Text style={styles.revealText}>{reveal ? "Hide" : "Show"}</Text>
            </Pressable>
          </View>
          <TextInput
            style={[styles.input, invalid.password ? styles.inputInvalid : null]}
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              setInvalid((prev) => (prev.password ? { ...prev, password: undefined } : prev));
            }}
            placeholder={current ? "Enter it again to replace it" : "Your OneAdvanced password"}
            placeholderTextColor="#9ca3af"
            // Masked by default. `secureTextEntry` also stops the keyboard learning the word, which
            // matters more than the dots do.
            secureTextEntry={!reveal}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            editable={!busy}
          />
          {invalid.password ? <Text style={styles.fieldError}>{invalid.password}</Text> : null}
        </View>

        {current ? (
          <Pressable
            accessibilityRole="button"
            onPress={onForget}
            disabled={busy}
            style={({ pressed }) => [styles.forget, pressed ? styles.pressed : null]}
          >
            <Text style={styles.forgetText}>Forget these details</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, footerPad]}>
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
            <Text style={styles.saveText}>{current ? "Update" : "Save"}</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
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
  /** 44pt/48dp minimum, the same floor the editor's close button uses. */
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
  blurb: {
    fontSize: 14,
    lineHeight: 20,
    color: "#6b7280",
  },
  field: {
    gap: 6,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
  },
  revealText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#208AEF",
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
  inputInvalid: {
    borderColor: "#dc2626",
  },
  fieldError: {
    fontSize: 13,
    color: "#dc2626",
  },
  forget: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
  },
  forgetText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#dc2626",
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
