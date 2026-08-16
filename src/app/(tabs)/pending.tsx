import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { ActivityEditor } from "../../components/activity-editor";
import { ResultBanner } from "../../components/result-banner";
import { formatDuration, type ActivityRow } from "../../lib/activities-api";
import { ApiError } from "../../lib/api";
import {
  deletePending,
  formatTotalMinutes,
  getPending,
  pendingKey,
  relativeTime,
  updatePending,
  type ActivityUpdate,
  type PendingResponse,
} from "../../lib/pending-api";

/**
 * Req 3 — the unposted queue: everything logged but not yet pushed to OneAdvanced.
 *
 * <p>This is where a duplicate or a misparsed line gets fixed. The server does no deduplication,
 * so "log it twice by accident" is a thing that happens; being able to delete the exact wrong row
 * is the answer to it.
 */
export default function Pending() {
  const queryClient = useQueryClient();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** The row the edit sheet is open on, or null. The sheet has no visibility flag of its own. */
  const [editing, setEditing] = useState<ActivityRow | null>(null);

  const list = useQuery({ queryKey: pendingKey, queryFn: getPending });

  /**
   * Lives here rather than inside the sheet so a save survives the sheet closing — a hung request
   * must never be able to trap someone behind a modal, which is the same call the composer makes.
   */
  const save = useMutation({
    mutationFn: ({ id, update }: { id: string; update: ActivityUpdate }) =>
      updatePending(id, update),
    onSuccess: (updated) => {
      // Patch the row in place rather than waiting for the refetch: the list redraws under the
      // closing sheet instead of a beat later. `onSettled` still reconciles with the server,
      // which owns `count` and `totalMinutes`.
      queryClient.setQueryData<PendingResponse>(pendingKey, (prev) =>
        prev
          ? {
              ...prev,
              activities: prev.activities.map((row) => (row.id === updated.id ? updated : row)),
            }
          : prev,
      );
      setEditing(null);
    },
    onError: (e) => {
      // Same reading as delete's 404: unknown id, someone else's, or posted while the sheet was
      // open. The row is not there to edit, so close and let the refetch say so.
      if (e instanceof ApiError && e.status === 404) setEditing(null);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: pendingKey }),
  });

  const openEditor = (row: ActivityRow) => {
    save.reset();
    setEditing(row);
  };

  const saveError =
    save.error && !(save.error instanceof ApiError && save.error.status === 404)
      ? save.error instanceof Error
        ? save.error.message
        : "Could not save that activity."
      : null;

  const remove = useMutation({
    mutationFn: deletePending,
    onMutate: () => setDeleteError(null),
    onError: (e) => {
      // 404 is "no unposted row with that id for you" — deleted from another device, or already
      // posted. The row is gone either way, which is what the user asked for, so the refetch in
      // `onSettled` is the whole response. Reporting it would be reporting a success as a failure.
      if (e instanceof ApiError && e.status === 404) return;
      setDeleteError(e instanceof Error ? e.message : "Could not delete that activity.");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: pendingKey }),
  });

  if (list.isPending) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator />
      </View>
    );
  }

  if (list.isError) {
    return (
      <View style={styles.centred}>
        <ResultBanner
          tone="error"
          title="Could not load your queue"
          detail={list.error instanceof Error ? list.error.message : "Something went wrong."}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => list.refetch()}
          style={({ pressed }) => [styles.retry, pressed ? styles.pressed : null]}
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const { activities, count, totalMinutes } = list.data;

  return (
    <>
      <FlatList
        data={activities}
        keyExtractor={(row) => row.id}
        contentContainerStyle={[
          styles.content,
          activities.length === 0 ? styles.contentEmpty : null,
        ]}
        refreshControl={
          <RefreshControl refreshing={list.isRefetching} onRefresh={() => list.refetch()} />
        }
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            {count > 0 ? (
              <Text style={styles.summary}>
                {count} {count === 1 ? "activity" : "activities"} ·{" "}
                <Text style={styles.summaryTotal}>{formatTotalMinutes(totalMinutes)} queued</Text>
              </Text>
            ) : null}
            {deleteError ? (
              <ResultBanner tone="error" title="Not deleted" detail={deleteError} />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing queued</Text>
            <Text style={styles.emptyBody}>
              Activities you log show up here until they are submitted to OneAdvanced. Pull down to
              refresh.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <PendingItem
            row={item}
            deleting={remove.isPending && remove.variables === item.id}
            onDelete={() => remove.mutate(item.id)}
            onEdit={() => openEditor(item)}
          />
        )}
      />

      {/* Outside the list on purpose: a modal rendered per-row would unmount mid-save when the
          invalidated list re-rendered, and `Modal` renders nothing while hidden anyway. */}
      <ActivityEditor
        row={editing}
        onClose={() => setEditing(null)}
        onSave={(update) => {
          if (editing) save.mutate({ id: editing.id, update });
        }}
        busy={save.isPending}
        error={saveError}
      />
    </>
  );
}

