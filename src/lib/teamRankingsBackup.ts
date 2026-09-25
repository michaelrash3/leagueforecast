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
  loadAgeUnknown,
  loadDeletedGames,
  loadDroppedClubs,
  loadKeptApart,
  loadNamedAges,
  loadScoutGames,
  loadScoutTeams,
  loadTooYoungClubs,
  replaceScoutGames,
  saveAgeGroups,
  saveAgeUnknown,
  saveDeletedGames,
  saveDroppedClubs,
  saveKeptApart,
  saveNamedAges,
  saveScoutTeams,
  saveTooYoungClubs,
} from "./teamRankingsStorage";
import { coerceAgeUnknown, type AgeUnknownList } from "./ageUnknown";
import { coerceDeletedClubs, coerceDeletedGames } from "./deletedGames";
import { coerceKeptApart } from "./keptApart";
import { coerceNamedAges, namedAgesList, type NamedAge } from "./namedAges";
import { coerceTooYoungClubs } from "./tooYoungClubs";
import type { UndoSnapshot } from "./types";
import { isRecord } from "./validate";
import { coerceArchivedSeason, type ArchivedSeason } from "./teamRankingsArchive";
import {
  COMPACT_VERSION,
  decodeScoutGames,
  decodeScoutTeams,
  encodeAgeGroups,
  encodeScoutGames,
  encodeScoutTeams,
} from "./teamRankingsCompact";

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
  /**
   * The finished seasons kept as tables, with their rows.
   *
   * Optional because most callers have no business with them: an undo snapshot is taken around an
   * import that cannot touch an archive, and the whole-browser backup reads and writes synchronously
   * while an archive's rows are read on demand. The Team Rankings JSON carries them, which is the
   * path that matters — an archived table is the only copy there is of that season, the reset card
   * offers this file as the way back from wiping it, and without this the way back was a lie.
   */
  archives?: ArchivedSeason[];
  /**
   * The decisions somebody made about this pool, as opposed to the pool itself.
   *
   * Every one of these is work that cannot be recomputed. The ages named by hand are an evening
   * spent with GameChanger open in another tab; the thrown-out clubs are a judgement about each
   * one; the deleted rows and the kept-apart pairs are the same. None of it rode in a backup, so
   * restoring one into a fresh browser silently threw all of it away and then set about
   * rediscovering the problems it had answered.
   *
   * Optional, and absent means leave what is there alone — "this file predates the block" and
   * "this file has nothing to say about it" are the same bytes, exactly as `archives` is handled.
   */
  answers?: BackupAnswers;
};

/** The answers, in the shape they are stored in. */
export type BackupAnswers = {
  namedAges: NamedAge[];
  droppedClubs: string[];
  tooYoungClubs: string[];
  deletedGames: string[];
  keptApart: string[];
  ageUnknown: AgeUnknownList;
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
  /** Other GameChanger schedules that listed this game — what tells a doubleheader from a dispute. */
  "Also From",
  /**
   * When the game started, as the schedule gave it. Missing from the file until September 2026, so
   * a restore lost every start, and the start is half of what says two rows are one game.
   */
  "Start",
  /**
   * The rows folded into this game, whole: `team:game`, then `#day` for a row its schedule dated a
   * day off the game's, `@start`, `=own-opponent` and `/B` for a row whose club is side B, each
   * where there is one.
   */
  "Also Rows",
  /** The score as Team B's own schedule gave it, where that was kept: A's runs, a dash, B's. */
  "Team B Reported",
  /** The score is Team B's, borrowed while Team A's schedule has posted none. */
  "Score From Team B",
  /** The score is another listing's of the game on Team A's schedule, the row it stands on blank. */
  "Score From Second Listing",
  /** Team A's schedule no longer lists the row the game stands on; the next tidy takes it away. */
  "Withdrawn",
];

/**
 * An undo snapshot that also carries the pool. Only the imports that replace the pool capture it:
 * it is by far the largest thing in a snapshot, and nothing else undoable touches it. Restoring a
 * snapshot without the field therefore leaves the live pool exactly as it is.
 */
export type UndoSnapshotWithRankings = UndoSnapshot & { teamRankings?: TeamRankingsBackup };

export const teamRankingsBackupIsEmpty = (backup: TeamRankingsBackup): boolean =>
  !backup.ageGroups.length &&
  !backup.teams.length &&
  !backup.games.length &&
  // Archives count. A pool whose every season has been archived has no games at all, and calling
  // that file empty would refuse to write the one thing left worth keeping.
  !backup.archives?.length;

