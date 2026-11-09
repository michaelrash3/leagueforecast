import { useLayoutEffect, useRef, useState } from "react";
import type { FillAdditions, LeagueFillPlan, RecordedRuns } from "../lib/leagueScoreFill";
import { fillQuestionOf } from "../lib/live/leagueAnswers";
import { askLeague, LEAGUE_UNANSWERED, publishedLeague } from "../lib/live/leagueAsk";
import { poolFilled } from "../lib/poolFill";
import type { SeasonStore } from "../lib/seasonStore";
import { loadAgeGroups, loadScoutGamesForSeason, loadScoutTeams } from "../lib/teamRankingsStorage";
import type { GameLog, Matchup, Settings, TeamBase } from "../lib/types";
import { todayIsoDay } from "../lib/date";
import { isFinal } from "../lib/util";
import type { useToast } from "./useToast";
import type { UndoSnapshotControls } from "./useUndoSnapshot";

/**
 * Fill scores' planner, read only when somebody opens it: the page's first download stays within
 * its budget (`bundleBudget.mjs`), and the panel that shows a plan loads it anyway.
 */
const loadScoreFill = () => import("../lib/leagueScoreFill");
type ScoreFillCode = Awaited<ReturnType<typeof loadScoreFill>>;
/** Said when Fill scores' code cannot be fetched, as on a device gone offline before it was. */
const SCORE_FILL_UNLOADED = "Fill scores could not be opened. Try again once connected.";

/** What Fill scores reads of League Standings: the season open, its store and setters, undo and toasts. */
export type ScoreFillInputs = {
  /** Whether Team Rankings is the cloud's for this member, so the server makes the plan. */
  rankingsLive: boolean;
  activeSeasonId: string;
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  settings: Pick<Settings, "defaultGameInnings">;
  seasonStore: SeasonStore;
  setMatchups: (update: (prev: Matchup[]) => Matchup[]) => void;
  setLogs: (update: (prev: Record<string, GameLog>) => Record<string, GameLog>) => void;
  captureUndo: UndoSnapshotControls["capture"];
  restoreUndo: UndoSnapshotControls["restore"];
  /** Shows the recap of the games given, made final just now, as a final marked on the Schedule. */
  recapFinals: (gameIds: readonly string[]) => void;
  showToast: ReturnType<typeof useToast>["show"];
};

/**
 * Fill scores, out of `App.tsx` whole: the plan of the season's scores from the Team Rankings pool,
 * the panel's state while it is open, and applying what the person chose. Called where its code was,
 * so its state and its one layout effect keep their place among the component's.
 */
