import { csvEscape, csvSectionMarker, CSV_SECTIONS } from "./csv";
import { formatGameDate } from "./date";
import { calcBip } from "./teamStats";
import type { GameLog, Matchup, PitchMode, TeamBase } from "./types";
import { blankLog } from "./util";

/**
 * The schedule as a CSV document.
 *
 * This was ninety lines inside App, wrapped around a Blob and an anchor click, so the only way to
 * find out what the file would contain was to download one. Building the text is a pure function
 * of the season; only the saving is a browser act, and that stayed behind.
 *
 * The two pitch modes are two different documents. Player pitch records errors and walks allowed,
 * machine pitch records strikeouts and balls in play, and there is no column that means one thing
 * in one mode and another in the other — which is why the header is chosen whole rather than
 * assembled from parts.
 */
const PLAYER_PITCH_HEADERS = [
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
];

const MACHINE_PITCH_HEADERS = [
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

const EMPTY_LOG = blankLog();

export type ScheduleCsvInput = {
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  /** Team names by id; an id with no team keeps the id, so a row is never silently dropped. */
  teamsById: Map<string, TeamBase>;
  pitchMode: PitchMode;
  /**
   * The Team Rankings sections to append, already rendered.
   *
   * Team Rankings is stored outside this season, so a CSV of the schedule alone is not a full
   * backup. When there is a pool its sections ride along after the schedule, and the schedule then
   * gets its own marker so the file reads as the sectioned document it has become. A league that
   * never used Team Rankings has nothing to append and gets the same flat CSV as before.
   */
  rankingsSections?: string;
};

export const buildScheduleCsv = ({
  matchups,
  logs,
  teamsById,
  pitchMode,
  rankingsSections,
}: ScheduleCsvInput): string => {
  const headers = pitchMode === "player" ? PLAYER_PITCH_HEADERS : MACHINE_PITCH_HEADERS;

  const rows = matchups.map((game) => {
    const log = logs[game.id] || EMPTY_LOG;
    const away = teamsById.get(game.away)?.name || game.away;
    const home = teamsById.get(game.home)?.name || game.home;
    const values =
      pitchMode === "player"
        ? [
            game.id,
            formatGameDate(game.date),
            away,
            log.innings,
            log.awayRuns,
            log.awayHits,
            log.awayErrors ?? "",
            log.homeWalksAllowed ?? "",
            home,
            log.homeRuns,
            log.homeHits,
            log.homeErrors ?? "",
            log.awayWalksAllowed ?? "",
          ]
        : [
            game.id,
            formatGameDate(game.date),
            away,
            log.innings,
            log.awayRuns,
            log.awayHits,
            log.awayK,
            calcBip(log.awayHits, log.awayRuns, log.awayK, log.innings),
            home,
            log.homeRuns,
            log.homeHits,
            log.homeK,
            calcBip(log.homeHits, log.homeRuns, log.homeK, log.innings),
          ];
    return values.map(csvEscape).join(",");
  });

  const schedule = [headers.join(","), ...rows].join("\n");
  return rankingsSections
    ? `${csvSectionMarker(CSV_SECTIONS.schedule)}\n${schedule}\n\n${rankingsSections}\n`
    : schedule;
};

/** The file a downloaded schedule is called, from the season's own label. */
export const scheduleCsvFilename = (seasonLabel: string) =>
  `${seasonLabel.replace(/\s+/g, "_")}_Schedule_Data.csv`;