/** Snapshot the live Team Rankings pool for inclusion in a backup. */
export const readTeamRankingsBackup = (): TeamRankingsBackup => ({
  ageGroups: loadAgeGroups(),
  teams: loadScoutTeams(),
  games: loadScoutGames(),
  answers: {
    namedAges: namedAgesList(loadNamedAges()),
    droppedClubs: [...loadDroppedClubs()].sort(),
    tooYoungClubs: [...loadTooYoungClubs()].sort(),
    deletedGames: [...loadDeletedGames()].sort(),
    keptApart: [...loadKeptApart()].sort(),
    ageUnknown: loadAgeUnknown(),
  },
});

/** Replace the live pool with a restored one. `false` if any key could not be written. */
export const writeTeamRankingsBackup = (backup: TeamRankingsBackup): boolean => {
  const wroteAgeGroups = saveAgeGroups(backup.ageGroups);
  const wroteTeams = saveScoutTeams(backup.teams);
  // A restore is the pool now, so a stored year the file has nothing for is meant to go; see
  // `replaceScoutGames`, which is the only caller entitled to that.
  const wroteGames = replaceScoutGames(backup.games);
  /*
   * The answers only when the file carries them. A backup written before this block existed says
   * nothing about them, and reading that silence as "throw them all away" would make restoring an
   * old file destroy work the file was never asked about.
   *
   * Coerced on the way in as well, though each loader coerces on the way out and that is what
   * actually enforces the rules — a named level the app does not rank cannot survive
   * `loadNamedAges` however it got into storage. This pass only keeps the stored value itself
   * clean, so a hand-edited file does not leave rubbish sitting in a key for ever.
   */
  const wroteAnswers = backup.answers
    ? [
        saveNamedAges(coerceNamedAges(backup.answers.namedAges)),
        saveDroppedClubs(coerceDeletedClubs(backup.answers.droppedClubs)),
        saveTooYoungClubs(coerceTooYoungClubs(backup.answers.tooYoungClubs)),
        saveDeletedGames(coerceDeletedGames(backup.answers.deletedGames)),
        saveKeptApart(coerceKeptApart(backup.answers.keptApart)),
        saveAgeUnknown(coerceAgeUnknown(backup.answers.ageUnknown)),
      ].every(Boolean)
    : true;
  return wroteAgeGroups && wroteTeams && wroteGames && wroteAnswers;
};

/** A parsed `answers` block, or undefined when the file has none. */
export const coerceBackupAnswers = (raw: unknown): BackupAnswers | undefined => {
  if (!isRecord(raw)) return undefined;
  return {
    namedAges: namedAgesList(coerceNamedAges(raw.namedAges)),
    droppedClubs: [...coerceDeletedClubs(raw.droppedClubs)].sort(),
    tooYoungClubs: [...coerceTooYoungClubs(raw.tooYoungClubs)].sort(),
    deletedGames: [...coerceDeletedGames(raw.deletedGames)].sort(),
    keptApart: [...coerceKeptApart(raw.keptApart)].sort(),
    ageUnknown: coerceAgeUnknown(raw.ageUnknown),
  };
};

/**
 * Validate a `teamRankings` block off a parsed backup. `null` means the file carries no such
 * block at all — a backup written before this shipped — and the live pool must be left alone
 * rather than emptied.
 */
export const coerceTeamRankingsBackup = (raw: unknown): TeamRankingsBackup | null => {
  if (!isRecord(raw)) return null;
  if (!("ageGroups" in raw) && !("teams" in raw) && !("games" in raw)) return null;
  const answers = coerceBackupAnswers(raw.answers);
  return {
    ageGroups: coerceAgeGroups(raw.ageGroups),
    teams: coerceScoutTeams(raw.teams),
    games: coerceScoutGames(raw.games),
    ...(answers ? { answers } : {}),
  };
};

