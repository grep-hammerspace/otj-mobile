import { StyleSheet, Text, View } from "react-native";
import { HealthCheck } from "../components/health-check";

/** Req 1/4 — shown only when SecureStore has no token. Placeholder for now. */
export default function Signup() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Signup</Text>
      <Text>Placeholder — built after backend steps 04–05 land.</Text>
      <HealthCheck />
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
});
