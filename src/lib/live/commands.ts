import { ratedMargin, withScoreTyped } from "../teamRankings/games";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings/types";
import { filedTeamIds, gcLinkSquadYear, mergeScoutTeams, unlinkGcTeam } from "../teamRankings";
import { cleanTeamName, normalizeState, teamNameKey } from "../teamRankings/names";
import { ageGroupYear, seasonAtAge, type AgeGroupSeason } from "../teamRankings/seasons";
import { coerceScoutGames, coerceScoutTeams } from "../teamRankingsCompact";
import { coerceAgeGroups } from "../teamRankingsStorage";
import { setClubAge, type ClubAgeState } from "../clubAge";
import { rowsOfGames, scoringRowsOf } from "../deletedGames";
import {
  coerceNamedAges,
  forgetNamedAge,
  nameAge,
  type NamedAge,
  type NamedAges,
} from "../namedAges";
import { withoutClub } from "../unrealClubs";
import { coerceAgeUnknown, type AgeUnknownList, type AgeUnknownTeam } from "../ageUnknown";

/**
 * Team Rankings' edits as commands: what a person asked for, written down so that the same
 * change can be made by this browser on its own store or, later, by the server on the cloud copy,
 * with the same code and the same result (`applyCommand`).
 *
 * A command reads the pool through `PoolRead` and answers with the parts it would write and the
 * command that takes it back (`inverse`). It never reads a clock or makes up an id: whatever a
 * change needs that is not in the pool travels in the command, minted by whoever asked, so that a
 * command run twice, or run on another machine, does the same thing. And it writes only the parts
 * it changes: one year's games, not every year's; the roster as it is stored, never with the
 * teams League Standings makes on the fly (`deriveAllKnown`), whose ids depend on the order the
 * seasons are walked and are not the roster's to keep.
 */

/**
 * The lists of answers the user has given, each kept as a set of ids: clubs said to be real, ages
 * said to be right, pairs kept apart, and what a pull is to refuse: the GameChanger ids of clubs
 * thrown out (`droppedClubs`) and the rows of games thrown out (`deletedGames`).
 */
export type AnswerList = "realClubs" | "ageRight" | "keptApart" | "droppedClubs" | "deletedGames";

const ANSWER_LISTS: readonly AnswerList[] = [
  "realClubs",
  "ageRight",
  "keptApart",
  "droppedClubs",
  "deletedGames",
];

export type PoolCommand =
  /** Nothing: the inverse of a command that changed nothing. */
  | { kind: "none" }
  /** Several commands, in order, as one. */
  | { kind: "batch"; commands: PoolCommand[] }
  /** Ids added to and taken from one of the answer lists. */
  | { kind: "answers"; list: AnswerList; add: string[]; remove: string[] }
  /**
   * A club's state set, or cleared with null. `adopt` is the club as League Standings made it,
   * for a club the roster does not hold yet: that one club joins the roster, and only that one.
   */
  | { kind: "team.state"; teamId: string; state: string | null; adopt?: ScoutTeam }
  /** One GameChanger id taken off a club; the games it brought stay. */
  | { kind: "team.unlinkGc"; teamId: string; gcTeamId: string }
  /** A club's record put back as it was, in its place. */
  | { kind: "team.put"; team: ScoutTeam }
  /**
   * A club taken off the roster: only ever the inverse of one a command added, which the pool held
   * nothing of before.
   */
  | { kind: "team.remove"; teamId: string }
  /** A club put back on the roster at its place: the inverse of `team.remove`. */
  | { kind: "team.insert"; team: ScoutTeam; at: number }
  /**
   * A page's "our team" set, or cleared with null. `adopt` is the club as League Standings made it,
   * for a club the roster does not hold yet: the mark is kept by id, so the club joins the roster.
   */
  | { kind: "page.myTeam"; ageGroupId: string; teamId: string | null; adopt?: ScoutTeam }
  /** A page put back as it was, in its place. */
  | { kind: "group.put"; group: AgeGroup }
  /**
   * Games added at the end of year `year`'s, with the clubs they name that the roster does not hold
   * yet (`adopt`): each a club League Standings made or one typed for the first time, and none
   * other, so a club the games do not name, or one listed twice, is refused. Their ids come with
   * them, minted by whoever added them.
   */
  | { kind: "game.add"; year: number | null; games: ScoutGame[]; adopt: ScoutTeam[] }
  /** Games taken out of year `year`'s. */
  | { kind: "game.remove"; year: number | null; gameIds: string[] }
  /** Games put back into year `year`'s at their places: the inverse of `game.remove`. */
  | { kind: "game.insert"; year: number | null; games: { game: ScoutGame; at: number }[] }
  /**
   * A club taken off a page: the games filed against it there, the page's mark if it was the
   * page's "our team", and the club itself when nothing is left of it anywhere: no game in any
   * year, and no row filed against it that could go back to it.
   */
  | { kind: "club.leavePage"; ageGroupId: string; teamId: string }
  /** A score typed for a game, in squad year `year` (null: the games with no year). */
  | {
      kind: "game.score";
      year: number | null;
      gameId: string;
      teamAScore: number;
      teamBScore: number;
    }
  /** A game kept out of the maths, or put back. */
  | { kind: "game.exclude"; year: number | null; gameId: string; excluded: boolean }
  /** A lopsided score the user vouches for, at the margin it reads now. */
  | { kind: "game.confirm"; year: number | null; gameId: string }
  /** Games' records put back as they were, each in its place. */
  | { kind: "game.put"; year: number | null; games: ScoutGame[] }
  /**
   * A year's games, the roster or the pages put back whole: the inverse of a change that left the
   * records it kept in another order, which a record-by-record inverse could not put back exactly.
   */
  | { kind: "games.set"; year: number | null; games: ScoutGame[] }
  | { kind: "teams.set"; teams: ScoutTeam[] }
  | { kind: "groups.set"; groups: AgeGroup[] }
  /** A page taken away: only ever the inverse of one a command made, and never one a game is on. */
  | { kind: "group.remove"; groupId: string }
  /** A page put back at its place: the inverse of `group.remove`. */
  | { kind: "group.insert"; group: AgeGroup; at: number }
  /** Named ages set (each under its GameChanger id) and taken back. */
  | { kind: "namedAges"; put: NamedAge[]; forget: string[] }
  /**
   * Games thrown out, from whichever years hold them, with the rows that carried their scores
   * remembered (`scoringRowsOf`) so that pulling those schedules again does not file them back.
   */
  | { kind: "games.drop"; gameIds: string[] }
  /**
   * A club thrown out: every game it is in, the rows they stood on remembered, its GameChanger ids
   * refused from now on, and the club itself, except where another club's row was filed against it
   * (`withoutClub`).
   */
  | { kind: "club.drop"; teamId: string }
  /**
   * A League Standings season put on the page of its age, or taken off Team Rankings (null).
   * `pageId` is the id the page gets if there is none for that age yet.
   */
  | { kind: "season.assign"; seasonId: string; season: AgeGroupSeason | null; pageId: string }
  /**
   * A pulled club filed at the age somebody says it plays at in squad year `year`, and held there
   * whatever a later pull says (`setClubAge`, `NamedAge.pinned`). `at` is when it was said;
   * `pageId` the id of the page for that age if there is none yet.
   */
  | { kind: "club.age"; year: number; teamId: string; level: number; at: string; pageId: string }
  /**
   * An age set on a club taken back in squad year `year`: the holds come off and each of its ids
   * goes back to the level the app had it at. `pageId` names any page that has to be made for it
   * (the second and later are `${pageId}-1`, `${pageId}-2`, ...).
   */
  | { kind: "club.ageClear"; year: number; teamId: string; pageId: string }
  /**
   * One club folded into another (`mergeScoutTeams`), every page's mark following it. `adopt` is
   * either club as League Standings made it, when the roster does not hold it yet.
   */
  | { kind: "teams.merge"; fromId: string; intoId: string; adopt: ScoutTeam[] }
  /**
   * A club the roster holds renamed. A name another club it holds already goes by is refused: that
   * is a merge (`teams.merge`), and only the person asking can say which club survives. A club
   * League Standings made takes its name from the league, so it is never renamed here.
   */
  | { kind: "team.rename"; teamId: string; name: string }
  /**
   * Teams taken off the list of those nobody could age (`AgeUnknownList`), by GameChanger id: a
   * club thrown out from it, or a pass of the rows a rule has settled. A pull puts one back if it
   * asks about the team again.
   */
  | { kind: "ageless.forget"; teamIds: string[] }
  /**
   * Rows put back on that list at their places, as they were: the inverse of a forget. A team the
   * list holds again by then (a pull asked about it since) is left as the pull left it, since two
   * rows for one team would be two questions about it for ever.
   */
  | { kind: "ageless.insert"; rows: { entry: AgeUnknownTeam; at: number }[] };

