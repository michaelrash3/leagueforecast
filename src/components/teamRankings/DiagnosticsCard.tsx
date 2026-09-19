import { useState } from "react";
import {
  clearDiagnostics,
  currentDiagnosticsReport,
  readDiagnostics,
  type DiagnosticEntry,
} from "../../lib/diagnostics";
import { button, card } from "../../styles/tokens";

/**
 * What has gone wrong in this browser, and a way to hand it to somebody.
 *
 * The error screen offers the same copy, but only while something is broken — and the failure
 * worth reporting is usually the one that happened last Tuesday. A crash is recorded whether or
 * not anyone was looking at the boundary, so this is where to find it afterwards.
 *
 * Nothing here is sent anywhere. There is no server for it to go to, and a crash carrying team
 * names and a component stack is not something to post to a third party on somebody's behalf.
 */
const when = (at: string) => {
  const date = new Date(at);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : at;
};

const label: Record<DiagnosticEntry["kind"], string> = {
  crash: "Screen could not be drawn",
  "pool-write": "A save did not land",
};

export function DiagnosticsCard() {
  const [entries, setEntries] = useState<DiagnosticEntry[]>(() => readDiagnostics());
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard
      ?.writeText(currentDiagnosticsReport())
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <div className={`${card} p-5`}>
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
        What has gone wrong here
      </h2>
      <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
        {entries.length === 0
          ? "Nothing has been recorded in this browser. A screen that fails to draw, or a save that does not land, is written down here so it can be reported afterwards rather than only while it is happening."
          : "A screen that failed to draw, or a save that did not land. Kept in this browser only — nothing is sent anywhere, and the copy below goes to your clipboard for you to paste wherever you like."}
      </p>

      {entries.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-slate-500">
          {entries.slice(0, 5).map((entry) => (
            <li key={`${entry.at}-${entry.where}`}>
              <span className="font-bold text-slate-700 dark:text-slate-200">
                {label[entry.kind]}
              </span>
              {" — "}
              {entry.where} · {when(entry.at)}
            </li>
          ))}
          {entries.length > 5 && <li>…and {entries.length - 5} more in the copy.</li>}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copy}
          disabled={entries.length === 0}
          className={button.ghost}
        >
          {copied ? "Copied" : "Copy diagnostics"}
        </button>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={() => {
              clearDiagnostics();
              setEntries([]);
              setCopied(false);
            }}
            className={button.ghost}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
