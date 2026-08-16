import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CredentialsSheet } from "../../components/credentials-sheet";
import { ResultBanner } from "../../components/result-banner";
import { ApiError } from "../../lib/api";
import { confirmIdentity } from "../../lib/biometric";
import {
  clearCredentials,
  getCredentials,
  getDriverChoice,
  saveCredentials,
  setDriverChoice,
  type DriverChoice,
  type OaCredentials,
} from "../../lib/oa-credentials";
import { formatTotalMinutes, getPending, pendingKey } from "../../lib/pending-api";
import { getProfile, profileKey, updateLearnerId, type Profile } from "../../lib/profile-api";
import {
  completeAzure,
  describeOutcome,
  prepareAzure,
  prepareBrowser,
  submitWithMfa,
  type SubmitOutcome,
} from "../../lib/submit-api";

/**
 * Req 4 — the screen that actually pushes the queue to OneAdvanced.
 *
 * <p>Everything else in this app writes to the backend's own database. This is the one place that
 * logs in as the user, to their real institutional account, and that shapes the whole screen: the
 * credentials live on the device and are typed in a sheet of their own, a biometric check stands in
 * front of the run, and the MFA step the login lands on is shown as the step it is rather than
 * hidden behind a spinner.
 *
 * <p>The two routes differ in where the second factor is answered — on the phone's push for Azure,
 * in a field here for OneAdvanced's own login — so the screen has two shapes below the button, and
 * `phase` is what says which.
 *
 * <p>The learner ID sits here too, even though it is account data rather than a submit setting.
 * It is typed once at signup and never shown again, so a typo in it is invisible until OneAdvanced
 * rejects the rows — and this is the screen the user is on when that happens.
 */

/**
 * Where a submit run has got to. One value rather than a handful of booleans, because the states
 * are genuinely exclusive: nothing here can be both waiting for a push and waiting for a code.
 */
type Phase =
  | { name: "idle" }
  /** Logging in — before the server knows whether MFA is even needed. */
  | { name: "preparing" }
  /** Azure: the push is out. `challengeNumber` is the number to tap, when there is one. */
  | { name: "awaitingApproval"; challengeNumber: number | null; message: string }
  /** OneAdvanced: parked at the TOTP field, waiting for a code from this screen. */
  | { name: "awaitingCode" }
  /** The second call is in flight: finishing the login and posting the rows. */
  | { name: "submitting" }
  | { name: "done"; outcome: SubmitOutcome };