/** The pool as a command reads it: the parts it may change, as storage decodes them. */
export type PoolRead = {
  teams: () => readonly ScoutTeam[];
  groups: () => readonly AgeGroup[];
  /** Every squad year the pool holds games for; null for the games whose page has no year. */
  years: () => readonly (number | null)[];
  /** One squad year's games; null for the games whose page has no year. */
  games: (year: number | null) => readonly ScoutGame[];
  answers: (list: AnswerList) => ReadonlySet<string>;
  /** The ages people have named, by GameChanger id. */
  namedAges: () => NamedAges;
  /** The teams nobody could age, waiting on somebody to say. */
  ageless: () => AgeUnknownList;
};

/** One part of the pool, as a command would leave it. */
export type PoolWrite =
  | { part: "teams"; teams: ScoutTeam[] }
  | { part: "groups"; groups: AgeGroup[] }
  | { part: "games"; year: number | null; games: ScoutGame[] }
  | { part: "answers"; list: AnswerList; ids: Set<string> }
  | { part: "namedAges"; named: Map<string, NamedAge> }
  | { part: "ageless"; list: AgeUnknownTeam[] };

export type Applied = { ok: true; writes: PoolWrite[]; inverse: PoolCommand };

/**
 * Why a command was not applied: what it names is not in the pool (`missing`), or what it asks for
 * is not a change the pool takes (`refused`: a state that is not two letters, a score that is not a
 * count of runs).
 */
export type NotApplied = { ok: false; why: "missing" | "refused" };

export type CommandResult = Applied | NotApplied;

const NONE: PoolCommand = { kind: "none" };
const unchanged = (): Applied => ({ ok: true, writes: [], inverse: NONE });

/** Where a write lands, so that a later write to the same part replaces an earlier one. */
const partKey = (write: PoolWrite): string =>
  write.part === "games"
    ? `games:${write.year ?? "none"}`
    : write.part === "answers"
      ? `answers:${write.list}`
      : write.part;

/** `read` with `writes` laid over it, for the next command of a batch to read. */
const overlay = (read: PoolRead, writes: readonly PoolWrite[]): PoolRead => {
  if (writes.length === 0) return read;
  const teams = writes.filter((write) => write.part === "teams").pop();
  const groups = writes.filter((write) => write.part === "groups").pop();
  const games = new Map(
    writes.flatMap((write) => (write.part === "games" ? [[write.year, write.games] as const] : []))
  );
  const answers = new Map(
    writes.flatMap((write) => (write.part === "answers" ? [[write.list, write.ids] as const] : []))
  );
  const named = writes.filter((write) => write.part === "namedAges").pop();
  const ageless = writes.filter((write) => write.part === "ageless").pop();
  return {
    teams: () => (teams?.part === "teams" ? teams.teams : read.teams()),
    groups: () => (groups?.part === "groups" ? groups.groups : read.groups()),
    // A year a write filled that the pool held nothing for is a year the pool holds now.
    years: () => [
      ...read.years(),
      ...[...games.keys()].filter((year) => !read.years().includes(year)),
    ],
    games: (year) => games.get(year) ?? read.games(year),
    answers: (list) => answers.get(list) ?? read.answers(list),
    namedAges: () => (named?.part === "namedAges" ? named.named : read.namedAges()),
    ageless: () => (ageless?.part === "ageless" ? ageless.list : read.ageless()),
  };
};

/** The last write to each part, in the order of each part's last write. */
const lastPerPart = (writes: readonly PoolWrite[]): PoolWrite[] => {
  const byPart = new Map<string, PoolWrite>();
  writes.forEach((write) => {
    const key = partKey(write);
    byPart.delete(key);
    byPart.set(key, write);
  });
  return [...byPart.values()];
};

const replaceTeam = (teams: readonly ScoutTeam[], teamId: string, next: ScoutTeam): ScoutTeam[] =>
  teams.map((team) => (team.id === teamId ? next : team));

const withState = (team: ScoutTeam, state: string | undefined): ScoutTeam => {
  const { state: _was, ...rest } = team;
  return state ? { ...rest, state } : rest;
};

/** Changes one game of a year, in its place, and says how to put it back. */
const editGame = (
  read: PoolRead,
  year: number | null,
  gameId: string,
  edit: (game: ScoutGame) => ScoutGame
): CommandResult => {
  const games = read.games(year);
  const at = games.findIndex((game) => game.id === gameId);
  const was = games[at];
  if (!was) return { ok: false, why: "missing" };
  // The undo puts a game back by its id, which would put this copy over the other one too.
  if (heldTwice(games, new Set([gameId]))) return { ok: false, why: "refused" };
  const next = edit(was);
  if (next === was) return unchanged();
  const written = games.slice();
  written[at] = next;
  return {
    ok: true,
    writes: [{ part: "games", year, games: written }],
    inverse: { kind: "game.put", year, games: [was] },
  };
};

/** Takes the games named out of a year, and says how to put them back where they were. */
const removeGames = (
  read: PoolRead,
  year: number | null,
  drop: ReadonlySet<string>
): { kept: ScoutGame[]; removed: { game: ScoutGame; at: number }[] } => {
  const kept: ScoutGame[] = [];
  const removed: { game: ScoutGame; at: number }[] = [];
  read.games(year).forEach((game, at) => {
    if (drop.has(game.id)) removed.push({ game, at });
    else kept.push(game);
  });
  return { kept, removed };
};

/** Every club a game names, on either side or as a row filed against it. */
const namedBy = (games: readonly ScoutGame[]): Set<string> => {
  const ids = filedTeamIds(games);
  games.forEach((game) => {
    ids.add(game.teamAId);
    ids.add(game.teamBId);
  });
  return ids;
};

/**
 * Whether every game is filed, by its page, under squad year `year`: storage keeps a game in its
 * page's year whatever year it was written under, so one that is not would land in another year's
 * games, over a record there with its id, and its undo would look for it in the wrong year. A game
 * whose page is not in the pool is filed with the games that have no year, as storage files it.
 */
const inYear = (read: PoolRead, year: number | null, games: readonly ScoutGame[]): boolean => {
  const yearOf = new Map(read.groups().map((group) => [group.id, ageGroupYear(group) ?? null]));
  return games.every((game) => (yearOf.get(game.ageGroupId) ?? null) === year);
};

/** Whether the year holds any of these ids twice, which a change by id could not keep apart. */
const heldTwice = (games: readonly ScoutGame[], ids: ReadonlySet<string>): boolean => {
  const seen = new Set<string>();
  return games.some((game) => {
    if (!ids.has(game.id)) return false;
    if (seen.has(game.id)) return true;
    seen.add(game.id);
    return false;
  });
};

const replaceGroup = (groups: readonly AgeGroup[], next: AgeGroup): AgeGroup[] =>
  groups.map((group) => (group.id === next.id ? next : group));

const withMyTeam = (group: AgeGroup, teamId: string | null): AgeGroup => {
  const { myTeamId: _was, ...rest } = group;
  return teamId === null ? rest : { ...rest, myTeamId: teamId };
};

