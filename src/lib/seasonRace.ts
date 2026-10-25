import { parseDateValue, seasonStartMonth } from "./date";
import { calculateTeams, rankOptionsFromSettings, rankTeams } from "./sim";
import type { GameLog, Matchup, Settings, TeamBase } from "./types";
import { isFinal } from "./util";

/** Every team's place in the table after each day games were played, in the season's own order. */
export type SeasonRace = { dates: string[]; places: Record<string, number[]> };

/**
 * The table as it stood at the end of each game day, for the Forecast's race chart. The day's
 * finals are added together, so a doubleheader is one step, and the season is put in its own order
 * (`seasonStartMonth`), so a season over New Year reads December then January. A final with no date
 * cannot be placed on the line and is left out.
 */
export const seasonRace = (
  teams: TeamBase[],
  matchups: Matchup[],
  logs: Record<string, GameLog>,
  settings: Settings
): SeasonRace => {
  const finals = matchups.filter((game) => isFinal(logs[game.id]) && game.date !== "");
  const startMonth = seasonStartMonth(matchups.map((game) => game.date));
  const order = (date: string) => parseDateValue(date, startMonth);
  const dates = [...new Set(finals.map((game) => game.date))]
    .filter((date) => Number.isFinite(order(date)))
    .sort((a, b) => order(a) - order(b));
  const places: Record<string, number[]> = Object.fromEntries(teams.map((team) => [team.id, []]));
  const rankOptions = rankOptionsFromSettings(settings);
  dates.forEach((date) => {
    const through = order(date);
    const played = finals.filter((game) => order(game.date) <= through);
    const ranked = rankTeams(calculateTeams(teams, played, logs, settings), rankOptions);
    ranked.forEach((team, at) => places[team.id]?.push(at + 1));
  });
  return { dates, places };
};
