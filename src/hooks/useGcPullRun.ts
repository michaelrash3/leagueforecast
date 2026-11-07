import { type Dispatch, type RefObject, type SetStateAction, useMemo } from "react";
import type { AgeUnknownList } from "../lib/ageUnknown";
import { todayIsoDay } from "../lib/date";
import { isDeletedClub } from "../lib/deletedGames";
import { type GcTeamListEntry, type GcTeamProfile, withListed } from "../lib/gameChangerApi";
import {
  BATCH_SIZE,
  fetchGcTeams,
  PULL_CONCURRENCY,
  PULL_MAX_CONCURRENCY,
} from "../lib/gameChangerClient";
import {
  createGcImporter,
  describeTidy,
  type GcImportOutcome,
  type GcImportState,
  type GcPairingComparison,
  type GcSeasonPairing,
  poolSignature,
  type PoolTidy,
  proposeSeasonPairings,
  summarizeGcImport,
  tidyChangedAnything,
} from "../lib/gameChangerImport";
import {
  type GcPullProgress,
  type GcPullView,
  isPullComplete,
  pullView,
  remainingIds,
  retryableIds,
  settleTeam,
  settleWithoutAsking,
  startPull,
} from "../lib/gameChangerPull";
import {
  checkPulledTeam,
  collectGcImportProblems,
  type GcImportProblem,
} from "../lib/gameChangerReport";
import { type DueRefresh, markRefreshed, type RefreshLog } from "../lib/gameChangerSchedule";
import {
  estimatedMinutes,
  msNow,
  newPullSession,
  nowIso,
  persistLog,
  saveEvery,
} from "../lib/gcPullPacing";
import type { RosterWatchEntry } from "../lib/gcRoster";
import { leagueLinkedClubsOf, retiredWithPicks } from "../lib/live/allKnown";
import type { NamedAges } from "../lib/namedAges";
import { settleRunLists } from "../lib/pullLists";
import {
  type HeldPool,
  heldSnapshot,
  holdingNow,
  holdingPages,
  holdingWholePool,
  type RunPhase,
  type SectionMark,
} from "../lib/pullRun";
import { pullSections } from "../lib/pullSections";
import { endPull, livePull, type PullSession } from "../lib/pullSession";
import { liveSummary, type PullEndReason, type PullLiveSummary } from "../lib/pullTracker";
import type { RefusedClubs } from "../lib/refusedClubs";
import type { MarksChange } from "../lib/removedForYou";
import { readStoredSeason } from "../lib/storage";
import { segmentOn } from "../lib/teamRankings";
import {
  flushPoolWrites,
  loadAgeGroups,
  loadDeletedGames,
  loadDroppedClubs,
  loadKeptApart,
  loadNotThisTeam,
  loadRealClubs,
  loadRetiredIds,
  loadScoutGames,
  loadScoutGamesForPages,
  loadScoutTeams,
  loadTooYoungClubs,
  type PoolHolding,
  saveTidyStamp,
} from "../lib/teamRankingsStorage";
import type { TooYoungClubs } from "../lib/tooYoungClubs";
import type { TidyOutcome, TidyReach } from "./usePoolTidy";
import type { useToast } from "./useToast";

/**
 * Running a GameChanger pull: the teams due, every team, the clubs nobody could age, or the rosters
 * that need a check, whole or one section at a time; each schedule folded in as it arrives, so a
 * stop, or a closed tab, keeps everything already fetched; and the tidy the pool is given after,
 * in the tidy worker. What a run finds goes to the panel's state and, saved, to the pool.
 *
 * GameChangerImportPanel.tsx did all of this among its other values. It moved here whole and is
 * called where it was, so its callbacks keep their place among the panel's and nothing runs in
 * another order.
 */
