import { useEffect, useState } from "react";
import type { LiveEdits } from "../../hooks/useLiveEdits";
import { parseGcOrgList } from "../../lib/gameChangerApi";
import {
  describeCadence,
  describeDueSummary,
  describeRotation,
  MIN_PULL_GAP_HOURS,
  type RefreshCadence,
} from "../../lib/gameChangerSchedule";
import type { ImportStatus } from "../../lib/live/queries";
import type { MemberOrg } from "../../lib/orgMembership";
import { button, card } from "../../styles/tokens";

/** Said for an Organizations file that names no team under any organization. */
export const ORGS_NO_TEAMS =
  "That file names no teams under its organizations: it needs the Team IDs column.";
/** Said for an Organizations file whose every organization is kept already. */
export const ORGS_NOTHING_NEW =
  "Nothing new in that file: every organization in it is already kept.";

const CADENCES: readonly [RefreshCadence, string][] = [
  ["daily", "Every age group, daily"],
  ["rotation", "One or two levels a day"],
];

/** The levels refreshed on each day the log names, the latest day first. */
const byDay = (refreshed: ImportStatus["refreshed"]): [string, number[]][] => {
  const days = new Map<string, number[]>();
  refreshed.forEach(({ level, day }) => days.set(day, [...(days.get(day) ?? []), level]));
  return [...days].sort(([a], [b]) => b.localeCompare(a));
};

/**
 * The Import tab on the live page (1.5): the copy's nightly refresh as the server works it out
 * (`import.status`), what it is for today and when each level was last refreshed, with how much
 * comes round at once chosen here and kept on the copy (`refresh.cadence`), which the nightly
 * reads; and an Organizations file read here and kept on the copy (`orgs.merge`), which the
 * nightly ages teams by. Pulling a pasted list of teams is the pull in this browser, so it opens on
 * this device's copy (`onPullWanted`) until the cloud runs one.
 *
 * Loaded only when the tab is opened, with the tab's own code.
 */
