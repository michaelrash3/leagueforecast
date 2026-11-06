/**
 * The tidy itself: its steps in the order a pass runs them (`TIDY_STEPS`), one pass (`tidyOnce`),
 * passes until nothing moves (`tidyPool`), and the stand-ins nobody names. Split out of
 * `gameChangerImport.ts`, which re-exports what it always exported.
 */

import {
  collapseSameGames,
  filedTeamIds,
  type FoldedRow,
  gcRowId,
  releaseClaim,
  sameStart,
  type ScoutGame,
  type ScoutTeam,
  standUpWithdrawn,
} from "../teamRankings";
import { fillMissingStates } from "../clubStates";
import type { KeptApart } from "../keptApart";
import { mintedIds, type MintedIds, NO_RETIRED, type RetiredIds } from "../teamRankings/retiredIds";
import { NO_REFUSALS, type NotThisTeam } from "../notThisTeam";
import { claimFiledRows } from "./claims";
import {
  dropNotATeam,
  dropNotBaseball,
  dropSchoolTeams,
  NONE_REAL,
  type PoolTidy,
  pruneOutOfSeason,
  relevelFromNames,
  TIDY_MAX_PASSES,
} from "./sweeps";
import type { GcImportState } from "./types";
import { isScored } from "./rows";
import { joinCrossedHalves, joinNamesakeHalves } from "./halves";
import { markCountedElsewhere, markTbdGames, pairSettledSquads } from "./pairings";
import { mergeDuplicateStandIns, refileStandIns, resettleOffLevel } from "./standIns";
import { mergeSameSquadIds, reclaimMisfiled } from "./folds";
import { resolveSlotGames } from "./slots";
import { SHIPPED_TIDY_RULES, type TidyRules } from "./namesakes";

/**
 * The things a tidy pass does, in the order it does them. The order is load-bearing and the
 * comments below say why; this is the same list, named, so a watcher can be told where it is.
 */
export const TIDY_STEPS = [
  "notBaseball",
  "highSchool",
  "notATeam",
  "releveled",
  "stateFilled",
  "pruned",
  "withdrawn",
  "named",
  "joined",
  "namesakeJoined",
  "reclaimed",
  "resettled",
  "refiled",
  "merged",
  "claimed",
  "folded",
  "paired",
  "collapsed",
  "regrouped",
  "countedElsewhere",
  "tbdSlots",
] as const;

export type TidyStepName = (typeof TIDY_STEPS)[number];

/**
 * Whether a tidy actually changed the pool, and so whether it is worth saving.
 *
 * Read off `TIDY_STEPS` rather than written out as a sum, because a sum written out is a list
 * that has to be kept in step with this one by hand — and was not. The caller's version named
 * eight of the eleven, leaving out `notBaseball`, `highSchool` and `resettled`, while the tidy
 * stamp was written whatever happened: a pass whose only effect was deleting wiffle-ball or high
 * school teams stamped the pool as tidied and then did not save it, so the deletions were lost
 * and nothing would redo them until `TIDY_RULES_VERSION` moved.
 *
 * `passes` is not a change — it is at least one on a tidy that found nothing — and `state` is the
 * pool itself, which is why this asks the step list rather than every numeric field.
 */
export const tidyChangedAnything = (tidy: PoolTidy): boolean =>
  TIDY_STEPS.some((step) => tidy[step] > 0) || tidy.idle > 0;

/**
 * One step of one pass, reported twice: once as it starts and once as it finishes.
 *
 * Twice because a step is where the time goes. Reported only on the way out, a step that takes ten
 * seconds shows nothing moving for ten seconds, which is the thing this was built to stop. The
 * step that is *running* is what says the work is alive, and it is the honest signal too: it comes
 * from the worker, so it stops arriving if the worker stops.
 */
export type TidyStep = {
  /** 1-based, as a person counts passes. */
  pass: number;
  step: TidyStepName;
  /** How many rows or teams this step changed. Zero on the way in, since it has not run yet. */
  found: number;
  /** The pool as the step found it, and then as it leaves it. */
  teams: number;
  games: number;
  /** False on the way in, true on the way out. */
  done: boolean;
  /** Candidate progress for a long-running step; absent for ordinary start/finish notices. */
  processed?: number;
  total?: number;
};

