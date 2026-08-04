import { useState } from "react";
import { Button, StyleSheet, Text, View } from "react-native";
import { api } from "../lib/api";

/** Bootstrap end-to-end proof: call GET /health and show the status code. */
export function HealthCheck() {
  const [result, setResult] = useState<string>("");

  const check = async () => {
    setResult("...");
    try {
      const res = await api("/health");
      setResult(`HTTP ${res.status}`);
    } catch (e) {
      setResult(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <View style={styles.container}>
      <Button title="Check backend /health" onPress={check} />
      {result ? <Text style={styles.result}>{result}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: 12,
  },
  result: {
    fontSize: 16,
  },
});