/**
 * The inverses of a command's steps, as the one command that undoes them all: one flat batch, a
 * batch inside a batch being the same steps in the same order, so an inverse stays shallow enough
 * to be read back from elsewhere (`coerceCommand`).
 */
const undoing = (inverses: readonly PoolCommand[]): PoolCommand => {
  const steps = inverses
    .flatMap((step) => (step.kind === "batch" ? step.commands : [step]))
    .filter((step) => step.kind !== "none");
  return steps.length === 0
    ? NONE
    : steps.length === 1
      ? steps[0]!
      : { kind: "batch", commands: [...steps] };
};

const withExcluded = (game: ScoutGame, excluded: boolean): ScoutGame => {
  if ((game.excluded === true) === excluded) return game;
  const { excluded: _was, ...rest } = game;
  return excluded ? { ...rest, excluded: true } : rest;
};

/** One step of a change, made on the pool as the steps before it left it. */
type Step = (read: PoolRead) => CommandResult;

/** Steps made in order as one change, each reading what the last wrote; undone last first. */
const applySteps = (read: PoolRead, steps: readonly Step[]): CommandResult => {
  const writes: PoolWrite[] = [];
  const inverses: PoolCommand[] = [];
  for (const step of steps) {
    const result = step(overlay(read, writes));
    if (!result.ok) return result;
    writes.push(...result.writes);
    if (result.inverse.kind !== "none") inverses.unshift(result.inverse);
  }
  return { ok: true, writes: lastPerPart(writes), inverse: undoing(inverses) };
};

/**
 * Whether two records hold the same values, whatever order their fields were written in; a field
 * holding undefined is a field not there, as storage keeps it.
 */
/** Whether two values are the same data, whatever order a record's keys came in. */
export const sameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let at = 0; at < a.length; at += 1) if (!sameValue(a[at], b[at])) return false;
    return true;
  }
  // Counted rather than listed: this runs over every record of a pool a worker hands back.
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  let fields = 0;
  for (const key in left) {
    const value = left[key];
    if (value === undefined) continue;
    if (!sameValue(value, right[key])) return false;
    fields += 1;
  }
  for (const key in right) if (right[key] !== undefined) fields -= 1;
  return fields === 0;
};

/**
 * How a list of records went from `before` to `after`, record by record by id: the ids added, the
 * records taken away with their places, and the records changed as they were. Null when that
 * cannot put `before` back exactly: an id twice in either list, or the records both hold standing
 * in another order.
 *
 * A record that is not the same object is compared by its values before it is called changed:
 * work done in a worker (the tidy) comes back decoded, every record a new object, and only the
 * ones it actually changed are its to write.
 */
const listChange = <T extends { id: string }>(before: readonly T[], after: readonly T[]) => {
  const now = new Map(after.map((item) => [item.id, item]));
  const was = new Set(before.map((item) => item.id));
  if (now.size !== after.length || was.size !== before.length) return null;
  const removed: { item: T; at: number }[] = [];
  const changed: T[] = [];
  const kept: string[] = [];
  before.forEach((item, at) => {
    const next = now.get(item.id);
    if (next === undefined) removed.push({ item, at });
    else {
      kept.push(item.id);
      if (next !== item && !sameValue(next, item)) changed.push(item);
    }
  });
  const added: string[] = [];
  let place = 0;
  for (const item of after) {
    if (!was.has(item.id)) added.push(item.id);
    else if (kept[place++] !== item.id) return null;
  }
  return added.length + removed.length + changed.length === 0
    ? "same"
    : { added, removed, changed };
};

/** The parts a change leaves, each given only when the change computed it. */
type After = {
  teams?: readonly ScoutTeam[];
  groups?: readonly AgeGroup[];
  /** Games by squad year; a year the pool holds and this does not name is left as it is. */
  games?: ReadonlyMap<number | null, readonly ScoutGame[]>;
};

/**
 * Where each record a change took away goes back, counted in the list as it stands while the
 * records the change added are still in it: the inverse puts records back before it takes the
 * added ones away (`settle`), so a place counted in the list as it was before would land a record
 * beside the wrong neighbours. The two lists merged, the kept records in the order both hold them.
 */
const placesBack = <T extends { id: string }>(
  before: readonly T[],
  after: readonly T[],
  change: { added: string[]; removed: { item: T; at: number }[] }
): { item: T; at: number }[] => {
  const added = new Set(change.added);
  const removed = new Set(change.removed.map(({ item }) => item.id));
  const places: { item: T; at: number }[] = [];
  let place = 0;
  let a = 0;
  let b = 0;
  while (a < after.length || b < before.length) {
    const next = after[a];
    const was = before[b];
    if (next && added.has(next.id)) a += 1;
    else if (was && removed.has(was.id)) {
      places.push({ item: was, at: place });
      b += 1;
    } else {
      a += 1;
      b += 1;
    }
    place += 1;
  }
  return places;
};

/**
 * The writes that take the pool `read` holds to `after`, each part written only when it changed,
 * and the inverse that puts back exactly what changed: record by record, so that whatever else is
 * changed meanwhile stands through an undo, or the part whole where the records it kept moved.
 *
 * The inverse puts back what the change took away before the games, and takes away what it added
 * after them, clubs outside pages: clubs brought back, then pages (so a page's mark comes back on a
 * club that is there, and the games put back on a page have somewhere to be filed, `inYear`), then
 * the games, then pages taken away (once no game is left on them, `group.remove`), then clubs
 * taken away (once no game and no page's mark names them, `team.remove`). An inverse's own inverse
 * keeps that shape, so an undo can be redone exactly.
 */
const settle = (read: PoolRead, after: After): Applied => {
  const writes: PoolWrite[] = [];
  const clubsBack: PoolCommand[] = [];
  const first: PoolCommand[] = [];
  const games: PoolCommand[] = [];
  const last: PoolCommand[] = [];
  const clubsAway: PoolCommand[] = [];
  if (after.groups) {
    const before = read.groups();
    const change = listChange(before, after.groups);
    if (change !== "same") {
      writes.push({ part: "groups", groups: [...after.groups] });
      if (change === null) first.push({ kind: "groups.set", groups: [...before] });
      else {
        first.push(
          ...change.changed.map((group): PoolCommand => ({ kind: "group.put", group })),
          ...placesBack(before, after.groups, change).map(({ item, at }): PoolCommand => ({
            kind: "group.insert",
            group: item,
            at,
          }))
        );
        last.push(
          ...change.added.map((groupId): PoolCommand => ({ kind: "group.remove", groupId }))
        );
      }
    }
  }
  if (after.teams) {
    const before = read.teams();
    const change = listChange(before, after.teams);
    if (change !== "same") {
      writes.push({ part: "teams", teams: [...after.teams] });
      if (change === null) clubsBack.push({ kind: "teams.set", teams: [...before] });
      else {
        clubsBack.push(
          ...change.changed.map((team): PoolCommand => ({ kind: "team.put", team })),
          ...placesBack(before, after.teams, change).map(({ item, at }): PoolCommand => ({
            kind: "team.insert",
            team: item,
            at,
          }))
        );
        clubsAway.push(
          ...change.added.map((teamId): PoolCommand => ({ kind: "team.remove", teamId }))
        );
      }
    }
  }
  after.games?.forEach((list, year) => {
    const before = read.games(year);
    const change = listChange(before, list);
    if (change === "same") return;
    writes.push({ part: "games", year, games: [...list] });
    games.push(
      change === null
        ? { kind: "games.set", year, games: [...before] }
        : undoing([
            change.added.length > 0 ? { kind: "game.remove", year, gameIds: change.added } : NONE,
            change.changed.length > 0 ? { kind: "game.put", year, games: change.changed } : NONE,
            change.removed.length > 0
              ? {
                  kind: "game.insert",
                  year,
                  games: change.removed.map(({ item, at }) => ({ game: item, at })),
                }
              : NONE,
          ])
    );
  });
  return {
    ok: true,
    writes,
    inverse: undoing([...clubsBack, ...first, ...games, ...last, ...clubsAway]),
  };
};

