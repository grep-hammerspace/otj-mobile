import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useToken } from "../lib/auth";

const queryClient = new QueryClient();

export default function RootLayout() {
  const { token, loading } = useToken();

  if (loading) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!!token}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Protected guard={!token}>
          <Stack.Screen name="signup" />
        </Stack.Protected>
      </Stack>
    </QueryClientProvider>
  );
}
