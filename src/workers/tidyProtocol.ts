import {
  tidyPool,
  type GcImportState,
  type PoolTidy,
  type TidyStep,
} from "../lib/gameChangerImport";
import { coerceKeptApart } from "../lib/keptApart";
import { coerceNotThisTeam } from "../lib/notThisTeam";
import { poolHealth, settleableNow, type PoolHealth } from "../lib/poolHealth";
import { poolLists, type PoolLists } from "../lib/poolLists";
import { sweepMarks } from "../lib/obviousFakes";
import { coerceAutoRemovals, type AutoRemoval } from "../lib/autoRemoved";
import { marksChange, type MarksChange } from "../lib/removedForYou";
import type { FewOutsideList } from "../lib/fewOutside";
import { fewOutsideOfPool } from "../lib/fewOutsideLeaders";
import type { LeagueSeasonData } from "../lib/live/allKnown";
import { ageGroupYear, type AgeGroup, type ScoutGame } from "../lib/teamRankings";
import {
  decodePoolGames,
  decodePoolTeams,
  encodeScoutGames,
  encodeScoutTeams,
} from "../lib/teamRankingsCompact";

/**
 * What crosses between the page and the tidy worker, and what the worker does with it. Pure, so
 * it can be tested without a worker; `tidy.worker.ts` only wires it to the message port.
 *
 * Two things about the shape. The pool goes over compact — the form IndexedDB stores — rather than
 * as a structured clone of every object, for the same reason the rankings worker takes it that
 * way: at nationwide scale the objects are several times the size on the wire and were copied in
 * whole on every inspection and every tidy. And the tidy hands back only what it changed. It used
 * to return the whole pool, and a whole pool that has crossed a message port is a copy, so the
 * identity checks that decide what to save — `tidied.teams !== teams` — read every part as changed
 * and saved all three, every time, including after a tidy that found nothing to do. A part the tidy
 * left alone now simply is not in the answer, and `applyTidied` puts the caller's own array back in
 * its place.
 */

/** The pool as it crosses: teams and games compact, age groups as they are (they are few). */
export type PoolWire = { ageGroups: AgeGroup[]; teams: unknown; games: unknown };

export type TidyRequest = {
  kind: "tidy";
  id: number;
  state: PoolWire;
  /**
   * Pairs of GameChanger ids the user has said are two clubs, as stored. The worker has no
   * storage of its own, so a decision it is not told about is a decision it will quietly overrule
   * — the pairing step applies the settled pairs without asking, which is exactly where a "no"
   * has to be honoured.
   */
  apart?: string[];
  /**
   * The names the owner has said are not a club, as stored (`notThisTeam.ts`): told for the same
   * reason, since the refile would otherwise file a refused name straight back onto the club.
   */
  notThisTeam?: string[];
  /**
   * The clubs the owner has said are real, by club id or GameChanger id, as stored, and every club
   * a League Standings team links (`leagueLinkedClubs`): the step that deletes a page whose name
   * says it is no team leaves every one of them, and the worker can read neither itself.
   */
  realClubs?: string[];
  /**
   * The sweep for clubs plainly made up to run on the tidied pool, as the nightly runs it on the
   * cloud copy after its tidy (`obviousFakes.ts`): asked at the end of a pull, where it walks every
   * game of the pool, 1.5 s on the pool of 26 September 2026 at 18:40 and 2.5 s on 11 October's
   * measured in Node, longer on a phone, which belongs on this thread and not the page's.
   */
  sweep?: SweepAsked;
};
/**
 * What the sweep reads, as stored when it was asked: the user's answers it honours and the marks
 * before it. The ages named go as their GameChanger ids, all the sweep asks of them.
 */
export type SweepAsked = {
  today: string;
  realClubs: string[];
  keptApart: string[];
  namedAges: string[];
  marks: AutoRemoval[];
};
/** What a tidy would do, without doing it — the numbers behind the pool health card. */
export type InspectRequest = {
  kind: "inspect";
  id: number;
  state: PoolWire;
  stamp: string;
  /** Today as the page sees it, so "dated after today" is judged by one clock and testable. */
  today: string;
  /** The pairs the user has said are two clubs, which the lists must not offer again. */
  apart?: string[];
  /** The names the owner has said are not a club, which the settle count reads as the tidy does. */
  notThisTeam?: string[];
  /**
   * The clubs taken off as plainly made up that the boards leave out, which the lists leave out
   * too (`poolLists`): a pair of twins offering to fold a removed club into a standing one would
   * put its games back on the boards unsaid.
   */
  leftOut?: string[];
  /** What the year boards are built with beyond the pool, for the leaders with few outside games. */
  boards?: BoardsAsked;
};
export type WorkerRequest = TidyRequest | InspectRequest;

/**
 * What the boards are built with that the pool does not hold, as stored when the look was asked:
 * every page's League Standings season by id (`readSeason`'s answers), and the marks of the clubs
 * taken off as plainly made up. The worker can read neither, and the boards read both, so the
 * leaders with few outside games are worked out only where the page sends them.
 */
export type BoardsAsked = { seasons: Array<[string, LeagueSeasonData]>; marks: AutoRemoval[] };

export type TidyResponse = {
  kind: "tidy";
  id: number;
  /** Only the parts of the pool the tidy changed. Absent means untouched, not empty. */
  changed: Partial<GcImportState>;
  tidy: Omit<PoolTidy, "state">;
  /** What the sweep changed in the marks, where one was asked: null for nothing. */
  marks?: MarksChange | null;
};
/**
 * One step of one pass, sent while the tidy is still running.
 *
 * The tidy is the longest thing this app does — the better part of half a minute on a nationwide
 * pool, and several passes of nine steps each — and it reported nothing until it was over. These
 * are cheap: nine small objects a pass, against a pool of two hundred thousand games crossing the
 * port once at each end.
 *
 * A long step may send more than its start and finish: candidate progress in `step` is a cheap
 * heartbeat. `ms` is stamped here rather than in `tidyPool`, which stays pure.
 */
