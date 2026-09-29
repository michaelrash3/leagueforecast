import { useId, useRef, type ReactNode } from "react";
import { useEscape, useFocusTrap } from "../hooks/useFocusTrap";
import {
  chooseCopy,
  loadNewer,
  retryCloud,
  saveNow,
  signInToCloud,
  signOutOfCloud,
  type CloudStatus,
} from "../lib/cloud/cloudSession";
import { button } from "../styles/tokens";

export type CloudActions = {
  signIn: () => void;
  save: () => void;
  signOut: () => void;
  choose: (winner: "cloud" | "device") => void;
  loadNewer: () => void;
  retry: () => void;
};

/** What each button does: the session's own calls, wrapped so none is handed a click event. */
const SESSION_ACTIONS: CloudActions = {
  signIn: () => void signInToCloud(),
  save: () => void saveNow(),
  signOut: () => void signOutOfCloud(),
  choose: (winner) => void chooseCopy(winner),
  loadNewer: () => loadNewer(),
  retry: () => void retryCloud(),
};

/** "just now", "5 minutes ago", "today at 3:42 PM", "Sep 27 at 3:42 PM". */
export const savedWhen = (iso: string | undefined, now = new Date()): string => {
  const at = iso ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime())) return "earlier";
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (at.toDateString() === now.toDateString()) return `today at ${time}`;
  return `${at.toLocaleDateString([], { month: "short", day: "numeric" })} at ${time}`;
};

const Note = ({ children }: { children: ReactNode }) => (
  <p className="text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400">{children}</p>
);

const Line = ({ children }: { children: ReactNode }) => (
  <p className="text-sm font-semibold leading-6 text-slate-700 dark:text-slate-200">{children}</p>
);

const Account = ({ email }: { email: string | null }) => (
  <Line>
    Signed in as <strong className="font-black">{email ?? "your Google account"}</strong>.
  </Line>
);

