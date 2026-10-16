import { useEffect, useState, type ReactNode } from "react";
import {
  poolOnScreen,
  poolWantsCloud,
  preparePool,
  type CloudStatus,
} from "../lib/cloud/cloudSession";
import { usePoolFilled } from "../hooks/useOpeningHold";
import { poolFilled } from "../lib/poolFill";
import { button, card } from "../styles/tokens";

/**
 * Team Rankings, once its pool is in step with the cloud copy: another device's pull or edits are
 * taken in before anything here reads the pool, so none of it is swapped in under whoever is
 * looking. Only in a browser signed in to its copy, and only the first time in a page; it can be
 * skipped, and then anything still arriving waits to be asked for (`cloudSession.ts`).
 *
 * Nor before this device's own store is read in, which a member's device does after the page is
 * drawn (`poolFill.ts`), and at once from here: Team Rankings drawn before then would read an
 * empty pool, so that wait cannot be skipped.
 */
export function CloudPoolGate({
  status,
  children,
  waiting,
}: {
  status: CloudStatus;
  children: ReactNode;
  /**
   * What to show while the pool is brought in, in place of the progress card: how far it has got,
   * and a way to stop waiting for it. The live board keeps its rows on screen this way.
   */
  waiting?: (progress: { done: number; total: number }, skip: () => void) => ReactNode;
}) {
  const [ready, setReady] = useState(() => !poolWantsCloud());
  const filled = usePoolFilled();
  useEffect(() => {
    if (ready) return;
    let live = true;
    void preparePool().finally(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [ready]);
  // The pool is wanted now, whether or not the cloud's is still being brought in: a read still
  // waiting for the live board's first draw starts at once.
  useEffect(() => {
    void poolFilled();
  }, []);
  useEffect(() => {
    if (ready && filled) poolOnScreen();
  }, [ready, filled]);
  if (ready && filled) return <>{children}</>;
  if (ready) {
    return (
      <div className={`${card} p-5`} role="status" aria-live="polite">
        <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
          Reading Team Rankings on this device…
        </p>
      </div>
    );
  }
  const [done, total] = status.kind === "working" ? (status.progress ?? [0, 0]) : [0, 0];
  if (waiting) return <>{waiting({ done, total }, () => setReady(true))}</>;
  return (
    <div className={`${card} flex flex-col gap-3 p-5`} role="status" aria-live="polite">
      <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
        {status.kind === "working" && total > 0
          ? `Loading Team Rankings from your cloud copy… ${done} of ${total}`
          : "Checking your cloud copy for newer Team Rankings…"}
      </p>
      {total > 0 && (
        <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div
            className="h-full rounded-full bg-blue-500"
            style={{ width: `${Math.round((done / total) * 100)}%` }}
          />
        </div>
      )}
      <div>
        <button type="button" onClick={() => setReady(true)} className={button.ghost}>
          Show this device&apos;s copy now
        </button>
      </div>
    </div>
  );
}
