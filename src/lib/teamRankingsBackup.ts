import { CSV_SECTIONS, csvEscape, csvSection, readCsvSection, splitCsvSections } from "./csv";
import type { AgeGroup, ScoutGame, ScoutTeam } from "./teamRankings";
import {
  coerceAgeGroups,
  coerceScoutGames,
  coerceScoutTeams,
  loadAgeGroups,
  loadScoutGames,
  loadScoutTeams,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
} from "./teamRankingsStorage";
import type { UndoSnapshot } from "./types";
import { isRecord } from "./validate";

/**
 * Team Rankings lives in its own storage keys, outside the season-namespaced league data, so a
 * backup that only carried teams/matchups/logs/settings quietly left the whole ranking pool out
 * of the file. This module is the one place that knows how to put that pool into a backup — the
 * JSON block and the CSV sections — and how to read it back out.
 *
 * The pool is global rather than per-season: one backup carries every age group, so restoring one
 * replaces the pool outright rather than merging into it.
 */
export type TeamRankingsBackup = {
  ageGroups: AgeGroup[];
  teams: ScoutTeam[];
  games: ScoutGame[];
};

/** `AgeGroup.seasonIds` is a list inside one cell; a semicolon keeps it out of CSV quoting. */
const SEASON_ID_SEPARATOR = "; ";

const AGE_GROUP_HEADERS = [
  "Age Group ID",
  "Age Group",
  "Age Level",
  "Season Year",
  "League Season IDs",
  "Continues From ID",
  "My Team ID",
];

const TEAM_HEADERS = ["Team ID", "Team Name", "State", "Is My Team"];

const GAME_HEADERS = [
  "Game ID",
  "Age Group ID",
  "Age Group",
  "Date",
  "Team A ID",
  "Team A",
  "Team A Score",
  "Team B ID",
  "Team B",
  "Team B Score",
  "Event",
  "Note",
  "Excluded",
];

/**
 * An undo snapshot that also carries the pool. Only the imports that replace the pool capture it:
 * it is by far the largest thing in a snapshot, and nothing else undoable touches it. Restoring a
 * snapshot without the field therefore leaves the live pool exactly as it is.
 */
export type UndoSnapshotWithRankings = UndoSnapshot & { teamRankings?: TeamRankingsBackup };

export const teamRankingsBackupIsEmpty = (backup: TeamRankingsBackup): boolean =>
  !backup.ageGroups.length && !backup.teams.length && !backup.games.length;

/** Snapshot the live Team Rankings pool for inclusion in a backup. */
export const readTeamRankingsBackup = (): TeamRankingsBackup => ({
  ageGroups: loadAgeGroups(),
  teams: loadScoutTeams(),
  games: loadScoutGames(),
});

/** Replace the live pool with a restored one. `false` if any key could not be written. */
export const writeTeamRankingsBackup = (backup: TeamRankingsBackup): boolean => {
  const wroteAgeGroups = saveAgeGroups(backup.ageGroups);
  const wroteTeams = saveScoutTeams(backup.teams);
  const wroteGames = saveScoutGames(backup.games);
  return wroteAgeGroups && wroteTeams && wroteGames;
};

/**
 * Validate a `teamRankings` block off a parsed backup. `null` means the file carries no such
 * block at all — a backup written before this shipped — and the live pool must be left alone
 * rather than emptied.
 */
export const coerceTeamRankingsBackup = (raw: unknown): TeamRankingsBackup | null => {
  if (!isRecord(raw)) return null;
  if (!("ageGroups" in raw) && !("teams" in raw) && !("games" in raw)) return null;
  return {
    ageGroups: coerceAgeGroups(raw.ageGroups),
    teams: coerceScoutTeams(raw.teams),
    games: coerceScoutGames(raw.games),
  };
};

export const summarizeTeamRankingsBackup = (backup: TeamRankingsBackup): string => {
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  const played = backup.games.filter(
    (game) => Number.isFinite(game.teamAScore) && Number.isFinite(game.teamBScore)
  ).length;
  return `${plural(backup.ageGroups.length, "age group")} · ${plural(backup.teams.length, "ranked team")} · ${plural(backup.games.length, "logged game")} (${played} scored)`;
};

// ---------- CSV ----------

const yesNo = (value: boolean | undefined) => (value ? "yes" : "");
/**
 * Both CSV parsers here work a line at a time, so a newline inside a cell would split one row into
 * two unreadable ones. Free text is written flattened rather than left to corrupt the file.
 */