export const summarizeTeamRankingsBackup = (backup: TeamRankingsBackup): string => {
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  const played = backup.games.filter(
    (game) => Number.isFinite(game.teamAScore) && Number.isFinite(game.teamBScore)
  ).length;
  const archived = backup.archives ?? [];
  const head = `${plural(backup.ageGroups.length, "age group")} · ${plural(backup.teams.length, "ranked team")} · ${plural(backup.games.length, "logged game")} (${played} scored)`;
  // Named separately, because an archived season is not an age group with games — it is a final
  // table, and a summary that folded the two would say a pool had games it does not have.
  return archived.length === 0
    ? head
    : `${head} · ${plural(archived.length, "archived season")} (${archived
        .reduce((sum, season) => sum + season.rows.length, 0)
        .toLocaleString()} rows)`;
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
      (game.alsoFrom ?? []).join(" "),
      game.startTs ?? "",
      (game.alsoRows ?? [])
        .map(
          (row) =>
            `${row.teamId}:${row.gameId}` +
            (row.date ? `#${row.date}` : "") +
            (row.startTs ? `@${row.startTs}` : "") +
            (row.ownScore !== undefined && row.opponentScore !== undefined
              ? `=${row.ownScore}-${row.opponentScore}`
              : "") +
            (row.onSideB ? "/B" : "")
        )
        .join(" "),
      game.reportedByB ? `${game.reportedByB.teamAScore}-${game.reportedByB.teamBScore}` : "",
      yesNo(game.scoreFromB),
      yesNo(game.scoreFromTwin),
      yesNo(game.withdrawn),
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
 * The pool as JSON, which is what a backup is now written as.
 *
 * CSV was the wrong shape for this file and had been for a while. The pool is nested — a team
 * carries a list of GameChanger links, each with its own staff list and season record — and a
 * table has nowhere to put that, so the links went into a cell as JSON inside the CSV and the
 * format was half JSON already. Every value also made the round trip through quoting, the
 * spreadsheet formula-injection guard and a coercion back from text, any one of which is a chance
 * to come back subtly different from what went in.
 *
 * It is also much smaller. The compact codec is what the pool is already stored as — tuples and a
 * shared dictionary rather than a repeated key per field — so writing it out is a copy rather than
 * a re-encoding, and a nationwide pool lands in a fraction of the CSV's bytes.
 *
 * The CSV reader stays, because files written before this exist and a backup nobody can restore is
 * not a backup.
 */
export const BACKUP_JSON_VERSION = 1;

export type TeamRankingsBackupFile = {
  /** Named so a file found on a disk a year from now says what it is. */
  format: "league-forecast-team-rankings";
  version: number;
  /** The compact codec's own version, so a pool written by an older one is still readable. */
  compact: number;
  savedAt: string;
  counts: { ageGroups: number; teams: number; games: number };
  ageGroups: unknown;
  teams: unknown;
  games: unknown;
  /** Left out entirely when there are none, so an old reader sees the file it expects. */
  archives?: unknown;
};

/**
 * The JSON backup in pieces, for handing to a `Blob`.
 *
 * Same reason the CSV is chunked: at a few hundred thousand games the single joined string is tens
 * of megabytes and exists alongside the rows it was built from at the moment of the join, which is
 * exactly the peak a phone cannot afford. The three big arrays are written a slice at a time and
 * the browser assembles the file.
 */
export const teamRankingsJsonParts = (backup: TeamRankingsBackup, savedAt: string): string[] => {
  if (teamRankingsBackupIsEmpty(backup)) return [];
  const head: Omit<TeamRankingsBackupFile, "ageGroups" | "teams" | "games"> = {
    format: "league-forecast-team-rankings",
    version: BACKUP_JSON_VERSION,
    compact: COMPACT_VERSION,
    savedAt,
    counts: {
      ageGroups: backup.ageGroups.length,
      teams: backup.teams.length,
      games: backup.games.length,
    },
  };
  const body = JSON.stringify(head);
  const parts: string[] = [body.slice(0, -1)];
  parts.push(`,"ageGroups":${JSON.stringify(encodeAgeGroups(backup.ageGroups))}`);
  parts.push(`,"teams":${JSON.stringify(encodeScoutTeams(backup.teams))}`);
  parts.push(`,"games":${JSON.stringify(encodeScoutGames(backup.games))}`);
  /*
   * A season a part, not the array in one go. A nationwide season is a hundred thousand rows and
   * there can be years of them; the whole point of writing this file in pieces is that no single
   * string ever holds more than one of the big things at a time.
   */
  const archives = backup.archives ?? [];
  if (archives.length > 0) {
    parts.push(',"archives":[');
    archives.forEach((season, at) => {
      parts.push(`${at === 0 ? "" : ","}${JSON.stringify(season)}`);
    });
    parts.push("]");
  }
  /*
   * And the answers, which this file never carried.
   *
   * `readTeamRankingsBackup` has always built the block and `writeTeamRankingsBackup` has always
   * restored it; only the writer in between left it out, so the pool backup restored answers it
   * had never saved. That is the file the reset card offers as the way back, and a reset clears
   * the waiting list — so backing up, resetting and restoring lost every team waiting on an age,
   * which is the one answer here that costs two requests a team to learn again. Thirty-six
   * thousand of them is seventy-two thousand requests to rebuild a file that was meant to be the
   * safety net.
   *
   * The waiting list is written a row at a time, like the archives above and for the same reason:
   * it is the biggest thing in the block by far, and the point of writing this file in pieces is
   * that no single string ever holds all of it.
   */
  const answers = backup.answers;
  if (answers) {
    parts.push(',"answers":{');
    parts.push(`"namedAges":${JSON.stringify(answers.namedAges)}`);
    parts.push(`,"droppedClubs":${JSON.stringify(answers.droppedClubs)}`);
    parts.push(`,"tooYoungClubs":${JSON.stringify(answers.tooYoungClubs)}`);
    parts.push(`,"deletedGames":${JSON.stringify(answers.deletedGames)}`);
    parts.push(`,"keptApart":${JSON.stringify(answers.keptApart)}`);
    parts.push(',"ageUnknown":[');
    answers.ageUnknown.forEach((row, at) => {
      parts.push(`${at === 0 ? "" : ","}${JSON.stringify(row)}`);
    });
    parts.push("]}");
  }
  parts.push("}");
  return parts;
};

/** The whole file as one string. The parts above, joined — for a test or a small pool. */
export const teamRankingsJson = (backup: TeamRankingsBackup, savedAt: string): string =>
  teamRankingsJsonParts(backup, savedAt).join("");

/**
 * Reads a JSON backup back, or returns null because this is not one.
 *
 * Null rather than a throw, and null rather than an empty pool: "this file is not a Team Rankings
 * backup" and "this backup is of an empty pool" are different answers, and a restore that treated
 * them alike would wipe a pool on being handed the wrong file.
 */
export const parseTeamRankingsJson = (raw: string): TeamRankingsBackup | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.format !== "league-forecast-team-rankings") return null;

  const ageGroups = coerceAgeGroups(parsed.ageGroups);
  // Through the same decoders storage reads with, so a file written by an older compact version
  // and a file written as plain objects both come back — the codec already knows both shapes.
  const teams = decodeScoutTeams(parsed.teams, coerceScoutTeams);
  const games = decodeScoutGames(parsed.games, coerceScoutGames);
  // Absent in every file written before archives existed, which is why it is optional rather than
  // defaulted to an empty list: "this file has no archives" and "this file predates them" are the
  // same bytes, and neither is a reason to clear the ones this browser has.
  const archives = Array.isArray(parsed.archives)
    ? parsed.archives.flatMap((raw) => {
        const season = coerceArchivedSeason(raw);
        return season ? [season] : [];
      })
    : undefined;
  // Absent in every file written before the block was saved at all, and `coerceBackupAnswers`
  // answers undefined for one — which is what keeps a restore from wiping decisions this browser
  // holds on being handed an older file.
  const answers = coerceBackupAnswers(parsed.answers);
  return {
    ageGroups,
    teams,
    games,
    ...(archives ? { archives } : {}),
    ...(answers ? { answers } : {}),
  };
};

