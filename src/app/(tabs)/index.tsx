import { StyleSheet, Text, View } from "react-native";
import { HealthCheck } from "../../components/health-check";

/** Req 2 — the big text box. Placeholder + health check for the bootstrap. */
export default function Log() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Log</Text>
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
