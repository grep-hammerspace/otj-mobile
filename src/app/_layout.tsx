import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AuthProvider, useAuth } from "../lib/auth";

const queryClient = new QueryClient();

export default function RootLayout() {
  return (
    // Outermost, and `flex: 1` — gesture-handler recognisers only fire for views underneath this,
    // which is what makes the Pending tab's swipe-to-delete work. Without the flex it collapses to
    // zero height and the whole app renders blank.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Split out from `RootLayout` because it has to sit *inside* `AuthProvider` to read the context.
 *
 * <p>Nothing navigates by hand after signing in or out — the guards below do it. A screen that
 * also called `router.replace` would race them.
 */
function RootNavigator() {
  const { token, loading } = useAuth();

  if (loading) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!token}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={!token}>
        <Stack.Screen name="signup" />
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}
