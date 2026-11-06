/**
 * What the tidy takes off the pool: games out of their squad year, teams that play no baseball,
 * high school squads, and names that are no team, and the levels read again from names. Split out
 * of `gameChangerImport.ts`, which re-exports what it always exported.
 */

import {
  ageFromGradYearInName,
  ageLevelFromName,
  isNotBaseball,
  isSchoolName,
  MIN_HIGH_SCHOOL_AGE,
} from "../gameChangerApi";
import {
  ageGroupLevel,
  ageGroupYear,
  buildScoutTeam,
  filedRowOf,
  type FoldedRow,
  inSquadYear,
  ownPageFor,
  releaseClaim,
  type ScoutGame,
  type ScoutTeam,
  squadYearForGcSeason,
  teamNameKey,
} from "../teamRankings";
import type { MintedIds } from "../teamRankings/retiredIds";
import { notATeamWord } from "../teamNameRules";
import { buildPoolKeyOf } from "./poolIndex";
import type { GcImportState } from "./types";

/**
 * Drops the games dated outside their page's squad year — last year's squad's results, which
 * GameChanger lists under this year's id often enough that a nationwide pull carried three
 * thousand of them. The import refuses them on arrival now; this is the same rule applied to a
 * pool filed before it did, so "Check for doubles" cleans an existing pool the same way.
 */
