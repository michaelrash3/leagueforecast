import { ratedMargin, withScoreTyped } from "../teamRankings/games";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings/types";
import { filedTeamIds, unlinkGcTeam } from "../teamRankings";
import { normalizeState } from "../teamRankings/names";
import { coerceScoutGames, coerceScoutTeams } from "../teamRankingsCompact";
import { coerceAgeGroups } from "../teamRankingsStorage";

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

/** The lists of answers the user has given about clubs, each kept as a set of ids. */
export type AnswerList = "realClubs" | "ageRight" | "keptApart";

const ANSWER_LISTS: readonly AnswerList[] = ["realClubs", "ageRight", "keptApart"];

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
  /** A game's record put back as it was, in its place. */
  | { kind: "game.put"; year: number | null; game: ScoutGame };

/** The pool as a command reads it: the parts it may change, as storage decodes them. */
export type PoolRead = {
  teams: () => readonly ScoutTeam[];
  groups: () => readonly AgeGroup[];
  /** Every squad year the pool holds games for; null for the games whose page has no year. */
  years: () => readonly (number | null)[];
  /** One squad year's games; null for the games whose page has no year. */
  games: (year: number | null) => readonly ScoutGame[];
  answers: (list: AnswerList) => ReadonlySet<string>;
};

/** One part of the pool, as a command would leave it. */
export type PoolWrite =
  | { part: "teams"; teams: ScoutTeam[] }
  | { part: "groups"; groups: AgeGroup[] }
  | { part: "games"; year: number | null; games: ScoutGame[] }
  | { part: "answers"; list: AnswerList; ids: Set<string> };

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
  const next = edit(was);
  if (next === was) return unchanged();
  const written = games.slice();
  written[at] = next;
  return {
    ok: true,
    writes: [{ part: "games", year, games: written }],
    inverse: { kind: "game.put", year, game: was },
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

const replaceGroup = (groups: readonly AgeGroup[], next: AgeGroup): AgeGroup[] =>
  groups.map((group) => (group.id === next.id ? next : group));

const withMyTeam = (group: AgeGroup, teamId: string | null): AgeGroup => {
  const { myTeamId: _was, ...rest } = group;
  return teamId === null ? rest : { ...rest, myTeamId: teamId };
};

/** The inverses of a command's steps, as the one command that undoes them all. */
const undoing = (inverses: readonly PoolCommand[]): PoolCommand => {
  const steps = inverses.filter((step) => step.kind !== "none");
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

/** Makes `command`'s change to the pool `read` holds, or says why it cannot. */
export const applyCommand = (read: PoolRead, command: PoolCommand): CommandResult => {
  switch (command.kind) {
    case "none":
      return unchanged();
    case "batch": {
      const writes: PoolWrite[] = [];
      const inverses: PoolCommand[] = [];
      for (const step of command.commands) {
        const result = applyCommand(overlay(read, writes), step);
        if (!result.ok) return result;
        writes.push(...result.writes);
        if (result.inverse.kind !== "none") inverses.unshift(result.inverse);
      }
      return { ok: true, writes: lastPerPart(writes), inverse: undoing(inverses) };
    }
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
      if (command.games.some(({ game }) => taken.has(game.id)))
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
      const year = group.year ?? null;
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
      const inverses: PoolCommand[] = [];
      if (removed.length > 0) {
        writes.push({ part: "games", year, games: kept });
        inverses.push({ kind: "game.insert", year, games: removed });
      }
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
      if (group.myTeamId === command.teamId) {
        writes.push({ part: "groups", groups: replaceGroup(groups, withMyTeam(group, null)) });
        inverses.push({ kind: "group.put", group });
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
    case "game.put":
      return editGame(read, command.year, command.game.id, () => command.game);
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

const oneTeam = (raw: unknown): ScoutTeam | null => {
  const [team] = coerceScoutTeams([raw]);
  return team && isRecord(raw) && team.id === raw.id ? team : null;
};

const oneGroup = (raw: unknown): AgeGroup | null => {
  const [group] = coerceAgeGroups([raw]);
  return group && isRecord(raw) && group.id === raw.id ? group : null;
};

const isPlace = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Every item of a list read by `one`, or null when the list is not one or any item is not. */
const everyOne = <T>(raw: unknown, one: (item: unknown) => T | null): T[] | null => {
  if (!Array.isArray(raw)) return null;
  const out: T[] = [];
  for (const item of raw) {
    const read = one(item);
    if (read === null) return null;
    out.push(read);
  }
  return out;
};

const oneGame = (raw: unknown): ScoutGame | null => {
  const [game] = coerceScoutGames([raw]);
  return game && isRecord(raw) && game.id === raw.id ? game : null;
};

/**
 * A command as it arrives from elsewhere, checked part by part: from another tab, or as the body
 * of a request to the server. Anything not exactly a command is null, so a server never runs half
 * of something it could not read.
 */
export const coerceCommand = (raw: unknown, depth = 0): PoolCommand | null => {
  if (!isRecord(raw) || typeof raw.kind !== "string") return null;
  switch (raw.kind) {
    case "none":
      return NONE;
    case "batch": {
      if (depth > 2 || !Array.isArray(raw.commands)) return null;
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
      const game = oneGame(raw.game);
      return year !== undefined && game ? { kind: "game.put", year, game } : null;
    }
    default:
      return null;
  }
};
