import { useCallback, useState } from "react";
import type { CloudStatus } from "../lib/cloud/cloudSession";
import { focusRing } from "../styles/tokens";

/** A few words for what the cloud copy is doing, or wants: the header button's label. */
export const cloudSummary = (status: CloudStatus): string => {
  switch (status.kind) {
    case "off":
      return "";
    case "none":
      return "Sign in to keep your data on every device";
    case "signed-out":
      return "Signed out of your cloud copy";
    case "connecting":
      return "Connecting to your cloud copy";
    case "working":
      return status.label.replace(/…$/, "");
    case "saved":
      if (status.newer.length > 0) return "Newer data saved from another device";
      if (status.waiting === "storage" || status.waiting === "unreadable") {
        return "Some changes cannot be saved to the cloud";
      }
      return status.owed ? "Changes waiting to save to the cloud" : "Saved to the cloud";
    case "gone":
      return "Your cloud copy is gone";
    case "not-owner":
      return "This account is not on the cloud copy's list";
    case "update":
      return "Update the app to keep saving to the cloud";
    case "error":
      return "Your cloud copy has a problem";
  }
};

type Tone = "busy" | "good" | "waiting" | "attention";

const toneOf = (status: CloudStatus): Tone | null => {
  switch (status.kind) {
    case "connecting":
    case "working":
      return "busy";
    case "saved":
      if (status.waiting === "storage" || status.waiting === "unreadable") return "attention";
      return status.owed || status.newer.length > 0 ? "waiting" : "good";
    case "signed-out":
    case "gone":
    case "not-owner":
    case "update":
    case "error":
      return "attention";
    default:
      return null;
  }
};

const DOT: Record<Tone, string> = {
  busy: "animate-pulse bg-blue-500",
  good: "bg-emerald-500",
  waiting: "bg-amber-400",
  attention: "bg-red-500",
};

/**
 * The header's cloud button: where the cloud copy stands, as a dot on a cloud, and the way into the
 * panel that says more, signing in included. Not drawn at all while the cloud is off, with no
 * Firebase project to keep a copy in. Settings offers the same panel (`SettingsView`).
 */
export function CloudButton({
  status,
  onOpen,
  className,
}: {
  status: CloudStatus;
  onOpen: () => void;
  /** Where it sits: the caller's display and size, as for the theme switch beside it. */
  className: string;
}) {
  if (status.kind === "off") return null;
  const tone = toneOf(status);
  const summary = cloudSummary(status);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${className} relative items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-800 shadow-xs hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 ${focusRing}`}
      aria-label={`Cloud copy: ${summary}`}
      title={summary}
      data-cloud={status.kind}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M7 18.5h10.5a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.35 9.3 4.6 4.6 0 0 0 7 18.5z" />
      </svg>
      {tone && (
        <span
          aria-hidden="true"
          className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-white dark:ring-slate-900 ${DOT[tone]}`}
        />
      )}
    </button>
  );
}

/** Whether the cloud panel is showing: opened by the header button, or from Settings. */
export function useCloudPanel(status: CloudStatus) {
  const [open, setOpen] = useState(false);
  const showing = status.kind !== "off" && open;
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  return { showing, show, hide };
}