/** Whether a file looks like JSON rather than CSV, without parsing the whole of it. */
export const looksLikeJsonBackup = (raw: string): boolean => raw.trimStart().startsWith("{");

/**
 * Roughly how many bytes a backup file will be, without building it.
 *
 * Used to warn before a download that would take a while, so the numbers only have to be the
 * right order of magnitude, and the estimate leans high — which is the safe way round for
 * something that decides whether to warn.
 *
 * Measured on the compact JSON rather than the CSV it replaced: a game is a short tuple of numbers
 * and dictionary indices rather than a row with both names, the event and the source spelled out,
 * which is most of why the file is a fraction of the size.
 */
export const estimateBackupBytes = (backup: TeamRankingsBackup): number =>
  backup.ageGroups.length * 40 +
  backup.teams.length * 90 +
  backup.games.length * 70 +
  // An archived row is written as a plain object rather than a tuple — there are far fewer of them
  // than games, and a table that cannot be recomputed is worth being readable by hand.
  (backup.archives ?? []).reduce((sum, season) => sum + season.rows.length * 150, 0) +
  /*
   * And the answers, which used to count for nothing at all. The teams waiting on an age are the
   * only part of that block with any size to it, and on a nationwide pool they dwarf everything
   * above: at 374 bytes a row — 1.5 MB for 4,013 rows, measured in `agelessEvidence.ts` — a list
   * of thirty-six thousand is thirteen megabytes the estimate could not see, against a warning
   * threshold of eight.
   */
  (backup.answers?.ageUnknown.length ?? 0) * 374;

