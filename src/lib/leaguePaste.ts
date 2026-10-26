/**
 * The names a pasted league schedule gives, matched to the season's own teams, and the season the
 * games make once they have been looked over (`LeagueSchedulePaste`). Pure: nothing here reads or
 * writes storage, and nothing is asked of a server.
 */
import { displayName } from "./format";
import { createTeamId } from "./sim";
import { findSimilarTeam, teamNameKey } from "./teamRankings";
import type { GameLog, Matchup, TeamBase } from "./types";
import { blankLog } from "./util";

/**
 * What a pasted name is in this season:
 *
 * - `team`: one of its teams, by the same name key everything else in the app matches names by
 *   (`teamNameKey`), so "Wolves 9U" is the season's "Wolves".
 * - `similar`: close to one (`findSimilarTeam`), "Wolvs" against "Wolves". Only ever a suggestion,
 *   used once a person ticks it, since two real teams can be a letter apart.
 * - `new`: not a team here.
 */
export type NameMatch =
  { kind: "team"; teamId: string } | { kind: "similar"; teamId: string } | { kind: "new" };

export const matchPastedNames = (
  names: Iterable<string>,
  teams: TeamBase[]
): Map<string, NameMatch> => {
  const byKey = new Map<string, string>();
  teams.forEach((team) => {
    const key = teamNameKey(team.name);
    if (!byKey.has(key)) byKey.set(key, team.id);
  });
  const matches = new Map<string, NameMatch>();
  for (const name of names) {
    if (matches.has(name)) continue;
    const exact = byKey.get(teamNameKey(name));
    const similar = exact === undefined ? findSimilarTeam(name, teams) : null;
    matches.set(
      name,
      exact !== undefined
        ? { kind: "team", teamId: exact }
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
 * team. A game given a score is written final, as Fill scores writes the games it adds, since the
 * paste's score was looked over before it got here; one without is a blank score sheet with the
 * season's innings. `gameId` names each game, by its place in `games`.
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
    const key = teamNameKey(name);
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