export default function LiveImport({
  edits,
  now,
  onPullWanted,
}: {
  edits: LiveEdits;
  /** The time a question is asked at, and a file read at, as an ISO string. */
  now: () => string;
  onPullWanted: () => void;
}) {
  const { locked, ask, edit, say } = edits;
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [unread, setUnread] = useState(false);
  const [asked, setAsked] = useState(0);
  const askAgain = () => setAsked((times) => times + 1);
  // The cadence just chosen, shown while the edit that keeps it is on its way.
  const [chosen, setChosen] = useState<RefreshCadence | null>(null);
  const [showWeek, setShowWeek] = useState(false);

  useEffect(() => {
    if (locked) return;
    let alive = true;
    void ask({ kind: "import.status", at: now() }).then((answer) => {
      if (!alive) return;
      setUnread(answer === null);
      if (answer) setStatus(answer);
    });
    return () => {
      alive = false;
    };
  }, [locked, ask, now, asked]);

  const choose = (cadence: RefreshCadence) => {
    setChosen(cadence);
    void edit(
      { kind: "refresh.cadence", cadence },
      {
        done:
          cadence === "daily"
            ? "The nightly refresh now pulls every age group."
            : "The nightly refresh now pulls one or two levels a day.",
      }
    ).then(() => {
      setChosen(null);
      askAgain();
    });
  };

  const readOrgFile = (text: string) => {
    // Only what the copy keeps: an organization with a name and a team under it.
    const orgs: MemberOrg[] = parseGcOrgList(text).orgs.flatMap(({ orgId, name, teamIds }) =>
      name && teamIds?.length ? [{ orgId, name, teamIds }] : []
    );
    if (orgs.length === 0) {
      say(ORGS_NO_TEAMS);
      return;
    }
    void edit(
      { kind: "orgs.merge", orgs, at: now() },
      {
        done: `Kept the ${orgs.length.toLocaleString()} organization${
          orgs.length === 1 ? "" : "s"
        } in that file.`,
        same: ORGS_NOTHING_NEW,
      }
    ).then((made) => {
      if (made) askAgain();
    });
  };

  // Pulling a list never waits on the copy's refresh: it is this device's to run.
  const pullCard = (
    <div className={`${card} p-5`}>
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Pull a list of teams
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Pasting a list of teams, or a whole spreadsheet export, pulls them in this browser, so it
        opens on this device&apos;s copy for now.
      </p>
      <button type="button" onClick={onPullWanted} className={`${button.ghost} mt-3`}>
        Open the pull on this device&apos;s copy
      </button>
    </div>
  );

  if (!status)
    return (
      <>
        <div className={`${card} p-5`} role="status" aria-live="polite">
          {unread && !locked ? (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                The cloud&apos;s refresh could not be read just now.
              </p>
              <button type="button" onClick={askAgain} className={`${button.ghost} mt-3`}>
                Try again
              </button>
            </>
          ) : (
            <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
              Reading the cloud&apos;s refresh…
            </p>
          )}
        </div>
        {pullCard}
      </>
    );

  const { due, refreshed, orgs } = status;
  const cadence = chosen ?? due.cadence;
  return (
    <>
      <div className={`${card} p-5`}>
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          The nightly refresh
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          The cloud pulls from GameChanger every night at about 3 AM Eastern, whether or not
          anything is open, and every device sees what it brings.
        </p>
        <p className="mt-3 text-sm font-bold text-slate-950 dark:text-white">
          {describeDueSummary(due)}
        </p>
        {due.heldBack > 0 && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {due.heldBack.toLocaleString()} team{due.heldBack === 1 ? "" : "s"} pulled in the last{" "}
            {MIN_PULL_GAP_HOURS} hours with no game yesterday, today or tomorrow{" "}
            {due.heldBack === 1 ? "waits" : "wait"} for a later run.
          </p>
        )}
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {describeCadence(cadence)}
        </p>
        <fieldset className="mt-3" disabled={locked !== null || chosen !== null}>
          <legend className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            How much comes round at once
          </legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {CADENCES.map(([value, label]) => (
              <label key={value} className="flex items-center gap-1.5 text-xs font-bold">
                <input
                  type="radio"
                  name="live-refresh-cadence"
                  value={value}
                  checked={cadence === value}
                  onChange={() => choose(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {cadence === "rotation" && (
          <>
            <button
              type="button"
              onClick={() => setShowWeek((value) => !value)}
              aria-expanded={showWeek}
              className="mt-2 text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
            >
              {showWeek ? "Hide the week" : "The week"}
            </button>
            {showWeek && (
              <ul className="mt-2 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                {describeRotation().map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </>
        )}
        {refreshed.length > 0 && (
          <div className="mt-3">
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Last refreshed
            </h3>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
              {byDay(refreshed).map(([day, levels]) => (
                <li key={day}>
                  {day}: {levels.map((level) => `${level}U`).join(", ")}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className={`${card} p-5`}>
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Organizations
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400" data-testid="live-orgs">
          {orgs.orgs === 0
            ? "The Organizations export with its Team IDs column. A team GameChanger gives no age takes the age its organization's name states, and a file read later adds to this one."
            : `${orgs.orgs.toLocaleString()} organizations kept, ${orgs.teams.toLocaleString()} teams under them. ${orgs.aged.toLocaleString()} can take an age from an organization's name, ${orgs.waitingAged.toLocaleString()} of them waiting on one.`}
        </p>
        <label className="mt-3 inline-block">
          <span className={`${button.ghost} inline-block cursor-pointer`}>
            Choose an Organizations CSV
          </span>
          <input
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="hidden"
            aria-label="Organizations CSV"
            disabled={locked !== null}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.currentTarget.value = "";
              if (!file) return;
              void file.text().then(readOrgFile, () => say("Could not read that file."));
            }}
          />
        </label>
      </div>

      {pullCard}
    </>
  );
}
