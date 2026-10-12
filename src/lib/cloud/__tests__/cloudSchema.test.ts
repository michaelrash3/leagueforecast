import { describe, expect, it } from "vitest";
import type { AgelessEvidence, AgeTally } from "../../agelessEvidence";
import type { AgeUnknownTeam } from "../../ageUnknown";
import { BACKUP_VERSION } from "../../backup";
import type { GcSeason, GcSeasonName } from "../../gameChangerApi";
import type { RefreshCadence } from "../../gameChangerSchedule";
import type { NamedAge } from "../../namedAges";
import type { MemberOrg, OrgMembership } from "../../orgMembership";
import type { RefusedClubs } from "../../refusedClubs";
import type { SeasonSnapshot } from "../../storage";
import type { SeasonSegment } from "../../teamRankings/seasons";
import type {
  AgeGroup,
  FoldedRow,
  GcAgeSource,
  GcTeamLink,
  ScoutGame,
  ScoutGameSource,
  ScoutTeam,
} from "../../teamRankings/types";
import {
  ARCHIVE_VERSION,
  type ArchivedRankingRow,
  type ArchivedSeason,
  type ArchiveEntry,
} from "../../teamRankingsArchive";
import { COMPACT_VERSION } from "../../teamRankingsCompact";
import {
  STORAGE_VERSION,
  type GameLog,
  type Matchup,
  type ModelAggression,
  type PitchMode,
  type PostseasonFormat,
  type RecapGrouping,
  type ScoreDetail,
  type Settings,
  type TeamBase,
  type TiebreakerFactor,
} from "../../types";
import { DATA_SCHEMA } from "../cloudManifest";
import { hashValue } from "../cloudPack";

/*
 * The tripwire for `DATA_SCHEMA`. A build reads the cloud copy through its own idea of what a
 * season, a game or a pool row holds, and writes it back the same way: an older build that meets a
 * field it does not know drops it, and its next save drops it for every device. The schema number
 * is what stops that, and it only works if it goes up with every change to a stored shape.
 *
 * So every shape the cloud copy carries is listed here, field by field, and the compiler holds each
 * list to its type: a field added to a type and not to its list fails the typecheck, naming the
 * field. Adding it to the list changes the shapes' fingerprint, which is no longer the last one in
 * `SHAPES`, and the test fails until a new entry is added under a higher schema, which
 * `DATA_SCHEMA` must then equal. A field kept only in memory still counts: raising the schema costs
 * an older device one reload, and guessing wrong about what is stored costs data.
 */

/** Every field of `T`, as a list the compiler holds to it. */
const fieldsOf =
  <T>() =>
  <const L extends readonly (keyof T & string)[]>(
    fields: L & ([keyof T] extends [L[number]] ? unknown : { missing: Exclude<keyof T, L[number]> })
  ): readonly string[] =>
    fields;

/** Every value of a union of words, as a list the compiler holds to it. */
const wordsOf =
  <U extends string>() =>
  <const L extends readonly U[]>(
    words: L & ([U] extends [L[number]] ? unknown : { missing: Exclude<U, L[number]> })
  ): readonly string[] =>
    words;

/** A tuple's length, held to the type's own: a position added is a changed shape. */
const TALLY_LENGTH: AgeTally["length"] = 2;

