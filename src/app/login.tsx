import { Link } from "expo-router";
import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Field, FormError, styles, SubmitButton } from "../components/form";
import { login } from "../lib/auth-api";
import { useAuth } from "../lib/auth";

type Errors = Partial<Record<"username" | "password", string>>;

/**
 * Sign in for an account that already exists — no invite code, since the code was spent at signup.
 *
 * <p>A wrong username and a wrong password produce the same message, because the server refuses
 * to say which it was. Don't "improve" this by guessing from the status code.
 */
export default function Login() {
  const { signIn } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const passwordRef = useRef<TextInput>(null);

  const validate = (): boolean => {
    const next: Errors = {};
    if (!username.trim()) next.username = "Enter your username.";
    if (!password) next.password = "Enter your password.";

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async () => {
    setFormError(null);
    if (!validate()) return;

    setBusy(true);
    try {
      const token = await login(username, password);
      await signIn(token);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Sign in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.title}>Sign in</Text>
        <Text style={styles.subtitle}>Welcome back.</Text>

        <FormError message={formError} />

        <Field
          label="Username"
          value={username}
          onChangeText={setUsername}
          error={errors.username}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          editable={!busy}
        />

        <Field
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={setPassword}
          error={errors.password}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
          editable={!busy}
        />

        <SubmitButton title="Sign in" onPress={onSubmit} busy={busy} />

        <View style={styles.footer}>
          <Link href="/signup" style={styles.footerLink}>
            Have an invite code? Create an account
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
