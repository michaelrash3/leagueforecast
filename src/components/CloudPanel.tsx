import { useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useEscape, useFocusTrap } from "../hooks/useFocusTrap";
import {
  addCloudMember,
  bringBack,
  cloudErrorMessage,
  cloudKept,
  cloudMembers,
  dismissCloudNotice,
  loadNewer,
  removeCloudMember,
  restartCloud,
  retryCloud,
  saveNow,
  signInToCloud,
  signOutOfCloud,
  type CloudStatus,
  type KeptVersion,
} from "../lib/cloud/cloudSession";
import { readLiveBoard, subscribeLiveBoard, writeLiveBoard } from "../lib/preferences";
import { button } from "../styles/tokens";
import { CloudMembers, type MembersApi } from "./CloudMembers";

export type CloudActions = {
  signIn: () => void;
  save: () => void;
  signOut: () => void;
  loadNewer: () => void;
  retry: () => void;
  restart: () => void;
  bringBack: (group: string) => void;
  dismissNotice: () => void;
  reloadApp: () => void;
};

/** What each button does: the session's own calls, wrapped so none is handed a click event. */
const SESSION_ACTIONS: CloudActions = {
  signIn: () => void signInToCloud(),
  save: () => void saveNow({ asked: true }),
  signOut: () => void signOutOfCloud(),
  loadNewer: () => void loadNewer(),
  retry: () => void retryCloud(),
  restart: () => void restartCloud(),
  bringBack: (group) => void bringBack(group),
  dismissNotice: () => dismissCloudNotice(),
  reloadApp: () => window.location.reload(),
};

/** The list of who may use the copy, read and changed through the session. */
const SESSION_MEMBERS: MembersApi = {
  list: cloudMembers,
  add: addCloudMember,
  remove: removeCloudMember,
  message: cloudErrorMessage,
};