/** That estimate as something to put in a sentence: "2.7 MB", "840 KB". */
export const formatBytes = (bytes: number): string => {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} bytes`;
};

/**
 * Past this, a download is worth asking about first. A file this size takes a noticeable moment to
 * put together on a phone, and somebody who pressed the button meaning to keep a copy of their own
 * league should hear that before waiting for it.
 *
 * Lower than it was, because the file is smaller than it was: the CSV it replaced ran to about
 * three times the bytes for the same pool, so keeping the old figure would have meant a nationwide
 * backup no longer warned at all.
 */
export const LARGE_BACKUP_BYTES = 8_000_000;

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
    // Space-separated, because a GameChanger team id never contains one and a comma would need
    // quoting in a cell this is only ever read back from.
    const alsoFrom = cell("Also From").split(/\s+/).filter(Boolean);
    const startTs = cell("Start");
    // A colon, because neither a GameChanger team id nor a game id ever holds one; the start holds
    // colons of its own, but never "@", "=" or "/". A row dated a day off its game's carries its own
    // day after "#", which no id holds either.
    const alsoRows = cell("Also Rows")
      .split(/\s+/)
      .flatMap((entry) => {
        // A score typed by hand can be any number the score cell takes, so not only whole ones.
        const parsed =
          /^([^:@=/#]+):([^:@=/#]+)(?:#(\d{4}-\d{2}-\d{2}))?(?:@([^@=/]+))?(?:=(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?))?(\/B)?$/.exec(
            entry
          );
        if (!parsed) return [];
        const [, teamId, gameId, date, startTs, own, opponent, sideB] = parsed;
        return [
          {
            teamId: teamId!,
            gameId: gameId!,
            ...(date ? { date } : {}),
            ...(startTs ? { startTs } : {}),
            ...(own !== undefined && opponent !== undefined
              ? { ownScore: Number(own), opponentScore: Number(opponent) }
              : {}),
            ...(sideB ? { onSideB: true } : {}),
          },
        ];
      });
    const reported = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(cell("Team B Reported").trim());
    return [
      {
        id,
        teamAId,
        teamBId,
        ageGroupId,
        ...(reported
          ? { reportedByB: { teamAScore: Number(reported[1]), teamBScore: Number(reported[2]) } }
          : {}),
        ...(teamAScore === undefined ? {} : { teamAScore }),
        ...(teamBScore === undefined ? {} : { teamBScore }),
        ...(date ? { date } : {}),
        ...(event ? { event } : {}),
        ...(note ? { note } : {}),
        ...(isYes(cell("Excluded")) ? { excluded: true as const } : {}),
        ...(isYes(cell("Score From Team B")) ? { scoreFromB: true as const } : {}),
        ...(isYes(cell("Score From Second Listing")) ? { scoreFromTwin: true as const } : {}),
        ...(isYes(cell("Withdrawn")) ? { withdrawn: true as const } : {}),
        ...(season ? { season } : {}),
        ...(ageLevelA === undefined ? {} : { ageLevelA }),
        ...(ageLevelB === undefined ? {} : { ageLevelB }),
        // Lost on a restore, a settled stand-in looks like a disputed score again and a real
        // result gets deleted a second time — so it is carried in the file rather than rebuilt.
        ...(alsoFrom.length > 0 ? { alsoFrom } : {}),
        ...(alsoRows.length > 0 ? { alsoRows } : {}),
        ...(startTs ? { startTs } : {}),
        // Half a source names nothing a re-pull could match, so it takes both ids or neither.
        ...(sourceTeamId && sourceGameId
          ? { source: { kind: "gamechanger" as const, teamId: sourceTeamId, gameId: sourceGameId } }
          : {}),
      },
    ];
  });

  return { ageGroups, teams, games };
};
