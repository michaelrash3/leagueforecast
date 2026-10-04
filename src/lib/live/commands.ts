import { ratedMargin, withScoreTyped } from "../teamRankings/games";
import type { ScoutGame, ScoutTeam } from "../teamRankings/types";
import { unlinkGcTeam } from "../teamRankings";
import { normalizeState } from "../teamRankings/names";
import { coerceScoutGames, coerceScoutTeams } from "../teamRankingsCompact";

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
   * A club taken off the roster: only ever the inverse of one adopted by `team.state`, which the
   * pool held nothing of before.
   */
  | { kind: "team.remove"; teamId: string }
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
  /** One squad year's games; null for the games whose page has no year. */
  games: (year: number | null) => readonly ScoutGame[];
  answers: (list: AnswerList) => ReadonlySet<string>;
};

/** One part of the pool, as a command would leave it. */
export type PoolWrite =
  | { part: "teams"; teams: ScoutTeam[] }
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
  const games = new Map(
    writes.flatMap((write) => (write.part === "games" ? [[write.year, write.games] as const] : []))
  );
  const answers = new Map(
    writes.flatMap((write) => (write.part === "answers" ? [[write.list, write.ids] as const] : []))
  );
  return {
    teams: () => (teams?.part === "teams" ? teams.teams : read.teams()),
    games: (year) => games.get(year) ?? read.games(year),
    answers: (list) => answers.get(list) ?? read.answers(list),
  };
};

/** The last write to each part, in the order the parts were first written. */
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
      return {
        ok: true,
        writes: lastPerPart(writes),
        inverse:
          inverses.length === 0
            ? NONE
            : inverses.length === 1
              ? inverses[0]!
              : { kind: "batch", commands: inverses },
      };
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
      const was = teams.find((team) => team.id === command.teamId);
      if (!was) return { ok: false, why: "missing" };
      return {
        ok: true,
        writes: [{ part: "teams", teams: teams.filter((team) => team.id !== command.teamId) }],
        inverse: { kind: "team.put", team: was },
      };
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
