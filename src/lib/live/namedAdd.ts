import { gamesOfNamed, loggedNamed, type NamedGame } from "../teamRankings/namedGames";
import type { ScoutGame, ScoutTeam } from "../teamRankings/types";
import { MAX_COMMAND_STEPS, stepCount, type PoolCommand } from "./commands";

/**
 * Games named by their clubs' names, made into the change that adds them (1.6): the device's Games
 * tab makes it for a pasted schedule against the roster it holds (`TeamRankingsView`), and the
 * server makes it for the live page's against the cloud's (`game.import`, `editRun.ts`), the one
 * function between them, so a schedule added either way adds the same clubs and the same games.
 */

/**
 * The change that adds `games`, which `teams` (the year's clubs as the page knows them, League
 * Standings' among them) resolved, as one command: the clubs the games name that the roster
 * (`roster`) does not hold yet adopted with them, and each held club the resolving cleaned up, a
 * name tidied or a state filled in, put back as it now is ahead of them.
 */
export const addOfResolved = ({
  year,
  games,
  teams,
  roster,
}: {
  year: number | null;
  games: ScoutGame[];
  teams: readonly ScoutTeam[];
  roster: readonly ScoutTeam[];
}): PoolCommand => {
  const held = new Map(roster.map((team) => [team.id, team]));
  const named = new Set(games.flatMap((game) => [game.teamAId, game.teamBId]));
  const adopt = teams.filter((team) => !held.has(team.id) && named.has(team.id));
  const heals = teams.flatMap((team): PoolCommand[] => {
    const was = held.get(team.id);
    if (!was || !named.has(team.id) || (was.name === team.name && was.state === team.state))
      return [];
    const state = team.state === undefined ? {} : { state: team.state };
    return [{ kind: "team.put", team: { ...was, name: team.name, ...state } }];
  });
  const add: PoolCommand = { kind: "game.add", year, games, adopt };
  return heals.length === 0 ? add : { kind: "batch", commands: [...heals, add] };
};

/**
 * The change a `game.import` of `named` on page `page` makes: its names resolved against the
 * year's clubs as the page knows them (`known`, League Standings' among them), as the device's
 * Games tab resolves a pasted schedule (`gamesOfNamed`), and added (`addOfResolved`).
 */
export const addOfNamed = ({
  year,
  page,
  named,
  known,
  roster,
}: {
  year: number | null;
  page: string;
  named: readonly NamedGame[];
  known: ScoutTeam[];
  roster: readonly ScoutTeam[];
}): PoolCommand => {
  const { teams, games } = gamesOfNamed(named, known, page);
  return addOfResolved({ year, games, teams, roster });
};

/**
 * Why the server adds none of a `game.import`'s games:
 * - `logged`: one the device did not say it was adding again (`again`) is a game the page has by
 *   now. What the device was told when it checked may be out of date: another member added the
 *   same schedule meanwhile, or an earlier press landed though the device was never told so.
 * - `too-many`: the change would take more steps than one edit may (`MAX_COMMAND_STEPS`), each
 *   club whose name or state it tidies a step that writes the roster.
 * - `refused`: a game's two names are one club, which no page of the device's sends.
 */
export type ImportRefusal = "logged" | "too-many" | "refused";

/**
 * What the server makes of a `game.import` of `named` on page `page`: its names resolved against
 * the year's clubs and games as the page knows them (`known`, League Standings' among them), as
 * the device's Games tab resolves a pasted schedule, and added (`addOfResolved`); or why not.
 */
export const importOfNamed = ({
  year,
  page,
  named,
  known,
  roster,
}: {
  year: number | null;
  page: string;
  named: readonly NamedGame[];
  known: { teams: ScoutTeam[]; games: readonly ScoutGame[] };
  roster: readonly ScoutTeam[];
}): { ok: true; command: PoolCommand } | { ok: false; why: ImportRefusal } => {
  // Checked as the device's check is (`games.check`), so a game refused here reads as logged there.
  const onPage = known.games.filter((game) => game.ageGroupId === page);
  const logged = loggedNamed(named, known.teams, onPage, page);
  if (named.some((game, at) => logged[at] === true && game.again !== true))
    return { ok: false, why: "logged" };
  const { teams, games } = gamesOfNamed(named, known.teams, page);
  if (games.some((game) => game.teamAId === game.teamBId)) return { ok: false, why: "refused" };
  const command = addOfResolved({ year, games, teams, roster });
  return stepCount(command) > MAX_COMMAND_STEPS
    ? { ok: false, why: "too-many" }
    : { ok: true, command };
};
