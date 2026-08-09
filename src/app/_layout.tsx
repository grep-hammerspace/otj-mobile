import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { AuthProvider, useAuth } from "../lib/auth";

const queryClient = new QueryClient();

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </QueryClientProvider>
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