export default function Submit() {
  const queryClient = useQueryClient();

  // `undefined` while the secure store is being read — the same three-state shape `useAuth` uses,
  // so the screen can tell "no credentials saved" from "haven't looked yet" and not flash the
  // set-up prompt at someone who is already set up.
  const [creds, setCreds] = useState<OaCredentials | null | undefined>(undefined);
  const [driver, setDriver] = useState<DriverChoice>("azure");

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);

  /** The draft learner ID while the card is open for editing, or null while it is just displaying. */
  const [learnerDraft, setLearnerDraft] = useState<string | null>(null);
  const [learnerError, setLearnerError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getCredentials(), getDriverChoice()]).then(([stored, choice]) => {
      setCreds(stored);
      setDriver(choice);
    });
  }, []);

  /**
   * What is queued, for the button's subtitle. Borrowed from the Pending tab's cache under the
   * same key, so switching tabs does not refetch. Failures are ignored on purpose: not knowing the
   * count is no reason to block a submit, and the Pending tab is where a broken queue gets reported.
   */
  const queued = useQuery({ queryKey: pendingKey, queryFn: getPending });

  /**
   * The account, for the learner ID. Its failure *is* reported, unlike `queued`'s: the card would
   * otherwise show an empty box that looks like an unset learner ID, and someone would retype a
   * value that was already correct.
   */
  const profile = useQuery({ queryKey: profileKey, queryFn: getProfile });

  /**
   * Lives on the screen rather than inside the card so a slow save cannot be abandoned halfway by
   * the card closing — the same reason the Pending tab holds its edit mutation outside the sheet.
   */
  const saveLearner = useMutation({
    mutationFn: updateLearnerId,
    onSuccess: (updated) => {
      // Written straight into the cache rather than waiting on the refetch, so the card shows the
      // new value as it collapses instead of flashing the old one.
      queryClient.setQueryData<Profile>(profileKey, updated);
      setLearnerDraft(null);
      setLearnerError(null);
    },
    onError: (e) =>
      setLearnerError(e instanceof Error ? e.message : "Could not save your learner ID."),
    onSettled: () => queryClient.invalidateQueries({ queryKey: profileKey }),
  });

  const running =
    phase.name === "preparing" || phase.name === "awaitingApproval" || phase.name === "submitting";

  const finish = (outcome: SubmitOutcome) => {
    setPhase({ name: "done", outcome });
    // Whatever went, went — the rows are now marked posted server-side and must leave the queue.
    // Invalidated even for `nothing` and `failed`: those are exactly the cases where the local idea
    // of the queue is most likely to be the stale one.
    queryClient.invalidateQueries({ queryKey: pendingKey });
  };

  const fail = (e: unknown, next: Phase = { name: "idle" }) => {
    setError(e instanceof Error ? e.message : "Could not submit your activities.");
    setPhase(next);
  };

  /**
   * Signs in and, for Azure, waits out the approval in the same pass.
   *
   * <p>Credentials are checked here as well as in the sheet that writes them: this is the call that
   * would otherwise send a blank password to a real login page, and the store is not the only way
   * into this function.
   */
  const startRun = async () => {
    setError(null);
    setCodeError(null);

    if (!creds || !creds.username.trim() || !creds.password) {
      setError("Add your OneAdvanced login details first.");
      setSheetOpen(true);
      return;
    }

    // Set before the gate, not after, so the button is disabled for the whole run. On a phone with
    // no biometrics enrolled the check returns instantly, and the gap would be wide enough for a
    // second tap to start a second login — nothing in this system deduplicates.
    setPhase({ name: "preparing" });

    // Before the password leaves the keychain, not after. A phone left unlocked on a desk is the
    // case this exists for, and it costs a glance when it does not apply.
    const gate = await confirmIdentity("Confirm it's you before signing in to OneAdvanced");
    if (!gate.ok) {
      setError(gate.reason);
      setPhase({ name: "idle" });
      return;
    }

    try {
      if (driver === "azure") {
        const prepared = await prepareAzure(creds);
        setPhase(
          prepared.status === "push_sent"
            ? {
                name: "awaitingApproval",
                challengeNumber: prepared.challengeNumber ?? null,
                message: prepared.message,
              }
            : // An existing SSO session already finished the login, so there is nothing to approve
              // and nothing to show — but the queue still has to be posted, and `complete` is what
              // posts it.
              { name: "submitting" },
        );
        finish(await completeAzure());
      } else {
        await prepareBrowser(creds);
        setMfaCode("");
        setPhase({ name: "awaitingCode" });
      }
    } catch (e) {
      fail(e);
    }
  };

  /** The OneAdvanced route's second half: the code the user just read off their authenticator. */
  const sendCode = async () => {
    const code = mfaCode.trim();
    if (!code) {
      setCodeError("Enter the 6-digit code from your authenticator app.");
      return;
    }

    setCodeError(null);
    setError(null);
    setPhase({ name: "submitting" });
    try {
      finish(await submitWithMfa(code));
    } catch (e) {
      // A rejected code is a 400, and the login is still parked at the OTP field server-side — so
      // go back to the field rather than to the start. Codes expire in about 30 s, which makes
      // "type the next one" the normal recovery rather than an unlucky one. Anything else means the
      // session is gone and the run has to start again.
      const retryable = e instanceof ApiError && e.status === 400;
      fail(e, retryable ? { name: "awaitingCode" } : { name: "idle" });
    }
  };

  const chooseDriver = (choice: DriverChoice) => {
    setDriver(choice);
    // Remembering the choice is a convenience, so a storage failure is not worth a message: the
    // selection still holds for this session, it just will not survive a restart.
    setDriverChoice(choice).catch(() => {});
    // A half-finished run belongs to the route that started it: the server holds one driver per
    // user, so a code typed after a switch would be answered by the wrong login.
    setPhase({ name: "idle" });
    setError(null);
    setCodeError(null);
  };

  const onSaveCreds = async (next: OaCredentials) => {
    setSheetBusy(true);
    setSheetError(null);
    try {
      await saveCredentials(next);
      setCreds(next);
      setSheetOpen(false);
      // Details that just changed make the last run's verdict meaningless — most likely they were
      // changed *because* of it.
      setPhase({ name: "idle" });
      setError(null);
    } catch {
      setSheetError("Could not save to this phone's secure storage.");
    } finally {
      setSheetBusy(false);
    }
  };

  const onForgetCreds = async () => {
    setSheetBusy(true);
    setSheetError(null);
    try {
      await clearCredentials();
      setCreds(null);
      setSheetOpen(false);
      setPhase({ name: "idle" });
    } catch {
      setSheetError("Could not clear this phone's secure storage.");
    } finally {
      setSheetBusy(false);
    }
  };

  const openLearnerEditor = () => {
    saveLearner.reset();
    setLearnerError(null);
    setLearnerDraft(profile.data?.learnerId ?? "");
  };

  const cancelLearnerEditor = () => {
    setLearnerDraft(null);
    setLearnerError(null);
  };

  const commitLearnerId = () => {
    const next = (learnerDraft ?? "").trim();
    if (!next) {
      setLearnerError("Enter your learner ID.");
      return;
    }
    // Nothing to send, so don't send it — a no-op PATCH would still refetch and still be a chance
    // for the request to fail, and "save" on an unchanged field should just close the card.
    if (next === profile.data?.learnerId) {
      cancelLearnerEditor();
      return;
    }
    saveLearner.mutate(next);
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Submit to OneAdvanced</Text>
        <Text style={styles.subtitle}>
          Signs in as you and posts everything in Pending. You&apos;ll need your phone for the
          second step.
        </Text>

        <Text style={styles.sectionLabel}>How you sign in</Text>
        <View style={styles.choices}>
          <DriverChoiceButton
            title="Microsoft"
            detail="Approve a push in Authenticator"
            selected={driver === "azure"}
            disabled={running}
            onPress={() => chooseDriver("azure")}
          />
          <DriverChoiceButton
            title="OneAdvanced"
            detail="Type a code from your app"
            selected={driver === "otj"}
            disabled={running}
            onPress={() => chooseDriver("otj")}
          />
        </View>

        <Text style={styles.sectionLabel}>Login details</Text>
        <View style={styles.credsCard}>
          <View style={styles.credsText}>
            {creds === undefined ? (
              <Text style={styles.credsPlaceholder}>Checking this phone…</Text>
            ) : creds ? (
              <>
                <Text style={styles.credsUser} numberOfLines={1}>
                  {creds.username}
                </Text>
                {/* A fixed number of dots, not the password's length — the length of a password is
                    the one thing about it worth not putting on a screen. */}
                <Text style={styles.credsMask}>•••••••••••</Text>
              </>
            ) : (
              <>
                <Text style={styles.credsUser}>No login details saved</Text>
                <Text style={styles.credsPlaceholder}>Needed before anything can be submitted</Text>
              </>
            )}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={creds ? "Edit login details" : "Add login details"}
            onPress={() => {
              setSheetError(null);
              setSheetOpen(true);
            }}
            disabled={running || creds === undefined}
            style={({ pressed }) => [
              styles.credsButton,
              pressed ? styles.pressed : null,
              running || creds === undefined ? styles.credsButtonInactive : null,
            ]}
          >
            <Text style={styles.credsButtonText}>{creds ? "Edit" : "Add"}</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>Learner ID</Text>
        <LearnerIdCard
          profile={profile.data}
          loading={profile.isPending}
          loadError={profile.isError}
          draft={learnerDraft}
          error={learnerError}
          busy={saveLearner.isPending}
          queuedCount={queued.data?.count ?? 0}
          onEdit={openLearnerEditor}
          onChangeDraft={(text) => {
            setLearnerDraft(text);
            if (learnerError) setLearnerError(null);
          }}
          onCancel={cancelLearnerEditor}
          onSave={commitLearnerId}
          onRetry={() => profile.refetch()}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Submit queued activities to OneAdvanced"
          accessibilityState={{ disabled: running || !creds, busy: running }}
          onPress={startRun}
          disabled={running || !creds}
          style={({ pressed }) => [
            styles.submitButton,
            running || !creds ? styles.submitButtonInactive : null,
            pressed && !running && creds ? styles.submitButtonPressed : null,
          ]}
        >
          <Text style={styles.submitButtonText}>
            {running ? "Submitting…" : "Submit queued activities"}
          </Text>
          {queued.data && !running ? (
            <Text style={styles.submitButtonMeta}>
              {queued.data.count === 0
                ? "Nothing queued right now"
                : `${queued.data.count} ${
                    queued.data.count === 1 ? "activity" : "activities"
                  } · ${formatTotalMinutes(queued.data.totalMinutes)}`}
            </Text>
          ) : null}
        </Pressable>

        {error ? <ResultBanner tone="error" title="Submission stopped" detail={error} /> : null}

        <PhasePanel
          phase={phase}
          mfaCode={mfaCode}
          codeError={codeError}
          onChangeCode={(text) => {
            setMfaCode(text);
            if (codeError) setCodeError(null);
          }}
          onSendCode={sendCode}
        />
      </ScrollView>

      <CredentialsSheet
        visible={sheetOpen}
        current={creds ?? null}
        onClose={() => setSheetOpen(false)}
        onSave={onSaveCreds}
        onForget={onForgetCreds}
        busy={sheetBusy}
        error={sheetError}
      />
    </View>
  );
}

