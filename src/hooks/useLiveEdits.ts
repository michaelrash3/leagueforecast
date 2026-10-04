import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { memberToken } from "../lib/cloud/cloudSession";
import type { PoolCommand } from "../lib/live/commands";
import { callEdit, callQuery, callWarm, type CallDeps } from "../lib/live/editClient";
import {
  EDIT_REFUSED,
  pendingOf,
  QUERY_REFUSED,
  settledBy,
  WARM_AFTER_MS,
  type PendingEdit,
} from "../lib/live/liveEdits";
import type { AnswerOf, QueryKind, QueryOf } from "../lib/live/queries";
import type { ToastTone } from "./useToast";

/** The page's toast, as App hands it down. */
export type ShowToast = (
  message: string,
  options?: { tone?: ToastTone; actionLabel?: string; onAction?: () => void; durationMs?: number }
) => void;

/**
 * What the person is told once an edit is made, whether its toast offers to take it back, and what
 * the screen does once it has been taken back (asks again for what the undo changed).
 */
export type EditSaid = { done: string; undo?: boolean; afterUndo?: () => void };

export type LiveEdits = {
  /** Why edits are off now, as the person is told, or null when they can be sent. */
  locked: string | null;
  /** Edits made that the views on screen may not show yet, oldest first (`overlayCard`). */
  pending: readonly PendingEdit[];
  /** Sends `command`; whether the server made it. Every answer is said in a toast. */
  edit: (command: PoolCommand, said: EditSaid) => Promise<boolean>;
  /** Asks the server a question about the copy; its answer, or null once a toast has said why not. */
  ask: <K extends QueryKind>(query: QueryOf<K>) => Promise<AnswerOf<K> | null>;
  /** Brings the server's pool up ahead of an edit, unless a call has done so lately. */
  warm: () => void;
  /** Says why an edit was not sent, as every refusal here is said. */
  say: (message: string) => void;
};

const NO_COPY = "Editing waits for the cloud's board to come in.";

/**
 * A member's edits from the live page (1.5), sent to the edit function as commands against the copy
 * the views on screen are of (`copy`, the meta's). Each answer is said in a toast: the edit made,
 * with an Undo that sends its inverse where `said.undo` asks for one; or why it was not, in plain
 * words (`EDIT_REFUSED`, or the call's own message, which says an edit may or may not have been made
 * wherever the server did not prove it was not). An edit made is kept in `pending` until views of a
 * version at least its save's are published, or views of another copy, so the page can draw it over
 * what it reads meanwhile (`pendingOf`, `settledBy`).
 *
 * Nothing is sent while `locked`: offline, or before the network has answered for the board. A
 * warm-up is sent as an edit screen opens, at most once in `WARM_AFTER_MS` of calls, since the
 * server's pool stays warm between them.
 */
export function useLiveEdits({
  copy,
  locked,
  showToast,
  deps,
  now = Date.now,
}: {
  copy: { id: string; version: number } | null;
  locked: string | null;
  showToast: ShowToast;
  /** The call's sign-in and transport; the member's own by default. */
  deps?: CallDeps;
  now?: () => number;
}): LiveEdits {
  // Every edit made that the views may not show, pruned as each new one is made.
  const [made, setMade] = useState<PendingEdit[]>([]);
  // The copy the views are of as it is now, for an answer that comes back after it moved.
  const current = useRef(copy);
  const lastCall = useRef<number | null>(null);
  const callDeps = useMemo<CallDeps>(() => deps ?? { token: memberToken }, [deps]);

  /*
   * Kept before any effect runs, not in one: the network's first answer brings the copy and turns
   * edits on in a single render, and the cards below ask in their own effects, which run before
   * this page's. Held in an effect, the copy was still the one before it, and the first question
   * of a Setup opened straight from a link was refused for want of one.
   */
  useLayoutEffect(() => {
    current.current = copy;
  }, [copy]);
  const pending = useMemo(
    () => (copy ? made.filter((one) => !settledBy(one, copy)) : made),
    [made, copy]
  );

  const edit = useCallback(
    (first: PoolCommand, firstSaid: EditSaid): Promise<boolean> => {
      // Its own Undo is an edit too, sent the same way.
      async function send(command: PoolCommand, said: EditSaid): Promise<boolean> {
        const against = current.current;
        if (locked || !against) {
          showToast(locked ?? NO_COPY, { tone: "error" });
          return false;
        }
        lastCall.current = now();
        const called = await callEdit({ command, copy: against.id }, callDeps);
        if (!called.ok) {
          showToast(called.message, { tone: "error" });
          return false;
        }
        const reply = called.value;
        if (!reply.ok) {
          showToast(EDIT_REFUSED[reply.why], { tone: "error" });
          return false;
        }
        const shown = pendingOf(command, reply);
        // Drawn until the views show it (`pending`); those they already show are let go here.
        if (shown)
          setMade((held) => {
            const seen = current.current;
            return [...(seen ? held.filter((one) => !settledBy(one, seen)) : held), shown];
          });
        showToast(
          said.done,
          said.undo
            ? {
                tone: "undo",
                actionLabel: "Undo",
                onAction: () =>
                  void send(reply.inverse, { done: "Undone." }).then((undone) => {
                    if (undone) said.afterUndo?.();
                  }),
              }
            : { tone: "success" }
        );
        return true;
      }
      return send(first, firstSaid);
    },
    [locked, showToast, callDeps, now]
  );

  const ask = useCallback(
    async <K extends QueryKind>(query: QueryOf<K>): Promise<AnswerOf<K> | null> => {
      const against = current.current;
      if (locked || !against) {
        showToast(locked ?? NO_COPY, { tone: "error" });
        return null;
      }
      lastCall.current = now();
      const called = await callQuery<K>({ query, copy: against.id }, callDeps);
      if (!called.ok) {
        showToast(called.message, { tone: "error" });
        return null;
      }
      const reply = called.value;
      if (!reply.ok) {
        showToast(QUERY_REFUSED[reply.why], { tone: "error" });
        return null;
      }
      return reply.answer;
    },
    [locked, showToast, callDeps, now]
  );

  const warm = useCallback(() => {
    if (locked || !current.current) return;
    const at = now();
    if (lastCall.current !== null && at - lastCall.current < WARM_AFTER_MS) return;
    lastCall.current = at;
    // Nothing rides on a warm-up: the next edit brings the pool up itself.
    void callWarm(callDeps);
  }, [locked, callDeps, now]);

  const say = useCallback((message: string) => showToast(message, { tone: "error" }), [showToast]);

  return { locked, pending, edit, ask, warm, say };
}