export type GcPullRunInputs = {
  due: DueRefresh;
  dueLevelsRef: RefObject<number[]>;
  everythingDue: () => DueRefresh;
  heldRef: RefObject<HeldPool>;
  livePoolRef: RefObject<GcImportState>;
  namedAges: NamedAges;
  onInvented: (gcTeamIds: string[]) => void;
  onPersist: (pool: GcImportState, holding?: PoolHolding) => boolean;
  onRefreshLog: (log: RefreshLog) => void;
  onSaveProgress: (progress: GcPullProgress) => void;
  onSwept:
    ((change: MarksChange | null, spared: ReadonlySet<string>) => readonly string[]) | undefined;
  orgAges: Map<string, number>;
  outcomesRef: RefObject<GcImportOutcome[]>;
  parsed: {
    entries: GcTeamListEntry[];
    turnedAway: string[];
    otherSeason: number;
    bySeason: Map<number, number>;
    readable: Set<number>;
    noSeason: number;
    tooYoung: number;
    thrownOut: number;
    notBaseball: number;
    highSchool: number;
    notYouth: number;
    notATeam: number;
    lines: number;
    skipped: string[];
  };
  pool: GcImportState;
  progressRef: RefObject<GcPullProgress | null>;
  refreshLog: RefreshLog;
  rosterDue: RosterWatchEntry[];
  setAgeless: Dispatch<SetStateAction<AgeUnknownList>>;
  setApproved: Dispatch<SetStateAction<Set<string>>>;
  setLive: Dispatch<SetStateAction<PullLiveSummary | null>>;
  setOpenPair: Dispatch<
    SetStateAction<{ key: string; comparison: GcPairingComparison | null } | null>
  >;
  setPairings: Dispatch<SetStateAction<GcSeasonPairing[]>>;
  setPhase: Dispatch<SetStateAction<RunPhase>>;
  setRefused: Dispatch<SetStateAction<RefusedClubs>>;
  setResult: Dispatch<
    SetStateAction<{ summary: string[]; problems: GcImportProblem[]; canRetry: boolean } | null>
  >;
  setStats: Dispatch<SetStateAction<GcPullView | null>>;
  setTooYoung: Dispatch<SetStateAction<TooYoungClubs>>;
  showToast: ReturnType<typeof useToast>["show"];
  split: { fresh: GcTeamListEntry[]; seen: number; refresh: GcTeamListEntry[] };
  tidyInWorker: (
    state: GcImportState,
    reach?: TidyReach,
    sweepOn?: string
  ) => Promise<TidyOutcome | null>;
};