/** One of the two login routes. Selected state is carried by colour *and* by the checkmark. */
function DriverChoiceButton({
  title,
  detail,
  selected,
  disabled,
  onPress,
}: {
  title: string;
  detail: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`${title}. ${detail}`}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.choice,
        selected ? styles.choiceSelected : null,
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.choiceDisabled : null,
      ]}
    >
      <Text style={[styles.choiceTitle, selected ? styles.choiceTitleSelected : null]}>
        {selected ? "✓ " : ""}
        {title}
      </Text>
      <Text style={styles.choiceDetail}>{detail}</Text>
    </Pressable>
  );
}

/**
 * The learner ID, and the one place it can be corrected after signup.
 *
 * <p>Edits inline rather than in a `Modal` like `CredentialsSheet`: one short field does not earn a
 * sheet, and staying on the screen keeps the "already queued" warning visible while it is being
 * changed — that warning is the whole reason the correction is not just a text box.
 *
 * <p>`draft === null` is the display state; a string, including `""`, means the field is open. That
 * distinction matters because clearing the field is a thing a user does on the way to retyping,
 * and it must not collapse the card.
 */
function LearnerIdCard({
  profile,
  loading,
  loadError,
  draft,
  error,
  busy,
  queuedCount,
  onEdit,
  onChangeDraft,
  onCancel,
  onSave,
  onRetry,
}: {
  profile: Profile | undefined;
  loading: boolean;
  loadError: boolean;
  draft: string | null;
  error: string | null;
  busy: boolean;
  queuedCount: number;
  onEdit: () => void;
  onChangeDraft: (text: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <View style={styles.credsCard}>
        <View style={styles.credsText}>
          <Text style={styles.credsPlaceholder}>Checking your account…</Text>
        </View>
      </View>
    );
  }

  // Not silently blank: an empty-looking card reads as "no learner ID set" and invites someone to
  // retype a value that is fine. Offer the retry instead.
  if (loadError || !profile) {
    return (
      <View style={styles.credsCard}>
        <View style={styles.credsText}>
          <Text style={styles.credsUser}>Learner ID unavailable</Text>
          <Text style={styles.credsPlaceholder}>Could not read it from the server.</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading your learner ID"
          onPress={onRetry}
          style={({ pressed }) => [styles.credsButton, pressed ? styles.pressed : null]}
        >
          <Text style={styles.credsButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (draft === null) {
    return (
      <View style={styles.credsCard}>
        <View style={styles.credsText}>
          <Text style={styles.credsUser} numberOfLines={1}>
            {profile.learnerId}
          </Text>
          <Text style={styles.credsPlaceholder}>Sent with every activity you log</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change your learner ID"
          onPress={onEdit}
          style={({ pressed }) => [styles.credsButton, pressed ? styles.pressed : null]}
        >
          <Text style={styles.credsButtonText}>Change</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.learnerEditor}>
      <TextInput
        style={[styles.learnerInput, error ? styles.codeInputInvalid : null]}
        value={draft}
        onChangeText={onChangeDraft}
        placeholder="Your OneAdvanced learner ID"
        placeholderTextColor="#9ca3af"
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus
        editable={!busy}
        returnKeyType="done"
        onSubmitEditing={onSave}
        accessibilityLabel="Learner ID"
      />
      {error ? <Text style={styles.codeError}>{error}</Text> : null}

      {/* The correction is copied onto rows as they are created, so it cannot reach rows that
          already exist. Said here, before the save, rather than left to be discovered when
          OneAdvanced rejects them. */}
      {queuedCount > 0 ? (
        <Text style={styles.learnerNote}>
          {queuedCount === 1 ? "The 1 activity" : `The ${queuedCount} activities`} already in Pending
          will still be sent under the old ID. Delete and re-add {queuedCount === 1 ? "it" : "them"}{" "}
          if that matters.
        </Text>
      ) : null}

      <View style={styles.learnerActions}>
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          disabled={busy}
          style={({ pressed }) => [
            styles.credsButton,
            styles.learnerAction,
            pressed ? styles.pressed : null,
            busy ? styles.credsButtonInactive : null,
          ]}
        >
          <Text style={styles.credsButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy, busy }}
          onPress={onSave}
          disabled={busy}
          style={({ pressed }) => [
            styles.codeButton,
            styles.learnerAction,
            pressed && !busy ? styles.codeButtonPressed : null,
            busy ? styles.credsButtonInactive : null,
          ]}
        >
          <Text style={styles.codeButtonText}>{busy ? "Saving…" : "Save"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Everything below the button that depends on how far the run has got. */
function PhasePanel({
  phase,
  mfaCode,
  codeError,
  onChangeCode,
  onSendCode,
}: {
  phase: Phase;
  mfaCode: string;
  codeError: string | null;
  onChangeCode: (text: string) => void;
  onSendCode: () => void;
}) {
  switch (phase.name) {
    case "idle":
      return null;

    case "preparing":
      return <Waiting label="Signing in to OneAdvanced…" />;

    case "submitting":
      return <Waiting label="Signed in. Sending your activities…" />;

    case "awaitingApproval":
      return (
        <View style={styles.panel}>
          {phase.challengeNumber !== null ? (
            <>
              <Text style={styles.panelTitle}>Tap this number in Microsoft Authenticator</Text>
              {/* The whole reason this screen shows a phase at all: the number is on the laptop
                  side of a number-matching prompt, and the app cannot proceed without the user
                  reading it. Sized to be legible at arm's length, on the phone in their hand. */}
              <Text
                accessibilityRole="text"
                accessibilityLabel={`Challenge number ${phase.challengeNumber}`}
                style={styles.challenge}
              >
                {phase.challengeNumber}
              </Text>
            </>
          ) : (
            <Text style={styles.panelTitle}>{phase.message}</Text>
          )}
          <Waiting label="Waiting for your approval — up to two minutes." />
        </View>
      );

    case "awaitingCode":
      return (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Enter your authenticator code</Text>
          <Text style={styles.panelBody}>
            Signed in as far as the code prompt. Codes last about 30 seconds, so use the one showing
            now.
          </Text>
          <TextInput
            style={[styles.codeInput, codeError ? styles.codeInputInvalid : null]}
            value={mfaCode}
            onChangeText={onChangeCode}
            placeholder="000000"
            placeholderTextColor="#9ca3af"
            keyboardType="number-pad"
            autoFocus
            // One-time codes are the one thing worth letting the OS autofill from the keyboard bar.
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={8}
            accessibilityLabel="Authenticator code"
          />
          {codeError ? <Text style={styles.codeError}>{codeError}</Text> : null}
          <Pressable
            accessibilityRole="button"
            onPress={onSendCode}
            style={({ pressed }) => [styles.codeButton, pressed ? styles.codeButtonPressed : null]}
          >
            <Text style={styles.codeButtonText}>Submit code</Text>
          </Pressable>
        </View>
      );

    case "done": {
      const { outcome } = phase;
      const tone =
        outcome.kind === "posted" ? "success" : outcome.kind === "failed" ? "error" : "warning";
      const title =
        outcome.kind === "posted"
          ? "Submitted"
          : outcome.kind === "partial"
            ? "Partly submitted"
            : outcome.kind === "nothing"
              ? "Nothing to send"
              : "Not submitted";
      return <ResultBanner tone={tone} title={title} detail={describeOutcome(outcome)} />;
    }
  }
}

function Waiting({ label }: { label: string }) {
  return (
    <View style={styles.waiting} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator />
      <Text style={styles.waitingText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  content: {
    padding: 24,
    paddingTop: 32,
    gap: 12,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "#111827",
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    color: "#6b7280",
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 8,
  },
  choices: {
    flexDirection: "row",
    gap: 10,
  },
  choice: {
    flex: 1,
    minHeight: 72,
    justifyContent: "center",
    gap: 3,
    padding: 12,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    backgroundColor: "#ffffff",
  },
  choiceSelected: {
    borderColor: "#208AEF",
    borderWidth: 2,
    backgroundColor: "#f0f7fe",
  },
  choiceDisabled: {
    opacity: 0.5,
  },
  choiceTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#374151",
  },
  choiceTitleSelected: {
    color: "#1a6fbf",
  },
  choiceDetail: {
    fontSize: 12,
    lineHeight: 16,
    color: "#6b7280",
  },
  credsCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    backgroundColor: "#ffffff",
  },
  credsText: {
    flex: 1,
    gap: 2,
  },
  credsUser: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  credsMask: {
    fontSize: 14,
    color: "#9ca3af",
    letterSpacing: 2,
  },
  credsPlaceholder: {
    fontSize: 13,
    color: "#6b7280",
  },
  credsButton: {
    minWidth: 72,
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 22,
  },
  credsButtonInactive: {
    opacity: 0.5,
  },
  credsButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#208AEF",
  },
  pressed: {
    opacity: 0.6,
  },
  learnerEditor: {
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    backgroundColor: "#ffffff",
  },
  learnerInput: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: "#111827",
    backgroundColor: "#ffffff",
  },
  learnerNote: {
    fontSize: 13,
    lineHeight: 18,
    color: "#92400e",
  },
  learnerActions: {
    flexDirection: "row",
    gap: 10,
  },
  learnerAction: {
    flex: 1,
    minHeight: 48,
  },
  submitButton: {
    marginTop: 12,
    backgroundColor: "#208AEF",
    borderRadius: 14,
    paddingVertical: 22,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  submitButtonInactive: {
    backgroundColor: "#9cc7f0",
  },
  submitButtonPressed: {
    backgroundColor: "#1a6fbf",
  },
  submitButtonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
  },
  submitButtonMeta: {
    color: "#e0effc",
    fontSize: 13,
  },
  panel: {
    gap: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    backgroundColor: "#f9fafb",
  },
  panelTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },
  panelBody: {
    fontSize: 14,
    lineHeight: 20,
    color: "#6b7280",
  },
  challenge: {
    fontSize: 56,
    fontWeight: "800",
    letterSpacing: 4,
    textAlign: "center",
    color: "#208AEF",
    paddingVertical: 8,
  },
  waiting: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  waitingText: {
    flexShrink: 1,
    fontSize: 14,
    color: "#6b7280",
  },
  codeInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 24,
    letterSpacing: 6,
    textAlign: "center",
    color: "#111827",
    backgroundColor: "#ffffff",
  },
  codeInputInvalid: {
    borderColor: "#dc2626",
  },
  codeError: {
    fontSize: 13,
    color: "#dc2626",
  },
  codeButton: {
    minHeight: 52,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#208AEF",
  },
  codeButtonPressed: {
    backgroundColor: "#1a6fbf",
  },
  codeButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
