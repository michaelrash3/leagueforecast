import { useCallback, useEffect, useRef, useState } from "react";
import {
  describeEnd,
  describeProgress,
  isOver,
  markTold,
  readSentPulls,
  sendPull,
  type PullSender,
  type WatchedPull,
} from "../../lib/cloud/cloudPulls";
import { parseGcTeamList, type GcTeamListEntry } from "../../lib/gameChangerApi";
import { button, card } from "../../styles/tokens";

/** How often a pull on its way is read again while the tab is open. */
export const PULL_LOOK_MS = 15_000;

/** Said where there is no cloud to send a pull to: nobody signed in on this browser. */
export const PULLS_SIGNED_OUT = "Sign in to the cloud to pull teams there.";

/**
 * A pasted list's teams worth sending, as the device's own pull panel leaves them: wiffle ball,
 * high school squads and adult or college teams cost no request. What the pool already has, and
 * the clubs refused or too young to rank, the cloud leaves out as it pulls (`cloudRunner.ts`).
 */
export const pastedTeams = (text: string): GcTeamListEntry[] =>
  parseGcTeamList(text).entries.filter(
    (entry) => !entry.notBaseball && !entry.highSchool && !entry.notYouth
  );

/**
 * Pulls on the live page (1.8): a pasted list, and the catch-ups the server names (the teams
 * nobody could age, the rosters due a look), sent to be pulled in the cloud, with how each is
 * getting on read back while the tab is open and how each ended said once.
 */
export default function LiveCloudPulls({
  pulls,
  locked,
  agelessIds,
  rosterIds,
  playing,
  device,
  now,
}: {
  pulls: () => PullSender | null;
  /** Why nothing can be sent now (offline, a refused account), or null. */
  locked: string | null;
  /** The catch-up's teams, from the server's import status, or none until it is read. */
  agelessIds: readonly string[];
  rosterIds: readonly string[];
  /** The squad year being played, which the catch-ups file into alone, as on the device. */
  playing: number;
  /** This browser, as a pull's job names the device that sent it. */
  device: string;
  now: () => string;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const sendingNow = useRef(false);
  const [said, setSaid] = useState<string | null>(null);
  const [watched, setWatched] = useState<WatchedPull[]>([]);
  const [looked, setLooked] = useState(0);

  // What this device sent, read now and again while any is on its way.
  useEffect(() => {
    const sender = pulls();
    if (!sender) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void readSentPulls(sender.jobs).then((read) => {
      if (!alive) return;
      setWatched(read);
      if (read.some(({ job }) => !isOver(job))) {
        timer = setTimeout(() => setLooked((times) => times + 1), PULL_LOOK_MS);
      }
    });
    return () => {
      alive = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [pulls, looked]);

  const entries = pastedTeams(text);
  const send = useCallback(
    async (list: readonly GcTeamListEntry[], options: { refresh: boolean; years: number[] }) => {
      const sender = pulls();
      if (!sender || sendingNow.current || list.length === 0) return;
      sendingNow.current = true;
      setSending(true);
      setSaid(null);
      const sent = await sendPull(
        {
          entries: list,
          seasonYears: options.years,
          refresh: options.refresh,
          device,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          now: now(),
        },
        sender
      );
      sendingNow.current = false;
      setSending(false);
      if (sent.ok) {
        if (!options.refresh) setText("");
        setLooked((times) => times + 1);
      } else setSaid(sent.message);
    },
    [pulls, device, now]
  );

  const sender = pulls();
  const stop = (jobId: string) => {
    void sender?.jobs
      .askStop(jobId)
      .then(() => setLooked((times) => times + 1))
      .catch(() => setSaid("The pull could not be asked to stop just now. Try again."));
  };
  const told = (jobId: string) => {
    markTold(jobId);
    setWatched((all) => all.filter(({ sent }) => sent.jobId !== jobId));
  };
  // A tab that cannot edit already says why; the card adds only that nobody is signed in.
  const blocked = locked ? "" : sender ? null : PULLS_SIGNED_OUT;
  const asIds = (ids: readonly string[]) => ids.map((teamId) => ({ teamId }));

  return (
    <div className={`${card} p-5`}>
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Pull teams in the cloud
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Paste GameChanger team links or ids, or a whole spreadsheet export. The cloud pulls the
        teams it does not have yet, or a handful pasted by hand again, and files them for every
        device; this page can be closed meanwhile.
      </p>
      {blocked !== null ? (
        blocked ? (
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{blocked}</p>
        ) : null
      ) : (
        <>
          <label className="mt-3 block text-sm font-bold text-slate-600 dark:text-slate-300">
            Teams to pull
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={4}
              className="mt-1 block w-full rounded border border-slate-300 bg-white p-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-900"
            />
          </label>
          <button
            type="button"
            disabled={sending || entries.length === 0}
            aria-busy={sending}
            onClick={() => void send(entries, { refresh: false, years: [] })}
            className={`${button.primary} mt-3`}
          >
            {sending
              ? "Sending…"
              : `Pull ${entries.length.toLocaleString()} ${entries.length === 1 ? "team" : "teams"} in the cloud`}
          </button>
          {agelessIds.length > 0 || rosterIds.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {agelessIds.length > 0 ? (
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => void send(asIds(agelessIds), { refresh: true, years: [playing] })}
                  className={button.ghost}
                >
                  Ask again about {agelessIds.length.toLocaleString()}{" "}
                  {agelessIds.length === 1 ? "team" : "teams"} nobody could age
                </button>
              ) : null}
              {rosterIds.length > 0 ? (
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => void send(asIds(rosterIds), { refresh: true, years: [playing] })}
                  className={button.ghost}
                >
                  Check {rosterIds.length.toLocaleString()} short{" "}
                  {rosterIds.length === 1 ? "roster" : "rosters"} again
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      {said ? (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
          {said}
        </p>
      ) : null}
      {watched.length > 0 ? (
        <ul className="mt-4 space-y-2" aria-live="polite">
          {watched.map((pull) => (
            <li key={pull.sent.jobId} className="text-sm text-slate-600 dark:text-slate-300">
              {isOver(pull.job) ? describeEnd(pull) : describeProgress(pull)}{" "}
              {isOver(pull.job) ? (
                <button
                  type="button"
                  onClick={() => told(pull.sent.jobId)}
                  className={button.ghost}
                >
                  OK
                </button>
              ) : pull.job.stopAsked ? null : (
                <button
                  type="button"
                  onClick={() => stop(pull.sent.jobId)}
                  className={button.ghost}
                >
                  Stop
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
