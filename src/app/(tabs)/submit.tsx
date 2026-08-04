import { StyleSheet, Text, View } from "react-native";

/** MFA flow: biometric -> prepare -> challenge -> complete. Placeholder. */
export default function Submit() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Submit</Text>
      <Text>Placeholder — MFA submit flow.</Text>
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
