import {
  CSV_SECTIONS,
  csvEscape,
  csvSection,
  csvSectionMarker,
  readCsvSection,
  splitCsvSections,
} from "./csv";
import type { AgeGroup, ScoutGame, ScoutTeam } from "./teamRankings";
import {
  coerceAgeGroups,
  coerceGcTeamLinks,
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

/**
 * A team's GameChanger links go in one cell as a JSON array. A link is a small record of its own
 * (id, name, season, avatar, record…) and a team can carry several; flattening them into columns
 * would either cap how many a team may have or turn one team into several rows, and a spreadsheet
 * reader has no reason to edit them by hand. `csvEscape` quotes the JSON's commas and doubles its
 * quotes, so the cell survives the trip like any other text.
 */
const TEAM_HEADERS = [
  "Team ID",
  "Team Name",
  "State",
  "City",
  "Is My Team",
  "Placeholder",
  "Name Only",
  "Avatar Key",
  "GameChanger Teams",
];

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
  "Season",
  "Team A Age",
  "Team B Age",
  "Source Team ID",
  "Source Game ID",
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
/** JSON.stringify never emits a raw newline (it escapes them), so a JSON cell needs no flattening. */
const linksCell = (team: ScoutTeam) => (team.gcTeams?.length ? JSON.stringify(team.gcTeams) : "");
/** A links cell that is empty, or not JSON, or not a list, is simply a team with no links. */
const parseLinksCell = (value: string) => {
  if (!value) return [];
  try {
    return coerceGcTeamLinks(JSON.parse(value));
  } catch {
    return [];
  }
};

type CsvBackupSection = { name: string; headers: string[]; rows: string[] };

/**
 * The three sections a backup is made of, as headers and rows rather than as text.
 *
 * Kept separate from the joining so the same rows can be written straight into a file in pieces,
 * which is what a pool of twenty thousand teams needs — see `teamRankingsCsvParts`.
 */
const csvBackupSections = (backup: TeamRankingsBackup): CsvBackupSection[] => {
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
    [
      team.id,
      textCell(team.name),
      textCell(team.state),
      textCell(team.city),
      yesNo(team.isMine),
      yesNo(team.placeholder),
      yesNo(team.nameOnly),
      textCell(team.avatarKey),
      linksCell(team),
    ]
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
      textCell(game.season),
      game.ageLevelA ?? "",
      game.ageLevelB ?? "",
      game.source?.teamId ?? "",
      game.source?.gameId ?? "",
    ]
      .map(csvEscape)
      .join(",")
  );

  return [
    { name: CSV_SECTIONS.ageGroups, headers: AGE_GROUP_HEADERS, rows: ageGroupRows },
    { name: CSV_SECTIONS.teams, headers: TEAM_HEADERS, rows: teamRows },
    { name: CSV_SECTIONS.games, headers: GAME_HEADERS, rows: gameRows },
  ];
};

/**
 * Render the pool as CSV sections to append to a schedule export. Empty string when there is
 * nothing to carry, which keeps the CSV of a league that never opened Team Rankings unchanged.
 */
export const teamRankingsCsvSections = (backup: TeamRankingsBackup): string => {
  if (teamRankingsBackupIsEmpty(backup)) return "";
  return csvBackupSections(backup)
    .map(({ name, headers, rows }) => csvSection(name, headers, rows))
    .join("\n\n");
};

/**
 * How many rows go into one piece of a chunked backup. Small enough that no single piece is large,
 * big enough that a pool of three hundred thousand games is a few hundred pieces rather than a
 * few hundred thousand.
 */
const CHUNK_ROWS = 2_000;

/**
 * The same CSV, in pieces, for handing to a `Blob`.
 *
 * `teamRankingsCsvSections` joins everything into one string, which at twenty thousand teams means
 * holding the whole export twice over — once as the rows and once as the joined copy — at the
 * moment the join happens. A Blob is assembled from parts perfectly well, so the join is simply
 * never done: the peak is the rows alone, and the browser writes the file from the pieces.
 *
 * Concatenated, these are byte for byte what `teamRankingsCsvSections` returns.
 */
export const teamRankingsCsvParts = (backup: TeamRankingsBackup): string[] => {
  if (teamRankingsBackupIsEmpty(backup)) return [];
  const parts: string[] = [];

  csvBackupSections(backup).forEach(({ name, headers, rows }, index) => {
    if (index > 0) parts.push("\n\n");
    parts.push([csvSectionMarker(name), headers.join(",")].join("\n"));
    for (let from = 0; from < rows.length; from += CHUNK_ROWS) {
      // Each piece carries the newline that joins it to the last, so concatenating the parts is
      // exactly the string the unchunked version returns.
      parts.push(`\n${rows.slice(from, from + CHUNK_ROWS).join("\n")}`);
    }
  });

  return parts;
};

/**
 * Roughly how many bytes a backup file will be, without building it.
 *
 * Used to warn before a download that would take a while, so the numbers only have to be the
 * right order of magnitude. Measured against an export of a pulled pool, where a team row runs to
 * about a hundred and fifty characters once its GameChanger links are in and a game row to about
 * two hundred and twenty with both names, the event and the source spelled out. A pool typed in by
 * hand has shorter rows than that, so the estimate leans high, which is the safe way for something
 * that decides whether to warn.
 */
export const estimateBackupBytes = (backup: TeamRankingsBackup): number =>
  backup.ageGroups.length * 60 + backup.teams.length * 150 + backup.games.length * 220;

/** That estimate as something to put in a sentence: "2.7 MB", "840 KB". */
export const formatBytes = (bytes: number): string => {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} bytes`;
};

/**
 * Past this, a download is worth asking about first. A file this size takes a noticeable moment to
 * put together and will not open in every spreadsheet, and somebody who pressed the button meaning
 * to glance at their own league's rows should hear that before waiting for it.
 */
export const LARGE_BACKUP_BYTES = 20_000_000;

/**
 * Read the pool back out of a backup CSV. `null` when the file carries none of the Team Rankings
 * sections — a plain schedule CSV — so an import of one leaves the live pool alone. Columns are
 * found by header name, so a file written before a column existed reads as if that column were
 * blank — the fields it carries are simply absent, as they were when it was written.
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
    const city = cell("City");
    const gcTeams = parseLinksCell(cell("GameChanger Teams"));
    return [
      {
        id,
        name,
        ...(isYes(cell("Is My Team")) ? { isMine: true as const } : {}),
        ...(isYes(cell("Placeholder")) ? { placeholder: true as const } : {}),
        ...(isYes(cell("Name Only")) ? { nameOnly: true as const } : {}),
        ...(cell("Avatar Key") ? { avatarKey: cell("Avatar Key") } : {}),
        ...(state ? { state } : {}),
        ...(city ? { city } : {}),
        ...(gcTeams.length ? { gcTeams } : {}),
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
    const season = cell("Season");
    const ageLevelA = parseLevel(cell("Team A Age"));
    const ageLevelB = parseLevel(cell("Team B Age"));
    const sourceTeamId = cell("Source Team ID");
    const sourceGameId = cell("Source Game ID");
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
        ...(season ? { season } : {}),
        ...(ageLevelA === undefined ? {} : { ageLevelA }),
        ...(ageLevelB === undefined ? {} : { ageLevelB }),
        // Half a source names nothing a re-pull could match, so it takes both ids or neither.
        ...(sourceTeamId && sourceGameId
          ? { source: { kind: "gamechanger" as const, teamId: sourceTeamId, gameId: sourceGameId } }
          : {}),
      },
    ];
  });

  return { ageGroups, teams, games };
};
