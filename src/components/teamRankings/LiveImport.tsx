import { useCallback, useEffect, useRef, useState } from "react";
import type { PullSender } from "../../lib/cloud/cloudPulls";
import { todayIsoDay } from "../../lib/date";
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
import { segmentOn } from "../../lib/teamRankings/seasons";
import { button, card } from "../../styles/tokens";
import LiveCloudPulls, { useWatchedPulls } from "./LiveCloudPulls";
import LiveRefreshNow from "./LiveRefreshNow";

const NO_IDS: readonly string[] = [];

/** Said for an Organizations file that names no team under any organization. */
export const ORGS_NO_TEAMS =
  "That file names no teams under its organizations: it needs the Team IDs column.";
/** Said for an Organizations file whose organizations with teams have no names to read an age from. */
export const ORGS_NO_NAMES =
  "That file's organizations have no names, which a team's age is read from: it needs the Entity Name column.";
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
 * nightly ages teams by. A pasted list of teams, and the catch-ups the status names, are pulled in
 * the cloud (`LiveCloudPulls`, 1.8).
 *
 * Loaded only when the tab is opened, with the tab's own code.
 */
export default function LiveImport({
  edits,
  now,
  pulls,
  device,
}: {
  edits: LiveEdits;
  /** The time a question is asked at, and a file read at, as an ISO string. */
  now: () => string;
  /** Where a pull is sent to be run in the cloud, or null with nobody signed in. */
  pulls: () => PullSender | null;
  /** This browser, as a pull's job names the device that sent it. */
  device: string;
}) {
  const { locked, ask, edit, say } = edits;
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [unread, setUnread] = useState(false);
  const [asked, setAsked] = useState(0);
  const askAgain = useCallback(() => setAsked((times) => times + 1), []);
  // The pulls this device watches, read once for both cards: "Refresh now" waits while any runs.
  const watching = useWatchedPulls(pulls);
  /*
   * The cadence chosen here, shown from the choice until a status that carries it is read: cleared
   * once the edit was made, it flipped back to the old one until the status came, and stayed so
   * when that read failed. `sending` holds the choice while the edit is on its way.
   */
  const [chosen, setChosen] = useState<RefreshCadence | null>(null);
  const [sending, setSending] = useState(false);
  const sendingNow = useRef(false);
  const [showWeek, setShowWeek] = useState(false);

  useEffect(() => {
    if (locked) return;
    let alive = true;
    void ask({ kind: "import.status", at: now() }).then((answer) => {
      if (!alive) return;
      setUnread(answer === null);
      if (!answer) return;
      setStatus(answer);
      // A status read with no edit on its way has the cadence as the copy keeps it.
      if (!sendingNow.current) setChosen(null);
    });
    return () => {
      alive = false;
    };
  }, [locked, ask, now, asked]);

  const choose = (cadence: RefreshCadence) => {
    const was = chosen;
    setChosen(cadence);
    sendingNow.current = true;
    setSending(true);
    void edit(
      { kind: "refresh.cadence", cadence },
      {
        done:
          cadence === "daily"
            ? "The nightly refresh now pulls every age group."
            : "The nightly refresh now pulls one or two levels a day.",
      }
    ).then((made) => {
      sendingNow.current = false;
      setSending(false);
      if (!made) {
        setChosen(was);
        return;
      }
      askAgain();
    });
  };

  const readOrgFile = (text: string) => {
    // Only what the copy keeps: an organization with a name and a team under it.
    const read = parseGcOrgList(text).orgs;
    const orgs: MemberOrg[] = read.flatMap(({ orgId, name, teamIds }) =>
      name && teamIds?.length ? [{ orgId, name, teamIds }] : []
    );
    if (orgs.length === 0) {
      say(read.some(({ teamIds }) => teamIds?.length) ? ORGS_NO_NAMES : ORGS_NO_TEAMS);
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

  // Pulling a list never waits on the copy's refresh: the cloud runs it beside the nightly.
  const pullCard = (
    <LiveCloudPulls
      pulls={pulls}
      watching={watching}
      locked={locked}
      agelessIds={status?.agelessIds ?? NO_IDS}
      rosterIds={status?.rosterIds ?? NO_IDS}
      playing={segmentOn(todayIsoDay()).year}
      device={device}
      now={now}
    />
  );

  /*
   * "Refresh now", with how a refresh this device watches is getting on. Before the status is read
   * there is no count to offer, so only the lines are drawn: a refresh under way is still told of
   * while edits are locked or the status cannot be read.
   */
  const refreshNow = (
    <LiveRefreshNow
      offer={status?.refreshNow}
      locked={locked}
      pulls={pulls}
      watching={watching}
      device={device}
      now={now}
      onEnded={askAgain}
    />
  );

  if (!status)
    return (
      <>
        <div className={`${card} p-5`} role="status" aria-live="polite">
          {locked ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">{locked}</p>
          ) : unread ? (
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
          {refreshNow}
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
          The cloud pulls from GameChanger every night, set for around midnight Eastern, whether or
          not anything is open, and every device sees what it brings.
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
        <fieldset className="mt-3" disabled={locked !== null || sending}>
          <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
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
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
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
        {refreshNow}
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