/** Told after every step, so a caller can show the work rather than a spinner. */
export type TidyWatcher = (step: TidyStep) => void;

/**
 * How two copies of one row are ranked for keeping: one between two real clubs over one against a
 * stand-in or a slot, then one holding other schedules' rows.
 */
const copyRanks = (teams: readonly ScoutTeam[]) => {
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const real = (game: ScoutGame) =>
    [game.teamAId, game.teamBId].every((id) => {
      const team = teamById.get(id);
      return team !== undefined && !team.placeholder && !team.nameOnly;
    });
  const rank = (game: ScoutGame) =>
    (real(game) ? 2 : 0) + ((game.alsoRows?.length ?? 0) > 0 ? 1 : 0);
  return { real, rank };
};

/**
 * The pool with one game per GameChanger row. One row is one game, and two games standing on one
 * row — under one id, or a game that took over a re-entered row and a refresh's copy of that row
 * under its own id — are that row filed twice: a refresh of one page that could not see the other
 * page's copy. Every pass after this one keys its work on the id, and folding one of the two away
 * took both.
 *
 * The copy kept is the one against two real clubs over one against a stand-in, then one holding the
 * rows folded into it, then the earlier; the last copy with a score gives it that score and start,
 * since a refresh's copy against a stand-in was often the only one carrying a result posted since
 * — kept by the rank alone, the result was dropped on every refresh. Rows folded into a copy that
 * goes are kept on the one that stays.
 */
const withoutRepeatedIds = (state: GcImportState): { state: GcImportState; dropped: number } => {
  const rowOf = (game: ScoutGame) =>
    game.source ? gcRowId(game.source.teamId, game.source.gameId) : game.id;
  const copies = new Map<string, number[]>();
  let repeated = false;
  state.games.forEach((game, at) => {
    const key = rowOf(game);
    const list = copies.get(key);
    if (list) {
      list.push(at);
      repeated = true;
    } else copies.set(key, [at]);
  });
  if (!repeated) return { state, dropped: 0 };
  const { rank } = copyRanks(state.teams);
  const kept = new Map<number, ScoutGame>();
  const gone = new Set<number>();
  copies.forEach((at) => {
    if (at.length < 2) return;
    const games = at.map((i) => state.games[i]!);
    let keepAt = 0;
    games.forEach((game, i) => {
      if (rank(game) > rank(games[keepAt]!)) keepAt = i;
    });
    let game = games[keepAt]!;
    const latest = games
      .slice()
      .reverse()
      .find((copy) => isScored(copy) && !copy.scoreFromB && !copy.scoreFromTwin);
    if (latest && latest !== game && latest.teamAId === game.teamAId) {
      const { scoreFromB: _borrowed, scoreFromTwin: _twin, startTs: _start, ...rest } = game;
      game = {
        ...rest,
        teamAScore: latest.teamAScore!,
        teamBScore: latest.teamBScore!,
        ...(latest.startTs ? { startTs: latest.startTs } : {}),
      };
    }
    const own = rowOf(game);
    const rows = new Map(
      games.flatMap((copy) =>
        (copy.alsoRows ?? []).map(
          (record) => [gcRowId(record.teamId, record.gameId), record] as const
        )
      )
    );
    rows.delete(own);
    rows.delete(game.id);
    if (rows.size > 0) game = { ...game, alsoRows: [...rows.values()] };
    kept.set(at[keepAt]!, game);
    at.forEach((i, n) => {
      if (n !== keepAt) gone.add(i);
    });
  });
  const games = state.games.flatMap((game, at) => (gone.has(at) ? [] : [kept.get(at) ?? game]));
  return { state: { ...state, games }, dropped: gone.size };
};

