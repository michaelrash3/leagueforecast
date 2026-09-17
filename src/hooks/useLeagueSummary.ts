import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  leagueSummarySignature,
  type LeagueSummaryErrorReason,
  type LeagueSummaryRequest,
} from "../lib/leagueSummary";
import { requestLeagueSummary } from "../lib/leagueSummaryClient";
import { readSummaryMode, type SummaryMode } from "../lib/preferences";

export type LeagueSummaryStatus = "idle" | "loading" | "ready" | "unavailable" | "error";

export type LeagueSummaryState = {
  status: LeagueSummaryStatus;
  summary: string;
  model: string;
  message: string;
  /** Why the AI story is unavailable, so the UI can say so instead of failing silently. */
  reason: LeagueSummaryErrorReason | null;
  retry: () => void;
  /**
   * Fetches a summary that is waiting to be asked for. Does nothing when they fetch themselves,
   * which is what lets a panel show one button and not think about which mode it is in.
   */
  ask: () => void;
  /** True when there is something to write about and only a press is missing. */
  waiting: boolean;
};

/**
 * Entering a day's results moves the standings on every saved score, and each
 * move is a different story to write. Letting the standings settle first
 * collapses that burst into one request, which is what keeps ordinary
 * scorekeeping under both this app's own per-browser throttle and Gemini's
 * quota. A manual retry skips the wait.
 */
const SETTLE_DELAY_MS = 1_500;

const IDLE_STATE = {
  status: "idle" as LeagueSummaryStatus,
  summary: "",
  model: "",
  message: "",
  reason: null as LeagueSummaryErrorReason | null,
};

/**
 * Requests the Gemini-written league story for the current standings movement.
 *
 * Refetches whenever the recap facts change, cancels the in-flight request when
 * they change again, and never surfaces an error the reader has to act on — the
 * caller falls back to the deterministic story. When the endpoint reports that
 * no API key is configured, the hook latches "unavailable" for the rest of the
 * session so an undeployed or key-less environment is not polled repeatedly.
 */
export const useLeagueSummary = (
  request: LeagueSummaryRequest | null,
  {
    enabled = true,
    fetchImpl,
    mode,
  }: { enabled?: boolean; fetchImpl?: typeof fetch; mode?: SummaryMode } = {}
): LeagueSummaryState => {
  const [state, setState] = useState(IDLE_STATE);
  const [attempt, setAttempt] = useState(0);
  /**
   * Which set of facts was asked for, rather than whether anything was.
   *
   * A summary is of a particular set of facts, so picking a different team is a different write-up
   * and a fresh decision to spend a call on it. Holding the signature rather than a flag is what
   * makes that fall out on its own: the moment the content changes it stops matching, with nothing
   * to reset and no effect to reset it. A flag would need clearing when the signature moved, and
   * one press would otherwise go on fetching for every team clicked afterwards — which is the
   * behaviour being fixed.
   */
  const [askedFor, setAskedFor] = useState<string | null>(null);
  /** Latches when the endpoint says it can never answer (no key, or not deployed). */
  const unconfiguredRef = useRef(false);
  const latchedReasonRef = useRef<LeagueSummaryErrorReason | null>(null);
  const requestRef = useRef(request);
  // Held in a ref so an inline override does not retrigger the effect.
  const fetchRef = useRef(fetchImpl);
  /** Set by `retry`, so a deliberate request does not wait out the settle delay. */
  const immediateRef = useRef(false);

  // Both refs carry the newest values into the effect below without being
  // dependencies of it — a fresh but equivalent `request` object must not
  // refetch. Assigned here rather than during render because a render can be
  // discarded, which would leave the ref describing a commit that never
  // happened. Declared first so it runs before the effect that reads them.
  useEffect(() => {
    requestRef.current = request;
    fetchRef.current = fetchImpl;
  });

  // Content signature, so unrelated re-renders in the parent do not refetch.
  // Empty means there is nothing worth writing about, and no request is made.
  const signature = useMemo(() => leagueSummarySignature(request), [request]);

  /*
   * Read here rather than taken as a prop so every panel gets the same answer without four of them
   * having to thread it down. `mode` overrides it for a test.
   */
  const summaryMode = mode ?? readSummaryMode();
  const wanted = summaryMode === "auto" || (askedFor !== null && askedFor === signature);

  useEffect(() => {
    const current = requestRef.current;
    if (!enabled || !wanted || !signature || !current) {
      setState(IDLE_STATE);
      return;
    }
    // `retry` clears the latch before bumping `attempt`, so a manual retry
    // still reaches the endpoint.
    if (unconfiguredRef.current) {
      setState({
        ...IDLE_STATE,
        status: "unavailable",
        reason: latchedReasonRef.current ?? "unconfigured",
      });
      return;
    }

    const controller = new AbortController();
    let active = true;
    setState({ ...IDLE_STATE, status: "loading" });

    const send = () => {
      requestLeagueSummary(current, {
        signal: controller.signal,
        fetchImpl: fetchRef.current,
      }).then((outcome) => {
        if (!active) return;
        if (outcome.ok) {
          unconfiguredRef.current = false;
          latchedReasonRef.current = null;
          setState({
            status: "ready",
            summary: outcome.summary,
            model: outcome.model,
            message: "",
            reason: null,
          });
          return;
        }
        if (outcome.reason === "unconfigured" || outcome.reason === "endpoint-missing") {
          unconfiguredRef.current = true;
          latchedReasonRef.current = outcome.reason;
          setState({
            ...IDLE_STATE,
            status: "unavailable",
            message: outcome.message,
            reason: outcome.reason,
          });
          return;
        }
        setState({
          ...IDLE_STATE,
          status: "error",
          message: outcome.message,
          reason: outcome.reason,
        });
      });
    };

    const immediate = immediateRef.current;
    immediateRef.current = false;
    const timer = immediate ? null : setTimeout(send, SETTLE_DELAY_MS);
    if (immediate) send();

    return () => {
      active = false;
      if (timer !== null) clearTimeout(timer);
      controller.abort();
    };
  }, [signature, enabled, wanted, attempt]);

  const retry = useCallback(() => {
    unconfiguredRef.current = false;
    latchedReasonRef.current = null;
    immediateRef.current = true;
    setAttempt((value) => value + 1);
  }, []);

  const ask = useCallback(() => {
    unconfiguredRef.current = false;
    latchedReasonRef.current = null;
    immediateRef.current = true;
    setAskedFor(signature);
  }, [signature]);

  return {
    ...state,
    retry,
    ask,
    // Something to write about, nothing in the way, and only a press missing.
    waiting: Boolean(enabled && signature && !wanted),
  };
};