export const pruneOutOfSeason = (
  state: GcImportState
): { state: GcImportState; pruned: number } => {
  const yearOf = new Map(state.ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  const games = state.games.filter((game) => inSquadYear(game.date, yearOf.get(game.ageGroupId)));
  if (games.length === state.games.length) return { state, pruned: 0 };
  return { state: { ...state, games }, pruned: state.games.length - games.length };
};

/** What one tidy of the pool did, in the order it did it. */
export type PoolTidy = {
  state: GcImportState;
  /** Bracket slots and name-only stand-ins settled from the other team's schedule. */
  named: number;
  /** Games each club filed against a stand-in for the other, joined into one game between them. */
  joined: number;
  /**
   * Games one club filed against a stand-in of the other's very name, and the other against a
   * stand-in or a slot, joined into one game between them, or put back where the two rows no longer
   * read as one (`joinNamesakeHalves`).
   */
  namesakeJoined: number;
  /** Teams folded into a club already here under another GameChanger id. */
  folded: number;
  /** Squads paired on into their next season on the same name, town and state. */
  paired: number;
  /** Rows that were the same game written twice, now one. */
  collapsed: number;
  /**
   * Games whose folded rows were grouped again without a row going: a copy moved to the game it now
   * fits, a borrowed score taken back, or a folded row stood up as a game of its own.
   */
  regrouped: number;
  /** Rows dated outside their squad year, dropped. */
  pruned: number;
  /**
   * Games whose own row their schedule no longer lists, taken away, with the rows folded into each
   * stood up to be placed again (`ScoutGame.withdrawn`).
   */
  withdrawn: number;
  /** Rows moved to the namesake whose own schedule holds the game. */
  reclaimed: number;
  /**
   * Rows taken off a club that plays nowhere near the age they were played at, or in a region
   * nowhere near the club that filed them.
   */
  resettled: number;
  /** Stand-in rows filed onto the one club of that name in the puller's state, or next door. */
  refiled: number;
  /** Stand-ins that were one opponent filed twice, made one (`mergeDuplicateStandIns`). */
  merged: number;
  /**
   * Rows a club's own schedule filed by name that another club's own copy of the game claimed, or
   * that went back to the team they named when the schedules stopped bearing a claim out.
   */
  claimed: number;
  /** Levels read out of a name that had one all along, under rules that came later. */
  releveled: number;
  /** Pulled clubs GameChanger gave no state, given the one their club's other teams are in. */
  stateFilled: number;
  /**
   * Third copies of a game that already counts, set not to count, or counted again once the
   * schedules stop bearing them out (`markCountedElsewhere`).
   */
  countedElsewhere: number;
  /**
   * Scored games against a slot listed as TBD, set not to count, or counted again once the slot is
   * named (`markTbdGames`).
   */
  tbdSlots: number;
  /**
   * Teams deleted for playing a different game — wiffle ball, blitzball or softball — along with
   * their results.
   */
  notBaseball: number;
  /** Teams deleted for playing a high school season, along with their results. */
  highSchool: number;
  /**
   * Pulled clubs deleted because every GameChanger name they carry says the page is no team — a
   * practice, a test, an old page marked do not use — and stand-ins whose one name says so, with
   * their results, bar an old page's games another club's own schedule lists, which stay on that
   * club's record against a slot (`dropNotATeam`).
   */
  notATeam: number;
  /**
   * Stand-ins nothing stands on any more — in no game, with no claimed row to go back to them —
   * taken out of the roster once the passes are done (`idleStandIns`).
   */
  idle: number;
  /** How many passes it took to find nothing more. */
  passes: number;
};

/** The most times the tidy repeats itself. Four passes were enough on a twenty-thousand-team pool. */
export const TIDY_MAX_PASSES = 6;

/**
 * The passes that only make sense once a whole run is in, in the order they depend on each other.
 *
 * Naming the stand-ins first, because a slot the other side's schedule can now name is the pair
 * the next passes match on. Then the clubs holding several GameChanger ids in one pool, folded
 * where they filed the same game. Then the squads whose next season is settled — same name, town
 * and state — paired on. Then the rows those folds made into one game — and any other pair of
 * rows that has come to mean one game — collapsed. Each pass changes what the next one sees, so
 * they run together, and they run over everything rather than the schedules just pulled: the half
 * that settles a stand-in, or proves two ids one squad, may have been here for weeks.
 */
/**
 * Deletes the teams that are not playing baseball, and everything they played.
 *
 * A tidy pass rather than only an import rule, because "leave it out from now on" and "it is not
 * in the pool" are different things. A wiffle team pulled before the rule existed is filed under
 * an ordinary age group with an ordinary-looking record, and it would sit in the 12U table next to
 * clubs it has nothing to do with until somebody noticed it by eye.
 *
 * Its games go with it. A result against a wiffle team is not a baseball result on either side, so
 * deleting the team and leaving the games would hand every club that played one a free win or loss
 * against nobody.
 */
export const dropNotBaseball = (
  state: GcImportState
): { state: GcImportState; dropped: number } => {
  const going = new Set(
    state.teams.filter((team) => isNotBaseball(team.name)).map((team) => team.id)
  );
  return without(state, going);
};

/**
 * Teams and the games either side of them, gone — and a row claimed for another club's copy that
 * its own schedule filed against one of them (`FoldedRow.filedAgainst`): by that schedule it was a
 * game against a team that is going, as the import now refuses to file one, and left on record it
 * would go back to a team that is not there.
 */
const without = (
  state: GcImportState,
  going: ReadonlySet<string>
): { state: GcImportState; dropped: number } => {
  if (going.size === 0) return { state, dropped: 0 };
  return {
    state: {
      ...state,
      teams: state.teams.filter((team) => !going.has(team.id)),
      games: state.games.flatMap((game) => {
        if (going.has(game.teamAId) || going.has(game.teamBId)) return [];
        const filedAgainstGoing = (game.alsoRows ?? []).filter(
          (record) => record.filedAgainst !== undefined && going.has(record.filedAgainst)
        );
        return [filedAgainstGoing.reduce(releaseClaim, game)];
      }),
    },
    dropped: going.size,
  };
};

/**
 * Deletes the high school squads, and everything they played.
 *
 * The same shape as the pass above and for the same reason — "left out from now on" and "not in
 * the pool" are different things, and a varsity side pulled before the rule existed is filed
 * under 18U looking like any other club. But the reason the games go is not the reason wiffle
 * games go, and it is worth being straight about: a travel side really did play the local varsity
 * and that really was a baseball game. It goes because the other half of it is a club this app
 * refuses, and a game with one side missing is not a result, it is a dangling row. Losing the
 * handful of real results that cross the line is the price of not carrying the cluster they lead
 * into, which is a trade this pool makes knowingly.
 *
 * The name only, not the age field: a squad whose name said nothing and whose age field said
 * "Varsity" was never filed in the first place, because the import refuses it on the way in, so
 * there is nothing here for this pass to find.
 *
 * And the name the import read, not the one the pool stores, which has the age taken off
 * (`cleanTeamName`): "Brackenfield Owls 12U V" is held as "Brackenfield Owls V", and the age is
 * the one thing that says a travel club, so read off the stored name the pass deleted a club the
 * import files, and the next pull filed it again. A pulled club goes when every name GameChanger
 * gives it reads as a school's (the club's own name standing in for a link that carries none), as
 * the not-a-team pass reads one; a stand-in, which has only the stored name, unless a row named it
 * at an age under fourteen off an age label (`schoolNamedTravelStandIns`). That mattered from the
 * owner's ruling of 18 October 2026 that a lone V is varsity: on the backup of 11 October the
 * stored names of 11 pulled clubs read so, and the names GameChanger gives 7 of them do not, 6
 * stating an age under 14U and one carrying no lone V at all. A slot, or a club added by hand, is
 * read by its name.
 */
export const dropSchoolTeams = (
  state: GcImportState
): { state: GcImportState; dropped: number } => {
  const travel = schoolNamedTravelStandIns(state);
  const going = state.teams.filter((team) => {
    const links = team.gcTeams ?? [];
    if (links.length > 0) return links.every((link) => isSchoolName(link.name.trim() || team.name));
    return isSchoolName(team.name) && !travel.has(team.id);
  });
  return without(state, new Set(going.map((team) => team.id)));
};

/**
 * The stand-ins whose stored name reads as a school squad's (`isSchoolName`) that some row named at
 * an age under the youngest a freshman is (`MIN_HIGH_SCHOOL_AGE`) read off an age label: a travel
 * club's, as the import read that row, and kept by the tidy's school pass and on the clubs worth
 * pulling.
 *
 * A stand-in is stored under the name a schedule wrote with its age taken off (`cleanTeamName`),
 * and the age stays on the row, as the level the name gave its side (`ScoutGame.ageLevelB`, or A
 * on a row filed the other way round). The import drops a row whose opponent's name reads as a
 * school's, so a row naming a stand-in so without an age came before the rule that drops it.
 *
 * Off an age label, because that is the only age the school rule excuses. The import reads a side's
 * level from a label or, failing one, from a class year read against the page's squad year, and
 * `relevelFromNames` reads the stored name the same way; but `isSchoolName` reads no year, so the
 * import refuses "Quillmoor V 2033" on a 2027 page, the class of 2033 being 12U. The year stays on
 * the stored name, so a row at the very age the name's class year gives on that row's page is read
 * as the year's: the stand-in goes, where kept it stood on the clubs worth pulling while every pull
 * refused it. A label and the year it agrees with cannot be told apart from the year alone once
 * the label is off, and are read as the year. On the backup of 11 October 2026 no row naming such a
 * stand-in carries the age its class year gives, and 2 of the 24 stand-ins a lone V reads had every
 * row name them at an age under fourteen, 3 games in all, none with rows of both kinds.
 */
export const schoolNamedTravelStandIns = (
  state: Pick<GcImportState, "ageGroups" | "teams" | "games">
): ReadonlySet<string> => {
  const school = new Map(
    state.teams
      .filter((team) => team.nameOnly && !team.placeholder && isSchoolName(team.name))
      .map((team) => [team.id, team.name])
  );
  const travel = new Set<string>();
  if (school.size === 0) return travel;
  const squadYear = new Map(state.ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  const labelled = (teamId: string, level: number | undefined, ageGroupId: string) => {
    const name = school.get(teamId);
    if (name === undefined || level === undefined || level >= MIN_HIGH_SCHOOL_AGE) return false;
    const year = squadYear.get(ageGroupId);
    return year === undefined || ageFromGradYearInName(name, year) !== level;
  };
  state.games.forEach((game) => {
    if (labelled(game.teamAId, game.ageLevelA, game.ageGroupId)) travel.add(game.teamAId);
    if (labelled(game.teamBId, game.ageLevelB, game.ageGroupId)) travel.add(game.teamBId);
  });
  return travel;
};

/** No club said to be real: the tidy's default, for a caller with no answers to give it. */
export const NONE_REAL: ReadonlySet<string> = new Set<string>();

/**
 * The ids of the stand-ins among `standIns` that are named, in a pool they play in, after a club
 * the not-a-team tidy spares: the user's own club, a page's own team, or a club in `real` by its
 * id or any of its GameChanger ids.
 *
 * The import files a row of such a club's name as it files any name (the opponent gate reads the
 * club's own names, `carriesWord`). A row the club's own schedule does not bear out, on a day it
 * has no game, goes onto a stand-in of the name, so that stand-in holds the club's rows, and the
 * refile and claim steps settle it as they settle any other stand-in. Deleting it took the club's
 * game, and since no row was marked deleted, the next pull filed the row again against a new
 * stand-in, and the tidy deleted that too. That happened every night, and each night told the owner
 * a practice page had gone.
 *
 * Read the way the gate reads it: by the pool and the name key. A pool holds the clubs its games
 * name and the clubs whose links are filed there. The stand-in's own name is stored cleaned, with
 * no bracket left, so a club of the same key carries the stand-in's word, as the gate requires.
 */
const namedAfterSpared = (
  state: GcImportState,
  standIns: readonly ScoutTeam[],
  pageTeams: ReadonlySet<string>,
  real: ReadonlySet<string>
): Set<string> => {
  const named = new Set<string>();
  if (standIns.length === 0) return named;
  const spared = (team: ScoutTeam): boolean =>
    team.isMine === true ||
    pageTeams.has(team.id) ||
    real.has(team.id) ||
    (team.gcTeams ?? []).some((link) => real.has(link.teamId));
  const poolKeyOf = buildPoolKeyOf(state.ageGroups);
  const byId = new Map(state.teams.map((team) => [team.id, team]));
  const asked = new Set(standIns.map((team) => team.id));
  const keys = new Map<string, string>();
  const nameIn = (pool: string, team: ScoutTeam): string => {
    let key = keys.get(team.id);
    if (key === undefined) {
      key = teamNameKey(team.name);
      keys.set(team.id, key);
    }
    return `${pool}\u0000${key}`;
  };
  /** Each spared club by its pool and name key, as the gate's lookup holds it. */
  const sparedNames = new Set<string>();
  /** The pools each asked stand-in plays in. */
  const poolsOf = new Map<string, Set<string>>();
  state.games.forEach((game) => {
    const pool = poolKeyOf(game.ageGroupId);
    [game.teamAId, game.teamBId].forEach((id) => {
      if (asked.has(id)) {
        const pools = poolsOf.get(id);
        if (pools) pools.add(pool);
        else poolsOf.set(id, new Set([pool]));
        return;
      }
      const team = byId.get(id);
      if (team && spared(team)) sparedNames.add(nameIn(pool, team));
    });
  });
  state.teams.forEach((team) => {
    if (!spared(team)) return;
    (team.gcTeams ?? []).forEach((link) =>
      sparedNames.add(nameIn(poolKeyOf(link.ageGroupId), team))
    );
  });
  standIns.forEach((team) => {
    const pools = [...(poolsOf.get(team.id) ?? [])];
    if (pools.some((pool) => sparedNames.has(nameIn(pool, team)))) named.add(team.id);
  });
  return named;
};

/**
 * Deletes the pulled clubs whose every GameChanger name says the page is no team
 * (`notATeamWord`): a practice, a scrimmage, a test, a tryout, a scorekeeper's or a camera's
 * account, an old page marked void, do not use, delete, duplicate or placeholder; and the
 * stand-ins whose one name says so.
 *
 * A tidy pass beside the import's refusal for the reason the wiffle pass is one: a page pulled
 * before the rule existed sits in its age's table with an ordinary record, and nothing else takes
 * it out. On the backup of 11 October 2026 this deletes 520 pulled clubs, 121 of them old pages;
 * 76 were on a board that day and 237 already off every board by the nightly sweep's marks.
 *
 * A stand-in is read too. The import drops a game against a drop word and files one against an old
 * page on a slot, but an old page's row it already filed keeps its opponent, and a drop word's goes
 * only when its schedule is next pulled (the gate's rows read as no longer listed, `refused` in
 * `importOne`), which for a club pulled seldom is a long time. Left, a practice result filed then
 * went on rating the club that played it, out of every table but in the fit, while the same
 * schedule pulled into a fresh pool had no such game. A word only in a bracket is the pull's alone
 * to find, since a stand-in is stored under the cleaned name. On that backup 130 drop-word
 * stand-ins go with their 166 games against pulled clubs (47 scored), and 56 old-page stand-ins' 85
 * games (16 scored) move onto slots; a full tidy leaves no stand-in of these words, where it left
 * 175. A slot of the name is left: it names nobody, and is what the import files an old page on.
 *
 * Narrower than the wiffle pass in four ways, each because a wrongly deleted club leaves nothing
 * behind to notice it by:
 *
 * - A pulled club or a stand-in, never a slot.
 * - Every one of the club's GameChanger names, as GameChanger gives them on its links, and the
 *   club's own name only for a link that carries none. A club holding one practice id and one real
 *   one is the real one, folded together; and the club's stored name has lost what a bracket said,
 *   "(Practice Squad)", which 33 of the 520 say only there. Two clubs whose stored name has a word
 *   none of their links has are left. A name that is only "Team" and a number is the exception: the
 *   import keeps it as it is, having nothing but an age to clean off it, so a club GameChanger calls
 *   "Team 7" or "Team 7 12U" that the pool holds under another name than "Team 7" was named by
 *   somebody, renamed by hand or merged into a club with a name, and keeps that name, unless that
 *   name says no team too ("Practice", "Team 7 Practice"), which spares nothing. On the backup of
 *   11 October 2026 each of the 31 pulled clubs GameChanger calls so is called so in the pool.
 * - Never the user's own club, a page's own team, or a club in `real` (by club id or any of its
 *   GameChanger ids), a stand-in included: those said to be real, and every club a League
 *   Standings team links, picked or carried onto by its name, which the callers add
 *   (`leagueLinkedClubs`) because only the League pass sees the link. A pick left pointing at a
 *   deleted club is a stale id, and the league's team goes to a namesake. Nor a drop-word stand-in
 *   named after one of those in a pool it plays in (`namedAfterSpared`): the import files a row of
 *   that club's name against such a stand-in on a day the club played nobody, so the stand-in
 *   holds the club's game. Deleted, it lost that game, and every pull filed the row again.
 * - An old page's games another club's own schedule lists are kept, with the old page's side
 *   turned into a slot of its own (`ScoutTeam.placeholder`), as the import now files a game against
 *   one: the result is real and the club that played it keeps it, its opponent out of every table
 *   as every slot is. A drop word's games go with it, as a wiffle team's do: a practice's result is
 *   not a game, on either side. On that backup the 520 clubs held 434 games, 251 scored; 35 are
 *   kept (27 scored), 31 on slots and 4 stood back up against the stand-in their own row named.
 */
export const dropNotATeam = (
  state: GcImportState,
  real: ReadonlySet<string> = NONE_REAL,
  /** The ids the tidy's run has taken (`tidyPool`), which a slot made here adds to. */
  minted?: MintedIds
): { state: GcImportState; dropped: number } => {
  const pageTeams = new Set(
    state.ageGroups.flatMap((group) => (group.myTeamId ? [group.myTeamId] : []))
  );
  const going = new Set<string>();
  /** The going clubs whose names mark an old page, whose games another schedule lists are kept. */
  const oldPages = new Set<string>();
  /** Every GameChanger id of a going club: the rows its own schedules gave, wherever they are. */
  const goingRows = new Set<string>();
  /** The drop-word stand-ins, read against the spared clubs' names before any of them goes. */
  const dropWords: ScoutTeam[] = [];
  state.teams.forEach((team) => {
    const links = team.gcTeams ?? [];
    if (team.isMine || pageTeams.has(team.id) || real.has(team.id)) return;
    if (links.length === 0) {
      // A stand-in, by the one name it has; never a slot, which names nobody (see above).
      if (team.placeholder || !team.nameOnly) return;
      const hit = notATeamWord(team.name);
      if (!hit) return;
      if (hit.opponent === "drop") {
        dropWords.push(team);
        return;
      }
      going.add(team.id);
      oldPages.add(team.id);
      return;
    }
    if (links.some((link) => real.has(link.teamId))) return;
    let slot = false;
    for (const link of links) {
      const hit = notATeamWord(link.name.trim() || team.name);
      if (!hit) return;
      // GameChanger calls it only "Team 7", and the pool calls it something else: somebody named
      // it, by hand or by a merge, and it is that name's club (see above), unless the name they
      // gave it says no team as well.
      if (hit.word === "team" && !notATeamWord(team.name)) return;
      if (hit.opponent === "slot") slot = true;
    }
    going.add(team.id);
    links.forEach((link) => goingRows.add(link.teamId));
    if (slot) oldPages.add(team.id);
  });
  const named = namedAfterSpared(state, dropWords, pageTeams, real);
  dropWords.forEach((team) => {
    if (!named.has(team.id)) going.add(team.id);
  });
  if (going.size === 0) return { state, dropped: 0 };

  const nameOf = new Map(state.teams.map((team) => [team.id, team.name]));
  const used = minted ?? new Set(state.teams.map((team) => team.id));
  const slots: ScoutTeam[] = [];
  /** A slot of its own for each game kept off an old page, as the import makes one per game. */
  const slotFor = (clubId: string): string => {
    const slot = buildScoutTeam(nameOf.get(clubId) ?? "", used, { placeholder: true });
    used.add(slot.id);
    slots.push(slot);
    return slot.id;
  };
  const ownPage = ownPageFor(state.ageGroups);
  /** A row of a going club's own schedule, or one claimed for a copy and filed against one. */
  const goes = (record: FoldedRow) =>
    goingRows.has(record.teamId) ||
    (record.filedAgainst !== undefined && going.has(record.filedAgainst));
  /** `game` without anything a going club's schedule said of it, nor the owner's word naming one. */
  const unsaid = (game: ScoutGame): ScoutGame => {
    const dropped = (game.alsoRows ?? []).filter(goes).reduce(releaseClaim, game);
    const {
      alsoFrom,
      namedByAvatar,
      reportedByB,
      scoreFromB,
      teamAScore,
      teamBScore,
      alsoRows,
      ...rest
    } = dropped;
    const from = (alsoFrom ?? []).filter((schedule) => !goingRows.has(schedule));
    // Side B's own report, and a score lent by it, were the old page's word where it is side B.
    const sideBGoes = going.has(dropped.teamBId);
    const rows = (alsoRows ?? []).map((record) =>
      record.namedByAvatar !== undefined && going.has(record.namedByAvatar)
        ? (({ namedByAvatar: _gone, ...kept }) => kept)(record)
        : record
    );
    return {
      ...rest,
      ...(scoreFromB && sideBGoes
        ? {}
        : {
            ...(teamAScore === undefined ? {} : { teamAScore }),
            ...(teamBScore === undefined ? {} : { teamBScore }),
            ...(scoreFromB ? { scoreFromB } : {}),
          }),
      ...(reportedByB && !sideBGoes ? { reportedByB } : {}),
      ...(namedByAvatar !== undefined && !going.has(namedByAvatar) ? { namedByAvatar } : {}),
      ...(from.length > 0 ? { alsoFrom: from } : {}),
      ...(rows.length > 0 ? { alsoRows: rows } : {}),
    };
  };
  /** `game` with each going side, an old page, on a slot of its own. */
  const onSlots = (game: ScoutGame): ScoutGame => ({
    ...game,
    ...(going.has(game.teamAId) ? { teamAId: slotFor(game.teamAId) } : {}),
    ...(going.has(game.teamBId) ? { teamBId: slotFor(game.teamBId) } : {}),
  });

  const games = state.games.flatMap((game): ScoutGame[] => {
    const a = going.has(game.teamAId);
    const b = going.has(game.teamBId);
    if (!a && !b) {
      // A row claimed for this copy that its own schedule filed against a going club, as `without`.
      const claimed = (game.alsoRows ?? []).filter(
        (record) => record.filedAgainst !== undefined && going.has(record.filedAgainst)
      );
      return [claimed.reduce(releaseClaim, game)];
    }
    const page = a ? game.teamAId : game.teamBId;
    if ((a && b) || !oldPages.has(page)) return [];
    // The other club's own row is the game: what the old page said of it comes off.
    if (game.source === undefined || !goingRows.has(game.source.teamId)) {
      return [onSlots(unsaid(game))];
    }
    /*
     * The old page's own row is the game: it goes, as a row its schedule no longer lists does, and
     * every other schedule's row folded into it stands up as a game of its own, as
     * `standUpWithdrawn` stands one up, facing a slot where it faced an old page. A row claimed
     * here that its own schedule filed against the old page by name is one of them: it stands up
     * against the team it was filed against, the old page, and so on a slot. One that stands up
     * against a page no team at all goes, as every game against one does.
     */
    return (game.alsoRows ?? []).flatMap((record): ScoutGame[] => {
      if (goingRows.has(record.teamId)) return [];
      const stood = ownPage(filedRowOf(game, record));
      const faced = [stood.teamAId, stood.teamBId].filter((id) => going.has(id));
      if (faced.some((id) => !oldPages.has(id))) return [];
      const { namedByAvatar, ...rest } = stood;
      return [
        onSlots({
          ...rest,
          ...(namedByAvatar !== undefined && !going.has(namedByAvatar) ? { namedByAvatar } : {}),
          ...(game.excluded ? { excluded: true } : {}),
          ...(game.event ? { event: game.event } : {}),
        }),
      ];
    });
  });
  return {
    state: {
      ...state,
      teams: [...state.teams.filter((team) => !going.has(team.id)), ...slots],
      games,
    },
    dropped: going.size,
  };
};

/**
 * Levels worked out for what is already in the pool, under the rules as they now stand.
 *
 * Every other pass here is about the shape of the pool. This one is about the rules having
 * changed: reading a graduating class out of a name is new, and everything pulled before it went
 * in was filed by the old reading. A club called "Nationals 2031" that has been sitting in the
 * pool for a month has no level, and every game against it was recorded as a game between equals,
 * because a side with no level falls back to the level of the page the game is filed under.
 *
 * Re-pulling would fix it, but only for the teams that get re-pulled: a club known only from
 * somebody else's schedule has no id of its own to pull, and nothing in the weekly rotation will
 * ever reach it. So the pool is re-read where it stands.
 *
 * A level is only ever *added*, never overwritten: what a pull recorded is what GameChanger said,
 * and this is a reading of a name. And a level is only recorded when it says something the page
 * does not already say — one equal to the page's changes no answer, and writing it anyway would
 * rewrite every row in the pool to say nothing new.
 */
export const relevelFromNames = (
  state: GcImportState
): { state: GcImportState; releveled: number } => {
  const pageYear = new Map<string, number | undefined>();
  const pageLevel = new Map<string, number | undefined>();
  state.ageGroups.forEach((group) => {
    pageYear.set(group.id, ageGroupYear(group));
    pageLevel.set(group.id, ageGroupLevel(group));
  });

  const levelFromName = (name: string, year: number | undefined): number | undefined =>
    ageLevelFromName(name) ?? (year === undefined ? undefined : ageFromGradYearInName(name, year));

  let releveled = 0;

  const teams = state.teams.map((team) => {
    const links = team.gcTeams;
    if (!links || links.length === 0) return team;
    let changed = false;
    const next = links.map((link) => {
      if (link.ageLevel !== undefined) return link;
      const year =
        pageYear.get(link.ageGroupId) ??
        (link.seasonYear === undefined
          ? undefined
          : squadYearForGcSeason(link.season, link.seasonYear));
      const level = levelFromName(link.name, year);
      if (level === undefined) return link;
      changed = true;
      releveled += 1;
      return { ...link, ageLevel: level };
    });
    return changed ? { ...team, gcTeams: next } : team;
  });

  const byId = new Map(teams.map((team) => [team.id, team]));
  const games = state.games.map((game) => {
    const year = pageYear.get(game.ageGroupId);
    const filed = pageLevel.get(game.ageGroupId);
    const side = (teamId: string, current: number | undefined): number | undefined => {
      if (current !== undefined) return undefined;
      const team = byId.get(teamId);
      // A slot names nobody, so there is no name to read.
      if (!team || team.placeholder) return undefined;
      const level = levelFromName(team.name, year);
      return level === undefined || level === filed ? undefined : level;
    };
    const a = side(game.teamAId, game.ageLevelA);
    const b = side(game.teamBId, game.ageLevelB);
    if (a === undefined && b === undefined) return game;
    releveled += (a === undefined ? 0 : 1) + (b === undefined ? 0 : 1);
    return {
      ...game,
      ...(a === undefined ? {} : { ageLevelA: a }),
      ...(b === undefined ? {} : { ageLevelB: b }),
    };
  });

  return releveled === 0
    ? { state, releveled: 0 }
    : { state: { ...state, teams, games }, releveled };
};