const textCell = (value: string | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
const isYes = (value: string) => /^(yes|y|true|1)$/i.test(value.trim());
const scoreCell = (score: number | undefined) => (Number.isFinite(score) ? String(score) : "");
const parseScore = (value: string): number | undefined => {
  if (!value) return undefined;
  const score = Number(value);
  return Number.isFinite(score) ? score : undefined;
};
/** Age level and season year are whole numbers, absent on groups saved before the picker. */
const parseLevel = (value: string): number | undefined => {
  if (!value) return undefined;
  const level = Number(value);
  return Number.isInteger(level) ? level : undefined;
};

/**
 * Render the pool as CSV sections to append to a schedule export. Empty string when there is
 * nothing to carry, which keeps the CSV of a league that never opened Team Rankings unchanged.
 */
export const teamRankingsCsvSections = (backup: TeamRankingsBackup): string => {
  if (teamRankingsBackupIsEmpty(backup)) return "";
  const teamNameById = new Map(backup.teams.map((team) => [team.id, team.name]));
  const ageGroupNameById = new Map(backup.ageGroups.map((group) => [group.id, group.name]));

  const ageGroupRows = backup.ageGroups.map((group) =>
    [
      group.id,
      textCell(group.name),
      group.ageLevel ?? "",
      group.year ?? "",
      group.seasonIds.join(SEASON_ID_SEPARATOR),
      group.continuesFromId ?? "",
      group.myTeamId ?? "",
    ]
      .map(csvEscape)
      .join(",")
  );

  const teamRows = backup.teams.map((team) =>
    [team.id, textCell(team.name), textCell(team.state), yesNo(team.isMine)]
      .map(csvEscape)
      .join(",")
  );

  const gameRows = backup.games.map((game) =>
    [
      game.id,
      game.ageGroupId,
      // Names are written for the human reading the file in a spreadsheet; the IDs beside them
      // are what a restore actually reads back.
      textCell(ageGroupNameById.get(game.ageGroupId)),
      game.date ?? "",
      game.teamAId,
      textCell(teamNameById.get(game.teamAId) ?? game.teamAId),
      scoreCell(game.teamAScore),
      game.teamBId,
      textCell(teamNameById.get(game.teamBId) ?? game.teamBId),
      scoreCell(game.teamBScore),
      textCell(game.event),
      textCell(game.note),
      yesNo(game.excluded),
    ]
      .map(csvEscape)
      .join(",")
  );

  return [
    csvSection(CSV_SECTIONS.ageGroups, AGE_GROUP_HEADERS, ageGroupRows),
    csvSection(CSV_SECTIONS.teams, TEAM_HEADERS, teamRows),
    csvSection(CSV_SECTIONS.games, GAME_HEADERS, gameRows),
  ].join("\n\n");
};

/**
 * Read the pool back out of a backup CSV. `null` when the file carries none of the Team Rankings
 * sections — a plain schedule CSV — so an import of one leaves the live pool alone.
 */
export const parseTeamRankingsCsv = (raw: string): TeamRankingsBackup | null => {
  const sections = splitCsvSections(raw, CSV_SECTIONS.schedule);
  const ageGroupSection = readCsvSection(sections, CSV_SECTIONS.ageGroups);
  const teamSection = readCsvSection(sections, CSV_SECTIONS.teams);
  const gameSection = readCsvSection(sections, CSV_SECTIONS.games);
  if (!ageGroupSection && !teamSection && !gameSection) return null;

  const ageGroups: AgeGroup[] = (ageGroupSection?.rows ?? []).flatMap((row) => {
    const cell = (column: string) => ageGroupSection?.cell(row, column) ?? "";
    const id = cell("Age Group ID");
    if (!id) return [];
    const ageLevel = parseLevel(cell("Age Level"));
    const year = parseLevel(cell("Season Year"));
    const continuesFromId = cell("Continues From ID");
    const myTeamId = cell("My Team ID");
    return [
      {
        id,
        name: cell("Age Group") || id,
        seasonIds: cell("League Season IDs")
          .split(";")
          .map((seasonId) => seasonId.trim())
          .filter(Boolean),
        ...(ageLevel === undefined ? {} : { ageLevel }),
        ...(year === undefined ? {} : { year }),
        ...(continuesFromId ? { continuesFromId } : {}),
        ...(myTeamId ? { myTeamId } : {}),
      },
    ];
  });

  const teams: ScoutTeam[] = (teamSection?.rows ?? []).flatMap((row) => {
    const cell = (column: string) => teamSection?.cell(row, column) ?? "";
    const id = cell("Team ID");
    const name = cell("Team Name");
    if (!id || !name) return [];
    const state = cell("State");
    return [
      {
        id,
        name,
        ...(isYes(cell("Is My Team")) ? { isMine: true as const } : {}),
        ...(state ? { state } : {}),
      },
    ];
  });

  const games: ScoutGame[] = (gameSection?.rows ?? []).flatMap((row) => {
    const cell = (column: string) => gameSection?.cell(row, column) ?? "";
    const id = cell("Game ID");
    const teamAId = cell("Team A ID");
    const teamBId = cell("Team B ID");
    const ageGroupId = cell("Age Group ID");
    if (!id || !teamAId || !teamBId || !ageGroupId) return [];
    const teamAScore = parseScore(cell("Team A Score"));
    const teamBScore = parseScore(cell("Team B Score"));
    const date = cell("Date");
    const event = cell("Event");
    const note = cell("Note");
    return [
      {
        id,
        teamAId,
        teamBId,
        ageGroupId,
        ...(teamAScore === undefined ? {} : { teamAScore }),
        ...(teamBScore === undefined ? {} : { teamBScore }),
        ...(date ? { date } : {}),
        ...(event ? { event } : {}),
        ...(note ? { note } : {}),
        ...(isYes(cell("Excluded")) ? { excluded: true as const } : {}),
      },
    ];
  });

  return { ageGroups, teams, games };
};
