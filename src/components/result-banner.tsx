import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import type { ReactNode } from "react";

/**
 * The red / amber / green box that reports what the server did with a request.
 *
 * <p>Amber is not decoration: "logged 2 of 3" is neither a success nor a failure, and colouring
 * it green would tell the user their text landed when some of it didn't.
 */
export type Tone = "success" | "warning" | "error";

export function ResultBanner({
  tone,
  title,
  detail,
  children,
  style,
}: {
  tone: Tone;
  title: string;
  detail?: string | null;
  children?: ReactNode;
  style?: ViewStyle;
}) {
  const palette = tones[tone];
  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={`${title}${detail ? `. ${detail}` : ""}`}
      style={[styles.banner, { backgroundColor: palette.bg, borderColor: palette.border }, style]}
    >
      <Text style={[styles.title, { color: palette.fg }]}>{title}</Text>
      {detail ? <Text style={[styles.detail, { color: palette.fg }]}>{detail}</Text> : null}
      {children}
    </View>
  );
}

export const tones: Record<Tone, { bg: string; border: string; fg: string }> = {
  success: { bg: "#f0fdf4", border: "#bbf7d0", fg: "#15803d" },
  warning: { bg: "#fffbeb", border: "#fde68a", fg: "#b45309" },
  error: { bg: "#fef2f2", border: "#fecaca", fg: "#b91c1c" },
};

const styles = StyleSheet.create({
  banner: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
  },
  detail: {
    fontSize: 14,
    lineHeight: 20,
  },
});