export type TidyProgressResponse = {
  kind: "tidy-progress";
  id: number;
  step: TidyStep;
  /** Milliseconds since this tidy began, so the slow step is the one that can be seen to be slow. */
  ms: number;
};

export type InspectResponse = {
  kind: "inspect";
  id: number;
  health: PoolHealth;
  settleable: number;
  lists: PoolLists;
  /** The leaders with few outside games, where the look was asked with `boards`. */
  fewOutside?: FewOutsideList;
};

export type WorkerResponse = TidyResponse | InspectResponse | TidyProgressResponse;

export const packPool = (state: GcImportState): PoolWire => ({
  ageGroups: state.ageGroups,
  teams: encodeScoutTeams(state.teams),
  games: encodeScoutGames(state.games),
});

export const unpackPool = (wire: PoolWire): GcImportState => ({
  ageGroups: wire.ageGroups,
  teams: decodePoolTeams(wire.teams),
  games: decodePoolGames(wire.games),
});

/**
 * The tidied pool, as the caller should hold it: what the tidy changed laid over what it was
 * handed, so a part it did not touch is the very array the caller already has — and an identity
 * check downstream reads it as unchanged, which it is.
 */
export const applyTidied = (
  before: GcImportState,
  changed: Partial<GcImportState>
): GcImportState => ({
  ageGroups: changed.ageGroups ?? before.ageGroups,
  teams: changed.teams ?? before.teams,
  games: changed.games ?? before.games,
});

/**
 * The sweep's change to the marks (`sweepMarks`, `marksChange`) on `state`, with what it was asked
 * with: null when it changes nothing. The worker runs it after the tidy, and the page inline where
 * it has no worker, so both read the same.
 */
export const sweepAsked = (state: GcImportState, asked: SweepAsked): MarksChange | null => {
  const before = coerceAutoRemovals(asked.marks);
  const after = sweepMarks(
    state,
    {
      realClubs: new Set(asked.realClubs),
      keptApart: new Set(asked.keptApart),
      namedAges: new Map(asked.namedAges.map((id) => [id, true])),
    },
    before,
    asked.today
  );
  return marksChange(before, after);
};

/**
 * The leaders with few outside games of a pool that crossed the port (`fewOutsideOfPool`): each
 * year's games as storage files them (`saveScoutGames`), by the year of the page each is filed on,
 * in the pool's order, which is a shard's; a season the page sent nothing for, empty, as storage
 * reads one. The worker runs it on a look, and the page inline where it has no worker.
 */
export const fewOutsideAsked = (
  state: GcImportState,
  asked: BoardsAsked,
  today: string
): FewOutsideList => {
  const seasons = new Map(asked.seasons);
  const yearOf = new Map(state.ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  const games = new Map<number | undefined, ScoutGame[]>();
  state.games.forEach((game) => {
    const year = yearOf.get(game.ageGroupId);
    const held = games.get(year);
    if (held) held.push(game);
    else games.set(year, [game]);
  });
  return fewOutsideOfPool({
    ageGroups: state.ageGroups,
    teams: state.teams,
    gamesOfYear: (year) => games.get(year) ?? [],
    readSeason: (seasonId) => seasons.get(seasonId) ?? { teams: [], matchups: [], logs: {} },
    autoRemoved: coerceAutoRemovals(asked.marks),
    today,
  });
};

/** The worker's side of the conversation, as a function of each message it receives. */
export const createTidyHandler =
  (post: (response: WorkerResponse) => void) =>
  (request: WorkerRequest): void => {
    const state = unpackPool(request.state);
    if (request.kind === "inspect") {
      const health = poolHealth(state, request.stamp, request.today);
      post({
        kind: "inspect",
        id: request.id,
        health,
        // Only worth asking when something could be settled; on a tidy pool it is zero and cheap.
        settleable:
          health.standInPlayed === 0
            ? 0
            : settleableNow(state, coerceNotThisTeam(request.notThisTeam)),
        lists: poolLists(
          state,
          coerceKeptApart(request.apart),
          request.today,
          new Set(request.leftOut ?? [])
        ),
        ...(request.boards
          ? { fewOutside: fewOutsideAsked(state, request.boards, request.today) }
          : {}),
      });
      return;
    }
    const from = performance.now();
    const { state: tidied, ...counts } = tidyPool(
      state,
      (step) => post({ kind: "tidy-progress", id: request.id, step, ms: performance.now() - from }),
      coerceKeptApart(request.apart),
      coerceNotThisTeam(request.notThisTeam),
      new Set((request.realClubs ?? []).filter((id): id is string => typeof id === "string"))
    );
    // Identity against the pool as decoded here: a pass that changes nothing hands back the array
    // it was given, and that is the whole test.
    const changed: Partial<GcImportState> = {
      ...(tidied.ageGroups === state.ageGroups ? {} : { ageGroups: tidied.ageGroups }),
      ...(tidied.teams === state.teams ? {} : { teams: tidied.teams }),
      ...(tidied.games === state.games ? {} : { games: tidied.games }),
    };
    post({
      kind: "tidy",
      id: request.id,
      changed,
      tidy: counts,
      ...(request.sweep ? { marks: sweepAsked(tidied, request.sweep) } : {}),
    });
  };