const SHAPES_NOW = {
  versions: {
    storage: STORAGE_VERSION,
    backup: BACKUP_VERSION,
    compact: COMPACT_VERSION,
    archive: ARCHIVE_VERSION,
  },
  league: {
    season: fieldsOf<SeasonSnapshot>()([
      "id",
      "name",
      "createdAt",
      "updatedAt",
      "teams",
      "matchups",
      "logs",
      "bracketLogs",
      "settings",
    ]),
    team: fieldsOf<TeamBase>()(["id", "name", "scoutTeamId"]),
    matchup: fieldsOf<Matchup>()(["id", "date", "away", "home"]),
    log: fieldsOf<GameLog>()([
      "awayRuns",
      "awayHits",
      "awayK",
      "homeRuns",
      "homeHits",
      "homeK",
      "awayErrors",
      "homeErrors",
      "awayWalksAllowed",
      "homeWalksAllowed",
      "innings",
      "isFinal",
    ]),
    settings: fieldsOf<Settings>()([
      "goldCutoff",
      "postseasonFormat",
      "seasonLabel",
      "regularSeasonGamesPerTeam",
      "defaultGameInnings",
      "winPoints",
      "tiePoints",
      "runDiffTiebreaker",
      "tiebreakerOrder",
      "maxScoreCap",
      "maxRunDifferential",
      "autoRunDiffCap",
      "useScoutResults",
      "modelAggression",
      "pitchMode",
      "scoreDetail",
      "trackErrors",
      "recapGrouping",
    ]),
    tiebreakers: wordsOf<TiebreakerFactor>()([
      "headToHead",
      "runDifferential",
      "runsAgainst",
      "runsFor",
    ]),
    postseasonFormats: wordsOf<PostseasonFormat>()(["cut", "all", "none"]),
    scoreDetails: wordsOf<ScoreDetail>()(["runs", "full"]),
    pitchModes: wordsOf<PitchMode>()(["machine", "coach", "player"]),
    aggressions: wordsOf<ModelAggression>()(["Conservative", "Balanced", "Aggressive"]),
    recapGroupings: wordsOf<RecapGrouping>()(["game", "date", "week"]),
  },
  pool: {
    ageGroup: fieldsOf<AgeGroup>()([
      "id",
      "name",
      "ageLevel",
      "year",
      "seasonIds",
      "continuesFromId",
      "myTeamId",
    ]),
    team: fieldsOf<ScoutTeam>()([
      "id",
      "name",
      "isMine",
      "state",
      "city",
      "placeholder",
      "nameOnly",
      "avatarKey",
      "gcTeams",
    ]),
    link: fieldsOf<GcTeamLink>()([
      "teamId",
      "name",
      "ageGroupId",
      "season",
      "seasonYear",
      "ageLevel",
      "ageLabel",
      "ageFrom",
      "avatarKey",
      "record",
      "staff",
      "playerCount",
      "countedAt",
      "importedAt",
    ]),
    linkRecord: fieldsOf<NonNullable<GcTeamLink["record"]>>()(["win", "loss", "tie"]),
    ageSources: wordsOf<GcAgeSource>()([
      "you",
      "gamechanger",
      "name",
      "list",
      "opponents",
      "pool",
      "fixtures",
    ]),
    game: fieldsOf<ScoutGame>()([
      "id",
      "teamAId",
      "teamBId",
      "teamAScore",
      "teamBScore",
      "reportedByB",
      "scoreFromB",
      "scoreFromTwin",
      "withdrawn",
      "scoreConfirmed",
      "namedByAvatar",
      "ageGroupId",
      "excluded",
      "date",
      "event",
      "note",
      "ageLevelA",
      "ageLevelB",
      "alsoFrom",
      "alsoRows",
      "season",
      "startTs",
      "source",
    ]),
    reported: fieldsOf<NonNullable<ScoutGame["reportedByB"]>>()(["teamAScore", "teamBScore"]),
    source: fieldsOf<ScoutGameSource>()(["kind", "teamId", "gameId"]),
    folded: fieldsOf<FoldedRow>()([
      "teamId",
      "gameId",
      "startTs",
      "date",
      "ownScore",
      "opponentScore",
      "onSideB",
      "namedByAvatar",
      "filedAgainst",
      "filedLevel",
    ]),
    refreshCadences: wordsOf<RefreshCadence>()(["rotation", "daily"]),
    ageless: fieldsOf<AgeUnknownTeam>()([
      "teamId",
      "name",
      "firstSeen",
      "lastTried",
      "tries",
      "evidence",
    ]),
    evidence: fieldsOf<AgelessEvidence>()([
      "ageLabel",
      "city",
      "state",
      "record",
      "playerCount",
      "ngb",
      "season",
      "games",
      "scored",
      "aheadOfToday",
      "shutoutBlowouts",
      "opponents",
      "namedAnAge",
      "tally",
      "sampleOpponents",
    ]),
    tallyLength: TALLY_LENGTH,
    gcSeason: fieldsOf<GcSeason>()(["season", "year"]),
    gcSeasonNames: wordsOf<GcSeasonName>()(["fall", "winter", "spring", "summer"]),
    refused: fieldsOf<RefusedClubs>()(["forGood", "bySeason"]),
    namedAge: fieldsOf<NamedAge>()([
      "teamId",
      "level",
      "name",
      "namedAt",
      "insteadOf",
      "pinned",
      "was",
    ]),
    orgs: fieldsOf<OrgMembership>()(["orgs", "savedAt"]),
    org: fieldsOf<MemberOrg>()(["orgId", "name", "teamIds"]),
    archiveEntry: fieldsOf<ArchiveEntry>()([
      "id",
      "name",
      "ageLevel",
      "year",
      "segment",
      "archivedAt",
      "fromGames",
      "fromTeams",
      "teams",
    ]),
    archived: fieldsOf<ArchivedSeason>()([
      "version",
      "id",
      "name",
      "ageLevel",
      "year",
      "segment",
      "archivedAt",
      "fromGames",
      "fromTeams",
      "rows",
    ]),
    archivedRow: fieldsOf<ArchivedRankingRow>()([
      "rank",
      "teamName",
      "rating",
      "record",
      "wins",
      "losses",
      "ties",
      "games",
      "strengthOfSchedule",
      "sosRank",
      "state",
      "ageLevel",
      "crossAgeGames",
    ]),
    segments: wordsOf<SeasonSegment>()(["fall", "spring"]),
  },
};

