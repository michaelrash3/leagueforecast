/**
 * A season with games already played, for someone who wants to see what the app does before they
 * have a schedule of their own. The teams are invented and nothing here is saved — the caller
 * decides whether it replaces what is stored.
 */
import { createTeamId } from "./sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "./types";
import { blankLog } from "./util";

const DEMO_TEAM_NAMES = [
  "Northside Knockouts",
  "River City Rockets",
  "Metro Mashers",
  "Lakeside Legends",
  "Capital Crushers",
  "East End Eagles",
  "Westfield Whales",
  "Southtown Sluggers",
];

export const buildDemoSeason = () => {
  const existingIds = new Set<string>();
  const demoTeams: TeamBase[] = DEMO_TEAM_NAMES.map((name) => ({
    id: createTeamId(name, existingIds),
    name,
  }));
  const demoMatchups: Matchup[] = [];
  const demoLogs: Record<string, GameLog> = {};
  const dates = [
    "2026-04-05",
    "2026-04-12",
    "2026-04-19",
    "2026-04-26",
    "2026-05-03",
    "2026-05-10",
    "2026-05-17",
  ];
  let gameIndex = 1;

  for (let round = 0; round < demoTeams.length - 1; round += 1) {
    for (let slot = 0; slot < demoTeams.length / 2; slot += 1) {
      const awayIndex = (round + slot) % demoTeams.length;
      const homeIndex = (demoTeams.length - 1 - slot + round) % demoTeams.length;
      if (awayIndex === homeIndex) continue;
      const away = demoTeams[awayIndex];
      const home = demoTeams[homeIndex];
      if (!away || !home) continue;
      const id = `demo-${String(gameIndex).padStart(2, "0")}`;
      demoMatchups.push({ id, date: dates[round] ?? "", away: away.id, home: home.id });

      if (gameIndex <= 18) {
        const awayRuns = 6 + ((gameIndex * 3 + awayIndex) % 9);
        const homeRuns = 5 + ((gameIndex * 5 + homeIndex) % 9);
        demoLogs[id] = {
          innings: "6",
          awayRuns: String(awayRuns === homeRuns ? awayRuns + 1 : awayRuns),
          awayHits: String(Math.max(awayRuns + 3, 8 + ((gameIndex + awayIndex) % 8))),
          awayK: String(2 + ((gameIndex + awayIndex) % 6)),
          homeRuns: String(homeRuns),
          homeHits: String(Math.max(homeRuns + 3, 8 + ((gameIndex + homeIndex) % 8))),
          homeK: String(2 + ((gameIndex + homeIndex) % 6)),
          isFinal: true,
        };
      } else {
        demoLogs[id] = blankLog();
      }
      gameIndex += 1;
    }
  }

  return {
    teams: demoTeams,
    matchups: demoMatchups,
    logs: demoLogs,
    settings: {
      ...DEFAULT_SETTINGS,
      seasonLabel: "Demo League Forecast",
      goldCutoff: 4,
      regularSeasonGamesPerTeam: demoTeams.length - 1,
    },
  };
};
