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
import { ApiError } from "../lib/api";
import { signup } from "../lib/auth-api";
import { useAuth } from "../lib/auth";

type Errors = Partial<Record<"inviteCode" | "username" | "password" | "learnerId", string>>;

/**
 * Account creation. Shown only when the secure store holds no token.
 *
 * <p>Signup is invite-gated: codes are minted through the admin API (tailnet-only) and handed out
 * one per person. The server claims the code atomically before creating the account, so a code
 * that raced someone else comes back rejected rather than half-applied.
 */
export default function Signup() {
  const { signIn } = useAuth();

  const [inviteCode, setInviteCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [learnerId, setLearnerId] = useState("");

  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const learnerIdRef = useRef<TextInput>(null);

  const validate = (): boolean => {
    const next: Errors = {};
    if (!inviteCode.trim()) next.inviteCode = "Enter the invite code you were given.";
    if (!username.trim()) next.username = "Choose a username.";
    if (!password) next.password = "Choose a password.";
    else if (password.length < 8) next.password = "Use at least 8 characters.";
    if (!learnerId.trim()) next.learnerId = "Enter your learner ID.";

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async () => {
    setFormError(null);
    if (!validate()) return;

    setBusy(true);
    try {
      const token = await signup({ inviteCode, username, password, learnerId });
      await signIn(token);
      // No navigation here: the root layout's guard swaps to the tabs once the token lands.
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setErrors({ username: "That username is already taken." });
      } else if (e instanceof ApiError && e.status === 403) {
        setErrors({ inviteCode: e.message });
      } else {
        setFormError(e instanceof Error ? e.message : "Signup failed. Please try again.");
      }
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
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.subtitle}>You&rsquo;ll need an invite code to sign up.</Text>

        <FormError message={formError} />

        <Field
          label="Invite code"
          value={inviteCode}
          onChangeText={setInviteCode}
          error={errors.inviteCode}
          placeholder="OTJ-XXXX-XXXX"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="next"
          onSubmitEditing={() => usernameRef.current?.focus()}
          editable={!busy}
        />

        <Field
          ref={usernameRef}
          label="Username"
          value={username}
          onChangeText={setUsername}
          error={errors.username}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username-new"
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
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          onSubmitEditing={() => learnerIdRef.current?.focus()}
          editable={!busy}
        />

        <Field
          ref={learnerIdRef}
          label="Learner ID"
          value={learnerId}
          onChangeText={setLearnerId}
          error={errors.learnerId}
          placeholder="Your OneAdvanced learner ID"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={onSubmit}
          editable={!busy}
        />

        <SubmitButton title="Sign up" onPress={onSubmit} busy={busy} />

        <View style={styles.footer}>
          <Link href="/login" style={styles.footerLink}>
            Already have an account? Sign in
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