/**
 * Every set of stored shapes a schema has named, oldest first. A change to a shape above adds an
 * entry here, under the next schema, with the fingerprint the failing test prints, and raises
 * `DATA_SCHEMA` to match. An entry is never edited: a copy saved under it is out there.
 */
const SHAPES: readonly { schema: number; fingerprint: string }[] = [
  { schema: 1, fingerprint: "aad50a5fa3c1b71ca12186e0e0704018561382cc742945645604a5e4e6dcb26b" },
];

/** Order-free, so a list tidied into another order is not taken for a new shape. */
const sorted = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sorted).sort();
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, inner]) => [key, sorted(inner)])
    );
  }
  return value;
};

describe("the schema of the data in the cloud copy", () => {
  it("names today's stored shapes, as the last schema in the list, and is what this build writes", async () => {
    const fingerprint = await hashValue(sorted(SHAPES_NOW));
    const last = SHAPES[SHAPES.length - 1];
    expect(
      fingerprint,
      `A stored shape changed. Raise DATA_SCHEMA in cloudManifest.ts, and add ` +
        `{ schema: ${(last?.schema ?? 0) + 1}, fingerprint: "${fingerprint}" } to SHAPES.`
    ).toBe(last?.fingerprint);
    expect(DATA_SCHEMA).toBe(last?.schema);
  });

  it("only ever goes up, and never names the same shapes twice", () => {
    SHAPES.forEach((entry, i) => {
      const before = SHAPES[i - 1];
      if (before) expect(entry.schema).toBeGreaterThan(before.schema);
    });
    expect(new Set(SHAPES.map((entry) => entry.fingerprint)).size).toBe(SHAPES.length);
  });

  it("lists each field and word once", () => {
    const lists = [...Object.values(SHAPES_NOW.league), ...Object.values(SHAPES_NOW.pool)].filter(
      (value): value is readonly string[] => Array.isArray(value)
    );
    for (const list of lists) expect(new Set(list).size).toBe(list.length);
  });
});
