import { StyleSheet, Text, View } from "react-native";

/** Req 3 — unposted list, swipe-to-delete. Needs backend 05.5. Placeholder. */
export default function Pending() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pending</Text>
      <Text>Placeholder — unposted entries list.</Text>
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
