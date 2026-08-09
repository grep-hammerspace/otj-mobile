import { forwardRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

/**
 * The small set of form pieces the auth screens share. Not a UI kit — just enough to keep signup
 * and login from drifting apart, since they are the first thing anyone sees.
 */

type FieldProps = TextInputProps & {
  label: string;
  /** Shown under the input in red; also marks the input itself as invalid. */
  error?: string;
};

export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, error, style, ...inputProps },
  ref,
) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={ref}
        style={[styles.input, error ? styles.inputInvalid : null, style]}
        placeholderTextColor="#9ca3af"
        {...inputProps}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
});

export function SubmitButton({
  title,
  onPress,
  busy,
  disabled,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const inactive = busy || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        inactive ? styles.buttonInactive : null,
        pressed && !inactive ? styles.buttonPressed : null,
      ]}
    >
      {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>{title}</Text>}
    </Pressable>
  );
}

/** Whole-form failure — a rejected invite code, a wrong password, the server being unreachable. */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <View accessibilityRole="alert" style={styles.formError}>
      <Text style={styles.formErrorText}>{message}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24,
    gap: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#111827",
  },
  subtitle: {
    fontSize: 15,
    color: "#6b7280",
    marginBottom: 20,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 6,
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
    marginTop: 6,
    fontSize: 13,
    color: "#dc2626",
  },
  button: {
    marginTop: 8,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#208AEF",
    minHeight: 50,
  },
  buttonInactive: {
    backgroundColor: "#9cc7f0",
  },
  buttonPressed: {
    backgroundColor: "#1a6fbf",
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  formError: {
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  formErrorText: {
    color: "#b91c1c",
    fontSize: 14,
  },
  footer: {
    marginTop: 24,
    alignItems: "center",
  },
  footerLink: {
    color: "#208AEF",
    fontSize: 15,
    fontWeight: "600",
  },
});