/** A size for people: "61.4 MB", "830 KB". */
export const sizeOf = (bytes: number): string =>
  bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1_000))} KB`;

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

/**
 * This device's switch for opening Team Rankings on the cloud's published board
 * (`LiveTeamRankings`). Off unless turned on, and read as Team Rankings opens, so it changes the
 * next open and never the page on screen.
 */
const LiveBoardSwitch = () => {
  const on = useSyncExternalStore(subscribeLiveBoard, readLiveBoard, () => false);
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        checked={on}
        onChange={(event) => writeLiveBoard(event.target.checked)}
        className="mt-1"
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Open Team Rankings on the cloud&apos;s board
        </label>
        <Note>
          The board the cloud last built shows at once, then this device&apos;s own copy takes over.
          On this device only, from the next time Team Rankings opens.
        </Note>
      </div>
    </div>
  );
};

const Box = ({ tone, children }: { tone: "info" | "alert"; children: ReactNode }) => (
  <div
    role={tone === "alert" ? "alert" : "status"}
    className={`rounded-lg px-3 py-2 text-sm font-semibold leading-6 ${
      tone === "alert"
        ? "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200"
        : "bg-blue-50 text-blue-900 dark:bg-blue-950/40 dark:text-blue-100"
    }`}
  >
    {children}
  </div>
);

const Account = ({ email }: { email: string | null }) => (
  <Line>
    Signed in as <strong className="font-black">{email ?? "your Google account"}</strong>.
  </Line>
);

const SIGN_IN_PITCH =
  "Sign in with Google to keep a copy of everything here, your League Standings seasons and the Team Rankings pool, in your Firebase project's cloud. Sign in the same way on your phone, your laptop or anywhere else, and each one opens on the same data. Changes save by themselves.";

/** One kept version, with the button that brings it back, asked twice. */
function KeptRow({
  version,
  now,
  onBringBack,
}: {
  version: KeptVersion;
  now: Date;
  onBringBack: (group: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const whose =
    version.why === "lost"
      ? version.fromHere
        ? "This device's own"
        : "Another device's own"
      : "The cloud copy's";
  return (
    <li className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
        {whose} {version.what.join(" and ")}, kept {savedWhen(version.keptAt, now)} (
        {sizeOf(version.bytes)})
      </p>
      {asking ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Bring this back on every device? What is there now is kept in its place.
          </span>
          <button
            type="button"
            onClick={() => {
              setAsking(false);
              onBringBack(version.group);
            }}
            className={button.dark}
          >
            Bring it back
          </button>
          <button type="button" onClick={() => setAsking(false)} className={button.ghost}>
            Keep what is there
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="mt-1 text-sm font-black text-blue-700 underline underline-offset-2 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
        >
          Bring back…
        </button>
      )}
    </li>
  );
}

function Body({
  status,
  actions,
  members,
  kept,
  now,
}: {
  status: CloudStatus;
  actions: CloudActions;
  members: MembersApi;
  kept: readonly KeptVersion[];
  now: Date;
}) {
  switch (status.kind) {
    case "off":
      return null;
    case "none":
      return (
        <>
          <Line>{SIGN_IN_PITCH}</Line>
          <Note>
            Sign in first on the device that holds your data. Another device signing in afterwards
            adds its seasons to the copy, and keeps its own Team Rankings aside where they can be
            brought back.
          </Note>
          <div>
            <button type="button" onClick={actions.signIn} className={button.primary}>
              Sign in with Google
            </button>
          </div>
        </>
      );
    case "signed-out":
      return (
        <>
          <Line>
            This browser keeps a cloud copy of your data, but is signed out, so nothing is being
            saved to it. Sign in again with the same Google account; anything changed here meanwhile
            is saved then.
          </Line>
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
    case "saved": {
      const waiting =
        status.waiting === "pull"
          ? "Changes are waiting, and will save once the pull or tidy finishes."
          : status.waiting === "storage"
            ? "Some Team Rankings changes could not be stored on this device (it may be full), so they are not saved to the cloud yet."
            : status.waiting === "unreadable"
              ? "Some Team Rankings data here could not be read, so it is not saved to the cloud yet. Reloading the page usually brings it back."
              : "Changes are waiting, and will save in a few seconds.";
      const newerLeague = status.newer.includes("league");
      const newerPool = status.newer.includes("pool");
      return (
        <>
          <Account email={status.account.email} />
          <Line>
            {status.owed || status.waiting
              ? waiting
              : status.syncedAt
                ? `Everything is saved. Last saved ${savedWhen(status.syncedAt, now)}.`
                : "Everything is saved."}
          </Line>
          {(newerLeague || newerPool) && (
            <Box tone="info">
              {newerLeague
                ? "Another device changed League Standings. "
                : "Another device changed Team Rankings. "}
              They arrive here when you leave this page or come back to it, or now:
              <div className="mt-2">
                <button type="button" onClick={actions.loadNewer} className={button.primary}>
                  Load them now
                </button>
              </div>
            </Box>
          )}
          {status.notice && (
            <Box tone="info">
              {status.notice}
              <div className="mt-2">
                <button type="button" onClick={actions.dismissNotice} className={button.ghost}>
                  OK
                </button>
              </div>
            </Box>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={actions.save}
              disabled={!status.owed || status.waiting === "pull"}
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
            cloud{status.owed ? "; the changes still waiting are saved when you sign in again" : ""}
            .
          </Note>
          <LiveBoardSwitch />
          <CloudMembers api={members} />
          {kept.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-black text-slate-950 dark:text-slate-100">
                Earlier versions, kept for 30 days
              </h3>
              <Note>
                When two devices change the same thing, the later change is kept and so is the
                other, here. A device joining the copy keeps its own Team Rankings here too, and the
                nightly refresh keeps the Team Rankings it replaced, so a bad night can be undone.
              </Note>
              <ul className="flex flex-col gap-2">
                {kept.map((version) => (
                  <KeptRow
                    key={version.group}
                    version={version}
                    now={now}
                    onBringBack={actions.bringBack}
                  />
                ))}
              </ul>
            </div>
          )}
        </>
      );
    }
    case "gone":
      return (
        <>
          <Account email={status.account.email} />
          <Line>
            The cloud copy is gone: deleted in the Firebase console, most likely. Nothing in this
            browser has been changed.
          </Line>
          <Line>
            Starting it again from here makes this browser&apos;s data the cloud copy. Every other
            device then adds its seasons to it, and keeps its own Team Rankings aside.
          </Line>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={actions.restart} className={button.dark}>
              Start it again from this browser
            </button>
            <button type="button" onClick={actions.signOut} className={button.ghost}>
              Sign out
            </button>
          </div>
        </>
      );
    case "not-owner":
      return (
        <>
          <Line>
            {status.account.email ?? "This Google account"} is not on the list of accounts that may
            use this cloud copy. Ask its owner to add it, or sign out and sign in with an account on
            the list. This browser&apos;s own data is untouched either way.
          </Line>
          <div>
            <button type="button" onClick={actions.signOut} className={button.ghost}>
              Sign out
            </button>
          </div>
        </>
      );
    case "update":
      return (
        <>
          <Account email={status.account.email} />
          <Line>
            Your cloud copy was saved by a newer version of the app. Reload to update this one;
            nothing here has been changed, and nothing is saved until it is updated.
          </Line>
          <div>
            <button type="button" onClick={actions.reloadApp} className={button.primary}>
              Reload
            </button>
          </div>
        </>
      );
    case "error":
      return (
        <>
          {status.account && <Account email={status.account.email} />}
          <Box tone="alert">{status.message}</Box>
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
  actions = SESSION_ACTIONS,
  members = SESSION_MEMBERS,
  kept = cloudKept(),
  now = new Date(),
}: {
  status: CloudStatus;
  open: boolean;
  onClose: () => void;
  actions?: CloudActions;
  members?: MembersApi;
  kept?: readonly KeptVersion[];
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
          <Body status={status} actions={actions} members={members} kept={kept} now={now} />
        </div>
      </div>
    </div>
  );
}
