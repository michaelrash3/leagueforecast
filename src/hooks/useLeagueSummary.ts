import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  leagueSummarySignature,
  type LeagueSummaryErrorReason,
  type LeagueSummaryRequest,
} from "../lib/leagueSummary";
import { requestLeagueSummary } from "../lib/leagueSummaryClient";

export type LeagueSummaryStatus = "idle" | "loading" | "ready" | "unavailable" | "error";

export type LeagueSummaryState = {
  status: LeagueSummaryStatus;
  summary: string;
  model: string;
  message: string;
  /** Why the AI story is unavailable, so the UI can say so instead of failing silently. */
  reason: LeagueSummaryErrorReason | null;
  retry: () => void;
};

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
  { enabled = true, fetchImpl }: { enabled?: boolean; fetchImpl?: typeof fetch } = {}
): LeagueSummaryState => {
  const [state, setState] = useState(IDLE_STATE);
  const [attempt, setAttempt] = useState(0);
  /** Latches when the endpoint says it can never answer (no key, or not deployed). */
  const unconfiguredRef = useRef(false);
  const latchedReasonRef = useRef<LeagueSummaryErrorReason | null>(null);
  const requestRef = useRef(request);
  requestRef.current = request;
  // Held in a ref so an inline override does not retrigger the effect.
  const fetchRef = useRef(fetchImpl);
  fetchRef.current = fetchImpl;

  // Content signature, so unrelated re-renders in the parent do not refetch.
  // Empty means there is nothing worth writing about, and no request is made.
  const signature = useMemo(() => leagueSummarySignature(request), [request]);

  useEffect(() => {
    const current = requestRef.current;
    if (!enabled || !signature || !current) {
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

    requestLeagueSummary(current, { signal: controller.signal, fetchImpl: fetchRef.current }).then(
      (outcome) => {
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
      }
    );

    return () => {
      active = false;
      controller.abort();
    };
  }, [signature, enabled, attempt]);

  const retry = useCallback(() => {
    unconfiguredRef.current = false;
    latchedReasonRef.current = null;
    setAttempt((value) => value + 1);
  }, []);

  return { ...state, retry };
};