/** Whether no two pages share an id: a page made under an id one has already would. */
const uniqueIds = (groups: readonly AgeGroup[]): boolean =>
  new Set(groups.map((group) => group.id)).size === groups.length;

/** Every game the pool holds, year after year in the order the pool lists its years. */
const everyGame = (read: PoolRead): ScoutGame[] => read.years().flatMap((year) => read.games(year));

/**
 * Games split by the squad year storage files each under (`ageGroupYear` of its page), every year
 * the pool holds named, so that a year left with no games is written empty.
 */
const byYear = (
  read: PoolRead,
  games: readonly ScoutGame[],
  groups: readonly AgeGroup[]
): Map<number | null, ScoutGame[]> => {
  const yearOf = new Map(groups.map((group) => [group.id, ageGroupYear(group) ?? null]));
  const split = new Map<number | null, ScoutGame[]>(read.years().map((year) => [year, []]));
  games.forEach((game) => {
    const year = yearOf.get(game.ageGroupId) ?? null;
    const list = split.get(year);
    if (list) list.push(game);
    else split.set(year, [game]);
  });
  return split;
};

/** The ids given added to an answer list, as a step. */
const remember =
  (list: AnswerList, ids: readonly string[]): Step =>
  (read) =>
    apply(read, { kind: "answers", list, add: [...ids], remove: [] });

/**
 * The named ages for a club's ids just filed at `level` by hand: each held there (`pinned`), with
 * the level the app had it at kept through a second change, so taking it back reaches the app's.
 */
const pinnedAges = (
  named: NamedAges,
  club: ScoutTeam | undefined,
  gcTeamIds: readonly string[],
  levels: Readonly<Record<string, number>>,
  level: number,
  at: string
): Map<string, NamedAge> => {
  let next = new Map(named);
  gcTeamIds.forEach((gcTeamId) => {
    const link = club?.gcTeams?.find((entry) => entry.teamId === gcTeamId);
    const held = named.get(gcTeamId);
    const was = held?.pinned ? held.was : levels[gcTeamId];
    next = nameAge(next, {
      teamId: gcTeamId,
      level,
      ...(link?.name ? { name: link.name } : {}),
      namedAt: at,
      pinned: true,
      ...(was === undefined ? {} : { was }),
    });
  });
  return next;
};

/** A write of the named ages, and the command that puts back the entries it changed. */
const namedAgesChange = (before: NamedAges, after: ReadonlyMap<string, NamedAge>): Applied => {
  const put: NamedAge[] = [];
  const forget: string[] = [];
  new Set([...before.keys(), ...after.keys()]).forEach((id) => {
    const was = before.get(id);
    const now = after.get(id);
    if (was === now) return;
    if (was === undefined) forget.push(id);
    else put.push(was);
  });
  return put.length + forget.length === 0
    ? unchanged()
    : {
        ok: true,
        writes: [{ part: "namedAges", named: new Map(after) }],
        inverse: { kind: "namedAges", put, forget },
      };
};

/**
 * `read` answering each part from the first time it was asked. The browser's store decodes a year
 * afresh on every read, tens of thousands of games at a time, and a command reads a part more than
 * once (to change it, then to tell what changed); read once, an untouched record is the same
 * object both times, which is the cheap way `listChange` tells it is untouched.
 */
const readOnce = (read: PoolRead): PoolRead => {
  const parts = new Map<string, unknown>();
  const once = <T>(key: string, load: () => T): T => {
    if (!parts.has(key)) parts.set(key, load());
    return parts.get(key) as T;
  };
  return {
    teams: () => once("teams", read.teams),
    groups: () => once("groups", read.groups),
    years: () => once("years", read.years),
    games: (year) => once(`games:${year ?? "none"}`, () => read.games(year)),
    answers: (list) => once(`answers:${list}`, () => read.answers(list)),
    namedAges: () => once("namedAges", read.namedAges),
    ageless: () => once("ageless", read.ageless),
  };
};

/** A pool's roster, pages and games by squad year, whole: what `changeBetween` compares. */
export type PoolParts = {
  teams: readonly ScoutTeam[];
  groups: readonly AgeGroup[];
  games: ReadonlyMap<number | null, readonly ScoutGame[]>;
};

/** A pool held whole, split into the parts a command reads, each year as storage files it. */
export const poolParts = (pool: {
  teams: readonly ScoutTeam[];
  ageGroups: readonly AgeGroup[];
  games: readonly ScoutGame[];
}): PoolParts => {
  const yearOf = new Map(pool.ageGroups.map((group) => [group.id, ageGroupYear(group) ?? null]));
  const games = new Map<number | null, ScoutGame[]>();
  pool.games.forEach((game) => {
    const year = yearOf.get(game.ageGroupId) ?? null;
    const list = games.get(year);
    if (list) list.push(game);
    else games.set(year, [game]);
  });
  return { teams: pool.teams, groups: pool.ageGroups, games };
};

/**
 * The command that makes the change from `before` to `after` record by record: for work done on a
 * copy of the pool (a tidy, a year archived) to be laid onto the pool as it is by the time the
 * work is done, so that a record the work did not touch keeps whatever was changed meanwhile,
 * where saving the copy whole would put back the pool as it was when the work began.
 *
 * It is the inverse of going from `after` back to `before`, which `settle` already knows how to
 * say exactly; a part whose kept records moved is laid down whole.
 *
 * What it costs on the page's own thread, measured on a seeded pool of 258,267 games
 * (`poolFixture`, seed 7, 9,000 clubs a page) decoded afresh as a worker hands it back, one game in
 * a hundred changed: 0.45 s to read the change and 0.1 s to lay it down, where encoding the whole
 * pool for the save it replaces took 0.44 s. Members' tidies leave the browser at the cutover.
 */
export const changeBetween = (before: PoolParts, after: PoolParts): PoolCommand => {
  const years = [...new Set([...before.games.keys(), ...after.games.keys()])];
  const read: PoolRead = {
    teams: () => after.teams,
    groups: () => after.groups,
    years: () => years,
    games: (year) => after.games.get(year) ?? [],
    answers: () => new Set(),
    namedAges: () => new Map(),
    ageless: () => [],
  };
  return settle(read, {
    teams: before.teams,
    groups: before.groups,
    games: new Map(years.map((year) => [year, before.games.get(year) ?? []])),
  }).inverse;
};

/** Makes `command`'s change to the pool `read` holds, or says why it cannot. */
export const applyCommand = (read: PoolRead, command: PoolCommand): CommandResult =>
  apply(readOnce(read), command);

