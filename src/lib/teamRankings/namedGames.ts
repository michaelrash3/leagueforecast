import { findDuplicateGame } from "./games";
import { findSimilarTeam, isPlaceholderName, teamNameKey, teamResolver } from "./names";
import type { ScoutGame, ScoutTeam } from "./types";

/**
 * Games named by their clubs' names rather than their ids: what a game typed into the Games tab,
 * or a row of a pasted schedule, is until its names are resolved to clubs. The device resolves
 * them against the roster it holds; the live page holds no roster, so the edit function resolves
 * them against the cloud's (1.6), with these same functions, and says the same of them: which
 * names are worth a second look, and which games the page already has.
 */

export type NamedGame = {
  /** The game's id, minted where it was typed, so the edit and its Undo name the same game. */
  id: string;
  teamA: string;
  teamB: string;
  /** Two-letter states from an imported file, filled in on a club that has none. */
  stateA?: string;
  stateB?: string;
  /** Both or neither: a game with no score is one not yet played. */
  teamAScore?: number;
  teamBScore?: number;
  date?: string;
  event?: string;
  /**
   * Added though the page has a game like it, as the one adding it was told and chose ("Add
   * anyway"). Without it the server refuses a game the page has by the time it is added, since
   * what the device was told when it checked may be out of date.
   */
  again?: true;
};

/** A named game's score, where it has both halves of one. */
const scoreOf = (game: NamedGame): Pick<ScoutGame, "teamAScore" | "teamBScore"> =>
  game.teamAScore !== undefined && game.teamBScore !== undefined
    ? { teamAScore: game.teamAScore, teamBScore: game.teamBScore }
    : {};

/**
 * The games `named` are on page `ageGroupId`, and the roster they leave: each name resolved to a
 * club as a typed name is (`resolveOrCreateTeam`, here `teamResolver`, which finds each name in an
 * index of the roster rather than a walk down it), one of `teams` by its name or else a club of its
 * own, minted into the roster returned; a state a game carries fills in a club's that has none.
 * What a file names on the row is more trustworthy than nothing, and less than what was typed on
 * the club.
 */
export const gamesOfNamed = (
  named: readonly NamedGame[],
  teams: ScoutTeam[],
  ageGroupId: string
): { teams: ScoutTeam[]; games: ScoutGame[] } => {
  const resolver = teamResolver(teams);
  const games = named.map((game): ScoutGame => {
    const teamAId = resolver.resolve(game.teamA);
    const teamBId = resolver.resolve(game.teamB);
    resolver.fillState(teamAId, game.stateA);
    resolver.fillState(teamBId, game.stateB);
    return {
      id: game.id,
      teamAId,
      teamBId,
      ageGroupId,
      ...scoreOf(game),
      ...(game.date ? { date: game.date } : {}),
      ...(game.event ? { event: game.event } : {}),
    };
  });
  return { teams: resolver.teams(), games };
};

/**
 * What is worth a second look about a name before it becomes a club: a placeholder, which would
 * collect games belonging to whoever actually turns up; or a near match of a club already here,
 * usually the same club spelled two ways, which left alone splits its record in half. Both are
 * said, never applied: two real clubs can be a character apart.
 */
export type NameNote = { kind: "placeholder" } | { kind: "similar"; to: string } | null;

export const nameNoteOf = (value: string, teams: ScoutTeam[]): NameNote => {
  const name = value.trim();
  if (!name) return null;
  if (isPlaceholderName(name)) return { kind: "placeholder" };
  const close = findSimilarTeam(name, teams);
  return close ? { kind: "similar", to: close.name } : null;
};

/**
 * Each club's id by its name's key, the last of a name winning, as the import has always read
 * them: made once a roster, since a nationwide one is a quarter of a second to index.
 */
const idsByNameOf = new WeakMap<readonly ScoutTeam[], Map<string, string>>();
const idsByName = (teams: readonly ScoutTeam[]): Map<string, string> => {
  const known = idsByNameOf.get(teams);
  if (known) return known;
  const made = new Map<string, string>();
  teams.forEach((team) => made.set(teamNameKey(team.name), team.id));
  idsByNameOf.set(teams, made);
  return made;
};

/** What a named game is worth a look for: a note on each name, and whether the page has it. */
export type NamedCheck = { notes: [NameNote, NameNote]; logged: boolean };

/**
 * Whether each of `named` is already logged on the page (`existingGames`, the logged and the League
 * Standings ones alike): both its names are clubs here and the page has a game of theirs on the
 * same day with the same score (`findDuplicateGame`); a name no club has yet cannot be part of
 * one. Asked as a schedule is checked, and again by the server as it adds one (`importOfNamed`).
 */
export const loggedNamed = (
  named: readonly NamedGame[],
  teams: readonly ScoutTeam[],
  existingGames: ScoutGame[],
  ageGroupId: string
): boolean[] => {
  const idByName = idsByName(teams);
  return named.map((game) => {
    const idA = idByName.get(teamNameKey(game.teamA));
    const idB = idByName.get(teamNameKey(game.teamB));
    return (
      idA !== undefined &&
      idB !== undefined &&
      idA !== idB &&
      findDuplicateGame(
        {
          id: `preview_${game.id}`,
          teamAId: idA,
          teamBId: idB,
          ageGroupId,
          ...scoreOf(game),
          ...(game.date ? { date: game.date } : {}),
        },
        existingGames
      ) !== null
    );
  });
};