export function useScoreFill({
  rankingsLive,
  activeSeasonId,
  teams,
  matchups,
  logs,
  settings,
  seasonStore,
  setMatchups,
  setLogs,
  captureUndo,
  restoreUndo,
  recapFinals,
  showToast,
}: ScoreFillInputs) {
  /**
   * Filling this season's scores from the Team Rankings pool — in practice, from a GameChanger
   * pull. The plan is built when the panel opens rather than continuously: it reads the pool off
   * storage, and nothing about it changes while the review is on screen. Where Team Rankings is the
   * cloud's, the server makes the same plan from the season as this device holds it (`league.fill`).
   */
  const [scoreFillPlan, setScoreFillPlan] = useState<LeagueFillPlan | null>(null);
  /*
   * The scores the open plan was made from: a game scored here since, while the server was asked
   * or with the panel open, is not filled over (`applyLeagueScoreFill`).
   */
  const scoreFillSeen = useRef<Record<string, RecordedRuns>>({});
  /*
   * Fill scores' code, in before a plan is shown, so applying one is a single step: no wait between
   * the press and the save for a season to be switched in.
   */
  const scoreFillCode = useRef<ScoreFillCode | null>(null);
  // Asked of the server and not answered yet: the button says so and takes no second press.
  const [scoreFillAsking, setScoreFillAsking] = useState(false);
  // When the publish the open plan was read off went out, where it was one: the panel says so.
  const [scoreFillPublishedAt, setScoreFillPublishedAt] = useState<string | undefined>(undefined);
  // The season open now, for a plan the server answers after another one was switched to.
  const activeSeasonRef = useRef(activeSeasonId);
  useLayoutEffect(() => {
    activeSeasonRef.current = activeSeasonId;
  }, [activeSeasonId]);

  const openScoreFill = () => {
    if (!rankingsLive) {
      const season = activeSeasonId;
      const seen = logs;
      // Worked out from this device's pool, once it is read in (`poolFill.ts`).
      void Promise.all([loadScoreFill(), poolFilled()]).then(
        ([code]) => {
          // Opened for the season it was asked about, not one switched to while its code came in.
          if (season !== activeSeasonRef.current) return;
          scoreFillCode.current = code;
          scoreFillSeen.current = seen;
          setScoreFillPublishedAt(undefined);
          setScoreFillPlan(
            code.planLeagueScoreFill({
              seasonId: season,
              teams,
              matchups,
              logs: seen,
              ageGroups: loadAgeGroups(),
              scoutTeams: loadScoutTeams(),
              scoutGames: loadScoutGamesForSeason(season),
            })
          );
        },
        () => showToast(SCORE_FILL_UNLOADED, { tone: "error" })
      );
      return;
    }
    const season = activeSeasonId;
    const seen = logs;
    setScoreFillAsking(true);
    const question = fillQuestionOf(season, teams, matchups, logs, todayIsoDay());
    // The plan published beside the boards where it is this very question's, which asks the server
    // nothing (`publishedLeague`); the question where it is not.
    const asked: Promise<{ plan: LeagueFillPlan; publishedAt?: string } | null> = publishedLeague
      .fill(question)
      .then((found) =>
        found
          ? { plan: found.answer, publishedAt: found.builtAt }
          : askLeague(question).then((answer) => answer && { plan: answer.plan })
      );
    void Promise.all([asked, loadScoreFill()]).then(
      ([answer, code]) => {
        setScoreFillAsking(false);
        if (!answer) {
          showToast(LEAGUE_UNANSWERED, { tone: "error" });
          return;
        }
        // Opened for the season it was asked about, not one switched to while it was asked.
        if (season !== activeSeasonRef.current) return;
        scoreFillCode.current = code;
        scoreFillSeen.current = seen;
        setScoreFillPlan(answer.plan);
        setScoreFillPublishedAt(answer.publishedAt);
      },
      () => {
        setScoreFillAsking(false);
        showToast(SCORE_FILL_UNLOADED, { tone: "error" });
      }
    );
  };

  const applyScoreFill = (
    matchupIds: string[],
    otherVersion: string[],
    additions?: FillAdditions
  ) => {
    const plan = scoreFillPlan;
    const code = scoreFillCode.current;
    if (!plan || !code) return;
    const {
      applyLeagueScoreFill,
      missingGamesToAdd,
      movedGames,
      movesToApply,
      startsFromFill,
      summarizeLeagueFill,
    } = code;
    const seen = scoreFillSeen.current;
    const innings = settings.defaultGameInnings;
    const result = applyLeagueScoreFill(plan, matchupIds, logs, innings, otherVersion, seen);
    // The schedule as the store holds it this moment, which a game from another device may have
    // reached before this render's `matchups` did.
    const schedule = seasonStore.get().season.matchups;
    // Its own games played on another day than scheduled: moved to the day played, and filled.
    // Paired against the scores as the store holds them this moment, which a keystroke not yet
    // rendered may have reached, and never with a game being filled now.
    const moved = additions?.move?.length
      ? movedGames(plan, schedule, seasonStore.get().season.logs, matchupIds)
      : [];
    const moves = movesToApply(plan, moved, schedule, additions?.move ?? [], innings, {});
    const movedCount = Object.keys(moves.dates).length;
    // Games between the league's clubs the schedule did not have (3.7), each a new game, final.
    const stamp = Date.now();
    const added = additions
      ? missingGamesToAdd(
          plan,
          // The schedule as the store holds it this moment, which a game from another device may
          // have reached before this render's `matchups` did.
          seasonStore.get().season.matchups,
          additions.add,
          additions.swap,
          innings,
          (index) => `game_${stamp}_${index}`,
          Object.keys(moves.dates).length > 0 ? (additions.move ?? []) : []
        )
      : { matchups: [], logs: {} };
    setScoreFillPlan(null);
    // Each matched game without a start takes the pool game's, which orders the day's games; it
    // changes no score, so it is given even where nothing else is filled.
    const giveStarts = () =>
      setMatchups((prev) => {
        const starts = startsFromFill(plan, prev);
        return Object.keys(starts).length === 0
          ? prev
          : prev.map((game) => {
              const startTs = starts[game.id];
              return startTs ? { ...game, startTs } : game;
            });
      });
    if (result.filled === 0 && added.matchups.length === 0 && movedCount === 0) {
      giveStarts();
      showToast(
        result.changed === 0
          ? "Nothing was filled in."
          : `Nothing was filled in: ${
              result.changed === 1
                ? "1 game changed here since, left as it is"
                : `${result.changed} games changed here since, left as they are`
            }.`,
        { tone: "info" }
      );
      return;
    }
    captureUndo(
      added.matchups.length > 0
        ? "Filled scores and added games from Team Rankings"
        : result.filled === 0
          ? "Moved games to the day played, from Team Rankings"
          : "Filled scores from Team Rankings"
    );
    // Filled onto the scores as they are by then, not as this handler saw them.
    if (result.filled > 0)
      setLogs(
        (prev) => applyLeagueScoreFill(plan, matchupIds, prev, innings, otherVersion, seen).logs
      );
    if (added.matchups.length > 0) {
      setMatchups((prev) => [...prev, ...added.matchups]);
      setLogs((prev) => ({ ...prev, ...added.logs }));
    }
    giveStarts();
    if (movedCount > 0) {
      // Each to the day it was played, at the start the pool's game had, never its old day's.
      setMatchups((prev) => prev.map(moves.moved));
      // Written onto each game's log as it is by then, so nothing typed against it is lost.
      setLogs((prev) => ({
        ...prev,
        ...movesToApply(plan, moved, schedule, additions?.move ?? [], innings, prev).logs,
      }));
    }
    // What this made final, for the recap a final marked on the Schedule gives: each game filled
    // that was not final already, and every game added or moved, which go in final. A fill that
    // only wrote over finals made none, and leaves the recap as it was, as a score corrected on
    // the Schedule does.
    const madeFinal = [
      ...matchupIds.filter((id) => !isFinal(logs[id]) && isFinal(result.logs[id])),
      ...added.matchups.map((game) => game.id),
      ...Object.keys(moves.dates),
    ];
    if (madeFinal.length > 0) recapFinals(madeFinal);
    const count = added.matchups.length;
    showToast(
      [
        result.filled > 0 ? summarizeLeagueFill(plan, result.filled, result.changed) : "",
        movedCount > 0
          ? `Moved ${movedCount} game${movedCount === 1 ? "" : "s"} to the day ${movedCount === 1 ? "it was" : "they were"} played.`
          : "",
        count > 0 ? `Added ${count} game${count === 1 ? "" : "s"} between the league's clubs.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      { tone: "undo", actionLabel: "Undo", onAction: restoreUndo }
    );
  };

  return {
    scoreFillPlan,
    scoreFillPublishedAt,
    scoreFillAsking,
    openScoreFill,
    closeScoreFill: () => setScoreFillPlan(null),
    applyScoreFill,
  };
}
