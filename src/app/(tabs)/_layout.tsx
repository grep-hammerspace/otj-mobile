import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        // No tabBarIcon means React Navigation draws a "⏷" placeholder; hide the
        // icon slot entirely so the tabs are text-only.
        tabBarIconStyle: { display: "none" },
        tabBarItemStyle: {
          margin: 6,
          borderWidth: 1,
          borderColor: "#d1d5db",
          borderRadius: 8,
          // Clips the active background to the rounded border.
          overflow: "hidden",
        },
        tabBarLabelStyle: {
          fontSize: 16,
          fontWeight: "600",
          // The tab lays its children out from the top, which was fine with an
          // icon above the label; on its own the label needs centring.
          marginVertical: "auto",
        },
        tabBarActiveTintColor: "#208AEF",
        tabBarActiveBackgroundColor: "#eff6fe",
        tabBarInactiveTintColor: "#6b7280",
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Log" }} />
      <Tabs.Screen name="pending" options={{ title: "Pending" }} />
      <Tabs.Screen name="submit" options={{ title: "Submit" }} />
    </Tabs>
  );
}
