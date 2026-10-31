/**
 * The names a pasted league schedule gives, matched to the season's own teams, and the season the
 * games make once they have been looked over (`LeagueSchedulePaste`). Pure: nothing here reads or
 * writes storage, and nothing is asked of a server.
 */
import { displayName } from "./format";
import { ageLevelFromName } from "./gameChangerApi";
import { createTeamId } from "./sim";
import { findSimilarTeam, pasteNameKey, squadNameKey, teamNameKey } from "./teamRankings";
import type { GameLog, Matchup, TeamBase } from "./types";
import { blankLog } from "./util";

/**
 * What a pasted name is in this season:
 *
 * - `team`: one of its teams. Written as its name is (`pasteNameKey`: case, spacing and punctuation
 *   aside), or as the app shows it (`displayName`, which leaves off "NKB" and the like); or, marked
 *   `loose`, as one of them with an age label or a bracketed aside more or less, so "Wolves 9U" is
 *   the season's "Wolves" and "Heat (Ealey)" its "Heat". A loose name is taken only when it fits
 *   one team alone, and never across two asides or two ages that differ: "Heat (Smith)" is not the
 *   season's "Heat (Ealey)", nor "Wolves 9U" its "Wolves 10U", which a league can have as two teams.
 * - `similar`: close to one (`findSimilarTeam`), "Wolvs" against "Wolves". Only ever a suggestion,
 *   used once a person ticks it, since two real teams can be a letter apart.
 * - `new`: not a team here.
 */
export type NameMatch =
  | { kind: "team"; teamId: string; loose?: true }
  | { kind: "similar"; teamId: string }
  | { kind: "new" };

/** A name as written, and as the app would show it, which may be the same. */
const formsOf = (name: string): string[] => [...new Set([name, displayName(name)])];

/**
 * Two names written at two ages ("Wolves 8U", "Wolves 9U"), which a league can have as two teams.
 * Read off the names as written, before `displayName`: it leaves "8U" off, and the shown "Wolves"
 * took a pasted "Wolves 9U" for the 8U team, as one name with an age added (found by Codex on #456).
 */
const agesDiffer = (a: string, b: string): boolean => {
  const first = ageLevelFromName(a);
  const second = ageLevelFromName(b);
  return first !== undefined && second !== undefined && first !== second;
};

/**
 * Whether one name is the other with only an age label or a bracketed aside added, or both: each
 * read whole (`pasteNameKey`) against the other with its age (`squadNameKey`), or its age and its
 * asides (`teamNameKey`), taken off.
 */
const differsByAside = (a: string, b: string): boolean => {
  const whole = [pasteNameKey(a), pasteNameKey(b)] as const;
  const ageless = [pasteNameKey(squadNameKey(a)), pasteNameKey(squadNameKey(b))] as const;
  const bare = [pasteNameKey(teamNameKey(a)), pasteNameKey(teamNameKey(b))] as const;
  return (
    ageless[0] === whole[1] ||
    whole[0] === ageless[1] ||
    bare[0] === whole[1] ||
    whole[0] === bare[1]
  );
};

export const matchPastedNames = (
  names: Iterable<string>,
  teams: TeamBase[]
): Map<string, NameMatch> => {
  const byName = new Map<string, string>();
  teams.forEach((team) => {
    const key = pasteNameKey(team.name);
    if (!byName.has(key)) byName.set(key, team.id);
  });
  /** The one team `fits` a name to, or undefined when it fits none or more than one. */
  const onlyTeam = (name: string, fits: (pasted: string, team: string) => boolean) => {
    const found = teams.filter(
      (team) =>
        !agesDiffer(name, team.name) &&
        formsOf(name).some((pasted) => formsOf(team.name).some((form) => fits(pasted, form)))
    );
    return found.length === 1 ? found[0]?.id : undefined;
  };
  const matches = new Map<string, NameMatch>();
  for (const name of names) {
    if (matches.has(name)) continue;
    const exact =
      byName.get(pasteNameKey(name)) ??
      onlyTeam(name, (pasted, form) => pasteNameKey(pasted) === pasteNameKey(form));
    const loose = exact === undefined ? onlyTeam(name, differsByAside) : undefined;
    const similar =
      exact === undefined && loose === undefined ? findSimilarTeam(name, teams) : null;
    matches.set(
      name,
      exact !== undefined
        ? { kind: "team", teamId: exact }
        : loose !== undefined
          ? { kind: "team", teamId: loose, loose: true }
          : similar
            ? { kind: "similar", teamId: similar.id }
            : { kind: "new" }
    );
  }
  return matches;
};

/** A game as it was looked over: which side hosted after any swap, and its final score if given. */
export type PastedGame = {
  date: string;
  away: string;
  home: string;
  awayRuns?: number;
  homeRuns?: number;
};

/** The season the looked-over games make, and how many of each went into it. */
export type SeasonFromPaste = {
  /** The season's teams, the same array when no team was added, so nothing that reads them redraws. */
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  addedTeams: number;
  finals: number;
};

/**
 * Turns the games kept into the season's teams, games and scores.
 *
 * `teamFor` says which of the season's teams a name is, or undefined for one that is not a team
 * here, which becomes a new team, named as pasted, with an id minted as every other way in mints
 * one (`createTeamId`). Names that are one name written two ways ("Wolves", "WOLVES") become one
 * team, and names told apart by an aside or an age ("Heat (Ealey)", "Heat (Smith)") stay two, as
 * the paste was read (`pasteNameKey`). A game given a score is written final, as Fill scores
 * writes the games it adds, since the paste's score was looked over before it got here; one
 * without is a blank score sheet with the season's innings. `gameId` names each game, by its place
 * in `games`.
 */
export const seasonFromPaste = (
  games: PastedGame[],
  teams: TeamBase[],
  teamFor: (name: string) => string | undefined,
  innings: number,
  gameId: (index: number) => string
): SeasonFromPaste => {
  const ids = new Set(teams.map((team) => team.id));
  const added: TeamBase[] = [];
  const minted = new Map<string, string>();
  const idOf = (name: string): string => {
    const known = teamFor(name);
    if (known !== undefined) return known;
    const key = pasteNameKey(name);
    const held = minted.get(key);
    if (held !== undefined) return held;
    const id = createTeamId(displayName(name), ids);
    minted.set(key, id);
    added.push({ id, name });
    return id;
  };

  const matchups: Matchup[] = [];
  const logs: Record<string, GameLog> = {};
  let finals = 0;
  games.forEach((game, index) => {
    const id = gameId(index);
    matchups.push({ id, date: game.date, away: idOf(game.away), home: idOf(game.home) });
    const scored = game.awayRuns !== undefined && game.homeRuns !== undefined;
    if (scored) finals += 1;
    logs[id] = scored
      ? {
          ...blankLog(String(innings)),
          awayRuns: String(game.awayRuns),
          homeRuns: String(game.homeRuns),
          isFinal: true,
        }
      : blankLog(String(innings));
  });

  return {
    teams: added.length > 0 ? [...teams, ...added] : teams,
    matchups,
    logs,
    addedTeams: added.length,
    finals,
  };
};

/** What the paste panel hands App to save: the season's teams, games and scores, made whole. */
export type PastedSeason = {
  /** The season's teams the panel matched the names against, which App checks are still the ones. */
  base: TeamBase[];
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  /** What the toast says once they are in. */
  said: string;
};
