import type { FixtureSeason } from "../../../../scripts/poolFixture";
import type { SeasonSnapshot } from "../../storage";
import { DEFAULT_SETTINGS } from "../../types";
import { coerceLogs, coerceMatchups, coerceTeams } from "../../validate";
import type { LeagueDocsList } from "../cloudLeague";
import { seasonDocId, seasonToDoc } from "../leagueDocs";

/**
 * The pool fixture's League Standings seasons as their documents (`league/{season}`), for the tests
 * of what a server builds from them.
 */

/** Each fixture season as a device holds it: every record through the validators storage reads with. */
export const seasonsOf = (seasons: Record<string, FixtureSeason>): SeasonSnapshot[] =>
  Object.entries(seasons).map(([id, raw], index) => {
    const teams = coerceTeams(raw.teams);
    const matchups = coerceMatchups(raw.matchups, teams);
    return {
      id,
      name: `Season ${index + 1}`,
      createdAt: "2026-08-01T12:00:00.000Z",
      teams,
      matchups,
      logs: coerceLogs(raw.logs, matchups),
      bracketLogs: {},
      settings: DEFAULT_SETTINGS,
    };
  });

export type ListedDoc = { id: string; fields: Record<string, unknown> };

/** The seasons' documents as Firestore's REST interface lists them: plain values, by document id. */
export const docsOf = (seasons: readonly SeasonSnapshot[], rev = 1): ListedDoc[] =>
  seasons.map((season) => ({
    id: seasonDocId(season.id),
    fields: JSON.parse(JSON.stringify(seasonToDoc(season, rev))) as Record<string, unknown>,
  }));

/** A listing that hands back `docs`. */
export const listing =
  (docs: readonly ListedDoc[]): LeagueDocsList =>
  async () =>
    docs;

/**
 * `season` with the first game that has a final score scored 9 to 0 instead, so the boards it
 * reaches move.
 */
export const rescored = (season: SeasonSnapshot): SeasonSnapshot => {
  const game = season.matchups.find((one) => season.logs[one.id]?.isFinal);
  const log = game ? season.logs[game.id] : undefined;
  if (!game || !log) throw new Error(`no final score in ${season.id}`);
  return {
    ...season,
    logs: { ...season.logs, [game.id]: { ...log, awayRuns: "9", homeRuns: "0" } },
  };
};
