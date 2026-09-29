import { useEffect, useState, type ReactNode } from "react";
import {
  poolOnScreen,
  poolWantsCloud,
  preparePool,
  type CloudStatus,
} from "../lib/cloud/cloudSession";
import { button, card } from "../styles/tokens";

/**
 * Team Rankings, once its pool is in step with the cloud copy: another device's pull or edits are
 * taken in before anything here reads the pool, so none of it is swapped in under whoever is
 * looking. Only in a browser signed in to its copy, and only the first time in a page; it can be
 * skipped, and then anything still arriving waits to be asked for (`cloudSession.ts`).
 */
export function CloudPoolGate({ status, children }: { status: CloudStatus; children: ReactNode }) {
  const [ready, setReady] = useState(() => !poolWantsCloud());
  useEffect(() => {
    if (ready) {
      poolOnScreen();
      return;
    }
    let live = true;
    void preparePool().finally(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [ready]);
  if (ready) return <>{children}</>;
  const [done, total] = status.kind === "working" ? (status.progress ?? [0, 0]) : [0, 0];
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