export function useGcPullRun({
  due,
  dueLevelsRef,
  everythingDue,
  heldRef,
  livePoolRef,
  namedAges,
  onInvented,
  onPersist,
  onRefreshLog,
  onSaveProgress,
  onSwept,
  orgAges,
  outcomesRef,
  parsed,
  pool,
  progressRef,
  refreshLog,
  rosterDue,
  setAgeless,
  setApproved,
  setLive,
  setOpenPair,
  setPairings,
  setPhase,
  setRefused,
  setResult,
  setStats,
  setTooYoung,
  showToast,
  split,
  tidyInWorker,
}: GcPullRunInputs) {
  /** Copies the counts out of the live cursor so React has something it can see change. */
  const syncStats = () => {
    if (progressRef.current) setStats(pullView(progressRef.current));
  };

  const persist = (note?: string): boolean => {
    /*
     * The copy and the label come out of one value, so a save cannot be handed one run's pool
     * under another run's name — which in one direction deletes every page the run is not holding
     * and in the other writes a pool it was never given. The copy is shallow and per save rather
     * than per team, which is why the save interval is what it is; see `heldSnapshot`.
     */
    const ok = onPersist(heldSnapshot(heldRef.current), heldRef.current.holding);
    if (!ok) {
      /*
       * No cause named here. A save refuses for more than one reason now — the store being full,
       * and the store declining to take this snapshot as the whole pool — and the caller has
       * already said which on its way to returning false. Guessing "storage full" over the top of
       * that would be the wrong one half the time.
       */
      showToast(`Could not save the pull.${note ? ` ${note}` : ""}`, { tone: "error" });
    }
    return ok;
  };

  /**
   * One section of a sectioned run, and where it sits in the sequence.
   *
   * What the fold holds is not in here: `heldRef` is seeded before the section starts, and a
   * section that reached in to seed it would be a second place that decides what a section holds.
   */
  type RunPart = {
    /** Claimed once, by the sequence, and held to the end. */
    session: PullSession;
    /** Whether the paste and the estimate have been recorded yet. */
    first: boolean;
    /** Whether the tidy, the summary and the review screen fall to this one. */
    last: boolean;
    /** What the whole sequence was asked for, which is not what this section was asked for. */
    asked: number;
    /**
     * Which section of how many this is, for the bar.
     *
     * Passed in rather than set beside the run, because the phase carries it and only the thing
     * entering that phase can set both at once. Set separately, the sequence marked the section
     * while the panel was still on "picking" — where a section mark does not exist — and the run
     * then entered "pulling" with no section at all.
     */
    section: SectionMark;
  };

  /**
   * Runs the pull, or one section of it. Each schedule is folded in as it arrives rather than
   * collected and applied at the end, so stopping — or closing the tab — keeps everything already
   * fetched.
   *
   * `part` is what makes a section a section. Absent, this claims the slot, folds over the whole
   * pool and finishes the run at the bottom — which is what it always did, and is still what a
   * run of one section does. Given, the session is the one the sequence holds, the fold is over
   * whatever `heldRef` was seeded with, and the opening and closing work is done once for the
   * sequence rather than once per section.
   */
  const run = async (
    ids: string[],
    progress: GcPullProgress,
    part?: RunPart
  ): Promise<PullEndReason> => {
    /*
     * Claimed before anything is fetched. A pull survives its panel — closing it hides the run
     * rather than stopping it — so a reopened panel could otherwise start a second, and the two
     * would write whole-pool snapshots over each other while the cursor marked the losers settled.
     *
     * A section does not claim: the sequence claimed once, before the first, and holds it to the
     * end. Six claims would be six chances for something else to take the slot in between and
     * leave half a pool refreshed.
     */
    const session = part?.session ?? newPullSession();
    if (session && part === undefined) {
      /*
       * Seeded here rather than at mount: the slot is claimed, so nothing else can write the pool
       * from now until it is released, and this is the last moment the page's own copy is the
       * newest there is. A section does not seed — the sequence did, before the first of them.
       */
      heldRef.current = holdingNow(heldRef.current, livePoolRef.current);
    }
    if (!session) {
      // What is actually holding it, rather than a guess. A tidy refuses a pull exactly as another
      // pull does, and saying "a pull is already running" when one is not sends somebody looking
      // for a run that does not exist.
      const holder = livePull();
      showToast(
        holder?.kind === "tidy"
          ? "The pool is being tidied. That takes a moment — try again when it finishes."
          : "A pull is already running. Reopen Import to watch it, or stop it there.",
        { tone: "error" }
      );
      return "stopped";
    }
    const last = part?.last ?? true;
    const controller = session.controller;
    /*
     * Released whatever happens from here on. The slot this run holds is what stops a second one
     * starting, so anything that throws between the claim and the release leaves it held for the
     * rest of the page's life — and every later run refused, with nothing running to explain it.
     * `endPull` ignores a session that is no longer the live one, so calling it twice is free.
     */
    let released = false;
    /**
     * Whether this section is the one that ends the run: the last of them, or whichever one
     * something stopped. A run that gave up in its third section is still owed a tidy, a summary
     * and a review screen, and there is no seventh section coming to give it one.
     *
     * Out here with `released` so that a throw before the try body cannot leave the `finally`
     * reading it in its dead zone, where the error it raised would bury the one that got there.
     */
    let ending = last;
    /** Declared out here so the `finally` can take it off again however the run ends. */
    let onVisibility: (() => void) | null = null;
    const giveUpSlot = () => {
      // Not this section's to give up. The sequence releases it once, in its own `finally`, so a
      // section that throws half way still frees the slot without the next one finding it gone.
      if (!ending || released) return;
      released = true;
      endPull(session);
    };
    try {
      /*
       * The record of this run, which outlives the panel with the session that holds it.
       *
       * Wrapped rather than called directly, everywhere it is used. A tracker that throws inside
       * `onProgress` would take the whole run down with it — no final flush, no released slot — and
       * destroying an hour of fetching to record it is exactly backwards. A field it could not write
       * is a blank cell; nothing more.
       */
      const tracker = session.tracker;
      const track = (write: () => void): void => {
        try {
          write();
        } catch {
          /* never at the run's expense */
        }
      };
      const runFrom = msNow();
      /*
       * What the whole sequence was asked for, which is not what this section was asked for. The
       * paste and the estimate are facts about the run, so a sectioned run must not record the
       * last section's numbers as if they were the run's.
       */
      const askedInRun = part?.asked ?? ids.length;
      track(() => {
        tracker?.beginSegment(session.startedAt, ids);
        tracker?.config({
          concurrency: PULL_CONCURRENCY,
          maxConcurrency: PULL_MAX_CONCURRENCY,
          batchSize: BATCH_SIZE,
          saveEvery: saveEvery(heldRef.current.state.games.length),
        });
        if (part === undefined || part.first) {
          tracker?.eta(estimatedMinutes(askedInRun));
          tracker?.paste({
            lines: parsed.lines,
            parsed: parsed.entries.length,
            skipped: parsed.skipped.length,
            skippedSamples: parsed.skipped,
            tooYoung:
              parsed.tooYoung +
              parsed.notBaseball +
              parsed.highSchool +
              parsed.notYouth +
              parsed.notATeam +
              parsed.thrownOut +
              parsed.otherSeason +
              parsed.turnedAway.length,
            alreadyHere: split.seen,
            asked: askedInRun,
          });
        }
      });

      /*
       * An hour against an eleven-minute estimate has two explanations that look identical from the
       * inside — GameChanger was slow, or the tab was in the background and the browser throttled
       * it. Nothing else recorded can tell them apart, and this is six lines.
       */
      let hiddenFrom = document.visibilityState === "hidden" ? msNow() : 0;
      onVisibility = () => {
        if (document.visibilityState === "hidden") {
          hiddenFrom = msNow();
          return;
        }
        if (hiddenFrom === 0) return;
        const spell = msNow() - hiddenFrom;
        hiddenFrom = 0;
        track(() => tracker?.hidden(spell));
      };
      document.addEventListener("visibilitychange", onVisibility);

      /*
       * One fold held open for the whole run. Folding each schedule on its own rebuilt an index of
       * the pool per team, over a pool growing underneath it — quadratic, and on a few thousand
       * teams by far the longest part of a pull.
       */
      // Rows thrown out for being dated ahead of today stay thrown out; see `deletedGames.ts`.
      const importer = createGcImporter(heldRef.current.state, {
        deleted: loadDeletedGames(),
        droppedClubs: loadDroppedClubs(),
        tooYoung: loadTooYoungClubs(),
        // The ages somebody typed on the review card. This is the only call site there is, so
        // leaving it out did not weaken the feature, it turned it off: the answer was stored, the
        // row vanished from the card because the queue hides a team once it is named, and the
        // next pull read an empty map and refused the team for having no age all over again.
        namedAges,
        // The names the owner has said are not a club ("Not this team"), never filed onto it.
        notThisTeam: loadNotThisTeam(),
        // The clubs the owner vouched for, whose name refuses nothing, as the tidy deletes none of
        // them: the real list, and every club a League Standings team links.
        realClubs: new Set([
          ...loadRealClubs(),
          ...leagueLinkedClubsOf(heldRef.current.state, readStoredSeason),
        ]),
        // The run's own seasons, not the panel's: a resumed run files what it was started for.
        ...(progress.seasonYears ? { seasonYears: new Set(progress.seasonYears) } : {}),
        // And the ids the pool let go of, which no club the pull makes is minted as, with those
        // of the clubs League Standings picks that the pool no longer holds.
        retired: retiredWithPicks(loadRetiredIds(), readStoredSeason, heldRef.current.state.teams),
      });
      progressRef.current = progress;
      // The summary is the whole run's, so a section adds to what the sections before it found.
      if (part === undefined || part.first) outcomesRef.current = [];
      /**
       * What the list claimed about each id, beside what GameChanger returned for it, so the report
       * can say which ids do not look like the team that was asked for. Only ids the list described
       * are kept; a bare pasted id claims nothing to check.
       */
      const claimed = new Map(parsed.entries.map((entry) => [entry.teamId, entry]));
      /**
       * Only the ids where the two disagree.
       *
       * The check is the same one the report runs, moved to the moment the answer arrives instead
       * of the end of the run. It used to keep every team pulled — a hundred and sixteen thousand
       * profiles held for hours to report on the few hundred that turn out to be worth reporting —
       * and the whole point of the map is the disagreements, so the agreements are dropped as soon
       * as they are known to be agreements.
       */
      const pulledRef = new Map<string, { entry: GcTeamListEntry; profile: GcTeamProfile }>();
      setPhase({ kind: "pulling", session, section: part?.section ?? null });
      setResult(null);
      setLive(null);
      syncStats();

      // Settled but not yet written. The cursor follows the save, never leads it.
      let unsaved: string[] = [];
      /** Saves so far, so a row can say which one kept it — and where the saving stopped. */
      let flushSeq = 0;
      /** How the run came to an end, settled by whatever ends it and read once at the bottom. */
      let endReason: PullEndReason = "finished";
      // Flushes run one at a time and in order; a batch is never overtaken by the next.
      let flushing: Promise<void> = Promise.resolve();

      /**
       * Writes what has been folded in, then advances the cursor — in that order, and only if the
       * write actually reached the store.
       *
       * Waiting matters because a save can only be *accepted* synchronously: the pool is written to
       * IndexedDB behind the caller, so a cursor that trusted the acknowledgement would mark teams
       * settled that a closed tab then loses, and the resume would skip them for good.
       */
      const flush = (): Promise<void> => {
        if (unsaved.length === 0) return flushing;
        const batch = unsaved;
        const failures = new Map(pendingFailures);
        unsaved = [];
        pendingFailures.clear();

        flushSeq += 1;
        const flushNumber = flushSeq;

        flushing = flushing.then(async () => {
          const from = msNow();
          /*
           * A refused save stops the run, rather than being noted and fetched past.
           *
           * On localStorage this is the only signal there is: writeValue returns whether the value
           * actually landed, while flushPoolWrites can only say whether the pool is usable at all,
           * so a quota refusal reaches here and nowhere else. Carrying on meant hours of fetching
           * that saved nothing, with the cursor never advancing and the progress bar walking
           * backwards 500 at a time on every flush.
           */
          const sample = (ok: boolean) =>
            track(() => {
              tracker?.flushed(
                {
                  flush: flushNumber,
                  second: Math.round((msNow() - runFrom) / 1000),
                  teams: batch.length,
                  settled: progressRef.current?.settled.length ?? 0,
                  poolTeams: heldRef.current.state.teams.length,
                  poolGames: heldRef.current.state.games.length,
                  poolPages: heldRef.current.state.ageGroups.length,
                  ms: msNow() - from,
                  ok,
                },
                batch
              );
              // Written beside the pool rather than inside it, so a record that will not fit can
              // never be the thing that stops the run it is recording.
              const current = tracker?.log();
              if (current) {
                if (tracker) persistLog(tracker, current);
                setLive(
                  liveSummary(current, progressRef.current?.settled.length ?? 0, msNow() - runFrom)
                );
              }
            });

          if (!persist("Stopping, so nothing is fetched that cannot be kept.")) {
            sample(false);
            endReason = "save-refused";
            controller.abort();
            return;
          }
          if (!(await flushPoolWrites())) {
            showToast("Could not save the pull — stopping so nothing is lost.", { tone: "error" });
            sample(false);
            endReason = "save-refused";
            controller.abort();
            return;
          }
          const at = nowIso();
          batch.forEach((teamId) => {
            progressRef.current = settleTeam(
              progressRef.current ?? progress,
              teamId,
              at,
              failures.get(teamId)
            );
          });
          if (progressRef.current) onSaveProgress(progressRef.current);
          sample(true);
        });
        return flushing;
      };

      const pendingFailures = new Map<
        string,
        { reason: GcPullProgress["failures"][number]["reason"]; message: string }
      >();

      await fetchGcTeams(ids, {
        concurrency: PULL_CONCURRENCY,
        maxConcurrency: PULL_MAX_CONCURRENCY,
        // Merged into the run's config, so the report says what the pool grew to.
        onConcurrency: (workers) => track(() => tracker?.config({ workers })),
        signal: controller.signal,
        onHold: (ms, source) => track(() => tracker?.hold(ms, source)),
        onBlocked: () => track(() => tracker?.blocked()),
        onSuppressed: (teamId) => track(() => tracker?.suppressed(teamId)),
        /*
         * Turned away by the proxy for not being on the cloud copy's list: possible only when the
         * browser thought otherwise when the run began (taken off the list meanwhile, say). The
         * teams it asked for stay unsettled, so a resume once signed in asks for them again.
         */
        onMembersOnly: (message) => {
          endReason = "stopped";
          showToast(message, { tone: "error" });
        },
        onRefused: (refusals) =>
          track(() => {
            endReason = "gave-up";
            tracker?.gaveUp(refusals, Math.round((msNow() - runFrom) / 1000));
          }),
        onProgress: ({ teamId, result, attempts, firstFailure }) => {
          track(() =>
            tracker?.answered({
              teamId,
              result,
              attempts,
              ...(firstFailure ? { firstFailure } : {}),
              ...(claimed.get(teamId)?.ageLevel === undefined
                ? {}
                : { listAge: claimed.get(teamId)?.ageLevel }),
            })
          );
          if (result.ok) {
            const entry = claimed.get(teamId);
            /*
             * What the user's own list knows and GameChanger's payload does not, attached here,
             * where both halves are in hand, so the link the import records carries it and the age
             * a league names can file a team GameChanger left ageless (`withListed`).
             */
            const schedule = withListed(result.schedule, entry, orgAges.get(teamId));
            const outcome = importer.add(schedule);
            outcomesRef.current.push(outcome);
            track(() => tracker?.imported(outcome));
            heldRef.current = holdingNow(heldRef.current, importer.state);
            if (entry && checkPulledTeam(entry, result.schedule.profile)) {
              pulledRef.set(teamId, { entry, profile: result.schedule.profile });
            }
          } else {
            pendingFailures.set(teamId, { reason: result.reason, message: result.message });
          }
          unsaved.push(teamId);
          if (unsaved.length >= saveEvery(heldRef.current.state.games.length)) void flush();
          // The cursor only advances on a flush, so the bar counts what is settled plus what is
          // fetched and waiting to be written — otherwise it would sit still between saves.
          const settled = progressRef.current?.settled.length ?? 0;
          const total = progressRef.current?.ids.length ?? ids.length;
          setStats({
            done: Math.min(settled + unsaved.length, total),
            total,
            failed: (progressRef.current?.failures.length ?? 0) + pendingFailures.size,
            fraction: total === 0 ? 0 : Math.min(settled + unsaved.length, total) / total,
          });
        },
      });

      await flush();
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
      track(() => {
        // A spell that is still running when the pull ends is still time the tab was hidden.
        if (hiddenFrom !== 0) tracker?.hidden(msNow() - hiddenFrom);
        tracker?.fetchEnded(nowIso());
        /*
         * Stopped is worked out here rather than recorded when the button was pressed, because the
         * same abort is how a refused save ends a run — and those are very different facts about an
         * hour that produced nothing.
         */
        if (endReason === "finished" && controller.signal.aborted) endReason = "stopped";
        tracker?.endSegment(nowIso(), endReason);
      });
      // A section that finished and is not the last one ends here. Everything below is the run's
      // ending, and a run of six sections has one.
      if (!ending && endReason === "finished") return endReason;
      ending = true;
      // Given up here rather than at the end: what follows is the tidy and the summary, neither of
      // which is a reason to refuse a run somebody starts in the meantime.
      giveUpSlot();
      // Marked only now: a run that was stopped half way has not refreshed those levels.
      if (
        dueLevelsRef.current.length > 0 &&
        progressRef.current &&
        isPullComplete(progressRef.current)
      ) {
        onRefreshLog(markRefreshed(refreshLog, dueLevelsRef.current, new Date()));
      }
      dueLevelsRef.current = [];

      /*
       * Now that every schedule in this run is in: name the stand-ins from the other side's schedule,
       * fold the clubs holding several GameChanger ids, and collapse the rows those folds made into
       * one game. A whole run is the first point at which both halves of each are certainly present.
       */
      /*
       * Back to the whole pool for the ending. A sectioned run has been holding one age page at a
       * time, so `heldRef` is whatever the last section held — and the tidy names stand-ins from
       * the other side's schedule, folds clubs holding several ids and collapses the rows those
       * folds make, none of which it can do without seeing every side. Read back from the store
       * rather than accumulated across the sections, because accumulating it is the thing the
       * sections exist not to do: held all at once it is the 332 MB that was running the tab out
       * of memory, and the fold's index — 253 MB of that — is out of scope by the time this runs.
       */
      if (part !== undefined) {
        heldRef.current = holdingWholePool({
          ...heldRef.current.state,
          games: loadScoutGames(),
        });
      }
      // With the sweep for clubs plainly made up after it, in the worker: 2.5 s of walking every
      // game of the 11 October 2026 pool, measured in Node, which this thread would spend frozen.
      const outcome = await tidyInWorker(heldRef.current.state, {}, todayIsoDay());
      /*
       * Refused only if something else claimed the pool in the moment between this run giving it up
       * and the tidy asking for it. Nothing is lost by skipping it: the stamp is left alone, so the
       * pool still reads as untidied and the next time the app opens on it, it is tidied then.
       */
      const tidy: PoolTidy | null = outcome ? { ...outcome.tidy, state: outcome.state } : null;
      if (tidy) {
        // Stamped before the save lands, so the page does not read the tidied pool as untidied.
        saveTidyStamp(poolSignature(tidy.state));
        // Asked of the step list rather than summed here, where three of the eleven counts were
        // missing and a pass that only deleted teams stamped a pool it did not save.
        if (tidyChangedAnything(tidy)) {
          heldRef.current = holdingNow(heldRef.current, tidy.state);
          if (persist()) await flushPoolWrites();
        }
      }

      // The waiting list, the refusals and the too-young, written; this only shows them.
      const lists = settleRunLists(outcomesRef.current, nowIso());
      setAgeless(lists.ageless);
      if (!lists.agelessSaved) {
        showToast("The list of teams waiting on an age could not be saved — storage is full.", {
          tone: "error",
        });
      }
      if (lists.refused) setRefused(lists.refused);
      if (lists.tooYoung) setTooYoung(lists.tooYoung);
      // Thrown out like a club somebody deleted by hand, which is the page's to do.
      if (lists.invented.length > 0) onInvented(lists.invented);
      // Whenever the sweep ran (`marks` null where it changed nothing): a club it marked before, under
      // a line that only marked, is deleted now (Codex on #469).
      if (outcome && outcome.marks !== undefined) {
        const deleted = onSwept?.(
          outcome.marks,
          new Set([...loadRealClubs(), ...leagueLinkedClubsOf(outcome.state, readStoredSeason)])
        );
        /*
         * The clubs it deleted are gone from storage and not from this run's working copy, which
         * the pairings below are offered from and an approved pairing saves whole: left as it was,
         * pairing any two clubs put the deleted ones and their games back (Codex, #469). Read back
         * from the store, as the whole pool is read back for the ending above.
         */
        if (deleted && deleted.length > 0) {
          heldRef.current = holdingNow(heldRef.current, {
            ageGroups: loadAgeGroups(),
            teams: loadScoutTeams(),
            games: loadScoutGames(),
          });
        }
      }

      track(() => {
        // `outcome.tidy` and not `tidy`: the latter carries the whole tidied pool, and writing that
        // into the record would put a second copy of every game in storage.
        if (outcome) tracker?.tidied(outcome.tidy);
        tracker?.finish(nowIso(), endReason);
        if (tracker) persistLog(tracker, tracker.log());
      });

      const finished = progressRef.current;
      setResult({
        summary: [...summarizeGcImport(outcomesRef.current), ...(tidy ? describeTidy(tidy) : [])],
        problems: collectGcImportProblems(
          finished?.failures ?? [],
          outcomesRef.current,
          new Map(
            parsed.entries.flatMap((entry) => (entry.name ? [[entry.teamId, entry.name]] : []))
          ),
          pulledRef
        ),
        canRetry: finished ? retryableIds(finished).length > 0 : false,
      });
      setPairings(
        proposeSeasonPairings(
          heldRef.current.state.teams,
          heldRef.current.state.games,
          loadKeptApart(),
          heldRef.current.state.ageGroups
        )
      );
      setApproved(new Set());
      setOpenPair(null);
      setPhase({ kind: "review", endReason });
      syncStats();
      return endReason;
    } finally {
      giveUpSlot();
      if (onVisibility) document.removeEventListener("visibilitychange", onVisibility);
    }
  };

  /**
   * Runs a pull as a sequence of sections, one age page at a time.
   *
   * This is the whole point of the exercise. A fold over the whole pool was measured at 332 MB on
   * forty thousand teams and two hundred thousand games — 79 MB of pool and 253 MB of the index
   * the fold builds over it — and that is what has been running the tab out of memory an hour into
   * a nationwide refresh. One age page of six is 99 MB, and the roster, which every section needs
   * in full so that an opponent can be matched at all, is only 25 MB of it. The games are the rest
   * and they scale with how many are held, so holding a sixth of them holds a third of the memory.
   *
   * What it costs is written down in `pullSections` and `saveScoutGamesForGroups`: a section
   * cannot see another page's games while it folds, matching is keyed on the squad year rather
   * than the page, and so one cross-age tournament fixture can arrive twice during a run. The
   * end-of-run tidy runs over the whole pool and collapses them, so it is a state the pool passes
   * through rather than one it is left in.
   */
  const runSectioned = async (asked: string[], started: GcPullProgress): Promise<void> => {
    /*
     * A club thrown out is settled here, without a request, whichever way it arrived: in a run
     * saved before it was thrown out, in a rota or roster run's list, or pasted while the panel
     * held an older list of thrown-out clubs than storage does. Read from storage for that last
     * reason, as the importer below does.
     */
    const dropped = loadDroppedClubs();
    const thrownOut = asked.filter((teamId) => isDeletedClub(dropped, teamId));
    const ids =
      thrownOut.length > 0 ? asked.filter((teamId) => !isDeletedClub(dropped, teamId)) : asked;
    const progress = settleWithoutAsking(started, thrownOut, nowIso());
    if (progress !== started) onSaveProgress(progress);
    const sections = pullSections(ids, pool.teams, pool.ageGroups);
    /*
     * One section is the run. Sectioning a single page would hold exactly what an unsectioned run
     * holds and pay a second fold to arrive there, and — because nothing else is being refreshed
     * alongside it — it would take the duplicate-fixture trade for nothing in return.
     */
    if (sections.length <= 1) {
      await run(ids, progress);
      return;
    }

    /*
     * Claimed here rather than in `run`, and held across every section. Six claims would be six
     * moments where a tidy could take the slot between two sections and leave the pool half
     * refreshed, with the cursor saying the rest was done.
     */
    const session = newPullSession();
    if (!session) {
      const holder = livePull();
      showToast(
        holder?.kind === "tidy"
          ? "The pool is being tidied. That takes a moment — try again when it finishes."
          : "A pull is already running. Reopen Import to watch it, or stop it there.",
        { tone: "error" }
      );
      return;
    }

    // As in `run`: the slot is held from here, so this is the last moment the page's copy is the
    // newest there is, and every section below carries forward from it.
    heldRef.current = holdingNow(heldRef.current, livePoolRef.current);

    try {
      for (const [index, section] of sections.entries()) {
        /*
         * What this section folds over: every team, and only this page's games. The teams have to
         * be whole — an opponent that is not in the roster is a stand-in, and a section that could
         * not see the rest of the country would invent one for half its schedule — and they are
         * nearly free. The games are the cost, so they are this page's and nothing else's.
         */
        /*
         * The pool and its label in one move, because they are one fact: a section that owns pages
         * is authoritative for them and replaces them, and the section of ids nobody has pulled
         * before owns none — it never read a page, so it cannot say what one ought to contain, and
         * can only add. `holdingPages` is where that choice lives now.
         */
        heldRef.current = holdingPages(
          {
            ageGroups: heldRef.current.state.ageGroups,
            teams: heldRef.current.state.teams,
            games: loadScoutGamesForPages(section.ageGroupIds),
          },
          section.ageGroupIds
        );
        // The cursor the sections before it advanced, not the one the run started from: passing
        // the original back would throw away what they settled and have a resume fetch it again.
        const reason = await run(section.teamIds, progressRef.current ?? progress, {
          session,
          first: index === 0,
          last: index === sections.length - 1,
          asked: ids.length,
          section: { index: index + 1, of: sections.length, label: section.label },
        });
        // Stopped, refused or given up. That section did the run's ending on the way out.
        if (reason !== "finished") break;
      }
    } finally {
      heldRef.current = holdingWholePool(heldRef.current.state);
      setPhase((current) => (current.kind === "pulling" ? { ...current, section: null } : current));
      // `endPull` ignores a session that is no longer the live one, so the section that ended the
      // run having already released it costs nothing; a section that threw is why this is here.
      endPull(session);
    }
  };

  /**
   * Pulls the under-strength pages again, and nothing else.
   *
   * Its own button rather than part of the rota: these are a few hundred pages at most and the
   * question about them is different from keeping a schedule current. A page whose roster has
   * grown past nine comes back from this as an ordinary team, and one that has not is asked about
   * again in another fortnight.
   */
  const recheckRosters = () => {
    if (rosterDue.length === 0) return;
    const progress = startPull(
      rosterDue.map((entry) => entry.teamId),
      nowIso(),
      null,
      // Filed only in the season being played, whatever GameChanger now says the page is.
      [segmentOn(todayIsoDay()).year]
    );
    onSaveProgress(progress);
    // Not a rota run, so nothing is marked refreshed when it finishes.
    dueLevelsRef.current = [];
    void runSectioned(remainingIds(progress), progress);
  };

  /**
   * The catch-up day's other job: ask again about the teams nobody could age.
   *
   * The same route they came in on, because that is the only thing that can answer the question —
   * GameChanger may have filled its field in, the club may have renamed the squad, or the team may
   * have played more games against opponents who do name an age. Pulling other clubs cannot help:
   * the names are read off this team's own schedule. Not a rota run, so nothing is marked
   * refreshed when it finishes.
   */
  const runAgeless = () => {
    if (due.agelessIds.length === 0) return;
    /*
     * Filed only in the season being played, as the rota is. The waiting list is not the pool's
     * and outlives a year archived or deleted, so a team from that year was asked about again and
     * filed back onto a page of it. Refused as another season's, it leaves the list too.
     */
    const progress = startPull(due.agelessIds, nowIso(), null, [segmentOn(todayIsoDay()).year]);
    onSaveProgress(progress);
    dueLevelsRef.current = [];
    void runSectioned(remainingIds(progress), progress);
  };

  const runRefresh = (target: DueRefresh) => {
    if (target.teamIds.length === 0) return;
    const progress = startPull(target.teamIds, nowIso(), null);
    onSaveProgress(progress);
    dueLevelsRef.current = target.ageLevels;
    void runSectioned(remainingIds(progress), progress);
  };

  const runDue = () => runRefresh(due);
  /** Everything the cadence covers, whether or not it has already been done today. */
  const runEverything = () => runRefresh(everythingDue());

  /*
   * How many a re-run would cover, worked out only once nothing is due — which is the only time
   * the button that shows it is on screen. While there is work outstanding this stays zero and
   * the walk is not paid at all.
   */
  const forcedCount = useMemo(
    () => (due.teamIds.length === 0 ? everythingDue().teamIds.length : 0),
    [due.teamIds.length, everythingDue]
  );

  /**
   * The end-of-run tidy on its own. It also runs by itself whenever the app opens on a pool it has
   * not tidied, so this is for the person who wants to see it happen now.
   */
  const tidyNow = async () => {
    // From the pool as saved, not the ref: nothing has been pulled since it was handed in.
    const outcome = await tidyInWorker(pool);
    if (!outcome) {
      showToast("Something is already working on the pool — try again when it has finished.", {
        tone: "error",
      });
      return;
    }
    const tidy: PoolTidy = { ...outcome.tidy, state: outcome.state };
    saveTidyStamp(poolSignature(tidy.state));
    const lines = describeTidy(tidy);
    if (lines.length === 0) {
      showToast("Nothing doubled up, nothing to fold.");
      return;
    }
    heldRef.current = holdingNow(heldRef.current, tidy.state);
    if (persist()) {
      await flushPoolWrites();
      showToast(lines.join(" "), { tone: "success" });
    }
  };

  return {
    forcedCount,
    persist,
    recheckRosters,
    runAgeless,
    runDue,
    runEverything,
    runSectioned,
    tidyNow,
  };
}