/**
 * The pool with each GameChanger row in one game, whether it stands as a game or is folded into
 * one (`ScoutGame.alsoRows`).
 *
 * A game played across two ages is filed on one club's page, and the other club's row folded into
 * it there. A refresh of that club's own page cannot see the other page (`pullSections`), so it
 * filed the row again as a game of its own, against a stand-in or a slot where the name found
 * nobody at that level, and the club was credited with one game twice. The regroup
 * (`collapseSameGames`) only compares rows of one pair on one day, and the check above only two
 * games standing on one row, so both copies came through every tidy: on the pool of 26 September
 * 2026, 246 rows stood as a game and sat folded in another, and 10 more sat folded in two.
 *
 * A row folded into two games stays in the one ranked higher (`copyRanks`), or fitting it better.
 * A row standing as a game and folded into another stays standing where the game it stands as is
 * between two real clubs or holds another schedule's row, and comes out of the other game.
 * Otherwise the standing copy is the refresh's, and it goes; its start, day and score — the newest
 * word on the row — go onto the record in the other game, and the regroup then reads that game
 * again.
 *
 * Except where the standing copy says the other game is not this one: its own result has the club
 * winning where the other game's own row has it losing, or tying, or the other way round. Or the
 * other game's only score is the one this row lent it: the other club has posted nothing, so all
 * that ties this row to that game is the club's own word, and its word now names someone else.
 * There the standing copy stays and the row comes out of the other game. Read the other way, a
 * 5-6 loss to "Western 2" was written into another club's 16-3 game as that club winning 6-5, and
 * a 9U club's only result, a tie lent by a row that had since been scored 11-6 against the
 * Diamondbacks, became an 11-6 loss.
 */
const oneRowOnePlace = (state: GcImportState): { state: GcImportState; settled: number } => {
  const standingAt = new Map<string, number>();
  state.games.forEach((game, at) => {
    if (game.source) standingAt.set(gcRowId(game.source.teamId, game.source.gameId), at);
  });
  const heldAt = new Map<string, number[]>();
  state.games.forEach((game, at) =>
    game.alsoRows?.forEach((record) => {
      const key = gcRowId(record.teamId, record.gameId);
      if (standingAt.get(key) === at) return;
      const list = heldAt.get(key);
      if (!list) heldAt.set(key, [at]);
      else if (!list.includes(at)) list.push(at);
    })
  );
  const { real, rank } = copyRanks(state.teams);
  const sign = (runs: number) => Math.sign(runs);
  const ownResult = (game: ScoutGame): number | undefined =>
    isScored(game) && !game.scoreFromB && !game.scoreFromTwin
      ? sign(game.teamAScore! - game.teamBScore!)
      : undefined;
  /** Whether the standing copy says the other game is another game (above). */
  const another = (standing: ScoutGame, other: ScoutGame, record: FoldedRow): boolean => {
    if (other.scoreFromB && record.onSideB) return true;
    const mine = ownResult(standing);
    const theirs = ownResult(other);
    if (mine === undefined || theirs === undefined) return false;
    return mine !== (record.onSideB ? -theirs : theirs);
  };
  const recordIn = (game: ScoutGame, key: string) =>
    game.alsoRows?.find((record) => gcRowId(record.teamId, record.gameId) === key);
  /**
   * Between two games ranked alike, how well one fits the row it holds: its own result agreeing
   * with the row's, then its start the row's. Two real clubs' copies both holding one row is the
   * usual shape of a row folded twice, and a copy whose only score is the row's own fits nothing:
   * 5 Star Coastal Gold's 6-13 sat in CBU Georgia's own 13-6 at 14:00 and in the WA Bulldogs'
   * blank copy at 15:00, the row's own start, and there counted the Bulldogs one more win than
   * GameChanger gives them.
   */
  const fit = (game: ScoutGame, key: string): number => {
    const record = recordIn(game, key)!;
    const theirs = ownResult(game);
    const agrees =
      theirs !== undefined &&
      record.ownScore !== undefined &&
      record.opponentScore !== undefined &&
      (record.onSideB ? -theirs : theirs) === sign(record.ownScore - record.opponentScore);
    return (agrees ? 2 : 0) + (sameStart(game.startTs, record.startTs) ? 1 : 0);
  };

  const dropped = new Set<number>();
  const released = new Map<number, string[]>();
  const rewritten = new Map<number, Map<string, ScoutGame>>();
  const release = (at: number, key: string) => {
    const keys = released.get(at);
    if (keys) keys.push(key);
    else released.set(at, [key]);
  };
  let settled = 0;
  heldAt.forEach((everyHolder, key) => {
    /*
     * A copy the user has thrown out is left as the user left it, and is no copy for the others to
     * be read against: it does not count, so only the copies that do are two. Resolved with the
     * rest, a thrown-out standing copy went and the copy it had been kept out beside counted in its
     * place; left out with the whole row, three copies with one thrown out kept counting twice.
     */
    const counted = (at: number) => !state.games[at]!.excluded;
    const standsAt = standingAt.get(key);
    const standing = standsAt !== undefined && counted(standsAt) ? standsAt : undefined;
    const holders = everyHolder.filter(counted);
    if (holders.length === 0 || (standing === undefined && holders.length < 2)) return;
    settled += 1;
    const ranked = holders.sort(
      (x, y) =>
        rank(state.games[y]!) - rank(state.games[x]!) ||
        fit(state.games[y]!, key) - fit(state.games[x]!, key) ||
        x - y
    );
    const best = ranked[0]!;
    if (standing === undefined) {
      ranked.slice(1).forEach((at) => release(at, key));
      return;
    }
    const copy = state.games[standing]!;
    const other = state.games[best]!;
    const stays =
      real(copy) || (copy.alsoRows?.length ?? 0) > 0 || another(copy, other, recordIn(other, key)!);
    if (stays) {
      ranked.forEach((at) => release(at, key));
      return;
    }
    dropped.add(standing);
    const rewrites = rewritten.get(best) ?? new Map<string, ScoutGame>();
    rewrites.set(key, copy);
    rewritten.set(best, rewrites);
    ranked.slice(1).forEach((at) => release(at, key));
  });
  if (settled === 0) return { state, settled: 0 };

  const games = state.games.flatMap((game, at) => {
    if (dropped.has(at)) return [];
    let next = game;
    released.get(at)?.forEach((key) => {
      const record = recordIn(next, key);
      if (record) next = releaseClaim(next, record);
    });
    const rewrites = rewritten.get(at);
    if (rewrites && next.alsoRows) {
      next = {
        ...next,
        alsoRows: next.alsoRows.map((record) => {
          const copy = rewrites.get(gcRowId(record.teamId, record.gameId));
          return copy ? newestWord(record, copy, next) : record;
        }),
      };
    }
    return [next];
  });
  return { state: { ...state, games }, settled };
};

