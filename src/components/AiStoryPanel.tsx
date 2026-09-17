import { useState } from "react";

import type { LeagueSummaryErrorReason } from "../lib/leagueSummary";
import { describeLeagueSummaryHealth, fetchLeagueSummaryHealth } from "../lib/leagueSummaryClient";

/**
 * Short, non-alarming labels. The AI write-up is an enhancement, not a
 * requirement, but a silent fallback makes a misconfigured deploy impossible to
 * diagnose — so the header always says which state it is in.
 */
export const aiStoryUnavailableLabel = (reason: LeagueSummaryErrorReason): string => {
  switch (reason) {
    case "unconfigured":
      return "AI off — no API key";
    case "endpoint-missing":
      return "AI off — endpoint not deployed";
    case "throttled":
      return "Paused — too many retries";
    case "rate-limited":
      return "Gemini limit reached";
    case "no-model":
      return "No AI model available";
    default:
      return "AI unavailable";
  }
};

export type AiStoryPanelProps = {
  title: string;
  /** The Gemini write-up when one arrived, otherwise the deterministic text. */
  text: string;
  source: "gemini" | "local";
  model: string;
  loading: boolean;
  loadingLabel?: string;
  unavailableReason: LeagueSummaryErrorReason | null;
  errorMessage?: string;
  onRetry: () => void;
  /**
   * Set when a write-up is waiting to be asked for rather than on its way.
   *
   * These cost a call against somebody's language-model quota apiece, and they used to fetch
   * themselves — one per age group looked at, one per team picked. So by default nothing is
   * written until this is pressed.
   */
  waiting?: boolean;
  onAsk?: () => void;
};

/**
 * The AI write-up card, shared by the Standings league story and the Forecast
 * write-up so both report their state the same way.
 */
export function AiStoryPanel({
  title,
  text,
  source,
  model,
  loading,
  loadingLabel = "Writing AI analysis…",
  unavailableReason,
  errorMessage,
  onRetry,
  waiting = false,
  onAsk,
}: AiStoryPanelProps) {
  const [diagnosis, setDiagnosis] = useState("");
  const [checking, setChecking] = useState(false);

  // Asks the endpoint what is actually wrong. This runs as a fetch, so a stale
  // service worker cannot answer it with the cached app shell the way it would
  // if the URL were opened in the address bar.
  const runDiagnosis = async () => {
    setChecking(true);
    setDiagnosis("");
    try {
      setDiagnosis(describeLeagueSummaryHealth(await fetchLeagueSummaryHealth()));
    } finally {
      setChecking(false);
    }
  };

  /*
   * Waiting to be asked. Drawn rather than hidden, because the deterministic text below it is
   * worth reading on its own and the offer of a written version belongs beside it — a panel that
   * simply vanished would look like the feature was missing rather than idle.
   */
  if (waiting && onAsk && !loading) {
    return (
      <div className="mb-3 rounded-lg bg-white p-3 shadow-xs ring-1 ring-blue-100 dark:bg-slate-900 dark:ring-slate-700">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {title}
        </div>
        {text && (
          <p className="whitespace-pre-line text-sm font-semibold leading-6 text-slate-700 dark:text-slate-200">
            {text}
          </p>
        )}
        <button
          type="button"
          onClick={onAsk}
          className="mt-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-black uppercase tracking-wide text-blue-700 hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-900/60"
        >
          Write this up with AI
        </button>
        <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
          One request each. Turn them on for everything in Settings.
        </p>
      </div>
    );
  }

  if (!text && !loading) return null;

  return (
    <div className="mb-3 whitespace-pre-line rounded-lg bg-white p-3 text-sm font-semibold leading-6 text-slate-700 shadow-xs ring-1 ring-blue-100 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700">
      <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <span>{title}</span>
        {source === "gemini" && (
          <span
            className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
            title={`Written by Gemini (${model})`}
          >
            AI
          </span>
        )}
        {loading && (
          <span className="font-bold normal-case tracking-normal text-slate-400">
            {loadingLabel}
          </span>
        )}
        {!loading && unavailableReason && (
          <span
            className="rounded-full bg-slate-100 px-2 py-0.5 font-bold normal-case tracking-normal text-slate-500 dark:bg-slate-800 dark:text-slate-400"
            title={errorMessage || "The AI write-up is unavailable; showing the built-in text."}
          >
            {aiStoryUnavailableLabel(unavailableReason)}
          </span>
        )}
        {!loading && unavailableReason && (
          <button
            type="button"
            onClick={runDiagnosis}
            disabled={checking}
            className="rounded-full px-2 py-0.5 font-black uppercase tracking-wide text-slate-500 underline decoration-dotted hover:text-slate-950 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-100"
          >
            {checking ? "Checking…" : "Why?"}
          </button>
        )}
        {!loading && (source === "gemini" || unavailableReason) && (
          <button
            type="button"
            onClick={onRetry}
            className="ml-auto rounded-full px-2 py-0.5 font-black uppercase tracking-wide text-slate-500 underline decoration-dotted hover:text-slate-950 dark:text-slate-400 dark:hover:text-slate-100"
          >
            {source === "gemini" ? "Rewrite" : "Retry"}
          </button>
        )}
      </div>
      {/*
        A limit is the one unavailable state the reader can fix by waiting, and
        the chip alone does not say for how long or whose limit it is. The
        tooltip carries that sentence but a phone has no hover, so show it.
      */}
      {!diagnosis &&
        errorMessage &&
        (unavailableReason === "throttled" || unavailableReason === "rate-limited") && (
          <p className="mb-2 rounded-lg bg-slate-50 p-2 text-xs font-semibold leading-5 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-slate-700">
            {errorMessage}
          </p>
        )}
      {diagnosis && (
        <p className="mb-2 rounded-lg bg-slate-50 p-2 text-xs font-semibold leading-5 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-slate-700">
          {diagnosis}
        </p>
      )}
      {text}
    </div>
  );
}