/** Each of `named` checked against the roster and the page's games (`loggedNamed`, `nameNoteOf`). */
export const checkNamedGames = (
  named: readonly NamedGame[],
  teams: ScoutTeam[],
  existingGames: ScoutGame[],
  ageGroupId: string
): NamedCheck[] => {
  const logged = loggedNamed(named, teams, existingGames, ageGroupId);
  return named.map((game, at) => ({
    notes: [nameNoteOf(game.teamA, teams), nameNoteOf(game.teamB, teams)],
    logged: logged[at] === true,
  }));
};

/** The most games one add may name: a season's schedule pasted at once is a few dozen. */
export const NAMED_GAMES_MAX = 500;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isName = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "" && value.length <= 200;
const isScore = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const NAMED_KEYS = new Set([
  "id",
  "teamA",
  "teamB",
  "stateA",
  "stateB",
  "teamAScore",
  "teamBScore",
  "date",
  "event",
  "again",
]);

/**
 * A named game as a device sends one, or null for anything else: an id as the page mints one, two
 * names, a state as a file writes one, both scores or neither, a day, an event, and whether it is
 * added again, and nothing more. What the server is handed it resolves to clubs and writes, so it
 * reads only what a page would make.
 */
export const coerceNamedGame = (raw: unknown): NamedGame | null => {
  if (!isRecord(raw) || Object.keys(raw).some((key) => !NAMED_KEYS.has(key))) return null;
  const { id, teamA, teamB, stateA, stateB, teamAScore, teamBScore, date, event, again } = raw;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) return null;
  if (!isName(teamA) || !isName(teamB)) return null;
  for (const state of [stateA, stateB]) {
    if (state !== undefined && (typeof state !== "string" || !/^[A-Z]{2}$/.test(state)))
      return null;
  }
  const scored = teamAScore !== undefined || teamBScore !== undefined;
  if (scored && !(isScore(teamAScore) && isScore(teamBScore))) return null;
  if (date !== undefined && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)))
    return null;
  if (event !== undefined && !isName(event)) return null;
  if (again !== undefined && again !== true) return null;
  return {
    id,
    teamA,
    teamB,
    ...(typeof stateA === "string" ? { stateA } : {}),
    ...(typeof stateB === "string" ? { stateB } : {}),
    ...(isScore(teamAScore) && isScore(teamBScore) ? { teamAScore, teamBScore } : {}),
    ...(typeof date === "string" ? { date } : {}),
    ...(typeof event === "string" ? { event } : {}),
    ...(again === true ? { again } : {}),
  };
};

/** One to `NAMED_GAMES_MAX` named games, each read by `coerceNamedGame`, or null. */
export const coerceNamedGames = (raw: unknown): NamedGame[] | null => {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > NAMED_GAMES_MAX) return null;
  const games: NamedGame[] = [];
  for (const item of raw) {
    const game = coerceNamedGame(item);
    if (!game) return null;
    games.push(game);
  }
  return games;
};

const coerceNote = (raw: unknown): NameNote | undefined => {
  if (raw === null) return null;
  if (!isRecord(raw)) return undefined;
  if (raw.kind === "placeholder" && Object.keys(raw).length === 1) return { kind: "placeholder" };
  if (raw.kind === "similar" && typeof raw.to === "string" && Object.keys(raw).length === 2)
    return { kind: "similar", to: raw.to };
  return undefined;
};

/** A check as the server answers one, read back, or null. */
export const coerceNamedCheck = (raw: unknown): NamedCheck | null => {
  if (!isRecord(raw) || typeof raw.logged !== "boolean" || !Array.isArray(raw.notes)) return null;
  if (raw.notes.length !== 2) return null;
  const a = coerceNote(raw.notes[0]);
  const b = coerceNote(raw.notes[1]);
  return a === undefined || b === undefined ? null : { notes: [a, b], logged: raw.logged };
};

/** A game as the Games tab's form holds it, every field as typed. */
export type GameDraft = {
  teamAName: string;
  teamBName: string;
  teamAScore: string;
  teamBScore: string;
  date: string;
  event: string;
};

/**
 * The game the form names, as `id`, or null while it names none: two clubs, not the same one by
 * the key a name is found by ("NV Stars 9U" is "NV Stars"), and both scores in runs or neither, as
 * the device's form asks before it adds one.
 */
export const namedOfDraft = (draft: GameDraft, id: string): NamedGame | null => {
  const teamA = draft.teamAName.trim();
  const teamB = draft.teamBName.trim();
  if (!isName(teamA) || !isName(teamB) || teamNameKey(teamA) === teamNameKey(teamB)) return null;
  // A day as the date box writes one, or none: a year typed past 9999 is not one the server reads.
  if (draft.date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return null;
  const a = draft.teamAScore.trim();
  const b = draft.teamBScore.trim();
  const runs = (typed: string) => Number.isFinite(Number(typed)) && Number(typed) >= 0;
  if ((a === "") !== (b === "") || (a !== "" && !(runs(a) && runs(b)))) return null;
  const event = draft.event.trim();
  if (event.length > 200) return null;
  return {
    id,
    teamA,
    teamB,
    ...(a !== "" ? { teamAScore: Number(a), teamBScore: Number(b) } : {}),
    ...(draft.date ? { date: draft.date } : {}),
    ...(event ? { event } : {}),
  };
};