/**
 * The record of a row, as the refresh's own copy of it (`copy`, standing on it) now has it: its
 * start, its day where that is not the game's, and its score where the copy's own schedule gave
 * one. A score the copy only borrowed is not the row's word, and a row now blank is blank.
 */
const newestWord = (record: FoldedRow, copy: ScoutGame, game: ScoutGame): FoldedRow => {
  const { ownScore: _own, opponentScore: _theirs, startTs: _start, date: _date, ...rest } = record;
  const scored = isScored(copy) && !copy.scoreFromB && !copy.scoreFromTwin;
  return {
    ...rest,
    ...(copy.startTs ? { startTs: copy.startTs } : {}),
    ...(copy.date && copy.date !== game.date ? { date: copy.date } : {}),
    ...(scored ? { ownScore: copy.teamAScore!, opponentScore: copy.teamBScore! } : {}),
  };
};

const tidyOnce = (
  state: GcImportState,
  pass: number,
  watch?: TidyWatcher,
  apart?: KeptApart,
  refused: NotThisTeam = NO_REFUSALS,
  real: ReadonlySet<string> = NONE_REAL,
  rules: TidyRules = SHIPPED_TIDY_RULES,
  minted?: MintedIds
): Omit<PoolTidy, "passes" | "idle"> => {
  /*
   * Reported from here rather than from the passes themselves: each one is a pure function of a
   * pool that knows nothing about being watched, and it should stay that way. A watcher that
   * throws must not take the tidy down with it — half an hour of work is not worth a progress bar.
   */
  const say = (step: TidyStepName, found: number, at: GcImportState, done: boolean) => {
    if (!watch) return;
    try {
      watch({ pass, step, found, teams: at.teams.length, games: at.games.length, done });
    } catch {
      /* never at the tidy's expense */
    }
  };
  /** Going in: no count yet, and the pool as this step found it. */
  const starting = (step: TidyStepName, at: GcImportState) => say(step, 0, at, false);
  /** Coming out: what it changed, and the pool as it leaves it. */
  const finished = (step: TidyStepName, found: number, at: GcImportState) =>
    say(step, found, at, true);
  // Before everything, because a team that should not be here at all should not be settled,
  // folded, paired or levelled first.
  starting("notBaseball", state);
  const kept = dropNotBaseball(state);
  finished("notBaseball", kept.dropped, kept.state);
  // Beside it, and for the same reason: a club that does not belong in the pool should not be
  // settled, folded, paired or levelled first.
  starting("highSchool", kept.state);
  const school = dropSchoolTeams(kept.state);
  finished("highSchool", school.dropped, school.state);
  // And a page that is no team, for the same reason again.
  starting("notATeam", school.state);
  const pages = dropNotATeam(school.state, real, minted);
  finished("notATeam", pages.dropped, pages.state);
  // Then levels, because every pass after it compares them: a side whose level is about to be
  // worked out should be worked out before anything decides whether two rows mean one game.
  starting("releveled", pages.state);
  const levels = relevelFromNames(pages.state);
  finished("releveled", levels.releveled, levels.state);
  // Then where each club is, before every step that reads a namer's state to file what it named.
  starting("stateFilled", levels.state);
  const located = fillMissingStates(levels.state.teams);
  const placedAt = located.filled === 0 ? levels.state : { ...levels.state, teams: located.teams };
  finished("stateFilled", located.filled, placedAt);
  starting("pruned", placedAt);
  const season = pruneOutOfSeason(placedAt);
  finished("pruned", season.pruned, season.state);
  // Before anything settles a stand-in into it or folds a row into it: the game is going.
  starting("withdrawn", season.state);
  const gone = standUpWithdrawn(season.state.games, season.state.ageGroups);
  const standing =
    gone.games !== season.state.games ? { ...season.state, games: gone.games } : season.state;
  finished("withdrawn", gone.withdrawn, standing);
  const repeated = withoutRepeatedIds(standing);
  const onePlace = oneRowOnePlace(repeated.state);
  const unique = { state: onePlace.state, dropped: repeated.dropped + onePlace.settled };
  starting("named", unique.state);
  const named = resolveSlotGames(unique.state, refused);
  finished("named", named.resolved, named.state);
  // Straight after the slots, and for the same reason: two stand-ins joined here are a pair of
  // clubs the passes after it can compare.
  starting("joined", named.state);
  const halves = joinCrossedHalves(named.state);
  finished("joined", halves.joined, halves.state);
  // After the crossed halves, which join a pair whose names each fit the other club, and before
  // every step that reads a copy as a pulled club's: the game it makes holds the named club's own
  // row, which the reclaim and the step after it read as that club's word that it played.
  starting("namesakeJoined", halves.state);
  const namesakes = joinNamesakeHalves(halves.state, refused, rules);
  finished("namesakeJoined", namesakes.joined, namesakes.state);
  starting("reclaimed", namesakes.state);
  const moved = reclaimMisfiled(namesakes.state);
  finished("reclaimed", moved.reclaimed, moved.state);
  // After the fixture, which is better evidence than a level, and before the refile, which then
  // gets a look at whatever this had to leave as a stand-in.
  starting("resettled", moved.state);
  const graded = resettleOffLevel(moved.state, refused, rules, minted);
  finished("resettled", graded.resettled, graded.state);
  starting("refiled", graded.state);
  const placed = refileStandIns(graded.state, refused, rules);
  finished("refiled", placed.refiled, placed.state);
  // After the refile, which files a stand-in's rows onto a club where it can, so only the stand-ins
  // that stay stand-ins are made one; and before the claims, which read the day against them.
  starting("merged", placed.state);
  const doubled = mergeDuplicateStandIns(placed.state);
  finished("merged", doubled.merged, doubled.state);
  // After every step that settles who a row was played against by its name, so a claim is read
  // against what they left — a pair of halves joined, a row reclaimed by its namesake — and before
  // the collapse, which then regroups each claimed row with the copy it went into.
  starting("claimed", doubled.state);
  const claims = claimFiledRows(doubled.state);
  finished("claimed", claims.claimed, claims.state);
  starting("folded", claims.state);
  const squads = mergeSameSquadIds(claims.state, apart);
  finished("folded", squads.merged, squads.state);
  starting("paired", squads.state);
  const seasons = pairSettledSquads(
    squads.state,
    (processed, total, found) => {
      if (!watch) return;
      try {
        watch({
          pass,
          step: "paired",
          found,
          teams: squads.state.teams.length,
          games: squads.state.games.length,
          done: false,
          processed,
          total,
        });
      } catch {
        /* never at the tidy's expense */
      }
    },
    apart
  );
  finished("paired", seasons.paired, seasons.state);
  starting("collapsed", seasons.state);
  const same = collapseSameGames(seasons.state.games, seasons.state.ageGroups);
  const after =
    same.games !== seasons.state.games ? { ...seasons.state, games: same.games } : seasons.state;
  finished("collapsed", same.collapsed + unique.dropped, after);
  // The same pass, reported as its own step: a regroup that folds nothing away is still a change,
  // and one the pool has to be saved for.
  starting("regrouped", after);
  finished("regrouped", same.regrouped, after);
  // Last, once every row that could be the game's own has gone where it goes: what is left
  // standing beside a game both clubs' schedules hold is a copy of it.
  starting("countedElsewhere", after);
  const copies = markCountedElsewhere(after);
  finished("countedElsewhere", copies.marked, copies.state);
  // And beside them, a game against a TBD slot no schedule paired at its start (`markTbdGames`).
  starting("tbdSlots", copies.state);
  const slots = markTbdGames(copies.state);
  finished("tbdSlots", slots.marked, slots.state);
  return {
    state: slots.state,
    named: named.resolved,
    joined: halves.joined,
    namesakeJoined: namesakes.joined,
    folded: squads.merged,
    paired: seasons.paired,
    collapsed: same.collapsed + unique.dropped,
    regrouped: same.regrouped,
    pruned: season.pruned,
    withdrawn: gone.withdrawn,
    reclaimed: moved.reclaimed,
    resettled: graded.resettled,
    refiled: placed.refiled,
    merged: doubled.merged,
    claimed: claims.claimed,
    releveled: levels.releveled,
    stateFilled: located.filled,
    countedElsewhere: copies.marked,
    tbdSlots: slots.marked,
    notBaseball: kept.dropped,
    highSchool: school.dropped,
    notATeam: pages.dropped,
  };
};