const apply = (read: PoolRead, command: PoolCommand): CommandResult => {
  switch (command.kind) {
    case "none":
      return unchanged();
    case "batch":
      return applySteps(
        read,
        command.commands.map((step) => (pool: PoolRead) => apply(pool, step))
      );
    case "answers": {
      const was = read.answers(command.list);
      const added = command.add.filter((id) => !was.has(id));
      const removed = command.remove.filter((id) => was.has(id) && !command.add.includes(id));
      if (added.length === 0 && removed.length === 0) return unchanged();
      const ids = new Set(was);
      removed.forEach((id) => ids.delete(id));
      added.forEach((id) => ids.add(id));
      return {
        ok: true,
        writes: [{ part: "answers", list: command.list, ids }],
        inverse: { kind: "answers", list: command.list, add: removed, remove: added },
      };
    }
    case "team.state": {
      const state = command.state === null ? undefined : normalizeState(command.state);
      if (command.state !== null && state === undefined) return { ok: false, why: "refused" };
      const teams = read.teams();
      const held = teams.find((team) => team.id === command.teamId);
      if (!held) {
        if (command.adopt?.id !== command.teamId) return { ok: false, why: "missing" };
        // A club League Standings made, given no state: nothing for the roster to keep.
        if (state === undefined) return unchanged();
        // A club League Standings made: it joins the roster, under the id it was shown with, and
        // keeps it from now on (`deriveAllKnown` keeps a stored club's id).
        return {
          ok: true,
          writes: [{ part: "teams", teams: [...teams, withState(command.adopt, state)] }],
          inverse: { kind: "team.remove", teamId: command.teamId },
        };
      }
      if (held.state === state) return unchanged();
      return {
        ok: true,
        writes: [
          { part: "teams", teams: replaceTeam(teams, command.teamId, withState(held, state)) },
        ],
        inverse: { kind: "team.put", team: held },
      };
    }
    case "team.unlinkGc": {
      const teams = read.teams();
      const held = teams.find((team) => team.id === command.teamId);
      if (!held) return { ok: false, why: "missing" };
      const next = unlinkGcTeam(command.teamId, command.gcTeamId, [...teams]);
      if (next.every((team, at) => team === teams[at])) return unchanged();
      return {
        ok: true,
        writes: [{ part: "teams", teams: next }],
        inverse: { kind: "team.put", team: held },
      };
    }
    case "team.put": {
      const teams = read.teams();
      if (!teams.some((team) => team.id === command.team.id)) return { ok: false, why: "missing" };
      const was = teams.find((team) => team.id === command.team.id)!;
      return {
        ok: true,
        writes: [{ part: "teams", teams: replaceTeam(teams, command.team.id, command.team) }],
        inverse: { kind: "team.put", team: was },
      };
    }
    case "team.remove": {
      const teams = read.teams();
      const at = teams.findIndex((team) => team.id === command.teamId);
      const was = teams[at];
      if (!was) return { ok: false, why: "missing" };
      // Kept, and nothing to undo, while a game or a page's mark still names it: something made
      // since the club came (a game against it, the page's star) has made it the pool's.
      if (
        read.groups().some((group) => group.myTeamId === command.teamId) ||
        namedBy(everyGame(read)).has(command.teamId)
      )
        return unchanged();
      return {
        ok: true,
        writes: [{ part: "teams", teams: teams.filter((team) => team.id !== command.teamId) }],
        inverse: { kind: "team.insert", team: was, at },
      };
    }
    case "team.insert": {
      const teams = read.teams();
      if (teams.some((team) => team.id === command.team.id)) return { ok: false, why: "refused" };
      const next = teams.slice();
      next.splice(Math.min(command.at, next.length), 0, command.team);
      return {
        ok: true,
        writes: [{ part: "teams", teams: next }],
        inverse: { kind: "team.remove", teamId: command.team.id },
      };
    }
    case "page.myTeam": {
      const groups = read.groups();
      const group = groups.find((entry) => entry.id === command.ageGroupId);
      if (!group) return { ok: false, why: "missing" };
      if ((group.myTeamId ?? null) === command.teamId) return unchanged();
      const teams = read.teams();
      const held = command.teamId === null || teams.some((team) => team.id === command.teamId);
      if (!held && command.adopt?.id !== command.teamId) return { ok: false, why: "missing" };
      const writes: PoolWrite[] = [
        { part: "groups", groups: replaceGroup(groups, withMyTeam(group, command.teamId)) },
      ];
      const inverses: PoolCommand[] = [{ kind: "group.put", group }];
      if (!held && command.adopt) {
        // The mark holds by id, so the club League Standings made joins the roster under it.
        writes.push({ part: "teams", teams: [...teams, command.adopt] });
        inverses.push({ kind: "team.remove", teamId: command.adopt.id });
      }
      return { ok: true, writes, inverse: undoing(inverses) };
    }
    case "group.put": {
      const groups = read.groups();
      const was = groups.find((group) => group.id === command.group.id);
      if (!was) return { ok: false, why: "missing" };
      return {
        ok: true,
        writes: [{ part: "groups", groups: replaceGroup(groups, command.group) }],
        inverse: { kind: "group.put", group: was },
      };
    }
    case "game.add": {
      const pages = new Set(read.groups().map((group) => group.id));
      // A game for no page, or for a page of another year, is not this year's to add.
      if (
        command.games.some((game) => !pages.has(game.ageGroupId)) ||
        !inYear(read, command.year, command.games)
      )
        return { ok: false, why: "refused" };
      const games = read.games(command.year);
      const taken = new Set(games.map((game) => game.id));
      const fresh = new Set<string>();
      for (const game of command.games) {
        if (taken.has(game.id) || fresh.has(game.id)) return { ok: false, why: "refused" };
        fresh.add(game.id);
      }
      if (fresh.size === 0) return unchanged();
      const teams = read.teams();
      const held = new Set(teams.map((team) => team.id));
      const named = namedBy(command.games);
      // A club the games do not name is no part of this change. One already held is passed over
      // rather than refused: another device may have added it since the command was made.
      const offered = new Set(command.adopt.map((team) => team.id));
      if (offered.size < command.adopt.length || [...offered].some((id) => !named.has(id)))
        return { ok: false, why: "refused" };
      const adopted = command.adopt.filter((team) => !held.has(team.id));
      const known = new Set([...held, ...adopted.map((team) => team.id)]);
      // A game naming a club nobody holds would be a game for no one.
      if ([...named].some((id) => !known.has(id))) return { ok: false, why: "missing" };
      const writes: PoolWrite[] = [
        { part: "games", year: command.year, games: [...games, ...command.games] },
      ];
      if (adopted.length > 0) writes.push({ part: "teams", teams: [...teams, ...adopted] });
      return {
        ok: true,
        writes,
        inverse: undoing([
          { kind: "game.remove", year: command.year, gameIds: [...fresh] },
          // In any order: each goes by id, and the Undo of each puts its club back at the place
          // it held when it went.
          ...adopted.map((team): PoolCommand => ({ kind: "team.remove", teamId: team.id })),
        ]),
      };
    }
    case "game.remove": {
      const { kept, removed } = removeGames(read, command.year, new Set(command.gameIds));
      if (removed.length === 0) return unchanged();
      return {
        ok: true,
        writes: [{ part: "games", year: command.year, games: kept }],
        inverse: { kind: "game.insert", year: command.year, games: removed },
      };
    }
    case "game.insert": {
      const games = read.games(command.year);
      const taken = new Set(games.map((game) => game.id));
      if (
        command.games.some(({ game }) => taken.has(game.id)) ||
        !inYear(
          read,
          command.year,
          command.games.map(({ game }) => game)
        )
      )
        return { ok: false, why: "refused" };
      if (command.games.length === 0) return unchanged();
      const next = games.slice();
      // In the order of their places, each counted in the list as it grows, so every game lands
      // where it stood.
      [...command.games]
        .sort((a, b) => a.at - b.at)
        .forEach(({ game, at }) => next.splice(Math.min(at, next.length), 0, game));
      return {
        ok: true,
        writes: [{ part: "games", year: command.year, games: next }],
        inverse: {
          kind: "game.remove",
          year: command.year,
          gameIds: command.games.map(({ game }) => game.id),
        },
      };
    }
    case "club.leavePage": {
      const groups = read.groups();
      const group = groups.find((entry) => entry.id === command.ageGroupId);
      if (!group) return { ok: false, why: "missing" };
      // Where storage files the page's games: an old page's year is read off its name.
      const year = ageGroupYear(group) ?? null;
      const here = new Set(
        read
          .games(year)
          .filter(
            (game) =>
              game.ageGroupId === group.id &&
              (game.teamAId === command.teamId || game.teamBId === command.teamId)
          )
          .map((game) => game.id)
      );
      const { kept, removed } = removeGames(read, year, here);
      const writes: PoolWrite[] = [];
      // Undone club first, then its games, then the page's mark: the club comes back before the
      // games that name it, so the undo's own undo takes the games away before the club.
      const inverses: PoolCommand[] = [];
      if (removed.length > 0) writes.push({ part: "games", year, games: kept });
      // Every year, not this one alone: a club with games in another season keeps its record, and
      // one a claimed row elsewhere was filed against stays for that row to go back to.
      const named = read
        .years()
        .some((other) => namedBy(other === year ? kept : read.games(other)).has(command.teamId));
      const teams = read.teams();
      const at = teams.findIndex((team) => team.id === command.teamId);
      const club = teams[at];
      if (club && !named) {
        writes.push({ part: "teams", teams: teams.filter((team) => team.id !== club.id) });
        inverses.push({ kind: "team.insert", team: club, at });
      }
      if (removed.length > 0) inverses.push({ kind: "game.insert", year, games: removed });
      // This page's mark comes off with the club; every page's, when the club leaves the roster.
      const marked = groups.filter(
        (page) =>
          page.myTeamId === command.teamId &&
          (page.id === group.id || (club !== undefined && !named))
      );
      if (marked.length > 0) {
        const going = new Set(marked.map((page) => page.id));
        writes.push({
          part: "groups",
          groups: groups.map((page) => (going.has(page.id) ? withMyTeam(page, null) : page)),
        });
        inverses.push(...marked.map((page): PoolCommand => ({ kind: "group.put", group: page })));
      }
      return writes.length === 0 ? unchanged() : { ok: true, writes, inverse: undoing(inverses) };
    }
    case "game.score":
      if (!validScore(command.teamAScore) || !validScore(command.teamBScore))
        return { ok: false, why: "refused" };
      return editGame(read, command.year, command.gameId, (game) =>
        // A score typed here is the answer for both clubs, so the other schedule's goes with it.
        withScoreTyped(game, command.teamAScore, command.teamBScore)
      );
    case "game.exclude":
      return editGame(read, command.year, command.gameId, (game) =>
        withExcluded(game, command.excluded)
      );
    case "game.confirm":
      return editGame(read, command.year, command.gameId, (game) => {
        // The margin as it reads now, and only that: a later score is one nobody has vouched for.
        const margin = ratedMargin(game);
        return margin === undefined || game.scoreConfirmed === margin
          ? game
          : { ...game, scoreConfirmed: margin };
      });
    case "game.put": {
      const games = read.games(command.year);
      const next = new Map(command.games.map((game) => [game.id, game]));
      const held = new Set(games.map((game) => game.id));
      if (command.games.some((game) => !held.has(game.id))) return { ok: false, why: "missing" };
      if (heldTwice(games, new Set(next.keys())) || !inYear(read, command.year, command.games))
        return { ok: false, why: "refused" };
      if (next.size === 0) return unchanged();
      const was = games.filter((game) => next.has(game.id));
      return {
        ok: true,
        writes: [
          {
            part: "games",
            year: command.year,
            games: games.map((game) => next.get(game.id) ?? game),
          },
        ],
        inverse: { kind: "game.put", year: command.year, games: was },
      };
    }
    case "games.set":
      if (!inYear(read, command.year, command.games)) return { ok: false, why: "refused" };
      return settle(read, { games: new Map([[command.year, command.games]]) });
    case "teams.set":
      return settle(read, { teams: command.teams });
    case "groups.set":
      return settle(read, { groups: command.groups });
    case "group.remove": {
      const groups = read.groups();
      const at = groups.findIndex((group) => group.id === command.groupId);
      const was = groups[at];
      if (!was) return { ok: false, why: "missing" };
      // Storing the pages without one refiles whatever is still on it (`saveAgeGroups`).
      if (everyGame(read).some((game) => game.ageGroupId === command.groupId))
        return { ok: false, why: "refused" };
      return {
        ok: true,
        writes: [
          { part: "groups", groups: groups.filter((group) => group.id !== command.groupId) },
        ],
        inverse: { kind: "group.insert", group: was, at },
      };
    }
    case "group.insert": {
      const groups = read.groups();
      if (groups.some((group) => group.id === command.group.id))
        return { ok: false, why: "refused" };
      const next = groups.slice();
      next.splice(Math.min(command.at, next.length), 0, command.group);
      return {
        ok: true,
        writes: [{ part: "groups", groups: next }],
        inverse: { kind: "group.remove", groupId: command.group.id },
      };
    }
    case "namedAges": {
      const before = read.namedAges();
      let after: Map<string, NamedAge> = new Map(before);
      command.forget.forEach((id) => (after = forgetNamedAge(after, id)));
      command.put.forEach((entry) => (after = nameAge(after, entry)));
      return namedAgesChange(before, after);
    }
    case "ageless.forget": {
      const going = new Set(command.teamIds);
      const rows: { entry: AgeUnknownTeam; at: number }[] = [];
      const kept: AgeUnknownTeam[] = [];
      read.ageless().forEach((entry, at) => {
        if (going.has(entry.teamId)) rows.push({ entry, at });
        else kept.push(entry);
      });
      if (rows.length === 0) return unchanged();
      return {
        ok: true,
        writes: [{ part: "ageless", list: kept }],
        inverse: { kind: "ageless.insert", rows },
      };
    }
    case "ageless.insert": {
      const list = read.ageless();
      const held = new Set(list.map((entry) => entry.teamId));
      // Each at the place it held, the earliest first, so every later place counts the ones before.
      const back = command.rows
        .filter(({ entry }) => !held.has(entry.teamId))
        .slice()
        .sort((a, b) => a.at - b.at);
      if (back.length === 0) return unchanged();
      const next = list.slice();
      back.forEach(({ entry, at }) => next.splice(Math.min(at, next.length), 0, entry));
      return {
        ok: true,
        writes: [{ part: "ageless", list: next }],
        inverse: { kind: "ageless.forget", teamIds: back.map(({ entry }) => entry.teamId) },
      };
    }
    case "games.drop": {
      const all = everyGame(read);
      const drop = new Set(command.gameIds);
      const found = all.filter((game) => drop.has(game.id)).map((game) => game.id);
      if (found.length === 0) return { ok: false, why: "missing" };
      const rows = scoringRowsOf(all, found);
      return applySteps(read, [
        // The rows go down first, as they did before: a pull that started between the two writes
        // would otherwise file the games straight back.
        remember("deletedGames", rows),
        ...read.years().map(
          (year): Step =>
            (pool) =>
              apply(pool, { kind: "game.remove", year, gameIds: found })
        ),
      ]);
    }
    case "club.drop": {
      const club = read.teams().find((team) => team.id === command.teamId);
      const all = everyGame(read);
      const gameIds = all
        .filter((game) => game.teamAId === command.teamId || game.teamBId === command.teamId)
        .map((game) => game.id);
      // A club its games still name though the roster holds no entry for it (Pool health lists
      // clubs off the games) goes with its games, and has no GameChanger ids to refuse.
      if (!club && gameIds.length === 0) return { ok: false, why: "missing" };
      const gcTeamIds = (club?.gcTeams ?? []).map((link) => link.teamId);
      return applySteps(read, [
        remember("droppedClubs", gcTeamIds),
        remember("deletedGames", rowsOfGames(all, gameIds)),
        (pool) => {
          // Another club's row one of its games held as a claim stands back up rather than go.
          const left = withoutClub(
            { teamId: command.teamId, gameIds },
            pool.teams(),
            everyGame(pool),
            [...pool.groups()]
          );
          // No page keeps a club thrown out as its own team.
          const groups = pool.groups();
          const unmarked = groups.map((group) =>
            group.myTeamId === command.teamId ? withMyTeam(group, null) : group
          );
          return settle(pool, {
            teams: left.teams,
            groups: unmarked,
            games: byYear(pool, left.games, groups),
          });
        },
      ]);
    }
    case "season.assign": {
      const made = seasonAtAge(
        command.seasonId,
        command.season,
        [...read.groups()],
        command.pageId
      );
      if (!uniqueIds(made.ageGroups)) return { ok: false, why: "refused" };
      return settle(read, { groups: made.ageGroups });
    }
    case "club.age": {
      const teams = read.teams();
      const club = teams.find((team) => team.id === command.teamId);
      if (!club) return { ok: false, why: "missing" };
      const groups = read.groups();
      const before: ClubAgeState = {
        teams: [...teams],
        games: [...read.games(command.year)],
        ageGroups: [...groups],
      };
      const change = setClubAge(
        before,
        command.teamId,
        command.level,
        command.year,
        "you",
        undefined,
        command.pageId
      );
      // A level this app does not rank, a club with no GameChanger link in the year, or a page to
      // make under an id a page has already.
      if (!change || !uniqueIds(change.ageGroups)) return { ok: false, why: "refused" };
      const named = pinnedAges(
        read.namedAges(),
        club,
        change.gcTeamIds,
        change.levels,
        command.level,
        command.at
      );
      return applySteps(read, [
        (pool) =>
          settle(pool, {
            teams: change.teams === before.teams ? teams : change.teams,
            groups: change.ageGroups === before.ageGroups ? groups : change.ageGroups,
            games: new Map([
              [
                command.year,
                change.games === before.games ? read.games(command.year) : change.games,
              ],
            ]),
          }),
        (pool) => namedAgesChange(pool.namedAges(), named),
      ]);
    }
    case "club.ageClear": {
      const teams = read.teams();
      const club = teams.find((team) => team.id === command.teamId);
      if (!club) return { ok: false, why: "missing" };
      const groups = read.groups();
      const ids = (club.gcTeams ?? [])
        .filter((link) => gcLinkSquadYear(link, [...groups]) === command.year)
        .map((link) => link.teamId);
      const pinned = read.namedAges();
      let named: Map<string, NamedAge> = new Map(pinned);
      const back = new Map<number, Set<string>>();
      ids.forEach((id) => {
        const entry = pinned.get(id);
        if (!entry?.pinned) return;
        named = forgetNamedAge(named, id);
        const to = entry.was ?? entry.level;
        back.set(to, (back.get(to) ?? new Set()).add(id));
      });
      if (back.size === 0) return unchanged();
      const before: ClubAgeState = {
        teams: [...teams],
        games: [...read.games(command.year)],
        ageGroups: [...groups],
      };
      // The whole club at once when every id goes back to one level, so the other clubs' rows
      // that recorded an age for it go back too; otherwise each id with its own schedule's rows.
      const whole = back.size === 1 && [...back.values()][0]?.size === ids.length;
      let after = before;
      [...back].forEach(([level, gcIds], at) => {
        after =
          setClubAge(
            after,
            command.teamId,
            level,
            command.year,
            null,
            whole ? undefined : gcIds,
            at === 0 ? command.pageId : `${command.pageId}-${at}`
          ) ?? after;
      });
      if (!uniqueIds(after.ageGroups)) return { ok: false, why: "refused" };
      return applySteps(read, [
        (pool) =>
          settle(pool, {
            teams: after.teams === before.teams ? teams : after.teams,
            groups: after.ageGroups === before.ageGroups ? groups : after.ageGroups,
            games: new Map([
              [command.year, after.games === before.games ? read.games(command.year) : after.games],
            ]),
          }),
        (pool) => namedAgesChange(pool.namedAges(), named),
      ]);
    }
    case "teams.merge": {
      if (command.fromId === command.intoId) return { ok: false, why: "refused" };
      const teams = read.teams();
      const held = new Set(teams.map((team) => team.id));
      const pair = new Set([command.fromId, command.intoId]);
      const offered = new Set(command.adopt.map((team) => team.id));
      if (offered.size < command.adopt.length || [...offered].some((id) => !pair.has(id)))
        return { ok: false, why: "refused" };
      const roster = [...teams, ...command.adopt.filter((team) => !held.has(team.id))];
      const ids = new Set(roster.map((team) => team.id));
      if (!ids.has(command.fromId) || !ids.has(command.intoId))
        return { ok: false, why: "missing" };
      const groups = read.groups();
      const merged = mergeScoutTeams(command.fromId, command.intoId, roster, everyGame(read), [
        ...groups,
      ]);
      // Every page whose own team was the club folded away follows it to the one that stays.
      const marked = groups.map((group) =>
        group.myTeamId === command.fromId ? withMyTeam(group, command.intoId) : group
      );
      return settle(read, {
        teams: merged.teams,
        groups: marked.some((group, at) => group !== groups[at]) ? marked : groups,
        games: byYear(read, merged.games, groups),
      });
    }
    case "team.rename": {
      const name = cleanTeamName(command.name).trim();
      if (!name) return { ok: false, why: "refused" };
      const teams = read.teams();
      const held = teams.find((team) => team.id === command.teamId);
      if (!held) return { ok: false, why: "missing" };
      const key = teamNameKey(name);
      if (teams.some((team) => team.id !== command.teamId && teamNameKey(team.name) === key))
        return { ok: false, why: "refused" };
      if (held.name === name) return unchanged();
      return settle(read, { teams: replaceTeam(teams, held.id, { ...held, name }) });
    }
  }
};

