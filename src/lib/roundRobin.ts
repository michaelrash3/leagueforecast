import { csvEscape } from "./csv";
import { displayName } from "./format";
import { createTeamId } from "./sim";
import { blankLog } from "./util";
import type { GameLog, Matchup, PitchMode, TeamBase } from "./types";

/**
 * Building a blank season from a list of names: a single round robin, every side playing every
 * other once, with an empty score sheet per game.
 *
 * Here rather than in the component because none of it needs a browser. The list is text, the
 * schedule is arithmetic over that text, and the CSV is a rendering of the schedule — so all three
 * can be checked by reading them, which is what a round robin's own correctness (every pair
 * exactly once, in a stable order) actually wants.
 */

/** A built season, ready to be adopted wholesale or written out as a blank score sheet. */
export type BuiltSeason = {
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
};

/**
 * The team names in a pasted list: one per line or comma-separated, trimmed, blanks dropped, and
 * each name kept once.
 *
 * Deduplicated because a name typed twice is a slip rather than two clubs — a round robin over it
 * would schedule a side against itself, and the two rows would be indistinguishable in the table.
 */
export const builderTeamNames = (text: string): string[] =>
  Array.from(
    new Set(
      text
        .split(/\r?\n|,/)
        .map((name) => name.trim())
        .filter(Boolean)
    )
  );

/**
 * A single round robin over those names, or `null` when there are fewer than two to schedule.
 *
 * `null` rather than an empty season and rather than a message: what to say about it is the
 * caller's, and a season of nobody playing nobody is not something to adopt by accident.
 *
 * The pairing is the upper triangle in the order the names were given, so the same list always
 * builds the same schedule and the first name is away in every game it opens. Game ids carry
 * their number and both sides, which is what makes a downloaded score sheet re-importable against
 * the schedule it came from.
 */
export const buildRoundRobin = (names: string[], defaultInnings: number): BuiltSeason | null => {
  if (names.length < 2) return null;
  const existingIds = new Set<string>();
  const teams: TeamBase[] = names.map((name) => ({
    id: createTeamId(displayName(name), existingIds),
    name,
  }));
  const matchups: Matchup[] = [];
  const logs: Record<string, GameLog> = {};
  for (let awayIndex = 0; awayIndex < teams.length; awayIndex += 1) {
    for (let homeIndex = awayIndex + 1; homeIndex < teams.length; homeIndex += 1) {
      const away = teams[awayIndex];
      const home = teams[homeIndex];
      if (!away || !home) continue;
      const gameNumber = matchups.length + 1;
      const id = `game_${String(gameNumber).padStart(3, "0")}_${away.id}_${home.id}`;
      matchups.push({ id, date: "", away: away.id, home: home.id });
      logs[id] = blankLog(String(defaultInnings));
    }
  }
  return { teams, matchups, logs };
};

/**
 * The columns a blank score sheet carries, which depend on how the league pitches.
 *
 * Player pitch counts errors and walks, because that is where its runs come from; machine pitch
 * counts strikeouts and balls in play instead, and has no walks to record at all.
 */
const csvHeaders = (pitchMode: PitchMode): string[] =>
  pitchMode === "player"
    ? [
        "Game ID",
        "Date",
        "Away Team",
        "Innings",
        "Away Runs",
        "Away Hits",
        "Away E",
        "Away BB",
        "Home Team",
        "Home Runs",
        "Home Hits",
        "Home E",
        "Home BB",
      ]
    : [
        "Game ID",
        "Date",
        "Away Team",
        "Innings",
        "Away Runs",
        "Away Hits",
        "Away K",
        "Away BIP",
        "Home Team",
        "Home Runs",
        "Home Hits",
        "Home K",
        "Home BIP",
      ];

/**
 * That season as a blank score sheet: one row a game, names rather than ids, and every score cell
 * empty for somebody to fill in at the field.
 *
 * Machine pitch writes "N/A" into the balls-in-play columns rather than leaving them blank,
 * because blank is a number nobody has entered yet and this is a number that is never coming.
 */
export const roundRobinCsv = (
  built: BuiltSeason,
  settings: { pitchMode: PitchMode; defaultGameInnings: number }
): string => {
  const nameOf = (teamId: string) => built.teams.find((team) => team.id === teamId)?.name || teamId;
  const innings = String(settings.defaultGameInnings);
  const rows = built.matchups.map((game) => {
    const away = nameOf(game.away);
    const home = nameOf(game.home);
    const values =
      settings.pitchMode === "player"
        ? [game.id, "", away, innings, "", "", "", "", home, "", "", "", ""]
        : [game.id, "", away, innings, "", "", "", "N/A", home, "", "", "", "N/A"];
    return values.map(csvEscape).join(",");
  });
  return [csvHeaders(settings.pitchMode).join(","), ...rows].join("\n");
};

/** What a blank score sheet is called on disk, from the season it was built for. */
export const roundRobinFileName = (seasonLabel: string): string =>
  `${seasonLabel.replace(/\s+/g, "_")}_Blank_Round_Robin.csv`;
