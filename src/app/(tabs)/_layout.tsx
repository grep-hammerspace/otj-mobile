import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: "Log" }} />
      <Tabs.Screen name="pending" options={{ title: "Pending" }} />
      <Tabs.Screen name="submit" options={{ title: "Submit" }} />
    </Tabs>
  );
}