const validScore = (value: number): boolean => Number.isInteger(value) && value >= 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string" && value !== "";

const strings = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every(isString) ? value : null;

const yearOf = (value: unknown): number | null | undefined =>
  value === null ? null : Number.isInteger(value) ? (value as number) : undefined;

/*
 * A record read back exactly as it was sent, or null: one whose fields storage would have to drop
 * or change to keep (a state that is a number, a link with no page) is not the record that was
 * meant, and putting it back would quietly lose what it dropped.
 */
export const oneTeam = (raw: unknown): ScoutTeam | null => {
  const [team] = coerceScoutTeams([raw]);
  return team && sameValue(team, raw) ? team : null;
};

const oneGroup = (raw: unknown): AgeGroup | null => {
  const [group] = coerceAgeGroups([raw]);
  return group && sameValue(group, raw) ? group : null;
};

const isPlace = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Every item of a list read by `one`, or null when the list is not one or any item is not. */
export const everyOne = <T>(raw: unknown, one: (item: unknown) => T | null): T[] | null => {
  if (!Array.isArray(raw)) return null;
  const out: T[] = [];
  for (const item of raw) {
    const read = one(item);
    if (read === null) return null;
    out.push(read);
  }
  return out;
};

/** A named age, every field read back exactly as it was sent, or null. */
const oneNamedAge = (raw: unknown): NamedAge | null => {
  const [entry] = coerceNamedAges([raw]).values();
  return entry && JSON.stringify(entry) === JSON.stringify(raw) ? entry : null;
};

