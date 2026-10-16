import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  askAgain,
  agoFrom,
  describeEnd,
  describeProgress,
  describePullUpdate,
  describeImportMetrics,
  dueForAsking,
  goneSilent,
  isOver,
  isRefresh,
  markTold,
  loadSentPulls,
  readSentPulls,
  resumable,
  sendPull,
  type PullSender,
  type SentPull,
  type WatchedPull,
} from "../../lib/cloud/cloudPulls";
import {
  isWellFormedGcTeamId,
  parseGcTeamList,
  type GcTeamListEntry,
} from "../../lib/gameChangerApi";
import { MAX_LIST_TEAMS, tooManyTeams } from "../../lib/cloud/pullJobs";
import { button, card } from "../../styles/tokens";
import { FIREBASE_WEB_CONFIG } from "../../lib/cloud/cloudConfig";
import { downloadCsv } from "../../lib/download";

/** How often a pull on its way is read again while the tab is open. */
export const PULL_LOOK_MS = 15_000;

/** Said where there is no cloud to send a pull to: nobody signed in on this browser. */
export const PULLS_SIGNED_OUT = "Sign in to the cloud to pull teams there.";

/** Said where a pull could not be asked to stop. */
const STOP_FAILED = "The pull could not be asked to stop just now. Try again.";

/**
 * A pasted list's teams worth sending, as the device's own pull panel leaves them: wiffle ball,
 * high school squads and adult or college teams cost no request. What the pool already has, and
 * the clubs refused or too young to rank, the cloud leaves out as it pulls (`cloudRunner.ts`).
 */
export const pastedTeams = (text: string): GcTeamListEntry[] => readPaste(text).entries;

/**
 * A paste as the card reads it: its teams worth sending (`pastedTeams`); how many of their ids are
 * not of the shape GameChanger's are (`isWellFormedGcTeamId`), the slugs and names a list carries
 * where an id should be, which GameChanger answers with HTTP 400; and how many lines named no team
 * id, or one named above them. Both counts are said before the list is sent.
 */
export const readPaste = (
  text: string
): { entries: GcTeamListEntry[]; malformed: number; skipped: number } => {
  const parsed = parseGcTeamList(text);
  const entries = parsed.entries.filter(
    (entry) => !entry.notBaseball && !entry.highSchool && !entry.notYouth
  );
  return {
    entries,
    malformed: entries.filter((entry) => !isWellFormedGcTeamId(entry.teamId)).length,
    skipped: parsed.skipped.length,
  };
};

/**
 * A staged import's skips apart, where it counted them: those that failed for a passing reason,
 * asked once more when every batch is in, and those that will not answer otherwise.
 */
const skipsApart = (job: WatchedPull["job"]): string =>
  job.skipped && job.tally.failed > 0
    ? `: ${job.skipped.transient.toLocaleString()} for now, asked once more before the final tidy, and ${job.skipped.permanent.toLocaleString()} for good`
    : "";

