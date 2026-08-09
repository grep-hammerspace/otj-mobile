import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { HealthCheck } from "../../components/health-check";
import { logout } from "../../lib/auth-api";
import { useAuth } from "../../lib/auth";

/** Req 2 — the big text box. Placeholder until backend step 05 lands the notes endpoints. */
export default function Log() {
  const { signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const onSignOut = async () => {
    setSigningOut(true);
    // Revoke server-side first, then drop the local token — but `logout` swallows its own
    // failures, so a user offline still ends up signed out.
    await logout();
    await signOut();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Log</Text>
      <HealthCheck />
      <Pressable
        accessibilityRole="button"
        onPress={onSignOut}
        disabled={signingOut}
        style={({ pressed }) => [styles.signOut, pressed ? styles.signOutPressed : null]}
      >
        <Text style={styles.signOutText}>{signingOut ? "Signing out…" : "Sign out"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
  },
  signOut: {
    marginTop: 24,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  signOutPressed: {
    opacity: 0.6,
  },
  signOutText: {
    color: "#dc2626",
    fontSize: 15,
    fontWeight: "600",
  },
});