function Body({
  status,
  actions,
  onBackup,
  now,
}: {
  status: CloudStatus;
  actions: CloudActions;
  onBackup: () => void;
  now: Date;
}) {
  switch (status.kind) {
    case "off":
      return null;
    case "signed-out":
      return (
        <>
          <Line>
            Sign in with Google to keep a copy of everything here, your League Standings seasons and
            the Team Rankings pool, in cloud storage of your own. Sign in the same way on your
            phone, your laptop or anywhere else, and each one opens on the same data. Changes save
            by themselves.
          </Line>
          <Note>
            Only the Google account that signs in first can ever read or change the copy. Sign in
            first on the device that holds your data.
          </Note>
          <div>
            <button type="button" onClick={actions.signIn} className={button.primary}>
              Sign in with Google
            </button>
          </div>
        </>
      );
    case "connecting":
      return <Line>Connecting to your cloud copy…</Line>;
    case "working": {
      const [done, total] = status.progress ?? [0, 0];
      return (
        <>
          <Account email={status.account.email} />
          <Line>{status.label}</Line>
          {total > 0 && (
            <div
              role="progressbar"
              aria-label={status.label}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={done}
              className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
            >
              <div
                className="h-full rounded-full bg-blue-500"
                style={{ width: `${Math.round((done / total) * 100)}%` }}
              />
            </div>
          )}
          <Note>Keep this page open until it finishes.</Note>
        </>
      );
    }
    case "saved":
      return (
        <>
          <Account email={status.account.email} />
          <Line>
            {status.owed
              ? status.waitingForPull
                ? "Changes are waiting, and will save once the pull finishes."
                : "Changes are waiting, and will save in a few seconds."
              : status.syncedAt
                ? `Everything is saved. Last saved ${savedWhen(status.syncedAt, now)}.`
                : "Everything is saved."}
          </Line>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={actions.save}
              disabled={!status.owed || status.waitingForPull}
              className={button.dark}
            >
              Save now
            </button>
            <button type="button" onClick={actions.signOut} className={button.ghost}>
              Sign out
            </button>
          </div>
          <Note>
            Signing out leaves everything in this browser as it is. It only stops saving to the
            cloud.
          </Note>
        </>
      );
    case "choose":
      return (
        <>
          <Line>
            {status.firstTime
              ? "This browser and your cloud copy both hold data, and it is not the same."
              : "Another device saved to the cloud since this browser last did, and this browser has changes of its own."}
          </Line>
          <Line>
            The cloud copy was saved {savedWhen(status.cloudSavedAt, now)}. Which one should every
            device use from now on?
          </Line>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => actions.choose("cloud")}
              className={`${button.dark} text-left`}
            >
              Use the cloud copy
              <span className="block text-xs font-semibold opacity-80">
                Replaces what this browser holds
              </span>
            </button>
            <button
              type="button"
              onClick={() => actions.choose("device")}
              className={`${button.ghost} text-left`}
            >
              Keep this browser&apos;s data
              <span className="block text-xs font-semibold opacity-80">
                Replaces the cloud copy
              </span>
            </button>
          </div>
          <div>
            <button
              type="button"
              onClick={onBackup}
              className="text-sm font-black text-blue-700 underline underline-offset-2 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
            >
              Download a backup of this browser first
            </button>
          </div>
          <Note>Nothing is saved or replaced until you choose.</Note>
        </>
      );
    case "newer":
      return (
        <>
          <Account email={status.account.email} />
          <Line>
            Another device saved newer data {savedWhen(status.cloudSavedAt, now)}. This browser has
            no changes of its own waiting, so loading it loses nothing.
          </Line>
          <div>
            <button type="button" onClick={actions.loadNewer} className={button.primary}>
              Load it now
            </button>
          </div>
        </>
      );
    case "not-owner":
      return (
        <>
          <Line>
            This cloud copy belongs to a different Google account
            {status.account.email ? `, not ${status.account.email}` : ""}. Sign out, then sign in
            with the account that set it up.
          </Line>
          <div>
            <button type="button" onClick={actions.signOut} className={button.ghost}>
              Sign out
            </button>
          </div>
        </>
      );
    case "error":
      return (
        <>
          {status.account && <Account email={status.account.email} />}
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold leading-6 text-red-800 dark:bg-red-950/40 dark:text-red-200"
          >
            {status.message}
          </p>
          <div className="flex flex-wrap gap-3">
            {status.account ? (
              <>
                <button type="button" onClick={actions.retry} className={button.dark}>
                  Try again
                </button>
                <button type="button" onClick={actions.signOut} className={button.ghost}>
                  Sign out
                </button>
              </>
            ) : (
              <button type="button" onClick={actions.signIn} className={button.primary}>
                Sign in with Google
              </button>
            )}
          </div>
        </>
      );
  }
}

/**
 * The cloud copy's panel: where it stands, and what can be done about it. See README, "Your data
 * on every device".
 */
export function CloudPanel({
  status,
  open,
  onClose,
  onBackup,
  actions = SESSION_ACTIONS,
  now = new Date(),
}: {
  status: CloudStatus;
  open: boolean;
  onClose: () => void;
  /** Downloads a full backup of this browser, offered before choosing to replace it. */
  onBackup: () => void;
  actions?: CloudActions;
  now?: Date;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(open, containerRef as React.RefObject<HTMLElement>);
  useEscape(open, onClose);
  if (!open || status.kind === "off") return null;

  return (
    <div
      className="fixed inset-0 z-70 flex items-center justify-center bg-slate-950/40 p-3"
      role="presentation"
      onClick={onClose}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-2xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          // Kept from the app's shortcuts behind the panel, which is also where `useEscape` listens;
          // so Escape is answered here.
          if (event.key === "Escape") onClose();
          event.stopPropagation();
        }}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 id={titleId} className="text-lg font-black text-slate-950 dark:text-slate-100">
            Your data on every device
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-4 py-4">
          <Body status={status} actions={actions} onBackup={onBackup} now={now} />
        </div>
      </div>
    </div>
  );
}
