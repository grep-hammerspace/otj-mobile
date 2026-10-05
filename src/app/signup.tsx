import { Link } from "expo-router";
import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CredentialForm, type CredentialFormHandle } from "../components/credential-form";
import { Field, FormError, styles, SubmitButton } from "../components/form";
import { ApiError } from "../lib/api";
import { signup } from "../lib/auth-api";
import { useAuth } from "../lib/auth";
import { checkSelfHostedServer, parseTailnetUrl } from "../lib/server";

type Errors = Partial<Record<"inviteCode" | "username" | "password" | "learnerId", string>>;

/**
 * Account creation. Shown only when the secure store holds no token.
 *
 * <p>Signup is invite-gated: codes are minted through the admin API (tailnet-only) and handed out
 * one per person. The server claims the code atomically before creating the account, so a code
 * that raced someone else comes back rejected rather than half-applied.
 *
 * <p>Below the form, someone running their own backend connects to it instead of signing up.
 */
export default function Signup() {
  const { signIn, connectSelfHosted } = useAuth();

  const [inviteCode, setInviteCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [learnerId, setLearnerId] = useState("");

  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [selfHostOpen, setSelfHostOpen] = useState(false);
  const [serverUrl, setServerUrl] = useState("");
  const [serverError, setServerError] = useState<string | undefined>(undefined);
  const [connecting, setConnecting] = useState(false);

  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const learnerIdRef = useRef<TextInput>(null);
  // A real <form> on web, so the browser's password manager offers to save the new account.
  const form = useRef<CredentialFormHandle>(null);

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

  const onConnect = async () => {
    setServerError(undefined);
    const origin = parseTailnetUrl(serverUrl);
    if (!origin) {
      setServerError("Enter your server's https://….ts.net address.");
      return;
    }

    setConnecting(true);
    try {
      const check = await checkSelfHostedServer(origin);
      if (check === "unreachable") {
        setServerError("Couldn't reach that server. Check it's running and this phone is on your tailnet.");
      } else if (check === "not_self_hosted") {
        setServerError("That server isn't running in self-hosted mode.");
      } else {
        // No navigation here either: the guard swaps to the tabs.
        await connectSelfHosted(origin);
      }
    } finally {
      setConnecting(false);
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

        <CredentialForm ref={form} onSubmit={onSubmit}>
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
            // `username-new` is Android's hint for a new account; browsers know only `username`.
            autoComplete={Platform.OS === "web" ? "username" : "username-new"}
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
            onSubmitEditing={() => form.current?.submit()}
            editable={!busy}
          />
        </CredentialForm>

        <SubmitButton title="Sign up" onPress={() => form.current?.submit()} busy={busy} />

        <View style={styles.footer}>
          <Link href="/login" style={styles.footerLink}>
            Already have an account? Sign in
          </Link>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: selfHostOpen }}
          onPress={() => setSelfHostOpen((open) => !open)}
          style={styles.footer}
        >
          <Text style={[styles.footerLink, selfHostStyles.centred]}>
            Hosting the backend yourself? Enter your server base URL here
          </Text>
        </Pressable>

        {selfHostOpen ? (
          <View style={selfHostStyles.panel}>
            <Field
              label="Server base URL"
              value={serverUrl}
              onChangeText={setServerUrl}
              error={serverError}
              placeholder="https://your-machine.your-tailnet.ts.net"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              textContentType="URL"
              returnKeyType="go"
              onSubmitEditing={onConnect}
              editable={!connecting}
            />
            <SubmitButton title="Connect" onPress={onConnect} busy={connecting} disabled={busy} />
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const selfHostStyles = StyleSheet.create({
  centred: {
    textAlign: "center",
  },
  panel: {
    marginTop: 16,
  },
});