/**
 * Runs the passes until a pass finds nothing. Each one changes what the next can see — a slot
 * settled in pass one is the row that lets a second slot settle in pass two — so a single pass
 * left 416 stand-ins that the next pass found, then 54, then 5.
 */
export const tidyPool = (
  state: GcImportState,
  watch?: TidyWatcher,
  /** Pairs the user has already said are two clubs, so the tidy does not join them behind them. */
  apart?: KeptApart,
  /**
   * Names the owner has said are not a club ("Not this team", `notThisTeam.ts`), so no step files a
   * row of one onto the club by the name, and the step that takes a name's rows off a club takes
   * them off it; the club's own schedule listing a game still makes it the club's.
   */
  refused: NotThisTeam = NO_REFUSALS,
  /**
   * The clubs the owner has said are real ("This club is real"), by club id or GameChanger id, so
   * the step that deletes a page whose name says it is no team never deletes one of them; and every
   * caller adds the clubs a League Standings team links (`leagueLinkedClubs`), which only the League
   * pass can see.
   */
  real: ReadonlySet<string> = NONE_REAL,
  /** The rules still being measured (`TidyRules`); every caller but a measurement leaves them. */
  rules: TidyRules = SHIPPED_TIDY_RULES,
  /** The ids the stored pool has let go of (`loadRetiredIds`), which no slot or stand-in is minted as. */
  retired: RetiredIds = NO_RETIRED
): PoolTidy => {
  // One record of the ids taken for the whole run: every one the pool began it with as well as
  // those it let go of before, so a club a step folds or drops is not minted again by a later one.
  const minted = mintedIds(
    state.teams.map((team) => team.id),
    retired
  );
  const total: PoolTidy = {
    state,
    named: 0,
    joined: 0,
    namesakeJoined: 0,
    folded: 0,
    paired: 0,
    collapsed: 0,
    regrouped: 0,
    pruned: 0,
    withdrawn: 0,
    reclaimed: 0,
    resettled: 0,
    refiled: 0,
    merged: 0,
    claimed: 0,
    releveled: 0,
    stateFilled: 0,
    countedElsewhere: 0,
    tbdSlots: 0,
    notBaseball: 0,
    highSchool: 0,
    notATeam: 0,
    idle: 0,
    passes: 0,
  };
  for (let pass = 0; pass < TIDY_MAX_PASSES; pass += 1) {
    const step = tidyOnce(total.state, pass + 1, watch, apart, refused, real, rules, minted);
    total.passes += 1;
    total.state = step.state;
    total.named += step.named;
    total.joined += step.joined;
    total.namesakeJoined += step.namesakeJoined;
    total.folded += step.folded;
    total.paired += step.paired;
    total.collapsed += step.collapsed;
    total.regrouped += step.regrouped;
    total.pruned += step.pruned;
    total.withdrawn += step.withdrawn;
    total.reclaimed += step.reclaimed;
    total.resettled += step.resettled;
    total.refiled += step.refiled;
    total.merged += step.merged;
    total.claimed += step.claimed;
    total.releveled += step.releveled;
    total.stateFilled += step.stateFilled;
    total.countedElsewhere += step.countedElsewhere;
    total.tbdSlots += step.tbdSlots;
    total.notBaseball += step.notBaseball;
    total.highSchool += step.highSchool;
    total.notATeam += step.notATeam;
    const changed =
      step.named +
      step.joined +
      step.namesakeJoined +
      step.folded +
      step.paired +
      step.collapsed +
      step.regrouped +
      step.pruned +
      step.withdrawn +
      step.reclaimed +
      step.resettled +
      step.refiled +
      step.merged +
      step.claimed +
      step.releveled +
      step.stateFilled +
      step.countedElsewhere +
      step.tbdSlots +
      step.notBaseball +
      step.highSchool +
      step.notATeam;
    if (changed === 0) break;
  }
  /*
   * Once the passes are done rather than in each of them: a roster pruned in a pass is a pool that
   * changed, and the tidy went round again to find nothing. On the pool of 24 September 2026 with
   * its 76 put back, that took a tidy with nothing else to do from 11.3 s to 22.9 s.
   */
  const idle = idleStandIns(total.state);
  if (idle.size > 0) {
    total.state = {
      ...total.state,
      teams: total.state.teams.filter((team) => !idle.has(team.id)),
    };
    total.idle = idle.size;
  }
  return total;
};

/**
 * The stand-ins nothing stands on: in no game on either side, with no claimed row to go back to
 * them (`filedTeamIds`), and no page's own team. A step that empties a stand-in takes it out as it
 * goes, but a game or a club the user deletes, or a game dated ahead taken out, leaves its stand-in
 * behind, and only a later step that happened to change something took it: the backup of 24
 * September 2026 held 76, 19 of them bracket slots, each an opponent Pool Health counted.
 */
const idleStandIns = (state: GcImportState): Set<string> => {
  const used = new Set<string>(filedTeamIds(state.games));
  state.games.forEach((game) => {
    used.add(game.teamAId);
    used.add(game.teamBId);
  });
  state.ageGroups.forEach((group) => {
    if (group.myTeamId) used.add(group.myTeamId);
  });
  return new Set(
    state.teams
      .filter(
        (team) =>
          (team.placeholder || team.nameOnly) &&
          !team.gcTeams?.length &&
          !team.isMine &&
          !used.has(team.id)
      )
      .map((team) => team.id)
  );
};