/** An age and a squad year, or undefined. */
const oneSeason = (raw: unknown): AgeGroupSeason | undefined =>
  isRecord(raw) &&
  Number.isInteger(raw.ageLevel) &&
  Number.isInteger(raw.year) &&
  Object.keys(raw).length === 2
    ? { ageLevel: raw.ageLevel as number, year: raw.year as number }
    : undefined;

export const oneGame = (raw: unknown): ScoutGame | null => {
  const [game] = coerceScoutGames([raw]);
  return game && sameValue(game, raw) ? game : null;
};

/** A team nobody could age, read back exactly as storage keeps one, or null. */
export const oneAgeless = (raw: unknown): AgeUnknownTeam | null => {
  const [entry] = coerceAgeUnknown([raw]);
  return entry && sameValue(entry, raw) ? entry : null;
};

const oneAgelessRow = (raw: unknown): { entry: AgeUnknownTeam; at: number } | null => {
  if (!isRecord(raw) || !isPlace(raw.at) || Object.keys(raw).length !== 2) return null;
  const entry = oneAgeless(raw.entry);
  return entry ? { entry, at: raw.at } : null;
};

/**
 * The most steps a command may take, counting each in a batch: a bound on the work and the memory a
 * request can ask of the server, far past any batch the page makes. Each step that sets a club's
 * state writes the whole roster, and the batch keeps each step's writes until it ends: on the 116,485
 * clubs of the 29 September 2026 pool, 400 such steps grew the heap by 355 MB (measured in the 1.4
 * review), so 500 stay well inside the edit worker's 2.5 GB.
 */
export const MAX_COMMAND_STEPS = 500;

/** How many steps a command takes, each step of a batch counted. */
const stepsOf = (command: PoolCommand): number =>
  command.kind === "batch" ? command.commands.reduce((sum, step) => sum + stepsOf(step), 0) : 1;

/**
 * A command as it arrives from elsewhere, checked part by part: from another tab, or as the body
 * of a request to the server. Anything not exactly a command is null, so a server never runs half
 * of something it could not read: a field the reader does not know, at any level, is refused
 * rather than dropped, since a newer device's command would otherwise run here without it.
 */