/**
 * One row: swipe left to reveal Delete, swipe right to edit.
 *
 * <p>The two gestures are deliberately asymmetric. Delete takes two steps — a swipe that destroyed
 * a row on release would lose it to a stray gesture, and there is no undo, because the backend
 * deletes for real. Edit takes one, because opening a sheet costs nothing and closing it changes
 * nothing; the sheet is its own confirmation.
 */
function PendingItem({
  row,
  deleting,
  onDelete,
  onEdit,
}: {
  row: ActivityRow;
  deleting: boolean;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const swipeable = useRef<SwipeableMethods>(null);
  // `activityTime` is `""` when the entry never gave a start time, so the whole "starting at"
  // clause drops rather than leaving a dangling preposition.
  const duration = formatDuration(row.hours, row.minutes);
  const meta = [
    row.activityDate,
    row.activityTime ? `${duration} starting at ${row.activityTime}` : duration,
  ].join(" · ");

  return (
    <ReanimatedSwipeable
      ref={swipeable}
      friction={2}
      leftThreshold={28}
      rightThreshold={40}
      overshootLeft={false}
      overshootRight={false}
      enabled={!deleting}
      /*
        `direction` names the side whose actions are opening, so a rightward drag reports "left".
        Acting on WillOpen rather than Open, and closing the row immediately, is what makes the
        gesture feel like it opened the sheet — the row never comes to rest in the open position.
      */
      onSwipeableWillOpen={(direction) => {
        if (direction !== "left") return;
        swipeable.current?.close();
        onEdit();
      }}
      /* Never tapped — the drag itself opens the sheet. It exists so the gesture has an
         affordance while it is in progress, and because the left side must render something for
         the rightward drag to be enabled at all. */
      renderLeftActions={() => (
        <View style={styles.editAction} pointerEvents="none">
          <Text style={styles.editActionText}>Edit</Text>
        </View>
      )}
      renderRightActions={(_progress, _translation, swipeable: SwipeableMethods) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete activity: ${row.activityImpact}`}
          onPress={() => {
            swipeable.close();
            onDelete();
          }}
          style={({ pressed }) => [styles.deleteAction, pressed ? styles.deleteActionPressed : null]}
        >
          <Text style={styles.deleteActionText}>Delete</Text>
        </Pressable>
      )}
    >
      {/*
        Both swipes are invisible to a screen reader, so both are published as accessibility
        actions. Without them the queue would be readable but neither editable nor deletable with
        VoiceOver or TalkBack on.
      */}
      <View
        accessible
        accessibilityLabel={`${row.activityImpact}. ${meta}. Added ${relativeTime(row.createdAt)}.`}
        accessibilityActions={[
          { name: "edit", label: "Edit activity" },
          { name: "delete", label: "Delete activity" },
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === "edit") onEdit();
          if (e.nativeEvent.actionName === "delete") onDelete();
        }}
        style={[styles.row, deleting ? styles.rowDeleting : null]}
      >
        <Text style={styles.rowMeta}>{meta}</Text>
        <Text style={styles.rowText}>{row.activityImpact}</Text>
        <Text style={styles.rowAdded}>added {relativeTime(row.createdAt)}</Text>
      </View>
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  centred: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 24,
  },
  content: {
    padding: 16,
    gap: 10,
  },
  contentEmpty: {
    flexGrow: 1,
  },
  headerBlock: {
    gap: 10,
  },
  summary: {
    fontSize: 14,
    color: "#6b7280",
    paddingBottom: 2,
  },
  summaryTotal: {
    fontWeight: "700",
    color: "#374151",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#374151",
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 20,
    color: "#6b7280",
    textAlign: "center",
  },
  row: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  rowDeleting: {
    opacity: 0.5,
  },
  rowMeta: {
    fontSize: 12,
    fontWeight: "700",
    color: "#208AEF",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  rowText: {
    fontSize: 15,
    lineHeight: 21,
    color: "#111827",
  },
  rowAdded: {
    fontSize: 12,
    color: "#9ca3af",
  },
  /** Mirror of `deleteAction`, in the app blue rather than red: this one is not destructive. */
  editAction: {
    width: 96,
    marginRight: 10,
    borderRadius: 10,
    backgroundColor: "#208AEF",
    alignItems: "center",
    justifyContent: "center",
  },
  editActionText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  /** Fixed width so the revealed button is the same size whatever the row's height. */
  deleteAction: {
    width: 96,
    marginLeft: 10,
    borderRadius: 10,
    backgroundColor: "#dc2626",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteActionPressed: {
    backgroundColor: "#b91c1c",
  },
  deleteActionText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  retry: {
    minHeight: 44,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 22,
  },
  retryText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#208AEF",
  },
  pressed: {
    opacity: 0.6,
  },
});