/** What the card says of a paste's ids that will likely be refused, and its lines with none. */
const pasteWarning = ({ malformed, skipped }: { malformed: number; skipped: number }): string =>
  [
    malformed > 0
      ? `${malformed.toLocaleString()} of these ${malformed === 1 ? "does" : "do"} not look like GameChanger team ids, which are the 12 letters and digits after web.gc.com/teams/; GameChanger will likely refuse ${malformed === 1 ? "it" : "them"}.`
      : "",
    skipped > 0
      ? `${skipped.toLocaleString()} ${skipped === 1 ? "line named no team id and is" : "lines named no team id and are"} left out.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

/**
 * The pulls this device sent, or "Refresh now" handed it, and has not yet told the user the end
 * of: read when the tab opens, read again every `PULL_LOOK_MS` while any is on its way, and read
 * at once after a send (`look`). Held by the Import tab, so its nightly card and its pull card
 * read one list: "Refresh now" waits while any is on its way, and both say how each is getting on
 * in the same lines (`PullLines`).
 *
 * A list still waiting to start is asked about again (`dueForAsking`, `askAgain`) as it is read,
 * so one whose start failed where this device could not hear runs, or says why, within a minute or
 * so instead of waiting for good; and Stop on one that never started asks at once, which is what
 * cancels it, since only a running leg reads the stop.
 */
export const useWatchedPulls = (pulls: () => PullSender | null) => {
  const [watched, setWatched] = useState<WatchedPull[]>([]);
  const [unread, setUnread] = useState<SentPull[]>([]);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [looked, setLooked] = useState(0);
  const [resuming, setResuming] = useState<string | null>(null);
  const starting = useRef(new Set<string>());

  // Keep the age honest even while a status request is waiting on a connection.
  useEffect(() => {
    if (unread.length === 0 && !watched.some(({ job }) => !isOver(job))) return;
    const clock = setInterval(() => setNowMs(Date.now()), PULL_LOOK_MS);
    return () => clearInterval(clock);
  }, [watched, unread]);

  useEffect(() => {
    const sender = pulls();
    if (!sender) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const failed: SentPull[] = [];
    void readSentPulls(sender.jobs, (pull) => failed.push(pull)).then((read) => {
      if (!alive) return;
      // Keep a failed read distinct from a missing job, and keep its previous progress visible.
      // A pull acknowledged while this read was in flight must not reappear afterwards.
      const kept = new Set(
        loadSentPulls()
          .filter((pull) => !pull.told)
          .map((pull) => pull.jobId)
      );
      const missing = failed.filter((pull) => kept.has(pull.jobId));
      const missingIds = new Set(missing.map((pull) => pull.jobId));
      const received = read.filter((pull) => kept.has(pull.sent.jobId));
      setWatched((previous) => [
        ...received,
        ...previous.filter((pull) => missingIds.has(pull.sent.jobId)),
      ]);
      setUnread(missing);
      const now = new Date();
      setCheckedAt(now.getTime());
      setNowMs(now.getTime());
      const due = received.filter(
        (pull) => !starting.current.has(pull.sent.jobId) && dueForAsking(pull, now.getTime())
      );
      // Read again once the asks are answered, so what they did is said without waiting a look.
      if (due.length > 0) {
        for (const pull of due) starting.current.add(pull.sent.jobId);
        void Promise.all(
          due.map((pull) =>
            askAgain(pull, sender, now).finally(() => starting.current.delete(pull.sent.jobId))
          )
        ).then(() => {
          if (alive) setLooked((times) => times + 1);
        });
      }
      if (missing.length > 0 || received.some(({ job }) => !isOver(job))) {
        timer = setTimeout(() => setLooked((times) => times + 1), PULL_LOOK_MS);
      }
    });
    return () => {
      alive = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [pulls, looked]);

  const look = useCallback(() => setLooked((times) => times + 1), []);
  const told = useCallback((jobId: string) => {
    markTold(jobId);
    setWatched((all) => all.filter(({ sent }) => sent.jobId !== jobId));
    setUnread((all) => all.filter((sent) => sent.jobId !== jobId));
  }, []);
  /** Asks a pull to stop; whether it could be asked. */
  const stop = useCallback(
    async (jobId: string): Promise<boolean> => {
      const sender = pulls();
      if (!sender) return false;
      try {
        await sender.jobs.askStop(jobId);
      } catch {
        return false;
      }
      // One that never started is cancelled by the ask; one under way stops at its next look.
      // One gone silent may have no worker left to look: asking the cloud about it ends it there
      // if it is dead (`reapPullJob`), as cancelled, since the stop is now asked.
      const pull = watched.find(({ sent }) => sent.jobId === jobId);
      if (pull && !isRefresh(pull) && pull.job.status === "queued") {
        await askAgain(pull, sender, new Date()).catch(() => undefined);
      } else if (pull && goneSilent(pull.job, Date.now())) {
        await sender.start(jobId).catch(() => undefined);
      }
      setLooked((times) => times + 1);
      return true;
    },
    [pulls, watched]
  );
  /** Asks the cloud to resume a pull: null once it has, or the cloud's words for why not. */
  const resume = useCallback(
    async (jobId: string): Promise<string | null> => {
      const sender = pulls();
      if (!sender?.resume) return null;
      setResuming(jobId);
      try {
        const resumed = await sender.resume(jobId);
        return resumed.ok || resumed.why === "unanswered" ? null : resumed.message;
      } finally {
        setResuming(null);
        look();
      }
    },
    [pulls, look]
  );
  /**
   * Stops showing a pull gone silent on this device, having asked the cloud about it: the ask
   * ends it there if its worker is dead (`reapPullJob`), so no other device shows it running
   * either. Not waited on: the line goes at once, whatever the cloud answers.
   */
  const dismiss = useCallback(
    (jobId: string) => {
      void pulls()
        ?.start(jobId)
        .catch(() => undefined);
      told(jobId);
    },
    [pulls, told]
  );
  const report = useCallback(
    async (jobId: string) => {
      const sender = pulls();
      if (!sender?.jobs.report) throw new Error("The report reader is unavailable.");
      return sender.jobs.report(jobId);
    },
    [pulls]
  );
  return {
    watched,
    unread,
    checkedAt,
    nowMs,
    look,
    told,
    stop,
    resume,
    resuming,
    dismiss,
    report,
  };
};

export type WatchedPulls = Omit<ReturnType<typeof useWatchedPulls>, "report" | "dismiss"> &
  Partial<Pick<ReturnType<typeof useWatchedPulls>, "report" | "dismiss">>;

function SkippedReportButton({
  jobId,
  read,
  partial,
}: {
  jobId: string;
  read: NonNullable<WatchedPulls["report"]>;
  partial: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(false);
    try {
      downloadCsv(`team-import-skipped-${jobId.slice(0, 8)}.csv`, await read(jobId));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className={button.ghost} disabled={busy} onClick={() => void save()}>
        {busy
          ? "Preparing report…"
          : partial
            ? "Download skipped teams so far"
            : "Download skipped teams"}
      </button>
      {error ? (
        <p className="text-amber-800 dark:text-amber-300">
          The report could not be read. Try again.
        </p>
      ) : null}
    </>
  );
}

/**
 * How each of `pulls` is getting on, one line each: how far one on its way has got, with Stop,
 * and how one ended, with OK, after which no tab says it again. One gone silent (`goneSilent`)
 * offers Dismiss as well, and a list's that failed, was stopped or, run by the staged importer,
 * went silent offers Resume (`resumable`). The lines sit in a live region drawn before there is
 * any, since a screen reader may not read out one that arrives already holding its words: a
 * press's first line would be missed.
 */
export function PullLines({
  pulls,
  watching,
  onFailed,
}: {
  pulls: readonly WatchedPull[];
  watching: WatchedPulls;
  /** Told what to say where Stop could not be asked, or the cloud would not resume a pull. */
  onFailed: (message: string) => void;
}) {
  return (
    <div aria-live="polite">
      {pulls.length === 0 ? null : (
        <ul className="mt-4 space-y-2">
          {pulls.map((pull) => {
            const update = describePullUpdate(pull.job, watching.nowMs);
            const metrics = describeImportMetrics(pull.job, watching.nowMs);
            const unread = watching.unread.some((sent) => sent.jobId === pull.sent.jobId);
            const silent = goneSilent(pull.job, watching.nowMs);
            return (
              <li key={pull.sent.jobId} className="text-sm text-slate-600 dark:text-slate-300">
                <span>
                  {unread ? "Last known status: " : ""}
                  {isOver(pull.job) ? describeEnd(pull) : describeProgress(pull, watching.nowMs)}
                </span>{" "}
                {resumable(pull.job, watching.nowMs) ? (
                  <button
                    type="button"
                    className={button.ghost}
                    disabled={watching.resuming === pull.sent.jobId}
                    onClick={() =>
                      void watching.resume(pull.sent.jobId).then((refused) => {
                        if (refused) onFailed(refused);
                      })
                    }
                  >
                    {watching.resuming === pull.sent.jobId
                      ? "Reconnecting…"
                      : pull.job.pipeline
                        ? "Resume saved import"
                        : "Resume with faster importer"}
                  </button>
                ) : null}
                {isOver(pull.job) ? (
                  <button
                    type="button"
                    onClick={() => watching.told(pull.sent.jobId)}
                    className={button.ghost}
                  >
                    OK
                  </button>
                ) : (
                  <>
                    {pull.job.stopAsked ? null : (
                      <button
                        type="button"
                        onClick={() =>
                          void watching.stop(pull.sent.jobId).then((asked) => {
                            if (!asked) onFailed(STOP_FAILED);
                          })
                        }
                        className={button.ghost}
                      >
                        Stop
                      </button>
                    )}
                    {silent ? (
                      <button
                        type="button"
                        onClick={() => (watching.dismiss ?? watching.told)(pull.sent.jobId)}
                        className={button.ghost}
                      >
                        Dismiss
                      </button>
                    ) : null}
                  </>
                )}
                {pull.job.report?.ready && pull.job.report.rows > 0 && watching.report ? (
                  <SkippedReportButton
                    jobId={pull.sent.jobId}
                    read={watching.report}
                    partial={!isOver(pull.job)}
                  />
                ) : null}
                {!isOver(pull.job) ? (
                  <>
                    {metrics ? (
                      <p className="mt-1 text-slate-500 dark:text-slate-400">{metrics}</p>
                    ) : null}
                    <p
                      className={
                        update.stale
                          ? "mt-1 font-semibold text-amber-800 dark:text-amber-300"
                          : "mt-1 text-slate-500 dark:text-slate-400"
                      }
                    >
                      {update.message}
                    </p>
                    {unread ? (
                      <p className="text-amber-800 dark:text-amber-300">
                        Could not confirm the current status. Retrying.
                      </p>
                    ) : null}
                    <p className="mt-1 text-slate-500 dark:text-slate-400">
                      {pull.job.pipeline === "staged-v1"
                        ? `Downloaded and checkpointed: ${pull.job.tally.answered.toLocaleString()} teams. Skipped downloads: ${pull.job.tally.failed.toLocaleString()}${skipsApart(pull.job)}. The finished import is published after the final tidy. Filed so far: `
                        : "Saved so far: "}
                      {pull.job.tally.filed.toLocaleString()} teams;{" "}
                      {pull.job.tally.gamesAdded.toLocaleString()} games added and{" "}
                      {pull.job.tally.gamesUpdated.toLocaleString()} updated.
                    </p>
                  </>
                ) : null}
                {pull.job.pipeline === "staged-v1" ? (
                  <a
                    className="mt-1 block text-blue-600 underline dark:text-blue-400"
                    href={`https://console.cloud.google.com/run/jobs/details/us-central1/team-import/executions?project=${FIREBASE_WEB_CONFIG.projectId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Cloud job details
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Pulls on the live page (1.8): a pasted list, and the catch-ups the server names (the teams
 * nobody could age, the rosters due a look), sent to be pulled in the cloud, with how each is
 * getting on read back while the tab is open and how each ended said once. "Refresh now" is the
 * nightly card's, and said there.
 */
export default function LiveCloudPulls({
  pulls,
  watching,
  locked,
  agelessIds,
  rosterIds,
  playing,
  device,
  now,
}: {
  pulls: () => PullSender | null;
  /** The pulls this device is watching, held by the tab (`useWatchedPulls`). */
  watching: WatchedPulls;
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
  const [loaded, setLoaded] = useState<{ name: string; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const sendingNow = useRef(false);
  const [said, setSaid] = useState<string | null>(null);
  const { look } = watching;

  const paste = useMemo(() => readPaste(loaded?.text ?? text), [loaded, text]);
  const { entries } = paste;
  const tooMany = entries.length > MAX_LIST_TEAMS;
  const warning = pasteWarning(paste);
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
        sender,
        look
      );
      sendingNow.current = false;
      setSending(false);
      if (sent.ok) {
        if (!options.refresh) {
          setText("");
          setLoaded(null);
        }
        look();
      } else {
        setSaid(sent.message);
        // A first start that went unanswered may have queued it: its line is shown too.
        if (sent.watching) look();
      }
    },
    [pulls, device, now, look]
  );

  const sender = pulls();
  // A queued import does not need a fresh rankings board. The server checks access and copy
  // compatibility; an intermittent connection must not hide the CSV controls.
  const blocked = sender ? null : PULLS_SIGNED_OUT;
  const asIds = (ids: readonly string[]) => ids.map((teamId) => ({ teamId }));

  return (
    <div className={`${card} p-5`}>
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Pull teams in the cloud
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Import a CSV file or paste GameChanger team links, ids, or a spreadsheet export. The cloud
        pulls the teams it does not have yet, or a handful pasted by hand again, and files them for
        every device; this page can be closed meanwhile.
      </p>
      {locked && sender ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          You can select an import now. It will keep reconnecting until the cloud confirms it.
        </p>
      ) : null}
      {blocked !== null ? (
        blocked ? (
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{blocked}</p>
        ) : null
      ) : (
        <>
          {loaded ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <span className="font-mono font-bold">{loaded.name}</span>
              <button
                type="button"
                disabled={sending}
                onClick={() => setLoaded(null)}
                className={button.ghost}
              >
                Choose a different file
              </button>
            </div>
          ) : (
            <label className="mt-3 block text-sm font-bold text-slate-600 dark:text-slate-300">
              Teams to pull
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={4}
                className="mt-1 block w-full rounded border border-slate-300 bg-white p-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-900"
              />
            </label>
          )}
          <button
            type="button"
            disabled={sending}
            onClick={() => fileInput.current?.click()}
            className={`${button.ghost} mt-3 mr-3`}
          >
            Import CSV
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="hidden"
            aria-label="Team list CSV"
            disabled={sending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              const reader = new FileReader();
              reader.onerror = () => setSaid("Could not read that file.");
              reader.onload = () => {
                setSaid(null);
                setText("");
                setLoaded({ name: file.name, text: String(reader.result ?? "") });
              };
              reader.readAsText(file);
            }}
          />
          {warning ? (
            <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">{warning}</p>
          ) : null}
          {tooMany ? (
            <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">
              {tooManyTeams(entries.length)}
            </p>
          ) : null}
          <button
            type="button"
            disabled={sending || entries.length === 0 || tooMany}
            aria-busy={sending}
            onClick={() => void send(entries, { refresh: false, years: [] })}
            className={`${button.primary} mt-3`}
          >
            {sending
              ? "Sending and confirming with the cloud…"
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
      {watching.watched.length > 0 || watching.unread.length > 0 ? (
        <div className="mt-4 text-sm">
          <p className="text-slate-500 dark:text-slate-400">
            Progress is checked every 15 seconds while a pull is unfinished.
            {watching.checkedAt === null
              ? ""
              : ` Last status check ${agoFrom(new Date(watching.checkedAt).toISOString(), watching.nowMs)}.`}
          </p>
          <button type="button" onClick={watching.look} className={`${button.ghost} mt-2`}>
            Check progress now
          </button>
          {watching.unread
            .filter((sent) => !watching.watched.some((pull) => pull.sent.jobId === sent.jobId))
            .map((sent) => (
              <p key={sent.jobId} role="status" className="mt-2 text-amber-800 dark:text-amber-300">
                Could not read progress for the pull of {sent.teams.toLocaleString()} teams.
                Retrying.
              </p>
            ))}
        </div>
      ) : null}
      <PullLines
        pulls={watching.watched.filter((pull) => !isRefresh(pull))}
        watching={watching}
        onFailed={setSaid}
      />
    </div>
  );
}