export const coerceCommand = (raw: unknown, depth = 0): PoolCommand | null => {
  const command = readCommand(raw, depth);
  if (!command || !isRecord(raw)) return null;
  if (!Object.keys(raw).every((key) => Object.prototype.hasOwnProperty.call(command, key))) {
    return null;
  }
  return depth > 0 || stepsOf(command) <= MAX_COMMAND_STEPS ? command : null;
};

const readCommand = (raw: unknown, depth: number): PoolCommand | null => {
  if (!isRecord(raw) || typeof raw.kind !== "string") return null;
  switch (raw.kind) {
    case "none":
      return NONE;
    case "batch": {
      if (depth > 4 || !Array.isArray(raw.commands)) return null;
      const commands = raw.commands.map((step) => coerceCommand(step, depth + 1));
      return commands.every((step): step is PoolCommand => step !== null)
        ? { kind: "batch", commands }
        : null;
    }
    case "answers": {
      const add = strings(raw.add);
      const remove = strings(raw.remove);
      const list = ANSWER_LISTS.find((name) => name === raw.list);
      return list && add && remove ? { kind: "answers", list, add, remove } : null;
    }
    case "team.state": {
      if (!isString(raw.teamId)) return null;
      if (raw.state !== null && typeof raw.state !== "string") return null;
      const adopt = raw.adopt === undefined ? undefined : oneTeam(raw.adopt);
      if (adopt === null) return null;
      return {
        kind: "team.state",
        teamId: raw.teamId,
        state: raw.state as string | null,
        ...(adopt ? { adopt } : {}),
      };
    }
    case "team.unlinkGc":
      return isString(raw.teamId) && isString(raw.gcTeamId)
        ? { kind: "team.unlinkGc", teamId: raw.teamId, gcTeamId: raw.gcTeamId }
        : null;
    case "team.put": {
      const team = oneTeam(raw.team);
      return team ? { kind: "team.put", team } : null;
    }
    case "team.remove":
      return isString(raw.teamId) ? { kind: "team.remove", teamId: raw.teamId } : null;
    case "team.insert": {
      const team = oneTeam(raw.team);
      return team && isPlace(raw.at) ? { kind: "team.insert", team, at: raw.at } : null;
    }
    case "page.myTeam": {
      if (!isString(raw.ageGroupId) || (raw.teamId !== null && !isString(raw.teamId))) return null;
      const adopt = raw.adopt === undefined ? undefined : oneTeam(raw.adopt);
      if (adopt === null) return null;
      return {
        kind: "page.myTeam",
        ageGroupId: raw.ageGroupId,
        teamId: raw.teamId as string | null,
        ...(adopt ? { adopt } : {}),
      };
    }
    case "group.put": {
      const group = oneGroup(raw.group);
      return group ? { kind: "group.put", group } : null;
    }
    case "game.add": {
      const year = yearOf(raw.year);
      const games = everyOne(raw.games, oneGame);
      const adopt = everyOne(raw.adopt, oneTeam);
      return year !== undefined && games && adopt ? { kind: "game.add", year, games, adopt } : null;
    }
    case "game.remove": {
      const year = yearOf(raw.year);
      const gameIds = strings(raw.gameIds);
      return year !== undefined && gameIds ? { kind: "game.remove", year, gameIds } : null;
    }
    case "game.insert": {
      const year = yearOf(raw.year);
      const games = everyOne(raw.games, (entry) => {
        if (!isRecord(entry) || !isPlace(entry.at)) return null;
        const game = oneGame(entry.game);
        return game ? { game, at: entry.at } : null;
      });
      return year !== undefined && games ? { kind: "game.insert", year, games } : null;
    }
    case "club.leavePage":
      return isString(raw.ageGroupId) && isString(raw.teamId)
        ? { kind: "club.leavePage", ageGroupId: raw.ageGroupId, teamId: raw.teamId }
        : null;
    case "game.score": {
      const year = yearOf(raw.year);
      return year !== undefined &&
        isString(raw.gameId) &&
        typeof raw.teamAScore === "number" &&
        typeof raw.teamBScore === "number"
        ? {
            kind: "game.score",
            year,
            gameId: raw.gameId,
            teamAScore: raw.teamAScore,
            teamBScore: raw.teamBScore,
          }
        : null;
    }
    case "game.exclude": {
      const year = yearOf(raw.year);
      return year !== undefined && isString(raw.gameId) && typeof raw.excluded === "boolean"
        ? { kind: "game.exclude", year, gameId: raw.gameId, excluded: raw.excluded }
        : null;
    }
    case "game.confirm": {
      const year = yearOf(raw.year);
      return year !== undefined && isString(raw.gameId)
        ? { kind: "game.confirm", year, gameId: raw.gameId }
        : null;
    }
    case "game.put": {
      const year = yearOf(raw.year);
      const games = everyOne(raw.games, oneGame);
      return year !== undefined && games ? { kind: "game.put", year, games } : null;
    }
    case "games.set": {
      const year = yearOf(raw.year);
      const games = everyOne(raw.games, oneGame);
      return year !== undefined && games ? { kind: "games.set", year, games } : null;
    }
    case "teams.set": {
      const teams = everyOne(raw.teams, oneTeam);
      return teams ? { kind: "teams.set", teams } : null;
    }
    case "groups.set": {
      const groups = everyOne(raw.groups, oneGroup);
      return groups ? { kind: "groups.set", groups } : null;
    }
    case "group.remove":
      return isString(raw.groupId) ? { kind: "group.remove", groupId: raw.groupId } : null;
    case "group.insert": {
      const group = oneGroup(raw.group);
      return group && isPlace(raw.at) ? { kind: "group.insert", group, at: raw.at } : null;
    }
    case "namedAges": {
      const put = everyOne(raw.put, oneNamedAge);
      const forget = strings(raw.forget);
      return put && forget ? { kind: "namedAges", put, forget } : null;
    }
    case "games.drop": {
      const gameIds = strings(raw.gameIds);
      return gameIds ? { kind: "games.drop", gameIds } : null;
    }
    case "club.drop":
      return isString(raw.teamId) ? { kind: "club.drop", teamId: raw.teamId } : null;
    case "season.assign": {
      if (!isString(raw.seasonId) || !isString(raw.pageId)) return null;
      const season = raw.season === null ? null : oneSeason(raw.season);
      if (season === undefined) return null;
      return { kind: "season.assign", seasonId: raw.seasonId, season, pageId: raw.pageId };
    }
    case "club.age":
      return Number.isInteger(raw.year) &&
        isString(raw.teamId) &&
        Number.isInteger(raw.level) &&
        isString(raw.at) &&
        isString(raw.pageId)
        ? {
            kind: "club.age",
            year: raw.year as number,
            teamId: raw.teamId,
            level: raw.level as number,
            at: raw.at,
            pageId: raw.pageId,
          }
        : null;
    case "club.ageClear":
      return Number.isInteger(raw.year) && isString(raw.teamId) && isString(raw.pageId)
        ? {
            kind: "club.ageClear",
            year: raw.year as number,
            teamId: raw.teamId,
            pageId: raw.pageId,
          }
        : null;
    case "teams.merge": {
      const adopt = everyOne(raw.adopt, oneTeam);
      return isString(raw.fromId) && isString(raw.intoId) && adopt
        ? { kind: "teams.merge", fromId: raw.fromId, intoId: raw.intoId, adopt }
        : null;
    }
    case "team.rename":
      return isString(raw.teamId) && typeof raw.name === "string"
        ? { kind: "team.rename", teamId: raw.teamId, name: raw.name }
        : null;
    case "ageless.forget": {
      const teamIds = strings(raw.teamIds);
      return teamIds ? { kind: "ageless.forget", teamIds } : null;
    }
    case "ageless.insert": {
      const rows = everyOne(raw.rows, oneAgelessRow);
      return rows ? { kind: "ageless.insert", rows } : null;
    }
    default:
      return null;
  }
};
